"""第十二阶段 · 版本化科研知识库服务。

沉淀：历史实验经验、常见复现错误、失败诊断案例、数据处理规范、模型配置、
环境配置、审计规则、团队内部研究规范。

硬性约束：
- 知识有来源：source_type + source_ref_json 记录出处实体；KnowledgeLink 保留追溯关联。
- 知识有版本：每次修订生成 KnowledgeEntryVersion，历史正文不可覆盖，可回溯。
- 知识可修订：revise 递增版本并保留修改说明；旧版本标记非活跃。
- 知识可追溯：条目关联实验/诊断/规则/材料/事实等真实对象。
- 过时知识可标记：deprecated（注明原因）/ retracted（撤回）。
- 用户可纠错：KnowledgeCorrection 上报勘误/过时/重复，审核后接受或拒绝。
- 组织严格隔离：仅返回同组织条目；project 可见条目还需项目成员身份；跨组织不可见。
- 不调用 AI 生成知识结论；AI 合成内容不得作为知识条目入库。
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
from app.models import Project
from app.models.stage6 import OrgMember, ProjectMember, User
from app.models.stage12 import (
    CORRECTION_KINDS,
    CORRECTION_STATUS,
    KNOWLEDGE_CATEGORIES,
    KNOWLEDGE_SOURCE_TYPES,
    KNOWLEDGE_STATUS,
    KnowledgeCorrection,
    KnowledgeEntry,
    KnowledgeEntryVersion,
    KnowledgeLink,
)
from app.services.trail_service import record_trail


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str) if value is not None else "{}"


async def _user_org_ids(db: AsyncSession, user: User) -> list[str]:
    rows = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().all()
    return [m.org_id for m in rows]


async def _user_project_ids(db: AsyncSession, user: User) -> set[str]:
    rows = (await db.execute(select(ProjectMember).where(ProjectMember.user_id == user.id))).scalars().all()
    return {pm.project_id for pm in rows}


async def _resolve_scope(db: AsyncSession, user: User, project_id: str | None,
                         org_id: str | None) -> tuple[str | None, str | None]:
    """返回 (org_id, project_id)。带 project_id 时先做项目访问校验并继承项目归属组织。"""
    if project_id:
        proj = await resolve_project_access(db, project_id, user)
        return proj.org_id, project_id
    if org_id:
        # 组织成员或平台管理员可在该组织下写知识
        if not user.is_platform_admin:
            member = (await db.execute(select(OrgMember).where(
                OrgMember.org_id == org_id, OrgMember.user_id == user.id))).scalar_one_or_none()
            if member is None:
                raise AppError("FORBIDDEN", "不属于该组织，无法在此组织下写知识。")
        return org_id, None
    org_ids = await _user_org_ids(db, user)
    return (org_ids[0] if org_ids else None), None


def _entry_view(e: KnowledgeEntry, version: KnowledgeEntryVersion | None = None) -> dict:
    return {
        "id": e.id, "org_id": e.org_id, "project_id": e.project_id, "category": e.category,
        "title": e.title, "summary": e.summary, "body": e.body, "source_type": e.source_type,
        "source_ref": json.loads(e.source_ref_json or "{}"), "status": e.status,
        "current_version": e.current_version, "visibility": e.visibility,
        "created_by": e.created_by, "deprecated_reason": e.deprecated_reason,
        "supersedes_entry_id": e.supersedes_entry_id,
        "created_at": e.created_at.isoformat() if e.created_at else "",
        "updated_at": e.updated_at.isoformat() if e.updated_at else "",
        "active_version": {
            "version": version.version, "change_note": version.change_note,
            "edited_by": version.edited_by, "created_at": version.created_at.isoformat() if version.created_at else "",
        } if version else None,
    }


async def _active_version(db: AsyncSession, entry_id: str) -> KnowledgeEntryVersion | None:
    return (await db.execute(select(KnowledgeEntryVersion).where(
        KnowledgeEntryVersion.entry_id == entry_id,
        KnowledgeEntryVersion.is_active.is_(True)))).scalar_one_or_none()


async def _links(db: AsyncSession, entry_id: str) -> list[dict]:
    rows = (await db.execute(select(KnowledgeLink).where(
        KnowledgeLink.entry_id == entry_id))).scalars().all()
    return [{"target_type": r.target_type, "target_id": r.target_id, "relation": r.relation} for r in rows]


# 写操作


async def create_entry(db: AsyncSession, user: User, payload: dict, request_id: str = "") -> dict:
    category = payload.get("category")
    if category not in KNOWLEDGE_CATEGORIES:
        raise AppError("VALIDATION_ERROR", f"category 须为 {sorted(KNOWLEDGE_CATEGORIES)}。")
    source_type = payload.get("source_type") or "manual"
    if source_type not in KNOWLEDGE_SOURCE_TYPES:
        raise AppError("VALIDATION_ERROR", f"source_type 须为 {sorted(KNOWLEDGE_SOURCE_TYPES)}。")
    title = (payload.get("title") or "").strip()
    body = (payload.get("body") or "").strip()
    if not title or not body:
        raise AppError("VALIDATION_ERROR", "title 与 body 不能为空。")

    org_id, project_id = await _resolve_scope(db, user, payload.get("project_id"), payload.get("org_id"))
    if not await user_has_permission(db, user, "knowledge.write", org_id=org_id, project_id=project_id):
        raise AppError("FORBIDDEN", "缺少权限：knowledge.write。")
    visibility = payload.get("visibility") or ("project" if project_id else "org")
    if visibility not in ("org", "project"):
        raise AppError("VALIDATION_ERROR", "visibility 须为 org 或 project。")
    if visibility == "project" and not project_id:
        raise AppError("VALIDATION_ERROR", "项目可见的知识条目必须指定项目。")

    entry = KnowledgeEntry(
        id=new_id("ke"), org_id=org_id, project_id=project_id, category=category,
        title=title, summary=(payload.get("summary") or "").strip(), body=body,
        source_type=source_type, source_ref_json=_dump(payload.get("source_ref") or {}),
        status="active", current_version=1, visibility=visibility, created_by=user.id,
    )
    db.add(entry)
    await db.flush()

    version = KnowledgeEntryVersion(
        id=new_id("kev"), entry_id=entry.id, version=1, body=body,
        summary=entry.summary, change_note=payload.get("change_note") or "初始版本",
        edited_by=user.id, is_active=True,
    )
    db.add(version)

    for link in payload.get("links") or []:
        if isinstance(link, dict) and link.get("target_type") and link.get("target_id"):
            db.add(KnowledgeLink(
                id=new_id("klink"), entry_id=entry.id, target_type=link["target_type"],
                target_id=str(link["target_id"]), relation=link.get("relation") or "derived_from"))

    await record_trail(db, action="knowledge.entry_create", actor_user_id=user.id, org_id=org_id,
                       project_id=project_id, target_type="knowledge_entry", target_id=entry.id,
                       after={"category": category, "title": title, "version": 1},
                       summary="入库知识条目", request_id=request_id)
    await db.commit()
    await db.refresh(entry)
    return {**_entry_view(entry, version), "links": await _links(db, entry.id)}


async def revise_entry(db: AsyncSession, user: User, entry_id: str, payload: dict,
                       request_id: str = "") -> dict:
    entry = await _get_visible_entry(db, user, entry_id)
    if not await user_has_permission(
        db, user, "knowledge.write", org_id=entry.org_id, project_id=entry.project_id,
    ):
        raise AppError("FORBIDDEN", "缺少权限：knowledge.write。")
    if entry.status in ("deprecated", "retracted"):
        raise AppError("CONFLICT", "已过时/撤回的条目不能直接修订，请先恢复或新建替代条目。")
    body = (payload.get("body") or "").strip()
    if not body:
        raise AppError("VALIDATION_ERROR", "修订正文不能为空。")

    old_version = await _active_version(db, entry.id)
    new_version_no = entry.current_version + 1
    if old_version is not None:
        old_version.is_active = False
    entry.body = body
    entry.summary = payload.get("summary") or entry.summary
    entry.current_version = new_version_no
    if "source_ref" in payload:
        entry.source_ref_json = _dump(payload["source_ref"])

    version = KnowledgeEntryVersion(
        id=new_id("kev"), entry_id=entry.id, version=new_version_no, body=body,
        summary=entry.summary, change_note=payload.get("change_note") or "修订",
        edited_by=user.id, is_active=True,
    )
    db.add(version)
    await record_trail(db, action="knowledge.entry_revise", actor_user_id=user.id, org_id=entry.org_id,
                       project_id=entry.project_id, target_type="knowledge_entry", target_id=entry.id,
                       before={"version": entry.current_version - 1}, after={"version": new_version_no},
                       summary=f"知识条目修订至 v{new_version_no}", request_id=request_id)
    await db.commit()
    await db.refresh(entry)
    return {**_entry_view(entry, version), "links": await _links(db, entry.id)}


async def set_entry_status(db: AsyncSession, user: User, entry_id: str, status: str,
                           reason: str = "", request_id: str = "") -> dict:
    entry = await _get_visible_entry(db, user, entry_id)
    if not await user_has_permission(db, user, "knowledge.review", org_id=entry.org_id, project_id=entry.project_id):
        raise AppError("FORBIDDEN", "缺少权限：knowledge.review。")
    if status not in ("active", "deprecated", "retracted"):
        raise AppError("VALIDATION_ERROR", "状态须为 active/deprecated/retracted。")
    before = entry.status
    entry.status = status
    entry.deprecated_reason = reason if status == "deprecated" else ""
    await record_trail(db, action="knowledge.entry_status", actor_user_id=user.id, org_id=entry.org_id,
                       project_id=entry.project_id, target_type="knowledge_entry", target_id=entry.id,
                       before={"status": before}, after={"status": status, "reason": reason},
                       summary=f"知识条目 → {status}", request_id=request_id)
    await db.commit()
    await db.refresh(entry)
    return _entry_view(entry, await _active_version(db, entry.id))


# 纠错


async def report_correction(db: AsyncSession, user: User, entry_id: str, payload: dict,
                            request_id: str = "") -> dict:
    entry = await _get_visible_entry(db, user, entry_id)
    kind = payload.get("kind")
    if kind not in CORRECTION_KINDS:
        raise AppError("VALIDATION_ERROR", f"纠错类型须为 {sorted(CORRECTION_KINDS)}。")
    note = (payload.get("note") or "").strip()
    if not note:
        raise AppError("VALIDATION_ERROR", "纠错说明不能为空。")
    corr = KnowledgeCorrection(
        id=new_id("korr"), entry_id=entry.id, reporter_user_id=user.id, kind=kind, note=note,
        evidence_ref_json=_dump(payload.get("evidence_ref") or {}), status="open",
    )
    db.add(corr)
    await record_trail(db, action="knowledge.correction_report", actor_user_id=user.id, org_id=entry.org_id,
                       project_id=entry.project_id, target_type="knowledge_correction", target_id=corr.id,
                       after={"kind": kind}, summary="上报知识纠错", request_id=request_id)
    await db.commit()
    await db.refresh(corr)
    return _correction_view(corr)


async def resolve_correction(db: AsyncSession, user: User, correction_id: str, status: str,
                             resolution_note: str = "", request_id: str = "") -> dict:
    corr = (await db.execute(select(KnowledgeCorrection).where(
        KnowledgeCorrection.id == correction_id))).scalar_one_or_none()
    if corr is None:
        raise AppError("NOT_FOUND", "纠错记录不存在。")
    entry = await _get_visible_entry(db, user, corr.entry_id)
    if not await user_has_permission(db, user, "knowledge.review", org_id=entry.org_id, project_id=entry.project_id):
        raise AppError("FORBIDDEN", "缺少权限：knowledge.review。")
    if status not in ("accepted", "rejected"):
        raise AppError("VALIDATION_ERROR", "裁定须为 accepted 或 rejected。")
    corr.status = status
    corr.resolved_by = user.id
    corr.resolution_note = resolution_note
    corr.resolved_at = _now()
    await record_trail(db, action="knowledge.correction_resolve", actor_user_id=user.id, org_id=entry.org_id,
                       project_id=entry.project_id, target_type="knowledge_correction", target_id=corr.id,
                       after={"status": status}, summary="裁定知识纠错", request_id=request_id)
    await db.commit()
    await db.refresh(corr)
    return _correction_view(corr)


def _correction_view(c: KnowledgeCorrection) -> dict:
    return {
        "id": c.id, "entry_id": c.entry_id, "reporter_user_id": c.reporter_user_id,
        "kind": c.kind, "note": c.note, "evidence_ref": json.loads(c.evidence_ref_json or "{}"),
        "status": c.status, "resolved_by": c.resolved_by, "resolution_note": c.resolution_note,
        "created_at": c.created_at.isoformat() if c.created_at else "",
        "resolved_at": c.resolved_at.isoformat() if c.resolved_at else None,
    }


# 读操作（隔离）


async def _get_visible_entry(db: AsyncSession, user: User, entry_id: str) -> KnowledgeEntry:
    entry = (await db.execute(select(KnowledgeEntry).where(KnowledgeEntry.id == entry_id))).scalar_one_or_none()
    if entry is None:
        raise AppError("NOT_FOUND", "知识条目不存在或无权访问。")
    if user.is_platform_admin:
        return entry
    if entry.visibility == "project":
        if not entry.project_id:
            raise AppError("NOT_FOUND", "知识条目不存在或无权访问。")
        await resolve_project_access(db, entry.project_id, user)
        return entry
    org_ids = set(await _user_org_ids(db, user))
    if entry.org_id and entry.org_id in org_ids:
        return entry
    if entry.project_id:
        project_ids = await _user_project_ids(db, user)
        if entry.project_id in project_ids:
            return entry
    raise AppError("NOT_FOUND", "知识条目不存在或无权访问。")


async def list_entries(db: AsyncSession, user: User, category: str | None = None,
                       status: str | None = None, project_id: str | None = None) -> list[dict]:
    rows = (await db.execute(select(KnowledgeEntry).order_by(KnowledgeEntry.updated_at.desc()))).scalars().all()
    org_ids = set(await _user_org_ids(db, user))
    project_ids = await _user_project_ids(db, user)
    admin_orgs = select(OrgMember.org_id).where(
        OrgMember.user_id == user.id, OrgMember.role_key == "org_admin",
    )
    accessible_projects = project_ids | set((await db.scalars(
        select(Project.id).where(Project.org_id.in_(admin_orgs))
    )).all())
    visible: list[KnowledgeEntry] = []
    for e in rows:
        if not user.is_platform_admin:
            same_org = e.org_id is not None and e.org_id in org_ids
            same_project = e.project_id is not None and e.project_id in project_ids
            if e.visibility == "project":
                if e.project_id not in accessible_projects:
                    continue
            elif not (same_org or same_project):
                continue
        if category and e.category != category:
            continue
        if status and e.status != status:
            continue
        if project_id and e.project_id != project_id:
            continue
        visible.append(e)
    out = []
    for e in visible:
        version = await _active_version(db, e.id)
        view = _entry_view(e, version)
        view["links"] = await _links(db, e.id)
        out.append(view)
    return out


async def get_entry(db: AsyncSession, user: User, entry_id: str) -> dict:
    entry = await _get_visible_entry(db, user, entry_id)
    versions = (await db.execute(select(KnowledgeEntryVersion).where(
        KnowledgeEntryVersion.entry_id == entry_id).order_by(KnowledgeEntryVersion.version.desc()))).scalars().all()
    view = _entry_view(entry, await _active_version(db, entry.id))
    view["versions"] = [{
        "version": v.version, "change_note": v.change_note, "summary": v.summary,
        "edited_by": v.edited_by, "is_active": v.is_active,
        "created_at": v.created_at.isoformat() if v.created_at else "",
    } for v in versions]
    view["links"] = await _links(db, entry.id)
    corrections = (await db.execute(select(KnowledgeCorrection).where(
        KnowledgeCorrection.entry_id == entry_id).order_by(KnowledgeCorrection.created_at.desc()))).scalars().all()
    view["corrections"] = [_correction_view(c) for c in corrections]
    return view
