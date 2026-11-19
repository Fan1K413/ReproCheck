"""数值重算与验证引擎分层面板（独立验证引擎第四层，纯函数）。

职责边界：
- 只按公开公式从调用方提供的原始计数重算，不读取数据库、不执行上传代码、不调用 LLM；
- 缺字段、分母为零、未知指标一律明确标记，不编造数值，也不冒充已复核；
- 分层面板把各层输出归一为统一结构，并显式标注第3层动态执行未启用。
"""
from __future__ import annotations

from typing import Any

_METHOD = "numeric_recompute"

# 五层职责定义：供统一面板与 API 说明复用（返回时一律拷贝，避免调用方误改）。
LAYER_SPECS: list[dict[str, Any]] = [
    {
        "layer": 1,
        "name": "确定性规则诊断",
        "method": "deterministic_rule_v1",
        "basis": "原始错误日志/环境/阶段的确定性规则匹配",
        "boundary": "只输出候选原因（is_confirmed=false），不冒充确定根因。",
        "executed_by_default": True,
        "default_confidence": 0.7,
        "note": "候选原因需人工核实。",
    },
    {
        "layer": 2,
        "name": "静态代码分析",
        "method": "ast_static",
        "basis": "Python 源码 AST 静态解析（不执行代码）",
        "boundary": "只报告可复核的结构与调用观察，不下复现成功/失败结论。",
        "executed_by_default": True,
        "default_confidence": 0.85,
        "note": "语法错误如实标记 valid=false，不伪造解析结果。",
    },
    {
        "layer": 3,
        "name": "隔离动态执行",
        "method": "isolated_execution",
        "basis": "隔离沙箱内真实运行复现代码",
        "boundary": "当前无可用动态执行后端，默认不执行；不得用静态观察冒充运行结果。",
        "executed_by_default": False,
        "default_confidence": 0.0,
        "note": "隔离执行环境未启用；第3层默认不执行。",
    },
    {
        "layer": 4,
        "name": "数值重算",
        "method": "numeric_recompute",
        "basis": "按公开公式从原始 TP/FP/FN 或正确数/总数重算",
        "boundary": "只对比数值一致性，不推断实验条件是否等同。",
        "executed_by_default": True,
        "default_confidence": 0.95,
        "note": "分母为零或计数缺失时标记 insufficient_data。",
    },
    {
        "layer": 5,
        "name": "AI 辅助解释",
        "method": "ai_assisted",
        "basis": "仅针对已验证证据生成解释",
        "boundary": "不新增事实、不参与判定，默认不执行。",
        "executed_by_default": False,
        "default_confidence": 0.4,
        "note": "输出仅供参考，不能替代前四层证据。",
    },
]

_LAYER_ALIASES = {
    "1": 1, "layer_1": 1, "layer 1": 1, "deterministic": 1, "diagnosis": 1,
    "2": 2, "layer_2": 2, "layer 2": 2, "static": 2, "static_analysis": 2,
    "3": 3, "layer_3": 3, "layer 3": 3, "dynamic": 3, "dynamic_execution": 3,
    "4": 4, "layer_4": 4, "layer 4": 4, "numeric": 4, "numeric_recompute": 4,
    "5": 5, "layer_5": 5, "layer 5": 5, "ai": 5, "ai_assisted": 5,
}


def _layer_number(value: Any) -> int | None:
    """把层标识归一为 1-5 的整数，无法识别则返回 None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 1 <= value <= 5 else None
    if isinstance(value, str):
        return _LAYER_ALIASES.get(value.strip().lower())
    return None


def _count(value: Any) -> int | None:
    """计数只接受非负整数（bool 不算）；非法值返回 None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value >= 0:
        return value
    if isinstance(value, float) and value.is_integer() and value >= 0:
        return int(value)
    if isinstance(value, str):
        try:
            parsed = int(value.strip())
        except (ValueError, TypeError):
            return None
        return parsed if parsed >= 0 else None
    return None


def _invalid_counts(note: str) -> dict[str, Any]:
    return {
        "supported": False, "value": None, "valid": False,
        "precision": 0.0, "recall": 0.0, "f1": 0.0, "accuracy": 0.0,
        "denominator_zero": True, "note": note, "method": _METHOD,
    }


def recompute_f1(tp: int, fp: int, fn: int) -> dict[str, Any]:
    """按标准公式重算 precision/recall/f1；分母为零返回 0.0 并给出 note。"""
    counts = {"tp": _count(tp), "fp": _count(fp), "fn": _count(fn)}
    if any(value is None for value in counts.values()):
        return _invalid_counts("TP/FP/FN 必须是非负整数，无法重算。")

    t, p, n = counts["tp"], counts["fp"], counts["fn"]
    precision_denom = t + p
    recall_denom = t + n
    notes: list[str] = []
    precision = t / precision_denom if precision_denom > 0 else 0.0
    recall = t / recall_denom if recall_denom > 0 else 0.0
    if precision_denom == 0:
        notes.append("TP+FP=0，precision 分母为 0，按 0.0 处理（无预测样本）。")
    if recall_denom == 0:
        notes.append("TP+FN=0，recall 分母为 0，按 0.0 处理（无真实正样本）。")
    f1_denom = precision + recall
    f1 = 2 * precision * recall / f1_denom if f1_denom > 0 else 0.0
    if f1_denom == 0:
        notes.append("precision+recall=0，F1 分母为 0，按 0.0 处理。")

    note = " ".join(notes) if notes else "按 P=TP/(TP+FP), R=TP/(TP+FN), F1=2PR/(P+R) 重算。"
    return {
        "supported": True, "valid": True,
        "tp": t, "fp": p, "fn": n,
        "precision": round(precision, 6),
        "recall": round(recall, 6),
        "f1": round(f1, 6),
        "value": round(f1, 6),
        "denominator_zero": bool(notes),
        "notes": notes, "note": note, "method": _METHOD,
    }


def recompute_accuracy(correct: int, total: int) -> dict[str, Any]:
    """按 correct/total 重算准确率；total<=0 返回 0.0 并给出 note。"""
    c, n = _count(correct), _count(total)
    if c is None or n is None:
        return _invalid_counts("correct/total 必须是非负整数，无法重算。")
    if n <= 0:
        return {
            "supported": True, "valid": True,
            "correct": c, "total": n, "accuracy": 0.0, "value": 0.0,
            "denominator_zero": True,
            "notes": ["total<=0，accuracy 分母为 0，按 0.0 处理。"],
            "note": "total<=0，accuracy 分母为 0，按 0.0 处理；数据不足，不构成已复核。",
            "method": _METHOD,
        }
    accuracy = c / n
    note = f"按 accuracy={c}/{n} 重算。"
    return {
        "supported": True, "valid": True,
        "correct": c, "total": n, "accuracy": round(accuracy, 6),
        "value": round(accuracy, 6), "denominator_zero": False,
        "notes": [], "note": note, "method": _METHOD,
    }


def recompute_from_counts(metric: str, counts: dict[str, Any]) -> dict[str, Any]:
    """从计数字段重算指定指标；未知指标或字段缺失时 supported=False，不编造。"""
    name = metric.strip().lower() if isinstance(metric, str) else ""
    data = counts if isinstance(counts, dict) else {}
    aliases = {
        "f1_score": "f1", "f-score": "f1", "fscore": "f1",
        "acc": "accuracy", "acc_score": "accuracy", "accuracy_score": "accuracy",
        "precision_score": "precision", "recall_score": "recall", "sensitivity": "recall",
    }
    canonical = aliases.get(name, name)

    if canonical in ("f1", "precision", "recall"):
        required = ("tp", "fp", "fn")
        if any(key not in data for key in required):
            return _invalid_counts(f"重算 {canonical} 需要 tp/fp/fn 计数字段，当前不完整。")
        result = recompute_f1(data["tp"], data["fp"], data["fn"])
        result["metric"] = canonical
        if not result.get("valid"):
            return result
        result["value"] = result[canonical]
        return result

    if canonical == "accuracy":
        if "correct" not in data or "total" not in data:
            return _invalid_counts("重算 accuracy 需要 correct/total 计数字段，当前不完整。")
        result = recompute_accuracy(data["correct"], data["total"])
        result["metric"] = canonical
        return result

    return {
        "supported": False, "metric": metric, "value": None,
        "note": f"不支持的指标：{metric!r}；仅支持 f1/accuracy/precision/recall，不做推测。",
        "method": _METHOD,
    }


def compare_recomputed(
    recomputed: dict[str, Any],
    reported_value: float,
    tolerance: float = 0.01,
) -> dict[str, Any]:
    """把重算值与论文/报告值按绝对容差对比；证据不足判 insufficient_data。"""
    result: dict[str, Any] = {
        "reported": reported_value,
        "recomputed": None,
        "abs_diff": None,
        "verdict": "insufficient_data",
        "method": _METHOD,
        "note": "",
        "tolerance": tolerance,
    }
    if not isinstance(recomputed, dict) or recomputed.get("supported") is False:
        result["note"] = "重算未提供可用数值（指标不支持或计数字段缺失），不做一致性判定。"
        return result

    recomputed_value = recomputed.get("value")
    if isinstance(recomputed_value, bool) or not isinstance(recomputed_value, (int, float)):
        result["note"] = "重算结果不是有效数值，不做一致性判定。"
        return result
    if isinstance(reported_value, bool) or not isinstance(reported_value, (int, float)):
        result["note"] = "报告值不是有效数值，不做一致性判定。"
        return result
    if recomputed.get("denominator_zero") and float(recomputed_value) == 0.0:
        result["recomputed"] = float(recomputed_value)
        result["note"] = "重算值为 0 且由分母为 0 导致；证据不足，不做一致性判定。"
        return result

    recomputed_float = float(recomputed_value)
    reported_float = float(reported_value)
    abs_diff = abs(recomputed_float - reported_float)
    result["recomputed"] = recomputed_float
    result["reported"] = reported_float
    result["abs_diff"] = round(abs_diff, 6)
    if abs_diff <= tolerance:
        result["verdict"] = "consistent"
        result["note"] = f"绝对差值 {abs_diff:.6f} <= 容差 {tolerance}，数值一致（不代表实验条件相同）。"
    else:
        result["verdict"] = "inconsistent"
        result["note"] = f"绝对差值 {abs_diff:.6f} > 容差 {tolerance}，数值不一致；需人工核对口径与条件。"
    return result


def verify_layer_panel(layer_outputs: list[dict[str, Any]]) -> dict[str, Any]:
    """汇总各层输出为统一展示结构；缺失层按未执行标注，不伪造结果。"""
    provided: dict[int, dict[str, Any]] = {}
    outputs = layer_outputs if isinstance(layer_outputs, list) else []
    for item in outputs:
        if not isinstance(item, dict):
            continue
        number = _layer_number(item.get("layer", item.get("layer_id", item.get("id"))))
        if number is not None:
            provided[number] = item

    layers: list[dict[str, Any]] = []
    for spec in LAYER_SPECS:
        number = int(spec["layer"])
        source = provided.get(number, {})
        method = source.get("method") or spec["method"]
        basis = source.get("basis") or spec["basis"]
        confidence = source.get("confidence", spec["default_confidence"])
        try:
            confidence = round(min(1.0, max(0.0, float(confidence))), 2)
        except (TypeError, ValueError):
            confidence = float(spec["default_confidence"])

        if number == 3:
            # 动态执行无可用后端：未执行时必须显式标注隔离执行环境未启用。
            executed = bool(source.get("executed", False))
            note = source.get("note") or spec["note"]
            if not executed:
                note = "隔离执行环境未启用；第3层动态执行未执行，不作为已验证证据。"
        else:
            executed = bool(source.get("executed", bool(source)))
            note = source.get("note") or spec["note"]

        layers.append({
            "layer": number,
            "name": spec["name"],
            "method": method,
            "basis": basis,
            "executed": executed,
            "confidence": confidence,
            "note": note,
        })

    return {
        "layers": layers,
        "total": len(layers),
        "executed_count": sum(1 for item in layers if item["executed"]),
        "method": "verification_layer_panel_v1",
        "note": "各层职责与证据边界见 layer 字段；第3层动态执行默认不执行，不冒充已运行代码。",
    }
