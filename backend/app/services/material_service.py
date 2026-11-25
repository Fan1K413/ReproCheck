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
from urllib.parse import urlparse

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import BACKEND_DIR, BACKEND_STORAGE
from app.core.errors import AppError
from app.models import ExtractedFact, Material, Project, SourceChunk
from app.models.stage2 import EvidenceItem, FactRevision, MaterialParseRun, ParseTask
from app.models.stage6 import NotebookCell
from app.parsers.limits import (
    ALLOWED_EXTENSIONS,
    MAX_PROJECT_MATERIALS,
    MAX_SINGLE_FILE_BYTES,
    ParserError,
    safe_resolve_within,
)

STORAGE_ROOT = (BACKEND_STORAGE / "materials").resolve()
_LEGACY_STORAGE_ROOT = (BACKEND_DIR.parent / "storage" / "materials").resolve()


def _resolve_stored_path(stored_path: str) -> Path:
    path = Path(stored_path)
    try:
        return safe_resolve_within(STORAGE_ROOT, path)
    except ParserError:
        return safe_resolve_within(_LEGACY_STORAGE_ROOT, path)


def _safe_filename(name: str) -> str:
    """净化文件名：去路径成分、危险字符，避免路径穿越与恶意文件名。"""
    name = os.path.basename(name or "")
    name = name.replace("\\", "_").replace("/", "_")
    name = re.sub(r"[\x00-\x1f]", "_", name)
    name = re.sub(r"[<>:\"|?*]", "_", name).strip(" .")
    if len(name) > 200:
        suffix = Path(name).suffix
        if suffix.lower() in ALLOWED_EXTENSIONS:
            return name[:200 - len(suffix)] + suffix
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

    async def upload(
        self, project_id: str, filename: str, data: bytes, *, commit: bool = True,
    ) -> Material:
        if len(data) > MAX_SINGLE_FILE_BYTES:
            raise AppError("VALIDATION_ERROR", "单个材料文件超过 20 MiB。", status_code=413)
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

        digest = hashlib.sha256(data).hexdigest()
        # 同项目内哈希去重：复用已存在材料，不重复解析
        dup = (await self.db.execute(
            select(Material).where(
                Material.project_id == project_id, Material.sha256 == digest
            )
        )).scalar_one_or_none()
        if dup is not None:
            return dup

        count = (await self.db.execute(
            select(Material.id).where(Material.project_id == project_id)
        )).all()
        if len(count) >= MAX_PROJECT_MATERIALS:
            raise AppError("VALIDATION_ERROR", f"单项目材料数已达上限 {MAX_PROJECT_MATERIALS}。")

        project_dir = STORAGE_ROOT / project_id
        project_dir.mkdir(parents=True, exist_ok=True)
        material_id = f"mat-{uuid.uuid4().hex[:16]}"
        stored = project_dir / f"{material_id}{ext}"
        stored = safe_resolve_within(STORAGE_ROOT, stored)
        from app.parsers.registry import detect_material_type
        mtype = detect_material_type(safe_name)
        material = Material(
            id=material_id, project_id=project_id, source_name=safe_name,
            original_filename=safe_name, stored_path=str(stored),
            material_type=mtype, file_size_bytes=len(data), sha256=digest,
            mime_type=mimetypes.guess_type(safe_name)[0] or "application/octet-stream",
            parse_status="uploaded", raw_text="",
        )
        try:
            stored.write_bytes(data)
            self.db.add(material)
            if commit:
                await self.db.commit()
            else:
                await self.db.flush()
        except BaseException:
            stored.unlink(missing_ok=True)
            raise
        if commit:
            await self.db.refresh(material)
        return material

    async def link_repository(self, project_id: str, url: str, name: str = "") -> Material:
        """登记代码仓库链接：仅保存地址引用，不下载仓库、不执行代码。

        复用既有 materials 表，不改表结构；material_type=code_repository 让前端
        能在材料清单里把它与可解析文件区分开。
        """
        project = (await self.db.execute(
            select(Project).where(Project.id == project_id)
        )).scalar_one_or_none()
        if project is None:
            raise AppError("NOT_FOUND", "项目不存在。")

        raw_url = (url or "").strip()
        parsed = urlparse(raw_url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise AppError("VALIDATION_ERROR", "请填写以 http:// 或 https:// 开头的代码仓库地址。")
        if parsed.username or parsed.password:
            raise AppError("VALIDATION_ERROR", "仓库地址里不应包含账号或密码。")

        count = (await self.db.execute(
            select(Material.id).where(Material.project_id == project_id)
        )).all()
        if len(count) >= MAX_PROJECT_MATERIALS:
            raise AppError("VALIDATION_ERROR", f"单项目材料数已达上限 {MAX_PROJECT_MATERIALS}。")

        digest = hashlib.sha256(raw_url.encode("utf-8")).hexdigest()
        dup = (await self.db.execute(
            select(Material).where(
                Material.project_id == project_id, Material.sha256 == digest
            )
        )).scalar_one_or_none()
        if dup is not None:
            return dup

        display = (name or "").strip()
        if not display:
            host = parsed.netloc
            path = parsed.path.strip("/")
            display = f"{host}/{path}" if path else host
        source = _safe_filename(display)
        material = Material(
            id=f"mat-{uuid.uuid4().hex[:16]}", project_id=project_id,
            source_name=source[:200], original_filename=source[:200],
            material_type="code_repository", raw_text=raw_url,
            file_size_bytes=0, sha256=digest, mime_type="text/uri-list",
            parse_status="uploaded", stored_path=None,
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
        p = _resolve_stored_path(material.stored_path)
        if not p.exists():
            raise AppError("NOT_FOUND", "材料文件已丢失。")
        return p

    async def delete(self, material_id: str, *, commit: bool = True) -> dict:
        material = await self.get(material_id)
        stored_path = material.stored_path
        fact_ids = select(ExtractedFact.fact_id).where(ExtractedFact.material_id == material_id)
        await self.db.execute(delete(FactRevision).where(FactRevision.fact_id.in_(fact_ids)))
        evidence = await self.db.execute(delete(EvidenceItem).where(
            (EvidenceItem.material_id == material_id) | EvidenceItem.fact_id.in_(fact_ids),
        ))
        facts = await self.db.execute(delete(ExtractedFact).where(ExtractedFact.material_id == material_id))
        chunks = await self.db.execute(delete(SourceChunk).where(SourceChunk.material_id == material_id))
        for model in (ParseTask, MaterialParseRun, NotebookCell):
            await self.db.execute(delete(model).where(model.material_id == material_id))
        await self.db.execute(delete(Material).where(Material.id == material_id))
        if commit:
            await self.db.commit()
            self.remove_file(stored_path)
        return {
            "deleted": True,
            "cascaded": {"chunks": chunks.rowcount, "facts": facts.rowcount, "evidence": evidence.rowcount},
        }

    @staticmethod
    def remove_file(stored_path: str | None) -> None:
        if stored_path:
            try:
                p = _resolve_stored_path(stored_path)
                p.unlink(missing_ok=True)
            except (OSError, ParserError):
                pass
