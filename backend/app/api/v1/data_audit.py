"""数据质量与数据完整性审计 API（第十阶段独立升级）。

- POST /projects/{project_id}/data-audits        执行审计（只读，纯本地计算）
- GET  /projects/{project_id}/data-audits        历史列表
- GET  /projects/{project_id}/data-audits/{id}   完整报告
- GET  /data-audits/rules                        规则目录（不访问项目数据）

安全：审计在项目材料存储目录内只读执行；不上传数据、不调用外部模型；
限额只允许收窄，不允许超过 readers 模块的硬上限。
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ok
from app.dataaudit import RULE_CATALOG, run_data_audit
from app.dataaudit.readers import MAX_FILES, MAX_ROWS_PER_FILE, MAX_SAMPLE_ROWS
from app.db import get_db
from app.models import Material, Project
from app.models.data_audit import DataAuditRun
from app.services.material_service import STORAGE_ROOT

router = APIRouter(tags=["data-audit"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class DataAuditRunIn(BaseModel):
    """执行参数。全部为限额收窄项，不能放宽引擎硬上限。"""
    include_code_scan: bool = Field(default=True, description="是否扫描项目代码做泄漏/预处理审计")
    max_files: int = Field(default=50, ge=1, le=MAX_FILES)
    sample_rows: int = Field(default=20_000, ge=100, le=MAX_SAMPLE_ROWS)
    max_rows: int = Field(default=200_000, ge=100, le=MAX_ROWS_PER_FILE)


async def _get_project(db: AsyncSession, project_id: str) -> Project:
    project = (await db.execute(
        select(Project).where(Project.id == project_id)
    )).scalar_one_or_none()
    if project is None:
        raise AppError("NOT_FOUND", "项目不存在。")
    return project


@router.post("/projects/{project_id}/data-audits")
async def run_project_data_audit(
    project_id: str,
    payload: DataAuditRunIn,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """对项目已上传的材料目录执行只读数据审计，落库并返回完整报告。"""
    await _get_project(db, project_id)

    data_root = (STORAGE_ROOT / project_id).resolve()
    if not data_root.exists() or not any(data_root.iterdir()):
        raise AppError(
            "NOT_FOUND", "项目尚无已存储的数据材料，无法执行数据审计。")

    # 代码扫描目标 + 存储名→原始名映射（上传后存储名被改写为 mat-xxx.ext，
    # 划分识别与版本识别需要原始文件名）
    code_paths: list[str] = []
    file_aliases: dict[str, str] = {}
    materials = (await db.execute(
        select(Material).where(Material.project_id == project_id)
    )).scalars().all()
    for m in materials:
        if not m.stored_path or not Path(m.stored_path).exists():
            continue
        original = m.original_filename or m.source_name or ""
        if original:
            file_aliases[m.stored_path] = original
            file_aliases[Path(m.stored_path).name] = original
        if payload.include_code_scan and \
                Path(m.stored_path).suffix.lower() == ".py":
            code_paths.append(m.stored_path)

    report = run_data_audit(
        project_id=project_id,
        data_roots=[data_root],
        code_files=code_paths,
        file_aliases=file_aliases,
        max_files=payload.max_files,
        sample_rows=payload.sample_rows,
        max_rows=payload.max_rows,
    )
    d = report.to_dict()

    run = DataAuditRun(
        id=report.audit_id,
        project_id=project_id,
        status="completed",
        scope_json=json.dumps(d["scope"], ensure_ascii=False),
        report_json=json.dumps(d, ensure_ascii=False),
        finding_count=len(d["findings"]),
        blocking_count=d["blocking_count"],
        duration_ms=d["duration_ms"],
    )
    db.add(run)
    try:
        await db.commit()
    except Exception as exc:  # noqa: BLE001 — 报告已生成，落库失败不吞报告
        await db.rollback()
        raise AppError("DB_SAVE_FAILED",
                       f"审计完成但保存失败：{exc}") from exc
    return ok(d, _rid(request))


@router.get("/projects/{project_id}/data-audits")
async def list_project_data_audits(
    project_id: str,
    request: Request,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    await _get_project(db, project_id)
    rows = (await db.execute(
        select(DataAuditRun)
        .where(DataAuditRun.project_id == project_id)
        .order_by(DataAuditRun.created_at.desc())
        .limit(min(limit, 100))
    )).scalars().all()
    items = [{
        "audit_id": r.id,
        "created_at": r.created_at.isoformat() if r.created_at else None,
        "status": r.status,
        "finding_count": r.finding_count,
        "blocking_count": r.blocking_count,
        "duration_ms": r.duration_ms,
    } for r in rows]
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.get("/projects/{project_id}/data-audits/{audit_id}")
async def get_project_data_audit(
    project_id: str,
    audit_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    await _get_project(db, project_id)
    row = (await db.execute(
        select(DataAuditRun).where(
            DataAuditRun.id == audit_id,
            DataAuditRun.project_id == project_id,  # 隔离：跨项目 404
        )
    )).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "审计记录不存在。")
    try:
        report = json.loads(row.report_json)
    except json.JSONDecodeError as exc:
        raise AppError("INTERNAL_ERROR", "审计报告已损坏。") from exc
    return ok(report, _rid(request))


@router.get("/data-audits/rules")
async def list_data_audit_rules(request: Request):
    """规则目录：纯静态数据，不读取任何项目材料。"""
    items = [{
        "rule_id": r.rule_id,
        "name": r.name,
        "category": r.category,
        "default_severity": r.default_severity,
        "description": r.description,
    } for r in RULE_CATALOG.values()]
    return ok({"items": items, "total": len(items)}, _rid(request))
