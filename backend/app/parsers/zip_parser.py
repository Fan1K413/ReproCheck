"""ZIP 压缩包解析器（第二阶段）——安全重点模块。

安全策略：
- 条目数 / 解压总量硬限制（防 ZIP Bomb）；
- 单条目过大跳过并告警；
- 路径穿越（含 .. / 绝对路径）直接判定为恶意，绝不部分解压；
- 符号链接、危险扩展名、忽略目录一律跳过并告警；
- 严禁 extractall 到磁盘，只读内容到内存字符串；
- ZIP 内代码同样只做 AST 静态解析，绝不执行。
"""
from __future__ import annotations

import json
import stat
import zipfile
from pathlib import Path
from typing import Any

from app.parsers import limits
from app.parsers.config_parser import parse_config_text
from app.parsers.notebook_parser import parse_notebook_text
from app.parsers.python_parser import parse_python_text
from app.parsers.readme_parser import parse_readme_text
from app.schemas.parsing import ParseResult, ParseWarning, SourceChunk

PARSER_VERSION = "zip-v1"


def _normalize_entry_name(name: str) -> str:
    """规范化 ZIP 条目名；发现路径穿越立即抛 SuspiciousArchiveError。"""
    norm = name.replace("\\", "/").lstrip("/")
    segments = norm.split("/")
    if any(seg == ".." for seg in segments):
        raise limits.SuspiciousArchiveError(f"检测到路径穿越条目：{name}")
    clean = [seg for seg in segments if seg not in ("", ".")]
    return "/".join(clean)


def _classify(clean_name: str) -> str | None:
    """按文件路径判定 ZIP 内材料类型。"""
    base = clean_name.rsplit("/", 1)[-1].lower()
    if base == "requirements.txt" or base.endswith(".requirements"):
        return "requirements"
    if base.endswith((".yaml", ".yml")):
        return "yaml"
    if base.endswith(".json"):
        return "json"
    if base.endswith(".toml"):
        return "toml"
    if base.endswith(".py"):
        return "python"
    if base.endswith(".ipynb"):
        return "notebook"
    if base.startswith("readme") or base.endswith((".md", ".markdown", ".txt")):
        return "readme"
    return None


def parse_zip(
    path: Path,
    *,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """统一入口：安全解析 ZIP，汇总所有可解析子文件的 chunks。"""
    base = dict(
        material_id=material_id,
        material_type="zip",
        parser_version=PARSER_VERSION,
    )
    manifest: list[dict[str, Any]] = []
    warnings: list[ParseWarning] = []
    chunks: list[SourceChunk] = []
    total_uncompressed = 0
    global_seq = 1

    def warn(code: str, message: str) -> None:
        warnings.append(ParseWarning(code=code, message=message))

    try:
        with zipfile.ZipFile(Path(path)) as zf:
            infos = zf.infolist()

            # 条目数硬限制
            if len(infos) > limits.MAX_ZIP_ENTRIES:
                raise limits.SuspiciousArchiveError(
                    f"条目数 {len(infos)} 超过上限 {limits.MAX_ZIP_ENTRIES}"
                )

            for info in infos:
                raw_name = info.filename

                # 1) 路径穿越校验（规范化 + .. 拒绝 + safe_resolve_within 双重确保）
                clean_name = _normalize_entry_name(raw_name)
                virtual_root = Path(".").resolve()
                limits.safe_resolve_within(virtual_root, virtual_root / clean_name)

                # 2) 目录条目直接跳过（不告警）
                if info.is_dir():
                    continue

                # 3) 解压总量硬限制（压缩炸弹防护）
                total_uncompressed += info.file_size
                if total_uncompressed > limits.MAX_ZIP_TOTAL_UNCOMPRESSED:
                    raise limits.SuspiciousArchiveError(
                        f"解压总量 {total_uncompressed} 字节超过上限 "
                        f"{limits.MAX_ZIP_TOTAL_UNCOMPRESSED}"
                    )

                # 4) 单条目过大：忽略并告警
                if info.file_size > limits.MAX_SINGLE_FILE_BYTES:
                    warn("ZIP_ENTRY_TOO_LARGE", f"单文件过大，已跳过：{clean_name}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": _classify(clean_name), "size": info.file_size,
                        "status": "ignored", "reason": "single_file_too_large", "chunks": 0,
                    })
                    continue

                # 5) 符号链接：跳过并告警
                if stat.S_ISLNK(info.external_attr >> 16):
                    warn("ZIP_SYMLINK_SKIPPED", f"检测到符号链接，已跳过：{clean_name}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": "symlink", "size": info.file_size,
                        "status": "skipped", "reason": "symlink", "chunks": 0,
                    })
                    continue

                # 6) 危险扩展名：跳过并告警
                suffix = Path(clean_name).suffix.lower()
                if suffix in limits.BLOCKED_EXTENSIONS:
                    warn("ZIP_BLOCKED_EXTENSION", f"危险扩展名，已跳过：{clean_name}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": suffix, "size": info.file_size,
                        "status": "skipped", "reason": "blocked_extension", "chunks": 0,
                    })
                    continue

                # 7) 忽略目录：跳过并告警
                parts = clean_name.split("/")
                if any(seg in limits.IGNORED_DIRS for seg in parts[:-1]):
                    warn("ZIP_IGNORED_DIR", f"忽略目录内文件，已跳过：{clean_name}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": _classify(clean_name), "size": info.file_size,
                        "status": "skipped", "reason": "ignored_dir", "chunks": 0,
                    })
                    continue

                # 8) 只读取内容到内存，绝不 extractall 到磁盘
                kind = _classify(clean_name)
                if kind is None:
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": "unknown", "size": info.file_size,
                        "status": "skipped", "reason": "unsupported_in_zip", "chunks": 0,
                    })
                    continue

                try:
                    raw = zf.read(info)
                    content = raw.decode("utf-8", errors="replace")
                except Exception as exc:  # noqa: BLE001
                    warn("ZIP_READ_ERROR", f"无法读取 {clean_name}：{exc}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": kind, "size": info.file_size,
                        "status": "skipped", "reason": "read_error", "chunks": 0,
                    })
                    continue

                # 9) 调用对应解析器的 text 辅助函数，file_path 设为 ZIP 内相对路径
                if kind == "python":
                    sub = parse_python_text(
                        content, file_path=clean_name,
                        material_id=material_id, project_id=project_id,
                    )
                elif kind == "readme":
                    sub = parse_readme_text(
                        content, file_path=clean_name,
                        material_id=material_id, project_id=project_id,
                    )
                elif kind in ("yaml", "json", "toml", "requirements"):
                    sub = parse_config_text(
                        content, kind=kind, file_path=clean_name,
                        material_id=material_id, project_id=project_id,
                    )
                elif kind == "notebook":
                    try:
                        nb_data = json.loads(content)
                        if not isinstance(nb_data, dict):
                            raise ValueError("notebook 顶层不是对象")
                        sub = parse_notebook_text(
                            nb_data, file_path=clean_name,
                            material_id=material_id, project_id=project_id,
                        )
                    except Exception as exc:  # noqa: BLE001
                        sub = ParseResult(
                            material_id=material_id,
                            material_type="notebook", parser_version="notebook-v1",
                            status="failed", error_code="INVALID_NOTEBOOK",
                            error_message=str(exc),
                        )
                else:  # pragma: no cover - 上面已过滤
                    continue

                if sub.status == "failed":
                    warn("ZIP_SUBFILE_PARSE_FAILED", f"子文件解析失败 {clean_name}：{sub.error_code}")
                    manifest.append({
                        "name": clean_name, "original_name": raw_name,
                        "type": kind, "size": info.file_size,
                        "status": "failed", "reason": sub.error_code, "chunks": 0,
                    })
                    continue

                # 10) 汇总子 chunks：加 zip 前缀、全局唯一编号
                for sub_chunk in sub.chunks:
                    new_chunk = sub_chunk.model_copy(update={
                        "chunk_id": f"zip_{material_id}_{global_seq:04d}",
                        "project_id": project_id,
                        "material_id": material_id,
                        "chunk_index": global_seq - 1,
                    })
                    chunks.append(new_chunk)
                    global_seq += 1
                manifest.append({
                    "name": clean_name, "original_name": raw_name,
                    "type": kind, "size": info.file_size,
                    "status": "parsed", "reason": None, "chunks": len(sub.chunks),
                })

    except limits.SuspiciousArchiveError as exc:
        # 恶意压缩包：整体失败，绝不部分解压/部分返回
        return ParseResult(
            **base,
            status="failed",
            error_code="SUSPICIOUS_ARCHIVE",
            error_message=exc.message,
            metadata={"file_manifest": manifest},
            warnings=warnings,
        )
    except zipfile.BadZipFile as exc:
        return ParseResult(
            **base, status="failed", error_code="INVALID_ZIP",
            error_message=f"ZIP 损坏：{exc}",
            metadata={"file_manifest": manifest}, warnings=warnings,
        )
    except OSError as exc:
        return ParseResult(
            **base, status="failed", error_code="INVALID_ZIP",
            error_message=f"无法读取 ZIP：{exc}",
            metadata={"file_manifest": manifest}, warnings=warnings,
        )

    if not chunks:
        return ParseResult(
            **base, status="failed", error_code="EMPTY_FILE",
            error_message="ZIP 中没有可解析的支持文件",
            metadata={"file_manifest": manifest, "total_uncompressed": total_uncompressed},
            warnings=warnings,
        )

    return ParseResult(
        **base,
        status="completed",
        chunks=chunks,
        metadata={
            "file_manifest": manifest,
            "entry_count": len(manifest),
            "total_uncompressed": total_uncompressed,
        },
        warnings=warnings,
    )
