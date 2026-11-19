"""路由级依赖：请求 ID、认证、RBAC 权限与项目级数据隔离。

第六阶段起，身份与权限一律在后端校验；前端隐藏按钮不构成权限。
- get_current_user：解析 Bearer JWT，失败 401。
- resolve_project_access：项目可见性 + 角色等级；非成员 404（隐藏存在性），角色不足 403。
- require_permission：org/project 级权限校验工厂。
- require_admin：兼容旧共享令牌，同时接受已认证用户。
"""
from __future__ import annotations

import jwt
from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.rbac import PROJECT_ROLE_RANK, role_permissions
from app.core.security import decode_access_token
from app.db import get_db
from app.models import Project
from app.models.stage6 import OrgMember, ProjectMember, User


async def get_optional_user(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> User | None:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        claims = decode_access_token(token)
    except jwt.PyJWTError:
        return None
    user = (await db.execute(select(User).where(User.id == claims.get("sub")))).scalar_one_or_none()
    if not user or not user.is_active:
        return None
    request.state.user = user
    return user


async def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise AppError("UNAUTHORIZED", "需要登录：请提供有效的 Bearer 令牌。", status_code=401)
    return user


async def require_write_user(
    request: Request,
    user: User | None = Depends(get_optional_user),
) -> User:
    """写操作专用依赖：无条件要求已认证用户，不因开发开关放行匿名。

    与 require_admin 的区别：require_admin 为兼容旧测试在 allow_unauth_test_endpoints=True
    时静默放行；本依赖杜绝匿名执行 pause/resume/cancel/retry 等状态变更。
    """
    if user is None:
        raise AppError("UNAUTHORIZED", "该操作需要登录。", status_code=401)
    return user


async def require_admin(
    request: Request,
    db: AsyncSession = Depends(get_db),
    x_admin_token: str | None = Header(default=None),
    user: User | None = Depends(get_optional_user),
) -> None:
    """兼容旧 X-Admin-Token；第六阶段亦接受已认证用户（研究人员可执行审计）。"""
    if settings.admin_token and x_admin_token == settings.admin_token:
        return
    if user is not None:
        return
    if settings.admin_token:
        raise AppError("FORBIDDEN", "需要有效的 X-Admin-Token 或登录令牌。")
    if not settings.allow_unauth_test_endpoints:
        raise AppError("FORBIDDEN", "服务端未开放此接口。")


async def _org_role(db: AsyncSession, org_id: str, user_id: str) -> str | None:
    row = (await db.execute(select(OrgMember).where(
        OrgMember.org_id == org_id, OrgMember.user_id == user_id))).scalar_one_or_none()
    return row.role_key if row else None


async def _project_role(db: AsyncSession, project_id: str, user_id: str) -> str | None:
    row = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))).scalar_one_or_none()
    return row.role_key if row else None


async def user_has_permission(
    db: AsyncSession, user: User, perm: str,
    org_id: str | None = None, project_id: str | None = None,
) -> bool:
    if user.is_platform_admin:
        return True
    if project_id and not org_id:
        proj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
        org_id = proj.org_id if proj else None
    if org_id:
        orole = await _org_role(db, org_id, user.id)
        if orole == "org_admin":
            return True
        if orole and perm in role_permissions(orole):
            return True
    if project_id:
        prole = await _project_role(db, project_id, user.id)
        if prole and perm in role_permissions(prole):
            return True
    return False


async def resolve_project_access(
    db: AsyncSession, project_id: str, user: User, min_rank: int = 0,
) -> Project:
    """返回可访问的项目；非成员 404，角色不足 403。平台管理员/组织管理员合法 bypass。"""
    proj = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()
    if proj is None:
        raise AppError("NOT_FOUND", "项目不存在或无权访问。")
    if user.is_platform_admin:
        return proj
    if proj.org_id:
        orole = await _org_role(db, proj.org_id, user.id)
        if orole == "org_admin":
            return proj
    prole = await _project_role(db, project_id, user.id)
    if prole is None:
        raise AppError("NOT_FOUND", "项目不存在或无权访问。")
    if PROJECT_ROLE_RANK.get(prole, 0) < min_rank:
        raise AppError("FORBIDDEN", "当前角色无权执行此操作。")
    return proj


def require_permission(perm: str, org_param: str = "org_id", project_param: str = "project_id"):
    """权限校验依赖工厂：从路径/查询参数取 org_id/project_id 后校验。"""
    async def _dep(
        request: Request,
        db: AsyncSession = Depends(get_db),
        user: User = Depends(get_current_user),
    ) -> User:
        org_id = request.path_params.get(org_param) or request.query_params.get(org_param)
        project_id = request.path_params.get(project_param) or request.query_params.get(project_param)
        if not await user_has_permission(db, user, perm, org_id=org_id, project_id=project_id):
            raise AppError("FORBIDDEN", f"缺少权限：{perm}")
        return user
    return _dep