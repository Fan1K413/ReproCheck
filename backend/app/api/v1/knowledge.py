"""第十二阶段 · 版本化知识库路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import knowledge_service as svc

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class EntryIn(BaseModel):
    category: str
    title: str
    body: str
    summary: str = ""
    source_type: str = "manual"
    source_ref: dict = {}
    project_id: str | None = None
    org_id: str | None = None
    visibility: str = "org"
    links: list = []


class ReviseIn(BaseModel):
    body: str
    summary: str | None = None
    change_note: str = ""
    source_ref: dict | None = None


class StatusIn(BaseModel):
    status: str
    reason: str = ""


class CorrectionIn(BaseModel):
    kind: str
    note: str
    evidence_ref: dict = {}


class CorrectionResolveIn(BaseModel):
    status: str
    resolution_note: str = ""


@router.get("/entries")
async def list_entries(request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user),
                       category: str | None = Query(None), status: str | None = Query(None),
                       project_id: str | None = Query(None)):
    return ok({"items": await svc.list_entries(db, user, category, status, project_id)}, _rid(request))


@router.post("/entries")
async def create_entry(payload: EntryIn, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    return ok(await svc.create_entry(db, user, payload.model_dump(), _rid(request)), _rid(request))


@router.get("/entries/{entry_id}")
async def get_entry(entry_id: str, request: Request, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    return ok(await svc.get_entry(db, user, entry_id), _rid(request))


@router.post("/entries/{entry_id}/revise")
async def revise_entry(entry_id: str, payload: ReviseIn, request: Request,
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.revise_entry(db, user, entry_id, payload.model_dump(), _rid(request)), _rid(request))


@router.post("/entries/{entry_id}/status")
async def set_status(entry_id: str, payload: StatusIn, request: Request,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.set_entry_status(db, user, entry_id, payload.status, payload.reason, _rid(request)), _rid(request))


@router.post("/entries/{entry_id}/corrections")
async def report_correction(entry_id: str, payload: CorrectionIn, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.report_correction(db, user, entry_id, payload.model_dump(), _rid(request)), _rid(request))


@router.post("/corrections/{correction_id}/resolve")
async def resolve_correction(correction_id: str, payload: CorrectionResolveIn, request: Request,
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.resolve_correction(db, user, correction_id, payload.status,
                                           payload.resolution_note, _rid(request)), _rid(request))
