# ReproCheck V3 路由清单与页面改造台账

> 路由源：`frontend/src/App.tsx`。动态参数示例使用当前演示数据：`proj-209c77cd39f94212`、`plan-b4bbf8748a2d41`、`run-5acdb8cd27d946`、`mat-e305657ae1924224`、`case-c3d8a5d22038455c`。

## A. 可访问业务路由（40）

| # | 路由 | 页面 / 功能 | 源文件 | V3 状态 |
|---:|---|---|---|---|
| 1 | `/login` | 原生登录/注册 | `pages/auth/LoginPage.tsx` | 已重建 |
| 2 | `/` | 径向主工作台 | `workbench/WorkbenchPage.tsx` | 最高基准 |
| 3 | `/projects` | 项目档案 / 关联聚焦 | `pages/ProjectsPage.tsx` | 原生 Wave 页 |
| 4 | `/projects/new` | 新建项目 | `pages/ProjectNewPage.tsx` | 原生 Wave 页 |
| 5 | `/projects/:projectId/workbench` | Bloom 项目工作台 | `pages/ProjectWorkbenchPage.tsx` + `src/bloom/*` | 原生项目空间 |
| 6 | `/settings/llm` | AI 模型服务 | `pages/LlmSettingsPage.tsx` | 已并入深色体系 |
| 7 | `/settings/models` | 模型管理中心 | `pages/ModelCenterPage.tsx` | 原生 Wave 页 |
| 8 | `/demo/audit` | 审计演示 | `pages/DemoAuditPage.tsx` | 原生 Wave 页 |
| 9 | `/projects/:projectId/materials` | 材料管理 / 上传 / 解析 | `pages/MaterialsPage.tsx` | 原生 Wave 页 |
| 10 | `/materials/:materialId` | 材料详情 | `pages/MaterialDetailPage.tsx` | 原生 Wave 页 |
| 11 | `/projects/:projectId/tasks` | 解析任务 | `pages/ParseTasksPage.tsx` | 原生 Wave 页 |
| 12 | `/projects/:projectId/facts` | 科研事实 | `pages/FactsPage.tsx` | 原生 Wave 页 |
| 13 | `/projects/:projectId/evidence-graph` | 证据图谱 | `pages/EvidenceGraphPage.tsx` | 原生 Wave 页 |
| 14 | `/projects/:projectId/overview` | 解析概览 | `pages/OverviewPage.tsx` | 原生 Wave 页 |
| 15 | `/projects/:projectId/verification` | 项目验证 | `pages/ProjectVerificationPage.tsx` | 原生 Wave 页 |
| 16 | `/projects/:projectId/handoff` | 交接包 | `pages/HandoffPage.tsx` | 原生 Wave 页 |
| 17 | `/projects/:projectId/experiments/diff` | 实验差异 | `pages/ExperimentDiffPage.tsx` | 原生 Wave 页 |
| 18 | `/projects/:projectId/change-monitor` | 变化监控 | `pages/ChangeMonitorPage.tsx` | 原生 Wave 页 |
| 19 | `/projects/:projectId/data-audit` | 数据质量审计 | `pages/DataAuditPage.tsx` | 原生 Wave 页 |
| 20 | `/stats-audit` | 统计审计 | `pages/StatsAuditPage.tsx` | 原生 Wave 页 |
| 21 | `/projects/:pid/reproduction` | 复现总览 | `pages/reproduction/ReproductionOverviewPage.tsx` | 原生 Wave 页 |
| 22 | `/reproductions/plans/:planId` | 复现规划 DAG | `pages/reproduction/ReproductionPlanPage.tsx` | 原生 Wave 页 |
| 23 | `/projects/:pid/reproduction/environment` | 复现环境 | `pages/reproduction/ReproductionEnvironmentPage.tsx` | 原生 Wave 页 |
| 24 | `/reproductions/runs/:runId` | 执行控制台 | `pages/reproduction/ReproductionConsolePage.tsx` | 原生 Wave 页 |
| 25 | `/projects/:pid/reproduction/comparison` | 结果对照 | `pages/reproduction/ReproductionComparisonPage.tsx` | 原生 Wave 页 |
| 26 | `/projects/:pid/reproduction/diagnostics` | AI 诊断 | `pages/reproduction/ReproductionDiagnosticsPage.tsx` | 原生 Wave 页 |
| 27 | `/projects/:pid/reproduction/reports` | 报告中心 | `pages/reproduction/ReproductionReportsPage.tsx` | 已并入深色体系 |
| 28 | `/orgs` | 组织与成员 | `pages/stage6/OrganizationsPage.tsx` | 已并入深色体系 |
| 29 | `/roles` | 角色权限 | `pages/stage6/RolesPage.tsx` | 已并入深色体系 |
| 30 | `/projects/:projectId/team` | 项目团队 | `pages/stage6/ProjectTeamPage.tsx` | 已并入深色体系 |
| 31 | `/benchmark` | 基准案例库 | `pages/stage6/BenchmarkPage.tsx` | 已并入深色体系 |
| 32 | `/benchmark/:caseId` | 案例详情 | `pages/stage6/CaseDetailPage.tsx` | 已并入深色体系 |
| 33 | `/fact-schema` | 事实字段目录 | `pages/stage6/FactSchemaPage.tsx` | 原生 Wave 页 |
| 34 | `/rules` | 审计规则 | `pages/stage6/RulesPage.tsx` | 已并入深色体系 |
| 35 | `/feedback` | 反馈治理 | `pages/stage6/FeedbackPage.tsx` | 已并入深色体系 |
| 36 | `/knowledge` | 知识检索 | `pages/stage6/KnowledgePage.tsx` | 原生 Wave 页 |
| 37 | `/integrations` | 外部集成 | `pages/stage6/IntegrationsPage.tsx` | 已并入深色体系 |
| 38 | `/api-tokens` | API 令牌 | `pages/stage6/ApiTokensPage.tsx` | 已并入深色体系 |
| 39 | `/governance` | 数据治理 | `pages/stage6/GovernancePage.tsx` | 已并入深色体系 |
| 40 | `*` | 路由兜底 → `/` | `App.tsx` | 原生工作台 |

## B. Bloom 项目空间视图

| 视图 | URL | 源文件 | V3 状态 |
|---|---|---|---|
| 绽放舞台 | `/projects/:id/workbench` | `bloom/BloomWorkbench.tsx`, `BloomStage.tsx`, `BloomCard.tsx` | 原生组件 |
| 单元聚焦 | `/projects/:id/workbench?focus=materials` | `bloom/BloomWorkbench.tsx`, `unitDetails.tsx` | 原生组件 |
| 工坊 | `/projects/:id/workbench?view=atelier` | `bloom/BloomAtelier.tsx` | 原生组件 |
| 证据织机 | `/projects/:id/workbench?view=loom` | `bloom/EvidenceLoom.tsx` | 原生 Canvas/SVG |

## C. 未挂载历史页

- `frontend/src/pages/DashboardPage.tsx`：当前 `App.tsx` 未挂载，不作为可访问页面验收；保留源码，不删除业务资产。

## D. 页面级浅色皮肤清理

以下页面已移除 `data-rc-skin="light"`，统一使用主工作台深色语义 token：

- `LlmSettingsPage.tsx`
- `ReproductionReportsPage.tsx`
- `stage6/ApiTokensPage.tsx`
- `stage6/BenchmarkPage.tsx`
- `stage6/CaseDetailPage.tsx`
- `stage6/FeedbackPage.tsx`
- `stage6/GovernancePage.tsx`
- `stage6/IntegrationsPage.tsx`
- `stage6/OrganizationsPage.tsx`
- `stage6/ProjectTeamPage.tsx`
- `stage6/RolesPage.tsx`
- `stage6/RulesPage.tsx`

## E. 验收证据

- V3 独立浏览器验收：`frontend/scripts/v3-no-legacy-verify.mjs`
- 截图与 JSON：`.screenshots/v3-final/`, `.screenshots/v3-final-report.json`
