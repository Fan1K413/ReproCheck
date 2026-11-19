"""科研审计基准测试指标引擎（纯计算、确定性、无数据库依赖）。

每个 item_id 表示"该样本是否应报警"的一个判定单元。本模块只依据调用方
传入的真值集与预测集计算指标，不读取案例库，也不调用模型。
"""
from __future__ import annotations

from dataclasses import dataclass

# 指标计算口径的中文说明，API 的 schema 端点也复用这份定义。
FORMULA_NOTES_BASE: list[str] = [
    "item_id 是'该样本是否应报警'的判定单元；存在性以该 item_id 是否出现在对应列表中为准。",
    "TP = 真值与预测均出现且 category 一致的 item_id 数量；正样本集合为 truths 中的 item_id 集合。",
    "FP = 预测中出现但不在真值中的 item_id，加上命中真值但 category 不一致的 item_id（误报）。",
    "FN = 真值中出现但未被预测的 item_id，加上命中但 category 不一致的 item_id（漏报）。",
    "基准集只标注需关注的样本，不存在可靠的 TN；误报率按 FP/max(1,|pred_ids|) 计算，即预测报警中的误报占比。",
    "漏报率 = FN/max(1,|truth_ids|)；Precision = TP/(TP+FP)；Recall = TP/(TP+FN)；F1 = 2PR/(P+R)。",
    "所有分母为 0 时对应指标返回 0.0；TP=0 时证据定位准确率返回 None（无法评估）。",
]

SCHEMA: dict = {
    "unit": "item_id：该样本是否应报警的判定单元",
    "metrics": [
        {"name": "precision", "type": "float", "range": [0.0, 1.0],
         "definition": "TP/(TP+FP)，预测报警中正确报警的比例"},
        {"name": "recall", "type": "float", "range": [0.0, 1.0],
         "definition": "TP/(TP+FN)，应报警样本中被正确报警的比例"},
        {"name": "f1", "type": "float", "range": [0.0, 1.0],
         "definition": "2*Precision*Recall/(Precision+Recall)"},
        {"name": "false_positive_rate", "type": "float", "range": [0.0, 1.0],
         "definition": "FP/max(1,|pred_ids|)，无 TN 时的误报率口径"},
        {"name": "false_negative_rate", "type": "float", "range": [0.0, 1.0],
         "definition": "FN/max(1,|truth_ids|)，漏报率"},
        {"name": "evidence_location_accuracy", "type": "float|null", "range": [0.0, 1.0],
         "definition": "TP 中 evidence_locator 与真值一致的比例；TP=0 时为 None"},
        {"name": "category_accuracy", "type": "float", "range": [0.0, 1.0],
         "definition": "category 一致的 TP 数 / 所有命中 item 数（TP + category 不一致的命中数）"},
    ],
    "counts": ["tp", "fp", "fn", "truth_count", "pred_count", "matched_count",
               "category_correct_count", "evidence_correct_count"],
    "formula_notes": FORMULA_NOTES_BASE,
    "input_fields": {
        "truths": ["item_id", "category", "evidence_locator"],
        "predictions": ["item_id", "category", "evidence_locator", "confidence"],
    },
    "compare_baseline": {
        "definition": "当指定指标当前值小于基线值时记为退化；任一退化则 gate_pass=False。",
        "tolerance": 0.0,
        "metric_names": [
            "precision", "recall", "f1", "false_positive_rate", "false_negative_rate",
            "evidence_location_accuracy", "category_accuracy",
        ],
    },
}


@dataclass(frozen=True)
class BenchmarkPrediction:
    """单个检测结果：item_id + 问题分类，可选证据定位与置信度。"""
    item_id: str
    category: str
    evidence_locator: str = ""
    confidence: float = 0.0


@dataclass(frozen=True)
class BenchmarkTruth:
    """单条基准真值：item_id + 问题分类，可选标准证据定位。"""
    item_id: str
    category: str
    evidence_locator: str = ""


def _zero_division_note(name: str, denominator: str) -> str:
    return f"{name} 分母 {denominator} 为 0，按口径返回 0.0。"


def compute_metrics(
    truths: list[BenchmarkTruth],
    predictions: list[BenchmarkPrediction],
) -> dict:
    """按 item_id 匹配计算审计基准指标；同一 item_id 重复出现时以首条为准。"""
    truth_map: dict[str, BenchmarkTruth] = {}
    for t in truths:
        if t.item_id not in truth_map:
            truth_map[t.item_id] = t

    pred_map: dict[str, BenchmarkPrediction] = {}
    for p in predictions:
        if p.item_id not in pred_map:
            pred_map[p.item_id] = p

    truth_ids = set(truth_map)
    pred_ids = set(pred_map)
    matched_ids = truth_ids & pred_ids

    tp = 0
    category_correct_ids: set[str] = set()
    for item_id in matched_ids:
        if truth_map[item_id].category == pred_map[item_id].category:
            tp += 1
            category_correct_ids.add(item_id)

    category_mismatched = len(matched_ids) - tp          # 命中但分类错误
    fp = len(pred_ids - truth_ids) + category_mismatched  # 误报：预测了非正样本或分类错误
    fn = len(truth_ids - pred_ids) + category_mismatched  # 漏报：未预测正样本或分类错误

    formula_notes = list(FORMULA_NOTES_BASE)

    def _divide(numerator: float, denominator: float, name: str, den_label: str) -> float:
        if denominator == 0:
            formula_notes.append(_zero_division_note(name, den_label))
            return 0.0
        return numerator / denominator

    precision = _divide(tp, tp + fp, "Precision", "TP+FP")
    recall = _divide(tp, tp + fn, "Recall", "TP+FN")
    f1 = _divide(2 * precision * recall, precision + recall, "F1", "Precision+Recall")
    false_positive_rate = _divide(fp, len(pred_ids), "误报率", "预测报警数")
    false_negative_rate = _divide(fn, len(truth_ids), "漏报率", "真值样本数")

    evidence_correct = sum(
        1 for item_id in category_correct_ids
        if truth_map[item_id].evidence_locator == pred_map[item_id].evidence_locator
    )
    if tp == 0:
        evidence_accuracy = None
        formula_notes.append("TP 为 0，证据定位准确率无法评估，返回 None。")
    else:
        evidence_accuracy = _divide(evidence_correct, tp, "证据定位准确率", "TP")

    category_accuracy = _divide(tp, len(matched_ids), "问题分类准确率", "命中 item 数")

    return {
        "precision": round(precision, 2),
        "recall": round(recall, 2),
        "f1": round(f1, 2),
        "false_positive_rate": round(false_positive_rate, 2),
        "false_negative_rate": round(false_negative_rate, 2),
        "evidence_location_accuracy": (
            None if evidence_accuracy is None else round(evidence_accuracy, 2)
        ),
        "category_accuracy": round(category_accuracy, 2),
        "counts": {
            "tp": tp,
            "fp": fp,
            "fn": fn,
            "truth_count": len(truth_ids),
            "pred_count": len(pred_ids),
            "matched_count": len(matched_ids),
            "category_correct_count": tp,
            "evidence_correct_count": evidence_correct,
        },
        "formula_notes": formula_notes,
    }


def compare_baseline(current: dict, baseline: dict, metrics: list[str]) -> dict:
    """回归门禁：指定指标低于基线即退化；存在退化时 gate_pass=False。"""
    regressions: list[dict] = []
    improvements: list[dict] = []
    tolerance = 1e-9  # 浮点尾差不算退化
    for name in metrics:
        old = baseline.get(name)
        new = current.get(name)
        if old is None or new is None:
            continue  # 无法比较（如 TP=0 时 evidence accuracy 为 None）
        if new < old - tolerance:
            regressions.append({"metric": name, "baseline": old, "current": new})
        elif new > old + tolerance:
            improvements.append({"metric": name, "baseline": old, "current": new})
    return {
        "regressions": regressions,
        "improvements": improvements,
        "gate_pass": not regressions,
    }
