# 第二阶段开发前审查报告（STAGE2_PRECHECK）

审查时间：2026-11-17
审查方式：实际读取磁盘文件 + 真实运行测试，不依赖记忆或第一阶段自述。

## 1. 第一阶段实际完成情况（逐项核实）

| 审查项 | 实际情况 | 证据 |
|---|---|---|
| 项目目录结构 | 完整：backend/app 下 24 个 py 文件、frontend/src 21 个文件、docs 7 份 | `find` 输出 |
| 前端技术栈与路由 | React18 + TS + Vite5 + Tailwind3 + ReactRouter + Zustand + TanStackQuery + Lucide；5 路由（工作台/项目/新建/模型服务/审计演示） | package.json、App.tsx、pages/ |
| 后端技术栈与 API | FastAPI + Pydantic v2 + SQLAlchemy 2.0 + Alembic + SQLite(aiosqlite)；6 个契约接口 | main.py、api/v1/ |
| 数据库结构与迁移 | 7 张表：projects/materials/source_chunks/extracted_facts/audit_findings/evidences/ai_runs；alembic 0001 为**占位脚本（pass）**，实际靠 `init_db()` 的 `create_all` 建表 | 表结构导出、0001_initial.py |
| LLM 适配层 | 完整：超时/重试/请求ID/token统计/鉴权限流分类/Pydantic校验/JSON修复/密钥脱敏 | app/llm/__init__.py |
| API Key 读取与保护 | 仅后端 `settings.llm_api_key` 读取；全项目 grep 无明文密钥；前端零密钥引用 | config.py、grep |
| 项目管理与材料管理 | **项目管理完整**（GET/POST /projects，实际落库）；**材料管理薄弱**：materials 表存在但无上传/下载/删除 API，第一阶段仅靠 demo/audit 内联文本生成材料 | projects.py、demo.py |
| source_chunks 等表 | 字段为第一阶段最小集：source_chunks 有 page_number/line_number 预留，但无 content_hash/parser_version/source_locator 结构；extracted_facts 无 assertion_type/extraction_status | 表结构导出 |
| 端到端测试 | **真实通过 17 项**（pytest 实跑 0.19s） | pytest 输出 |
| 高优先级 Bug | 无。非阻塞项：favicon 404、FastAPI on_event 弃用警告 | TEST_REPORT.md |

**结论**：第一阶段真实完成，可在此之上开发；不存在需要回退重做的伪功能。

## 2. 可复用模块（第二阶段不重写）

1. **LLM 适配层** `app/llm/LLMService`：直接复用，`chat(messages, response_schema)` 已具备全部可靠性机制。
2. **统一响应与异常** `app/core/errors.py`：ok/fail 信封、错误码体系直接复用。
3. **配置与密钥管理** `app/core/config.py`：新增第二阶段配置项即可，不动密钥读取逻辑。
4. **项目数据模型与 API** `models.Project`、`/projects`：直接复用。
5. **source_chunks / extracted_facts / ai_runs 表**：**扩展列**而非重建，保留第一阶段数据。
6. **审计编排与比对引擎** `services/audit_service.py`、`services/__init__.py`：第三阶段跨材料审计直接复用。
7. **前端组件与 api.ts 封装**：DataTable/StatusBadge/状态组件/统一请求封装直接复用。

## 3. 需要补充的模块

| 模块 | 原因 |
|---|---|
| 材料上传/存储/下载/删除 API 与本地存储 | 第一阶段无真实文件入口，第二阶段核心 |
| 8 类独立解析器 | PDF/Python/ipynb/ZIP/YAML/JSON/TOML/requirements/README/CSV-XLSX，禁止单一文本函数 |
| 统一 SourceChunk 结构化模型与切分算法 | 阶段一切块无 content_hash/parser_version/定位结构 |
| 按材料类型分版本的提示词模板 | 第一阶段单一抽取提示词，不适用代码/配置/README |
| 严格事实 Schema（explicit/inferred/ambiguous/not_found） | 第一阶段 FactView 无断言类型与验证状态 |
| evidence_items / fact_revisions / material_parse_runs 表 | 证据链、人工修订留痕、解析任务记录 |
| 解析任务状态机与缓存 | 异步任务、失败重试、哈希去重 |
| 前端 5 个材料解析相关页面 | 上传/详情/任务/事实/概览 |

## 4. 数据库迁移策略（关键）

第一阶段 0001 迁移是占位脚本，历史 DB 由 `create_all` 建立且**无 alembic_version 表**。第二阶段：
- **不删库、不重新初始化**；
- 新增 `0002_stage2` 迁移脚本，采用**幂等**方式（先用 inspector 检测列/表是否存在，再 ALTER TABLE ADD COLUMN / CREATE TABLE），既能在已有 DB 上升级，也能在空库上工作；
- ORM 模型与迁移脚本保持同一份列定义来源，避免漂移；
- 对第一阶段数据做兼容：新列全部 nullable 或有默认值，旧记录不丢失。

## 5. 已知风险

1. **无真实 API Key**：环境 `sk-` 密钥失效（详细见 STAGE1 报告）。第二阶段真实模型调用同样受阻；程序逻辑用协议级 mock 验证，标记为"待配置真实密钥"。**不得因此把解析/抽取结果伪装为真实 AI 输出**。
2. **Alembic 无版本基线**：0001 为 pass，需靠幂等 0002 兜底，迁移需在空库与已有库两种形态都验证。
3. **SQLite 并发**：解析任务串行写入即可满足本阶段，不宣称具备分布式任务调度能力。
4. **超大文件/压缩炸弹**：必须在解析器层做硬限制，第二阶段的上传入口是新攻击面。
5. **无 Git 仓库**：无法用 VCS 回滚，改动前对关键文件做最小局部 diff，保留 .bak 由迁移脚本生成。
6. **PyMuPDF/openpyxl 等新依赖**：需用国内镜像 + `--no-cache-dir` 安装（第一阶段踩坑：pip 缓存触发沙箱 safe-delete 守卫）。

## 6. 开发前结论

第一阶段满足"在其之上继续开发"的条件。第二阶段按以下顺序推进：
预检报告 → 数据模型与幂等迁移 → 多格式解析器（子代理并行）→ SourceChunk 系统 → 事实抽取与任务管理 → 前端扩展（子代理并行）→ 测试集与真实测试 → 九份交付文档。

坚持：不执行用户代码、不编造证据、不伪造 AI 结果、不用静态数据冒充真实解析、不把材料缺失误判为研究者未实施实验。
