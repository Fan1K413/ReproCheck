"""API v1 路由聚合（第一阶段 5 个 + 第二阶段 5 个，共 10 个模块）。"""
from fastapi import APIRouter

from app.api.v1 import (
    audit_runs,
    demo,
    facts,
    health,
    llm,
    materials,
    overview,
    parse_tasks,
    projects,
)

api_router = APIRouter(prefix="/api/v1")
# ---- 第一阶段（保持原样） ----
api_router.include_router(health.router)
api_router.include_router(llm.router)
api_router.include_router(demo.router)
api_router.include_router(audit_runs.router)
api_router.include_router(projects.router)
# ---- 第二阶段（追加） ----
api_router.include_router(materials.router)
api_router.include_router(parse_tasks.router)
api_router.include_router(facts.router)
api_router.include_router(overview.router)
