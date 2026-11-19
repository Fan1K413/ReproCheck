"""论文图表反向验证 API（第六阶段 Wave E）。

路由由 app/api/__init__.py 统一挂载并附加项目隔离依赖，本模块只声明端点。
只读取数据库中真实存在的 SourceChunk / Material，不生成模拟数据。
"""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models import Material, SourceChunk
from app.models.stage6 import User
from app.services.chart_verification_service import verify_bundle

router = APIRouter(tags=["chart-verification"])

# 代码类材料：用 ast 分析其中的绘图调用
_CODE_MATERIAL_TYPES = {"python", "notebook", "zip"}
# 结果类材料：从中提取真实指标数值
_RESULT_MATERIAL_TYPES = {"csv", "json", "xlsx", "text", "readme"}


def _parse_locator(raw: str | None, chunk: SourceChunk) -> dict:
    """解析文本块定位信息；损坏的 JSON 不抛异常，只回退到模型字段。"""
    locator: dict = {}
    if raw:
        try:
            loaded = json.loads(raw)
            if isinstance(loaded, dict):
                locator = dict(loaded)
        except (json.JSONDecodeError, TypeError, ValueError):
            locator = {}
    if chunk.chunk_id:
        locator.setdefault("chunk_id", chunk.chunk_id)
    if chunk.page_number is not None:
        locator.setdefault("page_number", chunk.page_number)
    if chunk.line_number is not None:
        locator.setdefault("line_number", chunk.line_number)
    if chunk.material_id:
        locator.setdefault("material_id", chunk.material_id)
    return locator


@router.post("/projects/{project_id}/chart-verification")
async def run_chart_verification(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """对该项目的真实材料执行图表反向验证，返回纯程序化证据与结论。"""
    # 以 Material.project_id 反查，避免历史 chunk 的 project_id 为空造成越界读取
    chunk_rows = (await db.execute(
        select(SourceChunk)
        .join(Material, SourceChunk.material_id == Material.id)
        .where(Material.project_id == project_id)
        .order_by(SourceChunk.chunk_index, SourceChunk.id)
    )).scalars().all()

    chunks: list[str] = []
    locators: list[dict] = []
    by_material: dict[str, list[str]] = {}
    for chunk in chunk_rows:
        text = chunk.original_text or ""
        chunks.append(text)
        locators.append(_parse_locator(chunk.source_locator_json, chunk))
        by_material.setdefault(chunk.material_id, []).append(text)

    materials = (await db.execute(
        select(Material).where(Material.project_id == project_id)
        .order_by(Material.created_at, Material.id)
    )).scalars().all()

    code_texts: dict[str, str] = {}
    material_texts: dict[str, str] = {}
    for material in materials:
        # 上传文件的原文落在 SourceChunk；部分记录直接带 raw_text，两者都以库内真实内容为准
        text = material.raw_text or "\n".join(by_material.get(material.id, []))
        if not text.strip():
            continue
        if material.material_type in _CODE_MATERIAL_TYPES:
            code_texts[material.source_name] = text
        if material.material_type in _RESULT_MATERIAL_TYPES:
            material_texts[material.source_name] = text

    result = verify_bundle(chunks, locators, code_texts, material_texts)
    return ok(result, getattr(request.state, "request_id", "-"))
