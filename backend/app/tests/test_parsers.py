"""第二阶段多格式解析引擎测试。

所有断言基于 backend/test_materials/stage2 下的合成测试材料。
覆盖：正常解析、定位结构类型、content_hash、chunk_id 唯一、页码区分、
行号准确性、不执行用户代码、ZIP 安全、YAML safe_load、数据元信息、失败路径。
"""
from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path

import pytest

from app.parsers import limits
from app.parsers.chunking import split_text
from app.parsers.registry import parse_file
from app.schemas.parsing import (
    CodeLocator,
    ConfigLocator,
    DataLocator,
    DocLocator,
    PdfLocator,
    SourceChunk,
)

MATERIALS = Path(__file__).resolve().parents[2] / "test_materials" / "stage2"
MID = "test_mid"
PID = "test_pid"


def parse(name: str):
    return parse_file(MATERIALS / name, material_id=MID, project_id=PID)


def assert_common(result, chunks, *, material_type=None, locator_cls=None):
    assert result.material_id == MID
    assert result.status == "completed"
    assert result.error_code is None
    assert chunks
    ids = [c.chunk_id for c in chunks]
    assert len(ids) == len(set(ids)), "chunk_id 必须唯一"
    for c in chunks:
        assert c.project_id == PID
        if material_type is not None:
            assert c.material_type == material_type
        assert c.content_hash == SourceChunk.make_hash(c.content)
        assert c.material_id == MID
        if locator_cls is not None:
            locator_cls(**c.source_locator)  # 必须能用对应 Pydantic 模型重建


# Python

def test_python_parser_basic_and_no_execution():
    result = parse("sample_project.py")
    assert_common(result, result.chunks, material_type="python", locator_cls=CodeLocator)
    assert result.parser_version == "python-ast-v1"

    # 模块顶层的 raise RuntimeError 若被执行，解析必然失败；这里成功即证明只做静态解析
    assert result.error_code is None
    assert any(chunk.content.strip().startswith("import ") for chunk in result.chunks)

    meta = result.metadata
    assert "train" in {f["name"] for f in meta["functions"]}
    assert "main" in {f["name"] for f in meta["functions"]}
    assert any(e["type"] == "__main__" for e in meta["entry_points"])
    assert any(a["flag"] == "--lr" and a["default"] == "0.001" for a in meta["argparse_defaults"])


def test_python_line_number_matches_lr_assignment():
    source = (MATERIALS / "sample_project.py").read_text(encoding="utf-8")
    expected_line = next(
        i for i, line in enumerate(source.splitlines(), 1)
        if line.strip() == "lr = 0.001"
    )
    result = parse("sample_project.py")

    params = [p for p in result.metadata["key_parameters"] if p["field"] == "lr"]
    assert params
    assert params[0]["semantic_label"] == "learning_rate"
    assert params[0]["raw_value"] == "0.001"
    assert params[0]["start_line"] == expected_line

    lr_chunks = [c for c in result.chunks if c.source_locator.get("symbol") == "lr"]
    assert lr_chunks
    assert lr_chunks[0].source_locator["start_line"] == expected_line
    assert lr_chunks[0].source_locator["end_line"] == expected_line
    assert lr_chunks[0].source_locator["file_path"] == "sample_project.py"


def test_python_syntax_error_not_fabricated():
    result = parse("broken.py")
    assert result.status == "failed"
    assert result.error_code == "PYTHON_SYNTAX_ERROR"
    assert "行" in result.error_message
    assert result.chunks == []


# Notebook

def test_notebook_markdown_and_code_cells():
    result = parse("sample.ipynb")
    assert_common(result, result.chunks, material_type="notebook", locator_cls=CodeLocator)
    assert result.parser_version == "notebook-v1"

    code = [c for c in result.chunks if c.source_locator["symbol"].startswith("cell_")]
    markdown = [c for c in result.chunks if c.source_locator["symbol"].startswith("md_cell_")]
    assert code and markdown
    assert result.metadata["code_cells"] == [1, 2]
    assert result.metadata["markdown_cells"] == [0]
    for c in code + markdown:
        assert c.source_locator["cell_index"] in (0, 1, 2)
        assert c.source_locator["file_path"] == "sample.ipynb"


def test_notebook_invalid_json():
    result = parse("broken.ipynb")
    assert result.status == "failed"
    assert result.error_code == "INVALID_NOTEBOOK"
    assert result.chunks == []


# Config

@pytest.mark.parametrize("name,kind", [
    ("config.yaml", "yaml"),
    ("config.json", "json"),
    ("config.toml", "toml"),
    ("requirements.txt", "requirements"),
])
def test_config_parsers(name, kind):
    result = parse(name)
    assert_common(result, result.chunks, material_type=kind, locator_cls=ConfigLocator)
    assert result.parser_version == "config-v1"
    for c in result.chunks:
        assert c.source_locator["file_path"] == name
        assert c.source_locator["field_path"]
        assert c.source_locator["original_key"]


def test_yaml_nested_field_path_with_semantic_label():
    result = parse("config.yaml")
    paths = {item["field_path"] for item in result.metadata["leaves"]}
    assert "learning_rate@train.optimizer.lr" in paths
    assert "batch_size@train.batch_size" in paths
    lr = next(c for c in result.chunks if c.source_locator["original_key"] == "lr")
    assert lr.source_locator["field_path"] == "learning_rate@train.optimizer.lr"
    assert lr.source_locator["line_number"] is not None


def test_yaml_safe_load_rejects_python_object():
    result = parse("unsafe.yaml")
    assert result.status == "failed"
    assert result.error_code == "INVALID_CONFIG"
    assert result.chunks == []
    assert "python/object" in result.error_message or "constructor" in result.error_message


def test_requirements_line_numbers():
    result = parse("requirements.txt")
    lines = (MATERIALS / "requirements.txt").read_text(encoding="utf-8").splitlines()
    for item in result.metadata["leaves"]:
        if item["original_key"].lower() in {"torch", "numpy", "pyyaml"}:
            assert lines[item["line_number"] - 1].lower().startswith(item["original_key"].lower())


# README

def test_readme_sections_and_commands_stored_not_executed():
    result = parse("README.md")
    assert_common(result, result.chunks, material_type="readme", locator_cls=DocLocator)
    assert result.parser_version == "readme-v1"
    assert "环境安装" in result.metadata["sections"]
    assert "训练命令" in result.metadata["sections"]
    commands = [c["text"] for c in result.metadata["commands"]]
    assert any("CUDA_VISIBLE_DEVICES" in cmd for cmd in commands)
    assert any("pip install" in cmd for cmd in commands)
    # 命令原文被保存进 chunk，但没有任何执行行为
    assert any("python train.py" in c.content for c in result.chunks)


def test_readme_encoding_error(tmp_path):
    bad = tmp_path / "bad.md"
    bad.write_bytes(b"\xff\xfe\x00invalid utf8")
    result = parse_file(bad, material_id=MID, project_id=PID)
    assert result.status == "failed"
    assert result.error_code == "ENCODING_ERROR"
    assert result.chunks == []


# PDF

def test_pdf_three_page_numbers_and_sections():
    result = parse("sample.pdf")
    assert_common(result, result.chunks, material_type="pdf", locator_cls=PdfLocator)
    assert result.parser_version == "pdf-v1"

    assert result.metadata["page_count"] == 3
    assert result.metadata["printed_pages"] == {"0": 1, "1": 2, "2": 3}
    assert result.metadata["table_pages"] == [1]
    assert "Abstract" in result.metadata["sections"]

    for c in result.chunks:
        loc = c.source_locator
        assert loc["page_index"] in (0, 1, 2)
        assert loc["viewer_page_number"] == loc["page_index"] + 1
        assert loc["printed_page_number"] in (1, 2, 3)
        assert loc["page_number_source"] == "printed"
        assert loc["bbox"] and len(loc["bbox"]) == 4
        assert re.match(rf"pdf_{MID}_p\d{{3}}_b\d{{2}}", c.chunk_id)


def test_empty_pdf_gets_ocr_flag(tmp_path):
    import fitz

    doc = fitz.open()
    doc.new_page(width=200, height=200)  # 无文本页
    path = tmp_path / "scanned.pdf"
    doc.save(str(path))
    doc.close()

    result = parse_file(path, material_id=MID, project_id=PID)
    assert result.status == "failed"
    assert result.needs_ocr is True
    assert "OCR" in result.error_message
    assert result.chunks == []
    assert any(w.code == "EMPTY_PAGE" for w in result.warnings)


# ZIP

def test_zip_normal_parse():
    result = parse("bundle_ok.zip")
    # ZIP 子 chunk 保留各自原始 material_type（readme/yaml/python...），故不传 material_type
    assert_common(result, result.chunks)
    assert result.material_type == "zip"
    assert result.parser_version == "zip-v1"
    assert all(c.chunk_id.startswith(f"zip_{MID}_") for c in result.chunks)

    manifest = result.metadata["file_manifest"]
    assert isinstance(manifest, list)
    assert any(m["name"] == "scripts/train.py" and m["status"] == "parsed" for m in manifest)
    # 子文件保留各自定位结构
    locator_symbols = {
        c.source_locator.get("symbol") or c.source_locator.get("field_path")
        or c.source_locator.get("section") for c in result.chunks
    }
    assert locator_symbols


def test_zip_path_traversal_rejected():
    result = parse("bundle.zip")
    assert result.status == "failed"
    assert result.error_code == "SUSPICIOUS_ARCHIVE"
    assert "路径穿越" in result.error_message
    assert result.chunks == []  # 绝不部分解压


def test_zip_bomb_rejected(monkeypatch):
    monkeypatch.setattr(limits, "MAX_ZIP_TOTAL_UNCOMPRESSED", 10)
    result = parse("bundle_ok.zip")
    assert result.status == "failed"
    assert result.error_code == "SUSPICIOUS_ARCHIVE"
    assert result.chunks == []


def test_zip_blocked_extension_and_ignored_dir(tmp_path):
    archive = tmp_path / "mixed.zip"
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("README.md", "# 合成测试材料\n\n安全解析正文。")
        zf.writestr("payload.exe", "SYNTHETIC BINARY")
        zf.writestr("__pycache__/cached.py", "x = 1")
    result = parse_file(archive, material_id=MID, project_id=PID)
    assert result.status == "completed"
    codes = {w.code for w in result.warnings}
    assert "ZIP_BLOCKED_EXTENSION" in codes
    assert "ZIP_IGNORED_DIR" in codes
    statuses = {m["name"]: m["status"] for m in result.metadata["file_manifest"]}
    assert statuses["payload.exe"] == "skipped"
    assert statuses["__pycache__/cached.py"] == "skipped"


# Data

def test_csv_metadata_statistics():
    result = parse("data.csv")
    assert_common(result, result.chunks, material_type="csv", locator_cls=DataLocator)
    assert result.parser_version == "data-v1"
    meta = result.metadata
    assert meta["row_count"] == 5
    assert meta["column_count"] == 5
    assert meta["missing_values"] == 2
    assert meta["duplicate_rows"] == 1
    assert meta["column_types"]["learning_rate"] == "float"
    assert meta["column_types"]["id"] == "int"
    assert len(meta["sha256"]) == 64
    # summary 只含元信息，不含完整数据行
    assert "1,0.001,64" not in result.chunks[0].content


def test_xlsx_metadata_statistics():
    result = parse("sample.xlsx")
    assert_common(result, result.chunks, material_type="xlsx", locator_cls=DataLocator)
    sheet = result.metadata["sheets"][0]
    assert sheet["sheet_name"] == "train"
    assert sheet["row_count"] == 4
    assert sheet["missing_values"] == 1
    assert sheet["duplicate_rows"] == 1


# Chunking

def test_split_text_basic_and_overlap():
    assert split_text("") == []
    assert split_text("short text") == ["short text"]

    text = "第一段内容。\n\n第二段内容，包含更多细节。\n\n第三段内容用于测试重叠上下文。"
    chunks = split_text(text, max_chars=18, overlap=4)
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk) <= 18
    # 相邻块保留 overlap 上下文
    for previous, current in zip(chunks, chunks[1:]):
        assert current.startswith(previous[-4:])


def test_split_text_preserves_content():
    text = "句子甲。句子乙。句子丙。句子丁。" * 6
    chunks = split_text(text, max_chars=30, overlap=5)
    assert len(chunks) > 1
    # 每个原始句子都至少出现在一个块中
    for sentence in ("句子甲", "句子乙", "句子丙", "句子丁"):
        assert any(sentence in c for c in chunks)


# Failures

def test_empty_and_broken_files_return_failed():
    assert parse("empty.md").status == "failed"
    assert parse("broken.py").error_code == "PYTHON_SYNTAX_ERROR"
    assert parse("broken.ipynb").error_code == "INVALID_NOTEBOOK"
    assert parse("unsafe.yaml").error_code == "INVALID_CONFIG"


def test_unsupported_file_raises():
    from app.parsers.limits import UnsupportedFormatError

    with pytest.raises(UnsupportedFormatError):
        parse_file(MATERIALS / "sample.exe", material_id=MID, project_id=PID)
