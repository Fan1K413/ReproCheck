"""统一 SourceChunk 与解析器输出契约（第二阶段核心）。

所有解析器（PDF/Python/ZIP/配置/README/CSV）最终都产出 ParseResult，
其中每个 chunk 都带 material_type 专属的 source_locator，禁止混用定位规则。
"""
from __future__ import annotations

import hashlib
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MaterialType = Literal[
    "pdf", "python", "notebook", "zip", "yaml", "json", "toml",
    "requirements", "readme", "text", "csv", "xlsx", "unknown",
]

ParseStatus = Literal[
    "uploaded", "queued", "parsing", "extracting",
    "completed", "partially_completed", "failed", "unsupported",
]

# ---------------- 定位结构：按材料类型区分，禁止强行统一 ----------------

class PdfLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    page_index: int                      # PDF 内部页索引（0 基）
    viewer_page_number: int              # 阅读器页码（1 基）
    printed_page_number: int | None = None  # 论文印刷页码（可空）
    page_number_source: Literal["printed", "viewer"] = "viewer"
    text_block_index: int = 0
    section: str | None = None
    bbox: list[float] | None = None      # [x0,y0,x1,y1] 尽可能记录

class CodeLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_path: str                       # ZIP 内相对路径或单文件名
    start_line: int
    end_line: int
    cell_index: int | None = None        # notebook 单元格
    symbol: str | None = None            # 函数名/类名

class ConfigLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_path: str
    field_path: str                      # 如 train.optimizer.lr，保留原始嵌套路径
    original_key: str                    # 原始字段名（如 lr）
    line_number: int | None = None

class DocLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: str | None = None
    start_line: int | None = None
    end_line: int | None = None
    block_index: int = 0

class DataLocator(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sheet_name: str | None = None
    column_name: str | None = None
    row_count: int = 0

SourceLocator = PdfLocator | CodeLocator | ConfigLocator | DocLocator | DataLocator


# ---------------- 统一文本块 ----------------

class SourceChunk(BaseModel):
    """标准化文本块。第一阶段 source_chunks 的超集，保持 chunk_id/original_text 兼容。"""
    model_config = ConfigDict(extra="forbid")

    chunk_id: str
    project_id: str = ""
    material_id: str
    material_type: MaterialType
    chunk_index: int = 0
    content: str                         # 对应第一阶段 original_text
    content_hash: str
    parser_version: str
    source_locator: dict[str, Any]       # 序列化后的定位结构（按类型）
    token_estimate: int = 0

    @staticmethod
    def make_hash(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()[:16]


class ParseWarning(BaseModel):
    model_config = ConfigDict(extra="forbid")
    code: str
    message: str
    page_index: int | None = None
    line_number: int | None = None


class ParseResult(BaseModel):
    """解析器统一输出。status 明确区分成功/部分成功/失败，不把上传等同于解析成功。"""
    model_config = ConfigDict(extra="forbid")

    material_id: str
    material_type: MaterialType
    parser_version: str
    status: ParseStatus
    chunks: list[SourceChunk] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    warnings: list[ParseWarning] = Field(default_factory=list)
    error_code: str | None = None
    error_message: str | None = None
    needs_ocr: bool = False

    @field_validator("metadata")
    @classmethod
    def _strip_large_values(cls, v: dict[str, Any]) -> dict[str, Any]:
        # metadata 中禁止塞入大段原文（日志/DB 膨胀），仅保留统计与定位
        return {k: (val[:200] if isinstance(val, str) and len(val) > 200 else val)
                for k, val in v.items()}


# ---------------- 解析任务 ----------------

class TaskStage(BaseModel):
    """任务当前阶段，前端展示用，来自真实 DB 状态而非前端计时器。"""
    stage: str
    status: ParseStatus
    message: str = ""


# ---------------- 事实抽取 Schema（第二阶段核心） ----------------

AssertionType = Literal["explicit", "inferred", "ambiguous", "not_found"]
ExtractionStatus = Literal["supported", "unsupported", "needs_review"]
FactType = Literal[
    "research_info", "dataset", "model", "training_parameter",
    "metric", "environment", "runtime", "experiment_process", "other",
]


class EvidenceRef(BaseModel):
    """模型给出的证据引用，quote 必须与 chunk 原文核对。"""
    model_config = ConfigDict(extra="forbid")
    chunk_id: str
    quote: str = ""


class ExtractedFactIn(BaseModel):
    """模型返回的单条事实（严格校验，extra=forbid）。"""
    model_config = ConfigDict(extra="forbid")

    fact_type: FactType
    field_key: str = Field(min_length=1, max_length=120)
    field_label: str = Field(default="", max_length=200)
    raw_value: str = Field(default="", max_length=300)
    normalized_value: str | int | float | None = None
    unit: str | None = None
    assertion_type: AssertionType = "explicit"
    evidence_refs: list[EvidenceRef] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class FactsExtractionV2(BaseModel):
    """第二阶段模型返回顶层结构。"""
    model_config = ConfigDict(extra="forbid")
    facts: list[ExtractedFactIn] = Field(default_factory=list)
