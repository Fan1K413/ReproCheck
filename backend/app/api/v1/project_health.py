"""第十二阶段 · 项目健康度路由（确定性指标，只读）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import health_service as svc

router = APIRouter(tags=["project-health"])


@router.get("/projects/{project_id}/health")
async def health(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    return ok(await svc.compute_health(db, user, project_id), getattr(request.state, "request_id", "-"))
