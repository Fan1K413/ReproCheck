"""第四阶段结构化 Schema：复现任务、环境、指标、诊断、报告。

全部 extra=forbid 严格校验，防止模型输出多余字段。
"""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Feasibility = Literal[
    "ready", "missing_material", "missing_dependency", "missing_configuration",
    "needs_human_review", "blocked_security", "unverifiable",
]
TaskStatus = Literal["pending", "blocked", "confirmed", "running", "completed", "failed", "cancelled"]
Verdict = Literal[
    "exact_match", "within_tolerance", "significant_deviation",
    "insufficient_data", "not_comparable", "needs_manual_review",
]


class ReproTaskIn(BaseModel):
    """AI 规划输出的单项复现任务。"""
    model_config = ConfigDict(extra="forbid")

    task_key: str = Field(min_length=1, max_length=20)
    title: str = Field(min_length=1, max_length=300)
    description: str = ""
    depends_on: list[str] = Field(default_factory=list)
    required_materials: list[str] = Field(default_factory=list)
    action: str = ""
    expected_result: str = ""
    acceptance_criteria: str = ""
    evidence_refs: list[str] = Field(default_factory=list)
    risk: str = ""
    feasibility: Feasibility = "needs_human_review"
    feasibility_reason: str = ""
    needs_human_confirm: bool = True


class ReproductionPlanIn(BaseModel):
    """AI 规划输出顶层结构。"""
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=300)
    tasks: list[ReproTaskIn] = Field(default_factory=list)


class EnvironmentInfo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    python_version: str | None = None
    frameworks: dict[str, str] = Field(default_factory=dict)
    dependencies: list[dict[str, str]] = Field(default_factory=list)
    hardware_requirements: dict[str, Any] = Field(default_factory=dict)
    entrypoints: list[str] = Field(default_factory=list)
    missing: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class MetricIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric_name: str = Field(min_length=1, max_length=120)
    metric_value: float | None = None
    unit: str | None = None
    source: str = ""
    extraction_method: str = ""
    confidence: float = 0.0
    needs_manual_review: bool = False


class PossibleCause(BaseModel):
    model_config = ConfigDict(extra="forbid")
    cause: str
    basis: str = ""
    confidence: str = "low"  # low/medium/high（文本描述，非校准概率）


class DiagnosticIn(BaseModel):
    """AI 失败诊断输出。"""
    model_config = ConfigDict(extra="forbid")

    problem: str = Field(min_length=1)
    error_evidence: str = ""
    possible_causes: list[PossibleCause] = Field(default_factory=list)
    suggested_fix: str = ""
    verification_method: str = ""
    needs_human_confirm: bool = True
