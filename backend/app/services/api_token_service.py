"""开放 API Token 与调用治理（D）：令牌哈希托管、scope 校验、速率限制、调用日志。

明文令牌（前缀 rc_live_）仅创建时返回一次；DB 只存 sha256。撤销/过期立即失效。
速率限制为进程内滑动窗口（每 token 每分钟），调用日志落 ApiCallLog（IP 仅存哈希）。
"""
from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import user_has_permission
from app.core.errors import AppError
from app.core.security import generate_token, hash_token, new_id
from app.models.stage6 import ApiCallLog, ApiToken, OrgMember, User
from app.services.trail_service import record_trail

VALID_SCOPES = {
    "project.read", "project.write", "material.write",
    "audit.run", "audit.read", "repro.read", "report.read",
}

# 进程内速率窗口：token_id -> deque[timestamp]
_RATE_WINDOW: dict[str, deque] = defaultdict(deque)


def _view(t: ApiToken) -> dict:
    return {
        "token_id": t.id, "name": t.name, "prefix": t.prefix,
        "scopes": json.loads(t.scopes_json or "[]"),
        "rate_limit_per_min": t.rate_limit_per_min,
        "org_id": t.org_id, "is_revoked": t.is_revoked,
        "expires_at": t.expires_at.isoformat() if t.expires_at else None,
        "last_used_at": t.last_used_at.isoformat() if t.last_used_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


async def create_token(db: AsyncSession, user: User, payload: dict, rid: str) -> dict:
    scopes = payload.get("scopes") or []
    bad = [s for s in scopes if s not in VALID_SCOPES]
    if bad:
        raise AppError("VALIDATION_ERROR", f"非法 scope：{bad}")
    if not scopes:
        raise AppError("VALIDATION_ERROR", "至少需要一个 scope。")
    org_id = payload.get("org_id")
    if not org_id:
        rows = (await db.execute(select(OrgMember.org_id).where(OrgMember.user_id == user.id))).scalars().all()
        org_id = rows[0] if rows else None
    if not await user_has_permission(db, user, "api.manage", org_id=org_id):
        raise AppError("FORBIDDEN", "缺少权限：api.manage")
    plain, hashed = generate_token("rc_live")
    expires_at = None
    if payload.get("expires_at"):
        expires_at = datetime.fromisoformat(payload["expires_at"])
    t = ApiToken(
        id=new_id("tok"), user_id=user.id, org_id=org_id, name=payload.get("name", "API Token"),
        token_hash=hashed, prefix="rc_live_", scopes_json=json.dumps(scopes, ensure_ascii=False),
        rate_limit_per_min=int(payload.get("rate_limit_per_min") or 60), expires_at=expires_at,
    )
    db.add(t)
    await record_trail(db, action="api_token.create", actor_user_id=user.id, org_id=org_id,
                       target_type="api_token", target_id=t.id, after={"scopes": scopes},
                       summary="创建开放 API Token", request_id=rid)
    await db.commit()
    await db.refresh(t)
    view = _view(t)
    view["token"] = plain  # 明文仅此一次
    return view


async def list_tokens(db: AsyncSession, user: User) -> list[dict]:
    rows = (await db.execute(select(ApiToken).where(ApiToken.user_id == user.id))).scalars().all()
    return [_view(t) for t in rows]


async def _get_token(db: AsyncSession, user: User, token_id: str) -> ApiToken:
    t = (await db.execute(select(ApiToken).where(ApiToken.id == token_id))).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "Token 不存在。")
    if t.user_id == user.id or user.is_platform_admin:
        return t
    if await user_has_permission(db, user, "api.manage", org_id=t.org_id):
        return t
    raise AppError("NOT_FOUND", "Token 不存在或无权访问。")


async def revoke_token(db: AsyncSession, user: User, token_id: str, rid: str) -> dict:
    t = await _get_token(db, user, token_id)
    t.is_revoked = True
    await record_trail(db, action="api_token.revoke", actor_user_id=user.id, org_id=t.org_id,
                       target_type="api_token", target_id=t.id, summary="撤销 API Token", request_id=rid)
    await db.commit()
    return _view(t)


async def list_logs(db: AsyncSession, user: User, token_id: str, limit: int = 50) -> list[dict]:
    await _get_token(db, user, token_id)
    rows = (await db.execute(select(ApiCallLog).where(ApiCallLog.token_id == token_id)
                             .order_by(ApiCallLog.created_at.desc()).limit(limit))).scalars().all()
    return [{
        "log_id": r.id, "endpoint": r.endpoint, "method": r.method,
        "status_code": r.status_code, "duration_ms": r.duration_ms,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    } for r in rows]


async def authenticate(db: AsyncSession, plain_token: str) -> ApiToken:
    if not plain_token or not plain_token.startswith("rc_live_"):
        raise AppError("UNAUTHORIZED", "无效的开放 API 令牌。", status_code=401)
    hashed = hash_token(plain_token)
    t = (await db.execute(select(ApiToken).where(ApiToken.token_hash == hashed))).scalar_one_or_none()
    if t is None or t.is_revoked:
        raise AppError("UNAUTHORIZED", "令牌不存在或已撤销。", status_code=401)
    if t.expires_at and t.expires_at.replace(tzinfo=timezone.utc) < datetime.now(timezone.utc):
        raise AppError("UNAUTHORIZED", "令牌已过期。", status_code=401)
    t.last_used_at = datetime.now(timezone.utc)
    return t


def check_scope(t: ApiToken, scope: str) -> None:
    scopes = json.loads(t.scopes_json or "[]")
    if scope not in scopes:
        raise AppError("FORBIDDEN", f"令牌缺少 scope：{scope}")


def check_rate_limit(t: ApiToken) -> None:
    now = time.monotonic()
    window = _RATE_WINDOW[t.id]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= t.rate_limit_per_min:
        raise AppError("RATE_LIMITED", "开放 API 调用超过速率限制，请稍后重试。", status_code=429)
    window.append(now)


async def log_call(db: AsyncSession, t: ApiToken, endpoint: str, method: str,
                   status_code: int, duration_ms: int, ip: str = "") -> None:
    db.add(ApiCallLog(
        id=new_id("apilog"), token_id=t.id, endpoint=endpoint, method=method,
        status_code=status_code, duration_ms=duration_ms,
        ip_hash=hashlib.sha256(ip.encode()).hexdigest() if ip else "",
    ))
    await db.commit()