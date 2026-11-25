"""Pydantic Schema：LLM 返回结构、API 请求/响应结构。全部严格校验。"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


# LLM 结构化抽取（第一层）

class ExtractedFactIn(BaseModel):
    """模型从单一材料抽取的一条实验事实。"""
    model_config = ConfigDict(extra="forbid")

    field_key: str = Field(min_length=1, max_length=80)
    raw_value: str = Field(min_length=1, max_length=200)
    normalized_value: str | int | float | None = None
    unit: str | None = None
    evidence_chunk_id: str = Field(min_length=1, max_length=80)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class FactsExtraction(BaseModel):
    """模型抽取结果顶层结构。"""
    model_config = ConfigDict(extra="forbid")

    facts: list[ExtractedFactIn] = Field(default_factory=list)


# AI 风险解释（第三层）

class RiskExplanationIn(BaseModel):
    """模型针对一条已验证差异给出的解释。"""
    model_config = ConfigDict(extra="forbid")

    finding_id: str = Field(min_length=1, max_length=60)
    field_key: str = Field(min_length=1, max_length=80)
    severity: Literal["high", "medium", "low"] = "medium"
    title: str = Field(min_length=1, max_length=300)
    explanation: str = Field(min_length=1)
    suggested_fix: str = ""


class RiskExplanations(BaseModel):
    model_config = ConfigDict(extra="forbid")

    explanations: list[RiskExplanationIn] = Field(default_factory=list)


# API 请求

class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    domain: str = Field(default="", max_length=120)
    paper_title: str = Field(default="", max_length=300)
    description: str = Field(default="")
    org_id: str | None = None
    workspace_id: str | None = None


class DemoAuditRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    project_name: str = Field(default="ReproCheck 演示项目", max_length=200)
    material_a_text: str | None = None
    material_b_text: str | None = None
    use_default_materials: bool = True


# API 响应 data

class TokenUsage(BaseModel):
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


class LLMStatusData(BaseModel):
    provider: str
    model: str
    api_key_configured: bool
    connection_status: Literal["unknown", "ok", "error"]
    last_call_at: str | None = None
    last_call_duration_ms: int | None = None
    last_call_success: bool | None = None
    last_token_usage: TokenUsage | None = None


class LLMTestData(BaseModel):
    success: bool
    reply: str
    model: str
    duration_ms: int
    token_usage: TokenUsage | None = None
    tested_at: str


class FactView(BaseModel):
    field_key: str
    raw_value: str
    normalized_value: str | int | float | None = None
    unit: str | None = None
    evidence_chunk_id: str
    confidence: float


class MaterialFacts(BaseModel):
    material_id: str
    facts: list[FactView]


class ComparisonView(BaseModel):
    field_key: str
    label: str
    value_a: str | int | float | None
    value_b: str | int | float | None
    status: Literal["conflict", "consistent", "missing"]
    evidence_a_id: str | None = None
    evidence_b_id: str | None = None


class EvidenceView(BaseModel):
    evidence_id: str
    source_name: str
    chunk_id: str
    original_text: str


class FindingView(BaseModel):
    finding_id: str
    field_key: str
    severity: str
    title: str
    ai_explanation: str
    evidence: list[EvidenceView] = Field(default_factory=list)


class MaterialView(BaseModel):
    material_id: str
    source_name: str
    text: str


class LLMMeta(BaseModel):
    calls: int
    total_tokens: int
    duration_ms: int
    model: str


class AuditResultData(BaseModel):
    run_id: str
    status: str
    project_id: str | None = None
    project_name: str | None = None
    materials: list[MaterialView] = Field(default_factory=list)
    extracted_facts: list[MaterialFacts] = Field(default_factory=list)
    comparisons: list[ComparisonView] = Field(default_factory=list)
    findings: list[FindingView] = Field(default_factory=list)
    llm_meta: LLMMeta
    created_at: str | None = None


class ProjectView(BaseModel):
    id: str
    name: str
    domain: str
    paper_title: str
    description: str
    created_at: str
    owner_user_id: str | None = None
    org_id: str | None = None


class ProjectListData(BaseModel):
    items: list[ProjectView]
    total: int


class HealthData(BaseModel):
    status: str
    version: str
    timestamp: str
