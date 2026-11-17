"""解析器注册表与统一入口。

具体解析器由各模块实现，全部遵循统一签名：
    parse(path: Path, *, material_id: str, project_id: str) -> ParseResult

registry 负责：按扩展名分派、二次扩展名校验、文件大小硬限制。
"""
from __future__ import annotations

from pathlib import Path

from app.parsers.limits import (
    ALLOWED_EXTENSIONS,
    MAX_SINGLE_FILE_BYTES,
    FileTooLargeError,
    ParserError,
    UnsupportedFormatError,
)
from app.schemas.parsing import ParseResult


def detect_material_type(filename: str) -> str:
    """按文件名判定材料类型（确定性，不看内容猜测内容语义）。"""
    lower = filename.lower()
    if lower.endswith(".pdf"):
        return "pdf"
    if lower.endswith(".py"):
        return "python"
    if lower.endswith(".ipynb"):
        return "notebook"
    if lower.endswith(".zip"):
        return "zip"
    if lower.endswith((".yaml", ".yml")):
        return "yaml"
    if lower.endswith(".json"):
        return "json"
    if lower.endswith(".toml"):
        return "toml"
    if lower == "requirements.txt" or lower.endswith(".requirements"):
        return "requirements"
    if lower.endswith((".md", ".markdown")):
        return "readme"
    if lower.endswith(".csv"):
        return "csv"
    if lower.endswith(".xlsx"):
        return "xlsx"
    if lower.endswith(".txt"):
        return "text"
    return "unknown"


def parse_file(path: Path, *, material_id: str, project_id: str) -> ParseResult:
    """统一解析入口。延迟 import 具体解析器，避免循环依赖与可选依赖缺失。"""
    name = path.name
    ext = path.suffix.lower()
    mtype = detect_material_type(name)

    if ext not in ALLOWED_EXTENSIONS and mtype == "unknown":
        raise UnsupportedFormatError(ext)

    if not path.exists() or not path.is_file():
        raise ParserError("FILE_NOT_FOUND", "文件不存在或不是普通文件")

    size = path.stat().st_size
    if size > MAX_SINGLE_FILE_BYTES:
        raise FileTooLargeError(size, MAX_SINGLE_FILE_BYTES)

    if mtype == "pdf":
        from app.parsers.pdf_parser import parse_pdf
        return parse_pdf(path, material_id=material_id, project_id=project_id)
    if mtype == "python":
        from app.parsers.python_parser import parse_python
        return parse_python(path, material_id=material_id, project_id=project_id)
    if mtype == "notebook":
        from app.parsers.notebook_parser import parse_notebook
        return parse_notebook(path, material_id=material_id, project_id=project_id)
    if mtype == "zip":
        from app.parsers.zip_parser import parse_zip
        return parse_zip(path, material_id=material_id, project_id=project_id)
    if mtype in ("yaml", "json", "toml", "requirements"):
        from app.parsers.config_parser import parse_config
        return parse_config(path, material_id=material_id, project_id=project_id, kind=mtype)
    if mtype in ("readme", "text"):
        from app.parsers.readme_parser import parse_readme
        return parse_readme(path, material_id=material_id, project_id=project_id)
    if mtype in ("csv", "xlsx"):
        from app.parsers.data_parser import parse_data_file
        return parse_data_file(path, material_id=material_id, project_id=project_id, kind=mtype)

    raise UnsupportedFormatError(ext)
