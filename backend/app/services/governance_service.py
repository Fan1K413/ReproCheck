"""安全与数据治理（E）：数据分级、AI 外部模型授权、本人数据导出、保留策略。

AI 授权门：settings.require_ai_consent=True 时，调用外部 LLM 前必须存在有效授权，
否则明确拒绝（不静默发送）。导出仅包含请求者本人可见数据，绝不导出他人私密材料或密钥。
"""
from __future__ import annotations

import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access, user_has_permission
from app.core.config import BACKEND_STORAGE, settings
from app.core.errors import AppError
from app.core.security import new_id
from app.models import ExtractedFact, Material, Project
from app.models.stage6 import AiConsent, DataExportRequest, OrgMember, ProjectMember, User
from app.services.trail_service import record_trail

EXPORT_ROOT = BACKEND_STORAGE / "exports"

DATA_CLASSES = [
    {"level": "public", "label": "公开", "examples": ["公开基准案例", "已发布报告摘要"],
     "handling": "可公开检索；不含未发表材料。"},
    {"level": "internal", "label": "内部", "examples": ["组织内项目元数据", "审计规则"],
     "handling": "仅组织成员可见；导出需授权。"},
    {"level": "confidential", "label": "机密", "examples": ["未发表论文原文", "抽取事实与证据"],
     "handling": "仅项目成员可见；外部 LLM 调用需 AI 授权；不得进入公共 RAG。"},
    {"level": "restricted", "label": "受限", "examples": ["密码哈希", "仓库令牌", "API Token"],
     "handling": "加密/哈希落库；绝不回显明文；不参与导出与模型输入。"},
]

RETENTION_POLICY = {
    "default_days": settings.data_retention_days,
    "rules": [
        {"data": "材料原文与证据", "retention": "项目存续期间保留；删除项目级联清理物理文件。"},
        {"data": "审计轨迹", "retention": f"保留 {settings.data_retention_days} 天，不可被结论修订覆盖。"},
        {"data": "API 调用日志", "retention": "保留 90 天，IP 仅存哈希。"},
        {"data": "撤销的令牌/连接", "retention": "立即失效并清空密文，元数据留痕。"},
    ],
    "note": "保留策略为治理声明；自动清理任务需由部署侧定时执行（当前未内置 cron）。",
}


def classification_view() -> dict:
    return {"classes": DATA_CLASSES,
            "principle": "当前论文证据优先；历史案例与外部知识不得覆盖当前事实；受限数据绝不出库回显。"}


async def grant_ai_consent(db: AsyncSession, user: User, payload: dict, rid: str) -> dict:
    project_id = payload.get("project_id")
    org_id = payload.get("org_id")
    if project_id:
        proj = await resolve_project_access(db, project_id, user, min_rank=3)  # project_lead+
        if org_id and org_id != proj.org_id:
            raise AppError("VALIDATION_ERROR", "组织与项目归属不一致。")
        org_id = proj.org_id
    else:
        if not org_id:
            rows = (await db.execute(select(OrgMember.org_id).where(
                OrgMember.user_id == user.id, OrgMember.role_key == "org_admin"))).scalars().all()
            org_id = rows[0] if rows else None
        if not await user_has_permission(db, user, "data.manage", org_id=org_id):
            raise AppError("FORBIDDEN", "缺少权限：data.manage（组织管理员或项目负责人）。")
    allow = bool(payload.get("allow_external_llm", False))
    scope = payload.get("scope", "project" if project_id else "org")
    # 撤销同范围旧授权，保留历史
    prior = (await db.execute(select(AiConsent).where(
        AiConsent.project_id == project_id, AiConsent.org_id == org_id,
        AiConsent.revoked_at.is_(None)))).scalars().all()
    for p in prior:
        p.revoked_at = datetime.now(timezone.utc)
    consent = AiConsent(id=new_id("consent"), org_id=org_id, project_id=project_id, user_id=user.id,
                        allow_external_llm=allow, scope=scope)
    db.add(consent)
    await record_trail(db, action="governance.ai_consent", actor_user_id=user.id, org_id=org_id,
                       project_id=project_id, target_type="ai_consent", target_id=consent.id,
                       after={"allow_external_llm": allow, "scope": scope},
                       summary="设置 AI 外部模型授权", request_id=rid)
    await db.commit()
    await db.refresh(consent)
    return _consent_view(consent)


def _consent_view(c: AiConsent) -> dict:
    return {
        "consent_id": c.id, "org_id": c.org_id, "project_id": c.project_id,
        "allow_external_llm": c.allow_external_llm, "scope": c.scope,
        "granted_at": c.granted_at.isoformat() if c.granted_at else "",
        "revoked_at": c.revoked_at.isoformat() if c.revoked_at else None,
    }


async def get_ai_consent(db: AsyncSession, user: User, project_id: str | None, org_id: str | None) -> dict:
    if project_id:
        await resolve_project_access(db, project_id, user)
    stmt = select(AiConsent).where(AiConsent.revoked_at.is_(None))
    if project_id:
        stmt = stmt.where(AiConsent.project_id == project_id)
    elif org_id:
        if not await user_has_permission(db, user, "data.manage", org_id=org_id):
            raise AppError("FORBIDDEN", "缺少权限：data.manage。")
        stmt = stmt.where(AiConsent.org_id == org_id, AiConsent.project_id.is_(None))
    elif not user.is_platform_admin:
        managed_orgs = select(OrgMember.org_id).where(
            OrgMember.user_id == user.id, OrgMember.role_key == "org_admin",
        )
        stmt = stmt.where(AiConsent.org_id.in_(managed_orgs), AiConsent.project_id.is_(None))
    rows = (await db.execute(stmt.order_by(AiConsent.granted_at.desc()))).scalars().all()
    active = rows[0] if rows else None
    return {"active": _consent_view(active) if active else None,
            "require_ai_consent": settings.require_ai_consent,
            "history": [_consent_view(c) for c in rows]}


async def ensure_ai_consent(db: AsyncSession, project_id: str | None, org_id: str | None = None) -> None:
    """LLM 调用前的授权门。require_ai_consent=False 时直接放行（兼容演示/测试）。"""
    if not settings.require_ai_consent:
        return
    stmt = select(AiConsent).where(AiConsent.revoked_at.is_(None))
    row = None
    if project_id:
        row = await db.scalar(stmt.where(AiConsent.project_id == project_id)
                              .order_by(AiConsent.granted_at.desc()).limit(1))
    if row is None and org_id:
        row = await db.scalar(stmt.where(AiConsent.project_id.is_(None), AiConsent.org_id == org_id)
                              .order_by(AiConsent.granted_at.desc()).limit(1))
    if row is None or not row.allow_external_llm:
        raise AppError("AI_CONSENT_REQUIRED",
                       "未授权外部模型：请先在治理设置中授予 AI 外部模型调用同意。", status_code=403)


async def request_export(db: AsyncSession, user: User, rid: str) -> dict:
    req = DataExportRequest(id=new_id("export"), user_id=user.id, status="pending")
    db.add(req)
    await db.commit()
    await db.refresh(req)
    try:
        path = await _build_export(db, user, req.id)
        req.status = "completed"
        req.file_path = str(path)
        req.completed_at = datetime.now(timezone.utc)
    except Exception as exc:  # noqa: BLE001
        req.status = "failed"
        await db.commit()
        raise AppError("INTERNAL_ERROR", f"数据导出失败：{type(exc).__name__}") from exc
    await record_trail(db, action="governance.export", actor_user_id=user.id,
                       target_type="data_export", target_id=req.id, summary="导出本人数据", request_id=rid)
    await db.commit()
    await db.refresh(req)
    return _export_view(req)


async def _build_export(db: AsyncSession, user: User, request_id: str) -> Path:
    pms = (await db.execute(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))).scalars().all()
    owned = (await db.execute(select(Project.id).where(Project.owner_user_id == user.id))).scalars().all()
    pids = set(pms) | set(owned)
    projects = (await db.execute(select(Project).where(Project.id.in_(pids)))).scalars().all() if pids else []
    manifest = {"exported_at": datetime.now(timezone.utc).isoformat(), "user_id": user.id,
                "project_count": len(projects), "projects": []}
    for p in projects:
        materials = (await db.execute(select(Material).where(Material.project_id == p.id))).scalars().all()
        facts = (await db.execute(select(ExtractedFact).where(ExtractedFact.project_id == p.id))).scalars().all()
        manifest["projects"].append({
            "id": p.id, "name": p.name, "domain": p.domain,
            "materials": [{"id": m.id, "source_name": m.source_name, "sha256": m.sha256,
                           "parse_status": m.parse_status} for m in materials],
            "facts": [{"fact_id": f.fact_id, "field_key": f.field_key, "raw_value": f.raw_value,
                       "normalized_value": f.normalized_value, "parser_source": f.parser_source} for f in facts],
        })
    out_dir = EXPORT_ROOT / user.id
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"{request_id}.zip"
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("README.txt", "本导出仅包含请求者本人可见的项目元数据与事实，不含密钥/令牌/他人私密材料原文。")
    return path


def _export_view(r: DataExportRequest) -> dict:
    return {
        "export_id": r.id, "status": r.status,
        "file_available": bool(r.file_path),
        "created_at": r.created_at.isoformat() if r.created_at else "",
        "completed_at": r.completed_at.isoformat() if r.completed_at else None,
    }


async def get_export(db: AsyncSession, user: User, request_id: str) -> dict:
    r = (await db.execute(select(DataExportRequest).where(DataExportRequest.id == request_id))).scalar_one_or_none()
    if r is None or (r.user_id != user.id and not user.is_platform_admin):
        raise AppError("NOT_FOUND", "导出请求不存在或无权访问。")
    return _export_view(r)


async def export_file_path(db: AsyncSession, user: User, request_id: str) -> Path:
    r = (await db.execute(select(DataExportRequest).where(DataExportRequest.id == request_id))).scalar_one_or_none()
    if r is None or (r.user_id != user.id and not user.is_platform_admin):
        raise AppError("NOT_FOUND", "导出请求不存在或无权访问。")
    if not r.file_path or not Path(r.file_path).exists():
        raise AppError("NOT_FOUND", "导出文件尚未生成或已清理。")
    return Path(r.file_path)


def retention_view() -> dict:
    return RETENTION_POLICY
