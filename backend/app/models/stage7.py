"""第七阶段（科研自动化工作流升级）数据模型。

在既有复现规划 DAG / 受控执行 / 日志 / 诊断 / 修复审核之上，新增一层可编排、
可追踪、可审核的科研工作流能力：

- Workflow / WorkflowNode / NodeAttempt / WorkflowEvent：多步骤任务编排、
  依赖与前置条件、优先级、重试、暂停/恢复/取消、人工确认节点、执行历史；
- EvidenceGap / EvidenceTask：主张缺证据的自动识别、补证任务与证据回链；
- RecoveryPlan：失败智能恢复、隔离副本测试、批准后才允许应用，原始项目不动。

原则：全部为新增表，不改前序表结构；id 统一 uuid 字符串；时间 UTC；
状态与日志来自真实执行落库，不允许模拟完成进度。
"""
from __future__ import annotations

from datetime import datetime

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
from app.models import DateTimeUTC, _now


# 工作流编排

class Workflow(Base):
    """一条科研工作流（多个节点组成的 DAG 实例）。"""

    __tablename__ = "workflows"
    __table_args__ = (Index("ix_wf_project_status", "project_id", "status"),
                       Index("ix_wf_idem", "idem_key", unique=True))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 来源：template / manual / nl_assistant / evidence_gap / recovery
    source: Mapped[str] = mapped_column(String(30), default="manual", server_default="manual")
    template_key: Mapped[str | None] = mapped_column(String(60), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", index=True)
    priority: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    requested_by_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # 自然语言原始请求（NL 助手创建时留存，便于审计回溯）
    nl_query: Mapped[str | None] = mapped_column(Text, nullable=True)
    context_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    idem_key: Mapped[str] = mapped_column(String(120), default="", server_default="")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )


class WorkflowNode(Base):
    """工作流中的一个步骤节点。状态机真实落库，前端轮询读取，不做假进度。"""

    __tablename__ = "workflow_nodes"
    __table_args__ = (
        Index("ix_wnode_workflow", "workflow_id"),
        Index("ix_wnode_project_status", "project_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workflows.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    node_key: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # check / extract / experiment / human_confirm / evidence_gap / recovery
    node_type: Mapped[str] = mapped_column(String(30), default="check", server_default="check")
    # 确定性检查处理器 key（注册表见 app.workflow.handlers）
    handler: Mapped[str] = mapped_column(String(60), default="", server_default="")
    depends_on_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    preconditions_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    required_materials_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    action: Mapped[str] = mapped_column(Text, default="", server_default="")
    expected_result: Mapped[str] = mapped_column(Text, default="", server_default="")
    acceptance_criteria: Mapped[str] = mapped_column(Text, default="", server_default="")
    evidence_targets_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    risk_level: Mapped[str] = mapped_column(String(20), default="low", server_default="low")
    priority: Mapped[int] = mapped_column(Integer, default=5, server_default="5")
    max_retries: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending", index=True)
    needs_human_confirm: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    confirmed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    failure_category: Mapped[str] = mapped_column(String(40), default="", server_default="")
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=300, server_default="300")
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )


class NodeAttempt(Base):
    """节点每次执行尝试（执行历史）。失败现场随 attempt 保留，不被后续重试覆盖。"""

    __tablename__ = "node_attempts"
    __table_args__ = (Index("ix_attempt_node", "node_id"),
                       Index("ix_attempt_workflow", "workflow_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    node_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workflow_nodes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workflow_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    attempt_no: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    handler: Mapped[str] = mapped_column(String(60), default="", server_default="")
    log_excerpt: Mapped[str] = mapped_column(Text, default="", server_default="")
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    resource_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class WorkflowEvent(Base):
    """工作流时间线事件（状态变更、人工确认、失败、补证/恢复联动）。"""

    __tablename__ = "workflow_events"
    __table_args__ = (Index("ix_event_workflow", "workflow_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    workflow_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    message: Mapped[str] = mapped_column(Text, default="", server_default="")
    payload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# 科研实验自动补证

class EvidenceGap(Base):
    """论文主张缺少证据的缺口记录。claim_type=fact 关联 extracted_facts.fact_id。"""

    __tablename__ = "evidence_gaps"
    __table_args__ = (Index("ix_gap_project_status", "project_id", "status"),
                       Index("ix_gap_claim", "claim_type", "claim_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    claim_type: Mapped[str] = mapped_column(String(20), default="fact", server_default="fact")
    claim_id: Mapped[str] = mapped_column(String(80), nullable=False)
    field_key: Mapped[str] = mapped_column(String(80), default="", server_default="")
    claim_summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    # evidence_missing / value_missing / material_missing / ambiguous
    missing_kind: Mapped[str] = mapped_column(String(30), default="evidence_missing", server_default="evidence_missing")
    diagnosis_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # extractable_from_existing / needs_upload / needs_rerun / needs_human
    remediation_class: Mapped[str] = mapped_column(String(30), default="needs_human", server_default="needs_human")
    materials_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", index=True)
    linked_task_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class EvidenceTask(Base):
    """补证任务：用户确认后执行，新证据回链到原始主张。"""

    __tablename__ = "evidence_tasks"
    __table_args__ = (Index("ix_etask_gap", "gap_id"),
                      Index("ix_etask_project_status", "project_id", "status"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    gap_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("evidence_gaps.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # existing_extract / upload / rerun / manual
    source: Mapped[str] = mapped_column(String(20), default="manual", server_default="manual")
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True)
    required_upload_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    rerun_plan_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_evidence_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    linked_claim_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    confirmed_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    executed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )


# 失败智能恢复

class RecoveryPlan(Base):
    """失败恢复方案：诊断 → 检查 → 补丁建议 → 隔离副本测试 → 批准后应用。

    硬约束：未经批准不得修改原始科研项目；隔离副本路径与测试结果如实记录。
    """

    __tablename__ = "recovery_plans"
    __table_args__ = (Index("ix_rec_project_status", "project_id", "status"),
                       Index("ix_rec_workflow", "workflow_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    workflow_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    node_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    failure_category: Mapped[str] = mapped_column(String(40), default="other_unknown", server_default="other_unknown")
    failure_summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    log_ref: Mapped[str | None] = mapped_column(String(300), nullable=True)
    checks_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    candidates_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    suggested_fix: Mapped[str] = mapped_column(Text, default="", server_default="")
    patch_proposal_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    isolation_copy_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # pending / testing / passed / failed / skipped
    test_status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    test_result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    # open / awaiting_approval / approved / rejected / applied / closed
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", index=True)
    original_preserved: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )
