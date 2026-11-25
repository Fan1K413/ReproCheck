"""第一阶段数据表：projects / materials / source_chunks / extracted_facts /
audit_findings / evidences / ai_runs。所有审计运行都保留来源关系。"""
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
    """带时区标记的 DateTime，兼容 SQLite 与 PostgreSQL。"""

    def __init__(self, *args, **kwargs):
        kwargs.setdefault("timezone", True)
        super().__init__(*args, **kwargs)


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    domain: Mapped[str] = mapped_column(String(120), default="", server_default="")
    paper_title: Mapped[str] = mapped_column(String(300), default="", server_default="")
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now()
    )

    # 第六阶段追加列（nullable，兼容遗留数据；由 migrate_stage6 回填归属）
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    workspace_id: Mapped[str | None] = mapped_column(String(36), nullable=True)

    materials: Mapped[list["Material"]] = relationship(
        back_populates="project", cascade="all, delete-orphan"
    )


class Material(Base):
    __tablename__ = "materials"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_name: Mapped[str] = mapped_column(String(200), nullable=False)
    material_type: Mapped[str] = mapped_column(String(40), default="text", server_default="text")
    raw_text: Mapped[str] = mapped_column(Text, nullable=False, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )

    # 第二阶段追加列（全部 nullable/默认值，兼容第一阶段数据）
    original_filename: Mapped[str | None] = mapped_column(String(300), nullable=True)
    stored_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    mime_type: Mapped[str | None] = mapped_column(String(120), nullable=True)
    parse_status: Mapped[str] = mapped_column(
        String(30), default="uploaded", server_default="uploaded", index=True
    )
    parser_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    parse_error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    parse_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    parse_duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    page_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    needs_ocr: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    parse_metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    project: Mapped[Project] = relationship(back_populates="materials")
    chunks: Mapped[list["SourceChunk"]] = relationship(
        back_populates="material", cascade="all, delete-orphan"
    )


class SourceChunk(Base):
    """材料文本块。chunk_id 是业务标识（如 paper_chunk_001），模型只能引用这些 ID。"""

    __tablename__ = "source_chunks"
    __table_args__ = (
        Index("ix_source_chunks_material_chunk", "material_id", "chunk_id", unique=True),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    material_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chunk_id: Mapped[str] = mapped_column(String(80), nullable=False)
    chunk_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    original_text: Mapped[Text] = mapped_column(Text, nullable=False)
    locator_type: Mapped[str] = mapped_column(
        String(30), default="text_paragraph", server_default="text_paragraph"
    )
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )

    # 第二阶段追加列
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    material_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    parser_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    source_locator_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    token_estimate: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    material: Mapped[Material] = relationship(back_populates="chunks")


class ExtractedFact(Base):
    __tablename__ = "extracted_facts"
    __table_args__ = (Index("ix_extracted_facts_run_field", "run_id", "field_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    material_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("materials.id", ondelete="CASCADE"), nullable=False
    )
    chunk_id: Mapped[str] = mapped_column(String(80), nullable=False)
    field_key: Mapped[str] = mapped_column(String(80), nullable=False)
    raw_value: Mapped[str] = mapped_column(String(200), nullable=False)
    normalized_value: Mapped[str | None] = mapped_column(Text, nullable=True)
    unit: Mapped[str | None] = mapped_column(String(40), nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")

    # 第二阶段追加列（第一阶段旧行取默认值，不丢失）
    fact_id: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    fact_type: Mapped[str] = mapped_column(
        String(40), default="training_parameter", server_default="training_parameter"
    )
    field_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    assertion_type: Mapped[str] = mapped_column(
        String(20), default="explicit", server_default="explicit"
    )
    extraction_status: Mapped[str] = mapped_column(
        String(20), default="supported", server_default="supported"
    )
    parser_source: Mapped[str] = mapped_column(
        String(20), default="model", server_default="model"
    )  # model / human / program
    extraction_run_id: Mapped[str | None] = mapped_column(String(60), nullable=True, index=True)
    quote: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_locator_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    revision_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ai_original_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )


class AuditFinding(Base):
    __tablename__ = "audit_findings"
    __table_args__ = (Index("ix_audit_findings_run", "run_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    field_key: Mapped[str] = mapped_column(String(80), nullable=False)
    severity: Mapped[str] = mapped_column(
        String(20), default="medium", server_default="medium"
    )
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    ai_explanation: Mapped[str] = mapped_column(
        Text, nullable=False, default="", server_default=""
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )

    evidences: Mapped[list["Evidence"]] = relationship(
        back_populates="finding", cascade="all, delete-orphan"
    )


class Evidence(Base):
    """证据原文从后端保存的 source_chunks 读取，绝不使用模型生成的引用文本。"""

    __tablename__ = "evidences"
    __table_args__ = (Index("ix_evidences_finding", "finding_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    evidence_id: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    finding_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("audit_findings.id", ondelete="CASCADE"), nullable=False
    )
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    material_id: Mapped[str] = mapped_column(String(36), nullable=False)
    chunk_id: Mapped[str] = mapped_column(String(80), nullable=False)
    source_name: Mapped[str] = mapped_column(String(200), nullable=False)
    locator_type: Mapped[str] = mapped_column(
        String(30), default="text_paragraph", server_default="text_paragraph"
    )
    page_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )

    finding: Mapped[AuditFinding] = relationship(back_populates="evidences")


class AIRun(Base):
    """每次 AI 调用与审计运行都记录元数据及完整结果快照。"""

    __tablename__ = "ai_runs"
    __table_args__ = (Index("ix_ai_runs_project_created", "project_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    run_type: Mapped[str] = mapped_column(
        String(30), default="demo_audit", server_default="demo_audit"
    )
    status: Mapped[str] = mapped_column(String(30), default="running", server_default="running")
    provider: Mapped[str] = mapped_column(String(40), default="", server_default="")
    model: Mapped[str] = mapped_column(String(120), default="", server_default="")
    request_id: Mapped[str] = mapped_column(String(60), default="", server_default="")
    # 第二阶段追加列
    task_type: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    prompt_version: Mapped[str | None] = mapped_column(String(40), nullable=True)
    material_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    calls: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    success: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    error_code: Mapped[str | None] = mapped_column(String(60), nullable=True)
    result_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTimeUTC(), default=_now, server_default=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
