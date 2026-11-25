"""第十二阶段 · 科研生命周期路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import lifecycle_service as svc

router = APIRouter(tags=["lifecycle"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class StageIn(BaseModel):
    status: str
    note: str = ""


class QuestionIn(BaseModel):
    title: str
    hypothesis: str = ""
    background: str = ""
    status: str = "draft"
    priority: str = "medium"
    owner_user_id: str | None = None
    source_refs: list = []
    conclusion: str = ""


class QuestionUpdate(BaseModel):
    title: str | None = None
    hypothesis: str | None = None
    background: str | None = None
    status: str | None = None
    priority: str | None = None
    owner_user_id: str | None = None
    source_refs: list | None = None
    conclusion: str | None = None


class DatasetIn(BaseModel):
    name: str
    source_type: str = "attached_material"
    material_ids: list = []
    version: str = "v1"
    license: str = ""
    size_rows: int | None = None
    schema: dict = {}
    split_info: dict = {}
    integrity_hash: str | None = None
    provenance_ref: str = ""
    status: str = "registered"
    notes: str = ""
    owner_user_id: str | None = None


class DatasetUpdate(BaseModel):
    name: str | None = None
    source_type: str | None = None
    version: str | None = None
    license: str | None = None
    size_rows: int | None = None
    schema: dict | None = None
    split_info: dict | None = None
    material_ids: list | None = None
    integrity_hash: str | None = None
    provenance_ref: str | None = None
    status: str | None = None
    notes: str | None = None
    owner_user_id: str | None = None


class DesignIn(BaseModel):
    title: str
    research_question_id: str | None = None
    hypothesis: str = ""
    variables: dict = {}
    controls: list = []
    expected_outcome: str = ""
    method: str = ""


class DesignReviewIn(BaseModel):
    status: str
    reviewer_user_id: str | None = None


class ExperimentIn(BaseModel):
    title: str
    design_id: str | None = None
    owner_user_id: str | None = None
    linked_plan_id: str | None = None
    linked_run_id: str | None = None
    dataset_ids: list = []
    config_ref: dict = {}
    result_summary: str = ""
    conclusion: str = ""
    evidence_refs: list = []
    notes: str = ""


class ExperimentUpdate(BaseModel):
    status: str | None = None
    result_summary: str | None = None
    conclusion: str | None = None
    notes: str | None = None
    owner_user_id: str | None = None
    evidence_refs: list | None = None
    config_ref: dict | None = None


class ManuscriptIn(BaseModel):
    title: str
    section: str = ""
    linked_facts: list = []
    linked_materials: list = []
    body: str = ""


class ManuscriptUpdate(BaseModel):
    title: str | None = None
    section: str | None = None
    body: str | None = None
    linked_facts: list | None = None
    linked_materials: list | None = None
    status: str | None = None


class ArchiveIn(BaseModel):
    reason: str = ""


# 阶段板

@router.get("/projects/{project_id}/lifecycle/board")
async def board(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                user: User = Depends(get_current_user)):
    return ok(await svc.get_stage_board(db, project_id, user), _rid(request))


@router.post("/projects/{project_id}/lifecycle/stages/{stage}")
async def set_stage(project_id: str, stage: str, payload: StageIn, request: Request,
                    db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.set_stage_status(db, user, project_id, stage, payload.status, payload.note, _rid(request)), _rid(request))


# 研究问题

@router.get("/projects/{project_id}/questions")
async def list_questions(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_questions(db, project_id, user)}, _rid(request))


@router.post("/projects/{project_id}/questions")
async def create_question(project_id: str, payload: QuestionIn, request: Request,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_question(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/questions/{question_id}")
async def update_question(project_id: str, question_id: str, payload: QuestionUpdate, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_question(db, user, project_id, question_id, payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 数据集

@router.get("/projects/{project_id}/datasets")
async def list_datasets(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_datasets(db, project_id, user)}, _rid(request))


@router.post("/projects/{project_id}/datasets")
async def create_dataset(project_id: str, payload: DatasetIn, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_dataset(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/datasets/{dataset_id}")
async def update_dataset(project_id: str, dataset_id: str, payload: DatasetUpdate, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_dataset(db, user, project_id, dataset_id, payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 实验设计

@router.get("/projects/{project_id}/designs")
async def list_designs(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_designs(db, project_id, user)}, _rid(request))


@router.post("/projects/{project_id}/designs")
async def create_design(project_id: str, payload: DesignIn, request: Request,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_design(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.post("/projects/{project_id}/designs/{design_id}/review")
async def review_design(project_id: str, design_id: str, payload: DesignReviewIn, request: Request,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.review_design(db, user, project_id, design_id, payload.status,
                                      payload.reviewer_user_id, _rid(request)), _rid(request))


# 实验

@router.get("/projects/{project_id}/experiments")
async def list_experiments(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_experiments(db, project_id, user)}, _rid(request))


@router.post("/projects/{project_id}/experiments")
async def create_experiment(project_id: str, payload: ExperimentIn, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_experiment(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/experiments/{experiment_id}")
async def update_experiment(project_id: str, experiment_id: str, payload: ExperimentUpdate, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_experiment_status(db, user, project_id, experiment_id,
                                                 payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 稿件

@router.get("/projects/{project_id}/manuscripts")
async def list_manuscripts(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    return ok({"items": await svc.list_manuscripts(db, project_id, user)}, _rid(request))


@router.post("/projects/{project_id}/manuscripts")
async def create_manuscript(project_id: str, payload: ManuscriptIn, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_manuscript(db, user, project_id, payload.model_dump(), _rid(request)), _rid(request))


@router.patch("/projects/{project_id}/manuscripts/{manuscript_id}")
async def update_manuscript(project_id: str, manuscript_id: str, payload: ManuscriptUpdate, request: Request,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.update_manuscript(db, user, project_id, manuscript_id,
                                          payload.model_dump(exclude_none=True), _rid(request)), _rid(request))


# 归档

@router.post("/projects/{project_id}/archive")
async def archive(project_id: str, payload: ArchiveIn, request: Request,
                  db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.archive_project(db, user, project_id, payload.reason, _rid(request)), _rid(request))


@router.post("/projects/{project_id}/reopen")
async def reopen(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                 user: User = Depends(get_current_user)):
    return ok(await svc.reopen_project(db, user, project_id, _rid(request)), _rid(request))
