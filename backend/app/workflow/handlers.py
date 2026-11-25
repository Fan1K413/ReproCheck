"""工作流确定性检查处理器注册表。

每个处理器接收 HandlerContext，返回 HandlerResult。硬性要求：
- 只读数据库与既有材料，不修改原始科研项目；
- 数据不足时返回 insufficient_data（skipped），绝不伪造指标或结论；
- 结果与证据引用必须可追溯到既有材料/事实/证据行；
- 需要真实代码执行的处理器受安全隔离后端门禁控制，无后端时如实标注禁用。
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import logger
from app.models import ExtractedFact, Material, SourceChunk
from app.models.stage2 import EvidenceItem
from app.models.stage4 import ReproductionMetric
from app.services import normalize_field_key, values_equal
from app.reproduction.sandbox import EnvDetector, ExecutionSandbox

# 结果状态
R_COMPLETED = "completed"
R_INSUFFICIENT = "insufficient_data"
R_SKIPPED = "skipped"
R_FAILED = "failed"

CODE_SUFFIXES = (".py", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".json", ".txt")
PAPER_TYPES = ("pdf", "markdown", "text")
DATA_SUFFIXES = (".csv", ".json", ".parquet", ".xlsx", ".xls", ".tsv")
IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".bmp", ".gif")


@dataclass
class HandlerContext:
    db: AsyncSession
    project_id: str
    node: dict[str, Any]
    user_id: str | None = None


@dataclass
class HandlerResult:
    status: str
    summary: str
    result: dict[str, Any] = field(default_factory=dict)
    evidence: list[dict[str, Any]] = field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None


# 通用数据装载

async def _load_materials(db: AsyncSession, project_id: str) -> list[Material]:
    return list((await db.execute(
        select(Material).where(Material.project_id == project_id)
    )).scalars().all())


async def _load_facts(db: AsyncSession, project_id: str) -> list[ExtractedFact]:
    return list((await db.execute(
        select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        .order_by(ExtractedFact.created_at)
    )).scalars().all())


def _role(material: Material) -> str:
    name = (material.source_name or "").lower()
    if name.endswith((".py", ".ipynb")):
        return "code"
    if name.endswith((".yaml", ".yml", ".toml", ".ini", ".cfg")) or "requirements" in name:
        return "config"
    if material.material_type in PAPER_TYPES and not name.endswith(CODE_SUFFIXES):
        return "paper"
    return "other"


async def _fact_evidence_ids(db: AsyncSession, fact_ids: list[str]) -> set[str]:
    if not fact_ids:
        return set()
    rows = (await db.execute(
        select(EvidenceItem.fact_id).where(EvidenceItem.fact_id.in_(fact_ids))
    )).all()
    return {r[0] for r in rows}


# 处理器实现

async def h_materials_presence(ctx: HandlerContext) -> HandlerResult:
    materials = await _load_materials(ctx.db, ctx.project_id)
    by_role: dict[str, list[dict]] = {"paper": [], "code": [], "config": [], "data": [], "other": []}
    missing: list[str] = []
    for m in materials:
        role = _role(m)
        if (m.source_name or "").lower().endswith(DATA_SUFFIXES + IMAGE_SUFFIXES):
            role = "data"
        by_role[role].append({
            "material_id": m.id, "source_name": m.source_name,
            "material_type": m.material_type, "parse_status": m.parse_status,
        })
    pre = ctx.node.get("preconditions") or {}
    for name in pre.get("required_material_names") or []:
        if not any(name.lower() in (x["source_name"] or "").lower() for xs in by_role.values() for x in xs):
            missing.append(name)
    summary = f"共 {len(materials)} 份材料：论文 {len(by_role['paper'])}、代码 {len(by_role['code'])}、" \
              f"配置 {len(by_role['config'])}、数据 {len(by_role['data'])}。"
    if missing:
        summary += f" 缺少必需材料：{', '.join(missing)}"
    status = R_COMPLETED if materials else R_INSUFFICIENT
    return HandlerResult(
        status=status, summary=summary,
        result={"by_role": by_role, "missing": missing, "total": len(materials)},
    )


async def h_compare_parameter(ctx: HandlerContext) -> HandlerResult:
    facts = await _load_facts(ctx.db, ctx.project_id)
    materials = await _load_materials(ctx.db, ctx.project_id)
    mat_by_id = {m.id: m for m in materials}
    targets = ctx.node.get("evidence_targets") or []

    # 按规范字段分组，再按材料角色分侧
    groups: dict[str, dict[str, list[ExtractedFact]]] = {}
    for f in facts:
        key, _label = normalize_field_key(f.field_key)
        if targets and key not in {normalize_field_key(t)[0] for t in targets}:
            continue
        role = _role(mat_by_id[f.material_id]) if f.material_id in mat_by_id else "other"
        groups.setdefault(key, {}).setdefault(role, []).append(f)

    comparisons: list[dict[str, Any]] = []
    for key, by_role in groups.items():
        paper_facts = by_role.get("paper", [])
        code_facts = by_role.get("code", []) + by_role.get("config", [])
        if not paper_facts or not code_facts:
            comparisons.append({
                "field_key": key, "status": "missing",
                "paper": _fact_brief(paper_facts), "code": _fact_brief(code_facts),
                "note": "论文侧或代码/配置侧缺少该字段事实",
            })
            continue
        pf, cf = paper_facts[0], code_facts[0]
        eq = values_equal(
            key,
            pf.normalized_value if pf.normalized_value is not None else pf.raw_value,
            cf.normalized_value if cf.normalized_value is not None else cf.raw_value,
            pf.unit, cf.unit,
        )
        comparisons.append({
            "field_key": key,
            "status": "consistent" if eq is True else ("conflict" if eq is False else "missing"),
            "paper": _fact_brief([pf]), "code": _fact_brief([cf]),
        })

    if not comparisons:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="未抽取到可比对的参数事实。",
            result={"comparisons": []},
        )
    conflicts = [c for c in comparisons if c["status"] == "conflict"]
    summary = f"比对 {len(comparisons)} 个参数字段：{len(conflicts)} 项冲突，" \
              f"{sum(c['status'] == 'consistent' for c in comparisons)} 项一致，" \
              f"{sum(c['status'] == 'missing' for c in comparisons)} 项数据不足。"
    return HandlerResult(status=R_COMPLETED, summary=summary,
                         result={"comparisons": comparisons})


def _fact_brief(facts: list[ExtractedFact]) -> dict[str, Any]:
    if not facts:
        return {"present": False}
    f = facts[0]
    return {
        "present": True, "fact_id": f.fact_id or str(f.id),
        "material_id": f.material_id, "source_name": f.source_name,
        "value": f.normalized_value if f.normalized_value is not None else f.raw_value,
        "unit": f.unit, "confidence": f.confidence,
    }


async def h_fact_evidence_check(ctx: HandlerContext) -> HandlerResult:
    facts = await _load_facts(ctx.db, ctx.project_id)
    fact_ids = [f.fact_id or str(f.id) for f in facts]
    with_ev = await _fact_evidence_ids(ctx.db, fact_ids)
    lacking = [
        {"fact_id": f.fact_id or str(f.id), "field_key": f.field_key,
         "value": f.normalized_value if f.normalized_value is not None else f.raw_value,
         "extraction_status": f.extraction_status, "confidence": f.confidence}
        for f in facts if (f.fact_id or str(f.id)) not in with_ev
    ]
    summary = f"共 {len(facts)} 条事实，{len(facts) - len(lacking)} 条有证据支撑，{len(lacking)} 条缺少证据。"
    return HandlerResult(
        status=R_COMPLETED if facts else R_INSUFFICIENT, summary=summary,
        result={"lacking_evidence": lacking, "with_evidence": len(facts) - len(lacking)},
    )


async def h_env_dependency_check(ctx: HandlerContext) -> HandlerResult:
    materials = await _load_materials(ctx.db, ctx.project_id)
    texts = {m.source_name: m.raw_text or "" for m in materials}
    info = EnvDetector().detect(materials, texts)
    summary = "环境画像：" + ("；".join(info["missing"]) if info["missing"] else "未发现明显缺失项。")
    return HandlerResult(
        status=R_COMPLETED, summary=summary,
        result={"environment": info},
    )


async def h_dataset_quality_check(ctx: HandlerContext) -> HandlerResult:
    materials = await _load_materials(ctx.db, ctx.project_id)
    data_mats = [m for m in materials
                 if (m.source_name or "").lower().endswith(DATA_SUFFIXES + IMAGE_SUFFIXES)]
    if not data_mats:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="未发现数据类材料（CSV/JSON/Parquet/表格/图像），无法执行数据质量检查。",
            result={"data_materials": []},
        )
    items = []
    for m in data_mats:
        items.append({
            "material_id": m.id, "source_name": m.source_name,
            "material_type": m.material_type, "parse_status": m.parse_status,
            "file_size_bytes": m.file_size_bytes,
            "error_code": m.parse_error_code, "warnings": _safe_json(m.warnings_json),
        })
    summary = f"发现 {len(data_mats)} 份数据材料；解析失败 " \
              f"{sum(1 for x in items if x['parse_status'] == 'failed')} 份。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result={"data_materials": items})


async def h_experiment_run(ctx: HandlerContext) -> HandlerResult:
    available, reason = ExecutionSandbox.sandbox_available()
    if not available:
        return HandlerResult(
            status=R_SKIPPED, summary=f"实验执行未启用：{reason}",
            result={"sandbox_available": False, "reason": reason},
            error_code="EXECUTION_DISABLED",
        )
    # 执行后端可用时，真实执行由既有 ReproductionRun 受控流程承接；本节点不直接跑用户代码。
    return HandlerResult(
        status=R_SKIPPED,
        summary="安全后端可用；实际实验执行请通过复现运行（ReproductionRun）受控流程发起。",
        result={"sandbox_available": True},
    )


async def h_model_evaluation(ctx: HandlerContext) -> HandlerResult:
    metrics = list((await ctx.db.execute(
        select(ReproductionMetric).where(ReproductionMetric.project_id == ctx.project_id)
    )).scalars().all())
    facts = await _load_facts(ctx.db, ctx.project_id)
    if not metrics:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="项目中尚无复现指标记录，无法做指标对照。",
            result={"metrics": [], "facts": len(facts)},
        )
    metric_rows = [{
        "metric_name": m.metric_name, "metric_value": m.metric_value, "unit": m.unit,
        "experiment": m.experiment, "dataset": m.dataset, "source": m.source,
        "confidence": m.confidence, "needs_manual_review": m.needs_manual_review,
    } for m in metrics]
    summary = f"读取 {len(metric_rows)} 条复现指标记录。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result={"metrics": metric_rows})


async def h_chart_verification_check(ctx: HandlerContext) -> HandlerResult:
    from app.services.chart_verification_service import verify_bundle
    materials = await _load_materials(ctx.db, ctx.project_id)
    chunks = list((await ctx.db.execute(
        select(SourceChunk).where(SourceChunk.project_id == ctx.project_id)
    )).scalars().all())
    if not chunks:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="无可用文本块，图表核验缺少输入材料。", result={},
        )
    chunk_texts = [c.original_text or "" for c in chunks]
    locators = [_safe_json(c.source_locator_json) or {} for c in chunks]
    code_texts = {m.source_name: m.raw_text or "" for m in materials if (m.source_name or "").endswith(".py")}
    material_texts = {m.source_name: m.raw_text or "" for m in materials}
    bundle = verify_bundle(chunk_texts, locators, code_texts, material_texts)
    s = bundle["summary"]
    summary = f"图表核验：共 {s['total_claims']} 条表格主张，" \
              f"支持 {s['supported']}、冲突 {s['conflicting']}、数据不足 {s['insufficient_data']}。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result=bundle)


async def _group_by_material_facts(ctx: HandlerContext) -> dict[str, list[ExtractedFact]]:
    facts = await _load_facts(ctx.db, ctx.project_id)
    groups: dict[str, list[ExtractedFact]] = {}
    for f in facts:
        groups.setdefault(f.material_id or "unknown", []).append(f)
    return groups


async def h_ablation_check(ctx: HandlerContext) -> HandlerResult:
    groups = await _group_by_material_facts(ctx)
    if len(groups) < 2:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="分组不足：需要至少两组（基线/变体）事实数据才能做消融对照。",
            result={"groups": len(groups)},
        )
    # 按字段跨分组对照取值
    by_field: dict[str, dict[str, list[ExtractedFact]]] = {}
    for material_id, fs in groups.items():
        for f in fs:
            key, _ = normalize_field_key(f.field_key)
            by_field.setdefault(key, {}).setdefault(material_id, []).append(f)
    comparisons = []
    for key, by_mat in by_field.items():
        if len(by_mat) < 2:
            continue
        comparisons.append({
            "field_key": key,
            "groups": {mid: [_fact_brief(x) for x in xs] for mid, xs in by_mat.items()},
        })
    summary = f"按 {len(groups)} 组材料对照 {len(comparisons)} 个字段。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result={"comparisons": comparisons})


async def h_hyperparam_compare(ctx: HandlerContext) -> HandlerResult:
    groups = await _group_by_material_facts(ctx)
    if len(groups) < 2:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="配置分组不足：需要至少两组超参配置结果才能横向对比。",
            result={"groups": len(groups)},
        )
    by_field: dict[str, dict[str, list[ExtractedFact]]] = {}
    for material_id, fs in groups.items():
        for f in fs:
            key, _ = normalize_field_key(f.field_key)
            by_field.setdefault(key, {}).setdefault(material_id, []).append(f)
    rows = []
    for key, by_mat in by_field.items():
        rows.append({
            "field_key": key,
            "groups": {mid: [_fact_brief(x) for x in xs] for mid, xs in by_mat.items()},
        })
    summary = f"横向对比 {len(groups)} 组配置的 {len(rows)} 个字段。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result={"comparisons": rows})


async def h_stats_verify(ctx: HandlerContext) -> HandlerResult:
    facts = await _load_facts(ctx.db, ctx.project_id)
    metrics = list((await ctx.db.execute(
        select(ReproductionMetric).where(ReproductionMetric.project_id == ctx.project_id)
    )).scalars().all())
    numeric = [f for f in facts if (f.normalized_value or f.raw_value or "").strip()]
    if not numeric and not metrics:
        return HandlerResult(
            status=R_INSUFFICIENT, summary="缺少可核验的数值事实或指标记录，统计核验无法执行。",
            result={},
        )
    sample_size_facts = [f.field_key for f in facts
                          if normalize_field_key(f.field_key)[0] in ("sample_size", "n", "dataset_size")]
    result = {
        "numeric_facts": len(numeric), "metrics": len(metrics),
        "sample_size_present": bool(sample_size_facts),
        "sample_size_fields": sample_size_facts,
        "note": "统计显著性结论需结合样本量、分组与原始计数；本节点仅做可用性与口径核对。",
    }
    summary = f"数值事实 {len(numeric)} 条，指标 {len(metrics)} 条；样本量声明：" \
              f"{'已提供' if sample_size_facts else '未提供'}。"
    return HandlerResult(status=R_COMPLETED, summary=summary, result=result)


def _safe_json(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return None


HANDLERS: dict[str, Callable[[HandlerContext], Awaitable[HandlerResult]]] = {
    "materials_presence": h_materials_presence,
    "compare_parameter": h_compare_parameter,
    "fact_evidence_check": h_fact_evidence_check,
    "env_dependency_check": h_env_dependency_check,
    "dataset_quality_check": h_dataset_quality_check,
    "experiment_run": h_experiment_run,
    "model_evaluation": h_model_evaluation,
    "chart_verification_check": h_chart_verification_check,
    "ablation_check": h_ablation_check,
    "hyperparam_compare": h_hyperparam_compare,
    "stats_verify": h_stats_verify,
}


async def run_handler(ctx: HandlerContext) -> HandlerResult:
    """按 handler key 分发；未知处理器明确失败，不静默跳过。"""
    handler = HANDLERS.get(ctx.node.get("handler") or "")
    if handler is None:
        return HandlerResult(
            status=R_FAILED, error_code="UNKNOWN_HANDLER",
            error_message=f"未注册的处理器：{ctx.node.get('handler')!r}",
            summary="处理器未注册。",
        )
    try:
        return await handler(ctx)
    except Exception as exc:  # noqa: BLE001 - 处理器异常必须落为失败，不得冒充成功
        logger.error("workflow_handler_error node=%s handler=%s type=%s err=%s",
                     ctx.node.get("node_key"), ctx.node.get("handler"),
                     type(exc).__name__, str(exc)[:200])
        return HandlerResult(
            status=R_FAILED, error_code="HANDLER_ERROR",
            error_message=f"{type(exc).__name__}: {str(exc)[:200]}",
            summary="处理器执行异常。",
        )
