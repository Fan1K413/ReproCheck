# Source Chunk 规范（第二阶段）

## 1. 统一结构（Pydantic 严格模型：`app/schemas/parsing.py`）

```json
{
  "chunk_id": "pdf_mat_x_p005_b02",
  "project_id": "proj_xxx",
  "material_id": "mat_xxx",
  "material_type": "pdf",
  "chunk_index": 12,
  "content": "原文文本/代码片段/配置项的原始文本",
  "content_hash": "sha256 前16位",
  "parser_version": "pdf-v1",
  "source_locator": { "...按类型...": "..." },
  "token_estimate": 0
}
```

字段说明：
- `content` 对应第一阶段数据库 `source_chunks.original_text`，**证据原文唯一来源**；
- `content_hash` 用于重复材料识别与缓存；
- `parser_version` 保证可复现（解析器升级后可知旧块出自哪版）；
- `source_locator` 是 dict，**按 material_type 使用不同结构，禁止套用统一模板**。

## 2. 分类型的定位结构

### PDF → PdfLocator
```json
{
  "page_index": 4,
  "viewer_page_number": 5,
  "printed_page_number": 128,
  "page_number_source": "printed",
  "text_block_index": 2,
  "section": "实验设置",
  "bbox": [72.0, 180.5, 540.0, 230.0]
}
```

### Python / Notebook → CodeLocator
```json
{
  "file_path": "train.py",
  "start_line": 42,
  "end_line": 45,
  "cell_index": null,
  "symbol": "build_optimizer"
}
```
Notebook 用 `cell_index` 标识单元格，`start_line/end_line` 为单元格内行号。

### YAML/JSON/TOML/requirements → ConfigLocator
```json
{
  "file_path": "config.yaml",
  "field_path": "learning_rate@train.optimizer.lr",
  "original_key": "lr",
  "line_number": 8
}
```
`field_path` 同时表达语义标签与原始嵌套路径，`original_key` 保留原始字段名，**不丢失嵌套结构**。

### README/TXT → DocLocator
```json
{
  "section": "训练命令",
  "start_line": 35,
  "end_line": 40,
  "block_index": 7
}
```

### CSV/XLSX → DataLocator
```json
{
  "sheet_name": "train",
  "column_name": "label",
  "row_count": 5000
}
```

## 3. 切分算法（chunking.py）

1. 优先按空行/自然段落切分；
2. 段落过长再按句号/换行切；
3. 最后才按字符硬切（上限 1800 字符）；
4. 相邻块保留 150 字符重叠上下文；
5. 切分后每一块都携带原始定位信息（页码/行号不丢失，取起始位置）；
6. 每块计算 content_hash，重复内容可识别。

## 4. 数据库映射

`source_chunks` 表（第一阶段表，第二阶段追加列）：
- `chunk_id` ← chunk.chunk_id（唯一约束 material_id+chunk_id）
- `original_text` ← chunk.content
- `page_number` ← locator.viewer_page_number（PDF）
- `line_number` ← locator.start_line（代码）
- `project_id / material_type / content_hash / parser_version / source_locator_json / token_estimate` ← 同名追加列

## 5. 证据使用规则

- 模型只能引用本次提供的 chunk_id；不存在则拒绝（`EVIDENCE_VALIDATION_FAILED`）；
- 模型返回的 quote 必须在对应 chunk 原文中逐字连续出现，否则证据标 `unverified`、事实降为 `needs_review`；
- 证据的 `original_text` 始终从后端 `source_chunks` 读取，**绝不使用模型生成的引用文本**；
- 无有效定位时前端显示"来源位置尚未确认"，不编造页码/行号。
