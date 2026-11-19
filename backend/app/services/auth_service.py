"""认证服务：注册、登录、当前身份。密码 pbkdf2 哈希；JWT HS256。"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.security import (
    create_access_token,
    hash_password,
    new_id,
    verify_password,
)
from app.models.stage6 import OrgMember, Organization, User
from app.services.trail_service import record_trail

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def user_view(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "display_name": u.display_name or "",
        "is_platform_admin": u.is_platform_admin,
        "created_at": u.created_at.isoformat() if u.created_at else "",
        "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
    }


async def register(db: AsyncSession, email: str, password: str, display_name: str, request_id: str = "") -> dict:
    email = email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise AppError("VALIDATION_ERROR", "邮箱格式不正确。")
    if len(password) < 8:
        raise AppError("VALIDATION_ERROR", "密码至少 8 位。")
    exists = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if exists:
        raise AppError("CONFLICT", "该邮箱已注册。")
    user = User(id=new_id("user"), email=email, password_hash=hash_password(password),
                display_name=display_name.strip() or email.split("@")[0], is_active=True)
    db.add(user)
    await db.flush()

    # 为每个用户创建个人组织，使其可立即创建项目
    slug = f"u-{user.id[-12:]}"
    org = Organization(id=new_id("org"), name=f"{user.display_name} 的工作空间",
                       slug=slug, description="注册时自动创建的个人组织。", owner_user_id=user.id)
    db.add(org)
    await db.flush()
    db.add(OrgMember(id=new_id("om"), org_id=org.id, user_id=user.id, role_key="org_admin"))
    await record_trail(db, action="user.register", actor_user_id=user.id, org_id=org.id,
                       target_type="user", target_id=user.id, summary="用户注册", request_id=request_id)
    await db.commit()
    await db.refresh(user)
    return {"token": create_access_token(user.id, user.email), "user": user_view(user)}


async def login(db: AsyncSession, email: str, password: str, request_id: str = "") -> dict:
    email = email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise AppError("UNAUTHORIZED", "邮箱或密码错误。", status_code=401)
    if not user.is_active:
        raise AppError("FORBIDDEN", "账户已停用。")
    user.last_login_at = datetime.now(timezone.utc)
    await record_trail(db, action="user.login", actor_user_id=user.id,
                       target_type="user", target_id=user.id, summary="用户登录", request_id=request_id)
    await db.commit()
    return {"token": create_access_token(user.id, user.email), "user": user_view(user)}


async def me(db: AsyncSession, user: User) -> dict:
    memberships = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().all()
    orgs = []
    for m in memberships:
        org = (await db.execute(select(Organization).where(Organization.id == m.org_id))).scalar_one_or_none()
        if org:
            orgs.append({"id": org.id, "name": org.name, "slug": org.slug, "role_key": m.role_key})
    return {"user": user_view(user), "organizations": orgs}