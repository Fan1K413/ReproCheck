"""数据文件解析器（第二阶段）：CSV / XLSX。

只做元信息分析，绝不把完整数据送进模型：行列数、字段名、抽样类型推断、
缺失值统计、重复行统计、文件大小与 sha256。
"""
from __future__ import annotations

import csv
import hashlib
import json
from itertools import islice
from pathlib import Path
from typing import Any

from app.schemas.parsing import DataLocator, ParseResult, SourceChunk

PARSER_VERSION = "data-v1"
SAMPLE_ROWS = 20
MAX_ROWS_FOR_DEDUP = 100_000
MISSING_TOKENS = {"", "na", "n/a", "null", "none", "nan", "<na>"}


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in MISSING_TOKENS


def _is_int(value: str) -> bool:
    try:
        int(value.strip())
        return True
    except (ValueError, TypeError):
        return False


def _is_float(value: str) -> bool:
    try:
        float(value.strip())
        return True
    except (ValueError, TypeError):
        return False


def _is_bool(value: str) -> bool:
    return value.strip().lower() in {"true", "false", "0", "1", "yes", "no", "t", "f"}


def _infer_type(values: list[str]) -> str:
    vals = [v for v in values if not _is_missing(v)]
    if not vals:
        return "str"
    if all(_is_bool(v) for v in vals):
        return "bool"
    if all(_is_int(v) for v in vals):
        return "int"
    if all(_is_float(v) for v in vals):
        return "float"
    return "str"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _build_result(
    *,
    summary: dict[str, Any],
    material_id: str,
    project_id: str,
    kind: str,
) -> ParseResult:
    """把元信息 summary 文本化为一个 DataLocator chunk，不含完整数据。"""
    content = json.dumps(summary, ensure_ascii=False, indent=2, default=str)
    locator = DataLocator(
        sheet_name=summary.get("sheet_name"),
        column_name=None,
        row_count=int(summary.get("row_count", 0) or 0),
    )
    chunk = SourceChunk(
        chunk_id=f"dat_{material_id}_001",
        project_id=project_id,
        material_id=material_id,
        material_type=kind,
        chunk_index=0,
        content=content,
        content_hash=SourceChunk.make_hash(content),
        parser_version=PARSER_VERSION,
        source_locator=locator.model_dump(),
        token_estimate=max(1, len(content) // 4),
    )
    return ParseResult(
        material_id=material_id,
        material_type=kind,
        parser_version=PARSER_VERSION,
        status="completed",
        chunks=[chunk],
        metadata=summary,
    )


def _parse_csv(path: Path, *, material_id: str, project_id: str) -> ParseResult:
    base = dict(material_id=material_id, material_type="csv")
    try:
        with open(path, newline="", encoding="utf-8-sig") as fh:
            reader = csv.reader(fh)
            try:
                header = next(reader)
            except StopIteration:
                return ParseResult(
                    **base, parser_version=PARSER_VERSION, status="failed",
                    error_code="EMPTY_FILE", error_message="CSV 为空，无表头",
                )
            sample: list[list[str]] = []
            seen: set[tuple[str, ...]] = set()
            row_count = 0
            duplicate_count = 0
            missing_count = 0
            for row in reader:
                row_count += 1
                for cell in row:
                    if _is_missing(cell):
                        missing_count += 1
                if row_count <= MAX_ROWS_FOR_DEDUP:
                    key = tuple(row)
                    if key in seen:
                        duplicate_count += 1
                    else:
                        seen.add(key)
                if len(sample) < SAMPLE_ROWS:
                    sample.append(row)
    except (UnicodeDecodeError, OSError, csv.Error) as exc:
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="INVALID_DATA_FILE", error_message=f"CSV 读取失败：{exc}",
        )

    column_types: dict[str, str] = {}
    for idx, name in enumerate(header):
        col_values = [row[idx] for row in sample if idx < len(row)]
        column_types[name] = _infer_type(col_values)

    summary = {
        "file_name": path.name,
        "sheet_name": None,
        "row_count": row_count,
        "column_count": len(header),
        "columns": header,
        "column_types": column_types,
        "missing_values": missing_count,
        "duplicate_rows": duplicate_count,
        "sample_rows": len(sample),
        "file_size": path.stat().st_size,
        "sha256": _sha256(path),
    }
    return _build_result(summary=summary, material_id=material_id, project_id=project_id, kind="csv")


def _parse_xlsx(path: Path, *, material_id: str, project_id: str) -> ParseResult:
    base = dict(material_id=material_id, material_type="xlsx")
    try:
        from openpyxl import load_workbook
    except ImportError:
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="DATA_DEPENDENCY_MISSING",
            error_message="缺少 openpyxl 依赖，无法解析 XLSX",
        )

    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
    except Exception as exc:  # noqa: BLE001
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="INVALID_DATA_FILE", error_message=f"XLSX 读取失败：{exc}",
        )

    summary: dict[str, Any] = {
        "file_name": path.name,
        "file_size": path.stat().st_size,
        "sha256": _sha256(path),
        "sheets": [],
    }
    try:
        for ws in workbook.worksheets:
            rows_iter = ws.iter_rows(values_only=True)
            header_row = next(rows_iter, None)
            if header_row is None:
                summary["sheets"].append({
                    "sheet_name": ws.title, "row_count": 0, "column_count": 0,
                    "columns": [], "column_types": {}, "missing_values": 0,
                    "duplicate_rows": 0, "sample_rows": 0,
                })
                continue
            header = [("" if c is None else str(c)) for c in header_row]
            sample: list[tuple] = []
            seen: set[tuple] = set()
            row_count = 0
            duplicate_count = 0
            missing_count = 0
            for row in islice(rows_iter, MAX_ROWS_FOR_DEDUP):
                row_count += 1
                for cell in row:
                    if _is_missing(cell):
                        missing_count += 1
                key = tuple(row)
                if key in seen:
                    duplicate_count += 1
                else:
                    seen.add(key)
                if len(sample) < SAMPLE_ROWS:
                    sample.append(row)
            column_types: dict[str, str] = {}
            for idx, name in enumerate(header):
                col_values = [row[idx] for row in sample if idx < len(row)]
                column_types[name] = _infer_type([str(v) for v in col_values])
            summary["sheets"].append({
                "sheet_name": ws.title,
                "row_count": row_count,
                "column_count": len(header),
                "columns": header,
                "column_types": column_types,
                "missing_values": missing_count,
                "duplicate_rows": duplicate_count,
                "sample_rows": len(sample),
            })
    finally:
        workbook.close()

    # 为兼容 DataLocator，取首个 sheet 作为顶层概览
    first = summary["sheets"][0] if summary["sheets"] else {}
    summary["sheet_name"] = first.get("sheet_name")
    summary["row_count"] = first.get("row_count", 0)
    summary["column_count"] = first.get("column_count", 0)
    summary["columns"] = first.get("columns", [])
    summary["column_types"] = first.get("column_types", {})
    return _build_result(summary=summary, material_id=material_id, project_id=project_id, kind="xlsx")


def parse_data_file(
    path: Path,
    *,
    material_id: str,
    project_id: str,
    kind: str,
) -> ParseResult:
    """统一入口：按 kind 分派，只做元信息分析。"""
    if kind == "csv":
        return _parse_csv(Path(path), material_id=material_id, project_id=project_id)
    if kind == "xlsx":
        return _parse_xlsx(Path(path), material_id=material_id, project_id=project_id)
    return ParseResult(
        material_id=material_id, material_type=kind,
        parser_version=PARSER_VERSION, status="failed",
        error_code="INVALID_DATA_FILE", error_message=f"不支持的数据类型：{kind}",
    )
