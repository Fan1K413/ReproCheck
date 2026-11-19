"""C 组 · 审计规则生命周期路由。

权限：读取需认证；创建 / 启停 / 新版本 / 回滚 / 测试 / 评估需 rule.manage（org 级，
由 service 内 resolve_rule_org 校验，因为规则表是平台全局、路径无 org_id）。
路由由 owner 在 app/api/__init__.py 挂载（本模块自带认证与 RBAC，无需项目隔离依赖）。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import rule_eval, rule_service as svc

router = APIRouter(tags=["audit-rules"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class TestSampleIn(BaseModel):
    input: dict
    expected: dict
    label: str = ""


class RuleCreateIn(BaseModel):
    rule_key: str
    name: str
    domain: str = ""
    description: str = ""
    risk_level: str = "medium"
    evidence_requirement: str = ""
    check_logic_json: dict
    change_note: str = "初始版本"
    test_samples: list[TestSampleIn] = Field(default_factory=list)
    is_enabled: bool = True


class RulePatchIn(BaseModel):
    is_enabled: bool


class VersionCreateIn(BaseModel):
    check_logic_json: dict
    change_note: str = ""
    test_samples: list[TestSampleIn] = Field(default_factory=list)


class RollbackIn(BaseModel):
    version: int


class EvaluateIn(BaseModel):
    dataset_ref: str = ""
    samples: list[TestSampleIn] = Field(default_factory=list)
    baseline_version: int | None = None


@router.get("/rules")
async def list_rules(request: Request, domain: str | None = None, is_enabled: bool | None = None,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_rules(db, user, domain, is_enabled)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/rules")
async def create_rule(payload: RuleCreateIn, request: Request, db: AsyncSession = Depends(get_db),
                      user: User = Depends(get_current_user)):
    data = await svc.create_rule(db, user, payload.model_dump(), _rid(request))
    return ok(data, _rid(request))


@router.post("/rules/seed")
async def seed_rules(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.seed_default_rules(db, user, _rid(request)), _rid(request))


@router.get("/rules/{rule_id}")
async def get_rule(rule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    return ok(await svc.get_rule(db, user, rule_id), _rid(request))


@router.patch("/rules/{rule_id}")
async def patch_rule(rule_id: str, payload: RulePatchIn, request: Request, db: AsyncSession = Depends(get_db),
                     user: User = Depends(get_current_user)):
    return ok(await svc.set_enabled(db, user, rule_id, payload.is_enabled, _rid(request)), _rid(request))


@router.post("/rules/{rule_id}/versions")
async def create_version(rule_id: str, payload: VersionCreateIn, request: Request,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    samples = [s.model_dump() for s in payload.test_samples]
    data = await svc.create_version(db, user, rule_id, payload.check_logic_json, payload.change_note, samples, _rid(request))
    return ok(data, _rid(request))


@router.get("/rules/{rule_id}/versions")
async def list_versions(rule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    items = await svc.list_versions(db, user, rule_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/rules/{rule_id}/rollback")
async def rollback(rule_id: str, payload: RollbackIn, request: Request, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    return ok(await svc.rollback(db, user, rule_id, payload.version, _rid(request)), _rid(request))


@router.post("/rules/{rule_id}/test")
async def run_tests(rule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    return ok(await svc.run_rule_tests(db, user, rule_id, _rid(request)), _rid(request))


@router.get("/rules/{rule_id}/evaluations")
async def list_evaluations(rule_id: str, request: Request, db: AsyncSession = Depends(get_db),
                           user: User = Depends(get_current_user)):
    items = await svc.list_evaluations(db, user, rule_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/rules/{rule_id}/evaluate")
async def evaluate(rule_id: str, payload: EvaluateIn, request: Request, db: AsyncSession = Depends(get_db),
                   user: User = Depends(get_current_user)):
    samples = [s.model_dump() for s in payload.samples]
    data = await rule_eval.evaluate_rule(db, user, rule_id, payload.dataset_ref, samples,
                                         payload.baseline_version, _rid(request))
    return ok(data, _rid(request))