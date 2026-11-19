"""项目协作路由：成员 / 评论 / 复核 / 活动记录。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import collab_service as svc

router = APIRouter(tags=["collaboration"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class MemberIn(BaseModel):
    user_id: str
    role_key: str = "researcher"


class RoleIn(BaseModel):
    role_key: str


class CommentIn(BaseModel):
    target_type: str
    target_id: str
    body: str


class ReviewIn(BaseModel):
    target_type: str
    target_id: str
    reviewer_user_id: str | None = None


class DecideIn(BaseModel):
    status: str
    decision_note: str = ""


@router.post("/projects/{project_id}/members")
async def add_member(project_id: str, payload: MemberIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.add_project_member(db, user, project_id, payload.user_id, payload.role_key, _rid(request)), _rid(request))


@router.get("/projects/{project_id}/members")
async def list_members(project_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_project_members(db, user, project_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.patch("/projects/{project_id}/members/{user_id}")
async def update_member(project_id: str, user_id: str, payload: RoleIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_project_member(db, user, project_id, user_id, payload.role_key, _rid(request)), _rid(request))


@router.delete("/projects/{project_id}/members/{user_id}")
async def remove_member(project_id: str, user_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.remove_project_member(db, user, project_id, user_id, _rid(request)), _rid(request))


@router.post("/projects/{project_id}/comments")
async def create_comment(project_id: str, payload: CommentIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_comment(db, user, project_id, payload.target_type, payload.target_id, payload.body, _rid(request)), _rid(request))


@router.get("/projects/{project_id}/comments")
async def list_comments(project_id: str, request: Request, target_type: str | None = None, target_id: str | None = None,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_comments(db, user, project_id, target_type, target_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.delete("/comments/{comment_id}")
async def delete_comment(comment_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.delete_comment(db, user, comment_id, _rid(request)), _rid(request))


@router.post("/projects/{project_id}/reviews")
async def create_review(project_id: str, payload: ReviewIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_review(db, user, project_id, payload.target_type, payload.target_id, payload.reviewer_user_id, _rid(request)), _rid(request))


@router.get("/projects/{project_id}/reviews")
async def list_reviews(project_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_reviews(db, user, project_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/reviews/{review_id}/decide")
async def decide_review(review_id: str, payload: DecideIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.decide_review(db, user, review_id, payload.status, payload.decision_note, _rid(request)), _rid(request))


@router.get("/projects/{project_id}/activity")
async def list_activity(project_id: str, request: Request, limit: int = Query(50, le=200), offset: int = Query(0, ge=0),
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.list_activity(db, user, project_id, limit, offset), _rid(request))