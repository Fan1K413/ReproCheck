# 第九阶段 · 项目基线事实（主控实测，非调研代理结论）

核查时间：2026-11-19 17:36。工作区干净（0 处未提交），无其他阶段并发修改。

## Git 与规模
- 分支 `stage4/reproduction-engine`，HEAD `33b6a5c`（第六阶段 bug 修复提交）。
- 提交链：`01c878c`→`90a4830`→`1d32f51`→`ae339ce`→`db47864`→`ec46431`→`827e8fa`→`33b6a5c`。
- 标签：`stage6-checkpoint-preflight`、`stage6-core-complete`、`stage6-gap-closure`；本阶段基线标签 `stage9-baseline`（指向 33b6a5c）。
- 规模：docs/ 下 79 份 Markdown；后端测试函数 200 项（全量 pytest 205 passed，含参数化）。
- README 仍称"第一阶段"、输入为"合成测试材料"——与当前第六阶段实现严重不同步（体验问题）。

## 前后端能力落差（主控 grep 实测，事实）
后端已注册 15 个新增端点：
```
/api/v1/benchmark/metrics/compute, /schema
/api/v1/diagnosis/categories, /classify, /production-check
/api/v1/parse-tasks/recover-stale, /{id}/pause, /{id}/resume
/api/v1/projects/{id}/chart-verification
/api/v1/projects/{id}/evidence-graph
/api/v1/projects/{id}/handoff/export, /validate
/api/v1/verification/layers, /recompute, /static-analysis
```
前端 `frontend/src` 中真正接入的只有 2 个：
- `evidence-graph`（App.tsx 路由 + EvidenceGraphPage + FactsPage 跳转 + api.ts client）
- `diagnosis/classify`（reproductionApi.ts + DeterministicDiagnosisPanel 挂在诊断页）

**没有前端入口**的能力（后端有 API、用户无法从界面使用）：交接包导出/校验、图表反向验证、验证引擎分层面板、基准指标计算、生产安全自检、任务暂停/继续/批量恢复。

这是"后端能力远超前端可达性"的真实结构性缺口——用户即使有 API 也难以发现或使用这些功能。

## 互联网可达性（用户要求明确报告）
- WebFetch 实测 MLflow 官方文档 `https://mlflow.org/docs/latest/index.html` 成功返回真实内容，联网可用。
- 四组调研代理（GitHub 开源 / 学术规范 / 竞品定位 / 项目审计）正在联网工作，报告产出后由主控汇总。

## 状态口径
本文件只记录主控直接观察到的事实；调研结论、竞品能力、规范解读以各调研代理带来源链接的报告为准。禁止把推测写成已验证事实。
