"""C 组 · 审计反馈治理服务。

核心治理约束（见 docs/FEEDBACK_GOVERNANCE_SPEC.md）：
- 单条用户反馈不是绝对真理，绝不自动改写任何生产规则 / 规则版本。
- 反馈只是「待治理信号」：创建即 status=open，留痕，进入人工分诊队列。
- 分诊需 finding.review 权限；disputed（争议）必须转人工复核（生成 ReviewRequest），
  不得由系统或 AI 自行裁定为真。
- 规则的任何变更只能走 rule_service 的显式版本流程（rule.manage + 离线测试）。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access, user_has_permission
from app.core.errors import AppError
from app.core.security import new_id
from app.models.stage6 import AuditFeedback, ReviewRequest, User
from app.services.trail_service import record_trail

FEEDBACK_TYPES = {"confirm", "false_positive", "insufficient_evidence",
                  "request_review", "supplement", "fix_note"}
TRIAGE_STATUSES = {"triaged", "resolved", "disputed"}


def _loads(text: str | None) -> dict:
    if not text:
        return {}
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else {"value": v}
    except (json.JSONDecodeError, TypeError):
        return {}


def feedback_view(f: AuditFeedback) -> dict:
    return {
        "id": f.id, "project_id": f.project_id, "finding_id": f.finding_id, "run_id": f.run_id,
        "user_id": f.user_id, "feedback_type": f.feedback_type, "note": f.note or "",
        "evidence_ref": f.evidence_ref or "", "context": _loads(f.context_json), "status": f.status,
        "created_at": f.created_at.isoformat() if f.created_at else "",
        "resolved_by": f.resolved_by, "resolved_at": f.resolved_at.isoformat() if f.resolved_at else None,
    }


async def create_feedback(db: AsyncSession, user: User, project_id: str, finding_id: str | None,
                          feedback_type: str, note: str, evidence_ref: str,
                          context_json: dict | None, run_id: str | None = None,
                          request_id: str = "") -> dict:
    """项目成员可提交反馈。绝不触碰任何规则表。"""
    proj = await resolve_project_access(db, project_id, user)
    if feedback_type not in FEEDBACK_TYPES:
        raise AppError("VALIDATION_ERROR", f"feedback_type 须为 {sorted(FEEDBACK_TYPES)}。")
    if feedback_type in {"supplement", "fix_note", "insufficient_evidence"} and not (note or "").strip() and not (evidence_ref or "").strip():
        raise AppError("VALIDATION_ERROR", "该反馈类型需提供 note 或 evidence_ref 说明。")
    ctx = context_json if isinstance(context_json, dict) else {}
    f = AuditFeedback(id=new_id("fb"), project_id=project_id, finding_id=finding_id, run_id=run_id,
                      user_id=user.id, feedback_type=feedback_type, context_json=json.dumps(ctx, ensure_ascii=False),
                      evidence_ref=evidence_ref or "", note=note or "", status="open")
    db.add(f)
    await record_trail(db, action="feedback.create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="audit_feedback", target_id=f.id,
                       after={"feedback_type": feedback_type, "finding_id": finding_id, "status": "open"},
                       summary="提交审计反馈（不自动改规则）", request_id=request_id)
    await db.commit()
    return feedback_view(f)


async def list_feedback(db: AsyncSession, user: User, project_id: str, status: str | None = None) -> list[dict]:
    await resolve_project_access(db, project_id, user)
    q = select(AuditFeedback).where(AuditFeedback.project_id == project_id)
    if status:
        q = q.where(AuditFeedback.status == status)
    rows = (await db.execute(q.order_by(AuditFeedback.created_at.desc()))).scalars().all()
    user_ids = {f.user_id for f in rows if f.user_id} | {f.resolved_by for f in rows if f.resolved_by}
    names: dict[str, str] = {}
    if user_ids:
        names = dict((await db.execute(
            select(User.id, User.display_name).where(User.id.in_(user_ids)))).all())
    views = []
    for f in rows:
        view = feedback_view(f)
        view["user_name"] = names.get(f.user_id)
        view["resolved_by_name"] = names.get(f.resolved_by) if f.resolved_by else None
        views.append(view)
    return views


async def triage_feedback(db: AsyncSession, user: User, feedback_id: str, status: str,
                          resolution: str, request_id: str = "") -> dict:
    """分诊需 finding.review。disputed 转人工复核（生成 ReviewRequest），不自动裁定。"""
    f = (await db.execute(select(AuditFeedback).where(AuditFeedback.id == feedback_id))).scalar_one_or_none()
    if f is None:
        raise AppError("NOT_FOUND", "反馈不存在。")
    proj = await resolve_project_access(db, f.project_id, user)
    if not await user_has_permission(db, user, "finding.review", project_id=f.project_id):
        raise AppError("FORBIDDEN", "缺少权限：finding.review（需要审核人员及以上）。")
    if status not in TRIAGE_STATUSES:
        raise AppError("VALIDATION_ERROR", f"分诊状态须为 {sorted(TRIAGE_STATUSES)}。")

    before = {"status": f.status}
    f.status = status
    # 把分诊结论合并进 context（模型无独立 resolution 列），保留原始上下文
    ctx = _loads(f.context_json)
    ctx["resolution"] = resolution or ""
    ctx["triage_status"] = status
    f.context_json = json.dumps(ctx, ensure_ascii=False)

    review_id = None
    if status == "disputed":
        # 争议 -> 人工复核队列；系统不自行判定真伪，也不改规则
        rr = ReviewRequest(id=new_id("rev"), project_id=f.project_id, target_type="feedback",
                           target_id=f.id, requested_by=user.id, reviewer_user_id=None,
                           status="pending", decision_note="")
        db.add(rr)
        await db.flush()
        review_id = rr.id
        f.resolved_by = None
        f.resolved_at = None
    else:
        f.resolved_by = user.id
        f.resolved_at = datetime.now(timezone.utc)

    await record_trail(db, action="feedback.triage", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=f.project_id, target_type="audit_feedback", target_id=f.id,
                       before=before, after={"status": status, "resolution": resolution, "review_id": review_id},
                       summary="分诊反馈（争议转人工）" if status == "disputed" else "分诊反馈",
                       request_id=request_id)
    await db.commit()
    out = feedback_view(f)
    out["review_id"] = review_id
    out["requires_human_review"] = status == "disputed"
    return out