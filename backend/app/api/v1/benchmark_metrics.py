"""基准指标计算 API：纯计算，认证后可用，不访问项目数据、不挂项目隔离。

用于在修改检测器后对标注基准集回归：Precision/Recall/F1/误报率/漏报率/
证据定位准确率/问题分类准确率，以及基线退化门禁。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_current_user
from app.core.errors import ok
from app.services.benchmark_metrics import (
    SCHEMA,
    BenchmarkPrediction,
    BenchmarkTruth,
    compute_metrics,
)

router = APIRouter(tags=["benchmark-metrics"])


class TruthIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: str = Field(min_length=1)
    category: str = Field(min_length=1)
    evidence_locator: str = ""


class PredictionIn(TruthIn):
    confidence: float = 0.0


class ComputeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    truths: list[TruthIn] = Field(default_factory=list)
    predictions: list[PredictionIn] = Field(default_factory=list)


@router.post("/benchmark/metrics/compute")
async def compute(payload: ComputeIn, request: Request,
                  _user=Depends(get_current_user)):
    truths = [
        BenchmarkTruth(item_id=t.item_id, category=t.category,
                       evidence_locator=t.evidence_locator)
        for t in payload.truths
    ]
    predictions = [
        BenchmarkPrediction(item_id=p.item_id, category=p.category,
                            evidence_locator=p.evidence_locator,
                            confidence=p.confidence)
        for p in payload.predictions
    ]
    result: dict[str, Any] = compute_metrics(truths, predictions)
    return ok(result, getattr(request.state, "request_id", "-"))


@router.get("/benchmark/metrics/schema")
async def schema(request: Request, _user=Depends(get_current_user)):
    return ok(SCHEMA, getattr(request.state, "request_id", "-"))
