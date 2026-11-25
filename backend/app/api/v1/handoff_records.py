"""第十二阶段 · 结构化人员交接路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import handoff_record_service as svc

router = APIRouter(tags=["handoff-records"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class InitiateIn(BaseModel):
    to_user_id: str
    note: str = ""


class RespondIn(BaseModel):
    accepted: bool
    note: str = ""


class ItemUpdateIn(BaseModel):
    status: str
    note: str = ""


@router.get("/projects/{project_id}/handoffs")
async def list_handoffs(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_handoffs(db, user, project_id)}, _rid(request))


@router.post("/projects/{project_id}/handoffs")
async def initiate(project_id: str, payload: InitiateIn, request: Request,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.initiate_handoff(db, user, project_id, payload.to_user_id, payload.note, _rid(request)), _rid(request))


@router.get("/handoffs/{handoff_id}")
async def get_handoff(handoff_id: str, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    return ok(await svc.get_handoff(db, user, handoff_id), _rid(request))


@router.post("/handoffs/{handoff_id}/respond")
async def respond(handoff_id: str, payload: RespondIn, request: Request,
                  db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.respond_handoff(db, user, handoff_id, payload.accepted, payload.note, _rid(request)), _rid(request))


@router.post("/handoffs/{handoff_id}/confirm")
async def confirm(handoff_id: str, request: Request, db: AsyncSession = Depends(get_db),
                  user: User = Depends(get_current_user)):
    return ok(await svc.confirm_handoff(db, user, handoff_id, _rid(request)), _rid(request))


@router.patch("/handoffs/{handoff_id}/items/{item_id}")
async def update_item(handoff_id: str, item_id: str, payload: ItemUpdateIn, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_item(db, user, handoff_id, item_id, payload.status, payload.note, _rid(request)), _rid(request))
