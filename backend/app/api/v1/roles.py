"""角色与权限目录路由（只读，来自 RBAC 种子）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import AppError, ok
from app.db import get_db
from app.models.stage6 import Permission, Role, RolePermission, User

router = APIRouter(tags=["roles"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


@router.get("/roles")
async def list_roles(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Role))).scalars().all()
    items = [{"key": r.key, "name": r.name, "scope": r.scope, "description": r.description or ""} for r in rows]
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.get("/permissions")
async def list_permissions(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (await db.execute(select(Permission))).scalars().all()
    items = [{"key": p.key, "description": p.description or ""} for p in rows]
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.get("/roles/{role_key}/permissions")
async def role_permissions(role_key: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    role = (await db.execute(select(Role).where(Role.key == role_key))).scalar_one_or_none()
    if role is None:
        raise AppError("NOT_FOUND", "角色不存在。")
    rps = (await db.execute(select(RolePermission).where(RolePermission.role_id == role.id))).scalars().all()
    pids = [rp.permission_id for rp in rps]
    perms = (await db.execute(select(Permission).where(Permission.id.in_(pids)))).scalars().all() if pids else []
    return ok({"role_key": role_key, "permissions": [{"key": p.key, "description": p.description or ""} for p in perms]}, _rid(request))