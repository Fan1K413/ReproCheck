"""统一可信结论 API（项目隔离由 api_router 挂载时统一注入）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.verdict_service import build_project_verdict

router = APIRouter(tags=["verdict"])


@router.get("/projects/{project_id}/verdict-summary")
async def verdict_summary(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """返回项目级五态分布、证据定位率与 ACM 三维自检结论。"""
    _ = user  # 依赖用于强制认证，聚合本身只按 project_id 读取。
    result = await build_project_verdict(db, project_id)
    return ok(result, getattr(request.state, "request_id", "-"))
