"""数据审计运行记录表（第十阶段独立升级模块）。

只存报告 JSON 与统计，不复制任何原始科研数据。
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class DataAuditRun(Base):
    __tablename__ = "data_audit_runs"
    __table_args__ = (
        Index("ix_data_audit_runs_project", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, server_default=func.now()
    )
    status: Mapped[str] = mapped_column(
        String(20), default="completed", server_default="completed"
    )  # completed / failed
    scope_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    report_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    finding_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )
    blocking_count: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )
    duration_ms: Mapped[int] = mapped_column(
        Integer, default=0, server_default="0"
    )
