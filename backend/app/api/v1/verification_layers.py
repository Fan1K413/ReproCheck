"""独立验证引擎分层 API（第2层静态分析 + 第4层数值重算 + 分层职责说明）。

认证后可用；本模块不访问项目数据、不执行上传代码、不注册路由（由 api/__init__.py 统一挂载）。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_current_user
from app.core.errors import ok
from app.services.numeric_recompute_service import LAYER_SPECS, compare_recomputed, recompute_from_counts
from app.services.static_analysis_service import analyze_project_code

router = APIRouter(tags=["verification-layers"])


class StaticAnalysisIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sources: dict[str, str] = Field(default_factory=dict)


class RecomputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric: str = Field(min_length=1)
    counts: dict[str, Any] = Field(default_factory=dict)
    reported_value: float | None = None
    tolerance: float = 0.01


@router.post("/verification/static-analysis")
async def static_analysis(payload: StaticAnalysisIn, request: Request,
                          _user=Depends(get_current_user)):
    result: dict[str, Any] = analyze_project_code(payload.sources)
    return ok(result, getattr(request.state, "request_id", "-"))


@router.post("/verification/recompute")
async def recompute(payload: RecomputeIn, request: Request,
                    _user=Depends(get_current_user)):
    recomputed = recompute_from_counts(payload.metric, payload.counts)
    result = compare_recomputed(recomputed, payload.reported_value, payload.tolerance)
    return ok(result, getattr(request.state, "request_id", "-"))


@router.get("/verification/layers")
async def layers(request: Request, _user=Depends(get_current_user)):
    # 返回拷贝，避免调用方修改模块级定义；第3层默认不执行在 executed_by_default 中明示。
    items = [dict(spec) for spec in LAYER_SPECS]
    return ok({
        "layers": items,
        "total": len(items),
        "note": "第3层动态执行默认不执行：隔离执行环境未启用，且无可用动态执行后端；"
                "各层只提供可复核的确定性证据或计算，不冒充确定根因。",
    }, getattr(request.state, "request_id", "-"))
