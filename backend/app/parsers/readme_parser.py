"""README / Markdown / 纯文本解析器（第二阶段）。

按 Markdown 章节标题或分隔线 + 空行段落切分，保留 section 与起止行号。
识别运行命令（python train / pip install / CUDA_VISIBLE_DEVICES 等）但只保存原文，绝不执行。
"""
from __future__ import annotations

import re
from pathlib import Path

from app.parsers._common import looks_like_run_command
from app.parsers.chunking import split_text
from app.parsers.limits import MAX_CHUNK_CHARS
from app.schemas.parsing import DocLocator, ParseResult, ParseWarning, SourceChunk

PARSER_VERSION = "readme-v1"

_HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$")
_RULE_RE = re.compile(r"^\s*(?:[-=*]\s*){3,}$")


def parse_readme_text(
    text: str,
    *,
    file_path: str,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """从内存字符串解析 README（ZIP 内文件与单文件共享此逻辑）。"""
    base = dict(material_id=material_id)

    lines = text.splitlines()
    chunks: list[SourceChunk] = []
    warnings: list[ParseWarning] = []
    commands: list[dict] = []
    sections: list[str] = []

    current_section: str | None = None
    previous_nonempty: str = ""
    block_lines: list[str] = []
    block_start = 1
    block_index = 0
    seq = 1

    def flush_block(end_line: int) -> None:
        nonlocal block_lines, block_start, block_index, seq
        if not block_lines:
            return
        content = "\n".join(block_lines).strip()
        if not content:
            block_lines = []
            return
        pieces = split_text(content) if len(content) > MAX_CHUNK_CHARS else [content]
        for piece in pieces:
            locator = DocLocator(
                section=current_section,
                start_line=block_start,
                end_line=end_line,
                block_index=block_index,
            )
            chunks.append(SourceChunk(
                chunk_id=f"rd_{material_id}_{seq:03d}",
                project_id=project_id,
                material_id=material_id,
                material_type="readme",
                chunk_index=seq - 1,
                content=piece,
                content_hash=SourceChunk.make_hash(piece),
                parser_version=PARSER_VERSION,
                source_locator=locator.model_dump(),
                token_estimate=max(1, len(piece) // 4),
            ))
            seq += 1
        if len(pieces) > 1:
            warnings.append(ParseWarning(
                code="CHUNK_SPLIT_APPROX_LOCATOR",
                message="长段落经二次切分，子块行号沿用原段落起始位置（无法精确）",
                line_number=block_start,
            ))
        block_lines = []
        block_index += 1

    for idx, raw in enumerate(lines, 1):
        stripped = raw.strip()
        heading = _HEADING_RE.match(raw)
        if heading:
            flush_block(idx - 1)
            current_section = heading.group(1).strip()
            sections.append(current_section)
            previous_nonempty = stripped
            block_start = idx + 1
            continue
        if _RULE_RE.match(raw):
            flush_block(idx - 1)
            # 分隔线：用上一非空行作为章节名（若较短），否则保留当前 section
            if previous_nonempty and len(previous_nonempty) <= 80:
                current_section = previous_nonempty
                sections.append(current_section)
            block_start = idx + 1
            continue
        if not stripped:
            flush_block(idx - 1)
            block_start = idx + 1
            continue

        if not block_lines:
            block_start = idx
        block_lines.append(raw)
        if looks_like_run_command(raw):
            commands.append({
                "line": idx,
                "section": current_section,
                "text": raw.strip(),
            })
        previous_nonempty = stripped

    flush_block(len(lines))

    if not chunks:
        return ParseResult(
            **base,
            material_type="readme",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="EMPTY_FILE",
            error_message="README 中没有可提取的文本段落",
        )

    return ParseResult(
        **base,
        material_type="readme",
        parser_version=PARSER_VERSION,
        status="completed",
        chunks=chunks,
        metadata={
            "file_path": file_path,
            "line_count": len(lines),
            "sections": sections,
            "commands": commands,  # 只存原文，不执行
        },
        warnings=warnings,
    )


def parse_readme(
    path: Path,
    *,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """统一入口：utf-8 严格读取，编码失败返回 ENCODING_ERROR。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return ParseResult(
            material_id=material_id,
            material_type="readme",
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="ENCODING_ERROR",
            error_message=f"README 编码错误（需 utf-8）：{exc}",
        )
    return parse_readme_text(
        text,
        file_path=Path(path).name,
        material_id=material_id,
        project_id=project_id,
    )
