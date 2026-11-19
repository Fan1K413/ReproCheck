"""开放 API Token 管理路由（D）。明文令牌仅创建响应返回一次。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import api_token_service as svc

router = APIRouter(tags=["api-tokens"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class TokenIn(BaseModel):
    name: str = "API Token"
    scopes: list[str]
    rate_limit_per_min: int = 60
    expires_at: str | None = None
    org_id: str | None = None


@router.post("/api-tokens")
async def create(payload: TokenIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_token(db, user, payload.model_dump(), _rid(request)), _rid(request))


@router.get("/api-tokens")
async def list_tokens(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_tokens(db, user)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/api-tokens/{token_id}/revoke")
async def revoke(token_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.revoke_token(db, user, token_id, _rid(request)), _rid(request))


@router.get("/api-tokens/{token_id}/logs")
async def logs(token_id: str, request: Request, limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_logs(db, user, token_id, limit)
    return ok({"items": items, "total": len(items)}, _rid(request))