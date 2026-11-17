"""材料服务：上传、存储、哈希去重、下载、删除级联。

文件存本地 storage/materials/{project_id}/，数据库只存路径与元信息。
安全：扩展名白名单由 registry 校验；文件名净化；路径穿越防护。
"""
from __future__ import annotations

import hashlib
import mimetypes
import os
import re
import shutil
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.models import ExtractedFact, Material, Project, SourceChunk
from app.models.stage2 import EvidenceItem
from app.parsers.limits import (
    ALLOWED_EXTENSIONS,
    MAX_PROJECT_MATERIALS,
    ParserError,
    safe_resolve_within,
)

STORAGE_ROOT = Path(settings.database_url and "./storage/materials" or "./storage/materials").resolve()


def _safe_filename(name: str) -> str:
    """净化文件名：去路径成分、危险字符，避免路径穿越与恶意文件名。"""
    name = os.path.basename(name or "")
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"[\x00-\x1f]", "_", name)
    name = re.sub(r"[<>:\"|?*]", "_", name).strip(" .")
    return name[:200] or "unnamed"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


class MaterialService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def upload(self, project_id: str, filename: str, data: bytes) -> Material:
        # 项目存在性
        project = (await self.db.execute(
            select(Project).where(Project.id == project_id)
        )).scalar_one_or_none()
        if project is None:
            raise AppError("NOT_FOUND", "项目不存在。")

        safe_name = _safe_filename(filename)
        ext = Path(safe_name).suffix.lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise AppError("VALIDATION_ERROR", f"不支持的文件类型：{ext or '(无扩展名)'}")

        # 数量限制
        count = (await self.db.execute(
            select(Material.id).where(Material.project_id == project_id)
        )).all()
        if len(count) >= MAX_PROJECT_MATERIALS:
            raise AppError("VALIDATION_ERROR", f"单项目材料数已达上限 {MAX_PROJECT_MATERIALS}。")

        digest = hashlib.sha256(data).hexdigest()
        # 同项目内哈希去重：复用已存在材料，不重复解析
        dup = (await self.db.execute(
            select(Material).where(
                Material.project_id == project_id, Material.sha256 == digest
            )
        )).scalar_one_or_none()
        if dup is not None:
            return dup

        project_dir = STORAGE_ROOT / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        material_id = f"mat-{uuid.uuid4().hex[:16]}"
        stored = project_dir / f"{material_id}{ext}"
        stored = safe_resolve_within(STORAGE_ROOT, stored)
        stored.write_bytes(data)

        from app.parsers.registry import detect_material_type
        mtype = detect_material_type(safe_name)
        material = Material(
            id=material_id, project_id=project_id, source_name=safe_name,
            original_filename=safe_name, stored_path=str(stored),
            material_type=mtype, file_size_bytes=len(data), sha256=digest,
            mime_type=mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
            parse_status="uploaded", raw_text="",
        )
        self.db.add(material)
        await self.db.commit()
        await self.db.refresh(material)
        return material

    async def get(self, material_id: str) -> Material:
        m = (await self.db.execute(
            select(Material).where(Material.id == material_id)
        )).scalar_one_or_none()
        if m is None:
            raise AppError("NOT_FOUND", "材料不存在。")
        return m

    async def path_of(self, material: Material) -> Path:
        if not material.stored_path:
            raise AppError("NOT_FOUND", "材料文件未存储。")
        p = safe_resolve_within(STORAGE_ROOT, Path(material.stored_path))
        if not p.exists():
            raise AppError("NOT_FOUND", "材料文件已丢失。")
        return p

    async def delete(self, material_id: str) -> dict:
        material = await self.get(material_id)
        chunks = (await self.db.execute(
            select(SourceChunk.id).where(SourceChunk.material_id == material_id)
        )).all()
        facts = (await self.db.execute(
            select(ExtractedFact.id).where(ExtractedFact.material_id == material_id)
        )).all()
        evs = (await self.db.execute(
            select(EvidenceItem.id).where(EvidenceItem.material_id == material_id)
        )).all()

        # SQLite 外键级联会删除 chunks/facts；evidence_items 显式清理避免孤立记录
        for ev in evs:
            row = (await self.db.execute(
                select(EvidenceItem).where(EvidenceItem.id == ev[0])
            )).scalar_one_or_none()
            if row:
                await self.db.delete(row)
        await self.db.delete(material)
        await self.db.commit()

        # 删除物理文件（失败只记日志，不影响 DB 一致性）
        if material.stored_path:
            try:
                p = safe_resolve_within(STORAGE_ROOT, Path(material.stored_path))
                if p.exists():
                    p.unlink()
            except Exception:  # noqa: BLE001
                pass
        return {
            "deleted": True,
            "cascaded": {"chunks": len(chunks), "facts": len(facts), "evidence": len(evs)},
        }
