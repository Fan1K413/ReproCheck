"""第七阶段 · 失败智能恢复路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_project_permission, get_current_user, resolve_project_access
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.recovery_service import RecoveryService

router = APIRouter(tags=["recovery"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class FailureIn(BaseModel):
    raw_log: str
    run_id: str | None = None
    workflow_id: str | None = None
    node_id: str | None = None


class ReviewIn(BaseModel):
    decision: str
    note: str = ""


class ApplyIn(BaseModel):
    consent_skip_test: bool = False


@router.get("/projects/{project_id}/recovery-plans")
async def list_plans(project_id: str, request: Request,
                     status: str | None = None,
                     db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = RecoveryService(db)
    return ok({"items": await svc.list_plans(project_id, status)}, _rid(request))


@router.post("/projects/{project_id}/recovery-plans/from-failure")
async def create_from_failure(project_id: str, payload: FailureIn, request: Request,
                              db: AsyncSession = Depends(get_db),
                              user: User = Depends(get_current_user)):
    await check_project_permission(db, user, project_id, "audit.run")
    svc = RecoveryService(db)
    plan = await svc.create_plan(
        project_id, raw_log=payload.raw_log, run_id=payload.run_id,
        workflow_id=payload.workflow_id, node_id=payload.node_id, user_id=user.id,
    )
    return ok(await svc.plan_view(plan.id), _rid(request))


@router.post("/recovery-plans/{plan_id}/review")
async def review_plan(plan_id: str, payload: ReviewIn, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    svc = RecoveryService(db)
    plan = await svc._get(plan_id)
    await check_project_permission(db, user, plan.project_id, "review.decide")
    await svc.review_plan(plan_id, payload.decision, note=payload.note, user_id=user.id)
    return ok(await svc.plan_view(plan_id), _rid(request))


@router.post("/recovery-plans/{plan_id}/apply")
async def apply_plan(plan_id: str, payload: ApplyIn, request: Request,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    svc = RecoveryService(db)
    plan = await svc._get(plan_id)
    await check_project_permission(db, user, plan.project_id, "audit.run")
    await svc.apply_plan(plan_id, consent_skip_test=payload.consent_skip_test, user_id=user.id)
    return ok(await svc.plan_view(plan_id), _rid(request))
