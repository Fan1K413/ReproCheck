"""集中式项目级数据隔离依赖（挂载到既有项目相关路由）。

从路径/查询/请求体解析 project_id；对实体 id（material/fact/plan/run/report/task）
反查其 project_id。非平台管理员/组织管理员必须为项目成员，否则 404（隐藏存在性）。

开发开关 allow_unauth_test_endpoints=True 且无令牌时放行（兼容本地演示）；
生产设为 False 后，项目相关读接口亦强制认证。
"""
from __future__ import annotations

import json

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_optional_user, resolve_project_access
from app.core.config import settings
from app.core.errors import AppError
from app.db import get_db
from app.models.stage6 import User

# 路径参数中的实体 id -> [(模型路径, 类名), ...]（run_id 兼容 AIRun 与 ReproductionRun）
_ENTITY_LOOKUP = {
    "material_id": [("app.models", "Material")],
    "fact_id": [("app.models", "ExtractedFact")],
    "plan_id": [("app.models.stage4", "ReproductionPlan")],
    "run_id": [("app.models.stage4", "ReproductionRun"), ("app.models", "AIRun")],
    "report_id": [("app.models.stage4", "ReproductionReport")],
    "task_id": [("app.models.stage4", "ReproductionTask")],
}


async def _resolve_project_id(request: Request, db: AsyncSession) -> str | None:
    # 1. 直接的 project_id（路径/查询）
    pid = request.path_params.get("project_id") or request.query_params.get("project_id")
    if pid:
        return pid

    # 2. 实体 id 反查（路径参数）
    import importlib
    for param, lookups in _ENTITY_LOOKUP.items():
        eid = request.path_params.get(param)
        if not eid:
            continue
        for mod, cls in lookups:
            model = getattr(importlib.import_module(mod), cls)
            row = (await db.execute(select(model).where(model.id == eid))).scalar_one_or_none()
            if row is not None:
                return getattr(row, "project_id", None)

    # 3. 请求体中的 project_id / plan_id / run_id
    candidate = None
    body: dict = {}
    body_project_id: str | None = None
    ctype = request.headers.get("content-type", "")
    if "application/json" in ctype:
        try:
            body = await request.json()
            if isinstance(body, dict):
                body_project_id = body.get("project_id")
                candidate = body_project_id or body.get("plan_id") or body.get("run_id")
        except (json.JSONDecodeError, ValueError):
            candidate = None
    elif "multipart/form-data" in ctype or "application/x-www-form-urlencoded" in ctype:
        try:
            form = await request.form()
            body_project_id = form.get("project_id")
            candidate = body_project_id
        except Exception:  # noqa: BLE001
            candidate = None

    if not candidate:
        return None
    if request.path_params.get("project_id") or body_project_id:
        return candidate
    from app.models.stage4 import ReproductionPlan, ReproductionRun
    for model in (ReproductionPlan, ReproductionRun):
        row = (await db.execute(select(model).where(model.id == candidate))).scalar_one_or_none()
        if row is not None:
            return row.project_id
    return candidate


async def enforce_project_isolation(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
) -> None:
    if user is None:
        if settings.allow_unauth_test_endpoints:
            return
        raise AppError("UNAUTHORIZED", "需要登录。", status_code=401)
    if user.is_platform_admin:
        return
    pid = await _resolve_project_id(request, db)
    if pid:
        await resolve_project_access(db, pid, user)