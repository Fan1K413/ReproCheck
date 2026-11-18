"""第四阶段数据模型：复现规划/任务/运行/环境/日志/产物/指标/对照/诊断/修复/审核/报告。

增量扩展：全部新表，不改前序表；含 project_id 归属，支持数据隔离。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class DateTimeUTC(DateTime):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("timezone", True)
        super().__init__(*args, **kwargs)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ReproductionPlan(Base):
    __tablename__ = "reproduction_plans"
    __table_args__ = (Index("ix_rplan_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # plan_id
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft")
    source: Mapped[str] = mapped_column(
        String(20), default="ai", server_default="ai"
    )  # ai / program / manual
    ai_available: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    prompt_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    feasibility_summary_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_refs_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ReproductionTask(Base):
    __tablename__ = "reproduction_tasks"
    __table_args__ = (Index("ix_rtask_plan_key", "plan_id", "task_key", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # task_id
    plan_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("reproduction_plans.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_key: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    depends_on_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    required_materials_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    action: Mapped[str] = mapped_column(Text, default="", server_default="")
    expected_result: Mapped[str] = mapped_column(Text, default="", server_default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="", server_default="")
    evidence_refs_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    risk: Mapped[str] = mapped_column(Text, default="", server_default="")
    feasibility: Mapped[str] = mapped_column(
        String(30), default="unverifiable", server_default="unverifiable"
    )
    feasibility_reason: Mapped[str] = mapped_column(Text, default="", server_default="")
    needs_human_confirm: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ReproductionRun(Base):
    __tablename__ = "reproduction_runs"
    __table_args__ = (Index("ix_rrun_project_status", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # run_id
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    plan_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    task_ids_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending")
    execution_enabled: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    security_check_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    environment_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    requested_by: Mapped[str] = mapped_column(String(120), default="", server_default="")
    workdir: Mapped[str | None] = mapped_column(String(500), nullable=True)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    cpu_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    memory_mb: Mapped[float | None] = mapped_column(Float, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ExecutionEnvironment(Base):
    __tablename__ = "execution_environments"
    __table_args__ = (Index("ix_env_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    material_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    python_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    frameworks_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    dependencies_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    hardware_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    entrypoints_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    missing_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    warnings_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    changed_from_original_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ExecutionLog(Base):
    __tablename__ = "execution_logs"
    __table_args__ = (Index("ix_log_run", "run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    log_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    stream: Mapped[str] = mapped_column(String(20), default="stdout", server_default="stdout")
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ExecutionArtifact(Base):
    __tablename__ = "execution_artifacts"
    __table_args__ = (Index("ix_art_run", "run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    artifact_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ReproductionMetric(Base):
    __tablename__ = "reproduction_metrics"
    __table_args__ = (Index("ix_metric_run_name", "run_id", "metric_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    metric_name: Mapped[str] = mapped_column(String(120), nullable=False)
    metric_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source: Mapped[str] = mapped_column(String(200), default="", server_default="")
    extraction_method: Mapped[str] = mapped_column(String(80), default="", server_default="")
    experiment: Mapped[str | None] = mapped_column(String(120), nullable=True)
    dataset: Mapped[str | None] = mapped_column(String(120), nullable=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    needs_manual_review: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class MetricComparison(Base):
    __tablename__ = "metric_comparisons"
    __table_args__ = (Index("ix_mcmp_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    metric_name: Mapped[str] = mapped_column(String(120), nullable=False)
    paper_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    reproduced_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    diff_absolute: Mapped[float | None] = mapped_column(Float, nullable=True)
    diff_relative: Mapped[float | None] = mapped_column(Float, nullable=True)
    verdict: Mapped[str] = mapped_column(String(30), default="insufficient_data", server_default="insufficient_data")
    rule: Mapped[str] = mapped_column(String(60), default="", server_default="")
    tolerance_basis: Mapped[str] = mapped_column(Text, default="", server_default="")
    conditions_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class FailureDiagnostic(Base):
    __tablename__ = "failure_diagnostics"
    __table_args__ = (Index("ix_diag_run", "run_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    problem: Mapped[str] = mapped_column(Text, default="", server_default="")
    error_evidence: Mapped[str] = mapped_column(Text, default="", server_default="")
    possible_causes_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    suggested_fix: Mapped[str] = mapped_column(Text, default="", server_default="")
    verification_method: Mapped[str] = mapped_column(Text, default="", server_default="")
    needs_human_confirm: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    ai_available: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    prompt_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class RemediationProposal(Base):
    __tablename__ = "remediation_proposals"
    __table_args__ = (Index("ix_remed_diag", "diagnostic_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    diagnostic_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    change_type: Mapped[str] = mapped_column(String(40), default="", server_default="")
    target_file: Mapped[str | None] = mapped_column(String(300), nullable=True)
    original_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    proposed_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    changes_research_conditions: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class RemediationReview(Base):
    __tablename__ = "remediation_reviews"
    __table_args__ = (Index("ix_review_proposal", "proposal_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    proposal_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    reviewer: Mapped[str] = mapped_column(String(120), default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    modified_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_preserved: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ReproductionReport(Base):
    __tablename__ = "reproduction_reports"
    __table_args__ = (Index("ix_report_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft")
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    sections_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    html: Mapped[str | None] = mapped_column(Text, nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scope_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
