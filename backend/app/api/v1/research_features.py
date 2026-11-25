"""第十一阶段新增科研功能的 API：实验差异分析 + 项目变化监控。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, resolve_project_access
from app.api.v1.modelhub import EnvelopedRoute
from app.core.errors import AppError
from app.db import get_db
from app.models.stage4 import ReproductionRun
from app.models.stage6 import User
from app.services.change_monitor_service import analyze as analyze_changes, create_review_plan
from app.services.experiment_diff_service import compare_runs

router = APIRouter(route_class=EnvelopedRoute)


class DiffIn(BaseModel):
    project_id: str
    run_ids: list[str]


class ReviewPlanIn(BaseModel):
    project_id: str
    snapshot_id: str
    confirmed: bool = False
    title: str | None = None


@router.post("/experiments/diff")
async def experiment_diff(body: DiffIn, user: User = Depends(get_current_user),
                          db: AsyncSession = Depends(get_db)):
    return await compare_runs(db, user, body.project_id, body.run_ids)


@router.get("/experiments/runs")
async def list_runs(project_id: str, user: User = Depends(get_current_user),
                    db: AsyncSession = Depends(get_db)):
    await resolve_project_access(db, project_id, user)
    rows = (await db.execute(select(ReproductionRun).where(
        ReproductionRun.project_id == project_id).order_by(
        ReproductionRun.created_at.desc()).limit(100))).scalars().all()
    return [{"id": r.id, "status": r.status, "plan_id": r.plan_id,
             "started_at": r.started_at.isoformat() if r.started_at else None,
             "duration_ms": r.duration_ms, "error_message": r.error_message}
            for r in rows]


@router.get("/change-monitor/analyze")
async def change_monitor(project_id: str, user: User = Depends(get_current_user),
                         db: AsyncSession = Depends(get_db)):
    return await analyze_changes(db, user, project_id)


@router.post("/change-monitor/create-review-plan")
async def create_plan(body: ReviewPlanIn, user: User = Depends(get_current_user),
                      db: AsyncSession = Depends(get_db)):
    if not body.confirmed:
        raise AppError("VALIDATION_ERROR", "需要用户显式确认。")
    return await create_review_plan(db, user, body.project_id, body.snapshot_id,
                                    body.confirmed, body.title)
