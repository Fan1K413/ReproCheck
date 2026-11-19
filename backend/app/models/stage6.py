"""第六阶段数据表：身份/组织/权限/协作/审计轨迹（A）、基准案例/事实（B）、
规则/反馈/RAG（C）、集成/开放API（D）、治理（E）。

全部为新增表，不改前序表结构；对 projects 等仅加可空列（见 migrate_stage6）。
id 统一 uuid 字符串；时间 UTC。敏感列（password_hash/token_encrypted）绝不进入响应。
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
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import DateTimeUTC, _now


# ============================ A 组 · 身份 / 组织 / 权限 ============================

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[str] = mapped_column(String(200), nullable=False, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(300), nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), default="", server_default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    owner_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class OrgMember(Base):
    __tablename__ = "org_members"
    __table_args__ = (UniqueConstraint("org_id", "user_id", name="uq_orgmember"),
                      Index("ix_orgmember_org", "org_id"), Index("ix_orgmember_user", "user_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_key: Mapped[str] = mapped_column(String(40), default="member", server_default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class Workspace(Base):
    __tablename__ = "workspaces"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_teammember"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_in_team: Mapped[str] = mapped_column(String(40), default="member", server_default="member")
    joined_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ProjectMember(Base):
    __tablename__ = "project_members"
    __table_args__ = (UniqueConstraint("project_id", "user_id", name="uq_projectmember"),
                      Index("ix_projectmember_project", "project_id"), Index("ix_projectmember_user", "user_id"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_key: Mapped[str] = mapped_column(String(40), default="researcher", server_default="researcher")
    added_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class Invitation(Base):
    __tablename__ = "invitations"
    __table_args__ = (Index("ix_invitation_org_status", "org_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str] = mapped_column(String(36), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    email: Mapped[str] = mapped_column(String(200), nullable=False)
    role_key: Mapped[str] = mapped_column(String(40), default="member", server_default="member")
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    expires_at: Mapped[datetime] = mapped_column(DateTimeUTC(), nullable=False)
    invited_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    accepted_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    key: Mapped[str] = mapped_column(String(40), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), default="project", server_default="project")
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    is_system: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")


class Permission(Base):
    __tablename__ = "permissions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    key: Mapped[str] = mapped_column(String(60), nullable=False, unique=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")


class RolePermission(Base):
    __tablename__ = "role_permissions"
    __table_args__ = (UniqueConstraint("role_id", "permission_id", name="uq_roleperm"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    role_id: Mapped[str] = mapped_column(String(36), ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)
    permission_id: Mapped[str] = mapped_column(String(36), ForeignKey("permissions.id", ondelete="CASCADE"), nullable=False)


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("ix_comment_target", "project_id", "target_type", "target_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    author_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[str] = mapped_column(String(60), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class ReviewRequest(Base):
    __tablename__ = "review_requests"
    __table_args__ = (Index("ix_review_project_status", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[str] = mapped_column(String(60), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    reviewer_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="pending", server_default="pending")
    decision_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class AuditTrail(Base):
    __tablename__ = "audit_trail"
    __table_args__ = (Index("ix_trail_project_time", "project_id", "created_at"),
                      Index("ix_trail_org_time", "org_id", "created_at"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    action: Mapped[str] = mapped_column(String(60), nullable=False)
    target_type: Mapped[str] = mapped_column(String(40), default="", server_default="")
    target_id: Mapped[str] = mapped_column(String(60), default="", server_default="")
    before_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    after_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    request_id: Mapped[str] = mapped_column(String(40), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# ============================ B 组 · 基准案例 / 事实 ============================

class BenchmarkCase(Base):
    __tablename__ = "benchmark_cases"
    __table_args__ = (Index("ix_case_domain", "domain"), Index("ix_case_task", "research_task"),
                      Index("ix_case_quality", "quality_level"), Index("ix_case_public", "is_public"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    doi: Mapped[str] = mapped_column(String(200), default="", server_default="")
    source_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    domain: Mapped[str] = mapped_column(String(120), default="", server_default="")
    research_task: Mapped[str] = mapped_column(String(200), default="", server_default="")
    model_architecture: Mapped[str] = mapped_column(String(200), default="", server_default="")
    dataset_name: Mapped[str] = mapped_column(String(200), default="", server_default="")
    code_repo_url: Mapped[str] = mapped_column(String(500), default="", server_default="")
    code_commit: Mapped[str] = mapped_column(String(80), default="", server_default="")
    license: Mapped[str] = mapped_column(String(120), default="", server_default="")
    quality_level: Mapped[str] = mapped_column(String(40), default="unverified", server_default="unverified")
    quality_evidence_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    summary: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class CaseFact(Base):
    __tablename__ = "case_facts"
    __table_args__ = (Index("ix_casefact_case_field", "case_id", "field_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("benchmark_cases.id", ondelete="CASCADE"), nullable=False)
    field_key: Mapped[str] = mapped_column(String(80), nullable=False)
    raw_field: Mapped[str] = mapped_column(String(120), default="", server_default="")
    raw_value: Mapped[str] = mapped_column(Text, default="", server_default="")
    normalized_value: Mapped[str] = mapped_column(Text, default="", server_default="")
    unit: Mapped[str] = mapped_column(String(40), default="", server_default="")
    source_type: Mapped[str] = mapped_column(String(40), default="", server_default="")
    source_ref: Mapped[str] = mapped_column(String(300), default="", server_default="")
    context: Mapped[str] = mapped_column(Text, default="", server_default="")
    applicable_experiment: Mapped[str] = mapped_column(String(200), default="", server_default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class CaseVerification(Base):
    __tablename__ = "case_verifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    case_id: Mapped[str] = mapped_column(String(36), ForeignKey("benchmark_cases.id", ondelete="CASCADE"), nullable=False, index=True)
    verifier_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    verification_type: Mapped[str] = mapped_column(String(30), nullable=False)  # execution / review
    conditions_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    result: Mapped[str] = mapped_column(String(20), nullable=False)  # pass / fail / partial
    notes: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# ============================ C 组 · 规则 / 反馈 / RAG ============================

class AuditRule(Base):
    __tablename__ = "audit_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_key: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    domain: Mapped[str] = mapped_column(String(120), default="", server_default="")
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    risk_level: Mapped[str] = mapped_column(String(20), default="medium", server_default="medium")
    evidence_requirement: Mapped[str] = mapped_column(Text, default="", server_default="")
    current_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default="1")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, onupdate=_now, server_default=func.now())


class AuditRuleVersion(Base):
    __tablename__ = "audit_rule_versions"
    __table_args__ = (UniqueConstraint("rule_id", "version", name="uq_ruleversion"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(36), ForeignKey("audit_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    check_logic_json: Mapped[str] = mapped_column(Text, nullable=False)
    change_note: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")


class RuleTestSample(Base):
    __tablename__ = "rule_test_samples"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_version_id: Mapped[str] = mapped_column(String(36), ForeignKey("audit_rule_versions.id", ondelete="CASCADE"), nullable=False, index=True)
    input_json: Mapped[str] = mapped_column(Text, nullable=False)
    expected_json: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str] = mapped_column(String(120), default="", server_default="")


class RuleEvaluation(Base):
    __tablename__ = "rule_evaluations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    rule_id: Mapped[str] = mapped_column(String(36), ForeignKey("audit_rules.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    dataset_ref: Mapped[str] = mapped_column(String(200), default="", server_default="")
    metrics_json: Mapped[str] = mapped_column(Text, nullable=False)
    ran_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class AuditFeedback(Base):
    __tablename__ = "audit_feedback"
    __table_args__ = (Index("ix_feedback_project_status", "project_id", "status"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    project_id: Mapped[str] = mapped_column(String(36), nullable=False)
    finding_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    feedback_type: Mapped[str] = mapped_column(String(30), nullable=False)
    context_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_ref: Mapped[str] = mapped_column(String(300), default="", server_default="")
    note: Mapped[str] = mapped_column(Text, default="", server_default="")
    status: Mapped[str] = mapped_column(String(20), default="open", server_default="open")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    resolved_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"
    __table_args__ = (Index("ix_knowledge_source", "source_type"), Index("ix_knowledge_public", "is_public"))

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_ref: Mapped[str] = mapped_column(String(300), default="", server_default="")
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# ============================ D 组 · 集成 / 开放 API ============================

class RepositoryConnection(Base):
    __tablename__ = "repository_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)  # github / gitlab / gitee
    account_label: Mapped[str] = mapped_column(String(200), default="", server_default="")
    auth_type: Mapped[str] = mapped_column(String(20), default="pat", server_default="pat")
    token_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    scopes_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="connected", server_default="connected")
    repo_allowlist_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class RepositorySnapshot(Base):
    __tablename__ = "repository_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    connection_id: Mapped[str] = mapped_column(String(36), ForeignKey("repository_connections.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    repo_full_name: Mapped[str] = mapped_column(String(300), nullable=False)
    default_branch: Mapped[str] = mapped_column(String(120), default="", server_default="")
    commit_sha: Mapped[str] = mapped_column(String(80), default="", server_default="")
    tag: Mapped[str] = mapped_column(String(120), default="", server_default="")
    branch: Mapped[str] = mapped_column(String(120), default="", server_default="")
    version_diff_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class NotebookCell(Base):
    __tablename__ = "notebook_cells"
    __table_args__ = (Index("ix_nbcell_material_order", "material_id", "order_index"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    material_id: Mapped[str] = mapped_column(String(36), ForeignKey("materials.id", ondelete="CASCADE"), nullable=False)
    cell_id: Mapped[str] = mapped_column(String(80), default="", server_default="")
    cell_type: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(Text, default="", server_default="")
    execution_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outputs_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class ApiToken(Base):
    __tablename__ = "api_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    prefix: Mapped[str] = mapped_column(String(20), default="", server_default="")
    scopes_json: Mapped[str] = mapped_column(Text, nullable=False)
    rate_limit_per_min: Mapped[int] = mapped_column(Integer, default=60, server_default="60")
    expires_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


class ApiCallLog(Base):
    __tablename__ = "api_call_logs"
    __table_args__ = (Index("ix_apilog_token_time", "token_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    token_id: Mapped[str] = mapped_column(String(36), ForeignKey("api_tokens.id", ondelete="CASCADE"), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(200), nullable=False)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    duration_ms: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    ip_hash: Mapped[str] = mapped_column(String(64), default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())


# ============================ E 组 · 治理 ============================

class AiConsent(Base):
    __tablename__ = "ai_consents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    project_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    allow_external_llm: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    scope: Mapped[str] = mapped_column(String(40), default="project", server_default="project")
    granted_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)


class DataExportRequest(Base):
    __tablename__ = "data_export_requests"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    org_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending")
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTimeUTC(), default=_now, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTimeUTC(), nullable=True)