# 第二阶段完成报告

项目：ReproCheck｜科研复现审计官
阶段：第二阶段（多源科研材料智能解析引擎与可追溯证据库）
日期：2026-11-17

---

## 1. 支持了哪些真实文件格式

| 类型 | 格式 | 解析器 |
|---|---|---|
| PDF 论文 | .pdf | PyMuPDF |
| Python 代码 | .py | ast + tokenize（纯静态） |
| Notebook | .ipynb | json（不执行 cell） |
| 代码仓库 | .zip | zipfile（安全读取） |
| 配置 | .yaml/.yml/.json/.toml | safe_load / json / tomllib |
| 依赖 | requirements.txt | 文本解析 |
| 文档 | .md/.markdown/.txt | 章节切分 |
| 数据 | .csv/.xlsx | csv / openpyxl（元信息） |

共 **8 类、13 种扩展名**，各自独立解析器，非单一文本读取函数。

## 2. 各类文件采用什么解析技术

- PDF：PyMuPDF `get_text("blocks")`，逐页保序，三种页码区分，章节正则识别，表格页标记；
- Python：标准库 `ast` 静态解析（不执行），提取函数/类/import/argparse/关键超参与起止行号；
- Notebook：json 解析，区分 markdown/code cell，记录 cell_index 与内部行号；
- ZIP：zipfile 只读内存，条目数/解压量/单文件大小硬限制，路径穿越/符号链接/危险扩展名防护；
- YAML/JSON/TOML：`yaml.safe_load` / `json.load` / `tomllib`，保留嵌套 field_path 与原始 key；
- README/TXT：标题与段落切分，运行命令只保存原文；
- CSV/XLSX：`csv` 模块 / `openpyxl(read_only=True)`，只统计元信息，抽样不送全量。

## 3. PDF 页码和代码行号是否可以追溯

**是**。PDF 区分 page_index（0 基内部）/ viewer_page_number（1 基阅读器）/ printed_page_number（印刷页，正则识别失败为 None 并标注来源），保存 bbox 坐标；代码保存 file_path + start_line + end_line + symbol；notebook 保存 cell_index + cell 内行号；配置保存 field_path + original_key + line_number。定位信息随 chunk 落库，证据可跳原材料页。无定位时前端显示"来源位置尚未确认"，不编造。

## 4. 大模型实际使用了什么模型

**没有成功调用任何真实模型**（外部阻塞）。代码默认配置 qwen-plus（通义千问 OpenAI 兼容模式），可改环境变量切换。环境 `sk-` 密钥对OpenAI官方端点被本地代理 502 拦截，对通义/DeepSeek/月之暗面/智谱兼容端点全部 401（失效占位密钥）。

## 5. 每种材料分别调用多少次模型

真实调用次数为 0（同上）。**设计上**：每种材料解析后抽取调用 1 次（最多 3 次含 JSON 修复），program 事实由程序直接生成不调用模型；同哈希材料复用缓存不重复调用。链路已用协议级 mock 验证（如 test_full_pipeline 断言 `model_calls=1`、`total_tokens=180`）。

## 6. 模型提取了哪些科研事实

Schema 支持 9 类：研究信息、数据集、模型、训练参数、评价指标、环境依赖、运行方式、实验过程、其他。字段含 field_key/label、raw/normalized value、unit、assertion_type、evidence_refs、confidence。**真实模型未运行，故无真实提取结果**；mock 测试覆盖了 learning_rate/batch_size/epochs/backbone 等字段的抽取与校验。

## 7. 有多少事实得到有效证据支持

mock 测试中：验证通过的事实 evidence verification_status=verified、事实 extraction_status=supported（test_extract_with_verified_evidence）；虚构 chunk、假 quote 分别被拒/标未验证。**真实数据下该统计来自 `GET /facts/summary` 的数据库聚合**，前端概览页如实展示，不预填数字。无真实模型，无法给出真实比例。

## 8. 有多少事实被标记为推断或歧义

Schema 与前端完整支持 explicit/inferred/ambiguous/not_found 四态与徽标区分；mock 测试 `test_not_found_and_inferred_distinguished` 验证了 inferred 与 not_found 正确标记。真实比例无法给出（无真实模型）。

## 9. 是否存在无依据的 AI 输出

校验链保证：chunk_id 不存在→拒绝引用；quote 不匹配→verification_status=unverified、事实降 needs_review；not_found→unsupported；证据原文从后端读取而非模型生成。测试 `test_reject_fabricated_chunk_id` / `test_fake_quote_marked_unverified` 覆盖。**不存在被当作有效证据接受的无依据输出**。confidence 明确标注为非校准辅助值。

## 10. 测试集规模和实际指标

- 自建合成测试材料 **17 个文件**（PDF/py/ipynb/yaml/json/toml/csv/xlsx/zip 及损坏/空/恶意样本），README 标注"合成测试材料"；
- 后端测试 **52 项全部通过**（含第一阶段 17 项回归），逐文件：comparison 6 / llm 8 / audit 3 / parsers 26 / extraction 5 / stage2_api 4；
- 前端 tsc 0 错误、build 成功（1657 模块）；
- **字段抽取 P/R/F1、证据关联成功率等真实指标无法计算**（无真实模型输出，不编造）；mock 仅验证程序逻辑正确性。

## 11. 当前仍有哪些解析缺陷

1. 扫描版 PDF 无 OCR：明确提示 needs_ocr，不生成假结果；
2. PDF 表格仅标记页面，不做结构化还原；
3. 印刷页码依赖页脚正则，版式特殊时识别失败（回退阅读器页码并标注）；
4. 同步解析任务取消在阶段边界生效，非实时中断；
5. 大文件（接近 20MB）内存占用，生产建议流式化；
6. PyMuPDF requirements 锁定值（1.24.13）与实际安装（2.1.x）需校准；
7. 真实模型调用与真实指标待配置密钥后补测。

## 12. 下一阶段可直接复用哪些模块

见 `docs/STAGE3_HANDOVER.md`。核心：统一 SourceChunk + 证据库（已具备跨材料审计所需的事实与原文定位）、事实 Schema 与校验链、LLM 适配层、比对引擎（第一阶段）、任务状态机、前端事实/证据展示组件。

---

## 交付原则声明

未执行用户代码、未安装用户依赖、未编造证据、未伪造 AI 结果、未用静态数据冒充真实解析、未把材料缺失误判为研究者未实施实验。所有"未完成"项（真实模型调用与指标）如实标注为"待配置真实密钥"。
