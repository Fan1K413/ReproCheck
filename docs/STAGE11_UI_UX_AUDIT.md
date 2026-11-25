# 交付 6：全局 UI/UX 缺陷清单（第十一阶段）

## 检查方法

1. 用内置浏览器实际登录（lead@reprocheck.demo）并遍历 10 条主要路由：
   `/`、`/projects`、`/settings/llm`、`/settings/models`、两个新功能页、`/rules`、`/knowledge`、
   `/governance`、`/api-tokens`。每条检查渲染、控制台错误、DOM 根节点。
2. 运行既有 `frontend/scripts/verify_ui.mjs`（headless Edge，桌面 + 移动视口，38 步交互）。
3. 在模型管理中心实际执行"添加凭据 → 自动连接测试 → 列表脱敏 → 错误状态展示"。
4. 不是只靠代码阅读；以下缺陷均来自真实浏览器操作或浏览器采集的后端 500。

## 发现的缺陷与修复

| # | 缺陷 | 证据 | 修复 |
|---|---|---|---|
| 1 | 模型管理中心创建凭据后提示"正在发起真实连接测试…"永久不消失 | 浏览器 DOM 显示该提示；网络记录无 `/test` 请求 | `ModelCenterPage.tsx` 的 `createCred.onSuccess` 真正调用 `testCred.mutate(data.id)`；已复测，提示被 `auth_failed` 结果替换 |
| 2 | 新增"变更重审草稿"后 `GET /reproductions/plans` 返回 500，复现总览"规划"链接消失 | 后端日志 `TypeError: unsupported operand type(s) for +: 'int' and 'str'` at `reproductions.py:63`；verify_ui 步骤 `repro:plan+run-detail` 失败 | `_plan_view.task_count` 只对数值字段求和，描述性摘要字段不再触发异常；复测 verify_ui 38/38，consoleErrors=0 |
| 3 | 鉴权失败提示仍写"请检查后端 LLM_API_KEY"，与用户自配凭据矛盾 | 浏览器测试结果面板文案 | `InvalidKeyError` 默认文案改为"请检查该模型凭据的配置" |
| 4 | `/settings/llm` 只读且无进入配置中心的入口 | 页面审查 | 增加「配置自己的模型 →」链接，侧栏增加「模型管理中心」入口 |

## 复测结果

- `node scripts/verify_ui.mjs`：**STEPS 38/38 ok，consoleErrors 0，pageErrors 0，failedRequests 0**。
- 浏览器 10 路由巡检：全部 `hasRoot=true`，无未捕获错误。
- 窄屏：`verify_ui.mjs` 的 `mobile:viewport` 步骤 ok。
- 浏览器前进/返回：遍历时使用 `navigate`，RequireAuth 与 AppLayout 正常重挂载；未发现状态残留。

## 仍未解决 / 需专项处理（不宣称已修复）

- 模型管理中心的"自动路由决策记录"只提供 API 与接口，Site 版不执行路由（无运行时）。
- 部分老页面（如 ParseTasksPage 1.5s 轮询）在标签页隐藏时仍轮询；本阶段未做全局轮询治理，避免大范围回归。
- 没有做多用户并发操作的浏览器实测（时间限制），仅做了 API 层凭据归属隔离测试。
- UI 的"错误提示可见时长 4.2 秒"可能在用户离开页面后错过；未改为持久错误列表。
