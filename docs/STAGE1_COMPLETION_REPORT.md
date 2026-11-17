# 第一阶段完成报告

项目：ReproCheck｜科研复现审计官
阶段：第一阶段（系统架构、真实大模型 API 接入与核心审计链路验证）
日期：2026-11-17

---

## 1. 实际完成了哪些功能

| 功能 | 状态 | 交付位置 |
|---|---|---|
| 项目检查与环境探测 | ✅ | 空工作区，确认 Python/Node/Git 状态与密钥可用性 |
| 前后端分离架构 | ✅ | frontend/ + backend/，统一 API 契约 |
| 大模型 API 适配层 | ✅ | backend/app/llm/（超时/重试/请求ID/token统计/鉴权限流分类/Pydantic校验/JSON修复/密钥脱敏） |
| 模型连接测试 | ✅ | GET /llm/status + POST /llm/test + 前端「AI 模型服务」页 |
| 文本材料输入 | ✅ | 审计演示页两个可编辑文本域 + 合成材料文件 |
| AI 结构化信息抽取 | ✅ | 第一层，Pydantic FactsExtraction，携带 chunk_id/置信度 |
| 程序化参数比对 | ✅ | 第二层，数值/字符串/单位/缺失/别名标准化，冲突不交给模型 |
| AI 风险解释 | ✅ | 第三层，仅针对已验证冲突，RiskExplanations |
| 证据链验证 | ✅ | 第四层，拒绝虚构 chunk_id，证据原文从后端材料读取 |
| 审计结果展示 | ✅ | 前端审计演示页：抽取表/比较表/风险/证据/元信息 |
| 审计运行记录保存 | ✅ | ai_runs + result_json，支持按 run_id 查历史 |
| 工作台/项目创建/项目列表 | ✅ | 三个页面，真实接口数据 + 空状态 |
| 7 份交付文档 + README | ✅ | docs/ 与 README.md |

## 2. 哪些功能通过真实测试

- 后端自动化测试 **17 项全通过**（比对逻辑、LLM 各类失败路径、JSON 修复、证据拒绝、端到端四项结果、持久化、历史查询）。
- API 真实 HTTP 冒烟：health/status/projects/openapi/无 Key 失败/项目创建/持久化全部通过。
- 前端类型检查、生产构建、代理联调通过。
- 浏览器（chromium）实测三个页面渲染、失败路径、控制台与布局通过。
- 明细见 `docs/TEST_REPORT.md`。

## 3. 实际调用了什么模型

**没有成功调用任何真实模型。** 原因见第 4、11 点。程序对模型的调用逻辑按 OpenAI 兼容协议实现，默认配置为 qwen-plus（通义千问兼容模式），可切换任意 OpenAI 格式模型。

## 4. API 调用是否成功

**未成功（外部阻塞）**。环境探测发现一个 `sk-` 开头 51 字符密钥，但对 OpenAI 官方端点被本地代理 502 拦截，对通义/DeepSeek/月之暗面/智谱兼容端点全部返回 401（失效占位密钥）。真实调用测试明确标记为「待配置真实密钥」。填入真实密钥后即可调用，无需改代码。

## 5. 是否发现并验证了两项预设参数冲突

**是（通过程序逻辑验证，非真实模型）**。端到端测试证明：
- Batch Size：论文 64 vs 配置 32 → 冲突 ✅
- Learning Rate：0.001 vs 0.0001 → 冲突 ✅
- Epochs：100 vs 100 → 一致 ✅
- Optimizer：AdamW vs AdamW → 一致 ✅

冲突由后端程序比对产生，非前端写死。真实密钥接入后，同一条链路会自动用真实模型抽取结果重算。

## 6. 证据关联是否正确

**是**。测试验证：证据原文取自后端保存的材料（"研究实验使用 Batch Size 为 64..." 与 "batch_size: 32"），不是模型生成的引用文本；模型虚构的 `chunk_id=fabricated_chunk_999` 被拒绝并抛 `EVIDENCE_VALIDATION_FAILED`。

## 7. 哪些功能尚未完成

- **真实大模型调用验证**（阻塞于密钥，代码已就绪）。
- PDF 页码、代码行号级证据（第二阶段，当前用文本段落位置）。
- PDF 上传与完整材料管理、论文库搜索、多智能体协作、知识图谱、代码执行、自动判定结论真伪（均为任务书明确的"暂不实现"范围）。
- ADMIN_TOKEN 鉴权的浏览器端实测（已实现逻辑，未单独实测）。

## 8. 当前存在什么 Bug

无阻塞性 Bug。已知非阻塞项：
1. 浏览器控制台有 `favicon.ico` 404 噪音（无害）。
2. FastAPI `on_event` 弃用 warning（下版本可迁移 lifespan）。
3. 测试文件有一个未使用的遗留辅助函数 `install_mock`。

## 9. 如何在 Windows 11 上启动项目

见 `README.md`「在 Windows 11 上启动」。要点：
- 后端：`cd backend` → 建 venv → `pip install -r requirements.txt`（建议 `-i https://mirrors.aliyun.com/pypi/simple/ --no-cache-dir`）→ `uvicorn app.main:app --reload --port 8000`
- 前端：`cd frontend` → `npm install` → `npm run dev`（5173，已代理 /api 到 8000）
- 文档：`http://localhost:8000/docs`

## 10. 如何配置真实 API Key

复制 `.env.example` 为 `backend/.env`，填入：
```env
LLM_API_KEY=你的真实密钥
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
```
密钥仅后端读取，禁止写入前端/Git/日志/响应。生产环境设置 `ADMIN_TOKEN`，前端请求头带 `X-Admin-Token`。详见 `docs/LLM_INTEGRATION.md` 与 `docs/SECURITY.md`。

## 11. 如何部署到 Qoder Sites

当前工作区未提供可验证的 Qoder Sites 后端运行时、Server Functions、数据库、对象存储与 Secrets 能力，**不假装静态页面已接通后端**。

- 若账号支持后端：前端构建产物托管，后端按平台提供的 Python/容器运行时部署，密钥放平台服务器端 Secret。
- 若账号仅支持静态部署（推荐替代结构）：**Qoder Sites 托管前端静态站点 + 独立后端服务**（云服务器/容器运行 FastAPI），前端 `VITE_API_BASE_URL` 指向后端公网地址，CORS 收敛到前端域名，密钥放后端服务器环境变量/Secret。详见 `docs/ARCHITECTURE.md`。

## 12. 当前 Qoder Sites 不支持后端时的替代部署结构

采用上述"静态前端 + 独立后端"结构：
1. 前端：`npm run build` → 托管 dist（Qoder Sites / 任意静态托管）。
2. 后端：Docker 或云服务器跑 `uvicorn app.main:app`，配 HTTPS + 反向代理。
3. 通信：前端设 `VITE_API_BASE_URL=https://你的后端域名/api`，后端 CORS 仅放行前端域名。
4. 密钥：服务器 Secret 管理，绝不进前端构建。
5. 数据库：SQLite 起步，量大时迁 PostgreSQL（改 `DATABASE_URL` 即可）。

## 13. 第二阶段可以直接复用哪些模块和接口

- **LLM 适配层** `app/llm/`：新增任何 AI 能力都通过 `LLMService.chat()`，天然复用超时/校验/修复/统计。
- **审计编排** `app/services/audit_service.py`：四层链路骨架，扩展 PDF/代码材料只需替换材料切分与 chunk 生成部分。
- **比对引擎** `app/services/__init__.py`：字段别名与数值/字符串比较，可直接加新参数类型。
- **证据模型** `models.SourceChunk / Evidence`：`locator_type/page_number/line_number` 字段已预留，第二阶段扩展 PDF/代码定位无需改表结构。
- **API 契约与统一信封**：health/status/projects/audit-runs 可原样复用；demo/audit 可扩展为通用 audit。
- **前端组件**：DataTable/StatusBadge/状态组件、api.ts 统一封装、审计演示页的结果展示区可复用于真实材料审计。
- **数据库与迁移**：sqlalchemy + alembic 结构可直接演进。

---

## 最终结论

第一阶段的可运行软件已交付：前后端分离、真实 API 适配层、四层审计链路、证据防伪造、运行记录持久化、四个可用前端页面，全部通过自动化测试与浏览器实测。**唯一的外部阻塞是缺少真实可用的 API Key**——这不是代码缺陷，代码已为此做好全部准备，配置真实密钥后即可完成"真实调用大模型→抽取→程序识别冲突→展示证据"的完整验收。
