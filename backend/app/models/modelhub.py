"""第十一阶段新增：模型中心 7 张表。全部为新增表，不改既有 53 表。

安全约束：
- model_credentials.key_ciphertext 只存密文；任何列表/详情接口不得返回该列。
- 所有用户级表带 owner_user_id；查询强制按当前用户过滤。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean, DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import DateTimeUTC, _now


class ModelProvider(Base):
    __tablename__ = "model_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    protocol: Mapped[str] = mapped_column(String(40), nullable=False)
    default_base_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    capabilities_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    default_models_json: Mapped[str] = mapped_column(Text, default="[]", server_default="[]")
    docs_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    is_builtin: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ModelCredential(Base):
    __tablename__ = "model_credentials"
    __table_args__ = (
        Index("ix_modelcred_owner", "owner_user_id"),
        Index("ix_modelcred_provider", "provider_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider_key: Mapped[str] = mapped_column(String(60), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False, default="", server_default="")
    key_ciphertext: Mapped[str] = mapped_column(Text, nullable=False)
    key_hint: Mapped[str] = mapped_column(String(40), default="", server_default="")
    base_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="active", server_default="active")
    last_error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ModelProfile(Base):
    __tablename__ = "model_profiles"
    __table_args__ = (
        Index("ix_modelprofile_owner", "owner_user_id"),
        UniqueConstraint("owner_user_id", "provider_key", "model_id", name="uq_modelprofile"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    provider_key: Mapped[str] = mapped_column(String(60), nullable=False)
    credential_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    model_id: Mapped[str] = mapped_column(String(160), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), default="", server_default="")
    params_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    timeout_s: Mapped[float] = mapped_column(Float, default=60.0, server_default="60")
    max_retries: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    max_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    is_fallback: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class TaskModelBinding(Base):
    __tablename__ = "task_model_bindings"
    __table_args__ = (
        Index("ix_taskbind_owner_task", "owner_user_id", "task_key"),
        UniqueConstraint("owner_user_id", "org_id", "project_id", "task_key",
                         name="uq_taskbind_scope"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_key: Mapped[str] = mapped_column(String(60), nullable=False)
    primary_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    fallback_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    params_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    auto_route: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    cost_preference: Mapped[str] = mapped_column(String(20), default="balanced", server_default="balanced")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ModelCallLog(Base):
    __tablename__ = "model_call_logs"
    __table_args__ = (
        Index("ix_modelcall_owner_time", "owner_user_id", "created_at"),
        Index("ix_modelcall_task", "task_key"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    request_id: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_key: Mapped[str] = mapped_column(String(60), default="", server_default="")
    provider_key: Mapped[str] = mapped_column(String(60), default="", server_default="")
    model_id: Mapped[str] = mapped_column(String(160), default="", server_default="")
    success: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    total_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    fallback_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    cost_estimate: Mapped[str] = mapped_column(String(20), default="unavailable", server_default="unavailable")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ModelHealth(Base):
    __tablename__ = "model_health"
    __table_args__ = (Index("ix_modelhealth_target", "provider_key", "model_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    provider_key: Mapped[str] = mapped_column(String(60), nullable=False)
    model_id: Mapped[str] = mapped_column(String(160), default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="unknown", server_default="unknown")
    last_error_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class ModelRoute(Base):
    __tablename__ = "model_routes"
    __table_args__ = (Index("ix_modelroute_owner_task", "owner_user_id", "task_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    task_key: Mapped[str] = mapped_column(String(60), nullable=False)
    chosen_profile_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    reason_json: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")
    auto_route: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
