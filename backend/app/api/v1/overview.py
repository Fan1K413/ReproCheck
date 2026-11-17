"""项目材料解析概览 API（所有数字来自真实 DB 聚合，禁止前端硬编码）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ok
from app.db import get_db
from app.models import AIRun, ExtractedFact, Material, Project
from app.models.stage2 import ParseTask

router = APIRouter(tags=["overview"])


@router.get("/projects/{project_id}/parse-overview")
async def parse_overview(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    project = (await db.execute(
        select(Project).where(Project.id == project_id)
    )).scalar_one_or_none()
    if project is None:
        raise AppError("NOT_FOUND", "项目不存在。")

    materials = (await db.execute(
        select(Material).where(Material.project_id == project_id)
    )).scalars().all()

    mat_counts = {k: 0 for k in (
        "total", "completed", "partially_completed", "failed", "pending"
    )}
    by_type: dict[str, int] = {}
    for m in materials:
        mat_counts["total"] += 1
        st = m.parse_status or "uploaded"
        if st in ("completed",):
            mat_counts["completed"] += 1
        elif st == "partially_completed":
            mat_counts["partially_completed"] += 1
        elif st == "failed":
            mat_counts["failed"] += 1
        else:
            mat_counts["pending"] += 1
        by_type[m.material_type] = by_type.get(m.material_type, 0) + 1

    facts = (await db.execute(
        select(ExtractedFact).where(ExtractedFact.project_id == project_id)
    )).scalars().all()
    fact_ids = [f.fact_id or str(f.id) for f in facts]

    from app.models.stage2 import EvidenceItem
    with_evidence = 0
    if fact_ids:
        with_evidence = (await db.execute(
            select(func.count(func.distinct(EvidenceItem.fact_id)))
            .where(EvidenceItem.fact_id.in_(fact_ids))
        )).scalar() or 0
    needs_review = sum(1 for f in facts if f.extraction_status == "needs_review")
    human_revised = sum(1 for f in facts if f.parser_source == "human")

    runs = (await db.execute(
        select(AIRun).where(
            AIRun.project_id == project_id, AIRun.run_type == "material_extraction"
        )
    )).scalars().all()
    total_calls = sum(r.calls or 0 for r in runs)
    total_tokens = sum(r.total_tokens or 0 for r in runs)

    # 任务状态（真实 DB）
    tasks = (await db.execute(
        select(ParseTask.status, func.count(ParseTask.id))
        .where(ParseTask.project_id == project_id)
        .group_by(ParseTask.status)
    )).all()
    task_counts = {row[0]: row[1] for row in tasks}

    return ok({
        "project_id": project_id,
        "materials": mat_counts,
        "facts": {
            "total": len(facts), "with_evidence": with_evidence,
            "needs_review": needs_review, "human_revised": human_revised,
        },
        "llm": {"total_calls": total_calls, "total_tokens": total_tokens},
        "tasks": task_counts,
        "by_type": by_type,
    }, getattr(request.state, "request_id", "-"))
