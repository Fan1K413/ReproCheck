"""集中式项目级数据隔离依赖（挂载到既有项目相关路由）。

从路径/查询/请求体解析 project_id；对实体 id（material/fact/plan/run/report/task）
反查其 project_id。非平台管理员/组织管理员必须为项目成员，否则 404（隐藏存在性）。

开发开关 allow_unauth_test_endpoints=True 且无令牌时放行（兼容本地演示）；
生产设为 False 后，项目相关读接口亦强制认证。
"""
from __future__ import annotations

import json
from importlib import import_module

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_project_permission, get_optional_user, resolve_project_access
from app.core.config import settings
from app.core.errors import AppError
from app.db import get_db
from app.models import ExtractedFact
from app.models.stage6 import User

# 同名路径参数在不同路由下代表不同实体。按路由选用实际资源的归属。
_ENTITY_LOOKUP = (
    ("/materials/", "material_id", "app.models", "Material", "id"),
    ("/reproductions/plans/", "plan_id", "app.models.stage4", "ReproductionPlan", "id"),
    ("/reproductions/runs/", "run_id", "app.models.stage4", "ReproductionRun", "id"),
    ("/audit-runs/", "run_id", "app.models", "AIRun", "id"),
    ("/reproductions/reports/", "report_id", "app.models.stage4", "ReproductionReport", "id"),
    ("/reproductions/tasks/", "task_id", "app.models.stage4", "ReproductionTask", "id"),
    ("/parse-tasks/", "task_id", "app.models.stage2", "ParseTask", "id"),
    ("/reproductions/remediations/", "proposal_id", "app.models.stage4", "RemediationProposal", "id"),
)


async def find_fact(db: AsyncSession, fact_id: str) -> ExtractedFact | None:
    row = (await db.scalars(select(ExtractedFact).where(ExtractedFact.fact_id == fact_id))).one_or_none()
    if row is not None:
        return row
    if len(fact_id) > 19 or not fact_id.isascii() or not fact_id.isdecimal():
        return None
    legacy_id = int(fact_id)
    if fact_id != str(legacy_id) or legacy_id > 2**63 - 1:
        return None
    row = await db.get(ExtractedFact, legacy_id)
    return row if row is not None and not row.fact_id else None


async def _resolve_project_id(request: Request, db: AsyncSession) -> str | None:
    pid = request.path_params.get("project_id")
    if pid:
        return pid

    path = request.scope["route"].path
    fact_id = request.path_params.get("fact_id")
    if fact_id and path.startswith("/api/v1/facts/"):
        fact = await find_fact(db, fact_id)
        if fact is None or not fact.project_id:
            raise AppError("NOT_FOUND", "事实不存在或无权访问。")
        return fact.project_id

    for prefix, param, module, name, key in _ENTITY_LOOKUP:
        eid = request.path_params.get(param)
        if not eid or not path.startswith(f"/api/v1{prefix}"):
            continue
        model = getattr(import_module(module), name)
        row = (await db.execute(select(model).where(getattr(model, key) == eid))).scalar_one_or_none()
        if row is None or not row.project_id:
            raise AppError("NOT_FOUND", "资源不存在或无权访问。")
        return row.project_id

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

    if not isinstance(candidate, str) or not candidate:
        return request.query_params.get("project_id")
    if body_project_id:
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
        if settings.allow_unauth_test_endpoints and "authorization" not in request.headers:
            return
        raise AppError("UNAUTHORIZED", "需要登录。", status_code=401)
    if user.is_platform_admin:
        return
    pid = await _resolve_project_id(request, db)
    if pid:
        await resolve_project_access(db, pid, user)


def require_project_write(permission: str):
    async def authorize(
        request: Request,
        db: AsyncSession = Depends(get_db),
        user: User | None = Depends(get_optional_user),
    ) -> None:
        if user is None:
            if settings.allow_unauth_test_endpoints and "authorization" not in request.headers:
                return
            raise AppError("UNAUTHORIZED", "需要登录。")
        project_id = await _resolve_project_id(request, db)
        if not project_id:
            raise AppError("VALIDATION_ERROR", "需要指定项目。")
        await check_project_permission(db, user, project_id, permission)

    return authorize
