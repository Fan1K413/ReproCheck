# 解析器架构（第二阶段）

## 1. 设计原则

**确定性解析交给程序，语义理解交给模型，事实来源由证据链负责。**

- 8 类材料各自独立解析器，禁止一个 `read_text()` 通吃；
- 所有解析器输出统一的 `ParseResult`（`app/schemas/parsing.py`），但**定位结构按材料类型区分**，不强行统一；
- 全程**不执行用户代码、不安装用户依赖、不 extractall 后运行**；
- 解析失败明确返回 `status=failed` + `error_code`，绝不伪造内容。

## 2. 模块地图

| 模块 | 函数 | 技术 | 关键能力 |
|---|---|---|---|
| `registry.py` | `parse_file()` / `detect_material_type()` | 扩展名分派 | 统一入口、二次校验、大小硬限制 |
| `pdf_parser.py` | `parse_pdf()` | PyMuPDF(fitz) | 逐页 blocks、三种页码、章节识别、表格页标记、OCR 需求提示 |
| `python_parser.py` | `parse_python()` / `parse_python_text()` | `ast` + `tokenize` | 函数/类/参数/import/argparse/关键超参，起止行号；**纯静态，零执行** |
| `notebook_parser.py` | `parse_notebook()` / `parse_notebook_text()` | json | markdown/code cell 区分、cell_index、cell 内行号；不执行 |
| `config_parser.py` | `parse_config()` / `parse_config_text()` | yaml.safe_load / json / tomllib / 文本 | 嵌套字段路径保留、语义归一、safe_load 拒绝对象构造 |
| `readme_parser.py` | `parse_readme()` / `parse_readme_text()` | 文本/Markdown | 章节切分、行号、运行命令原文保存（不执行） |
| `zip_parser.py` | `parse_zip()` | zipfile | 路径穿越/压缩炸弹/符号链接/危险扩展名防护，仅内存读取 |
| `data_parser.py` | `parse_data_file()` | csv / openpyxl(read_only) | CSV/XLSX 元信息（行列/字段/类型/缺失/重复/哈希），抽样不送全量 |
| `chunking.py` | `split_text()` | 段落优先算法 | 自然段落→句号→字符硬切，保留重叠上下文 |
| `limits.py` | 常量 + `ParserError` + `safe_resolve_within()` | — | 所有硬限制集中管理 |

## 3. PDF 页码的三重区分（关键）

| 概念 | 字段 | 含义 |
|---|---|---|
| PDF 内部页索引 | `page_index` | 0 基，程序遍历用 |
| 阅读器页码 | `viewer_page_number` | 1 基，用户看到的页码 |
| 印刷页码 | `printed_page_number` | 论文页脚标注，正则尝试识别，失败为 None |

`page_number_source` 标记当前以哪种为准（printed/viewer）。无法获取印刷页码时使用阅读器页码并明确标注，**不混淆三者**。

## 4. 安全设计

- **ZIP**：条目数 ≤500、解压总量 ≤100MB、单文件 ≤20MB；路径含 `..` 直接判恶意整体失败；符号链接（`stat.S_ISLNK`）跳过；危险扩展名（exe/dll/so/pkl/pt 等）跳过；`.git/.venv/node_modules/checkpoints` 等忽略目录跳过；只读入内存，**从不 `extractall`**。
- **Python**：仅 `ast.parse()` + `tokenize`，测试中在模块顶层放 `raise RuntimeError` 验证解析不触发执行。
- **YAML**：强制 `yaml.safe_load`，测试用 `!!python/object` 标签验证被拒绝。
- **文件类型**：扩展名白名单 + 路径安全解析双重校验；文件名净化去路径成分与危险字符。

## 5. 解析状态机

`uploaded → queued → parsing → extracting → completed / partially_completed / failed / unsupported`

**上传成功 ≠ 解析成功**：materials.parse_status 如实记录，空白页/损坏文件/无文本扫描件都明确标记，不伪装成功。

## 6. 成本控制

- 单次送给模型的文本 ≤6000 字符（`MAX_SEND_TO_LLM_CHARS`）；
- 单块 ≤1800 字符，超长段落二次切分并保留 150 字符重叠；
- 每个文本块带 `content_hash`，同项目同哈希材料上传时去重复用；
- 数据表元信息只抽样统计，完整数据集不进模型。

## 7. 已知限制

- 扫描版 PDF 无 OCR 能力：明确标记 `needs_ocr=True` 并提示，不生成假 OCR 结果；
- PDF 表格仅做页面标记，不做结构化表格还原（第二阶段范围外）；
- 印刷页码识别基于页脚正则，版式差异大时可能识别失败（回退阅读器页码并标注）；
- PyMuPDF 已安装版本 2.1.x（API 提示 `fitz` 弃用，将迁移 `pymupdf` import），requirements 锁定版本需按实际环境校准。
