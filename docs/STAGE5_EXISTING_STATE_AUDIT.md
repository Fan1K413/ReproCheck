# 第五阶段 · 前四阶段现状审计

审计日期：2026-11-18。方法：只读检查代码、实际运行测试与构建；**尚未启动服务做端到端实测**，凡未实跑的项标 NOT_TESTED。

## 1. 代码基线（实测）

| 位置 | 分支 / 提交 | 内容 | 状态 |
|---|---|---|---|
| 主工作区 | `stage4/reproduction-engine` @ 1d32f51 | 阶段 1/2/4 | 已提交 |
| `.worktrees/stage3` | `stage3/audit-platform` @ 01c878c + **未提交改动** | 阶段 1/2/3 | 未提交、未合并 |
| `master` | 01c878c | 阶段 1/2 基线 | — |

**结论：不存在同时包含阶段 3 与阶段 4 的代码版本。** 两个分支都从 01c878c 分出，各自修改了 `api/__init__.py`、`db/__init__.py`、前端 `App.tsx`/`AppLayout.tsx`/`index.css`，合并必然产生冲突。

## 2. 自动化检查结果（实测命令输出）

| 检查 | stage4 主工作区 | stage3 worktree |
|---|---|---|
| 后端 pytest | 76 passed | 347 passed |
| 前端 tsc | 通过 | 通过 |
| 前端 lint | 无 lint 脚本 | 通过（0 warning） |
| 前端单元测试 | 无 test 脚本 | 14 passed |
| 前端 build | 通过 | 通过 |
| npm audit (prod) | react-router 2 moderate | 同左 |

## 3. 环境事实（实测）

- Docker：未安装（`docker: command not found`）。`sandbox.py:157-158` 在 `ENABLE_CODE_EXECUTION` 关闭或后端不是 rootless_docker/gvisor 时拒绝执行——**真实代码执行当前不可用，且被正确关闭**。
- `.env`：不存在；仅有 `.env.example`，`LLM_API_KEY`、`ADMIN_TOKEN` 为空——**所有真实模型调用当前无法验证**。
- `gh` CLI：未安装。
- 健康检查：`app/api/v1/health.py:9` 已存在 `/health`。

## 4. 鉴权与隔离（代码检查）

- `app/api/deps.py:12` `require_admin`：单一共享 `X-Admin-Token`，无用户、无项目归属字段。
- `projects.py`、`overview.py`、`audit_runs.py` 中 `require_admin` 出现 0 次：创建项目及所有读接口无需任何凭据。
- 因此任务书 4.2「用户 A 不得访问用户 B 的数据」**无法满足：系统没有用户概念**。阶段 3 的"项目隔离"只是按 project_id 过滤，不是权限隔离。

## 5. 分阶段结论

| 阶段 | 结论 | 依据 |
|---|---|---|
| 1 基础架构 | PARTIAL | API/信封/迁移有测试；无用户体系、读接口无鉴权 |
| 2 材料解析 | PARTIAL | 解析器有测试；真实 LLM 抽取未实测（无 Key） |
| 3 审计引擎 | PARTIAL | 347 项测试通过；未提交未合并；浏览器未验收；语义审计未实测 |
| 4 复现验证 | PARTIAL / BLOCKED | 76 项测试通过；无 Docker，真实执行 BLOCKED；PDF 导出、AI 诊断未实测 |

逐项见 `STAGE5_FEATURE_ACCEPTANCE_MATRIX.md`，缺陷见 `BUG_TRACKING.md`。
