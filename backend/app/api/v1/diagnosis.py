"""确定性失败诊断 API（验证引擎第一层，独立于大模型）。

无 API Key 也可用：只依据调用方提供的原始日志/阶段/错误码做规则分类，
所有结论都是候选原因（is_confirmed=false），不冒充确定根因。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.errors import ok
from app.reproduction.deterministic_diagnosis import (
    classify_failure,
    FAILURE_CATEGORIES,
    CATEGORY_LABELS,
)

router = APIRouter(tags=["deterministic-diagnosis"])


class ClassifyIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    raw_log: str = ""
    stage: str = ""
    error_code: str = ""
    environment_missing: str = ""


@router.get("/diagnosis/categories")
async def list_categories(request: Request,
                          _user=Depends(get_current_user)):
    items = [{"code": c, "label": CATEGORY_LABELS[c]} for c in FAILURE_CATEGORIES]
    return ok({"items": items, "total": len(items),
               "note": "标准化错误分类；诊断结果均为候选原因，需人工核实。"},
              getattr(request.state, "request_id", "-"))


@router.get("/diagnosis/production-check")
async def production_check(request: Request, _user=Depends(get_current_user)):
    """返回当前配置的生产安全检查清单（只读）；空清单表示通过。"""
    issues = settings.strict_production_check()
    return ok({
        "passed": len(issues) == 0,
        "issues": issues,
        "note": "本检查为部署自检工具；默认开发配置会返回问题清单，生产必须在配置中逐项收敛。",
    }, getattr(request.state, "request_id", "-"))


@router.post("/diagnosis/classify")
async def classify(payload: ClassifyIn, request: Request,
                   _user=Depends(get_current_user)):
    result = classify_failure(
        raw_log=payload.raw_log, stage=payload.stage,
        error_code=payload.error_code,
        environment_missing=payload.environment_missing,
    )
    data: dict[str, Any] = {
        "primary_category": result.primary_category,
        "primary_label": result.primary_label,
        "candidates": [
            {
                "category": c.category, "label": c.label,
                "confidence": c.confidence, "is_confirmed": c.is_confirmed,
                "matched_evidence": c.matched_evidence,
                "suggested_fix": c.suggested_fix,
            }
            for c in result.candidates
        ],
        "raw_log_present": result.raw_log_present,
        "method": result.method,
        "note": result.note,
    }
    return ok(data, getattr(request.state, "request_id", "-"))
