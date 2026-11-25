# PROJECT_MAP · ReproCheck 仓库与服务地图

> 采集时间：2026-11-24 10:40–11:05
> 采集方式：`git`、文件系统、运行中 OpenAPI、SQLite 元数据、真实 HTTP 探针

## 1. 代码库

| 项 | 值 |
|---|---|
| 根目录 | `C:\Users\ASUS\Desktop\科研复现审计官` |
| 当前分支 | `stage9/research-driven-refactor` |
| HEAD | `f2a7ce8 stage10: 12 final deliverables + benchmark dataset (20 real projects), graceful degradation fix verified end-to-end, 219/219 pytest pass` |
| 工作区状态 | 审计开始时 **241 条**未提交/未跟踪条目（frontend 131、backend 66、docs 20、Plan 10、其他 14） |
| 额外 worktree | `.worktrees/stage3`（分支 `stage3/audit-platform`，HEAD `49c8f44`） |
| 后端规模 | 194 个 `.py`，`backend/app` 34,102 行 |
| 前端规模 | 114 个 `.ts/.tsx`，`frontend/src` 36,254 行（73 个 tsx、40 个 pages） |
| 根库文件 | `reprocheck.db` 1,662,976 B（**旧库/无项目数据**） |
| 运行库文件 | `backend/reprocheck.db` 2,027,520 B（**当前服务实际使用**） |

> 注意：`app/core/config.py` 的 `database_url` 是相对路径 `sqlite+aiosqlite:///./reprocheck.db`，以
> 后端进程的工作目录为准。当前 uvicorn 从 `backend/` 启动，因此活动库是 `backend/reprocheck.db`。
> 根目录 `reprocheck.db` 是历史副本，含 83 张表但 `projects/materials` 计数为 0，容易误连、误备份。

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 18.3、TypeScript 5.6、Vite 5.4、Tailwind 3.4、lucide-react、zustand、@tanstack/react-query 5、react-router-dom 6 |
| 后端 | FastAPI 0.115.6、Pydantic 2.10、SQLAlchemy 2.0 async + aiosqlite、Alembic、PyJWT、cryptography |
| 解析 | PyMuPDF、PyYAML、openpyxl；PDF/代码/Notebook/CSV/ZIP 解析器 |
| 统计 | numpy/scipy（缺失时纯 Python 后备） |
| 测试 | pytest 8.3 + pytest-asyncio；Playwright 1.65（Edge channel） |
| 存储 | 本地 SQLite + `storage/` 文件目录 |

## 3. 运行态（审计时）

| 服务 | 地址 | 状态 | 进程/证据 |
|---|---|---|---|
| 后端 | `http://127.0.0.1:8000` | 200 | PID 15128；`/api/v1/health` 可用；OpenAPI 可读 |
| 前端 | `http://127.0.0.1:5173` | 200 | PID 10244；Vite dev server |
| API 文档 | `http://127.0.0.1:8000/docs` | 200 | 201 paths / 244 operations |

启动命令（沿用 README）：

```powershell
cd backend
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

## 4. 配置与依赖

- `backend/.env` **不存在**，根 `.env` 也不存在；仅 `.env.example` 与 `backend/.env.example`。
- `LLM_API_KEY` 未配置，`settings.is_llm_configured=False`；解析真实降级为 `partially_completed`。
- `allow_unauth_test_endpoints=True`（默认），`jwt_secret=dev-insecure-change-me`，`encryption_key` 空，`CORS=*`，`require_ai_consent=False`。
- `STRICT_PRODUCTION` 未设置；启动只记录 warning，不阻断。
- 测试环境：Python 3.13.12（`.venv`），Node 22，Edge headless。

## 5. 数据现状（活动库）

| 表 | 行数（审计前） | 说明 |
|---|---|---|
| users | 17 | 4 个演示账号 + 历史测试账号 |
| organizations | 18 | 每账号/测试组一个组织 |
| org_members | 21 | |
| projects | 15 | 含 `proj-209c77cd39f94212`（ResNet-50 演示项目） |
| materials | 31 | 演示项目 2 份：`resnet50_repro.ipynb`、`paper_excerpt.md` |
| parse_tasks | 18 | |
| reproduction_plans | 4 | 演示项目 1 份 AI 规划 |
| reproduction_runs | 5 | |
| reproduction_reports | 4 | |
| benchmark_cases | 4 | |
| api_tokens | 5 | |

> 审计过程中创建的 `QA-AUDIT` 临时项目（3 个）及材料、规划、任务、报告均已通过真实 DELETE 接口清理；
> 清理后 `projects` 中 `QA-AUDIT%` 计数为 0，`qa-*` 材料计数为 0。

## 6. 前端路由（39 条）

入口：`frontend/src/App.tsx`（`/` 在 AppLayout 外，`/projects/:projectId/workbench` 为沉浸式 Bloom）。

分组：

- 公共：`/login`
- 项目：`/projects`、`/projects/new`、`/projects/:projectId/{workbench,materials,tasks,facts,evidence-graph,overview,verification,handoff,team,data-audit}`
- 材料：`/materials/:materialId`
- 复现：`/projects/:pid/reproduction`、`/reproductions/plans/:planId`、`/reproductions/runs/:runId`、`.../environment|comparison|diagnostics|reports`
- 平台：`/orgs`、`/roles`、`/benchmark`、`/benchmark/:caseId`、`/fact-schema`、`/rules`、`/feedback`、`/knowledge`、`/integrations`、`/api-tokens`、`/governance`、`/stats-audit`
- 设置：`/settings/llm`、`/settings/models`
- 演示：`/demo/audit`
- 兜底：`*`

## 7. 后端 API（201 路径 / 244 操作）

按 OpenAPI tag 计数（主要）：

| tag | 操作数 | tag | 操作数 |
|---|---|---|---|
| reproductions | 24 | collaboration | 11 |
| lifecycle | 19 | cases | 10 |
| organizations | 16 | parse-tasks | 8 |
| audit-rules | 11 | workflow | 8 |
| orchestration | 11 | open-api | 7 |
| governance | 7 | knowledge | 7 |
| evidence-gaps | 6 | handoff-records | 6 |
| integrations | 6 | materials | 5 |
| facts | 5 | data-audit | 4 |
| recovery | 4 | api-tokens | 4 |
| auth | 4 | rag-knowledge | 3 |
| verification-layers | 3 | roles | 3 |
| statistics-audit | 3 | projects | **3**（GET list / POST / DELETE by id） |
| benchmark-metrics | 2 | reports（子路径） | 见 reproductions |

完整前缀：`/api/v1/*`；另有 `/api/open/v1/*` 开放 API 7 个操作。
统一响应：`{success, data, error, request_id}`；实测 404 错误也遵循该 envelope。

## 8. 关键文件

| 用途 | 路径 |
|---|---|
| 应用入口 | `backend/app/main.py` |
| 配置/安全自检 | `backend/app/core/config.py`（33–125 行） |
| 鉴权依赖 | `backend/app/api/deps.py` |
| 项目隔离 | `backend/app/api/isolation.py` |
| 项目 CRUD | `backend/app/api/v1/projects.py` |
| 材料 | `backend/app/api/v1/materials.py`、`app/services/material_service.py` |
| 解析任务 | `backend/app/api/v1/parse_tasks.py`、`app/services/task_service.py` |
| 复现规划 | `backend/app/reproduction/planner.py`、`app/api/v1/reproductions.py` |
| 报告 | `backend/app/reproduction/report.py` |
| 前端路由 | `frontend/src/App.tsx` |
| 材料页/抽屉 | `frontend/src/pages/MaterialsPage.tsx`、`frontend/src/styles/wave-b-material.css` |
| 全局 token | `frontend/src/styles/tokens.css` |

## 9. 已存在的质量资料（不重复造轮）

- `docs/stage10/01_CODE_ARCHITECTURE_AUDIT.md`
- `docs/stage10/07_REGRESSION_TEST_REPORT.md`
- `docs/stage10/08_PERFORMANCE_STRESS_TEST.md`
- `docs/stage10/09_SECURITY_TEST_REPORT.md`
- `docs/stage10/12_BETA_ACCEPTANCE_REPORT.md`
- `docs/STAGE6_REAL_STATUS.md`、`docs/STAGE9_CURRENT_PRODUCT_AUDIT.md`
- `audit-reports/code_review_report.md`（26,730 B）

> 这些文档与本次实测存在口径差异（测试数量、匿名访问结论），已在 `BUG_TRACKER.md` 记录为文档漂移。
