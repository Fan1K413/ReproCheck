# ReproCheck 第六阶段 · 现有架构审计

> 审计时间：2026-11-18。审计方式：逐文件阅读 backend/app 与 frontend/src（含模型、路由、服务、测试），非推测。
> Git 状态：分支 `stage4/reproduction-engine`；最近提交 `1d32f51`（stage4 前端）；工作区有未提交的 stage5 审计文档（docs/STAGE5_*、BUG_TRACKING.md）与 .workbuddy 记忆文件——**第六阶段开发不覆盖、不删除这些文件**。

## 1. 技术栈现状

| 层 | 现状 |
|---|---|
| 后端 | FastAPI 0.115 + SQLAlchemy 2.0（async）+ SQLite（aiosqlite）+ Alembic |
| 前端 | React 18 + TS + Vite 5 + Tailwind 3 + React Query 5 + Zustand 4 + react-router 6 |
| LLM | OpenAI 兼容接口（默认通义千问），httpx 直连，密钥仅后端 .env |
| 迁移 | 启动时 `create_all` + 幂等 `migrate_stage2()`（Inspector 加列）；Alembic 0001 为空壳、0002 调 migrate_stage2；**无 stage4 revision** |
| 测试 | pytest + pytest-asyncio，内存 SQLite，LLM 用 fake httpx client 注入；73 个测试函数 |
| 部署 | 本地 uvicorn + vite dev proxy；无生产部署、无域名、无 HTTPS |

## 2. 数据模型（23 表）

- stage1（`models/__init__.py`）：Project / Material / SourceChunk / ExtractedFact / AuditFinding / Evidence / AIRun。
- stage2（`models/stage2.py`）：MaterialParseRun / ParseTask / EvidenceItem / FactRevision（松字符串关联，无 FK）。
- stage4（`models/stage4.py`）：ReproductionPlan / ReproductionTask / ReproductionRun / ExecutionEnvironment / ExecutionLog / ExecutionArtifact / ReproductionMetric / MetricComparison / FailureDiagnostic / RemediationProposal / RemediationReview / ReproductionReport。
- **关键缺口：无 User 表、无任何 auth 表。** 所有表以 `project_id` 字符串关联，无所有权概念。`requested_by`、`reviewer` 是客户端自由文本，非认证身份。

## 3. API 与权限现状（P0 缺口）

- 全部路由挂 `/api/v1`。**所有 GET/读接口完全无鉴权**；仅变更/耗额度接口用 `require_admin`（单一共享静态 `X-Admin-Token`，且 `allow_unauth_test_endpoints` 默认 True）。
- CORS `allow_origins=["*"]`；请求体上限 1MB。
- 无 JWT、无会话、无密码、无角色、无项目级隔离。第六阶段 A 组必须替换此机制，且兼容现有数据。

## 4. 各引擎现状

| 模块 | 现状 | 第六阶段影响 |
|---|---|---|
| 审计引擎 | 4 层：AI 抽取（chunk 白名单）→ 程序比对（`services/__init__.py` 硬编码 FIELD_ALIASES/NUMERIC_FIELDS/REL_TOL）→ AI 风险解释 → 证据从 source_chunks 重建 | 规则硬编码，C 组需 DB 化 + 版本化 |
| 解析器 | registry + pdf/python/zip/data/config/notebook/readme；notebook_parser 已存在但需核查 cell 级保留 | D 组增强 Notebook |
| 复现执行 | **执行永久禁用**：`sandbox_available()` 所有分支返回 False；无 worker、无队列；parse 同步执行于 HTTP 请求内 | 不在第六阶段启用真实执行（无验证沙箱），保持 blocked 状态如实标注 |
| 报告 | 14 章 HTML，origin 标注；WeasyPrint 未装→PDF 恒 None | 保持 |
| LLM | 单例 LLMService，JSON schema 校验 + 一次修复，token 记录，typed errors | C 组 RAG 复用 |

## 5. 前端现状

- 17 页面，统一 LoadingState/EmptyState/ErrorState + React Query 模式；设计系统为 CSS 变量 + Tailwind 映射（navy 侧栏 + 蓝 accent + IBM Plex）。
- **无 Dialog/Toast/Tabs/Select 原语**；无 auth context；API 层手写 fetch，无 token 处理。
- 路由 BrowserRouter + `/api` proxy，假设同源后端。Qoder Site 迁移需 SPA fallback + 可配置 API 基址。
- 12 个第六阶段页面全部为新建。

## 6. 第六阶段前不存在的能力（确认）

组织/团队/角色/权限、用户认证、基准案例库、规则版本、反馈治理、RAG、仓库连接器、开放 API、数据治理——**均无现有代码**，全部新建。stage3 `audits/` worktree 从未合并，不存在 audits 模块。

## 7. 架构插入点（复用而非重写）

- 路由分层 `api/v1 → services/reproduction → models` 清晰，新模块按此分层插入。
- 幂等加列迁移约定成熟，第六阶段新增表用 `create_all` + 新增 `migrate_stage6()`，并补 Alembic 0003。
- 现有 project_id 字符串关联保留；新增 `owner_user_id`/`org_id` 可空列，旧数据归入「默认组织/遗留项目」，不破坏既有数据。
- LLMService、证据重建、比对引擎复用；C 组把硬编码规则抽为 DB 种子规则，保持比对行为不变（回归测试保障）。

## 8. 结论

现有架构是「单租户、共享 admin token、读接口全开放」的演示级系统。第六阶段核心升级 = 引入真实身份与隔离（A/E）+ 可积累基准（B）+ 可维护规则（C），并以 D 组连接外部工具。所有新增模块复用现有分层与迁移约定，不重写前五阶段引擎。