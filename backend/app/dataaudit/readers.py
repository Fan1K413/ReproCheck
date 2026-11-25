"""安全只读的数据读取器。

约束：
- 只以读模式打开文件，绝不写回；
- 大文件流式分块处理（逐块读取哈希、逐行读取 CSV）；
- 统一资源上限：文件数 / 单文件字节 / 行数 / 采样数；
- 路径必须通过 safe_resolve_within 白名单解析，防路径遍历。
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterator

from app.parsers.limits import safe_resolve_within

# 资源上限（可通过 audit 覆盖）
MAX_FILES = 100
MAX_FILE_BYTES = 200 * 1024 * 1024      # 200 MB，超过则跳过并报告
MAX_ROWS_PER_FILE = 500_000             # 流式统计上限
MAX_SAMPLE_ROWS = 20_000                # 深度分析（分布/重复）采样上限
MAX_COLUMNS = 500
HASH_BLOCK = 1024 * 1024                # 哈希分块 1MB

DATA_SUFFIXES = {".csv", ".tsv", ".json", ".jsonl", ".xlsx", ".parquet"}
SPLIT_HINT = re.compile(
    r"(train|training|val|valid|validation|test|dev|holdout)", re.I
)
VERSION_HINT = re.compile(r"(?:^|[_\-vV./])(v?\d+\.\d+(?:\.\d+)?)(?:$|[_\-./])")


@dataclass
class FileMeta:
    path: str                 # 相对路径（展示用）
    abs_path: str
    size: int
    sha256: str | None = None
    suffix: str = ""
    skipped: str | None = None   # 非 None 表示被跳过及原因


@dataclass
class TableData:
    """一张表（CSV/JSONL）的结构化视图，按列组织。"""
    path: str
    columns: list[str] = field(default_factory=list)
    rows: list[dict[str, Any]] = field(default_factory=list)   # 采样行
    total_rows: int = 0
    ragged_rows: int = 0          # 列数不一致的行
    encoding_error: bool = False
    parse_error: str | None = None
    alias: str = ""               # 原始文件名（存储名被改写时用于划分识别）


def file_sha256_streaming(path: Path) -> str:
    """分块流式哈希，内存占用恒定 1MB。"""
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(HASH_BLOCK), b""):
            digest.update(block)
    return digest.hexdigest()


def collect_files(root: Path, *, base: Path | None = None,
                  max_files: int = MAX_FILES) -> list[FileMeta]:
    """递归收集 root 下的数据文件（只读元信息），带文件数与大小上限。"""
    root = safe_resolve_within(base or root, root) if base else root.resolve()
    out: list[FileMeta] = []
    if not root.exists():
        return out
    for p in sorted(root.rglob("*")):
        if len(out) >= max_files:
            break
        if not p.is_file():
            continue
        suffix = p.suffix.lower()
        # 数据文件 + 清单/说明文件都收（用于版本与来源追踪）
        if suffix not in DATA_SUFFIXES and p.name.lower() not in (
            "manifest.json", "readme.md", "readme.txt", "dataset_card.md"
        ):
            continue
        size = p.stat().st_size
        rel = str(p.relative_to(root)) if p.is_relative_to(root) else p.name
        meta = FileMeta(path=rel, abs_path=str(p), size=size, suffix=suffix)
        if size > MAX_FILE_BYTES:
            meta.skipped = f"文件超过 {MAX_FILE_BYTES // (1024*1024)}MB 上限"
        out.append(meta)
    return out


def read_csv_streaming(path: Path, *, max_rows: int = MAX_ROWS_PER_FILE,
                       sample_rows: int = MAX_SAMPLE_ROWS,
                       delimiter: str | None = None) -> TableData:
    """流式读取 CSV：全量计数 + 采样行，不把整文件载入内存。"""
    table = TableData(path=str(path))
    try:
        with open(path, newline="", encoding="utf-8-sig", errors="replace") as fh:
            sample_text = fh.read(65536)
            fh.seek(0)
            if delimiter is None:
                try:
                    dialect = csv.Sniffer().sniff(sample_text, delimiters=",\t;")
                    delimiter = dialect.delimiter
                except csv.Error:
                    delimiter = "\t" if path.suffix.lower() == ".tsv" else ","
            reader = csv.reader(fh, delimiter=delimiter)
            header = next(reader, None)
            if header is None:
                table.parse_error = "EMPTY_FILE"
                return table
            header = [h.strip() for h in header]
            if len(header) > MAX_COLUMNS:
                table.parse_error = f"TOO_MANY_COLUMNS({len(header)})"
                return table
            table.columns = header
            for row in reader:
                table.total_rows += 1
                if len(row) != len(header):
                    table.ragged_rows += 1
                if len(table.rows) < sample_rows:
                    rec = {}
                    for i, col in enumerate(header):
                        rec[col] = row[i] if i < len(row) else None
                    table.rows.append(rec)
                if table.total_rows >= max_rows:
                    break
    except UnicodeDecodeError:
        table.encoding_error = True
        table.parse_error = "ENCODING_ERROR"
    except (OSError, csv.Error) as exc:
        table.parse_error = f"READ_ERROR:{exc}"
    return table


def read_jsonl_streaming(path: Path, *, max_rows: int = MAX_ROWS_PER_FILE,
                         sample_rows: int = MAX_SAMPLE_ROWS) -> TableData:
    """流式读取 JSONL。"""
    table = TableData(path=str(path))
    keys: list[str] = []
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                table.total_rows += 1
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    table.ragged_rows += 1
                    continue
                if isinstance(obj, dict):
                    for k in obj:
                        if k not in keys:
                            keys.append(k)
                    if len(table.rows) < sample_rows:
                        table.rows.append(obj)
                if table.total_rows >= max_rows:
                    break
    except OSError as exc:
        table.parse_error = f"READ_ERROR:{exc}"
    table.columns = keys[:MAX_COLUMNS]
    return table


def iter_chunks(seq: list[Any], size: int) -> Iterator[list[Any]]:
    for i in range(0, len(seq), size):
        yield seq[i:i + size]


def infer_split_name(path_str: str) -> str | None:
    """从路径推断数据划分（train/val/test）。"""
    m = SPLIT_HINT.search(path_str.replace("\\", "/"))
    return m.group(1).lower() if m else None


def split_of(td: "TableData", fallback: str = "") -> str | None:
    """推断表的划分名：优先用原始文件名 alias（存储名被改写的场景）。"""
    return infer_split_name(td.alias or fallback or td.path)


def infer_dataset_version(paths: list[str]) -> str | None:
    """从路径集合识别数据集版本（取第一个匹配）。"""
    for p in paths:
        m = VERSION_HINT.search(p)
        if m:
            return m.group(1)
    return None


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    return str(value).strip().lower() in {
        "", "na", "n/a", "null", "none", "nan", "<na>", "-"
    }
