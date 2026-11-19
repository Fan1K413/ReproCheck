"""第二阶段数据模型扩展。

设计原则（保护第一阶段）：
- 不删除、不重命名任何第一阶段表或列；
- 只给现有表"追加" nullable / 有默认值的列；
- 新增 4 张表：material_parse_runs / parse_tasks / evidence_items / fact_revisions；
- extracted_facts 扩展阶段二字段，第一阶段旧行的新字段为默认值，不丢失。

PyMuPDF 版本已安装为 2.1.x，requirements 中锁定版本以实际环境为准（见迁移说明）。
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class DateTimeUTC(DateTime):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault("timezone", True)
        super().__init__(*args, **kwargs)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------- 新增表 ----------

class MaterialParseRun(Base):
    """每次材料解析任务的独立记录（区分于 AI 调用记录 ai_runs）。"""
    __tablename__ = "material_parse_runs"
    __table_args__ = (Index("ix_mpr_material", "material_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    material_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    parser_version: Mapped[str] = mapped_column(String(40), default="", server_default="")
    parser_status: Mapped[str] = mapped_column(String(30), default="queued", server_default="queued")
    chunk_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    warning_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ParseTask(Base):
    """解析+抽取任务状态机（Init/Step/Poll 可恢复设计）。"""
    __tablename__ = "parse_tasks"
    __table_args__ = (Index("ix_pt_project_status", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    material_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    idem_key: Mapped[str] = mapped_column(String(80), default="", server_default="", index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued", server_default="queued")
    stage: Mapped[str] = mapped_column(String(30), default="uploaded", server_default="uploaded")
    stage_message: Mapped[str] = mapped_column(String(300), default="", server_default="")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str] = mapped_column(String(120), default="", server_default="")
    prompt_version: Mapped[str] = mapped_column(String(40), default="", server_default="")
    model_calls: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    facts_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    # 第六阶段：真实状态机所需字段。全部 nullable/默认值，兼容已有库。
    paused_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=600, server_default="600")
    failure_category: Mapped[str] = mapped_column(String(40), default="", server_default="")
    resume_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class EvidenceItem(Base):
    """第二阶段证据库：原文来自后端材料，quote 经校验后保存。"""
    __tablename__ = "evidence_items"
    __table_args__ = (Index("ix_ev_fact_chunk", "fact_id", "chunk_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    evidence_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    fact_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    material_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    chunk_id: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    source_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    quote: Mapped[str] = mapped_column(Text, default="", server_default="")
    original_text: Mapped[str] = mapped_column(Text, default="", server_default="")
    source_locator: Mapped[str | None] = mapped_column(Text, nullable=True)  # JSON 字符串
    verification_status: Mapped[str] = mapped_column(
        String(30), default="unverified", server_default="unverified"
    )  # verified / unverified / rejected
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class FactRevision(Base):
    """人工修订留痕：保留修改前后值，不冒充 AI 原始输出。"""
    __tablename__ = "fact_revisions"
    __table_args__ = (Index("ix_fr_fact", "fact_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    revision_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    fact_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    field_key: Mapped[str] = mapped_column(String(120), default="", server_default="")
    old_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    new_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    revision_source: Mapped[str] = mapped_column(
        String(20), default="human", server_default="human"
    )
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
