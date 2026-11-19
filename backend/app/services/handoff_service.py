"""科研项目交接包：导出项目可见数据为 ZIP 字节，并对上传包做完整性与安全校验。

设计要点：
- 只处理已授权项目：导出/校验前均调用 resolve_project_access，非成员按 404 处理。
- 不落盘、不调用外部平台：生成与校验都在内存中完成，由 API 决定如何返回字节。
- manifest.json 记录每个载荷文件的 sha256 与大小；自身不做自哈希，避免自指循环。
- 导入仅校验并返回清单，不写数据库（import_mode=validated_not_applied），避免覆盖生产数据。
"""
from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from datetime import datetime, timezone
from pathlib import PurePosixPath
from typing import Any

from sqlalchemy import inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access
from app.core.errors import AppError
from app.models import (
    AIRun,
    AuditFinding,
    Evidence,
    ExtractedFact,
    Material,
    Project,
    SourceChunk,
)
from app.models.stage2 import EvidenceItem, FactRevision, MaterialParseRun, ParseTask
from app.models.stage4 import (
    ExecutionArtifact,
    ExecutionEnvironment,
    ExecutionLog,
    FailureDiagnostic,
    MetricComparison,
    RemediationProposal,
    RemediationReview,
    ReproductionMetric,
    ReproductionPlan,
    ReproductionReport,
    ReproductionRun,
    ReproductionTask,
)
from app.models.stage6 import User

BUNDLE_VERSION = "1.0"
MAX_BUNDLE_BYTES = 50 * 1024 * 1024
MAX_BUNDLE_ENTRIES = 500
ALLOWED_SUFFIXES = {".txt", ".json", ".md"}
MANIFEST_NAME = "manifest.json"
_WINDOWS_ABS = re.compile(r"^[A-Za-z]:")

README_TEXT = (
    "科研项目交接包\n"
    "=============\n"
    "本包由 ReproCheck 为已授权项目成员生成，包含项目元数据、材料原文、事实与证据、"
    "解析与复现记录、未解决问题及修复历史。\n"
    "manifest.json 列出每个载荷文件的 sha256 与字节数，但不对自身做哈希（自指循环不可解）。\n"
    "上传校验只验证完整性与路径安全，不会把任何内容写回数据库。\n"
)


def _json_default(value: Any) -> Any:
    """把 ORM 列值转换为可序列化结构。"""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (set, tuple)):
        return list(value)
    return str(value)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                      default=_json_default).encode("utf-8")


def _row(obj: Any) -> dict:
    """按模型列导出一行，避免 ORM 关系对象被序列化。"""
    mapper = inspect(obj).mapper
    return {attr.key: getattr(obj, attr.key) for attr in mapper.column_attrs}


def _rows(rows: list[Any]) -> list[dict]:
    return [_row(row) for row in rows]


async def _table_exists(db: AsyncSession, model: Any) -> bool:
    """兼容旧库：表缺失时该部分数据视为空，不中断交接包生成。"""
    connection = await db.connection()
    return bool(await connection.run_sync(
        lambda sync_conn: inspect(sync_conn).has_table(model.__tablename__)
    ))


async def _fetch(db: AsyncSession, model: Any, *conditions: Any) -> list[Any]:
    if not await _table_exists(db, model):
        return []
    primary_key = inspect(model).primary_key[0]
    result = await db.execute(select(model).where(*conditions).order_by(primary_key))
    return result.scalars().all()


def _safe_relative_path(raw: str) -> str:
    """材料 id 进入文件名前做白名单净化，保证生成的都是相对路径。"""
    return re.sub(r"[^A-Za-z0-9_.-]", "_", raw or "unknown")


def _project_view(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "domain": project.domain,
        "paper_title": project.paper_title,
        "description": project.description,
        "created_at": project.created_at,
        "updated_at": project.updated_at,
    }


async def build_bundle(db: AsyncSession, user: User, project_id: str) -> dict[str, bytes]:
    """构建项目交接包，返回 {相对路径: bytes}，不写任何文件。"""
    project = await resolve_project_access(db, project_id, user)

    materials = await _fetch(db, Material, Material.project_id == project_id)
    material_ids = [m.id for m in materials]
    chunks = (await _fetch(db, SourceChunk, SourceChunk.material_id.in_(material_ids))
              if material_ids else [])
    chunks.sort(key=lambda c: (getattr(c, "chunk_index", 0) or 0, c.chunk_id or ""))

    files: dict[str, bytes] = {}
    material_views: list[dict] = []
    for material in materials:
        parts = [chunk.original_text or "" for chunk in chunks
                 if chunk.material_id == material.id]
        # 无切块时退回材料原始文本，保证原文不丢失。
        text = "\n\n".join(parts) if parts else (material.raw_text or "")
        relative = f"materials/{_safe_relative_path(material.id)}.txt"
        files[relative] = text.encode("utf-8")
        view = _row(material)
        view["text_file"] = relative
        view["chunk_count"] = len(parts)
        material_views.append(view)

    facts = await _fetch(db, ExtractedFact, ExtractedFact.project_id == project_id)
    fact_ids = [f.fact_id or str(f.id) for f in facts]
    finding_rows = await _fetch(db, AuditFinding, AuditFinding.project_id == project_id)
    findings = _rows(finding_rows)
    finding_ids = [f.id for f in finding_rows]
    evidences = (await _fetch(db, Evidence, Evidence.finding_id.in_(finding_ids))
                 if finding_ids else [])
    evidence_items = await _fetch(
        db, EvidenceItem,
        or_(EvidenceItem.project_id == project_id, EvidenceItem.fact_id.in_(fact_ids)),
    )
    revisions = (await _fetch(db, FactRevision, FactRevision.fact_id.in_(fact_ids))
                 if fact_ids else [])

    ai_runs = await _fetch(db, AIRun, AIRun.project_id == project_id)
    parse_runs = await _fetch(db, MaterialParseRun, MaterialParseRun.project_id == project_id)
    parse_tasks = await _fetch(db, ParseTask, ParseTask.project_id == project_id)

    plans = await _fetch(db, ReproductionPlan, ReproductionPlan.project_id == project_id)
    repro_tasks = await _fetch(db, ReproductionTask, ReproductionTask.project_id == project_id)
    repro_runs = await _fetch(db, ReproductionRun, ReproductionRun.project_id == project_id)
    environments = await _fetch(db, ExecutionEnvironment,
                                ExecutionEnvironment.project_id == project_id)
    logs = await _fetch(db, ExecutionLog, ExecutionLog.project_id == project_id)
    artifacts = await _fetch(db, ExecutionArtifact, ExecutionArtifact.project_id == project_id)
    metrics = await _fetch(db, ReproductionMetric, ReproductionMetric.project_id == project_id)
    comparisons = await _fetch(db, MetricComparison, MetricComparison.project_id == project_id)
    diagnostics = await _fetch(db, FailureDiagnostic,
                               FailureDiagnostic.project_id == project_id)
    proposals = await _fetch(db, RemediationProposal,
                             RemediationProposal.project_id == project_id)
    proposal_ids = [p.id for p in proposals]
    reviews = (await _fetch(db, RemediationReview,
                            RemediationReview.proposal_id.in_(proposal_ids))
               if proposal_ids else [])
    reports = await _fetch(db, ReproductionReport,
                           ReproductionReport.project_id == project_id)

    # 未解决问题：事实待复核、任务/诊断待人工确认、指标待人工复核。
    unresolved: list[dict] = []
    for fact in facts:
        if (fact.extraction_status or "") == "needs_review":
            unresolved.append({"kind": "fact_needs_review",
                               "id": fact.fact_id or str(fact.id),
                               "detail": fact.field_key})
    for task in repro_tasks:
        if task.needs_human_confirm:
            unresolved.append({"kind": "task_needs_human_confirm",
                               "id": task.id, "detail": task.title})
    for diagnostic in diagnostics:
        if diagnostic.needs_human_confirm:
            unresolved.append({"kind": "diagnostic_needs_human_confirm",
                               "id": diagnostic.id, "detail": diagnostic.problem})
    for metric in metrics:
        if metric.needs_manual_review:
            unresolved.append({"kind": "metric_needs_manual_review",
                               "id": str(metric.id), "detail": metric.metric_name})

    files.update({
        "project.json": _json_bytes(_project_view(project)),
        "materials.json": _json_bytes(material_views),
        "facts.json": _json_bytes(_rows(facts)),
        "evidence.json": _json_bytes({
            "audit_findings": findings,
            "evidences": _rows(evidences),
            "evidence_items": _rows(evidence_items),
        }),
        "fact_revisions.json": _json_bytes(_rows(revisions)),
        "parse_runs.json": _json_bytes({
            "ai_runs": _rows(ai_runs),
            "material_parse_runs": _rows(parse_runs),
            "parse_tasks": _rows(parse_tasks),
        }),
        "reproduction.json": _json_bytes({
            "plans": _rows(plans),
            "tasks": _rows(repro_tasks),
            "runs": _rows(repro_runs),
            "environments": _rows(environments),
            "metrics": _rows(metrics),
            "comparisons": _rows(comparisons),
        }),
        "execution_logs.json": _json_bytes(_rows(logs)),
        "execution_artifacts.json": _json_bytes(_rows(artifacts)),
        "reports.json": _json_bytes(_rows(reports)),
        "unresolved.json": _json_bytes(unresolved),
        "remediation.json": _json_bytes({
            "failure_diagnostics": _rows(diagnostics),
            "remediation_proposals": _rows(proposals),
            "remediation_reviews": _rows(reviews),
        }),
        "README.md": README_TEXT.encode("utf-8"),
    })

    counts = {
        "materials": len(materials),
        "material_text_files": len(material_ids),
        "chunks": len(chunks),
        "facts": len(facts),
        "evidence": len(findings) + len(evidences) + len(evidence_items),
        "fact_revisions": len(revisions),
        "parse_runs": len(ai_runs) + len(parse_runs) + len(parse_tasks),
        "reproduction_runs": len(repro_runs),
        "logs": len(logs),
        "artifacts": len(artifacts),
        "reports": len(reports),
        "unresolved_issues": len(unresolved),
        "remediation_items": len(diagnostics) + len(proposals) + len(reviews),
        "files": len(files),
    }
    manifest = {
        "bundle_version": BUNDLE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_id": project_id,
        "files": {
            path: {"sha256": hashlib.sha256(content).hexdigest(), "size_bytes": len(content)}
            for path, content in sorted(files.items())
        },
        "counts": counts,
    }
    files[MANIFEST_NAME] = _json_bytes(manifest)
    return files


def write_zip(files: dict[str, bytes]) -> bytes:
    """把内存文件字典写成 ZIP 字节；路径均由服务端构造，不含用户可控片段。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(files):
            archive.writestr(path, files[path])
    return buffer.getvalue()


def _check_member_path(name: str) -> None:
    """拒绝绝对路径、盘符、反斜杠、.. 与空段，防止 Zip Slip。"""
    if (not name or "\x00" in name or name.startswith("/") or "\\" in name
            or _WINDOWS_ABS.match(name)):
        raise AppError("VALIDATION_ERROR", "交接包包含非法文件路径。")
    parts = name.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise AppError("VALIDATION_ERROR", "交接包包含路径穿越或不规范路径。")
    # 规范化后必须保持原样，避免 Unicode/多余分隔符绕过。
    if PurePosixPath(name).as_posix() != name:
        raise AppError("VALIDATION_ERROR", "交接包包含不规范文件路径。")


async def validate_bundle(
    db: AsyncSession, user: User, data: bytes, target_project_id: str,
) -> dict:
    """校验上传的交接包：大小/条目/路径/后缀/manifest sha256，不写数据库。"""
    await resolve_project_access(db, target_project_id, user)
    if len(data) > MAX_BUNDLE_BYTES:
        raise AppError("VALIDATION_ERROR", "交接包超过大小上限。")

    names: set[str] = set()
    try:
        with zipfile.ZipFile(io.BytesIO(data), "r") as archive:
            infos = archive.infolist()
            if len(infos) > MAX_BUNDLE_ENTRIES:
                raise AppError("VALIDATION_ERROR", "交接包条目数超过上限。")
            if sum(info.file_size for info in infos) > MAX_BUNDLE_BYTES:
                raise AppError("VALIDATION_ERROR", "交接包解压后超过大小上限。")

            for info in infos:
                name = info.filename
                if name.endswith("/"):
                    _check_member_path(name.rstrip("/"))
                    continue
                _check_member_path(name)
                suffix = PurePosixPath(name).suffix.lower()
                if name != MANIFEST_NAME and suffix not in ALLOWED_SUFFIXES:
                    raise AppError("VALIDATION_ERROR", f"不支持的交接包文件类型：{suffix}。")
                if name in names:
                    raise AppError("VALIDATION_ERROR", "交接包包含重复文件路径。")
                names.add(name)

            if MANIFEST_NAME not in names:
                raise AppError("VALIDATION_ERROR", "交接包缺少 manifest.json。")

            manifest = json.loads(archive.read(MANIFEST_NAME).decode("utf-8"))
            if not isinstance(manifest, dict):
                raise AppError("VALIDATION_ERROR", "manifest.json 格式无效。")
            if manifest.get("bundle_version") != BUNDLE_VERSION:
                raise AppError("VALIDATION_ERROR", "交接包版本不受支持。")
            declared = manifest.get("files")
            if not isinstance(declared, dict):
                raise AppError("VALIDATION_ERROR", "manifest.json 缺少文件清单。")

            for path, meta in declared.items():
                _check_member_path(path)
                if path == MANIFEST_NAME:
                    continue
                if not isinstance(meta, dict) or not isinstance(meta.get("sha256"), str):
                    raise AppError("VALIDATION_ERROR", "manifest.json 文件校验信息无效。")
                if path not in names:
                    raise AppError("VALIDATION_ERROR", "manifest.json 声明的文件缺失。")
                content = archive.read(path)
                actual = hashlib.sha256(content).hexdigest()
                if actual != meta["sha256"].lower():
                    raise AppError("VALIDATION_ERROR", "交接包文件哈希与 manifest 不一致。")
                expected_size = meta.get("size_bytes")
                if expected_size is not None and int(expected_size) != len(content):
                    raise AppError("VALIDATION_ERROR", "交接包文件大小与 manifest 不一致。")

            for name in names:
                if name != MANIFEST_NAME and name not in declared:
                    raise AppError("VALIDATION_ERROR", "交接包包含未登记文件。")
    except AppError:
        raise
    except (zipfile.BadZipFile, zipfile.LargeZipFile, json.JSONDecodeError,
            UnicodeDecodeError, ValueError, TypeError, OSError) as exc:
        raise AppError("VALIDATION_ERROR", f"交接包格式无效：{type(exc).__name__}") from exc

    return {
        "valid": True,
        "import_mode": "validated_not_applied",
        "manifest": manifest,
        "target_project_id": target_project_id,
        "files": sorted(names),
        "note": "仅完成完整性与安全校验，未写入数据库。",
    }
