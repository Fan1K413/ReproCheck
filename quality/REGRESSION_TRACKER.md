# REGRESSION_TRACKER · 回归基线、执行记录与风险

> 原则：页面能打开 ≠ 业务通过；只记录本轮真实执行。

## 1. 基线

| 项 | 值 |
|---|---|
| 分支 | `stage9/research-driven-refactor` |
| HEAD | `f2a7ce8`（stage10 交付，commit message 自称 219/219） |
| 工作区 | 241 条未提交/未跟踪（审计开始） |
| 活动数据库 | `backend/reprocheck.db`（SQLite） |
| LLM | 未配置（`backend/.env` 不存在） |
| 执行后端 | `none`（无安全沙箱） |

## 2. 本轮执行

### 2.1 后端全量

```text
cd backend
$env:PYTHONPATH="."
.\.venv\Scripts\python -m pytest -q
→ 359 passed, 6 warnings in 58.98s（exit 0）
```

| 指标 | 数量 |
|---|---|
| 通过 | **359** |
| 失败 | 0 |
| 未执行 | 0（全部 collected） |
| 阻塞 | 0 |
| 收集耗时 | 4.08s |

### 2.2 前端门禁

| 命令 | 结果 |
|---|---|
| `npm run typecheck` | exit 0，无 error |
| `npm run build` | exit 0，`✓ built in 6.52s` |
| 主包 | `index-CnO7_JR3.js 313.67 kB / gzip 98.28 kB` |
| 最大路由包 | `ProjectWorkbenchPage 93.75 kB / gzip 30.47 kB` |
| >500 kB 警告 | 无 |

### 2.3 真实用户主流程（11 步）

| 结果 | 数量 | 说明 |
|---|---|---|
| 通过 | **9** | 登录、创建、上传、事实空态、概览、手动规划、新增任务、生成报告、持久化 |
| 部分完成 | **1** | PDF 解析 completed；AI 抽取 `LLM_NOT_CONFIGURED`，0 facts |
| 阻塞 | **1** | 创建/执行运行：无沙箱，`execution_backend=none` |
| 失败 | 0 | 未出现 5xx、页面崩溃 |

### 2.4 浏览器与多尺寸

| 检查 | 结果 |
|---|---|
| 1440×900 主流程 | 通过（除 BUG-004 抽屉操作栏越界） |
| 390×844 横向溢出 | 8 个关键路由 `scrollWidth == clientWidth == 390`，全部无溢出 |
| 页面错误 | 本轮会话 0 个 `pageerror`；0 个 console error（探针记录） |
| 抽屉 | 内容可读；footer 越界（BUG-004） |
| 报告导出 | HTML 200/4,281 B；PDF 501 `PDF_UNAVAILABLE` |

### 2.5 API 探针（鉴权/隔离）

| 结果 | 数量 |
|---|---|
| 符合预期 | 7（无效 token 401、4 角色登录 200、viewer 非成员上传 404、viewer 删除项目 404） |
| **不符合预期** | **7**（匿名读项目/材料/任务/下载 4 个 200；匿名上传 200；匿名删除 200；viewer 上传 200） |
| 基线读数 | 3（lead 创建项目、lead/viewer 项目计数） |
| 清理 | 3 个 QA 项目、6 份材料全部 DELETE 200；清理后残留 0 |

## 3. 与上一轮基线对比

| 项 | 上一轮记录 | 本轮 | 说明 |
|---|---|---|---|
| 后端测试 | 205（README）/219（commit） | **359** | 测试数增长；README 未同步 |
| 前端构建 | 通过 | 通过 | 主包 313.67 kB |
| 安全结论 | stage10 “10/10 隔离、无 token 401” | **匿名可读写** | 口径冲突，见 BUG-006 |
| UI 抽屉 | 未见专门断言 | **footer 越界** | 新增缺陷；疑与页面级 identity transform 有关 |
| LLM 链路 | 无 Key 降级 | 同 | 保持“不造假” |

## 4. 变更面与多智能体冲突

| 区域 | 未提交条目 | 本轮是否触碰 |
|---|---|---|
| `frontend/` | 131 | 否（仅新增 `quality/`） |
| `backend/` | 66 | 否 |
| `docs/` | 20 | 否（新增 `quality/` 文档） |
| `Plan/` | 10 | 否 |
| `.workbuddy/` 等 | 14 | 否 |

- **冲突**：无。QA 未修改任何业务源码、未覆盖他人未提交修改、未合并分支。
- **需要其他智能体处理**：BUG-001/002/003（后端鉴权/RBAC）、BUG-004（前端布局）、BUG-005（前端状态）、BUG-006（文档口径）、BUG-007/008（测试）。

## 5. 回归触发规则（下一轮起）

每次重要变更后必须重跑：

1. `pytest -q` 全量（359 基线）。
2. `npm run typecheck && npm run build`。
3. `quality/tools/api_audit.py`（鉴权/隔离 4 个关键断言）。
4. 受影响页面 Playwright（材料抽屉、项目列表、权限按钮）。
5. 涉及 schema 变更时追加迁移与旧数据读取测试。
6. 涉及 auth/RBAC 时追加角色矩阵（viewer/researcher/reviewer/lead）。

## 6. 未执行/无法执行

- 真实 LLM 抽取与规划（无 Key）。
- 真实执行沙箱、Docker/GVisor 隔离。
- 30 条全路由自动遍历（本轮只走主流程 11 步；上一轮 38/38 结果不作为本轮证据）。
- 并发/压力/长稳。
- 移动真机、Safari/Firefox。
- 备份恢复、权限渗透工具扫描。
