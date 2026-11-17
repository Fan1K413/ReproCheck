"""Jupyter Notebook 解析器（第二阶段）。

用标准库 json 读取 .ipynb，绝不执行任何 cell。
区分 markdown / code cell；两者都生成 chunk，但用 symbol 前缀与 metadata 明确区分。
"""
from __future__ import annotations

import json
from pathlib import Path

from app.schemas.parsing import CodeLocator, ParseResult, SourceChunk

PARSER_VERSION = "notebook-v1"


def _cell_source(cell: dict) -> str:
    source = cell.get("source", "")
    if isinstance(source, list):
        return "".join(str(piece) for piece in source)
    return str(source or "")


def parse_notebook_text(
    data: dict,
    *,
    file_path: str,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """从已解析的 notebook dict 生成 ParseResult（单文件与 ZIP 共享）。"""
    base = dict(material_id=material_id)
    cells = data.get("cells")
    if not isinstance(cells, list):
        return ParseResult(
            **base,
            material_type="notebook",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="INVALID_NOTEBOOK",
            error_message="notebook 缺少合法的 cells 数组",
        )

    chunks: list[SourceChunk] = []
    cell_types: list[str] = []
    code_cells: list[int] = []
    markdown_cells: list[int] = []
    seq = 1

    for index, cell in enumerate(cells):
        if not isinstance(cell, dict):
            continue
        ctype = str(cell.get("cell_type", ""))
        cell_types.append(ctype)
        text = _cell_source(cell)
        if not text.strip():
            # 空 cell 不生成 chunk，但仍记录类型
            if ctype == "code":
                code_cells.append(index)
            elif ctype == "markdown":
                markdown_cells.append(index)
            continue

        lines = text.splitlines()
        start_line = 1
        end_line = max(1, len(lines))
        if ctype == "code":
            symbol = f"cell_{index}"
            code_cells.append(index)
        elif ctype == "markdown":
            symbol = f"md_cell_{index}"
            markdown_cells.append(index)
        else:
            symbol = f"{ctype}_cell_{index}"

        locator = CodeLocator(
            file_path=file_path,
            start_line=start_line,
            end_line=end_line,
            cell_index=index,
            symbol=symbol,
        )
        chunks.append(SourceChunk(
            chunk_id=f"nb_{material_id}_{seq:03d}",
            project_id=project_id,
            material_id=material_id,
            material_type="notebook",
            chunk_index=seq - 1,
            content=text,
            content_hash=SourceChunk.make_hash(text),
            parser_version=PARSER_VERSION,
            source_locator=locator.model_dump(),
            token_estimate=max(1, len(text) // 4),
        ))
        seq += 1

    if not chunks:
        return ParseResult(
            **base,
            material_type="notebook",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="EMPTY_FILE",
            error_message="notebook 中没有非空 cell",
            metadata={"cell_types": cell_types},
        )

    return ParseResult(
        **base,
        material_type="notebook",
        parser_version=PARSER_VERSION,
        status="completed",
        chunks=chunks,
        metadata={
            "nbformat": data.get("nbformat"),
            "cell_count": len(cells),
            "cell_types": cell_types,
            "code_cells": code_cells,
            "markdown_cells": markdown_cells,
        },
    )


def parse_notebook(
    path: Path,
    *,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """统一入口：读取 .ipynb 后解析。不执行任何 cell。"""
    base = dict(material_id=material_id, material_type="notebook")
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return ParseResult(
            **base,
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="INVALID_NOTEBOOK",
            error_message=f"无法读取 notebook：{exc}",
        )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        return ParseResult(
            **base,
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="INVALID_NOTEBOOK",
            error_message=f"notebook JSON 损坏（第 {exc.lineno} 行）：{exc.msg}",
        )
    if not isinstance(data, dict):
        return ParseResult(
            **base,
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="INVALID_NOTEBOOK",
            error_message="notebook 顶层必须是 JSON 对象",
        )
    return parse_notebook_text(
        data,
        file_path=Path(path).name,
        material_id=material_id,
        project_id=project_id,
    )
