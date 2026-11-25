"""第七阶段 · 证据缺口与补证任务路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_project_permission, get_current_user, resolve_project_access
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.evidence_gap_service import EvidenceGapService

router = APIRouter(tags=["evidence-gaps"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class CreateTasksIn(BaseModel):
    gap_ids: list[str] | None = None


@router.get("/projects/{project_id}/evidence-gaps")
async def list_gaps(project_id: str, request: Request,
                    status: str | None = Query(None),
                    db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = EvidenceGapService(db)
    return ok({"items": await svc.list_gaps(project_id, status)}, _rid(request))


@router.post("/projects/{project_id}/evidence-gaps/analyze")
async def analyze_gaps(project_id: str, request: Request,
                       db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    await check_project_permission(db, user, project_id, "audit.run")
    svc = EvidenceGapService(db)
    summary = await svc.analyze(project_id, user_id=user.id)
    return ok({"summary": summary, "items": await svc.list_gaps(project_id)}, _rid(request))


@router.post("/projects/{project_id}/evidence-gaps/tasks")
async def create_tasks(project_id: str, payload: CreateTasksIn, request: Request,
                       db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    await check_project_permission(db, user, project_id, "audit.run")
    svc = EvidenceGapService(db)
    tasks = await svc.create_tasks(project_id, payload.gap_ids, user_id=user.id)
    return ok({"items": tasks}, _rid(request))


@router.get("/projects/{project_id}/evidence-tasks")
async def list_tasks(project_id: str, request: Request,
                     status: str | None = Query(None),
                     db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = EvidenceGapService(db)
    return ok({"items": await svc.list_tasks(project_id, status)}, _rid(request))


@router.post("/evidence-tasks/{task_id}/confirm")
async def confirm_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    svc = EvidenceGapService(db)
    task = await svc._get_task(task_id)
    await check_project_permission(db, user, task.project_id, "review.decide")
    await svc.confirm_task(task_id, user_id=user.id)
    return ok(svc._task_view(await svc._get_task(task_id)), _rid(request))


@router.post("/evidence-tasks/{task_id}/execute")
async def execute_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    svc = EvidenceGapService(db)
    task = await svc._get_task(task_id)
    await check_project_permission(db, user, task.project_id, "audit.run")
    await svc.execute_task(task_id, user_id=user.id)
    return ok(svc._task_view(await svc._get_task(task_id)), _rid(request))
