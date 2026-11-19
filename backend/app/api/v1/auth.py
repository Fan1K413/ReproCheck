"""认证路由：注册 / 登录 / 退出 / 当前身份。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import auth_service
from app.services.trail_service import record_trail

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterIn(BaseModel):
    email: str
    password: str
    display_name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


@router.post("/register")
async def register(payload: RegisterIn, request: Request, db: AsyncSession = Depends(get_db)):
    data = await auth_service.register(db, payload.email, payload.password, payload.display_name, _rid(request))
    return ok(data, _rid(request))


@router.post("/login")
async def login(payload: LoginIn, request: Request, db: AsyncSession = Depends(get_db)):
    data = await auth_service.login(db, payload.email, payload.password, _rid(request))
    return ok(data, _rid(request))


@router.post("/logout")
async def logout(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await record_trail(db, action="user.logout", actor_user_id=user.id, target_type="user",
                       target_id=user.id, summary="用户退出", request_id=_rid(request))
    await db.commit()
    return ok({"logged_out": True}, _rid(request))


@router.get("/me")
async def me(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await auth_service.me(db, user), _rid(request))