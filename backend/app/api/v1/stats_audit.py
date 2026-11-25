"""统计学与实验结果可信度审计 API（独立升级模块，追加式挂载）。

职责边界：
- 只提供统计计算与审计编排，不读取项目业务数据、不执行上传代码、不调用 LLM；
- 所有计算可由调用方用返回的 formula/inputs 独立复算；
- 认证后可用；错误一律显式标注，不伪造结论。

本模块不自行注册路由，由 api/__init__.py 统一挂载。
"""
from __future__ import annotations

import importlib
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_current_user
from app.core.errors import ok
from app.statsaudit.engine import get_catalog, run_stats_audit

router = APIRouter(tags=["statistics-audit"])


class AuditIn(BaseModel):
    model_config = ConfigDict(extra="allow")
    experiment_statistics: dict[str, Any] = Field(default_factory=dict)


class ComputeIn(BaseModel):
    """通用计算入口：operation 为原语名，kwargs 为该原语的关键字参数。"""
    model_config = ConfigDict(extra="forbid")
    operation: str = Field(min_length=1)
    kwargs: dict[str, Any] = Field(default_factory=dict)


# 允许的纯计算原语白名单（防止任意属性调用）。
_ALLOWED_OPERATIONS = {
    "mean", "std", "variance", "verify_mean_std", "check_consistency",
    "analyze_seed_impact", "confidence_interval", "effect_size",
    "hypothesis_test", "multiple_comparison", "power_analysis",
    "detect_outliers", "distribution_data",
    "compute_classification_metrics", "compute_multiclass_averages",
    "compute_roc_auc", "compute_pr_auc", "compute_regression_metrics",
    "recompute_metric", "audit_metric_claims", "detect_split_mismatch",
    "check_control_group", "check_ablation_completeness",
    "check_baseline_reasonableness", "check_hyperparameter_bias",
    "check_selective_reporting", "check_repetition_sufficiency",
    "check_practical_significance", "guard_causal_language",
}
_MODULE_BY_OP = {
    "mean": "core", "std": "core", "variance": "core",
    "verify_mean_std": "core", "check_consistency": "core",
    "analyze_seed_impact": "core", "confidence_interval": "core",
    "effect_size": "core", "hypothesis_test": "core",
    "multiple_comparison": "core", "power_analysis": "core",
    "detect_outliers": "core", "distribution_data": "core",
    "compute_classification_metrics": "metrics", "compute_multiclass_averages": "metrics",
    "compute_roc_auc": "metrics", "compute_pr_auc": "metrics",
    "compute_regression_metrics": "metrics", "recompute_metric": "metrics",
    "audit_metric_claims": "metrics", "detect_split_mismatch": "metrics",
    "check_control_group": "design", "check_ablation_completeness": "design",
    "check_baseline_reasonableness": "design", "check_hyperparameter_bias": "design",
    "check_selective_reporting": "design", "check_repetition_sufficiency": "design",
    "check_practical_significance": "design", "guard_causal_language": "design",
}


@router.post("/stats-audit/run")
async def stats_audit_run(payload: AuditIn, request: Request,
                          _user=Depends(get_current_user)):
    """运行完整统计审计，返回含六类可信度分类的结构化报告。"""
    result = run_stats_audit(payload.experiment_statistics).to_dict()
    return ok(result, getattr(request.state, "request_id", "-"))


@router.post("/stats-audit/compute")
async def stats_audit_compute(payload: ComputeIn, request: Request,
                              _user=Depends(get_current_user)):
    """调用单个统计原语，返回可复算的数值与公式。"""
    rid = getattr(request.state, "request_id", "-")
    op = payload.operation.strip()
    if op not in _ALLOWED_OPERATIONS:
        return ok({"supported": False, "note": f"未知计算操作: {op}",
                   "allowed_operations": sorted(_ALLOWED_OPERATIONS)}, rid)
    try:
        module = importlib.import_module(f"app.statsaudit.{_MODULE_BY_OP[op]}")
        fn = getattr(module, op)
        result = fn(**payload.kwargs)
        return ok(result, rid)
    except TypeError as exc:
        return ok({"supported": False, "note": f"参数不匹配: {exc}"}, rid)
    except Exception as exc:
        return ok({"supported": False, "note": f"计算失败: {type(exc).__name__}: {exc}"}, rid)


@router.get("/stats-audit/catalog")
async def stats_audit_catalog(request: Request, _user=Depends(get_current_user)):
    """返回规则目录、六类可信度定义与可调用的原语清单。"""
    return ok(get_catalog(), getattr(request.state, "request_id", "-"))
