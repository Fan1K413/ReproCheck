"""第二阶段材料管理 API。"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import ExtractedFact, Material, SourceChunk
from app.services.material_service import MaterialService

router = APIRouter(tags=["materials"])


def _view(m: Material, chunk_count: int = 0, fact_count: int = 0) -> dict[str, Any]:
    return {
        "material_id": m.id, "project_id": m.project_id,
        "filename": m.source_name, "material_type": m.material_type,
        "size_bytes": m.file_size_bytes, "parse_status": m.parse_status,
        "sha256": m.sha256, "chunk_count": chunk_count, "fact_count": fact_count,
        "created_at": m.created_at.isoformat() if m.created_at else "",
        "error_message": m.parse_error_message,
    }


@router.post("/materials/upload", dependencies=[Depends(require_admin)])
async def upload_material(
    project_id: str = Form(...), file: UploadFile = File(...),
    request: Request = None, db: AsyncSession = Depends(get_db),
):
    data = await file.read()
    service = MaterialService(db)
    try:
        material = await service.upload(project_id, file.filename or "unnamed", data)
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        raise AppError("DB_SAVE_FAILED", "材料保存失败。")
    return ok(_view(material), getattr(request.state, "request_id", "-"))


@router.get("/materials")
async def list_materials(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Material).where(Material.project_id == project_id).order_by(Material.created_at.desc())
    )).scalars().all()
    items = []
    for m in rows:
        cc = (await db.execute(
            select(func.count(SourceChunk.id)).where(SourceChunk.material_id == m.id)
        )).scalar() or 0
        fc = (await db.execute(
            select(func.count(ExtractedFact.id)).where(ExtractedFact.material_id == m.id)
        )).scalar() or 0
        items.append(_view(m, cc, fc))
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/materials/{material_id}")
async def get_material(material_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = MaterialService(db)
    m = await service.get(material_id)
    chunk_count = (await db.execute(
        select(func.count(SourceChunk.id)).where(SourceChunk.material_id == m.id)
    )).scalar() or 0
    fact_count = (await db.execute(
        select(func.count(ExtractedFact.id)).where(ExtractedFact.material_id == m.id)
    )).scalar() or 0
    view = _view(m, chunk_count, fact_count)
    metadata: dict = {}
    warnings: list = []
    if m.parse_metadata_json:
        try:
            metadata = json.loads(m.parse_metadata_json)
        except Exception:  # noqa: BLE001
            metadata = {}
    if m.warnings_json:
        try:
            warnings = json.loads(m.warnings_json)
        except Exception:  # noqa: BLE001
            warnings = []
    # 原始内容预览：从已落库 chunks 拼接（有界），不重新解析文件
    chunk_rows = (await db.execute(
        select(SourceChunk).where(SourceChunk.material_id == m.id)
        .order_by(SourceChunk.chunk_index).limit(30)
    )).scalars().all()
    preview = "\n\n".join(c.original_text for c in chunk_rows)[:8000]
    view.update({
        "metadata": metadata, "warnings": warnings,
        "raw_preview": preview, "can_preview": bool(chunk_rows),
        "page_count": m.page_count, "needs_ocr": m.needs_ocr,
        "parse_duration_ms": m.parse_duration_ms,
        "parse_error_code": m.parse_error_code,
    })
    return ok(view, getattr(request.state, "request_id", "-"))


@router.get("/materials/{material_id}/download")
async def download_material(material_id: str, db: AsyncSession = Depends(get_db)):
    service = MaterialService(db)
    m = await service.get(material_id)
    path = await service.path_of(m)
    content = path.read_bytes()
    return Response(
        content=content,
        media_type=m.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{m.source_name}"'},
    )


@router.delete("/materials/{material_id}", dependencies=[Depends(require_admin)])
async def delete_material(material_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = MaterialService(db)
    result = await service.delete(material_id)
    return ok(result, getattr(request.state, "request_id", "-"))
