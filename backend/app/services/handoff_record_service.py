"""第十二阶段 · 结构化人员交接服务。

交接不是一份文字总结：发起时从真实项目数据抽取当前状态、未完成任务、历史实验、
关键结论、证据缺失、环境配置、待处理问题，落成 HandoffRecord 快照 + 逐条 HandoffItem，
每条清单项关联真实科研对象（ref_type/ref_id）。

流程：draft → offered（生成快照与清单）→ accepted/declined → completed（确认并变更负责人）。
负责人变更与项目归属留痕到既有 AuditTrail；非成员不可见交接记录。
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
from app.models import AuditFinding, Evidence, ExtractedFact, Project
from app.models.stage2 import EvidenceItem, ParseTask
from app.models.stage4 import (
    ExecutionEnvironment,
    FailureDiagnostic,
    ReproductionMetric,
    ReproductionRun,
    ReproductionTask,
)
from app.models.stage6 import AuditFeedback, ProjectMember, User
from app.models.stage12 import (
    HANDOFF_ITEM_KINDS,
    HANDOFF_STATUS,
    Experiment,
    HandoffItem,
    HandoffRecord,
    ManuscriptDraft,
    ResearchQuestion,
    ResearchTask,
)
from app.services.trail_service import record_trail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str) if value is not None else "{}"


ACTIVE_PARSE = ("queued", "running", "parsing", "extracting", "paused")


# 快照构建（真实数据）


async def build_handoff_snapshot(db: AsyncSession, project_id: str) -> tuple[dict, list[dict]]:
    """从项目真实数据构建快照与交接清单；返回 (snapshot, items)。"""
    project = (await db.execute(select(Project).where(Project.id == project_id))).scalar_one_or_none()

    # 未完成任务：研究工作项 + 复现任务待确认 + 解析任务活跃
    research_tasks = (await db.execute(select(ResearchTask).where(
        ResearchTask.project_id == project_id,
        ResearchTask.status.in_(["todo", "in_progress", "blocked"])))).scalars().all()
    repro_tasks = (await db.execute(select(ReproductionTask).where(
        ReproductionTask.project_id == project_id))).scalars().all()
    pending_repro = [t for t in repro_tasks if t.status in ("pending", "in_progress") or t.needs_human_confirm]
    parse_tasks = (await db.execute(select(ParseTask).where(
        ParseTask.project_id == project_id, ParseTask.status.in_(ACTIVE_PARSE)))).scalars().all()

    # 历史实验：本阶段实验 + 既有复现运行
    experiments = (await db.execute(select(Experiment).where(
        Experiment.project_id == project_id).order_by(Experiment.created_at.asc()))).scalars().all()
    runs = (await db.execute(select(ReproductionRun).where(
        ReproductionRun.project_id == project_id).order_by(ReproductionRun.created_at.asc()))).scalars().all()

    # 关键结论：已解决研究问题 + 有结论的实验 + 就绪稿件
    questions = (await db.execute(select(ResearchQuestion).where(
        ResearchQuestion.project_id == project_id))).scalars().all()
    resolved_questions = [q for q in questions if q.status == "resolved" and q.conclusion.strip()]
    concluded_experiments = [e for e in experiments if e.conclusion.strip()]
    manuscripts = (await db.execute(select(ManuscriptDraft).where(
        ManuscriptDraft.project_id == project_id))).scalars().all()
    ready_manuscripts = [m for m in manuscripts if m.status in ("ready", "submitted")]

    # 证据缺失：待复核事实、未核验证据项、无证据的审计问题
    facts = (await db.execute(select(ExtractedFact).where(
        ExtractedFact.project_id == project_id))).scalars().all()
    facts_review = [f for f in facts if (f.extraction_status or "") == "needs_review"]
    evidence_items = (await db.execute(select(EvidenceItem).where(
        EvidenceItem.project_id == project_id))).scalars().all()
    unverified_items = [e for e in evidence_items if e.verification_status != "verified"]
    findings = (await db.execute(select(AuditFinding).where(
        AuditFinding.project_id == project_id))).scalars().all()
    finding_ids = {f.id for f in findings}
    evidences = (await db.execute(select(Evidence).where(Evidence.finding_id.in_(finding_ids)))).scalars().all() if finding_ids else []
    findings_without_evidence = [f for f in findings if f.id not in {e.finding_id for e in evidences}]

    # 环境配置
    environments = (await db.execute(select(ExecutionEnvironment).where(
        ExecutionEnvironment.project_id == project_id))).scalars().all()

    # 待处理问题：开放反馈、待人工确认诊断、待人工复核指标、阻塞工作项
    feedbacks = (await db.execute(select(AuditFeedback).where(
        AuditFeedback.project_id == project_id, AuditFeedback.status == "open"))).scalars().all()
    diagnostics = (await db.execute(select(FailureDiagnostic).where(
        FailureDiagnostic.project_id == project_id,
        FailureDiagnostic.needs_human_confirm.is_(True)))).scalars().all()
    metrics = (await db.execute(select(ReproductionMetric).where(
        ReproductionMetric.project_id == project_id,
        ReproductionMetric.needs_manual_review.is_(True)))).scalars().all()
    blocked_tasks = [t for t in research_tasks if t.status == "blocked"]

    snapshot = {
        "project": {
            "id": project.id, "name": project.name, "domain": project.domain,
            "paper_title": project.paper_title, "owner_user_id": project.owner_user_id,
            "created_at": project.created_at.isoformat() if project.created_at else None,
        },
        "counts": {
            "research_tasks_open": len(research_tasks),
            "repro_tasks_pending": len(pending_repro),
            "parse_tasks_active": len(parse_tasks),
            "experiments": len(experiments),
            "reproduction_runs": len(runs),
            "resolved_questions": len(resolved_questions),
            "facts_needing_review": len(facts_review),
            "evidence_items_unverified": len(unverified_items),
            "findings_without_evidence": len(findings_without_evidence),
            "environments": len(environments),
            "open_feedback": len(feedbacks),
            "diagnostics_needing_confirm": len(diagnostics),
            "metrics_needing_review": len(metrics),
        },
    }

    items: list[dict] = []
    for t in research_tasks:
        items.append({"kind": "unfinished_task", "ref_type": "research_task", "ref_id": t.id,
                      "title": t.title, "detail": f"状态 {t.status}，优先级 {t.priority}",
                      "assignee_user_id": t.assignee_user_id})
    for t in pending_repro:
        items.append({"kind": "unfinished_task", "ref_type": "reproduction_task", "ref_id": t.id,
                      "title": t.title, "detail": "复现步骤待执行或待人工确认",
                      "assignee_user_id": None})
    for t in parse_tasks:
        items.append({"kind": "unfinished_task", "ref_type": "parse_task", "ref_id": t.id,
                      "title": f"解析任务 {t.stage_message or t.status}", "detail": t.status,
                      "assignee_user_id": None})
    for e in experiments:
        items.append({"kind": "historical_experiment", "ref_type": "experiment", "ref_id": e.id,
                      "title": e.title, "detail": f"状态 {e.status}；结论：{e.conclusion or '无'}",
                      "assignee_user_id": e.owner_user_id})
    for r in runs:
        items.append({"kind": "historical_experiment", "ref_type": "reproduction_run", "ref_id": r.id,
                      "title": f"复现运行 {r.id}", "detail": f"状态 {r.status}",
                      "assignee_user_id": r.requested_by_user_id})
    for q in resolved_questions:
        items.append({"kind": "key_conclusion", "ref_type": "research_question", "ref_id": q.id,
                      "title": q.title, "detail": q.conclusion, "assignee_user_id": q.owner_user_id})
    for e in concluded_experiments:
        items.append({"kind": "key_conclusion", "ref_type": "experiment", "ref_id": e.id,
                      "title": e.title, "detail": e.conclusion, "assignee_user_id": e.owner_user_id})
    for m in ready_manuscripts:
        items.append({"kind": "key_conclusion", "ref_type": "manuscript", "ref_id": m.id,
                      "title": m.title, "detail": f"稿件状态 {m.status}，v{m.version}",
                      "assignee_user_id": m.last_edited_by})
    for f in facts_review:
        items.append({"kind": "evidence_gap", "ref_type": "fact", "ref_id": f.fact_id or str(f.id),
                      "title": f"事实待复核：{f.field_key}", "detail": f.raw_value, "assignee_user_id": None})
    for e in unverified_items:
        items.append({"kind": "evidence_gap", "ref_type": "evidence_item", "ref_id": e.evidence_id,
                      "title": f"证据未核验：{e.source_name}", "detail": e.quote or e.original_text,
                      "assignee_user_id": None})
    for f in findings_without_evidence:
        items.append({"kind": "evidence_gap", "ref_type": "finding", "ref_id": str(f.id),
                      "title": f.title, "detail": "审计问题缺少挂接证据", "assignee_user_id": None})
    for env in environments:
        items.append({"kind": "env_config", "ref_type": "execution_environment", "ref_id": env.id,
                      "title": "实验环境配置",
                      "detail": f"Python {env.python_version or '未知'}；缺失依赖 {env.missing_json or '[]'}",
                      "assignee_user_id": None})
    for fb in feedbacks:
        items.append({"kind": "pending_issue", "ref_type": "feedback", "ref_id": fb.id,
                      "title": f"开放反馈：{fb.feedback_type}", "detail": fb.note,
                      "assignee_user_id": fb.user_id})
    for d in diagnostics:
        items.append({"kind": "pending_issue", "ref_type": "diagnostic", "ref_id": d.id,
                      "title": d.problem, "detail": d.error_evidence, "assignee_user_id": None})
    for mt in metrics:
        items.append({"kind": "pending_issue", "ref_type": "metric", "ref_id": str(mt.id),
                      "title": f"指标待复核：{mt.metric_name}", "detail": f"值 {mt.metric_value}",
                      "assignee_user_id": None})
    for t in blocked_tasks:
        items.append({"kind": "pending_issue", "ref_type": "research_task", "ref_id": t.id,
                      "title": f"阻塞任务：{t.title}", "detail": t.description,
                      "assignee_user_id": t.assignee_user_id})

    return snapshot, items


# 记录操作


def _record_view(r: HandoffRecord, items: list[HandoffItem]) -> dict:
    return {
        "id": r.id, "project_id": r.project_id, "org_id": r.org_id,
        "from_user_id": r.from_user_id, "to_user_id": r.to_user_id, "status": r.status,
        "note": r.note, "snapshot": json.loads(r.snapshot_json or "{}"),
        "offered_at": r.offered_at.isoformat() if r.offered_at else None,
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
        "confirmed_at": r.confirmed_at.isoformat() if r.confirmed_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else "",
        "items": [_item_view(i) for i in items],
    }


def _item_view(i: HandoffItem) -> dict:
    return {
        "id": i.id, "kind": i.kind, "ref_type": i.ref_type, "ref_id": i.ref_id,
        "title": i.title, "detail": i.detail, "status": i.status,
        "assignee_user_id": i.assignee_user_id, "note": i.note,
    }


async def _get_record(db: AsyncSession, user: User, handoff_id: str) -> HandoffRecord:
    record = (await db.execute(select(HandoffRecord).where(
        HandoffRecord.id == handoff_id))).scalar_one_or_none()
    if record is None:
        raise AppError("NOT_FOUND", "交接记录不存在或无权访问。")
    await resolve_project_access(db, record.project_id, user)
    return record


async def initiate_handoff(db: AsyncSession, user: User, project_id: str, to_user_id: str,
                           note: str = "", request_id: str = "") -> dict:
    proj = await resolve_project_access(db, project_id, user)
    if not await user_has_permission(db, user, "handoff.initiate", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：handoff.initiate。")
    target = (await db.execute(select(User).where(User.id == to_user_id))).scalar_one_or_none()
    if target is None:
        raise AppError("NOT_FOUND", "接收人不存在。")
    # 接收人必须已是项目成员（或组织管理员），避免把项目交接给外部人员
    is_member = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == project_id, ProjectMember.user_id == to_user_id))).scalar_one_or_none()
    if is_member is None:
        raise AppError("VALIDATION_ERROR", "接收人必须先加入项目。")

    snapshot, items = await build_handoff_snapshot(db, project_id)
    record = HandoffRecord(
        id=new_id("ho"), project_id=project_id, org_id=proj.org_id,
        from_user_id=user.id, to_user_id=to_user_id, status="offered",
        snapshot_json=_dump(snapshot), note=note or "", offered_at=_now(), created_by=user.id,
    )
    db.add(record)
    await db.flush()
    for item in items:
        db.add(HandoffItem(
            id=new_id("hoi"), handoff_id=record.id, kind=item["kind"], ref_type=item["ref_type"],
            ref_id=item["ref_id"], title=item["title"], detail=item["detail"],
            status="open", assignee_user_id=item.get("assignee_user_id")))
    await record_trail(db, action="handoff.initiate", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="handoff", target_id=record.id,
                       after={"to_user_id": to_user_id, "items": len(items)},
                       summary="发起项目交接", request_id=request_id)
    await db.commit()
    items_rows = (await db.execute(select(HandoffItem).where(
        HandoffItem.handoff_id == record.id))).scalars().all()
    return _record_view(record, items_rows)


async def list_handoffs(db: AsyncSession, user: User, project_id: str) -> list[dict]:
    await resolve_project_access(db, project_id, user)
    rows = (await db.execute(select(HandoffRecord).where(
        HandoffRecord.project_id == project_id).order_by(HandoffRecord.created_at.desc()))).scalars().all()
    out = []
    for r in rows:
        items = (await db.execute(select(HandoffItem).where(HandoffItem.handoff_id == r.id))).scalars().all()
        out.append(_record_view(r, items))
    return out


async def get_handoff(db: AsyncSession, user: User, handoff_id: str) -> dict:
    record = await _get_record(db, user, handoff_id)
    items = (await db.execute(select(HandoffItem).where(
        HandoffItem.handoff_id == record.id))).scalars().all()
    return _record_view(record, items)


async def respond_handoff(db: AsyncSession, user: User, handoff_id: str, accepted: bool,
                         note: str = "", request_id: str = "") -> dict:
    record = await _get_record(db, user, handoff_id)
    if record.status != "offered":
        raise AppError("CONFLICT", "仅待响应的交接可接受或拒绝。")
    # 仅接收人本人可响应
    if record.to_user_id != user.id and not await user_has_permission(
            db, user, "project.manage", project_id=record.project_id):
        raise AppError("FORBIDDEN", "仅接收人或项目管理员可响应交接。")
    record.status = "accepted" if accepted else "declined"
    record.responded_at = _now()
    record.note = note or record.note
    await record_trail(db, action="handoff.respond", actor_user_id=user.id,
                       org_id=record.org_id, project_id=record.project_id,
                       target_type="handoff", target_id=record.id,
                       after={"status": record.status}, summary="响应项目交接", request_id=request_id)
    await db.commit()
    items = (await db.execute(select(HandoffItem).where(
        HandoffItem.handoff_id == record.id))).scalars().all()
    return _record_view(record, items)


async def confirm_handoff(db: AsyncSession, user: User, handoff_id: str,
                         request_id: str = "") -> dict:
    record = await _get_record(db, user, handoff_id)
    if record.status != "accepted":
        raise AppError("CONFLICT", "仅已接受的交接可确认完成。")
    if not await user_has_permission(db, user, "handoff.confirm", project_id=record.project_id):
        raise AppError("FORBIDDEN", "缺少权限：handoff.confirm。")

    proj = (await db.execute(select(Project).where(Project.id == record.project_id))).scalar_one_or_none()
    before_owner = proj.owner_user_id if proj else None
    # 变更项目负责人：更新 owner，并确保接收人具备 project_lead 角色
    proj.owner_user_id = record.to_user_id
    pm = (await db.execute(select(ProjectMember).where(
        ProjectMember.project_id == record.project_id,
        ProjectMember.user_id == record.to_user_id))).scalar_one_or_none()
    if pm is None:
        db.add(ProjectMember(id=new_id("pm"), project_id=record.project_id,
                              user_id=record.to_user_id, role_key="project_lead", added_by=user.id))
    elif pm.role_key != "project_lead":
        pm.role_key = "project_lead"

    record.status = "completed"
    record.confirmed_at = _now()
    await record_trail(db, action="handoff.confirm", actor_user_id=user.id, org_id=record.org_id,
                       project_id=record.project_id, target_type="handoff", target_id=record.id,
                       before={"owner_user_id": before_owner}, after={"owner_user_id": record.to_user_id},
                       summary="交接完成，负责人变更", request_id=request_id)
    await db.commit()
    items = (await db.execute(select(HandoffItem).where(
        HandoffItem.handoff_id == record.id))).scalars().all()
    return _record_view(record, items)


async def update_item(db: AsyncSession, user: User, handoff_id: str, item_id: str,
                      status: str, note: str = "", request_id: str = "") -> dict:
    record = await _get_record(db, user, handoff_id)
    if record.status not in ("offered", "accepted"):
        raise AppError("CONFLICT", "已完成/已拒绝的交接清单不可修改。")
    if status not in ("open", "acknowledged", "closed"):
        raise AppError("VALIDATION_ERROR", "清单项状态须为 open/acknowledged/closed。")
    item = (await db.execute(select(HandoffItem).where(
        HandoffItem.id == item_id, HandoffItem.handoff_id == handoff_id))).scalar_one_or_none()
    if item is None:
        raise AppError("NOT_FOUND", "交接清单项不存在。")
    item.status = status
    if note:
        item.note = note
    await record_trail(db, action="handoff.item_update", actor_user_id=user.id, org_id=record.org_id,
                       project_id=record.project_id, target_type="handoff_item", target_id=item.id,
                       after={"status": status}, summary="更新交接清单项", request_id=request_id)
    await db.commit()
    return _item_view(item)
