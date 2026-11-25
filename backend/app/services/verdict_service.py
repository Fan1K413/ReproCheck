"""统一可信结论层：把多个子系统的状态映射为五态，并按 ACM v1.1 三维解耦聚合。

设计边界：
- 只读查询，不写库、不改既有枚举、不执行第三方代码；
- 借鉴 ACM v1.1 的评估框架设计自检项，不代表任何机构认证；
- 所有数据库查询都做防御，缺表或异常时按零计并写入 notes。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import Base
from app.models import AuditFinding, Evidence, ExtractedFact, Material
from app.models.stage2 import EvidenceItem, FactRevision
from app.models.stage4 import FailureDiagnostic, MetricComparison, ReproductionMetric
from app.models.stage6 import BenchmarkCase

# 五态常量与中文标签
VERIFIED = "VERIFIED"
PARTIALLY_VERIFIED = "PARTIALLY_VERIFIED"
INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
CONFLICTING = "CONFLICTING"
UNVERIFIABLE = "UNVERIFIABLE"

VERDICT_STATUSES = (
    VERIFIED,
    PARTIALLY_VERIFIED,
    INSUFFICIENT_EVIDENCE,
    CONFLICTING,
    UNVERIFIABLE,
)

VERDICT_LABELS = {
    VERIFIED: "已验证",
    PARTIALLY_VERIFIED: "部分验证",
    INSUFFICIENT_EVIDENCE: "证据不足",
    CONFLICTING: "存在冲突",
    UNVERIFIABLE: "无法验证",
}

SCOPE_NOTE = "仅基于 ReproCheck 自身验证范围内的证据，未进行独立实验复现，不构成任何机构的认证。"
FRAMEWORK_NOTE = "参考 ACM v1.1 评估框架设计自检项"

# 旧枚举到五态的显式映射；未知值归为 Evidence 不足。
_STATUS_MAPS: dict[str, dict[str, str]] = {
    "comparison": {
        "conflict": CONFLICTING,
        "consistent": VERIFIED,
        "missing": INSUFFICIENT_EVIDENCE,
    },
    "extraction": {
        "supported": VERIFIED,
        "unsupported": UNVERIFIABLE,
        "needs_review": INSUFFICIENT_EVIDENCE,
    },
    "reproduction": {
        "exact_match": VERIFIED,
        "within_tolerance": VERIFIED,
        "significant_deviation": CONFLICTING,
        "insufficient_data": INSUFFICIENT_EVIDENCE,
        "needs_manual_review": INSUFFICIENT_EVIDENCE,
        "not_comparable": UNVERIFIABLE,
    },
    "benchmark_quality": {
        "execution_verified": VERIFIED,
        "independently_reviewed": VERIFIED,
        "partially_verified": PARTIALLY_VERIFIED,
        "unverified": UNVERIFIABLE,
    },
}


def _norm(value: Any) -> str:
    """把来源/状态统一为小写字符串，非字符串视为未知。"""
    return value.strip().lower() if isinstance(value, str) else ""


def map_to_verdict(source_system: str, raw_status: str) -> str:
    """把既有子系统的原始状态映射为统一五态；未知来源或状态归为 Evidence 不足。"""
    mapping = _STATUS_MAPS.get(_norm(source_system))
    if mapping is None:
        return INSUFFICIENT_EVIDENCE
    return mapping.get(_norm(raw_status), INSUFFICIENT_EVIDENCE)


def _empty_verdicts() -> dict[str, int]:
    return {status: 0 for status in VERDICT_STATUSES}


def _has_location(row: Any) -> bool:
    """判断证据是否带可定位信息：page/line 或任意非空 locator 字段。"""
    for name in ("source_locator", "source_locator_json", "locator"):
        value = getattr(row, name, None)
        if isinstance(value, str) and value.strip():
            return True
    for name in ("page_number", "line_number"):
        value = getattr(row, name, None)
        if value is not None and value != "":
            return True
    return False


async def _fetch_rows(db: AsyncSession, model: Any, project_id: str,
                      notes: list[str], label: str) -> list[Any]:
    """按 project_id 只读查询；缺表/异常时记 note 并返回空列表。"""
    try:
        result = await db.execute(
            select(model).where(model.project_id == project_id)
        )
        return list(result.scalars().all())
    except Exception as exc:  # noqa: BLE001 - 聚合层必须降级而非 500
        notes.append(f"{label}查询失败，按零计：{type(exc).__name__}。")
        return []


async def _fetch_statuses(db: AsyncSession, model: Any, attr: Any, project_id: str,
                          notes: list[str], label: str) -> list[str]:
    """只取状态列，减少无关字段读取；异常同样降级为零。"""
    try:
        result = await db.execute(
            select(attr).where(model.project_id == project_id)
        )
        return [value for value in result.scalars().all() if isinstance(value, str)]
    except Exception as exc:  # noqa: BLE001
        notes.append(f"{label}查询失败，按零计：{type(exc).__name__}。")
        return []


async def _comparison_statuses(db: AsyncSession, project_id: str,
                               notes: list[str]) -> list[str]:
    """ComparisonView 目前只是 schema，没有项目级持久表，因此按零计并说明。"""
    table = None
    for name, candidate in Base.metadata.tables.items():
        lower_name = name.lower()
        if lower_name in ("comparison_views", "comparisons"):
            if "project_id" in candidate.c and "status" in candidate.c:
                table = candidate
                break
    if table is None:
        notes.append("当前数据模型未提供项目级 ComparisonView 持久表，comparison 来源按零计。")
        return []
    try:
        result = await db.execute(
            select(table.c.status).where(table.c.project_id == project_id)
        )
        return [value for value in result.scalars().all() if isinstance(value, str)]
    except Exception as exc:  # noqa: BLE001
        notes.append(f"comparison 查询失败，按零计：{type(exc).__name__}。")
        return []


async def _benchmark_statuses(db: AsyncSession, project_id: str,
                              notes: list[str]) -> list[str]:
    """BenchmarkCase 没有 project_id，无法按项目关联，按零计并说明。"""
    if not hasattr(BenchmarkCase, "project_id"):
        notes.append("BenchmarkCase 没有 project_id 字段，无法按项目关联，benchmark_quality 来源按零计。")
        return []
    try:
        return await _fetch_statuses(
            db, BenchmarkCase, BenchmarkCase.quality_level, project_id,
            notes, "benchmark_quality",
        )
    except Exception as exc:  # noqa: BLE001
        notes.append(f"benchmark_quality 查询失败，按零计：{type(exc).__name__}。")
        return []


def _dimension(status: str, subtype: str, evidence_count: int,
               basis: str) -> dict[str, Any]:
    return {
        "status": status,
        "label": VERDICT_LABELS[status],
        "subtype": subtype,
        "evidence_count": evidence_count,
        "basis": basis,
    }


def _material_dimension(materials: list[Any]) -> dict[str, Any]:
    if not materials:
        return _dimension(UNVERIFIABLE, "no_material", 0, "未登记任何材料。")
    with_hash = sum(1 for m in materials if isinstance(m.sha256, str) and m.sha256.strip())
    if with_hash == len(materials):
        return _dimension(VERIFIED, "sha256_complete", len(materials), "全部材料具备 sha256。")
    return _dimension(
        PARTIALLY_VERIFIED, "sha256_partial", len(materials),
        f"{with_hash}/{len(materials)} 份材料具备 sha256。",
    )


def _artifact_dimension(facts: list[Any], evidence_items: list[Any],
                        audit_evidences: list[Any], findings: list[Any],
                        revisions: list[Any], metrics: list[Any],
                        comparisons: list[Any], diagnostics: list[Any]) -> dict[str, Any]:
    review_signals = sum(
        1 for f in facts
        if f.parser_source == "human" or (f.revision_count or 0) > 0
    ) + len(revisions)
    functional_signals = sum(
        1 for c in comparisons
        if (getattr(c, "rule", "") or "").strip() or (getattr(c, "tolerance_basis", "") or "").strip()
    ) + sum(
        1 for m in metrics
        if (getattr(m, "extraction_method", "") or "").strip()
    ) + sum(
        1 for d in diagnostics
        if (getattr(d, "verification_method", "") or "").strip()
    )
    textual_signals = len(facts) + len(evidence_items) + len(audit_evidences) + len(findings)
    evidence_count = textual_signals + len(revisions) + len(metrics) + len(comparisons) + len(diagnostics)

    if review_signals and functional_signals:
        return _dimension(VERIFIED, "mixed", evidence_count, "同时存在规则验证与人工复核信号。")
    if review_signals:
        return _dimension(VERIFIED, "independently_reviewed", evidence_count, "存在人工复核或修订留痕。")
    if functional_signals:
        return _dimension(VERIFIED, "functional", evidence_count, "存在静态分析/规则验证信号。")
    if textual_signals >= 3:
        return _dimension(PARTIALLY_VERIFIED, "textual_only", evidence_count, "仅有多条文本层证据。")
    if textual_signals:
        return _dimension(INSUFFICIENT_EVIDENCE, "textual_only", evidence_count, "文本层证据不足以判定工件评估。")
    return _dimension(UNVERIFIABLE, "not_assessed", 0, "没有可用于工件评估的证据。")


def _results_dimension(comparisons: list[Any], metrics: list[Any],
                       diagnostics: list[Any]) -> dict[str, Any]:
    verdicts = [map_to_verdict("reproduction", c.verdict) for c in comparisons]
    evidence_count = len(comparisons) + len(metrics) + len(diagnostics)
    if CONFLICTING in verdicts:
        return _dimension(CONFLICTING, "deviation", evidence_count, "存在显著偏差的结果比对。")
    if VERIFIED in verdicts:
        return _dimension(VERIFIED, "reproduced", evidence_count, "存在容差内一致的结果比对。")
    if verdicts:
        return _dimension(INSUFFICIENT_EVIDENCE, "incomplete", evidence_count, "结果比对尚未形成可用结论。")
    return _dimension(UNVERIFIABLE, "not_tested", evidence_count, "没有结果比对记录。")


async def build_project_verdict(db: AsyncSession, project_id: str) -> dict[str, Any]:
    """只读聚合项目级可信结论：五态分布、证据定位率与 ACM 三维。"""
    notes: list[str] = []

    materials = await _fetch_rows(db, Material, project_id, notes, "materials")
    facts = await _fetch_rows(db, ExtractedFact, project_id, notes, "extracted_facts")
    evidence_items = await _fetch_rows(db, EvidenceItem, project_id, notes, "evidence_items")
    findings = await _fetch_rows(db, AuditFinding, project_id, notes, "audit_findings")
    audit_evidences = await _fetch_rows(db, Evidence, project_id, notes, "audit_evidences")
    revisions = await _fetch_rows(db, FactRevision, project_id, notes, "fact_revisions")
    metrics = await _fetch_rows(db, ReproductionMetric, project_id, notes, "reproduction_metrics")
    comparison_rows = await _fetch_rows(db, MetricComparison, project_id, notes, "metric_comparisons")
    diagnostics = await _fetch_rows(db, FailureDiagnostic, project_id, notes, "failure_diagnostics")

    comparison_statuses = await _comparison_statuses(db, project_id, notes)
    benchmark_statuses = await _benchmark_statuses(db, project_id, notes)

    return summarize_verdict(
        project_id, materials=materials, facts=facts, evidence_items=evidence_items,
        findings=findings, audit_evidences=audit_evidences, revisions=revisions,
        metrics=metrics, comparison_rows=comparison_rows, diagnostics=diagnostics,
        comparison_statuses=comparison_statuses, benchmark_statuses=benchmark_statuses, notes=notes,
    )


def summarize_verdict(
    project_id: str, *, materials, facts, evidence_items, findings, audit_evidences,
    revisions, metrics, comparison_rows, diagnostics, comparison_statuses=(), benchmark_statuses=(), notes=(),
) -> dict[str, Any]:
    verdicts = _empty_verdicts()
    for fact in facts:
        verdicts[map_to_verdict("extraction", fact.extraction_status)] += 1
    for raw_status in comparison_statuses:
        verdicts[map_to_verdict("comparison", raw_status)] += 1
    for row in comparison_rows:
        verdicts[map_to_verdict("reproduction", row.verdict)] += 1
    for raw_status in benchmark_statuses:
        verdicts[map_to_verdict("benchmark_quality", raw_status)] += 1

    evidence_rows = [*evidence_items, *audit_evidences]
    with_location = sum(1 for row in evidence_rows if _has_location(row))
    total_evidence = len(evidence_rows)

    counts = {
        "materials": len(materials),
        "extracted_facts": len(facts),
        "evidence_items": len(evidence_items),
        "audit_findings": len(findings),
        "audit_evidences": len(audit_evidences),
        "fact_revisions": len(revisions),
        "comparisons": len(comparison_statuses),
        "reproduction_metrics": len(metrics),
        "metric_comparisons": len(comparison_rows),
        "failure_diagnostics": len(diagnostics),
        "benchmark_cases": len(benchmark_statuses),
    }

    return {
        "project_id": project_id,
        "verdicts": verdicts,
        "verdict_labels": dict(VERDICT_LABELS),
        "dimensions": {
            "material_available": _material_dimension(materials),
            "artifact_assessed": _artifact_dimension(
                facts, evidence_items, audit_evidences, findings,
                revisions, metrics, comparison_rows, diagnostics,
            ),
            "results_validated": _results_dimension(comparison_rows, metrics, diagnostics),
        },
        "evidence_locator": {
            "total": total_evidence,
            "with_location": with_location,
            "ratio": round(with_location / total_evidence, 4) if total_evidence else 0.0,
        },
        "counts": counts,
        "notes": list(notes),
        "scope_note": SCOPE_NOTE,
        "framework_note": FRAMEWORK_NOTE,
    }
