# ReproCheck 第七阶段：项目现状审计

审计日期：2026-11-18。范围：当前主工作区源码、Git 状态、现有阶段文档、前端类型/生产构建；未改动业务代码，未执行数据库迁移、真实用户操作或生产部署。

## Git 与工作区保护

- 分支：`stage4/reproduction-engine`；最近提交：`1d32f51`、`90a4830`、`01c878c`。
- 工作区存在大量未提交/未跟踪文件，包括 `backend/app/api/deps.py`、`core/config.py`、`core/errors.py`、`db/__init__.py`、模型/测试/依赖修改，以及 stage6 的安全、RBAC、模型、迁移代码和文档。审计期间未覆盖或清理这些内容。
- 前端生产构建生成 `frontend/dist/`，Git 状态检查未显示该目录变更；未执行清理。
- 当前 HEAD 为 `1d32f5133346a3d2c6b4de3103ed829f983319de`；未创建提交/标签。前端开发服务器启动正常，HTTP 首页返回 200；浏览器自动化因 Chrome 未安装而无法开始。

## 现状摘要

| 模块 | 状态 | 实证与边界 |
|---|---|---|
| 前端 | PARTIAL | React 18、TypeScript、Vite、React Query、Zustand。`frontend/package.json` 有 typecheck/build。`npm run typecheck` 通过；`npm run build` 通过，Vite 5.4.21，构建约 5.63s。未做浏览器真机用户流程。 |
| 后端 | PARTIAL | FastAPI、SQLAlchemy async、SQLite、Alembic。API 汇总在 `backend/app/api/v1/__init__.py`，基础路径 `/api/v1`。测试运行受缺少 PyJWT 阻塞。 |
| 数据库/迁移 | PARTIAL | 启动调用 `create_all`、stage2 与 stage6 幂等迁移（`backend/app/db/__init__.py`）；stage6 脚本声明会备份 SQLite DB。未在实际数据库上执行迁移/恢复测试；审计发现计划文档提到 Alembic 0003，但当前迁移目录未见 stage6 revision。 |
| 用户认证/权限 | FAIL（上线阻断） | 存在 JWT/RBAC helper 和 stage6 用户模型，但路由聚合没有认证/组织/协作路由；旧项目创建/列表仍无认证。`require_admin` 在无 admin token 且默认允许测试接口时可放行。 |
| 项目数据隔离 | FAIL（上线阻断） | 有 `enforce_project_isolation` helper，但全仓 API 未发现引用/挂载；项目列表直接返回全部项目（`backend/app/api/v1/projects.py`）。跨用户隔离尚未成立。 |
| AI/LLM | BLOCKED | 配置读取后端环境变量，仓库根与 backend 的 `.env` 均不存在；未读取密钥值。没有生产 API Key 授权，未实调供应商。 |
| 材料解析 | PARTIAL | 有 PDF、Python、ZIP、配置、Notebook、数据、README 解析器及测试文件；未执行后端测试或真实用户上传流程。 |
| 长任务/Worker | NOT_IMPLEMENTED | 查到解析任务持久化相关 API/service，但无独立 worker/队列部署证据；不可推断刷新恢复、取消或崩溃恢复端到端正确。 |
| 代码执行隔离 | BLOCKED | 配置默认 `enable_code_execution=False`、backend `none`；现有阶段文档记录 Docker 未安装，真实执行不可用。不可在宿主机运行不可信代码。 |
| 报告 | PARTIAL | 复现报告服务/API/前端页面存在；PDF 依赖与下载、分享权限、历史版本未端到端验证。 |
| 团队协作/科研案例/集成 | NOT_IMPLEMENTED（可用业务流程） | 有 stage6 设计文档、部分表模型和 RBAC 目录；当前 API 目录没有 auth/org/team/case/rule/integration/governance 实际路由，前端没有对应可登录用户的完整流程。 |
| 文件存储 | PARTIAL | 材料上传/下载 API 与本地材料存储存在；未证明对象存储、备份/恢复或恶意归档隔离。 |
| 部署/发布 | BLOCKED | 未发现 docker-compose、正式域名、HTTPS/生产部署配置。只能准备，不可宣称上线。 |
| 测试 | BLOCKED | 全局 Python 无 pytest；项目 `backend/.venv` 有 pytest，但收集阶段导入 `jwt` 失败（`ModuleNotFoundError: No module named 'jwt'`）。 |

## 关键直接证据

- `backend/app/main.py:25-31`：CORS 允许所有来源；生产收敛仅为注释。
- `backend/app/core/config.py:32-40`：`allow_unauth_test_endpoints=True`、JWT 默认值为开发占位值。
- `backend/app/api/deps.py:50-65`：兼容共享令牌；任何有效 JWT 用户即放行写请求，不校验实际角色/项目授权；没有 admin token 时测试开放开关默认允许未认证。
- `backend/app/api/isolation.py:84-97`：隔离实现存在；但 API 路由未调用该依赖。
- `backend/app/api/v1/projects.py:27-49`：项目列表/创建不依赖当前用户，列表读取全量项目。
- `backend/app/api/v1/__init__.py:4-30`：仅注册 health、llm、demo、audit_runs、projects、materials、parse_tasks、facts、overview、reproductions。

## 上线结论

**NOT_READY**。首要阻断：路由级认证/项目隔离未接通；真实 LLM Key、执行沙箱、部署目标和后端可运行测试环境缺失。前端类型检查和生产构建通过，只能证明前端可编译，不能证明产品业务流程可用。
