"""第十二阶段 · 科研项目生命周期服务。

覆盖：项目创建后各阶段（研究问题 / 资料收集 / 数据集 / 实验设计 / 执行 / 核验 /
撰写 / 复现审计 / 归档）的真实数据结构、状态与操作。

约束：
- 所有读写先 resolve_project_access，非成员 404；写操作校验 lifecycle.manage 权限。
- 阶段状态与业务实体落库，轨迹接入既有 AuditTrail；不调用 AI 做阶段判定。
- 不重复实现既有材料/事实/复现运行/评论/权限模块，本服务只做生命周期编排与登记。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access, user_has_permission
from app.core.errors import AppError
from app.core.security import new_id
from app.models import Project
from app.models.stage12 import (
    DATASET_STATUS,
    DESIGN_STATUS,
    EXPERIMENT_STATUS,
    LIFECYCLE_STAGES,
    MANUSCRIPT_STATUS,
    DatasetRecord,
    Experiment,
    ExperimentDesign,
    ManuscriptDraft,
    ProjectArchive,
    ProjectStageState,
    QUESTION_STATUS,
    ResearchQuestion,
)
from app.services.trail_service import record_trail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str) if value is not None else "{}"


def _as_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


# 权限与归属


async def _ensure_manage(db: AsyncSession, user, project: Project) -> None:
    if not await user_has_permission(db, user, "lifecycle.manage", project_id=project.id):
        raise AppError("FORBIDDEN", "缺少权限：lifecycle.manage。")


async def _get_project(db: AsyncSession, project_id: str, user) -> Project:
    return await resolve_project_access(db, project_id, user)


# 阶段状态板


async def get_stage_board(db: AsyncSession, project_id: str, user) -> dict:
    proj = await _get_project(db, project_id, user)
    rows = (await db.execute(select(ProjectStageState).where(
        ProjectStageState.project_id == project_id))).scalars().all()
    by_stage = {r.stage: r for r in rows}
    stages = []
    current: str | None = None
    for stage in LIFECYCLE_STAGES:
        row = by_stage.get(stage)
        status = row.status if row else "pending"
        if status != "done" and current is None:
            current = stage
        stages.append({
            "stage": stage,
            "status": status,
            "note": row.note if row else "",
            "entered_at": row.entered_at.isoformat() if row and row.entered_at else None,
            "completed_at": row.completed_at.isoformat() if row and row.completed_at else None,
        })
    archived = any(s["stage"] == "archived" and s["status"] == "done" for s in stages)
    return {
        "project_id": project_id,
        "current_stage": current,
        "archived": archived,
        "stages": stages,
    }


async def _get_state(db: AsyncSession, project_id: str, stage: str) -> ProjectStageState:
    row = (await db.execute(select(ProjectStageState).where(
        ProjectStageState.project_id == project_id,
        ProjectStageState.stage == stage))).scalar_one_or_none()
    if row is None:
        row = ProjectStageState(id=new_id("stage"), project_id=project_id, stage=stage, status="pending")
        db.add(row)
        await db.flush()
    return row


async def set_stage_status(db: AsyncSession, user, project_id: str, stage: str,
                           status: str, note: str = "", request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    if stage not in LIFECYCLE_STAGES:
        raise AppError("VALIDATION_ERROR", f"未知阶段：{stage}。")
    if status not in ("active", "done", "blocked", "pending"):
        raise AppError("VALIDATION_ERROR", "阶段状态须为 active/done/blocked/pending。")
    if stage == "archived" and status == "active":
        # 归档动作走 archive_project / reopen_project
        raise AppError("VALIDATION_ERROR", "归档阶段请使用归档/重开接口。")

    row = await _get_state(db, project_id, stage)
    before = row.status
    now = _now()
    row.status = status
    row.note = note or row.note
    if status == "active" and row.entered_at is None:
        row.entered_at = now
    if status == "done":
        row.completed_at = now
    elif status in ("pending", "blocked"):
        row.completed_at = None
    await record_trail(db, action="lifecycle.stage_status", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_stage", target_id=stage,
                       before={"status": before}, after={"status": status, "note": note},
                       summary=f"阶段 {stage} → {status}", request_id=request_id)
    await db.commit()
    return {"project_id": project_id, "stage": stage, "status": status, "note": row.note}


# 研究问题


async def list_questions(db: AsyncSession, project_id: str, user) -> list[dict]:
    await _get_project(db, project_id, user)
    rows = (await db.execute(select(ResearchQuestion).where(
        ResearchQuestion.project_id == project_id).order_by(ResearchQuestion.created_at.asc()))).scalars().all()
    return [_question_view(r) for r in rows]


def _question_view(r: ResearchQuestion) -> dict:
    return {
        "id": r.id, "title": r.title, "hypothesis": r.hypothesis, "background": r.background,
        "status": r.status, "priority": r.priority, "owner_user_id": r.owner_user_id,
        "source_refs": _as_list(r.source_refs_json), "conclusion": r.conclusion,
        "created_by": r.created_by, "created_at": r.created_at.isoformat() if r.created_at else "",
        "resolved_at": r.resolved_at.isoformat() if r.resolved_at else None,
    }


async def create_question(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "研究问题标题不能为空。")
    status = payload.get("status") or "draft"
    if status not in QUESTION_STATUS:
        raise AppError("VALIDATION_ERROR", f"研究问题状态须为 {sorted(QUESTION_STATUS)}。")
    q = ResearchQuestion(
        id=new_id("rq"), project_id=project_id, org_id=proj.org_id, title=title,
        hypothesis=payload.get("hypothesis") or "", background=payload.get("background") or "",
        status=status, priority=payload.get("priority") or "medium",
        owner_user_id=payload.get("owner_user_id") or user.id,
        source_refs_json=_dump(payload.get("source_refs") or []),
        conclusion=payload.get("conclusion") or "", created_by=user.id,
    )
    db.add(q)
    await record_trail(db, action="lifecycle.question_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="research_question", target_id=q.id,
                       after={"title": title}, summary="登记研究问题", request_id=request_id)
    await db.commit()
    await db.refresh(q)
    return _question_view(q)


async def update_question(db: AsyncSession, user, project_id: str, question_id: str,
                          payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    q = (await db.execute(select(ResearchQuestion).where(
        ResearchQuestion.id == question_id, ResearchQuestion.project_id == project_id))).scalar_one_or_none()
    if q is None:
        raise AppError("NOT_FOUND", "研究问题不存在。")
    before = {"status": q.status, "conclusion": q.conclusion}
    if "title" in payload and payload["title"].strip():
        q.title = payload["title"].strip()
    for field in ("hypothesis", "background", "conclusion", "priority", "owner_user_id"):
        if field in payload:
            setattr(q, field, payload[field])
    if "status" in payload:
        if payload["status"] not in QUESTION_STATUS:
            raise AppError("VALIDATION_ERROR", "无效研究问题状态。")
        q.status = payload["status"]
        q.resolved_at = _now() if q.status == "resolved" else None
    if "source_refs" in payload:
        q.source_refs_json = _dump(payload["source_refs"])
    await record_trail(db, action="lifecycle.question_update", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="research_question", target_id=q.id,
                       before=before, after={"status": q.status, "conclusion": q.conclusion},
                       summary="更新研究问题", request_id=request_id)
    await db.commit()
    await db.refresh(q)
    return _question_view(q)


# 数据集


def _dataset_view(r: DatasetRecord) -> dict:
    return {
        "id": r.id, "name": r.name, "source_type": r.source_type,
        "material_ids": _as_list(r.material_ids_json), "version": r.version,
        "license": r.license, "size_rows": r.size_rows,
        "schema": json.loads(r.schema_json or "{}"), "split_info": json.loads(r.split_info_json or "{}"),
        "integrity_hash": r.integrity_hash, "provenance_ref": r.provenance_ref,
        "status": r.status, "notes": r.notes, "owner_user_id": r.owner_user_id,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }


async def list_datasets(db: AsyncSession, project_id: str, user) -> list[dict]:
    await _get_project(db, project_id, user)
    rows = (await db.execute(select(DatasetRecord).where(
        DatasetRecord.project_id == project_id).order_by(DatasetRecord.created_at.asc()))).scalars().all()
    return [_dataset_view(r) for r in rows]


async def create_dataset(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    name = (payload.get("name") or "").strip()
    if not name:
        raise AppError("VALIDATION_ERROR", "数据集名称不能为空。")
    status = payload.get("status") or "registered"
    if status not in DATASET_STATUS:
        raise AppError("VALIDATION_ERROR", f"数据集状态须为 {sorted(DATASET_STATUS)}。")
    d = DatasetRecord(
        id=new_id("ds"), project_id=project_id, org_id=proj.org_id, name=name,
        source_type=payload.get("source_type") or "attached_material",
        material_ids_json=_dump(payload.get("material_ids") or []),
        version=payload.get("version") or "v1", license=payload.get("license") or "",
        size_rows=payload.get("size_rows"), schema_json=_dump(payload.get("schema") or {}),
        split_info_json=_dump(payload.get("split_info") or {}),
        integrity_hash=payload.get("integrity_hash"), provenance_ref=payload.get("provenance_ref") or "",
        status=status, notes=payload.get("notes") or "",
        owner_user_id=payload.get("owner_user_id") or user.id, created_by=user.id,
    )
    db.add(d)
    await record_trail(db, action="lifecycle.dataset_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="dataset", target_id=d.id,
                       after={"name": name, "version": d.version}, summary="登记数据集", request_id=request_id)
    await db.commit()
    await db.refresh(d)
    return _dataset_view(d)


async def update_dataset(db: AsyncSession, user, project_id: str, dataset_id: str,
                         payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    d = (await db.execute(select(DatasetRecord).where(
        DatasetRecord.id == dataset_id, DatasetRecord.project_id == project_id))).scalar_one_or_none()
    if d is None:
        raise AppError("NOT_FOUND", "数据集不存在。")
    for field in ("name", "source_type", "version", "license", "notes", "provenance_ref",
                  "integrity_hash", "owner_user_id"):
        if field in payload:
            setattr(d, field, payload[field])
    if "size_rows" in payload:
        d.size_rows = payload["size_rows"]
    if "schema" in payload:
        d.schema_json = _dump(payload["schema"])
    if "split_info" in payload:
        d.split_info_json = _dump(payload["split_info"])
    if "material_ids" in payload:
        d.material_ids_json = _dump(payload["material_ids"])
    if "status" in payload:
        if payload["status"] not in DATASET_STATUS:
            raise AppError("VALIDATION_ERROR", "无效数据集状态。")
        d.status = payload["status"]
    await record_trail(db, action="lifecycle.dataset_update", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="dataset", target_id=d.id,
                       after={"status": d.status, "version": d.version}, summary="更新数据集", request_id=request_id)
    await db.commit()
    await db.refresh(d)
    return _dataset_view(d)


# 实验设计


def _design_view(r: ExperimentDesign) -> dict:
    return {
        "id": r.id, "title": r.title, "research_question_id": r.research_question_id,
        "hypothesis": r.hypothesis, "variables": json.loads(r.variables_json or "{}"),
        "controls": _as_list(r.controls_json), "expected_outcome": r.expected_outcome,
        "method": r.method, "status": r.status, "reviewer_user_id": r.reviewer_user_id,
        "approved_at": r.approved_at.isoformat() if r.approved_at else None,
        "created_by": r.created_by, "created_at": r.created_at.isoformat() if r.created_at else "",
    }


async def list_designs(db: AsyncSession, project_id: str, user) -> list[dict]:
    await _get_project(db, project_id, user)
    rows = (await db.execute(select(ExperimentDesign).where(
        ExperimentDesign.project_id == project_id).order_by(ExperimentDesign.created_at.asc()))).scalars().all()
    return [_design_view(r) for r in rows]


async def create_design(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "实验设计标题不能为空。")
    d = ExperimentDesign(
        id=new_id("des"), project_id=project_id, org_id=proj.org_id, title=title,
        research_question_id=payload.get("research_question_id"),
        hypothesis=payload.get("hypothesis") or "",
        variables_json=_dump(payload.get("variables") or {}),
        controls_json=_dump(payload.get("controls") or []),
        expected_outcome=payload.get("expected_outcome") or "", method=payload.get("method") or "",
        status=payload.get("status") or "draft", created_by=user.id,
    )
    db.add(d)
    await record_trail(db, action="lifecycle.design_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="experiment_design", target_id=d.id,
                       after={"title": title}, summary="创建实验设计", request_id=request_id)
    await db.commit()
    await db.refresh(d)
    return _design_view(d)


async def review_design(db: AsyncSession, user, project_id: str, design_id: str,
                         status: str, reviewer_user_id: str | None, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    if not await user_has_permission(db, user, "review.decide", project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：review.decide。")
    d = (await db.execute(select(ExperimentDesign).where(
        ExperimentDesign.id == design_id, ExperimentDesign.project_id == project_id))).scalar_one_or_none()
    if d is None:
        raise AppError("NOT_FOUND", "实验设计不存在。")
    if status not in DESIGN_STATUS:
        raise AppError("VALIDATION_ERROR", f"设计状态须为 {sorted(DESIGN_STATUS)}。")
    d.status = status
    d.reviewer_user_id = reviewer_user_id or user.id
    d.approved_at = _now() if status == "approved" else None
    await record_trail(db, action="lifecycle.design_review", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="experiment_design", target_id=d.id,
                       after={"status": status}, summary="审核实验设计", request_id=request_id)
    await db.commit()
    await db.refresh(d)
    return _design_view(d)


# 实验执行


def _experiment_view(r: Experiment) -> dict:
    return {
        "id": r.id, "title": r.title, "design_id": r.design_id, "owner_user_id": r.owner_user_id,
        "status": r.status, "linked_plan_id": r.linked_plan_id, "linked_run_id": r.linked_run_id,
        "dataset_ids": _as_list(r.dataset_ids_json), "config_ref": json.loads(r.config_ref_json or "{}"),
        "result_summary": r.result_summary, "conclusion": r.conclusion,
        "evidence_refs": _as_list(r.evidence_refs_json), "notes": r.notes,
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }


async def list_experiments(db: AsyncSession, project_id: str, user) -> list[dict]:
    await _get_project(db, project_id, user)
    rows = (await db.execute(select(Experiment).where(
        Experiment.project_id == project_id).order_by(Experiment.created_at.asc()))).scalars().all()
    return [_experiment_view(r) for r in rows]


async def create_experiment(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "实验标题不能为空。")
    e = Experiment(
        id=new_id("exp"), project_id=project_id, org_id=proj.org_id, title=title,
        design_id=payload.get("design_id"), owner_user_id=payload.get("owner_user_id") or user.id,
        status="queued", linked_plan_id=payload.get("linked_plan_id"),
        linked_run_id=payload.get("linked_run_id"),
        dataset_ids_json=_dump(payload.get("dataset_ids") or []),
        config_ref_json=_dump(payload.get("config_ref") or {}),
        result_summary=payload.get("result_summary") or "", conclusion=payload.get("conclusion") or "",
        evidence_refs_json=_dump(payload.get("evidence_refs") or []), notes=payload.get("notes") or "",
        created_by=user.id,
    )
    db.add(e)
    await record_trail(db, action="lifecycle.experiment_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="experiment", target_id=e.id,
                       after={"title": title}, summary="登记实验", request_id=request_id)
    await db.commit()
    await db.refresh(e)
    return _experiment_view(e)


async def update_experiment_status(db: AsyncSession, user, project_id: str, experiment_id: str,
                                    payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    e = (await db.execute(select(Experiment).where(
        Experiment.id == experiment_id, Experiment.project_id == project_id))).scalar_one_or_none()
    if e is None:
        raise AppError("NOT_FOUND", "实验不存在。")
    status = payload.get("status") or e.status
    if status not in EXPERIMENT_STATUS:
        raise AppError("VALIDATION_ERROR", f"实验状态须为 {sorted(EXPERIMENT_STATUS)}。")
    now = _now()
    e.status = status
    if status == "running" and e.started_at is None:
        e.started_at = now
    if status in ("completed", "failed", "blocked"):
        e.finished_at = now
    for field in ("result_summary", "conclusion", "notes", "owner_user_id"):
        if field in payload:
            setattr(e, field, payload[field])
    if "evidence_refs" in payload:
        e.evidence_refs_json = _dump(payload["evidence_refs"])
    if "config_ref" in payload:
        e.config_ref_json = _dump(payload["config_ref"])
    await record_trail(db, action="lifecycle.experiment_status", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="experiment", target_id=e.id,
                       before={"status": e.status}, after={"status": status},
                       summary=f"实验状态 → {status}", request_id=request_id)
    await db.commit()
    await db.refresh(e)
    return _experiment_view(e)


# 论文稿件


def _manuscript_view(r: ManuscriptDraft) -> dict:
    return {
        "id": r.id, "title": r.title, "section": r.section, "status": r.status,
        "version": r.version, "linked_facts": _as_list(r.linked_facts_json),
        "linked_materials": _as_list(r.linked_materials_json), "body": r.body,
        "last_edited_by": r.last_edited_by,
        "submitted_at": r.submitted_at.isoformat() if r.submitted_at else None,
        "updated_at": r.updated_at.isoformat() if r.updated_at else "",
    }


async def list_manuscripts(db: AsyncSession, project_id: str, user) -> list[dict]:
    await _get_project(db, project_id, user)
    rows = (await db.execute(select(ManuscriptDraft).where(
        ManuscriptDraft.project_id == project_id).order_by(ManuscriptDraft.created_at.asc()))).scalars().all()
    return [_manuscript_view(r) for r in rows]


async def create_manuscript(db: AsyncSession, user, project_id: str, payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    title = (payload.get("title") or "").strip()
    if not title:
        raise AppError("VALIDATION_ERROR", "稿件标题不能为空。")
    m = ManuscriptDraft(
        id=new_id("ms"), project_id=project_id, org_id=proj.org_id, title=title,
        section=payload.get("section") or "", status="draft", version=1,
        linked_facts_json=_dump(payload.get("linked_facts") or []),
        linked_materials_json=_dump(payload.get("linked_materials") or []),
        body=payload.get("body") or "", last_edited_by=user.id,
    )
    db.add(m)
    await record_trail(db, action="lifecycle.manuscript_create", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="manuscript", target_id=m.id,
                       after={"title": title}, summary="创建论文稿件", request_id=request_id)
    await db.commit()
    await db.refresh(m)
    return _manuscript_view(m)


async def update_manuscript(db: AsyncSession, user, project_id: str, manuscript_id: str,
                            payload: dict, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    await _ensure_manage(db, user, proj)
    m = (await db.execute(select(ManuscriptDraft).where(
        ManuscriptDraft.id == manuscript_id, ManuscriptDraft.project_id == project_id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "稿件不存在。")
    before_version = m.version
    if payload.get("body") is not None and payload["body"] != m.body:
        m.version = before_version + 1
    for field in ("title", "section", "body"):
        if field in payload:
            setattr(m, field, payload[field])
    if "linked_facts" in payload:
        m.linked_facts_json = _dump(payload["linked_facts"])
    if "linked_materials" in payload:
        m.linked_materials_json = _dump(payload["linked_materials"])
    if "status" in payload:
        if payload["status"] not in MANUSCRIPT_STATUS:
            raise AppError("VALIDATION_ERROR", f"稿件状态须为 {sorted(MANUSCRIPT_STATUS)}。")
        m.status = payload["status"]
        m.submitted_at = _now() if payload["status"] == "submitted" else m.submitted_at
    m.last_edited_by = user.id
    await record_trail(db, action="lifecycle.manuscript_update", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="manuscript", target_id=m.id,
                       before={"version": before_version}, after={"version": m.version, "status": m.status},
                       summary="更新论文稿件", request_id=request_id)
    await db.commit()
    await db.refresh(m)
    return _manuscript_view(m)


# 归档


async def _project_snapshot(db: AsyncSession, project_id: str) -> dict:
    """归档快照：统计各生命周期实体数量，供交接与归档追溯使用（确定性计数，不含 AI 评价）。"""
    from app.models import Material
    from app.models.stage4 import ReproductionRun
    counts: dict[str, int] = {}
    for label, model in (
        ("materials", Material), ("reproduction_runs", ReproductionRun),
        ("questions", ResearchQuestion), ("datasets", DatasetRecord),
        ("designs", ExperimentDesign), ("experiments", Experiment),
        ("manuscripts", ManuscriptDraft),
    ):
        counts[label] = (await db.execute(select(func.count()).select_from(model)
                                          .where(model.project_id == project_id))).scalar_one()
    return counts


async def archive_project(db: AsyncSession, user, project_id: str, reason: str, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    if not await user_has_permission(db, user, "project.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "需要项目管理权限才能归档。")
    existing = (await db.execute(select(ProjectArchive).where(
        ProjectArchive.project_id == project_id, ProjectArchive.reopened_at.is_(None)))).scalar_one_or_none()
    if existing is not None:
        raise AppError("CONFLICT", "项目已处于归档状态。")
    snapshot = await _project_snapshot(db, project_id)
    archive = ProjectArchive(
        id=new_id("arch"), project_id=project_id, org_id=proj.org_id, reason=reason or "",
        snapshot_json=_dump(snapshot), archived_by=user.id,
    )
    db.add(archive)
    stage = await _get_state(db, project_id, "archived")
    stage.status = "done"
    stage.completed_at = _now()
    await record_trail(db, action="lifecycle.archive", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_archive", target_id=archive.id,
                       after={"reason": reason, "snapshot": snapshot}, summary="项目归档", request_id=request_id)
    await db.commit()
    await db.refresh(archive)
    return {"id": archive.id, "project_id": project_id, "reason": reason,
            "snapshot": snapshot, "archived_at": archive.archived_at.isoformat()}


async def reopen_project(db: AsyncSession, user, project_id: str, request_id: str = "") -> dict:
    proj = await _get_project(db, project_id, user)
    if not await user_has_permission(db, user, "project.manage", project_id=project_id):
        raise AppError("FORBIDDEN", "需要项目管理权限才能重开。")
    archive = (await db.execute(select(ProjectArchive).where(
        ProjectArchive.project_id == project_id, ProjectArchive.reopened_at.is_(None)))).scalar_one_or_none()
    if archive is None:
        raise AppError("NOT_FOUND", "未找到归档记录。")
    archive.reopened_at = _now()
    archive.reopened_by = user.id
    stage = await _get_state(db, project_id, "archived")
    stage.status = "pending"
    stage.completed_at = None
    await record_trail(db, action="lifecycle.reopen", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project_archive", target_id=archive.id,
                       summary="项目重开", request_id=request_id)
    await db.commit()
    return {"reopened": True, "project_id": project_id}
