"""第十二阶段数据模型：科研项目生命周期 / 版本化知识库 / 结构化人员交接 /
项目健康度支撑表 / 科研协作工作项（里程碑、研究任务）。

设计原则（与前序阶段一致）：
- 全部为新增表，不改前序表结构；对 projects 仅在服务层读取既有 owner_user_id/org_id，不加列。
- id 统一 uuid 字符串；时间 UTC；JSON 字段以 Text 承载，禁止在模型层做 AI 推断打分。
- 所有项目级实体都带 project_id + org_id，组织隔离在服务层强制过滤。
- 既有 RBAC / 评论 / 活动流 / 审计轨迹表不复刻，新模块通过 record_trail 接入既有轨迹。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
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


# 一、科研项目生命周期

# 生命周期阶段枚举（顺序即流程顺序；archived 为终态）
LIFECYCLE_STAGES = (
    "init",                # 项目创建
    "research_question",   # 研究问题定义
    "material_collection", # 论文与资料收集
    "dataset",             # 数据集管理
    "experiment_design",   # 实验设计
    "execution",           # 实验执行
    "verification",        # 结果核验
    "writing",             # 论文撰写
    "repro_audit",         # 复现审计
    "archived",            # 项目归档
)

STAGE_STATUS = ("pending", "active", "done", "blocked")
QUESTION_STATUS = ("draft", "active", "resolved", "abandoned")
DATASET_STATUS = ("registered", "verified", "archived")
DESIGN_STATUS = ("draft", "reviewing", "approved", "retired")
EXPERIMENT_STATUS = ("queued", "running", "completed", "failed", "blocked")
MANUSCRIPT_STATUS = ("draft", "review", "ready", "submitted")


class ResearchQuestion(Base):
    """研究问题：项目要回答的科学问题、假设与结论。"""
    __tablename__ = "research_questions"
    __table_args__ = (Index("ix_rq_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, default="", server_default="")
    background: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium", server_default="medium")
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_refs_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    conclusion: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class DatasetRecord(Base):
    """数据集登记：来源、版本、切分、模式、完整性哈希与核验状态。"""
    __tablename__ = "dataset_records"
    __table_args__ = (Index("ix_dataset_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), default="attached_material", server_default="attached_material")
    material_ids_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    version: Mapped[str] = mapped_column(String(80), default="v1", server_default="v1")
    license: Mapped[str] = mapped_column(String(120), default="", server_default="")
    size_rows: Mapped[int | None] = mapped_column(Integer, nullable=True)
    schema_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    split_info_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    integrity_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provenance_ref: Mapped[str] = mapped_column(String(300), default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="registered", server_default="registered", index=True)
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ExperimentDesign(Base):
    """实验设计：变量、对照、预期结果与审核状态。"""
    __tablename__ = "experiment_designs"
    __table_args__ = (Index("ix_design_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    research_question_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    hypothesis: Mapped[str] = mapped_column(Text, default="", server_default="")
    variables_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    controls_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    expected_outcome: Mapped[str] = mapped_column(Text, default="", server_default="")
    method: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True)
    reviewer_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class Experiment(Base):
    """实验执行记录：关联既有复现计划/运行/指标，同时记录负责人、结论与证据引用。"""
    __tablename__ = "experiments"
    __table_args__ = (Index("ix_experiment_project", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    design_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="queued", server_default="queued", index=True)
    linked_plan_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    linked_run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    dataset_ids_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    config_ref_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    result_summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    conclusion: Mapped[str] = mapped_column(Text, default="", server_default="")
    evidence_refs_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ManuscriptDraft(Base):
    """论文撰写稿件：章节、版本、关联事实与材料、提交状态。"""
    __tablename__ = "manuscript_drafts"
    __table_args__ = (Index("ix_manuscript_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    section: Mapped[str] = mapped_column(String(120), default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    linked_facts_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    linked_materials_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    body: Mapped[str] = mapped_column(Text, default="", server_default="")
    last_edited_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ProjectStageState(Base):
    """项目各阶段状态轨迹：一个项目 × 一个阶段一行，记录进入/完成时间与阻塞说明。"""
    __tablename__ = "project_stage_states"
    __table_args__ = (
        UniqueConstraint("project_id", "stage", name="uq_stage_state"),
        Index("ix_stage_state_project", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    stage: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    entered_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ProjectArchive(Base):
    """项目归档记录：归档原因、快照引用与归档人；可重开但留痕。"""
    __tablename__ = "project_archives"
    __table_args__ = (Index("ix_archive_project", "project_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    reason: Mapped[str] = mapped_column(Text, default="", server_default="")
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    archived_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    archived_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    reopened_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    reopened_by: Mapped[str | None] = mapped_column(String(36), nullable=True)


# 二、版本化知识库

KNOWLEDGE_CATEGORIES = (
    "experience",        # 历史实验经验
    "failure_case",      # 常见复现错误 / 失败诊断案例
    "data_spec",         # 数据处理规范
    "model_config",      # 模型配置
    "env_config",        # 环境配置
    "audit_rule",        # 审计规则
    "team_norm",         # 团队内部研究规范
)
KNOWLEDGE_SOURCE_TYPES = ("manual", "from_experiment", "from_diagnostic", "from_rule", "imported")
KNOWLEDGE_STATUS = ("draft", "active", "deprecated", "retracted")
CORRECTION_KINDS = ("erratum", "outdated", "duplicate", "other")
CORRECTION_STATUS = ("open", "accepted", "rejected")


class KnowledgeEntry(Base):
    """知识条目：组织隔离、可版本化、可修订、可标记过时、可被纠错。"""
    __tablename__ = "knowledge_entries"
    __table_args__ = (
        Index("ix_kentry_org_status", "org_id", "status"),
        Index("ix_kentry_category", "category"),
        Index("ix_kentry_project", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    body: Mapped[str] = mapped_column(Text, nullable=False)
    source_type: Mapped[str] = mapped_column(String(30), default="manual", server_default="manual")
    source_ref_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active", index=True)
    current_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    visibility: Mapped[str] = mapped_column(String(20), default="org", server_default="org")  # org / project
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    deprecated_reason: Mapped[str] = mapped_column(Text, default="", server_default="")
    supersedes_entry_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class KnowledgeEntryVersion(Base):
    """知识条目版本：每次修订保留历史正文与修改说明，可回溯任意版本。"""
    __tablename__ = "knowledge_entry_versions"
    __table_args__ = (
        UniqueConstraint("entry_id", "version", name="uq_kentry_version"),
        Index("ix_kversion_entry", "entry_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    change_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    edited_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class KnowledgeCorrection(Base):
    """用户纠错：对知识条目的勘误/过时/重复上报，接受后修订或标记过时。"""
    __tablename__ = "knowledge_corrections"
    __table_args__ = (Index("ix_korr_entry_status", "entry_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    evidence_ref_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", index=True)
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolution_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class KnowledgeLink(Base):
    """知识与科研对象的追溯关联：实验/诊断/规则/材料/事实等。"""
    __tablename__ = "knowledge_links"
    __table_args__ = (
        UniqueConstraint("entry_id", "target_type", "target_id", name="uq_klink"),
        Index("ix_klink_entry", "entry_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    entry_id: Mapped[str] = mapped_column(String(36), ForeignKey("knowledge_entries.id", ondelete="CASCADE"), nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[str] = mapped_column(String(60), nullable=False)
    relation: Mapped[str] = mapped_column(String(30), default="derived_from", server_default="derived_from")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# 三、结构化人员交接

HANDOFF_STATUS = ("draft", "offered", "accepted", "declined", "completed")
HANDOFF_ITEM_KINDS = (
    "unfinished_task",      # 未完成任务
    "historical_experiment", # 历史实验
    "key_conclusion",        # 关键结论
    "evidence_gap",         # 证据缺失
    "env_config",            # 环境配置
    "pending_issue",        # 待处理问题
)
HANDOFF_ITEM_STATUS = ("open", "acknowledged", "closed")


class HandoffRecord(Base):
    """人员交接记录：发起时从真实项目数据生成快照与清单项，关联项目实体，而非纯文字总结。"""
    __tablename__ = "handoff_records"
    __table_args__ = (Index("ix_handoff_project", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    from_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    to_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True)
    snapshot_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    offered_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class HandoffItem(Base):
    """交接清单项：每条关联真实科研对象（ref_type/ref_id），可逐条确认/关闭。"""
    __tablename__ = "handoff_items"
    __table_args__ = (Index("ix_hitem_handoff", "handoff_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    handoff_id: Mapped[str] = mapped_column(String(36), ForeignKey("handoff_records.id", ondelete="CASCADE"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    ref_type: Mapped[str] = mapped_column(String(30), default="", server_default="")
    ref_id: Mapped[str] = mapped_column(String(60), default="", server_default="")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    detail: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open")
    assignee_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


# 五、科研协作工作项

TASK_KINDS = ("question", "dataset", "experiment", "verification", "writing", "audit_review", "handoff")
TASK_STATUS = ("todo", "in_progress", "blocked", "done", "cancelled")
TASK_PRIORITIES = ("low", "medium", "high")
MILESTONE_STATUS = ("open", "achieved", "overdue", "cancelled")


class Milestone(Base):
    """项目里程碑：与生命周期阶段关联，记录负责人与达成时间。"""
    __tablename__ = "milestones"
    __table_args__ = (Index("ix_milestone_project", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    due_date: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open", index=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    linked_stage: Mapped[str | None] = mapped_column(String(30), nullable=True)
    achieved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ResearchTask(Base):
    """科研工作项：区别于解析任务/复现任务，直接关联科研材料、实验、证据或审计任务。"""
    __tablename__ = "research_tasks"
    __table_args__ = (Index("ix_rtask_project_status", "project_id", "status"),
                      Index("ix_rtask_assignee", "assignee_user_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    kind: Mapped[str] = mapped_column(String(20), default="experiment", server_default="experiment")
    assignee_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="todo", server_default="todo", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="medium", server_default="medium")
    due_date: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    related_type: Mapped[str] = mapped_column(String(30), default="", server_default="")
    related_id: Mapped[str] = mapped_column(String(60), default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())
