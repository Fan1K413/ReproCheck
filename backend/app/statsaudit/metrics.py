"""机器学习指标审计引擎（MET-001 .. MET-007，纯函数，无外部强依赖）。

职责边界（与既有数值重算层的分工）：
- ``app.services.numeric_recompute_service`` 是统一验证面板的第 4 层，只从
  TP/FP/FN 或 correct/total 重算 F1 / accuracy / precision / recall，且明确
  不推断实验条件是否等同；本模块在其之上扩展：
  (1) 多分类 macro/micro/weighted 平均策略与类别级指标；
  (2) 二分类与多分类 ROC-AUC / PR-AUC（纯 Python 排序法，不依赖 scipy/sklearn）；
  (3) 回归指标 RMSE / MAE / R² 及 SS_tot 口径；
  (4) 报告值 vs 重算值对比、划分差异与“验证集数值作测试结论”的审计发现；
- 本模块不读取数据库、不执行上传代码、不调用 LLM；所有输入由调用方提供；
- 缺少字段一律 supported=False / insufficient_evidence，不编造数值；
- 所有输出数值统一 round 到 6 位，JSON 可序列化；
- 所有中文陈述只描述统计事实，不使用因果断言词汇（见 schema.NAVIGATION_GUARD）。
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

from .schema import (
    Evidence,
    NAVIGATION_GUARD,
    Verdict,
    get_rule,
)

__all__ = [
    "audit",
    "compute_classification_metrics",
    "compute_multiclass_averages",
    "compute_roc_auc",
    "compute_pr_auc",
    "compute_regression_metrics",
    "recompute_metric",
    "audit_metric_claims",
    "detect_split_mismatch",
    "BOUNDARY_NOTE",
    "SUPPORTED_METRICS",
]

_METHOD = "ml_metrics_audit_v1"
_EPS = 1e-12

BOUNDARY_NOTE = (
    "边界说明：本模块负责机器学习指标审计（MET-*），在 "
    "app.services.numeric_recompute_service 的第4层数值重算（仅 TP/FP/FN 的 "
    "F1/accuracy/precision/recall 与 correct/total 的 accuracy）之外扩展多分类平均、"
    "ROC-AUC/PR-AUC、回归指标与口径/划分审计；本层不执行上传代码、不读取数据库，"
    "全部按公开公式从调用方提供的数据重算，数值一致不代表实验条件相同。"
)

SUPPORTED_METRICS = (
    "accuracy", "precision", "recall", "f1",
    "macro_f1", "micro_f1", "weighted_f1",
    "roc_auc", "pr_auc", "rmse", "mae", "r2",
)

_METRIC_ALIASES = {
    "acc": "accuracy", "accuracy_score": "accuracy", "acc_score": "accuracy",
    "precision_score": "precision", "prec": "precision",
    "recall_score": "recall", "sensitivity": "recall", "tpr": "recall", "rec": "recall",
    "f1_score": "f1", "f-score": "f1", "fscore": "f1", "f1-score": "f1",
    "macro-f1": "macro_f1", "macro f1": "macro_f1", "macro_f1_score": "macro_f1",
    "micro-f1": "micro_f1", "micro f1": "micro_f1", "micro_f1_score": "micro_f1",
    "weighted-f1": "weighted_f1", "weighted f1": "weighted_f1",
    "weighted_f1_score": "weighted_f1",
    "auc": "roc_auc", "roc-auc": "roc_auc", "roc auc": "roc_auc",
    "auroc": "roc_auc", "area_under_roc": "roc_auc",
    "pr-auc": "pr_auc", "pr auc": "pr_auc", "average_precision": "pr_auc",
    "average_precision_score": "pr_auc", "ap": "pr_auc", "auprc": "pr_auc",
    "root_mean_squared_error": "rmse", "rmse_score": "rmse",
    "mean_absolute_error": "mae", "mae_score": "mae",
    "r_squared": "r2", "r-squared": "r2", "r2_score": "r2", "coefficient_of_determination": "r2",
}

_NEUTRAL_WORDS = {
    "导致": "伴随", "造成": "伴随", "证明": "支持", "归因于": "关联于",
    "因为": "鉴于", "所以": "相应", "必然": "预计", "决定了": "关联于",
    "causes": "accompanies", "proves": "supports", "due to": "associated with",
    "therefore": "accordingly", "as a result": "accordingly",
}


# 通用工具
def _guard_text(text: Any) -> str:
    """把可能存在的因果措辞替换为中性陈述，保证只描述统计事实。"""
    value = "" if text is None else str(text)
    for word in sorted(NAVIGATION_GUARD, key=len, reverse=True):
        replacement = _NEUTRAL_WORDS.get(word, "关联于")
        value = value.replace(word, replacement)
        value = value.replace(word.capitalize(), replacement)
    return value


def _is_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError, OverflowError):
        return False


def _as_float(value: Any) -> float | None:
    if _is_number(value):
        return float(value)
    if isinstance(value, str):
        try:
            parsed = float(value.strip())
        except (TypeError, ValueError):
            return None
        return parsed if math.isfinite(parsed) else None
    return None


def _round6(value: Any) -> Any:
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, float):
        return round(value, 6) if math.isfinite(value) else None
    if isinstance(value, int):
        return value
    return value


def _finalize(obj: Any) -> Any:
    """递归 round 到 6 位并把非有限浮点数转为 None，保证 JSON 可序列化。"""
    if isinstance(obj, dict):
        return {str(k): _finalize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_finalize(v) for v in obj]
    if isinstance(obj, float):
        return _round6(obj)
    if isinstance(obj, (str, int, bool)) or obj is None:
        return obj
    return str(obj)


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, (str, bytes)):
        return [value]
    if isinstance(value, Iterable):
        return list(value)
    return [value]


def _sorted_unique(values: Iterable[Any]) -> list[Any]:
    unique = list(dict.fromkeys(_list(values)))
    try:
        return sorted(unique)
    except TypeError:
        return sorted(unique, key=lambda item: str(item))


def _key(label: Any) -> str:
    return str(label)


def _ratio(numerator: float, denominator: float) -> float | None:
    if abs(denominator) <= _EPS:
        return None
    return numerator / denominator


def _prf(tp: int, fp: int, fn: int) -> tuple[float, float, float]:
    precision = _ratio(tp, tp + fp)
    recall = _ratio(tp, tp + fn)
    p = precision if precision is not None else 0.0
    r = recall if recall is not None else 0.0
    f1 = _ratio(2.0 * p * r, p + r)
    return p, r, (f1 if f1 is not None else 0.0)


def _unsupported(note: str, **extra: Any) -> dict[str, Any]:
    result: dict[str, Any] = {
        "supported": False,
        "value": None,
        "values": {},
        "formula": "",
        "inputs": {},
        "note": _guard_text(note),
        "method": _METHOD,
    }
    result.update(extra)
    return _finalize(result)


def _canonical(name: Any) -> str:
    if not isinstance(name, str):
        return ""
    key = name.strip().lower().replace("/", "_")
    return _METRIC_ALIASES.get(key, _METRIC_ALIASES.get(key.replace("_", "-"), key))


# 类别级混淆矩阵工具
def _class_cell(tp: int, fp: int, fn: int, tn: int) -> dict[str, Any]:
    precision, recall, f1 = _prf(tp, fp, fn)
    return {
        "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "support": tp + fn,
        "precision": precision, "recall": recall, "f1": f1,
    }


def _confusion_table(y_true: list[Any], y_pred: list[Any], labels: list[Any]) -> dict[str, dict[str, Any]]:
    table: dict[str, dict[str, Any]] = {}
    for label in labels:
        tp = fp = fn = tn = 0
        for actual, predicted in zip(y_true, y_pred):
            a_hit = actual == label
            p_hit = predicted == label
            if a_hit and p_hit:
                tp += 1
            elif p_hit:
                fp += 1
            elif a_hit:
                fn += 1
            else:
                tn += 1
        table[_key(label)] = _class_cell(tp, fp, fn, tn)
    return table


def _normalize_per_class(per_class: Any) -> dict[str, dict[str, Any]] | None:
    """兼容 class-major 与 metric-major 两种 per_class 结构。"""
    if not isinstance(per_class, dict) or not per_class:
        return None
    metric_keys = {"precision", "recall", "f1", "tp", "fp", "fn", "tn", "support"}
    metric_major = bool(set(map(str, per_class.keys())) & metric_keys) and all(
        isinstance(v, dict) for v in per_class.values()
    )
    if metric_major:
        classes: set[str] = set()
        for by_class in per_class.values():
            classes.update(_key(k) for k in by_class)
        result = {c: {} for c in classes}
        for metric, by_class in per_class.items():
            for label, value in by_class.items():
                result[_key(label)][str(metric)] = value
        return result
    return {_key(k): dict(v) for k, v in per_class.items() if isinstance(v, dict)} or None


def _normalize_support(support: Any, classes: dict[str, dict[str, Any]]) -> dict[str, int]:
    result: dict[str, int] = {}
    raw = support if isinstance(support, dict) else {}
    for label, cell in classes.items():
        value = raw.get(label, raw.get(int(label) if label.lstrip("-").isdigit() else label))
        if _is_number(value):
            result[label] = max(0, int(value))
        elif _is_number(cell.get("support")):
            result[label] = max(0, int(cell["support"]))
        else:
            result[label] = 1
    return result


def _macro_average(classes: dict[str, dict[str, Any]]) -> dict[str, float | None]:
    out: dict[str, float | None] = {}
    for metric in ("precision", "recall", "f1"):
        values = [_as_float(cell.get(metric)) for cell in classes.values()]
        values = [v for v in values if v is not None]
        out[metric] = sum(values) / len(values) if values else 0.0
    return out


def _weighted_average(classes: dict[str, dict[str, Any]], support: dict[str, int]) -> dict[str, float | None]:
    total = sum(support.get(label, 0) for label in classes)
    out: dict[str, float | None] = {}
    for metric in ("precision", "recall", "f1"):
        weighted = 0.0
        used = 0
        for label, cell in classes.items():
            value = _as_float(cell.get(metric))
            weight = support.get(label, 0)
            if value is not None:
                weighted += value * weight
                used += weight
        out[metric] = weighted / used if used > 0 else 0.0
    return out if total > 0 else _macro_average(classes)


def _micro_average(classes: dict[str, dict[str, Any]]) -> dict[str, float | None] | None:
    counts = ["tp", "fp", "fn"]
    if any(not _is_number(cell.get(name)) for cell in classes.values() for name in counts):
        return None
    tp = sum(int(cell["tp"]) for cell in classes.values())
    fp = sum(int(cell["fp"]) for cell in classes.values())
    fn = sum(int(cell["fn"]) for cell in classes.values())
    precision, recall, f1 = _prf(tp, fp, fn)
    return {"precision": precision, "recall": recall, "f1": f1}


# 公开纯函数
def compute_multiclass_averages(per_class: dict, support: dict, average: str) -> dict[str, Any]:
    """按 macro / micro / weighted 汇总类别级指标；average='none' 返回类别原值。"""
    classes = _normalize_per_class(per_class)
    if classes is None:
        return _unsupported("per_class 为空或结构不符合要求，无法汇总类别指标。",
                            inputs={"per_class": per_class, "support": support, "average": average})
    supports = _normalize_support(support, classes)
    macro = _macro_average(classes)
    weighted = _weighted_average(classes, supports)
    micro = _micro_average(classes)
    all_averages: dict[str, Any] = {"macro": macro, "weighted": weighted}
    if micro is not None:
        all_averages["micro"] = micro

    mode = average.strip().lower() if isinstance(average, str) else "macro"
    if mode in ("none", "no", "per_class", "raw"):
        return _finalize({
            "supported": True, "value": None,
            "values": {label: {m: cell.get(m) for m in ("precision", "recall", "f1")}
                       for label, cell in classes.items()},
            "formula": "average=none：返回各类别原始 precision/recall/f1。",
            "inputs": {"average": mode, "per_class": classes, "support": supports},
            "note": "未做平均，value 置空。", "method": _METHOD,
            "all_averages": all_averages,
        })

    chosen = all_averages.get(mode)
    if chosen is None:
        return _unsupported(
            f"无法计算 {mode} 平均：micro 口径需要每个类别的 tp/fp/fn 计数。",
            inputs={"average": mode, "support": supports}, all_averages=all_averages,
        )
    formulas = {
        "macro": "macro = mean(metric_c)，各类别等权。",
        "micro": "micro = sum(TP)/[sum(TP)+sum(FP)] 等全局计数口径。",
        "weighted": "weighted = sum(support_c * metric_c) / sum(support_c)。",
    }
    return _finalize({
        "supported": True,
        "value": chosen.get("f1"),
        "values": dict(chosen),
        "formula": formulas.get(mode, ""),
        "inputs": {"average": mode, "per_class": classes, "support": supports},
        "note": "按公开公式汇总；宏/微/加权口径可能给出不同数值。",
        "method": _METHOD,
        "all_averages": all_averages,
        "average": mode,
    })


def compute_classification_metrics(
    y_true: Any,
    y_pred: Any,
    y_score: Any = None,
    average: str = "macro",
    labels: Any = None,
) -> dict[str, Any]:
    """从样本级真值/预测重算 accuracy、类别级 P/R/F1 及 macro/micro/weighted 平均。"""
    actuals, predictions = _list(y_true), _list(y_pred)
    if not actuals or not predictions:
        return _unsupported("y_true / y_pred 为空，无法重算分类指标。")
    if len(actuals) != len(predictions):
        return _unsupported("y_true 与 y_pred 长度不一致，无法逐样本对齐重算。",
                            inputs={"n_y_true": len(actuals), "n_y_pred": len(predictions)})

    class_labels = _sorted_unique(labels) if labels is not None else _sorted_unique(
        list(dict.fromkeys(actuals + predictions))
    )
    if not class_labels:
        return _unsupported("标签集合为空，无法重算分类指标。")
    table = _confusion_table(actuals, predictions, class_labels)
    support = {label: cell["support"] for label, cell in table.items()}
    correct = sum(1 for a, p in zip(actuals, predictions) if a == p)
    accuracy = correct / len(actuals)

    averages: dict[str, Any] = {}
    for mode in ("macro", "micro", "weighted"):
        averages[mode] = compute_multiclass_averages(table, support, mode)

    positive_label = None
    if len(class_labels) == 2:
        positive_label = class_labels[-1]
        pos = table[_key(positive_label)]
        averages["binary"] = {
            "precision": pos["precision"], "recall": pos["recall"], "f1": pos["f1"],
        }

    mode = average.strip().lower() if isinstance(average, str) else "macro"
    if mode == "binary":
        if positive_label is None:
            return _unsupported("binary 口径需要恰好两个类别。", inputs={"n_classes": len(class_labels)})
        chosen: dict[str, Any] = dict(averages["binary"])
    elif mode in averages:
        chosen = dict(averages[mode].get("values", {}))
    else:
        return _unsupported(f"不支持的平均方式：{average!r}。",
                            inputs={"average": average, "supported_averages": list(averages)})

    values = {
        "accuracy": accuracy,
        "precision": chosen.get("precision"),
        "recall": chosen.get("recall"),
        "f1": chosen.get("f1"),
        "per_class": table,
        "macro": averages["macro"].get("values", {}),
        "micro": averages["micro"].get("values", {}),
        "weighted": averages["weighted"].get("values", {}),
        "binary": averages.get("binary"),
        "correct": correct,
        "total": len(actuals),
    }
    note = (
        "按 TP/FP/FN/TN 逐类重算；accuracy=correct/total；"
        "macro 等权、micro 全局计数、weighted 按 support 加权。"
    )
    if y_score is not None:
        note += " 本函数只重算分类计数指标，AUC/PR-AUC 请使用 compute_roc_auc / compute_pr_auc。"
    return _finalize({
        "supported": True,
        "value": chosen.get("f1"),
        "values": values,
        "formula": "P_c=TP_c/(TP_c+FP_c), R_c=TP_c/(TP_c+FN_c), F1_c=2P_cR_c/(P_c+R_c), accuracy=correct/N。",
        "inputs": {
            "n_samples": len(actuals), "labels": class_labels, "average": mode,
            "y_true": actuals, "y_pred": predictions,
        },
        "note": note,
        "method": _METHOD,
        "average": mode,
        "n_classes": len(class_labels),
        "binary_positive_label": positive_label,
        "support": support,
        "all_averages": {name: item.get("values", {}) for name, item in averages.items()
                         if isinstance(item, dict)},
    })


def _binary_auc_from_ordered(scores: list[float], positives: list[int]) -> float | None:
    """Mann-Whitney U 排序法：并列分数取平均秩，无需 scipy。"""
    n_pos = sum(positives)
    n_neg = len(positives) - n_pos
    if n_pos == 0 or n_neg == 0:
        return None
    pairs = sorted(zip(scores, positives), key=lambda item: item[0])
    rank_sum = 0.0
    index = 0
    while index < len(pairs):
        end = index
        while end + 1 < len(pairs) and pairs[end + 1][0] == pairs[index][0]:
            end += 1
        average_rank = ((index + 1) + (end + 1)) / 2.0
        for cursor in range(index, end + 1):
            if pairs[cursor][1] == 1:
                rank_sum += average_rank
        index = end + 1
    auc = (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return min(1.0, max(0.0, auc))


def _score_columns(
    y_true: list[Any], y_score: Any, labels: list[Any]
) -> dict[str, list[float]] | None:
    """把 1D 正类分数 / 2D 各类分数 / {label: scores} 统一为按标签索引的列。"""
    if isinstance(y_score, dict):
        columns: dict[str, list[float]] = {}
        for label, values in y_score.items():
            parsed = [_as_float(v) for v in _list(values)]
            if any(v is None for v in parsed) or len(parsed) != len(y_true):
                return None
            columns[_key(label)] = [float(v) for v in parsed]
        return columns or None

    rows = _list(y_score)
    if not rows or len(rows) != len(y_true):
        return None
    if isinstance(rows[0], (list, tuple)):
        columns = {}
        for index, label in enumerate(labels):
            parsed = [_as_float(row[index]) for row in rows if isinstance(row, (list, tuple)) and index < len(row)]
            if len(parsed) != len(y_true) or any(v is None for v in parsed):
                return None
            columns[_key(label)] = [float(v) for v in parsed]
        return columns or None

    parsed = [_as_float(v) for v in rows]
    if any(v is None for v in parsed):
        return None
    positive = labels[-1] if len(labels) == 2 else (labels[0] if labels else None)
    if positive is None:
        return None
    return {_key(positive): [float(v) for v in parsed]}


def _auc_values(
    y_true: list[Any], y_score: Any, labels: list[Any], average: str, rectifier: Any
) -> dict[str, Any]:
    columns = _score_columns(y_true, y_score, labels)
    if columns is None:
        return _unsupported("y_score 需为等长数值序列、2D 类分数矩阵或 {label: scores} 映射。",
                            inputs={"n_samples": len(y_true), "n_classes": len(labels)})
    per_class: dict[str, float | None] = {}
    supports: dict[str, int] = {}
    for label in labels:
        key = _key(label)
        scores = columns.get(key)
        if scores is None:
            continue
        binary = [1 if actual == label else 0 for actual in y_true]
        per_class[key] = rectifier(scores, binary)
        supports[key] = sum(binary)

    available = {k: v for k, v in per_class.items() if v is not None}
    if not available:
        return _unsupported("每个类别都需要同时存在正样本与负样本，当前无法计算 AUC。",
                            inputs={"per_class": per_class})
    mode = average.strip().lower() if isinstance(average, str) else "macro"
    if mode == "weighted":
        total = sum(supports[k] for k in available)
        value = sum(available[k] * supports[k] for k in available) / total if total > 0 else 0.0
    else:
        value = sum(available.values()) / len(available)
        mode = "macro"
    return {
        "supported": True,
        "value": value,
        "values": {"per_class": per_class, mode: value},
        "formula": "per-class AUC 后按 macro（等权）或 weighted（support 加权）汇总。",
        "inputs": {"n_samples": len(y_true), "n_classes": len(labels), "average": mode, "labels": labels},
        "note": "OVR 逐类二值化后汇总；类别数与平均策略需与论文声明一致。",
        "method": _METHOD,
        "average": mode,
        "per_class": per_class,
    }


def compute_roc_auc(
    y_true: Any, y_score: Any, multi_class: str = "ovr", average: str = "macro", labels: Any = None
) -> dict[str, Any]:
    """二分类 perfect/random 及多分类 OVR ROC-AUC，使用纯 Python 排序法。"""
    actuals = _list(y_true)
    if not actuals:
        return _unsupported("y_true 为空，无法重算 ROC-AUC。")
    class_labels = _sorted_unique(labels) if labels is not None else _sorted_unique(actuals)
    if not class_labels:
        return _unsupported("标签集合为空，无法重算 ROC-AUC。")

    mode = multi_class.strip().lower() if isinstance(multi_class, str) else "ovr"
    result = _auc_values(actuals, y_score, class_labels, average, _binary_auc_from_ordered)
    if not result.get("supported"):
        return _finalize(result)

    if len(class_labels) > 2 and mode == "ovo":
        columns = _score_columns(actuals, y_score, class_labels)
        pair_scores: list[float] = []
        for i, first in enumerate(class_labels):
            for second in class_labels[i + 1:]:
                selected = [idx for idx, value in enumerate(actuals) if value in (first, second)]
                if not selected:
                    continue
                diff = [
                    columns[_key(first)][idx] - columns[_key(second)][idx]
                    for idx in selected
                ] if columns and _key(first) in columns and _key(second) in columns else None
                if diff is None:
                    continue
                binary = [1 if actuals[idx] == first else 0 for idx in selected]
                pair_auc = _binary_auc_from_ordered(diff, binary)
                if pair_auc is not None:
                    pair_scores.append(pair_auc)
        if pair_scores:
            value = sum(pair_scores) / len(pair_scores)
            result["value"] = value
            result["values"]["ovo"] = value
            result["values"]["per_pair"] = pair_scores
            result["average"] = "ovo"
            result["formula"] = "ovo = mean(AUC(a,b))，各类对按 a 类为正类。"

    result["formula"] = "AUC = [sum(rank_pos) - n_pos(n_pos+1)/2] / (n_pos*n_neg)，并列取平均秩。"
    result["inputs"]["multi_class"] = mode
    result["method"] = "mann_whitney_rank_auc_v1"
    result["note"] = (
        f"类别数={len(class_labels)}，使用 {'ovr' if mode != 'ovo' else 'ovo'} 口径；"
        "数值一致不代表实验条件相同。"
    )
    return _finalize(result)


def _average_precision(scores: list[float], positives: list[int]) -> float:
    """sklearn average_precision_score 口径：按分数降序、并列分数同一阈值。"""
    n_pos = sum(positives)
    if n_pos == 0:
        return 0.0
    pairs = sorted(zip(scores, positives), key=lambda item: item[0], reverse=True)
    tp = fp = 0
    previous_recall = 0.0
    total = 0.0
    index = 0
    while index < len(pairs):
        end = index
        while end + 1 < len(pairs) and pairs[end + 1][0] == pairs[index][0]:
            end += 1
        for cursor in range(index, end + 1):
            if pairs[cursor][1] == 1:
                tp += 1
            else:
                fp += 1
        recall = tp / n_pos
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0.0
        total += (recall - previous_recall) * precision
        previous_recall = recall
        index = end + 1
    return min(1.0, max(0.0, total))


def compute_pr_auc(y_true: Any, y_score: Any, average: str = "macro", labels: Any = None) -> dict[str, Any]:
    """PR-AUC（average precision）：二分类与多分类 OVR 汇总，纯 Python 实现。"""
    actuals = _list(y_true)
    if not actuals:
        return _unsupported("y_true 为空，无法重算 PR-AUC。")
    class_labels = _sorted_unique(labels) if labels is not None else _sorted_unique(actuals)
    result = _auc_values(actuals, y_score, class_labels, average, _average_precision)
    if not result.get("supported"):
        return _finalize(result)
    result["formula"] = "AP = sum_k (R_k - R_{k-1}) * P_k，按分数降序、并列分数同一阈值。"
    result["method"] = "average_precision_v1"
    result["note"] = "PR-AUC 采用 average precision 口径；正类比例会影响数值上限。"
    return _finalize(result)


def compute_regression_metrics(y_true: Any, y_pred: Any) -> dict[str, Any]:
    """重算 RMSE / MAE / R²，并显式给出 SS_tot 定义与分母口径。"""
    actuals_raw, predictions_raw = _list(y_true), _list(y_pred)
    if not actuals_raw or not predictions_raw:
        return _unsupported("y_true / y_pred 为空，无法重算回归指标。")
    if len(actuals_raw) != len(predictions_raw):
        return _unsupported("y_true 与 y_pred 长度不一致，无法逐样本对齐重算。")
    actuals = [_as_float(v) for v in actuals_raw]
    predictions = [_as_float(v) for v in predictions_raw]
    if any(v is None for v in actuals + predictions):
        return _unsupported("回归指标需要数值型 y_true / y_pred，存在非数值项。")
    actuals = [float(v) for v in actuals]
    predictions = [float(v) for v in predictions]
    n = len(actuals)
    residuals = [a - p for a, p in zip(actuals, predictions)]
    ss_res = sum(r * r for r in residuals)
    mean_y = sum(actuals) / n
    ss_tot = sum((a - mean_y) ** 2 for a in actuals)
    ss_zero = sum(a * a for a in actuals)

    mse = ss_res / n
    rmse = math.sqrt(mse)
    mae = sum(abs(r) for r in residuals) / n
    r2 = 1.0 - ss_res / ss_tot if ss_tot > _EPS else None
    r2_zero = 1.0 - ss_res / ss_zero if ss_zero > _EPS else None
    notes = [
        "RMSE=sqrt(SS_res/n)，MAE=sum|y_true-y_pred|/n，两者分母均为样本数 n。",
        "R² 的 SS_tot=sum((y_true-mean(y_true))^2)，以真值均值为 baseline。",
    ]
    if r2 is None:
        notes.append("SS_tot=0（y_true 为常数），R² 未定义，value 置空。")
    if r2_zero is not None and r2 is not None and abs(r2_zero - r2) > 1e-9:
        notes.append("另有以 0 为 baseline 的 R²（r2_zero_baseline），与均值 baseline 口径不同。")
    return _finalize({
        "supported": True,
        "value": r2,
        "values": {
            "rmse": rmse, "mae": mae, "r2": r2, "mse": mse,
            "ss_res": ss_res, "ss_tot": ss_tot,
            "r2_zero_baseline": r2_zero, "mean_y_true": mean_y,
        },
        "formula": "RMSE=sqrt(SS_res/n); MAE=sum|y-p|/n; R²=1-SS_res/SS_tot, SS_tot=sum((y-mean(y))^2)。",
        "inputs": {
            "n_samples": n, "y_true": actuals, "y_pred": predictions,
            "ss_tot_definition": "sum((y_true - mean(y_true))^2)",
            "denominator": n,
        },
        "note": " ".join(notes),
        "method": "ml_metrics_regression_v1",
    })


def _from_confusion_counts(tp: Any, fp: Any, fn: Any, tn: Any = None) -> dict[str, Any]:
    """由 TP/FP/FN(/TN) 计数构造与样本级函数一致的结果结构。"""
    values = [v for v in (tp, fp, fn) if not _is_number(v)]
    if values:
        return _unsupported("tp/fp/fn 必须是非负有限数值。")
    t, p, n = max(0, int(tp)), max(0, int(fp)), max(0, int(fn))
    has_tn = _is_number(tn)
    neg_tn = max(0, int(tn)) if has_tn else 0
    positive = _class_cell(t, p, n, neg_tn)
    labels = [0, 1]
    support = {"0": neg_tn + p, "1": t + n}
    classes: dict[str, dict[str, Any]] = {"1": positive}
    if has_tn:
        classes["0"] = _class_cell(neg_tn, n, p, t)
    averages = {mode: compute_multiclass_averages(classes, support, mode)
                for mode in ("macro", "micro", "weighted")}
    prec, rec, f1 = _prf(t, p, n)
    binary = {"precision": prec, "recall": rec, "f1": f1}
    accuracy = (t + neg_tn) / (t + p + n + neg_tn) if has_tn and (t + p + n + neg_tn) > 0 else None
    note = "从 TP/FP/FN 计数重算二分类指标。" if not has_tn else "从完整混淆矩阵重算二分类及多口径平均。"
    return _finalize({
        "supported": True,
        "value": f1,
        "values": {
            "precision": prec, "recall": rec, "f1": f1, "accuracy": accuracy,
            "per_class": classes, "binary": binary,
            "macro": averages["macro"].get("values", {}),
            "micro": averages["micro"].get("values", {}),
            "weighted": averages["weighted"].get("values", {}),
            "tp": t, "fp": p, "fn": n, "tn": neg_tn if has_tn else None,
            # chosen 仅供 precision/recall/f1 单一指标提取使用，固定取正类二分类口径；
            # macro/micro/weighted 仍完整保留在 values / all_averages 中供平均口径审计。
            "chosen": binary,
        },
        "formula": "P=TP/(TP+FP), R=TP/(TP+FN), F1=2PR/(P+R), accuracy=(TP+TN)/N。",
        "inputs": {"tp": t, "fp": p, "fn": n, "tn": neg_tn if has_tn else None},
        "note": note,
        "method": _METHOD,
        "n_classes": 2,
        "binary_positive_label": 1,
        "labels": labels,
        "support": support,
        "all_averages": {name: item.get("values", {}) for name, item in averages.items()},
    })


def recompute_metric(name: str, **kwargs: Any) -> dict[str, Any]:
    """按指标名称分发的统一重算入口；不支持或字段缺失时 supported=False。"""
    metric = _canonical(name)
    if metric not in SUPPORTED_METRICS:
        return _unsupported(
            f"不支持的指标 {name!r}；本层支持：{', '.join(SUPPORTED_METRICS)}。",
            metric=metric, inputs={"name": name},
        )
    y_true = kwargs.get("y_true")
    y_pred = kwargs.get("y_pred")
    y_score = kwargs.get("y_score")
    labels = kwargs.get("labels")
    raw_average = kwargs.get("average")

    if metric in ("rmse", "mae", "r2"):
        result = compute_regression_metrics(y_true, y_pred)
    elif metric in ("roc_auc", "pr_auc"):
        if metric == "roc_auc":
            result = compute_roc_auc(y_true, y_score,
                                     multi_class=kwargs.get("multi_class", "ovr"),
                                     average=raw_average or "macro", labels=labels)
        else:
            result = compute_pr_auc(y_true, y_score, average=raw_average or "macro", labels=labels)
    else:
        has_counts = all(key in kwargs for key in ("tp", "fp", "fn"))
        if has_counts:
            result = _from_confusion_counts(kwargs["tp"], kwargs["fp"], kwargs["fn"], kwargs.get("tn"))
        elif kwargs.get("correct") is not None and kwargs.get("total") is not None:
            correct, total = _as_float(kwargs.get("correct")), _as_float(kwargs.get("total"))
            if correct is None or total is None or total <= 0:
                result = _unsupported("correct/total 口径需要 total>0 的有限数值。")
            else:
                accuracy = min(1.0, max(0.0, correct / total))
                result = _finalize({
                    "supported": True, "value": accuracy,
                    "values": {"accuracy": accuracy, "correct": correct, "total": total},
                    "formula": "accuracy=correct/total。",
                    "inputs": {"correct": correct, "total": total},
                    "note": "从 correct/total 重算 accuracy。", "method": _METHOD,
                })
        else:
            if not _list(y_true) or not _list(y_pred):
                return _unsupported(
                    f"重算 {metric} 需要 y_true/y_pred 或 tp/fp/fn 计数字段，当前不完整。",
                    metric=metric,
                    inputs={k: v for k, v in kwargs.items() if k in ("average", "labels", "multi_class")},
                )
            mode = raw_average
            if mode is None and len(_sorted_unique(labels) if labels is not None
                                    else _sorted_unique(list(_list(y_true)) + list(_list(y_pred)))) == 2:
                mode = "binary"
            result = compute_classification_metrics(y_true, y_pred,
                                                    y_score=y_score,
                                                    average=mode or "macro", labels=labels)

    if not result.get("supported"):
        result["metric"] = metric
        return _finalize(result)

    values = result.get("values", {})
    if metric == "accuracy":
        result["value"] = values.get("accuracy")
    elif metric in ("rmse", "mae", "r2"):
        result["value"] = values.get(metric)
    elif metric in ("precision", "recall", "f1"):
        chosen = values.get("chosen") if "chosen" in values else values
        result["value"] = chosen.get(metric) if isinstance(chosen, dict) else None
        if result["value"] is None:
            result["value"] = values.get(metric)
    else:
        average_key = {"macro_f1": "macro", "micro_f1": "micro", "weighted_f1": "weighted"}.get(metric)
        if average_key:
            source = values.get("all_averages", values).get(average_key, {})
            result["value"] = source.get("f1") if isinstance(source, dict) else None
    result["metric"] = metric
    result["inputs"] = dict(result.get("inputs", {}))
    result["inputs"]["metric"] = metric
    return _finalize(result)


def audit_metric_claims(payload: dict) -> dict[str, Any]:
    """逐条对比论文/报告值与按公开公式重算值，给出可复算的对比明细。"""
    data = payload if isinstance(payload, dict) else {}
    dataset = data.get("dataset") if isinstance(data.get("dataset"), dict) else data
    tolerance = _as_float(data.get("tolerance", 0.01))
    if tolerance is None or tolerance < 0:
        tolerance = 0.01

    raw_claims = data.get("claims", [])
    if isinstance(raw_claims, dict):
        claims = [{"metric": key, "claimed": value} for key, value in raw_claims.items()]
    else:
        claims = [item for item in _list(raw_claims) if isinstance(item, dict)]

    comparisons: list[dict[str, Any]] = []
    for claim in claims:
        metric = _canonical(claim.get("metric", claim.get("name")))
        claimed = _as_float(claim.get("claimed", claim.get("reported", claim.get("value"))))
        kwargs: dict[str, Any] = {}
        for key in ("y_true", "y_pred", "y_score", "labels", "average", "multi_class",
                    "tp", "fp", "fn", "tn", "correct", "total"):
            if key in claim:
                kwargs[key] = claim[key]
            elif key in dataset:
                kwargs[key] = dataset[key]
        result = recompute_metric(metric, **kwargs)
        recomputed = _as_float(result.get("value"))
        alternatives = result.get("all_averages", result.get("values", {}))
        if isinstance(alternatives, dict):
            alternatives = {k: v for k, v in alternatives.items()
                            if k in ("macro", "micro", "weighted", "binary") and isinstance(v, dict)}
        else:
            alternatives = {}

        if not result.get("supported") or recomputed is None:
            status, abs_diff, note = "insufficient", None, result.get("note", "证据不足。")
        elif claimed is None:
            status, abs_diff, note = "insufficient", None, "报告值缺失，无法对比。"
        else:
            abs_diff = abs(recomputed - claimed)
            if abs_diff <= tolerance + 1e-12:
                status = "consistent"
                note = f"绝对差值 {abs_diff:.6f} 不超过容差 {tolerance}，数值一致。"
            else:
                status = "inconsistent"
                note = f"绝对差值 {abs_diff:.6f} 超过容差 {tolerance}，数值不一致。"
        comparisons.append(_finalize({
            "metric": metric or str(claim.get("metric", "")),
            "claimed": claimed,
            "recomputed": recomputed,
            "abs_diff": abs_diff,
            "tolerance": tolerance,
            "status": status,
            "average": kwargs.get("average"),
            "holdout": claim.get("holdout", claim.get("split")),
            "source": claim.get("source", "paper"),
            "method": claim.get("method"),
            "alternatives": alternatives,
            "supported": bool(result.get("supported")),
            "note": _guard_text(note),
            "recompute": result,
        }))

    counts = {
        "total": len(comparisons),
        "consistent": sum(c["status"] == "consistent" for c in comparisons),
        "inconsistent": sum(c["status"] == "inconsistent" for c in comparisons),
        "insufficient": sum(c["status"] == "insufficient" for c in comparisons),
    }
    note = "报告值与重算值按绝对容差对比；数值一致不代表实验条件相同。"
    if not comparisons:
        note = "未提供任何可对比的指标报告值，无法判断定义正确性。"
    return _finalize({
        "supported": bool(comparisons),
        "value": None,
        "values": {"comparisons": comparisons, "counts": counts},
        "formula": "|recomputed - claimed| <= tolerance 记为 consistent，否则记为 inconsistent。",
        "inputs": {"tolerance": tolerance, "n_claims": len(claims)},
        "note": note,
        "method": "metric_claim_comparison_v1",
    })


def detect_split_mismatch(payload: dict) -> dict[str, Any]:
    """检查 train/val/test 样本数口径、划分重叠与“验证集数值作测试结论”。"""
    data = payload if isinstance(payload, dict) else {}
    dataset = data.get("dataset") if isinstance(data.get("dataset"), dict) else {}
    splits = data.get("split") or data.get("splits") or data.get("dataset_splits") or dataset.get("split") or dataset.get("splits")
    splits = splits if isinstance(splits, dict) else {}
    reported_holdout = data.get("reported_holdout", dataset.get("reported_holdout"))
    claims = data.get("claims", [])
    claims = [item for item in _list(claims) if isinstance(item, dict)]

    count_mismatches: list[dict[str, Any]] = []
    normalized: dict[str, Any] = {}
    for name, info in splits.items():
        info = info if isinstance(info, dict) else {"sample_count": info}
        actual = info.get("sample_count", info.get("n_samples", info.get("count")))
        claimed = info.get("claimed_count", info.get("claimed_sample_count", info.get("claimed")))
        normalized[str(name)] = {"sample_count": actual, "claimed_count": claimed}
        if _is_number(actual) and _is_number(claimed) and abs(float(actual) - float(claimed)) > _EPS:
            count_mismatches.append({
                "split": str(name), "sample_count": actual, "claimed_count": claimed,
                "abs_diff": abs(float(actual) - float(claimed)),
            })

    overlaps: list[dict[str, Any]] = []
    for name, info in splits.items():
        if not isinstance(info, dict):
            continue
        for other, value in info.items():
            if "overlap" in str(other).lower() and _is_number(value) and float(value) > 0:
                overlaps.append({"split": str(name), "field": str(other), "value": value})

    val_as_test: list[dict[str, Any]] = []
    if str(reported_holdout).strip().lower() in ("test", "testing", "测试集"):
        for claim in claims:
            holdout = claim.get("holdout", claim.get("split"))
            if str(holdout).strip().lower() in ("val", "validation", "valid", "验证集"):
                val_as_test.append({
                    "metric": claim.get("metric"), "claimed": claim.get("claimed", claim.get("value")),
                    "holdout": holdout, "reported_holdout": reported_holdout,
                })

    selection_on_test = str(data.get("selection_split", dataset.get("selection_split", ""))).strip().lower() in (
        "test", "testing", "测试集"
    )
    has_signal = bool(count_mismatches or overlaps or val_as_test or selection_on_test)
    if not splits and not claims:
        note = "未提供划分样本数或指标来源标记，无法核对划分口径。"
    elif has_signal:
        note = "发现样本数口径差异、划分重叠或指标来源与报告口径不同，建议人工复核。"
    else:
        note = "划分样本数与报告值一致，未发现验证集数值作测试结论的来源标记。"
    return _finalize({
        "supported": bool(splits or claims),
        "value": len(count_mismatches) + len(overlaps) + len(val_as_test) + int(selection_on_test),
        "values": {
            "splits": normalized,
            "count_mismatches": count_mismatches,
            "overlaps": overlaps,
            "val_as_test": val_as_test,
            "selection_on_test": selection_on_test,
            "reported_holdout": reported_holdout,
        },
        "formula": "逐划分比较 sample_count 与 claimed_count；来源标记为 val 且报告口径为 test 时记为 val_as_test。",
        "inputs": {"n_splits": len(splits), "reported_holdout": reported_holdout, "n_claims": len(claims)},
        "note": note,
        "method": "split_mismatch_check_v1",
    })


# 审计主入口
def _evidence(
    source: str,
    claimed: dict[str, Any] | None = None,
    recomputed: dict[str, Any] | None = None,
    formula: str = "",
    inputs: dict[str, Any] | None = None,
    method: str = "",
    note: str = "",
) -> dict[str, Any]:
    item = Evidence(
        source=source,
        claimed=claimed or {},
        recomputed=recomputed or {},
        formula=formula,
        inputs=inputs or {},
        method=method,
        note=note,
    )
    return _finalize(item.to_dict())


def _finding(
    rule_id: str,
    verdict: str,
    message: str,
    evidence: list[dict[str, Any]],
    justification: str,
    suggestion: str,
    confidence: str = "medium",
    affects: str = "all",
) -> dict[str, Any]:
    rule = get_rule(rule_id)
    return {
        "rule_id": rule_id,
        "rule_name": rule.name if rule else rule_id,
        "verdict": verdict,
        "category": "ml_metrics",
        "message": _guard_text(message),
        "evidence": evidence,
        "justification": _guard_text(justification),
        "suggestion": _guard_text(suggestion),
        "confidence": confidence,
        "affects": affects,
    }


def _insufficient(rule_id: str, reason: str) -> dict[str, Any]:
    return _finding(
        rule_id, Verdict.INSUFFICIENT_EVIDENCE.value,
        f"{get_rule(rule_id).name if get_rule(rule_id) else rule_id}：{reason}，当前证据不足。",
        [_evidence("input", note=reason)],
        "缺少可复算的输入或报告值，不做推断。",
        "补充原始样本、报告值与计算口径后重跑审计。",
        confidence="low", affects="unknown",
    )


def _extract_dataset(data: dict[str, Any]) -> dict[str, Any]:
    dataset = data.get("dataset") if isinstance(data.get("dataset"), dict) else {}
    merged = dict(dataset)
    for key in ("y_true", "y_pred", "y_score", "labels", "task_type"):
        if key not in merged and key in data:
            merged[key] = data[key]
    return merged


def _build_computations(data: dict[str, Any]) -> dict[str, Any]:
    dataset = _extract_dataset(data)
    task_type = str(dataset.get("task_type", data.get("task_type", ""))).strip().lower()
    computations: dict[str, Any] = {}
    y_true, y_pred, y_score = dataset.get("y_true"), dataset.get("y_pred"), dataset.get("y_score")
    if _list(y_true) and _list(y_pred):
        if task_type == "regression":
            computations["regression"] = compute_regression_metrics(y_true, y_pred)
        else:
            computations["classification"] = compute_classification_metrics(
                y_true, y_pred, y_score=y_score,
                average=data.get("average", "macro"), labels=dataset.get("labels"),
            )
            if _list(y_score):
                computations["roc_auc"] = compute_roc_auc(
                    y_true, y_score,
                    multi_class=data.get("multi_class", "ovr"),
                    average=data.get("auc_average", "macro"), labels=dataset.get("labels"),
                )
                computations["pr_auc"] = compute_pr_auc(
                    y_true, y_score, average=data.get("auc_average", "macro"),
                    labels=dataset.get("labels"),
                )
    return computations


def audit(payload: dict) -> dict[str, Any]:
    """机器学习指标审计总入口：返回 findings / computations / notes 三个键。"""
    data = payload if isinstance(payload, dict) else {}
    notes: list[str] = [BOUNDARY_NOTE]
    computations = _build_computations(data)
    claims_result = audit_metric_claims(data)
    split_result = detect_split_mismatch(data)
    computations["claim_comparison"] = claims_result
    computations["split_mismatch"] = split_result

    comparisons = claims_result["values"]["comparisons"]
    classification = computations.get("classification", {})
    regression = computations.get("regression", {})

    # MET-001 指标定义正确性
    inconsistent = [c for c in comparisons if c["status"] == "inconsistent"]
    if inconsistent:
        evidence = [_evidence(
            "paper",
            claimed={c["metric"]: c["claimed"] for c in inconsistent},
            recomputed={c["metric"]: c["recomputed"] for c in inconsistent},
            formula="|recomputed-claimed| <= tolerance",
            inputs={"tolerance": claims_result["inputs"]["tolerance"]},
            method=claims_result["method"],
            note="报告值与按公开公式重算值的绝对差值超过容差。",
        )]
        findings_met001 = [_finding(
            "MET-001", Verdict.CALCULATION_ERROR.value,
            f"{len(inconsistent)} 项指标报告值与重算值的绝对差值超过容差。",
            evidence, "按公开公式重算后与报告值不一致。",
            "核对原始样本、指标定义与舍入方式。", confidence="high",
        )]
    elif any(c["status"] == "consistent" for c in comparisons):
        evidence = [_evidence(
            "paper",
            claimed={c["metric"]: c["claimed"] for c in comparisons if c["status"] == "consistent"},
            recomputed={c["metric"]: c["recomputed"] for c in comparisons if c["status"] == "consistent"},
            formula="|recomputed-claimed| <= tolerance",
            method=claims_result["method"],
        )]
        findings_met001 = [_finding(
            "MET-001", Verdict.VERIFIED.value,
            "可对比的指标报告值与按公开公式重算值一致。",
            evidence, "在给定容差内未发现数值差异。",
            "保留原始样本与代码版本以便复核。", confidence="high",
        )]
    else:
        findings_met001 = [_insufficient("MET-001", "没有可比对的报告值与重算值")]

    # MET-002 类别平均方式一致性
    avg_claims = [c for c in comparisons if c.get("average") in ("macro", "micro", "weighted")]
    declared_mismatch: list[dict[str, Any]] = []
    ambiguous: list[dict[str, Any]] = []
    declared_ok = 0
    for comp in avg_claims:
        declared = str(comp["average"]).lower()
        claimed = comp.get("claimed")
        alternatives = comp.get("alternatives", {})
        if claimed is None or declared not in alternatives:
            continue
        matches = [mode for mode, payload in alternatives.items()
                   if _as_float(payload.get("f1")) is not None
                   and abs(float(payload["f1"]) - float(claimed)) <= claims_result["inputs"]["tolerance"] + 1e-12]
        if declared in matches:
            declared_ok += 1
        elif matches:
            (ambiguous if len(matches) > 1 else declared_mismatch).append({
                "metric": comp["metric"], "declared": declared,
                "recomputed": comp.get("recomputed"), "matching_averages": matches,
                "claimed": claimed,
            })
    if declared_mismatch or ambiguous:
        finding_verdict = (Verdict.POTENTIAL_BIAS.value if ambiguous and not declared_mismatch
                           else Verdict.METHOD_INAPPLICABLE.value)
        all_mismatch = declared_mismatch + ambiguous
        findings_met002 = [_finding(
            "MET-002", finding_verdict,
            f"{len(all_mismatch)} 项指标声明的平均口径与数值相符的口径不一致。",
            [_evidence("paper", claimed={"declared": [x["declared"] for x in all_mismatch]},
                       recomputed={"matching_averages": [x["matching_averages"] for x in all_mismatch]},
                       formula="比较 claimed 与 macro/micro/weighted 各口径重算值",
                       method="multiclass_average_check_v1")],
            "声明口径下的重算值与报告值不同，其他平均口径下存在数值相符项。",
            "核对论文中 macro/micro/weighted 的声明与实现代码。",
        )]
    elif classification.get("supported") and declared_ok:
        findings_met002 = [_finding(
            "MET-002", Verdict.VERIFIED.value,
            "声明的平均口径与数值相符的口径一致。",
            [_evidence("input", recomputed=classification.get("all_averages", {}),
                       formula="macro / micro / weighted 公开汇总公式",
                       method=classification.get("method", ""))],
            "未发现声明口径与数值口径的差异。",
            "保留类别级 support 以便复核。",
        )]
    else:
        findings_met002 = [_insufficient("MET-002", "缺少平均口径声明或类别级重算结果")]

    # MET-003 二分类与多分类混淆
    auc_claims = [c for c in comparisons if c["metric"] in ("roc_auc", "pr_auc")]
    n_classes = classification.get("n_classes")
    if n_classes is None and _list(_extract_dataset(data).get("y_true")):
        n_classes = len(_sorted_unique(_extract_dataset(data)["y_true"]))
    binary_styled = [
        c for c in auc_claims
        if str(c.get("method") or "").lower() in ("binary", "binary_roc_auc", "binary_auc")
        or str(c.get("average") or "").lower() == "binary"
    ]
    undeclared_multiclass_auc = [
        c for c in auc_claims if c.get("average") is None and c.get("method") is None
    ]
    if isinstance(n_classes, int) and n_classes > 2 and (binary_styled or undeclared_multiclass_auc):
        findings_met003 = [_finding(
            "MET-003", Verdict.METHOD_INAPPLICABLE.value,
            f"类别数为 {n_classes} 的 AUC 报告缺少多分类平均口径声明。",
            [_evidence("paper", claimed=[{"metric": c["metric"], "claimed": c["claimed"],
                                          "method": c.get("method"), "average": c.get("average")}
                                         for c in binary_styled + undeclared_multiclass_auc],
                       recomputed={"n_classes": n_classes,
                                   "roc_auc": computations.get("roc_auc", {}).get("values", {}),
                                   "pr_auc": computations.get("pr_auc", {}).get("values", {})},
                       formula="多分类 AUC 需 OVR/OVO 与 macro/weighted 声明",
                       method="multiclass_auc_scope_check_v1")],
            "多分类任务未给出与二分类口径区分的平均策略，二分类 AUC 口径不适用。",
            "补充多分类平均方式、每类分数矩阵与正类定义。",
            confidence="high",
        )]
    elif isinstance(n_classes, int) and n_classes > 2 and auc_claims:
        findings_met003 = [_finding(
            "MET-003", Verdict.VERIFIED.value,
            f"类别数为 {n_classes} 的 AUC 报告带有平均口径信息。",
            [_evidence("paper", claimed=[{"metric": c["metric"], "average": c.get("average")}
                                         for c in auc_claims])],
            "报告含有多分类 AUC 的口径信息。",
            "核对分数矩阵的类顺序与论文标签顺序。",
        )]
    else:
        findings_met003 = [_insufficient("MET-003", "缺少多分类 AUC 报告值或类别数信息")]

    # MET-004 数据集划分差异
    count_mismatches = split_result["values"]["count_mismatches"]
    overlaps = split_result["values"]["overlaps"]
    if count_mismatches or overlaps:
        findings_met004 = [_finding(
            "MET-004", Verdict.POTENTIAL_BIAS.value,
            f"发现 {len(count_mismatches)} 项样本数口径差异与 {len(overlaps)} 项划分重叠标记。",
            [_evidence("dataset", claimed={"count_mismatches": count_mismatches},
                       recomputed={"overlaps": overlaps},
                       formula="sample_count 与 claimed_count 逐划分比较",
                       method=split_result["method"])],
            "划分样本数与报告计数存在差异或重叠标记。",
            "核对数据划分脚本、样本 ID 列表与各集计数。",
            confidence="high", affects="all",
        )]
    elif split_result.get("supported"):
        findings_met004 = [_finding(
            "MET-004", Verdict.VERIFIED.value,
            "划分样本数与报告计数一致，未发现重叠标记。",
            [_evidence("dataset", recomputed=split_result["values"]["splits"],
                       method=split_result["method"])],
            "现有划分信息与报告计数相符。",
            "保留划分脚本与随机种子记录。",
        )]
    else:
        findings_met004 = [_insufficient("MET-004", "缺少 train/val/test 划分信息")]

    # MET-005 错误的指标汇总
    summary_metrics = {"accuracy", "precision", "recall", "f1",
                       "macro_f1", "micro_f1", "weighted_f1"}
    unmatched: list[dict[str, Any]] = []
    for comp in comparisons:
        if comp["status"] != "inconsistent" or comp["metric"] not in summary_metrics:
            continue
        tolerated = claims_result["inputs"]["tolerance"] + 1e-12
        claimed = comp.get("claimed")
        if claimed is None:
            continue
        key = "f1" if comp["metric"].endswith("_f1") else comp["metric"]
        candidates: list[float] = []
        for payload in comp.get("alternatives", {}).values():
            value = _as_float(payload.get(key)) if isinstance(payload, dict) else None
            if value is not None:
                candidates.append(value)
        if key == "accuracy":
            direct = _as_float(comp.get("recompute", {}).get("values", {}).get("accuracy"))
            if direct is not None:
                candidates.append(direct)
        if not any(abs(value - float(claimed)) <= tolerated for value in candidates):
            unmatched.append({"metric": comp["metric"], "claimed": comp["claimed"],
                              "recomputed": comp["recomputed"]})
    holdouts = {str(c.get("holdout")) for c in comparisons if c.get("holdout")}
    if unmatched or len(holdouts) > 1:
        findings_met005 = [_finding(
            "MET-005", Verdict.CALCULATION_ERROR.value,
            f"{len(unmatched)} 项报告值与各标准平均口径均不相符；跨划分来源标记数 {len(holdouts)}。",
            [_evidence("paper", claimed=unmatched or {"holdouts": sorted(holdouts)},
                       recomputed={"standard_averages": classification.get("all_averages", {})},
                       formula="报告值与 macro/micro/weighted/binary 全口径逐一比较",
                       method="metric_summary_check_v1")],
            "报告值与任何标准平均口径的数值均不相符，或指标来源跨越多个划分。",
            "按单一划分、单一口径重新汇总并标注来源。",
            confidence="medium",
        )]
    elif comparisons:
        findings_met005 = [_finding(
            "MET-005", Verdict.VERIFIED.value,
            "报告值与标准平均口径的对比未发现跨划分汇总异常。",
            [_evidence("paper", recomputed=claims_result["values"]["counts"],
                       method="metric_summary_check_v1")],
            "现有对比结果未出现无口径匹配项。",
            "保留各划分的指标明细。",
        )]
    else:
        findings_met005 = [_insufficient("MET-005", "缺少报告值汇总信息")]

    # MET-006 验证集指标误认为测试集
    val_as_test = split_result["values"]["val_as_test"]
    if val_as_test:
        findings_met006 = [_finding(
            "MET-006", Verdict.POTENTIAL_BIAS.value,
            f"{len(val_as_test)} 项指标来源标记为验证集，报告口径标记为测试集。",
            [_evidence("paper", claimed=val_as_test,
                       recomputed={"reported_holdout": split_result["values"]["reported_holdout"]},
                       formula="holdout=val 且 reported_holdout=test 时标记",
                       method=split_result["method"])],
            "指标来源标记与最终报告的划分标记不同。",
            "区分验证集调参结果与独立测试集结果，分别标注。",
            confidence="high", affects="test",
        )]
    elif split_result["values"]["reported_holdout"] is not None:
        findings_met006 = [_finding(
            "MET-006", Verdict.VERIFIED.value,
            "未发现验证集来源数值被标记为测试集结果。",
            [_evidence("paper", claimed={"reported_holdout": split_result["values"]["reported_holdout"]},
                       method=split_result["method"])],
            "现有来源标记与报告划分一致。",
            "保留指标来源元数据。",
        )]
    else:
        findings_met006 = [_insufficient("MET-006", "缺少指标来源与报告划分标记")]

    # MET-007 回归指标审计
    regression_claims = [c for c in comparisons if c["metric"] in ("rmse", "mae", "r2")]
    baseline_issues = [
        c for c in regression_claims
        if str(c.get("method") or "").strip().lower() in ("zero", "zero_baseline", "ss_tot_zero")
    ]
    reg_inconsistent = [c for c in regression_claims if c["status"] == "inconsistent"]
    if reg_inconsistent:
        findings_met007 = [_finding(
            "MET-007", Verdict.CALCULATION_ERROR.value,
            f"{len(reg_inconsistent)} 项回归指标报告值与重算值的绝对差值超过容差。",
            [_evidence("paper",
                       claimed={c["metric"]: c["claimed"] for c in reg_inconsistent},
                       recomputed={c["metric"]: c["recomputed"] for c in reg_inconsistent},
                       formula=regression.get("formula", "RMSE/MAE/R² 公开公式"),
                       inputs=regression.get("inputs", {}),
                       method=regression.get("method", ""))],
            "按真值与预测重算的回归指标与报告值不一致。",
            "核对残差定义、样本过滤规则与舍入方式。",
            confidence="high",
        )]
        if baseline_issues:
            findings_met007.append(_finding(
                "MET-007", Verdict.METHOD_INAPPLICABLE.value,
                "R² 报告声明的 SS_tot baseline 与真值均值 baseline 口径不同。",
                [_evidence("paper", claimed=[{"metric": c["metric"], "method": c.get("method")}
                                             for c in baseline_issues],
                           recomputed={"ss_tot_definition": regression.get("inputs", {}).get("ss_tot_definition"),
                                       "r2_zero_baseline": regression.get("values", {}).get("r2_zero_baseline")},
                           formula="R²=1-SS_res/SS_tot, SS_tot=sum((y-mean(y))^2)",
                           method="r2_baseline_check_v1")],
                "不同 baseline 的 R² 数值不可直接对比。",
                "在论文中明确 SS_tot 定义并给出对应数值。",
            ))
    elif regression.get("supported") and regression_claims:
        findings_met007 = [_finding(
            "MET-007", Verdict.VERIFIED.value,
            "回归指标报告值与按真值均值 baseline 重算的结果一致。",
            [_evidence("paper", claimed={c["metric"]: c["claimed"] for c in regression_claims},
                       recomputed=regression.get("values", {}),
                       formula=regression.get("formula", ""),
                       inputs=regression.get("inputs", {}),
                       method=regression.get("method", ""))],
            "在给定容差内未发现回归指标数值差异。",
            "保留残差明细与 SS_tot 定义。",
        )]
    else:
        findings_met007 = [_insufficient("MET-007", "缺少回归真值、预测值或回归指标报告值")]

    findings = (
        findings_met001 + findings_met002 + findings_met003 + findings_met004
        + findings_met005 + findings_met006 + findings_met007
    )
    if not comparisons:
        notes.append("未提供指标报告值：所有 MET-* 规则按证据不足处理。")
    if not computations.get("classification") and not computations.get("regression"):
        notes.append("未提供样本级真值/预测：仅完成可对比字段的形式核验。")
    notes.append("本审计只给出统计证据与人工复核建议，不构成学术不端结论。")

    return _finalize({
        "findings": findings,
        "computations": computations,
        "notes": notes,
    })
