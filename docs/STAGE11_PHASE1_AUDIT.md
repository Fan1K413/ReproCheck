# 第十一阶段 · 第一阶段：真实项目检查报告

> 检查时间：2026-11-20。检查方式：只读文件遍历 + 真实 Git/测试命令。
> 本文件只记录**实际观测到的事实**，不把"计划"写成"已完成"。

## 1. 授权工作区与 Git 状态

| 项 | 实测值 |
|---|---|
| 工作区 | `C:\Users\ASUS\Desktop\科研复现审计官` |
| 分支 | `stage9/research-driven-refactor` |
| HEAD | `f2a7ce8`（stage10：12 项交付 + 基准数据集，219/219 pytest） |
| `git status --short` | 空（检查开始时工作区干净） |
| 工作树 | 另有 `.worktrees/stage3`（`stage3/audit-platform`，与本阶段无关，未改动） |

基线复跑（本阶段开始前）：

```
backend: PYTHONPATH=. .venv/Scripts/python -m pytest -q  → 219 passed（57.45s）
frontend: npm.cmd run typecheck                          → 通过（tsc --noEmit 无错误）
```

> pytest 退出码因 Windows 临时目录清理的 `PermissionError` 显示为 1，但测试结果为 219 passed；该 atexit 警告与测试无关。

## 2. 技术栈与形态

| 形态 | 技术 | 入口 |
|---|---|---|
| A 本地版 | FastAPI 0.115.6 + SQLAlchemy 2.0 + aiosqlite + React 18 + Vite 5 + Tailwind 3 | `backend/app/main.py`、`frontend/src/main.tsx` |
| B Site 版 | 同一 SPA + 单个 Deno Edge Function（`functions/`）+ 托管 PostgreSQL（`app.*` schema） | `frontend/functions/index.ts`、`frontend/.env.site` |

前端无 UI 组件库（无 shadcn/antd/MUI），全部为自定义 Tailwind 组件；图标用 lucide-react。
状态：zustand 4（4 个 store）+ @tanstack/react-query 5。

## 3. 真实模块依赖关系（AI 相关）

```
[业务任务]
  extraction_service.py:137        ─┐
  audit_service.py:151,268         ─┤
  reproduction/planner.py:51       ─┼─→ LLMService.chat()  (app/llm/__init__.py)
  reproduction/diagnostics.py:75   ─┤        │
  rag_service.py:200               ─┘        │ httpx POST {base_url}/chat/completions
                                              ▼
                                   settings.llm_api_key / llm_base_url / llm_model（仅后端 .env）
```

- **唯一**模型调用点：`backend/app/llm/__init__.py:103-135`（`_post`）。
- 无厂商 SDK：`requirements.txt` 无 dashscope/openai/anthropic 包。
- 固定模型名：`qwen-plus`（`config.py:24`、`.env.example:11`）；供应商 `qwen`（默认）会映射为 `provider_kind="qwen"`，否则 `"openai_compatible"`——**仅影响记录标签，协议完全相同**。
- API Key 读取：只从 `Settings.llm_api_key`（环境变量/`.env`）；前端无任何 `VITE_*_KEY`。
- 固定返回格式：5 个结构化任务全部用 `response_schema` → `response_format={"type":"json_object"}` + Pydantic `extra="forbid"` 校验 + 一次修复请求；证据 `chunk_id`/逐字 `quote` 由后端校验。
- 供应商专属参数：**无**（无 DashScope 原生参数；`X-Request-Id` 是自定义追踪头）。
- 能力需求：结构化 JSON 5 项；长上下文经"有界截断"规避（≤6000 字符/60 chunks）；**多模态 0 项、工具调用 0 项、流式 0 项**（当前代码均未使用）。
- `LLM_MAX_RETRIES` 已声明但**未被使用**（仅 JSON 修复请求 1 次）。

## 4. 数据库

- 实测 **53 张表**（Stage1 7 + Stage2 4 + Stage4 12 + Stage6 30）。
- 权威建表路径：`init_db()` → `Base.metadata.create_all` + 幂等补列迁移（`migrate.py`、`migrate_stage6.py`）；Alembic 仅覆盖 0001/0002。
- 凭据相关现有表：`repository_connections`（PAT 用 Fernet 加密）、`api_tokens`（仅哈希）；均不回显明文。已有 `ENCRYPTION_KEY` 配置与 `cryptography` 依赖可复用，但**模型凭据需要独立密钥**，不能复用仓库 PAT 的同一把普通配置密钥。

## 5. 前端设置页现状

- `src/pages/LlmSettingsPage.tsx`（201 行）：**只读**。仅调用 `GET /llm/status` + `POST /llm/test`，展示"已配置/未配置"、最近一次调用、连接测试结果。
- 明确无编辑入口：供应商、模型、API Key、Base URL、任务绑定都不可在软件内配置。
- 需要新增独立"模型管理中心"页面与后端 API。

## 6. Site 版能力边界（必须明示，不得假装一致）

| 能力 | 本地版 | Site 版 |
|---|---|---|
| 真实 LLM 调用 | 有（需 Key） | **无**（`LLM_KEY_NOT_CONFIGURED` / `DEMO_LIMIT`） |
| 文件系统/沙箱执行 | 有（默认关闭） | **无**（`DEMO_LIMIT`） |
| PDF 上传解析 | 有 | **无**（`DEMO_LIMIT`） |
| PDF 报告下载 | 有 | **无**（HTML only） |
| 密钥存储 | 后端 `.env` | 服务端 `APP_JWT_SECRET`（Sites → Settings → Secrets），Fernet 兼容加密 PAT |
| 客户端密钥变量 | 无 | 无（仅 `VITE_API_BASE_URL` 同源相对路径） |

Site 版 Edge Function 无出站 LLM 调用；`domain_rules.ts:995` 的 RAG 合成恒为 `null`。
**结论**：Site 版可做"用户级加密凭据管理 + 真实连接测试"的服务端设计（Edge Function 内 WebCrypto AES-GCM + 服务端密钥），但受平台注入模块约束，需以本地桥接验证；不得把密钥放进浏览器或 `VITE_*`。

## 7. UI/UX 审查基线

已建立全量路由清单（34 条，见前端探索结果），重点待修复页面：
- `LlmSettingsPage`（无配置能力，需重构为管理中心入口）；
- `ParseTasksPage` 1.5s 轮询在隐藏标签页仍运行（资源浪费）；
- 多处 `useEffect` 依赖/竞态需实机验证；
- `DashboardPage` LLM 状态卡片在 Site 版恒显示未配置，语义需标注版本边界。

本阶段 UI 修复以**实际浏览器验证**为准，不以代码阅读结论宣称修复。

## 8. 访问范围声明

- 本地版源码、数据库、测试：**可完整访问并已修改**。
- Site 版 `functions/` TS 源码、dev 桥接、schema：**可完整访问**；平台注入的 `functions/_qoder/*` 模块**不在仓库中**，无法做真实云端部署联调。Site 版任何"真实连接"只能经本地桥接模拟，报告必须如此标注。
