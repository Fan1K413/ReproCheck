"""API v1 路由聚合（第一/二/四阶段 + 第六阶段协作/治理模块）。

第六阶段：既有项目相关路由统一挂载 enforce_project_isolation 实现数据隔离；
新增 auth/orgs/collab/roles 等路由自带认证与 RBAC。
"""
from fastapi import APIRouter, Depends

from app.api.isolation import enforce_project_isolation
from app.api.v1 import (
    api_tokens,
    audit_runs,
    benchmark_metrics,
    auth,
    cases,
    chart_verification,
    collab,
    demo,
    diagnosis,
    fact_schema,
    facts,
    feedback,
    governance,
    handoff,
    health,
    integrations,
    llm,
    materials,
    orgs,
    overview,
    parse_tasks,
    projects,
    rag,
    reproductions,
    roles,
    rules,
    verification_layers,
)

api_router = APIRouter(prefix="/api/v1")
_iso = [Depends(enforce_project_isolation)]

# ---- 第一阶段 ----
api_router.include_router(health.router)
api_router.include_router(llm.router)
api_router.include_router(demo.router)
api_router.include_router(audit_runs.router, dependencies=_iso)
api_router.include_router(projects.router, dependencies=_iso)
# ---- 第二阶段 ----
api_router.include_router(materials.router, dependencies=_iso)
api_router.include_router(parse_tasks.router, dependencies=_iso)
api_router.include_router(facts.router, dependencies=_iso)
api_router.include_router(overview.router, dependencies=_iso)
# ---- 第四阶段 ----
api_router.include_router(reproductions.router, dependencies=_iso)
# ---- 第六阶段 ----
api_router.include_router(auth.router)
api_router.include_router(orgs.router)
api_router.include_router(collab.router)
api_router.include_router(roles.router)
api_router.include_router(cases.router)
api_router.include_router(fact_schema.router)
api_router.include_router(rules.router)
api_router.include_router(feedback.router)
api_router.include_router(rag.router)
api_router.include_router(integrations.router)
api_router.include_router(api_tokens.router)
api_router.include_router(governance.router)
api_router.include_router(handoff.router, dependencies=_iso)
# ---- 第六阶段：确定性诊断（验证引擎第一层，独立于 LLM）----
api_router.include_router(diagnosis.router)
# ---- 第六阶段：基准指标引擎（纯计算，不访问项目数据）----
api_router.include_router(benchmark_metrics.router)
# ---- 第六阶段：论文图表反向验证（文本/数值层，非 OCR/像素级）----
api_router.include_router(chart_verification.router, dependencies=_iso)
# ---- 第六阶段：验证引擎分层（静态分析/数值重算，纯计算）----
api_router.include_router(verification_layers.router)
