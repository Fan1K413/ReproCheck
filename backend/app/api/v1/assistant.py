"""第七阶段 · 科研任务自动化助手路由（自然语言建任务）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, resolve_project_access
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.assistant_service import AssistantService

router = APIRouter(tags=["assistant"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class PlanIn(BaseModel):
    query: str
    project_id: str | None = None


@router.post("/assistant/plan")
async def plan_task(payload: PlanIn, request: Request, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if payload.project_id:
        await resolve_project_access(db, payload.project_id, user)
    svc = AssistantService(db)
    result = await svc.plan(user, payload.project_id, payload.query, user_id=user.id)
    return ok(result, _rid(request))
