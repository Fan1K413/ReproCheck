"""配置文件解析器（第二阶段）：yaml / json / toml / requirements。

- YAML 必须用 yaml.safe_load，禁止 yaml.load / 自定义构造器（防反序列化攻击）。
- JSON 用 json.loads；TOML 用内置 tomllib；requirements 逐行文本解析。
- 递归遍历嵌套结构，保留原始字段路径与原始 key；语义标签通过 field_path
  前缀体现，如 "learning_rate@train.optimizer.lr"，不丢失嵌套信息。
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.parsers._common import semantic_label
from app.schemas.parsing import ConfigLocator, ParseResult, SourceChunk

PARSER_VERSION = "config-v1"
SUPPORTED_KINDS = {"yaml", "json", "toml", "requirements"}


def _find_line_number(text: str, key: str) -> int | None:
    """尽力从原文中定位 key 出现的行号（取第一次匹配）。"""
    pattern = re.compile(r'^\s*["\']?' + re.escape(key) + r'["\']?\s*[:=]', re.MULTILINE)
    match = pattern.search(text)
    if not match:
        return None
    return text.count("\n", 0, match.start()) + 1


def _value_text(value: Any) -> str:
    """把叶子值转成可读原文片段。"""
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    return str(value)


def parse_config_text(
    text: str,
    *,
    kind: str,
    file_path: str,
    material_id: str,
    project_id: str,
) -> ParseResult:
    """从内存字符串解析配置（ZIP 内文件与单文件共享此逻辑）。"""
    base = dict(material_id=material_id, material_type=kind)
    if kind not in SUPPORTED_KINDS:
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="INVALID_CONFIG", error_message=f"不支持的配置类型：{kind}",
        )

    # 1) 按 kind 解析为 Python 对象；解析异常统一归为 INVALID_CONFIG
    try:
        if kind == "yaml":
            import yaml  # 延迟导入，缺依赖时也能返回规范错误
            data = yaml.safe_load(text)  # 强制 safe_load，拒绝 !!python/object 等标签
        elif kind == "json":
            data = json.loads(text)
        elif kind == "toml":
            import tomllib
            data = tomllib.loads(text)
        else:  # requirements
            data = None
    except Exception as exc:  # noqa: BLE001 - 解析库异常统一封装
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="INVALID_CONFIG",
            error_message=f"{kind} 解析失败：{type(exc).__name__}: {exc}",
        )

    chunks: list[SourceChunk] = []
    leaves: list[dict[str, Any]] = []
    seq = 1

    def add_leaf(original_path: str, original_key: str, value: Any, line: int | None, content: str) -> None:
        nonlocal seq
        semantic = semantic_label(original_key)
        field_path = f"{semantic}@{original_path}" if semantic else original_path
        locator = ConfigLocator(
            file_path=file_path,
            field_path=field_path,
            original_key=original_key,
            line_number=line,
        )
        chunks.append(SourceChunk(
            chunk_id=f"cfg_{material_id}_{seq:03d}",
            project_id=project_id,
            material_id=material_id,
            material_type=kind,
            chunk_index=seq - 1,
            content=content,
            content_hash=SourceChunk.make_hash(content),
            parser_version=PARSER_VERSION,
            source_locator=locator.model_dump(),
            token_estimate=max(1, len(content) // 4),
        ))
        leaves.append({
            "field_path": field_path,
            "original_path": original_path,
            "original_key": original_key,
            "semantic_label": semantic,
            "line_number": line,
            "raw_value": _value_text(value) if kind != "requirements" else content,
        })
        seq += 1

    if kind == "requirements":
        for line_no, raw in enumerate(text.splitlines(), 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            line = line.split("#", 1)[0].strip()
            if not line:
                continue
            match = re.match(r"^([A-Za-z0-9_.\-]+)", line)
            package = match.group(1) if match else line
            add_leaf(package, package, line, line_no, raw.strip())
    else:
        def walk(obj: Any, path_parts: list[str], leaf_key: str) -> None:
            if isinstance(obj, dict):
                for key, value in obj.items():
                    walk(value, path_parts + [str(key)], str(key))
            elif isinstance(obj, list):
                for idx, value in enumerate(obj):
                    walk(value, path_parts + [f"[{idx}]"], leaf_key)
            else:
                original_path = ".".join(path_parts)
                line = _find_line_number(text, leaf_key)
                content = f"{leaf_key}: {_value_text(obj)}"
                add_leaf(original_path, leaf_key, obj, line, content)

        if data is not None:
            walk(data, [], "")

    if not chunks:
        return ParseResult(
            **base, parser_version=PARSER_VERSION, status="failed",
            error_code="EMPTY_FILE", error_message=f"{kind} 配置中没有可提取的叶子配置项",
        )

    return ParseResult(
        **base,
        parser_version=PARSER_VERSION,
        status="completed",
        chunks=chunks,
        metadata={"kind": kind, "leaf_count": len(chunks), "leaves": leaves},
    )


def parse_config(
    path: Path,
    *,
    material_id: str,
    project_id: str,
    kind: str,
) -> ParseResult:
    """统一入口：读取配置文件后按 kind 解析。"""
    try:
        text = Path(path).read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return ParseResult(
            material_id=material_id,
            material_type=kind,
            parser_version=PARSER_VERSION,
            status="failed",
            error_code="INVALID_CONFIG",
            error_message=f"无法读取配置文件：{exc}",
        )
    return parse_config_text(
        text,
        kind=kind,
        file_path=Path(path).name,
        material_id=material_id,
        project_id=project_id,
    )
