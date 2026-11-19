"""C 组 · 审计反馈治理路由。

POST /feedback 项目成员可提交；GET /feedback 项目成员可读；
POST /feedback/{id}/triage 需 finding.review（service 内校验）。
单条反馈绝不自动改规则；争议（disputed）转人工复核。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import feedback_service as svc

router = APIRouter(tags=["audit-feedback"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class FeedbackIn(BaseModel):
    project_id: str
    finding_id: str | None = None
    run_id: str | None = None
    feedback_type: str
    note: str = ""
    evidence_ref: str = ""
    context_json: dict | None = None


class TriageIn(BaseModel):
    status: str
    resolution: str = ""


@router.post("/feedback")
async def create_feedback(payload: FeedbackIn, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    data = await svc.create_feedback(db, user, payload.project_id, payload.finding_id, payload.feedback_type,
                                     payload.note, payload.evidence_ref, payload.context_json,
                                     payload.run_id, _rid(request))
    return ok(data, _rid(request))


@router.get("/feedback")
async def list_feedback(request: Request, project_id: str = Query(...), status: str | None = None,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_feedback(db, user, project_id, status)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/feedback/{feedback_id}/triage")
async def triage_feedback(feedback_id: str, payload: TriageIn, request: Request,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.triage_feedback(db, user, feedback_id, payload.status, payload.resolution, _rid(request)), _rid(request))