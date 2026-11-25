"""实验设计合理性审计与可信度边界守卫。

设计约束（与 app.statsaudit.schema 一致）：
1. 只陈述可复算的统计事实，不把相关性写成因果关系；
2. 不凭单组实验数据给出研究诚信方面的定性结论；
3. 信息缺失一律标注为证据不足，不编造、不强行给出负面判断；
4. 所有 finding 的 message 必须经过 guard_causal_language 检查。
"""
from __future__ import annotations

import re
from typing import Any

from app.statsaudit.schema import (
    Evidence,
    NAVIGATION_GUARD,
    RULE_CATALOG,
    Verdict,
)

__all__ = [
    "audit",
    "guard_causal_language",
    "check_control_group",
    "check_ablation_completeness",
    "check_baseline_reasonableness",
    "check_hyperparameter_bias",
    "check_selective_reporting",
    "check_repetition_sufficiency",
    "check_practical_significance",
]


# 因果语言守卫

_DISCLAIMER = "（相关性不等于因果）"

# 命中后用于重写的因果连接词；顺序与 NAVIGATION_GUARD 的非中文部分兼容。
_CAUSAL_PATTERN = re.compile(
    r"(?P<subject>.+?)\s*(?P<causal>导致|造成|决定了|证明了|证明|归因于|causes?|proves?)\s*(?P<object>.+)",
    re.IGNORECASE,
)

_FALLBACK: dict[str, str] = {
    "导致": "与……相关",
    "造成": "与……相关",
    "证明": "支持",
    "归因于": "关联于",
    "因为": "基于",
    "所以": "观察到",
    "必然": "倾向于",
    "决定了": "关联于",
    "causes": "is associated with",
    "proves": "is associated with",
    "due to": "associated with",
    "therefore": "correspondingly,",
    "as a result": "correspondingly,",
}


def guard_causal_language(text: str) -> dict[str, Any]:
    """检测因果表述并改写为中性统计表述。

    Returns:
        {"has_causal": bool, "original": str, "rewritten": str, "matched": [...]}
    """
    original = text if isinstance(text, str) else str(text)
    lowered = original.lower()

    hits: list[tuple[int, str]] = []
    for term in NAVIGATION_GUARD:
        pos = lowered.find(term.lower())
        if pos >= 0:
            hits.append((pos, term))
    hits.sort(key=lambda item: item[0])
    matched = [term for _, term in hits]

    if not matched:
        return {
            "has_causal": False,
            "original": original,
            "rewritten": original,
            "matched": [],
        }

    rewritten = original

    # 确定性副词先弱化，避免与因果动词叠加。
    rewritten = rewritten.replace("必然", "")

    # “因为 A，所以 B” 句式：去掉因果连词，改为观察性表述。
    rewritten = re.sub(
        r"因为\s*(.+?)\s*[，,]\s*所以\s*(.+)",
        r"基于\1，观察到\2",
        rewritten,
    )
    rewritten = rewritten.replace("因为", "基于").replace("所以", "观察到")
    rewritten = re.sub(r"\bdue\s+to\b", "associated with", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\btherefore\b", "correspondingly,", rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r"\bas\s+a\s+result\b", "correspondingly,", rewritten, flags=re.IGNORECASE)

    # “A 导致 B 提升” → “A 与 B 提升相关（相关性不等于因果）”。
    for _ in range(8):
        m = _CAUSAL_PATTERN.search(rewritten)
        if not m:
            break
        subject = m.group("subject").strip().rstrip("，,；;。 ")
        obj = m.group("object").strip().rstrip("。.!！?？;；,， ")
        if not subject or not obj:
            break
        rewritten = f"{subject} 与 {obj}相关{_DISCLAIMER}"

    # 兜底清扫：保证返回文本中不残留任何 NAVIGATION_GUARD 词。
    for term in NAVIGATION_GUARD:
        replacement = _FALLBACK.get(term, "关联于")
        rewritten = re.sub(re.escape(term), replacement, rewritten, flags=re.IGNORECASE)

    if _DISCLAIMER not in rewritten:
        rewritten = rewritten.rstrip() + _DISCLAIMER

    return {
        "has_causal": True,
        "original": original,
        "rewritten": rewritten,
        "matched": matched,
    }


# 通用小工具

def _section(payload: dict[str, Any], *names: str) -> dict[str, Any]:
    for name in names:
        value = payload.get(name)
        if isinstance(value, dict):
            return value
    return {}


def _pick(*sources: Any, names: tuple[str, ...], default: Any = None) -> Any:
    """从多个来源中取第一个非 None 的字段，兼容嵌套与扁平 payload。"""
    for source in sources:
        if not isinstance(source, dict):
            continue
        for name in names:
            if name in source and source[name] is not None:
                return source[name]
    return default


def _tri(value: Any) -> bool | None:
    """把声明值归一为 True / False / None（未知）。"""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        token = value.strip().lower()
        if token in {"true", "yes", "y", "1", "已声明", "是"}:
            return True
        if token in {"false", "no", "n", "0", "未声明", "否"}:
            return False
        return None
    return bool(value)


def _as_list(value: Any) -> list[Any] | None:
    if value is None:
        return None
    if isinstance(value, (list, tuple, set)):
        return [item for item in value]
    if isinstance(value, str):
        return [part.strip() for part in value.split(",") if part.strip()]
    return [value]


def _as_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _items(value: Any) -> list[Any]:
    """把基线字段归一为条目列表。"""
    if value is None:
        return []
    if isinstance(value, dict):
        for key in ("models", "list", "items"):
            if key in value:
                return _items(value[key])
        return [value]
    if isinstance(value, (list, tuple, set)):
        return list(value)
    return [value]


def _result(supported: bool | None, value: Any, values: dict[str, Any],
            note: str, method: str) -> dict[str, Any]:
    return {
        "supported": supported,
        "value": value,
        "values": values,
        "note": note,
        "method": method,
    }


def _rule(rule_id: str) -> tuple[str, str]:
    definition = RULE_CATALOG[rule_id]
    return definition.name, definition.default_verdict


# 纯检查函数

def check_control_group(payload: dict) -> dict:
    """核对是否声明 baseline / 随机化 / 盲法。"""
    data = payload if isinstance(payload, dict) else {}
    cfg = _section(data, "control_group", "controls", "design")
    labels = {
        "baseline": ("baseline_declared", "baseline", "has_baseline"),
        "randomization": ("randomization_declared", "randomized", "randomization"),
        "blinding": ("blinding_declared", "blinded", "blinding"),
    }
    flags = {
        key: _tri(_pick(cfg, data, names=names))
        for key, names in labels.items()
    }
    missing = [key for key, flag in flags.items() if flag is False]
    unknown = [key for key, flag in flags.items() if flag is None]

    if missing:
        supported, value = False, "incomplete"
        note = "部分对照组要素声明为未提供：" + "、".join(missing) + "。"
    elif unknown:
        supported, value = None, "unknown"
        note = "未提供完整的对照组声明信息，未知要素：" + "、".join(unknown) + "。"
    else:
        supported, value = True, "complete"
        note = "baseline、随机化与盲法均已声明。"

    return _result(
        supported, value,
        {"flags": flags, "missing": missing, "unknown": unknown},
        note, "declaration_presence_check",
    )


def check_ablation_completeness(payload: dict) -> dict:
    """对每个声称的核心组件核对是否有对应消融。"""
    data = payload if isinstance(payload, dict) else {}
    claimed = _as_list(_pick(data, names=(
        "claimed_components", "claimed_modules", "components", "core_components",
    )))
    ablations = _as_list(_pick(data, names=(
        "ablations", "ablation_components", "ablation", "ablation_modules",
    )))

    if claimed is None or ablations is None:
        supported, value, missing = None, "unknown", []
        note = "消融清单或核心组件清单缺失，无法核对覆盖范围。"
    else:
        claimed_text = [str(item) for item in claimed]
        ablation_text = {str(item) for item in ablations}
        missing = [item for item in claimed_text if item not in ablation_text]
        supported = not missing
        value = len(missing)
        note = (
            f"声称 {len(claimed_text)} 个核心组件，消融覆盖 "
            f"{len(claimed_text) - len(missing)} 个，缺项：{'、'.join(missing) if missing else '无'}。"
        )

    return _result(
        supported, value,
        {"claimed": claimed, "ablations": ablations, "missing": missing},
        note, "set_difference_check",
    )


def check_baseline_reasonableness(payload: dict) -> dict:
    """核对基线是否为空、是否仅随机基线、是否同期对比。"""
    data = payload if isinstance(payload, dict) else {}
    raw = _pick(data, names=("baselines", "baseline_models", "comparison_baselines"))
    baselines = _items(raw)

    descriptions: list[dict[str, Any]] = []
    for item in baselines:
        if isinstance(item, dict):
            name = str(_pick(item, names=("name", "model", "method"), default="未命名基线"))
            random_flag = _pick(item, names=("is_random", "random", "random_baseline"))
            is_random = (
                _tri(random_flag) if random_flag is not None
                else ("random" in name.lower() or "随机" in name)
            )
            contemporaneous = _tri(_pick(item, names=("contemporaneous", "same_period", "同期")))
        else:
            name = str(item)
            is_random = "random" in name.lower() or "随机" in name
            contemporaneous = None
        descriptions.append({
            "name": name,
            "is_random": bool(is_random),
            "contemporaneous": contemporaneous,
        })

    random_count = sum(1 for d in descriptions if d["is_random"])
    non_contemporaneous = [d["name"] for d in descriptions if d["contemporaneous"] is False]

    if not descriptions:
        supported, value, note = None, 0, "未提供基线模型信息，强弱合理性无法自动判定。"
    elif random_count == len(descriptions):
        supported, value = False, len(descriptions)
        note = "仅提供随机基线，缺少强基线对比，需人工复核。"
    elif non_contemporaneous:
        supported, value = False, len(descriptions)
        note = "存在标记为非同期的基线：" + "、".join(non_contemporaneous) + "，需人工复核。"
    else:
        supported, value = None, len(descriptions)
        note = "基线元数据未标记非同期问题；基线强弱与调参充分性仍需人工复核。"

    return _result(
        supported, value,
        {"baselines": descriptions, "random_count": random_count,
         "non_contemporaneous": non_contemporaneous},
        note, "baseline_metadata_check",
    )


def check_hyperparameter_bias(payload: dict) -> dict:
    """核对测试集是否参与超参选择、搜索次数是否披露。"""
    data = payload if isinstance(payload, dict) else {}
    cfg = _section(data, "hyperparam_search", "hyperparameter_search", "search")
    test_used = _tri(_pick(cfg, data, names=(
        "test_set_used", "test_set_in_search", "use_test_for_search",
    )))
    trials = _pick(cfg, data, names=("search_trials", "n_search_trials", "num_trials"))

    if test_used is True:
        supported, value = False, "test_set_used"
        note = "测试集参与了超参数选择。"
    elif cfg and trials is None:
        supported, value = False, "search_trials_missing"
        note = "已披露搜索过程，但未披露搜索次数。"
    elif test_used is False and trials is not None:
        supported, value = True, trials
        note = "声明测试集未参与超参选择，并披露了搜索次数。"
    else:
        supported, value = None, trials
        note = "未提供超参数搜索信息，无法判定是否存在选择偏差。"

    return _result(
        supported, value,
        {"test_set_used": test_used, "search_trials": trials},
        note, "hyperparam_search_audit",
    )


def check_selective_reporting(payload: dict) -> dict:
    """核对种子、划分与指标的记录覆盖是否完整。"""
    data = payload if isinstance(payload, dict) else {}
    reported_seeds = _as_list(_pick(data, names=(
        "reported_seeds", "seeds_reported", "reported_seed",
    )))
    total_seeds = _pick(data, names=("total_seeds", "all_seeds", "n_seeds", "seeds_total"))
    reported_splits = _as_list(_pick(data, names=("reported_splits", "splits_reported")))
    best_only = _tri(_pick(data, names=(
        "best_metric_only", "only_best_metric", "report_only_best",
    )))
    reported_metrics = _as_list(_pick(data, names=("reported_metrics", "metrics_reported")))
    all_metrics = _as_list(_pick(data, names=("all_metrics", "computed_metrics", "metrics_computed")))

    issues: list[str] = []
    total_seed_number = _as_float(total_seeds)
    if reported_seeds is not None and total_seed_number is not None:
        if len(reported_seeds) < total_seed_number:
            issues.append(
                f"报告种子数 {len(reported_seeds)} 少于总种子数 {int(total_seed_number)}"
            )
    if reported_splits is not None:
        split_names = {str(split).lower() for split in reported_splits}
        if "test" not in split_names:
            issues.append("报告划分缺少 test")
    if best_only is True:
        issues.append("仅报告最优指标")
    if (reported_metrics is not None and all_metrics is not None
            and len(reported_metrics) < len(all_metrics) and best_only is not True):
        issues.append("报告指标数少于已计算指标数")

    known_fields = (
        reported_seeds is not None or total_seeds is not None or reported_splits is not None
        or best_only is not None or reported_metrics is not None
    )
    if not known_fields:
        supported, value, note = None, "unknown", "未提供种子、划分与指标的报告范围信息。"
    elif issues:
        supported, value = False, len(issues)
        note = "记录覆盖存在缺项：" + "；".join(issues) + "。"
    else:
        supported, value = True, 0
        note = "种子、划分与指标报告范围未发现缺项。"

    return _result(
        supported, value,
        {
            "reported_seed_count": len(reported_seeds) if reported_seeds is not None else None,
            "total_seeds": total_seeds,
            "reported_splits": reported_splits,
            "reported_metrics": reported_metrics,
            "issues": issues,
        },
        note, "reporting_coverage_check",
    )


def check_repetition_sufficiency(payload: dict) -> dict:
    """重复次数低于 3 时不足以支撑稳定性结论。"""
    data = payload if isinstance(payload, dict) else {}
    raw = _pick(data, names=("n_repeats", "num_repeats", "repeat_count", "repetitions"))
    value = _as_float(raw)
    threshold = 3
    if value is None:
        supported, note = None, "未提供重复实验次数。"
    elif value < threshold:
        supported, note = False, f"重复次数 {value:g} 低于阈值 {threshold}。"
    else:
        supported, note = True, f"重复次数 {value:g} 达到阈值 {threshold}。"

    return _result(
        supported, value, {"n_repeats": value, "threshold": threshold},
        note, "repeat_count_threshold",
    )


def check_practical_significance(payload: dict, effect_size: Any = None,
                                 pvalue: Any = None, threshold: float = 0.2) -> dict:
    """p 显著但效应量绝对值低于阈值时，提示实际意义需人工复核。"""
    data = payload if isinstance(payload, dict) else {}
    effect = effect_size if effect_size is not None else _pick(data, names=(
        "effect_size", "cohens_d", "hedges_g",
    ))
    p = pvalue if pvalue is not None else _pick(data, names=("pvalue", "p_value", "p"))
    alpha = _as_float(_pick(data, names=("alpha", "significance_level"), default=0.05))
    limit = _as_float(threshold)
    if limit is None:
        limit = 0.2

    effect_number = _as_float(effect)
    p_number = _as_float(p)
    alpha_number = alpha if alpha is not None else 0.05
    significant = p_number is not None and p_number < alpha_number
    small = effect_number is not None and abs(effect_number) < limit

    if p_number is None or effect_number is None:
        supported, note = None, "p 值或效应量缺失，无法比较统计显著性与实际意义。"
    elif significant and small:
        supported = False
        note = (
            f"p={p_number:g} < alpha={alpha_number:g}，但 |effect_size|="
            f"{abs(effect_number):g} < {limit:g}；显著性本身不被否定。"
        )
    elif significant:
        supported = True
        note = (
            f"p={p_number:g} < alpha={alpha_number:g}，|effect_size|="
            f"{abs(effect_number):g} 达到 {limit:g} 阈值。"
        )
    else:
        supported = None
        note = f"p={p_number:g} 未低于 alpha={alpha_number:g}，本比较规则未触发。"

    return _result(
        supported, (p_number, effect_number),
        {
            "pvalue": p_number,
            "alpha": alpha_number,
            "effect_size": effect_number,
            "threshold": limit,
            "significant": significant,
            "small_effect": small,
        },
        note, "p_value_effect_size_compare",
    )


# Finding 构造

def _evidence(source: str, *, claimed: dict[str, Any] | None = None,
              recomputed: dict[str, Any] | None = None, formula: str = "",
              inputs: dict[str, Any] | None = None, method: str = "",
              note: str = "") -> dict[str, Any]:
    return Evidence(
        source=source,
        claimed=claimed or {},
        recomputed=recomputed or {},
        formula=formula,
        inputs=inputs or {},
        method=method,
        note=note,
    ).to_dict()


def _suggest(action: str, needed: str) -> str:
    return f"人工复核建议：{action}；需补充的证据：{needed}。"


def _sanitize_suggestion(text: str) -> str:
    """suggestion 只能给出人工复核建议与需补充的证据。"""
    safe = str(text)
    for phrase in ("学术不端", "研究不端", "数据造假", "欺诈"):
        safe = safe.replace(phrase, "需人工复核的问题")
    if "人工复核建议" not in safe:
        safe = "人工复核建议：" + safe
    if "需补充的证据" not in safe:
        safe = safe.rstrip("。") + "；需补充的证据：原始实验记录与完整统计输出。"
    return safe


def _finding(rule_id: str, verdict: str, message: str,
             evidence: list[dict[str, Any]], justification: str, suggestion: str,
             confidence: str = "medium", affects: str = "all") -> dict[str, Any]:
    rule_name, _ = _rule(rule_id)
    category = "credibility" if rule_id.startswith("CRED-") else "experiment_design"
    return {
        "rule_id": rule_id,
        "rule_name": rule_name,
        "verdict": verdict,
        "category": category,
        "message": message,
        "evidence": evidence,
        "justification": justification,
        "suggestion": _sanitize_suggestion(suggestion),
        "confidence": confidence,
        "affects": affects,
    }


def _flag_text(flag: bool | None) -> str:
    return {True: "已声明", False: "声明为未提供", None: "未提供信息"}[flag]


# 主审计入口

def audit(payload: dict) -> dict:
    """返回 {"findings": [...], "computations": {...}, "notes": [...]}。"""
    data = payload if isinstance(payload, dict) else {}
    computations: dict[str, Any] = {}
    notes: list[str] = []

    control = check_control_group(data)
    ablation = check_ablation_completeness(data)
    baseline = check_baseline_reasonableness(data)
    hyperparam = check_hyperparameter_bias(data)
    reporting = check_selective_reporting(data)
    repetition = check_repetition_sufficiency(data)
    practical = check_practical_significance(data)

    computations.update({
        "control_group": control,
        "ablation_completeness": ablation,
        "baseline_reasonableness": baseline,
        "hyperparameter_bias": hyperparam,
        "selective_reporting": reporting,
        "repetition_sufficiency": repetition,
        "practical_significance": practical,
    })

    findings: list[dict[str, Any]] = []

    # DSN-001 对照组充分性
    flags = control["values"]["flags"]
    dsn001_message = (
        "对照组声明核验：baseline={baseline}，随机化={randomization}，盲法={blinding}；{note}".format(
            baseline=_flag_text(flags["baseline"]),
            randomization=_flag_text(flags["randomization"]),
            blinding=_flag_text(flags["blinding"]),
            note=control["note"],
        )
    )
    findings.append(_finding(
        "DSN-001",
        Verdict.VERIFIED.value if control["supported"] is True else Verdict.INSUFFICIENT_EVIDENCE.value,
        dsn001_message,
        [_evidence(
            "input",
            claimed={"declared": flags},
            recomputed=control["values"],
            formula="baseline ∧ randomization ∧ blinding",
            inputs={"control_group": flags},
            method=control["method"],
            note=control["note"],
        )],
        "对照组三要素缺少任一声明时，不作设计充分的结论。",
        "核对论文方法部分与实验记录中的对照组、随机化与盲法描述。",
        "high" if control["supported"] is not None else "low",
    ))

    # DSN-002 消融完整性
    missing_components = ablation["values"]["missing"]
    dsn002_message = (
        "消融覆盖核验：" + ablation["note"]
        if ablation["supported"] is None
        else "消融覆盖核验：核心组件清单与消融清单"
        + ("一致。" if not missing_components else "存在缺项：" + "、".join(map(str, missing_components)) + "。")
    )
    findings.append(_finding(
        "DSN-002",
        Verdict.VERIFIED.value if ablation["supported"] is True else Verdict.INSUFFICIENT_EVIDENCE.value,
        dsn002_message,
        [_evidence(
            "input",
            claimed={"claimed_components": ablation["values"]["claimed"]},
            recomputed={"ablations": ablation["values"]["ablations"],
                        "missing": missing_components},
            formula="claimed_components − ablations",
            inputs={"claimed_components": ablation["values"]["claimed"],
                    "ablations": ablation["values"]["ablations"]},
            method=ablation["method"],
            note=ablation["note"],
        )],
        "按集合差核对每个声称组件的消融，缺项不推定消融已完成。",
        "补充每个核心组件的消融实验记录与对应指标输出。",
        "high" if ablation["supported"] is not None else "low",
    ))

    # DSN-003 基线合理性
    baseline_values = baseline["values"]
    dsn003_message = (
        "基线核验：提供 {count} 个基线，其中随机基线 {random_count} 个；"
        "基线强弱与调参充分性需人工复核。{note}"
    ).format(
        count=len(baseline_values["baselines"]),
        random_count=baseline_values["random_count"],
        note="",
    )
    claimed_conclusion = _pick(data, names=("claimed_conclusion", "conclusion_text", "conclusion"))
    if isinstance(claimed_conclusion, str) and claimed_conclusion.strip():
        dsn003_message += "论文结论摘录：" + claimed_conclusion.strip() + "。"
    findings.append(_finding(
        "DSN-003",
        Verdict.NEEDS_HUMAN_REVIEW.value,
        dsn003_message,
        [_evidence(
            "input",
            claimed={"baselines": baseline_values["baselines"]},
            recomputed={"random_count": baseline_values["random_count"],
                        "non_contemporaneous": baseline_values["non_contemporaneous"]},
            formula="random_count / len(baselines)",
            inputs={"baselines": baseline_values["baselines"]},
            method=baseline["method"],
            note=baseline["note"],
        )],
        "基线是否同期、是否为强基线属于需要领域判断的问题，不能仅凭元数据自动定性。",
        "由领域专家核对同期基线选择依据与调参过程。",
        "low",
    ))

    # DSN-004 超参数搜索偏差
    dsn004_message = (
        "超参数搜索核验：test_set_used={test_used}，search_trials={trials}；{note}"
    ).format(
        test_used=hyperparam["values"]["test_set_used"],
        trials=hyperparam["values"]["search_trials"],
        note=hyperparam["note"],
    )
    dsn004_verdict = (
        Verdict.POTENTIAL_BIAS.value if hyperparam["supported"] is False
        else Verdict.VERIFIED.value if hyperparam["supported"] is True
        else Verdict.INSUFFICIENT_EVIDENCE.value
    )
    findings.append(_finding(
        "DSN-004", dsn004_verdict, dsn004_message,
        [_evidence(
            "input",
            claimed=hyperparam["values"],
            recomputed={"test_set_used": hyperparam["values"]["test_set_used"],
                        "search_trials_present": hyperparam["values"]["search_trials"] is not None},
            formula="test_set_used OR (section_present AND search_trials_missing)",
            inputs=hyperparam["values"],
            method=hyperparam["method"],
            note=hyperparam["note"],
        )],
        "测试集参与调参或搜索次数未披露时，仅标记为潜在偏差，不作诚信判定。",
        "核对预注册设置、搜索日志与测试集访问记录。",
        "high" if hyperparam["supported"] is not None else "low",
    ))

    # DSN-005 选择性报告
    dsn005_message = "报告覆盖核验：" + reporting["note"]
    dsn005_verdict = (
        Verdict.POTENTIAL_BIAS.value if reporting["supported"] is False
        else Verdict.VERIFIED.value if reporting["supported"] is True
        else Verdict.INSUFFICIENT_EVIDENCE.value
    )
    findings.append(_finding(
        "DSN-005", dsn005_verdict, dsn005_message,
        [_evidence(
            "input",
            claimed={"reported_seeds": reporting["values"]["reported_seed_count"],
                     "total_seeds": reporting["values"]["total_seeds"],
                     "reported_splits": reporting["values"]["reported_splits"]},
            recomputed={"issues": reporting["values"]["issues"]},
            formula="reported_seeds < total_seeds OR test ∉ reported_splits OR best_only",
            inputs=reporting["values"],
            method=reporting["method"],
            note=reporting["note"],
        )],
        "报告范围缺项对应潜在选择偏差，不据此推断主观意图。",
        "补充全部种子、全部划分与全部预先声明指标的完整输出。",
        "high" if reporting["supported"] is not None else "low",
    ))

    # DSN-006 重复实验不足
    dsn006_message = "重复次数核验：" + repetition["note"]
    findings.append(_finding(
        "DSN-006",
        Verdict.VERIFIED.value if repetition["supported"] is True else Verdict.INSUFFICIENT_EVIDENCE.value,
        dsn006_message,
        [_evidence(
            "input",
            claimed={"n_repeats": repetition["values"]["n_repeats"]},
            recomputed={"threshold": repetition["values"]["threshold"]},
            formula="n_repeats ≥ 3",
            inputs=repetition["values"],
            method=repetition["method"],
            note=repetition["note"],
        )],
        "少于 3 次重复时样本不足以支撑稳定性结论。",
        "补充独立重复运行记录与逐次指标明细。",
        "high" if repetition["supported"] is not None else "low",
    ))

    # DSN-007 统计显著但实际意义小
    pvalues = practical["values"]
    dsn007_message = (
        "显著性核验：p={p}，alpha={alpha}，效应量={effect}，阈值={limit}；{note}"
    ).format(
        p=pvalues["pvalue"],
        alpha=pvalues["alpha"],
        effect=pvalues["effect_size"],
        limit=pvalues["threshold"],
        note=practical["note"],
    )
    if practical["supported"] is False:
        dsn007_verdict = Verdict.NEEDS_HUMAN_REVIEW.value
    elif practical["supported"] is True:
        dsn007_verdict = Verdict.VERIFIED.value
    else:
        dsn007_verdict = Verdict.INSUFFICIENT_EVIDENCE.value
    findings.append(_finding(
        "DSN-007", dsn007_verdict, dsn007_message,
        [_evidence(
            "input",
            claimed={"pvalue": pvalues["pvalue"], "effect_size": pvalues["effect_size"]},
            recomputed={"significant": pvalues["significant"],
                        "small_effect": pvalues["small_effect"],
                        "alpha": pvalues["alpha"], "threshold": pvalues["threshold"]},
            formula="p < alpha AND |effect_size| < threshold",
            inputs={"pvalue": pvalues["pvalue"], "effect_size": pvalues["effect_size"],
                    "alpha": pvalues["alpha"], "threshold": pvalues["threshold"]},
            method=practical["method"],
            note=practical["note"],
        )],
        "统计显著性与实际意义是两个维度；效应量偏小只触发人工复核，显著性本身不被否定。",
        "结合领域最小有意义效应阈值复核实际价值。",
        "high" if practical["supported"] is not None else "low",
    ))

    # CRED-001 硬守卫：所有 message 必须经过因果语言检查。
    guard_stats: dict[str, Any] = {
        "checked": 0, "rewritten": 0, "rewritten_rules": [],
    }
    rewritten_samples: list[dict[str, str]] = []
    for finding in findings:
        result = guard_causal_language(finding["message"])
        guard_stats["checked"] += 1
        if result["has_causal"]:
            finding["message"] = result["rewritten"]
            finding["verdict"] = Verdict.NEEDS_HUMAN_REVIEW.value
            finding["justification"] += "；检测到因果表述，已降级为人工复核并改为中性统计表述。"
            guard_stats["rewritten"] += 1
            guard_stats["rewritten_rules"].append(finding["rule_id"])
            rewritten_samples.append({
                "rule_id": finding["rule_id"],
                "original": result["original"],
                "rewritten": result["rewritten"],
                "matched": "、".join(result["matched"]),
            })

    if guard_stats["rewritten"]:
        cred001_message = (
            f"因果语言守卫核验：检查 {guard_stats['checked']} 条设计类结论文本，"
            f"其中 {guard_stats['rewritten']} 条含因果表述，已改写为中性统计表述并标记为人工复核。"
        )
        cred001_verdict = Verdict.NEEDS_HUMAN_REVIEW.value
    else:
        cred001_message = (
            f"因果语言守卫核验：检查 {guard_stats['checked']} 条结论文本，"
            "未检出因果表述，当前结论均为中性统计表述。"
        )
        cred001_verdict = Verdict.VERIFIED.value
    findings.append(_finding(
        "CRED-001", cred001_verdict, cred001_message,
        [_evidence(
            "engine",
            recomputed=guard_stats,
            formula="NAVIGATION_GUARD 命中 → 中性改写 + verdict 降级",
            inputs={"guard_terms": list(NAVIGATION_GUARD)},
            method="guard_causal_language",
            note="逐条扫描 finding.message。",
        )],
        "相关性表述与因果表述必须分开；命中守卫的结论不得直接发布。",
        "复核被改写报告的原始措辞与数据来源。",
        "high",
    ))

    # CRED-002 边界守卫：仅统计证据 + 人工复核建议。
    findings.append(_finding(
        "CRED-002", Verdict.NEEDS_HUMAN_REVIEW.value,
        "可信度边界核验：本次输出仅包含可复算统计证据与人工复核建议，未对研究诚信作出定性结论。",
        [_evidence(
            "engine",
            recomputed={"finding_count": len(findings), "misconduct_conclusions": 0},
            formula="suggestion = 人工复核建议 + 需补充的证据",
            inputs={"rules": [f["rule_id"] for f in findings]},
            method="credibility_boundary_guard",
            note="单组实验数据不足以支撑超出统计范围的定性结论。",
        )],
        "自动化审计的边界止于可复算统计证据。",
        "由领域专家结合原始数据、实验日志与论文全文复核异常项。",
        "high",
    ))

    # CRED 规则自身的 message 也要过守卫；suggestion 统一做边界净化。
    for finding in findings:
        result = guard_causal_language(finding["message"])
        finding["message"] = result["rewritten"]
        if result["has_causal"]:
            finding["verdict"] = Verdict.NEEDS_HUMAN_REVIEW.value
        finding["suggestion"] = _sanitize_suggestion(finding["suggestion"])
    guard_stats["checked"] = len(findings)

    computations["causal_guard"] = guard_stats
    computations["causal_guard_rewrites"] = rewritten_samples
    computations["credibility_guard"] = {
        "misconduct_conclusions": 0,
        "suggestions_are_review_only": True,
    }

    notes.extend([
        "本次审计仅基于输入 payload，未核验论文原文、代码与原始数据。",
        "信息缺失项已标注为证据不足；潜在偏差不等同于对研究诚信的定性结论。",
        "所有 finding 的 message 已通过因果语言守卫，suggestion 仅含人工复核建议与需补充的证据。",
    ])

    return {"findings": findings, "computations": computations, "notes": notes}
