"""第十二阶段 · 科研协作工作流服务。

聚焦科研协作，不做通用项目管理软件：
- 里程碑：与生命周期阶段关联，记录负责人、截止与达成时间。
- 研究任务：直接关联研究问题/数据集/实验/核验/稿件/审计复核等科研对象。
- 逾期任务：按截止日期确定性判定，不做主观催办评分。
- 审计复核队列：聚合既有复核申请、待复核事实/问题/指标/诊断，统一入口，不重复实现审核流程。
- 团队活动记录：复用既有 AuditTrail（collab.list_activity），本表不另建活动流。
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
from app.models import AuditFinding, ExtractedFact
from app.models.stage4 import FailureDiagnostic, ReproductionMetric
from app.models.stage6 import ProjectMember, ReviewRequest, User
from app.models.stage12 import (
    MILESTONE_STATUS,
    Milestone,
    TASK_KINDS,
    TASK_PRIORITIES,
    TASK_STATUS,
    ResearchTask,
)
from app.services.trail_service import record_trail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    return None


# 里程碑


def _milestone_view(m: Milestone) -> dict:
    due = _parse_dt(m.due_date)
    overdue = m.status == "open" and due is not None and due < _now()
    return {
        "id": m.id, "title": m.title, "description": m.description,
        "due_date": m.due_date.isoformat() if m.due_date else None,
        "status": "overdue" if overdue else m.status, "owner_user_id": m.owner_user_id,
        "linked_stage": m.linked_stage, "achieved_at": m.achieved_at.isoformat() if m.achieved_at else None,
        "created_at": m.created_at.isoformat() if m.created_at else "",
    }


async def list_milestones(db: AsyncSession, user, project_id: str) -> list[dict]:
    await resolve_project_access(db, project_id, user)
    rows = (await db.execute(select(Milestone).where(
        Milestone.project_id == project_id).order_by(Milestone.due_date.asc().nulls_last()))).scalars().all()
    return [_milestone_view(m) for m in rows]


async def create_milestone(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    if not await user_has_permission(db, user, "milestone.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：milestone.manage。")
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "里程碑标题不能为空。")
    m = Milestone(
        id=new_id("ms"), project_id=project_id, org_id=proj.org_id, title=title,
        description=payload.get("description") or "",
        due_date=_parse_dt(payload.get("due_date")),
        status="open", owner_user_id=payload.get("owner_user_id") or user.id,
        linked_stage=payload.get("linked_stage"), created_by=user.id,
    )
    db.add(m)
    await record_trail(db, action="workflow.milestone_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="milestone", target_id=m.id,
                       after={"title": title}, summary="创建里程碑", request_id=request_id)
    await db.commit()
    await db.refresh(m)
    return _milestone_view(m)


async def update_milestone(db: AsyncSession, user, project_id: str, milestone_id: str,
                           payload: dict, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    if not await user_has_permission(db, user, "milestone.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：milestone.manage。")
    m = (await db.execute(select(Milestone).where(
        Milestone.id == milestone_id, Milestone.project_id == project_id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "里程碑不存在。")
    for field in ("title", "description", "owner_user_id", "linked_stage"):
        if field in payload:
            setattr(m, field, payload[field])
    if "due_date" in payload:
        m.due_date = _parse_dt(payload["due_date"])
    if "status" in payload:
        if payload["status"] not in MILESTONE_STATUS:
            raise AppError("VALIDATION_ERROR", "无效里程碑状态。")
        m.status = payload["status"]
        m.achieved_at = _now() if payload["status"] == "achieved" else None
    await record_trail(db, action="workflow.milestone_update", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="milestone", target_id=m.id,
                       after={"status": m.status}, summary="更新里程碑", request_id=request_id)
    await db.commit()
    await db.refresh(m)
    return _milestone_view(m)


# 研究任务


def _task_view(t: ResearchTask) -> dict:
    due = _parse_dt(t.due_date)
    overdue = t.status in ("todo", "in_progress", "blocked") and due is not None and due < _now()
    return {
        "id": t.id, "title": t.title, "description": t.description, "kind": t.kind,
        "assignee_user_id": t.assignee_user_id, "status": t.status, "priority": t.priority,
        "due_date": t.due_date.isoformat() if t.due_date else None, "overdue": overdue,
        "related_type": t.related_type, "related_id": t.related_id,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


async def list_tasks(db: AsyncSession, user, project_id: str, status: str | None = None,
                     assignee_user_id: str | None = None) -> list[dict]:
    await resolve_project_access(db, project_id, user)
    q = select(ResearchTask).where(ResearchTask.project_id == project_id)
    if status:
        q = q.where(ResearchTask.status == status)
    if assignee_user_id:
        q = q.where(ResearchTask.assignee_user_id == assignee_user_id)
    rows = (await db.execute(q.order_by(ResearchTask.created_at.asc()))).scalars().all()
    return [_task_view(t) for t in rows]


async def create_task(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    if not await user_has_permission(db, user, "lifecycle.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：lifecycle.manage。")
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "任务标题不能为空。")
    kind = payload.get("kind") or "experiment"
    if kind not in TASK_KINDS:
        raise AppError("VALIDATION_ERROR", f"任务类型须为 {sorted(TASK_KINDS)}。")
    priority = payload.get("priority") or "medium"
    if priority not in TASK_PRIORITIES:
        raise AppError("VALIDATION_ERROR", "无效任务优先级。")
    assignee = payload.get("assignee_user_id")
    if assignee:
        member = (await db.execute(select(ProjectMember).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == assignee))).scalar_one_or_none()
        if member is None:
            raise AppError("VALIDATION_ERROR", "被指派人必须是项目成员。")
    t = ResearchTask(
        id=new_id("rtask"), project_id=project_id, org_id=proj.org_id, title=title,
        description=payload.get("description") or "", kind=kind, assignee_user_id=assignee,
        status="todo", priority=priority, due_date=_parse_dt(payload.get("due_date")),
        related_type=payload.get("related_type") or "", related_id=payload.get("related_id") or "",
        created_by=user.id,
    )
    db.add(t)
    await record_trail(db, action="workflow.task_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="research_task", target_id=t.id,
                       after={"title": title, "kind": kind, "assignee": assignee},
                       summary="创建科研任务", request_id=request_id)
    await db.commit()
    await db.refresh(t)
    return _task_view(t)


async def assign_task(db: AsyncSession, user, project_id: str, task_id: str, assignee_user_id: str,
                      request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    if not await user_has_permission(db, user, "task.assign", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：task.assign。")
    t = (await db.execute(select(ResearchTask).where(
        ResearchTask.id == task_id, ResearchTask.project_id == project_id))).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "任务不存在。")
    member = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == assignee_user_id))).scalar_one_or_none()
    if member is None:
        raise AppError("VALIDATION_ERROR", "被指派人必须是项目成员。")
    before = t.assignee_user_id
    t.assignee_user_id = assignee_user_id
    await record_trail(db, action="workflow.task_assign", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="research_task", target_id=t.id,
                       before={"assignee": before}, after={"assignee": assignee_user_id},
                       summary="分配科研任务负责人", request_id=request_id)
    await db.commit()
    await db.refresh(t)
    return _task_view(t)


async def update_task(db: AsyncSession, user, project_id: str, task_id: str,
                      payload: dict, request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    t = (await db.execute(select(ResearchTask).where(
        ResearchTask.id == task_id, ResearchTask.project_id == project_id))).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "任务不存在。")
    is_assignee = t.assignee_user_id == user.id
    can_edit = await user_has_permission(db, user, "task.assign", project_id=project_id) or is_assignee
    if not can_edit:
        raise AppError("FORBIDDEN", "仅负责人或任务分配者可更新任务。")
    for field in ("title", "description", "priority", "related_type", "related_id"):
        if field in payload:
            setattr(t, field, payload[field])
    if "due_date" in payload:
        t.due_date = _parse_dt(payload["due_date"])
    if "status" in payload:
        if payload["status"] not in TASK_STATUS:
            raise AppError("VALIDATION_ERROR", f"任务状态须为 {sorted(TASK_STATUS)}。")
        t.status = payload["status"]
        t.completed_at = _now() if payload["status"] == "done" else None
    await record_trail(db, action="workflow.task_update", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="research_task", target_id=t.id,
                       after={"status": t.status}, summary="更新科研任务", request_id=request_id)
    await db.commit()
    await db.refresh(t)
    return _task_view(t)


# 审计复核队列（只读聚合）


async def review_queue(db: AsyncSession, user, project_id: str) -> dict:
    """聚合既有复核请求与待人工核验对象，统一复核入口；不复制既有审核裁定流程。"""
    await resolve_project_access(db, project_id, user)

    reviews = (await db.execute(select(ReviewRequest).where(
        ReviewRequest.project_id == project_id).order_by(ReviewRequest.created_at.desc()))).scalars().all()
    findings = (await db.execute(select(AuditFinding).where(
        AuditFinding.project_id == project_id))).scalars().all()
    facts = (await db.execute(select(ExtractedFact).where(
        ExtractedFact.project_id == project_id,
        ExtractedFact.extraction_status == "needs_review"))).scalars().all()
    metrics = (await db.execute(select(ReproductionMetric).where(
        ReproductionMetric.project_id == project_id,
        ReproductionMetric.needs_manual_review.is_(True)))).scalars().all()
    diagnostics = (await db.execute(select(FailureDiagnostic).where(
        FailureDiagnostic.project_id == project_id,
        FailureDiagnostic.needs_human_confirm.is_(True)))).scalars().all()

    items: list[dict] = []
    for r in reviews:
        items.append({"source": "review_request", "ref_type": r.target_type, "ref_id": r.target_id,
                      "title": f"复核申请：{r.target_type} {r.target_id}", "status": r.status,
                      "requested_by": r.requested_by, "reviewer_user_id": r.reviewer_user_id,
                      "created_at": r.created_at.isoformat() if r.created_at else ""})
    for f in findings:
        items.append({"source": "finding", "ref_type": "finding", "ref_id": str(f.id),
                      "title": f.title, "status": f.severity, "requested_by": None,
                      "reviewer_user_id": None, "created_at": f.created_at.isoformat() if f.created_at else ""})
    for fact in facts:
        items.append({"source": "fact", "ref_type": "fact", "ref_id": fact.fact_id or str(fact.id),
                      "title": f"事实待复核：{fact.field_key}", "status": "needs_review",
                      "requested_by": None, "reviewer_user_id": None,
                      "created_at": fact.created_at.isoformat() if fact.created_at else ""})
    for mt in metrics:
        items.append({"source": "metric", "ref_type": "metric", "ref_id": str(mt.id),
                      "title": f"指标待复核：{mt.metric_name}", "status": "needs_review",
                      "requested_by": None, "reviewer_user_id": None, "created_at": ""})
    for d in diagnostics:
        items.append({"source": "diagnostic", "ref_type": "diagnostic", "ref_id": d.id,
                      "title": d.problem, "status": "needs_confirm", "requested_by": None,
                      "reviewer_user_id": None, "created_at": d.created_at.isoformat() if d.created_at else ""})

    pending = [i for i in items if i["status"] in ("pending", "needs_review", "needs_confirm", "high", "medium", "low")]
    return {"items": items, "total": len(items), "pending": len(pending)}
