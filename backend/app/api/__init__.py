"""API v1 路由聚合（第一/二/四阶段 + 第六阶段协作/治理模块）。

第六阶段：既有项目相关路由统一挂载 enforce_project_isolation 实现数据隔离；
新增 auth/orgs/collab/roles 等路由自带认证与 RBAC。
"""
from fastapi import APIRouter, Depends

from app.api.isolation import enforce_project_isolation
from app.api.v1 import (
    api_tokens,
    assistant,
    audit_runs,
    benchmark_metrics,
    auth,
    cases,
    chart_verification,
    collab,
    data_audit,
    demo,
    diagnosis,
    evidence_gaps,
    fact_schema,
    facts,
    feedback,
    governance,
    handoff,
    handoff_records,
    health,
    integrations,
    knowledge,
    lifecycle,
    llm,
    materials,
    modelhub,
    orgs,
    orchestration,
    overview,
    papers,
    recovery,
    parse_tasks,
    projects,
    project_health,
    rag,
    reproductions,
    research_features,
    roles,
    rules,
    stats_audit,
    verification_layers,
    verdict,
    workflow,
)

api_router = APIRouter(prefix="/api/v1")
_iso = [Depends(enforce_project_isolation)]

# 第一阶段
api_router.include_router(health.router)
api_router.include_router(llm.router)
api_router.include_router(demo.router)
api_router.include_router(audit_runs.router, dependencies=_iso)
api_router.include_router(projects.router, dependencies=_iso)
# 第二阶段
api_router.include_router(materials.router, dependencies=_iso)
api_router.include_router(parse_tasks.router, dependencies=_iso)
api_router.include_router(facts.router, dependencies=_iso)
api_router.include_router(overview.router, dependencies=_iso)
api_router.include_router(papers.router)
# 第四阶段
api_router.include_router(reproductions.router, dependencies=_iso)
# 第六阶段
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
# 第六阶段：确定性诊断（验证引擎第一层，独立于 LLM）
api_router.include_router(diagnosis.router)
# 第六阶段：基准指标引擎（纯计算，不访问项目数据）
api_router.include_router(benchmark_metrics.router)
# 第六阶段：论文图表反向验证（文本/数值层，非 OCR/像素级）
api_router.include_router(chart_verification.router, dependencies=_iso)
# 第六阶段：验证引擎分层（静态分析/数值重算，纯计算）
api_router.include_router(verification_layers.router)
# 第九阶段 U1：统一可信结论层
api_router.include_router(verdict.router, dependencies=_iso)
# 第十阶段：数据质量与数据完整性审计引擎（独立模块）
api_router.include_router(data_audit.router, dependencies=_iso)
# 统计学审计：独立升级（纯计算，不改既有对照/复现/差异分析路由）
api_router.include_router(stats_audit.router)
# 第十一阶段：模型管理中心（自带用户鉴权，不做项目隔离）
api_router.include_router(modelhub.router)
# 第十一阶段：新增科研功能（自带用户鉴权与项目级隔离）
api_router.include_router(research_features.router)
# 第十二阶段：生命周期 / 知识库 / 结构化交接 / 健康度 / 协作工作流
api_router.include_router(lifecycle.router, dependencies=_iso)
api_router.include_router(workflow.router, dependencies=_iso)
# 第七阶段：科研自动化工作流（编排 / 补证 / 恢复 / NL 助手）
api_router.include_router(orchestration.router, dependencies=_iso)
api_router.include_router(evidence_gaps.router, dependencies=_iso)
api_router.include_router(recovery.router, dependencies=_iso)
api_router.include_router(assistant.router)
api_router.include_router(handoff_records.router, dependencies=_iso)
api_router.include_router(project_health.router, dependencies=_iso)
# 知识库：服务层按组织/项目成员身份做隔离，不挂项目隔离依赖
api_router.include_router(knowledge.router)
