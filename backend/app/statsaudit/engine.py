"""统计审计整合引擎：汇总三个子模块，做可信度守卫，生成最终报告。

职责边界：
- 只编排 core / metrics / design 三个纯计算模块，不访问数据库、不调用 LLM、不执行用户代码；
- 对每条 finding 二次执行因果语言守卫，命中即降级为 needs_human_review；
- 任何异常都不伪造结论：子模块缺失/报错记为 limitations，不阻断其余结果。

对外入口：run_stats_audit(payload, project_id="") -> StatsReport
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from app.statsaudit.schema import (
    NAVIGATION_GUARD,
    VERDICT_ZH,
    Finding,
    StatsReport,
    Verdict,
)


def _module_audit(module_name: str, payload: dict) -> dict:
    """安全调用子模块 audit；缺失或异常时返回空的 insufficient 结果 + note。"""
    try:
        import importlib
        module = importlib.import_module(f"app.statsaudit.{module_name}")
        result = module.audit(payload)
        if not isinstance(result, dict):
            raise TypeError(f"{module_name}.audit 返回类型错误: {type(result)}")
        return result
    except Exception as exc:  #  Noqa: BLE001 - 边界兜底，不吞掉结果真实性
        return {
            "findings": [],
            "computations": {},
            "notes": [f"{module_name} 模块未能完成审计：{type(exc).__name__}: {exc}"],
        }


def _guard_finding(raw: dict) -> Finding:
    """把子模块的 finding dict 规整为 Finding，并执行因果语言守卫。"""
    allowed = {v.value for v in Verdict}
    verdict = raw.get("verdict")
    if verdict not in allowed:
        verdict = Verdict.NEEDS_HUMAN_REVIEW.value

    message = str(raw.get("message", ""))
    justification = str(raw.get("justification", ""))
    suggestion = str(raw.get("suggestion", ""))
    matched = [w for w in NAVIGATION_GUARD if w.lower() in (message + justification).lower()]

    # 因果语言命中：降级并追加中性说明（不删原文证据，保留可追溯性）。
    checked = not matched
    if matched:
        verdict = Verdict.NEEDS_HUMAN_REVIEW.value
        message = f"{message}（检测到因果表述，已降级：相关性不等于因果，需人工复核）"

    # 学术不端红线：suggestion 中若出现定性词，替换为复核建议。
    for banned in ("学术不端", "造假", "欺诈"):
        if banned in suggestion:
            suggestion = suggestion.replace(banned, "需人工复核的统计异常")

    evidence_raw = raw.get("evidence") or []
    from app.statsaudit.schema import Evidence
    evidences: list[Evidence] = []
    for e in evidence_raw:
        if not isinstance(e, dict):
            continue
        try:
            evidences.append(Evidence(
                source=str(e.get("source", "input")),
                claimed=e.get("claimed") or {},
                recomputed=e.get("recomputed") or {},
                formula=str(e.get("formula", "")),
                inputs=e.get("inputs") or {},
                method=str(e.get("method", "")),
                note=str(e.get("note", "")),
            ))
        except Exception:
            continue

    return Finding(
        rule_id=str(raw.get("rule_id", "STAT-000")),
        rule_name=str(raw.get("rule_name", "未命名规则")),
        verdict=verdict,
        category=str(raw.get("category", "credibility")),
        message=message,
        evidence=evidences,
        justification=justification,
        suggestion=suggestion,
        confidence=str(raw.get("confidence", "medium")),
        affects=str(raw.get("affects", "all")),
        causal_language_checked=checked,
    )


def run_stats_audit(payload: dict, project_id: str = "") -> StatsReport:
    """运行完整统计审计，返回可序列化报告。

    payload 由调用方提供，可包含 experiment_statistics / ml_metrics / experiment_design
    三个子字典，或直接把字段摊平（三个子模块会各自取用自己需要的键）。
    """
    payload = payload if isinstance(payload, dict) else {}
    findings: list[Finding] = []
    computations: dict[str, Any] = {}
    notes: list[str] = []

    for name in ("core", "metrics", "design"):
        result = _module_audit(name, payload)
        for raw in result.get("findings", []) or []:
            if isinstance(raw, dict):
                findings.append(_guard_finding(raw))
        for key, value in (result.get("computations", {}) or {}).items():
            computations.setdefault(f"{name}.{key}", value)
        notes.extend([str(n) for n in (result.get("notes", []) or [])])

    # 全局 guard：即使子模块漏检，也保证输出无因果断言。
    for finding in findings:
        if finding.causal_language_checked:
            continue
        matched = [w for w in NAVIGATION_GUARD if w.lower() in finding.message.lower()]
        if matched:
            finding.verdict = Verdict.NEEDS_HUMAN_REVIEW.value
            finding.message += "（相关性不等于因果，需人工复核）"
            finding.causal_language_checked = False

    counts: dict[str, int] = {}
    for f in findings:
        counts[f.verdict] = counts.get(f.verdict, 0) + 1

    limitations = list(dict.fromkeys(notes))
    limitations.append("本模块只评估统计证据的合理性，不判定学术不端；相关性不等于因果。")
    limitations.append("单项实验数据不足以支撑对论文整体可信度的结论，需结合原始数据与人工复核。")
    limitations.append("所有计算基于调用方提供的样本/计数，不对数据来源真实性负责。")

    return StatsReport(
        report_id=f"statsaudit-{uuid.uuid4().hex[:12]}",
        created_at=datetime.now(timezone.utc).isoformat(),
        scope={
            "project_id": project_id,
            "input_keys": sorted(payload.keys()),
            "modules": ["core", "metrics", "design"],
            "verdict_labels": VERDICT_ZH,
        },
        findings=findings,
        computations=computations,
        verdict_counts=counts,
        limitations=limitations,
    )


def get_catalog() -> dict[str, Any]:
    """返回规则目录与计算能力清单，供前端展示与调用方自检。"""
    from app.statsaudit.schema import RULE_CATALOG
    return {
        "version": "statsaudit-v1",
        "verdicts": [{"value": v.value, "label_zh": v.label_zh} for v in Verdict],
        "rules": [r.__dict__ for r in RULE_CATALOG.values()],
        "operations": [
            "mean", "std", "variance", "verify_mean_std", "check_consistency",
            "analyze_seed_impact", "confidence_interval", "effect_size",
            "hypothesis_test", "multiple_comparison", "power_analysis",
            "detect_outliers", "distribution_data",
            "compute_classification_metrics", "compute_multiclass_averages",
            "compute_roc_auc", "compute_pr_auc", "compute_regression_metrics",
            "recompute_metric", "audit_metric_claims", "detect_split_mismatch",
            "check_control_group", "check_ablation_completeness",
            "check_baseline_reasonableness", "check_hyperparameter_bias",
            "check_selective_reporting", "check_repetition_sufficiency",
            "check_practical_significance", "guard_causal_language",
        ],
    }
