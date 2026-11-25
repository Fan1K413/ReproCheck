"""Versioned, project-scoped AgentArts audit history."""
from datetime import datetime

from sqlalchemy import ForeignKey, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import DateTimeUTC, _now


class PaperAuditRun(Base):
    __tablename__ = "paper_audit_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    parent_id: Mapped[str | None] = mapped_column(String(36))
    status: Mapped[str] = mapped_column(String(24), default="running")
    workflow_version: Mapped[str] = mapped_column(String(120))
    rule_version: Mapped[str] = mapped_column(String(40))
    snapshot: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    deadline: Mapped[datetime] = mapped_column(DateTimeUTC())
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now)


class PaperAuditCheck(Base):
    __tablename__ = "paper_audit_checks"

    run_id: Mapped[str] = mapped_column(
        ForeignKey("paper_audit_runs.id", ondelete="CASCADE"), primary_key=True
    )
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    finding: Mapped[dict] = mapped_column(JSON)
