"""PDF 解析器（第二阶段）：PyMuPDF 逐 block 抽取。

三种页码严格区分：
- page_index：PDF 内部 0 基页索引；
- viewer_page_number：阅读器显示的 1 基页码；
- printed_page_number：论文正文印刷页码（从页脚文本正则推断，可能 None）。
章节行更新 current_section；表格页在 metadata 中标记；空白页记录 EMPTY_PAGE 警告。
扫描版（全页无文本）设 needs_ocr，明确不生成伪造结果。
"""
from __future__ import annotations

import re
from pathlib import Path

from app.core.pdf import PDF_ENGINE_LOCK
from app.parsers.chunking import split_text
from app.parsers.limits import MAX_CHUNK_CHARS, MAX_PDF_PAGES
from app.schemas.parsing import ParseResult, ParseWarning, PdfLocator, SourceChunk

PARSER_VERSION = "pdf-v1"

_SECTION_RE = re.compile(
    r"^\s*(?:abstract|摘要|introduction|引言|related\s+work|method(?:s|ology)?|方法|"
    r"experiment(?:s|al)?|实验|setup|results?|结果|discussion|讨论|"
    r"conclusion(?:s)?|结论|references?|参考文献|appendix|附录)",
    re.IGNORECASE,
)

# 印刷页码识别模式：第 N 页 / Page N / - N -
_PRINTED_PATTERNS = (
    re.compile(r"第\s*(\d{1,3})\s*页"),
    re.compile(r"\b(?:page|p\.)\s*[-:]?\s*(\d{1,3})\b", re.IGNORECASE),
    re.compile(r"^\s*[-–—]\s*(\d{1,3})\s*[-–—]\s*$"),
)

_NUMERIC_TABLE_LINE = re.compile(
    r"^\s*[-+]?\d+(?:\.\d+)?(?:\s+[-+]?\d+(?:\.\d+)?){2,}\s*$"
)


def _detect_printed_page(page_text: str) -> int | None:
    """从页面末尾若干行中尝试识别论文印刷页码。"""
    footer_lines = [ln for ln in page_text.splitlines()[-8:] if ln.strip()]
    for line in footer_lines:
        for pattern in _PRINTED_PATTERNS:
            match = pattern.search(line)
            if match:
                return int(match.group(1))
    return None


def _update_section(text: str, current: str | None) -> str | None:
    """扫描文本中的章节标题行，返回更新后的 section。

    仅当行首命中章节词且剩余部分是空或很短（标题行）时才更新，
    避免把 "Method: we use ..." 这类正文句子误判为章节标题。
    """
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or len(stripped) > 100:
            continue
        match = _SECTION_RE.match(stripped)
        if match:
            remainder = stripped[match.end():].strip(" :：-—")
            if len(remainder) <= 20:
                return stripped
    return current


def _is_table_page(text: str) -> bool:
    """页面文本含大量竖线或多行连续数字时，判定为表格页。"""
    if text.count("|") >= 3:
        return True
    numeric_lines = [ln for ln in text.splitlines() if _NUMERIC_TABLE_LINE.match(ln)]
    return len(numeric_lines) >= 2


def parse_pdf(
    path: Path,
    *,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """统一入口：逐页抽取文本块，生成带 PdfLocator 的 chunks。"""
    with PDF_ENGINE_LOCK:
        return _parse_pdf(path, material_id=material_id, project_id=project_id)


def _parse_pdf(path: Path, *, material_id: str, project_id: str) -> ParseResult:
    base = dict(
        material_id=material_id,
        material_type="pdf",
        parser_version=PARSER_VERSION,
    )
    try:
        import fitz  # PyMuPDF
    except ImportError:
        return ParseResult(
            **base, status="failed", error_code="PDF_DEPENDENCY_MISSING",
            error_message="缺少 PyMuPDF(fitz) 依赖，无法解析 PDF",
        )

    try:
        document = fitz.open(str(path))
    except Exception as exc:  # noqa: BLE001
        return ParseResult(
            **base, status="failed", error_code="INVALID_PDF",
            error_message=f"PDF 打开失败或文件损坏：{exc}",
        )

    chunks: list[SourceChunk] = []
    warnings: list[ParseWarning] = []
    table_pages: list[int] = []
    printed_pages: dict[str, int] = {}
    sections: list[str] = []
    current_section: str | None = None
    doc_meta: dict = {}

    try:
        page_count = document.page_count
        if document.needs_pass:
            return ParseResult(
                **base, status="failed", error_code="PDF_PASSWORD_REQUIRED",
                error_message="请上传解除密码保护后的 PDF。",
            )
        if page_count > MAX_PDF_PAGES:
            return ParseResult(
                **base, status="failed", error_code="PDF_TOO_MANY_PAGES",
                error_message=f"PDF 页数 {page_count} 超过上限 {MAX_PDF_PAGES}",
            )
        raw_meta = document.metadata or {}
        doc_meta = {str(k): (str(v) if v is not None else None) for k, v in raw_meta.items()}

        for page_index in range(page_count):
            page = document[page_index]
            page_text = page.get_text("text") or ""
            printed = _detect_printed_page(page_text)
            if printed is not None:
                printed_pages[str(page_index)] = printed
            if _is_table_page(page_text):
                table_pages.append(page_index)

            blocks = page.get_text("blocks")
            valid_blocks: list[tuple[float, float, float, float, str]] = []
            for block in blocks:
                if len(block) < 5:
                    continue
                x0, y0, x1, y1 = block[0], block[1], block[2], block[3]
                text = str(block[4] or "").strip()
                if not text:
                    continue
                current_section = _update_section(text, current_section)
                if current_section and (not sections or sections[-1] != current_section):
                    sections.append(current_section)
                valid_blocks.append((x0, y0, x1, y1, text))

            if not valid_blocks:
                warnings.append(ParseWarning(
                    code="EMPTY_PAGE",
                    message="该页无有效可提取文本（可能为空白页或图片页）",
                    page_index=page_index,
                ))
                continue

            for block_index, (x0, y0, x1, y1, text) in enumerate(valid_blocks):
                pieces = split_text(text) if len(text) > MAX_CHUNK_CHARS else [text]
                for piece_index, piece in enumerate(pieces):
                    locator = PdfLocator(
                        page_index=page_index,
                        viewer_page_number=page_index + 1,
                        printed_page_number=printed,
                        page_number_source="printed" if printed is not None else "viewer",
                        text_block_index=block_index,
                        section=current_section,
                        bbox=[float(x0), float(y0), float(x1), float(y1)],
                    )
                    suffix = f"_s{piece_index}" if len(pieces) > 1 else ""
                    chunks.append(SourceChunk(
                        chunk_id=f"pdf_{material_id}_p{page_index + 1:03d}_b{block_index:02d}{suffix}",
                        project_id=project_id,
                        material_id=material_id,
                        material_type="pdf",
                        chunk_index=len(chunks),
                        content=piece,
                        content_hash=SourceChunk.make_hash(piece),
                        parser_version=PARSER_VERSION,
                        source_locator=locator.model_dump(),
                        token_estimate=max(1, len(piece) // 4),
                    ))
    finally:
        document.close()

    if not chunks:
        return ParseResult(
            **base,
            status="failed",
            error_code="NO_EXTRACTABLE_TEXT",
            needs_ocr=True,
            error_message=(
                "未检测到可提取文本，可能需要 OCR；当前版本不提供 OCR 能力，未生成伪造结果"
            ),
            metadata={
                "page_count": locals().get("page_count", 0),
                "document_metadata": doc_meta,
            },
            warnings=warnings,
        )

    return ParseResult(
        **base,
        status="completed",
        chunks=chunks,
        metadata={
            "page_count": page_count,
            "document_metadata": doc_meta,
            "printed_pages": printed_pages,
            "table_pages": table_pages,
            "sections": sections,
        },
        warnings=warnings,
    )
