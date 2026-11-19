"""项目协作服务：成员分配、评论（关联科研对象）、复核申请、活动记录。"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access, user_has_permission
from app.core.errors import AppError
from app.core.rbac import PROJECT_ROLE_RANK
from app.core.security import new_id
from app.models.stage6 import AuditTrail, Comment, ProjectMember, ReviewRequest, User
from app.services.trail_service import record_trail

_COMMENT_TARGETS = {"finding", "evidence", "task", "fact", "material"}
_REVIEW_TARGETS = {"finding", "remediation"}
_PROJECT_ROLES = {"project_lead", "researcher", "reviewer", "viewer"}


async def add_project_member(db: AsyncSession, actor: User, project_id: str, user_id: str,
                             role_key: str, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, actor)
    if not await user_has_permission(db, actor, "project.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "需要项目管理权限。")
    if role_key not in _PROJECT_ROLES:
        raise AppError("VALIDATION_ERROR", f"项目角色须为 {sorted(_PROJECT_ROLES)}。")
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if target is None:
        raise AppError("NOT_FOUND", "用户不存在。")
    exists = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))).scalar_one_or_none()
    if exists:
        raise AppError("CONFLICT", "该用户已是项目成员。")
    pm = ProjectMember(id=new_id("pm"), project_id=project_id, user_id=user_id,
                       role_key=role_key, added_by=actor.id)
    db.add(pm)
    await record_trail(db, action="project.member_add", actor_user_id=actor.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_member", target_id=user_id,
                       after={"role_key": role_key}, summary="分配项目成员", request_id=request_id)
    await db.commit()
    return {"project_id": project_id, "user_id": user_id, "role_key": role_key}


async def list_project_members(db: AsyncSession, actor: User, project_id: str) -> list[dict]:
    await resolve_project_access(db, project_id, actor)
    rows = (await db.execute(select(ProjectMember).where(ProjectMember.project_id == project_id))).scalars().all()
    out = []
    for pm in rows:
        u = (await db.execute(select(User).where(User.id == pm.user_id))).scalar_one_or_none()
        out.append({"user_id": pm.user_id, "email": u.email if u else "", "display_name": u.display_name if u else "",
                    "role_key": pm.role_key, "added_at": pm.added_at.isoformat() if pm.added_at else ""})
    return out


async def update_project_member(db: AsyncSession, actor: User, project_id: str, user_id: str,
                                role_key: str, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, actor)
    if not await user_has_permission(db, actor, "project.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "需要项目管理权限。")
    if role_key not in _PROJECT_ROLES:
        raise AppError("VALIDATION_ERROR", "无效项目角色。")
    pm = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))).scalar_one_or_none()
    if pm is None:
        raise AppError("NOT_FOUND", "项目成员不存在。")
    before = pm.role_key
    pm.role_key = role_key
    await record_trail(db, action="project.member_role", actor_user_id=actor.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_member", target_id=user_id,
                       before={"role_key": before}, after={"role_key": role_key}, summary="修改项目角色", request_id=request_id)
    await db.commit()
    return {"user_id": user_id, "role_key": role_key}


async def remove_project_member(db: AsyncSession, actor: User, project_id: str, user_id: str, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, actor)
    if not await user_has_permission(db, actor, "project.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "需要项目管理权限。")
    pm = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == user_id))).scalar_one_or_none()
    if pm is None:
        raise AppError("NOT_FOUND", "项目成员不存在。")
    await db.delete(pm)
    await record_trail(db, action="project.member_remove", actor_user_id=actor.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_member", target_id=user_id,
                       before={"role_key": pm.role_key}, summary="移除项目成员", request_id=request_id)
    await db.commit()
    return {"removed": user_id}


async def create_comment(db: AsyncSession, actor: User, project_id: str, target_type: str,
                         target_id: str, body: str, request_id: str = "") -> dict:
    await resolve_project_access(db, project_id, actor)
    if not await user_has_permission(db, actor, "comment.write", project_id=project_id):
        raise AppError("FORBIDDEN", "当前角色不能评论。")
    if target_type not in _COMMENT_TARGETS:
        raise AppError("VALIDATION_ERROR", f"评论对象须为 {sorted(_COMMENT_TARGETS)}。")
    if not body.strip():
        raise AppError("VALIDATION_ERROR", "评论内容不能为空。")
    c = Comment(id=new_id("cmt"), project_id=project_id, author_user_id=actor.id,
                target_type=target_type, target_id=target_id, body=body.strip())
    db.add(c)
    await record_trail(db, action="comment.create", actor_user_id=actor.id, project_id=project_id,
                       target_type=target_type, target_id=target_id, summary="发表评论", request_id=request_id)
    await db.commit()
    return {"id": c.id, "target_type": target_type, "target_id": target_id, "body": c.body,
            "author_user_id": actor.id, "created_at": c.created_at.isoformat()}


async def list_comments(db: AsyncSession, actor: User, project_id: str,
                        target_type: str | None, target_id: str | None) -> list[dict]:
    await resolve_project_access(db, project_id, actor)
    q = select(Comment).where(Comment.project_id == project_id)
    if target_type:
        q = q.where(Comment.target_type == target_type)
    if target_id:
        q = q.where(Comment.target_id == target_id)
    rows = (await db.execute(q.order_by(Comment.created_at.asc()))).scalars().all()
    out = []
    for c in rows:
        u = (await db.execute(select(User).where(User.id == c.author_user_id))).scalar_one_or_none()
        out.append({"id": c.id, "target_type": c.target_type, "target_id": c.target_id, "body": c.body,
                    "author_user_id": c.author_user_id, "author_name": u.display_name if u else "",
                    "created_at": c.created_at.isoformat()})
    return out


async def delete_comment(db: AsyncSession, actor: User, comment_id: str, request_id: str = "") -> dict:
    c = (await db.execute(select(Comment).where(Comment.id == comment_id))).scalar_one_or_none()
    if c is None:
        raise AppError("NOT_FOUND", "评论不存在。")
    await resolve_project_access(db, c.project_id, actor)
    if c.author_user_id != actor.id and not await user_has_permission(db, actor, "project.manage", project_id=c.project_id):
        raise AppError("FORBIDDEN", "只能删除本人评论或需项目管理权限。")
    await db.delete(c)
    await db.commit()
    return {"deleted": comment_id}


async def create_review(db: AsyncSession, actor: User, project_id: str, target_type: str,
                        target_id: str, reviewer_user_id: str | None, request_id: str = "") -> dict:
    await resolve_project_access(db, project_id, actor)
    if target_type not in _REVIEW_TARGETS:
        raise AppError("VALIDATION_ERROR", f"复核对象须为 {sorted(_REVIEW_TARGETS)}。")
    r = ReviewRequest(id=new_id("rev"), project_id=project_id, target_type=target_type, target_id=target_id,
                      requested_by=actor.id, reviewer_user_id=reviewer_user_id, status="pending")
    db.add(r)
    await record_trail(db, action="review.request", actor_user_id=actor.id, project_id=project_id,
                       target_type=target_type, target_id=target_id, summary="提交复核申请", request_id=request_id)
    await db.commit()
    return {"id": r.id, "target_type": target_type, "target_id": target_id, "status": "pending",
            "reviewer_user_id": reviewer_user_id}


async def list_reviews(db: AsyncSession, actor: User, project_id: str) -> list[dict]:
    await resolve_project_access(db, project_id, actor)
    rows = (await db.execute(select(ReviewRequest).where(ReviewRequest.project_id == project_id)
                             .order_by(ReviewRequest.created_at.desc()))).scalars().all()
    return [{"id": r.id, "target_type": r.target_type, "target_id": r.target_id, "status": r.status,
             "requested_by": r.requested_by, "reviewer_user_id": r.reviewer_user_id,
             "decision_note": r.decision_note or "", "created_at": r.created_at.isoformat(),
             "decided_at": r.decided_at.isoformat() if r.decided_at else None} for r in rows]


async def decide_review(db: AsyncSession, actor: User, review_id: str, status: str,
                        decision_note: str, request_id: str = "") -> dict:
    r = (await db.execute(select(ReviewRequest).where(ReviewRequest.id == review_id))).scalar_one_or_none()
    if r is None:
        raise AppError("NOT_FOUND", "复核申请不存在。")
    await resolve_project_access(db, r.project_id, actor)
    if status not in ("approved", "rejected", "changes_requested"):
        raise AppError("VALIDATION_ERROR", "无效审核结论。")
    is_reviewer = r.reviewer_user_id == actor.id
    if not is_reviewer and not await user_has_permission(db, actor, "review.decide", project_id=r.project_id):
        raise AppError("FORBIDDEN", "仅指定审核人或具备审核权限者可裁定。")
    before = r.status
    r.status = status
    r.decision_note = decision_note
    r.decided_at = datetime.now(timezone.utc)
    await record_trail(db, action="review.decide", actor_user_id=actor.id, project_id=r.project_id,
                       target_type=r.target_type, target_id=r.target_id,
                       before={"status": before}, after={"status": status, "note": decision_note},
                       summary="审核复核申请", request_id=request_id)
    await db.commit()
    return {"id": review_id, "status": status, "decision_note": decision_note}


async def list_activity(db: AsyncSession, actor: User, project_id: str, limit: int, offset: int) -> dict:
    await resolve_project_access(db, project_id, actor)
    total = (await db.execute(select(func.count()).select_from(AuditTrail)
                              .where(AuditTrail.project_id == project_id))).scalar_one()
    rows = (await db.execute(select(AuditTrail).where(AuditTrail.project_id == project_id)
                             .order_by(AuditTrail.created_at.desc()).limit(limit).offset(offset))).scalars().all()
    items = [{"id": t.id, "action": t.action, "actor_user_id": t.actor_user_id, "target_type": t.target_type,
              "target_id": t.target_id, "before": t.before_json, "after": t.after_json,
              "summary": t.summary or "", "created_at": t.created_at.isoformat()} for t in rows]
    return {"items": items, "total": total, "limit": limit, "offset": offset}