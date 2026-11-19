"""Notebook 细胞级解析（D）：把 .ipynb 材料拆成 NotebookCell，保留执行序号与输出引用。

只读取后端已存储的材料文件/原文，绝不执行 notebook 代码。解析失败明确报错，不伪造细胞。
"""
from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access
from app.core.errors import AppError
from app.core.security import new_id
from app.models import Material
from app.models.stage6 import NotebookCell, User
from app.services.material_service import MaterialService


def _source_text(src) -> str:
    if isinstance(src, list):
        return "".join(src)
    return src or ""


async def parse_notebook(db: AsyncSession, user: User, material_id: str) -> dict:
    material = (await db.execute(select(Material).where(Material.id == material_id))).scalar_one_or_none()
    if material is None:
        raise AppError("NOT_FOUND", "材料不存在或无权访问。")
    await resolve_project_access(db, material.project_id, user)
    if material.material_type != "notebook" and not (material.original_filename or "").lower().endswith(".ipynb"):
        raise AppError("VALIDATION_ERROR", "该材料不是 Notebook（.ipynb）。")

    raw = material.raw_text or ""
    if not raw.strip():
        svc = MaterialService(db)
        try:
            path = await svc.path_of(material)
            raw = path.read_text(encoding="utf-8", errors="replace")
        except AppError:
            raw = ""
    try:
        nb = json.loads(raw)
        cells = nb.get("cells")
        if not isinstance(cells, list):
            raise ValueError("缺少 cells 数组")
    except (ValueError, json.JSONDecodeError) as exc:
        raise AppError("VALIDATION_ERROR", f"Notebook 解析失败：{exc}") from exc

    # 幂等：先清理旧细胞再重建
    old = (await db.execute(select(NotebookCell).where(NotebookCell.material_id == material_id))).scalars().all()
    for row in old:
        await db.delete(row)

    views = []
    for idx, cell in enumerate(cells):
        ctype = cell.get("cell_type", "code")
        outputs = cell.get("outputs") or []
        row = NotebookCell(
            id=new_id("nbcell"), material_id=material_id, cell_id=str(cell.get("id", "")),
            cell_type=ctype, source=_source_text(cell.get("source")),
            execution_count=cell.get("execution_count"),
            outputs_json=json.dumps(outputs, ensure_ascii=False)[:20000],
            order_index=idx,
        )
        db.add(row)
        views.append(_cell_view(row))
    await db.commit()
    return {"material_id": material_id, "cell_count": len(views), "cells": views}


def _cell_outputs(c: NotebookCell) -> list:
    try:
        parsed = json.loads(c.outputs_json or "[]")
        return parsed if isinstance(parsed, list) else []
    except (ValueError, json.JSONDecodeError):
        # outputs_json 入库时按 20000 字符截断，可能不是完整 JSON
        return []


def _cell_view(c: NotebookCell) -> dict:
    outputs = _cell_outputs(c)
    return {
        "cell_id": c.id, "nb_cell_id": c.cell_id, "cell_type": c.cell_type,
        "source": c.source, "execution_count": c.execution_count,
        "order_index": c.order_index,
        "output_count": len(outputs),
        "outputs": outputs,
    }


async def get_notebook(db: AsyncSession, user: User, material_id: str) -> dict:
    material = (await db.execute(select(Material).where(Material.id == material_id))).scalar_one_or_none()
    if material is None:
        raise AppError("NOT_FOUND", "材料不存在或无权访问。")
    await resolve_project_access(db, material.project_id, user)
    rows = (await db.execute(select(NotebookCell).where(
        NotebookCell.material_id == material_id).order_by(NotebookCell.order_index))).scalars().all()
    if not rows:
        return await parse_notebook(db, user, material_id)
    return {"material_id": material_id, "cell_count": len(rows), "cells": [_cell_view(c) for c in rows]}