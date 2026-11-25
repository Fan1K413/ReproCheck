"""第十二阶段 · 科研协作工作流路由（里程碑 / 研究任务 / 复核队列）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import workflow_service as svc

router = APIRouter(tags=["workflow"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class MilestoneIn(BaseModel):
    title: str
    description: str = ""
    due_date: str | None = None
    owner_user_id: str | None = None
    linked_stage: str | None = None


class MilestoneUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    due_date: str | None = None
    owner_user_id: str | None = None
    linked_stage: str | None = None
    status: str | None = None


class TaskIn(BaseModel):
    title: str
    description: str = ""
    kind: str = "experiment"
    assignee_user_id: str | None = None
    priority: str = "medium"
    due_date: str | None = None
    related_type: str = ""
    related_id: str = ""


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    priority: str | None = None
    status: str | None = None
    due_date: str | None = None
    related_type: str | None = None
    related_id: str | None = None


class AssignIn(BaseModel):
    assignee_user_id: str


# 里程碑

@router.get("/projects/{project_id}/milestones")
async def list_milestones(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_milestones(db, user, project_id)}, _rid(request))


@router.post("/projects/{project_id}/milestones")
async def create_milestone(project_id: str, payload: MilestoneIn, request: Request,
                           db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_milestone(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/milestones/{milestone_id}")
async def update_milestone(project_id: str, milestone_id: str, payload: MilestoneUpdate, request: Request,
                           db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_milestone(db, user, project_id, milestone_id,
                                         payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 研究任务

@router.get("/projects/{project_id}/research-tasks")
async def list_tasks(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user),
                     status: str | None = Query(None), assignee_user_id: str | None = Query(None)):
    return ok({"items": await svc.list_tasks(db, user, project_id, status, assignee_user_id)}, _rid(request))


@router.post("/projects/{project_id}/research-tasks")
async def create_task(project_id: str, payload: TaskIn, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_task(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.post("/projects/{project_id}/research-tasks/{task_id}/assign")
async def assign_task(project_id: str, task_id: str, payload: AssignIn, request: Request,
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.assign_task(db, user, project_id, task_id, payload.assignee_user_id, _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/research-tasks/{task_id}")
async def update_task(project_id: str, task_id: str, payload: TaskUpdate, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_task(db, user, project_id, task_id,
                                     payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 复核队列

@router.get("/projects/{project_id}/review-queue")
async def review_queue(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    return ok(await svc.review_queue(db, user, project_id), _rid(request))
