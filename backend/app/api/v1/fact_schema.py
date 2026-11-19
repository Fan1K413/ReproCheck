"""标准科研事实字段目录路由（第六阶段 B 组）。

GET /fact-schema：返回字段目录（类别/单位/别名/值类型）与归一化规则说明，
供前端事实录入表单、字段映射与比对视图使用。目录本体见 services/fact_schema.py。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.fact_schema import fact_schema_view

router = APIRouter(tags=["cases"])


@router.get("/fact-schema")
async def get_fact_schema(request: Request,
                          db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    rid = getattr(request.state, "request_id", "-")
    return ok(fact_schema_view(), rid)