"""基准案例路由（第六阶段 B 组）：案例 / 事实 / 验证 / 质量重算 / 检索。

契约见 docs/STAGE6_API_CONTRACT.md §3 与 docs/REPRODUCTION_BENCHMARK_SPEC.md。
所有输入模型 extra="forbid"：**任何接口都不接受 quality_level**，
质量等级只能由 POST /cases/{id}/quality/recompute 按验证证据计算。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import benchmark_service as svc
from app.services import case_search

router = APIRouter(tags=["cases"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class CaseCreateIn(BaseModel):
    """创建案例。quality_level/quality_evidence 为系统字段，提交即 422。"""
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    doi: str = ""
    source_url: str = ""
    domain: str = ""
    research_task: str = ""
    model_architecture: str = ""
    dataset_name: str = ""
    code_repo_url: str = ""
    code_commit: str = ""
    license: str = ""
    summary: str = ""
    org_id: str | None = None
    is_public: bool = False


class CaseFactIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_field: str = ""
    field_key: str = ""
    raw_value: str = ""
    value: str | None = None
    unit: str = ""
    source_type: str = "manual"
    source_ref: str = ""
    context: str = ""
    applicable_experiment: str = ""
    confidence: float = 0.0


class VerificationIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    verification_type: str
    result: str = "pass"
    conditions_json: dict[str, Any] | str | None = None
    notes: str = ""
    project_id: str | None = None


class RecomputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm_downgrade: bool = False


class SearchIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    query: str = ""
    filters: dict[str, Any] = Field(default_factory=dict)
    top_k: int = 10


@router.post("/cases")
async def create_case(payload: CaseCreateIn, request: Request,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_case(db, user, payload, _rid(request)), _rid(request))


@router.get("/cases")
async def list_cases(
    request: Request,
    domain: str | None = None,
    research_task: str | None = None,
    dataset: str | None = None,
    quality_level: str | None = None,
    q: str | None = None,
    org_id: str | None = None,
    is_public: bool | None = None,
    sort: str = Query("recent", pattern="^(recent|updated|quality|title)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    filters = {"domain": domain, "research_task": research_task, "dataset": dataset,
               "quality_level": quality_level, "q": q, "org_id": org_id,
               "is_public": is_public, "sort": sort, "limit": limit, "offset": offset}
    return ok(await svc.list_cases(db, user, filters), _rid(request))


@router.post("/cases/search")
async def search_cases(payload: SearchIn, request: Request,
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await case_search.search_cases(db, user, payload.query, payload.filters, payload.top_k)
    meta = case_search.search_meta(payload.query, len(items), payload.top_k)
    return ok({"items": items, **meta}, _rid(request))


@router.get("/cases/{case_id}")
async def get_case(case_id: str, request: Request,
                   db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.get_case(db, user, case_id), _rid(request))


@router.post("/cases/{case_id}/facts")
async def add_case_fact(case_id: str, payload: CaseFactIn, request: Request,
                        db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.add_case_fact(db, user, case_id, payload, _rid(request)), _rid(request))


@router.get("/cases/{case_id}/facts")
async def list_case_facts(case_id: str, request: Request,
                          field_key: str | None = None, category: str | None = None,
                          db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_case_facts(db, user, case_id, field_key, category)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/cases/{case_id}/verifications")
async def add_verification(case_id: str, payload: VerificationIn, request: Request,
                           db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    data = await svc.add_verification(
        db, user, case_id, payload.verification_type, payload.conditions_json,
        payload.result, payload.notes, _rid(request), payload.project_id,
    )
    return ok(data, _rid(request))


@router.get("/cases/{case_id}/verifications")
async def list_verifications(case_id: str, request: Request,
                             db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_verifications(db, user, case_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/cases/{case_id}/quality/recompute")
async def recompute_quality(case_id: str, request: Request,
                            payload: RecomputeIn | None = None,
                            db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    confirm = bool(payload.confirm_downgrade) if payload is not None else False
    return ok(await svc.recompute_quality(db, user, case_id, _rid(request), confirm), _rid(request))