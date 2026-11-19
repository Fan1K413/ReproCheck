# 第九阶段 · 技术设计与验收标准

分支：`stage9/research-driven-refactor`（从 `stage9-baseline` / `33b6a5c` 分出）。日期 2026-11-19。

## 决策依据
见 `STAGE9_UPGRADE_DECISION.md`（8 候选 8 维评分）与四份调研报告。落地 U1/U2/U4，不做 U3/U5/U7/U8（列 P1/P2）。

---

## U1 · 统一可信结论层

### 问题（事实）
结论状态在 4+ 子系统割裂：`conflict/consistent/missing`（`schemas/__init__.py:120`）、`supported/unsupported/needs_review`（`schemas/parsing.py:131`）、`exact_match/...`（`reproduction/schemas.py:17`）、`unverified/...`（benchmark），前端各用一套标签（`stage2Meta.ts`、`reproductionMeta.ts`）。用户无法用一个口径回答"验证到什么程度"。

### 设计（增量聚合，不推翻既有枚举）
1. 新模块 `backend/app/services/verdict_service.py`：
   - 五态 `VERIFIED / PARTIALLY_VERIFIED / INSUFFICIENT_EVIDENCE / CONFLICTING / UNVERIFIABLE`（中文标签）。
   - ACM 三维解耦：`material_available`（材料可获取）、`artifact_assessed`（工件已评估，再分 functional/reusable）、`results_validated`（结果已验证，再分 reproduced/replicated）。
   - `map_to_verdict(source_system, raw_status) -> verdict` 纯函数，覆盖上述 4 套旧枚举；未知值 → INSUFFICIENT_EVIDENCE，不猜测。
   - `build_project_verdict(db, project_id) -> dict`：只读聚合该项目的事实（supported/needs_review/unsupported）、比较（conflict/consistent/missing）、复现 verdict、benchmark quality、证据定位完整率；输出各维度 counts + 五态分布 + `scope_note`（"仅基于 ReproCheck 自身验证范围，未做独立实验复现，不构成任何机构认证"）。
2. 新 API `GET /api/v1/projects/{project_id}/verdict-summary`（项目隔离 + get_current_user）。
3. 前端新增 `VerdictBadge` 组件统一五态颜色/文案，在 FactsPage 汇总区与 OverviewPage 使用；旧状态保留原显示，不删除。
4. 数据库：**无变化**（聚合只读），无需迁移/回滚脚本。

### 验收标准
- map_to_verdict 对 4 套枚举各至少 1 个映射测试 + 未知值测试；
- build_project_verdict 对真实项目返回五态 counts 与三维状态，scope_note 含认证声明；
- API 认证/越权测试（401/404）；
- 前端至少 1 处主流程用 VerdictBadge 且 typecheck/build 通过。

---

## U2 · 能力驾驶舱（接通已有后端能力）

### 问题（事实）
15 个新增端点前端只接 2 个；交接包/图表验证/验证分层/基准计算/任务暂停恢复/生产自检无入口（`STAGE9_BASELINE_FACTS.md`）。

### 设计（最小前端改动，真实 API 调用）
1. `frontend/src/services/api.ts` 与 `reproductionApi.ts` 补齐 client：`getEvidenceGraph`(已有)、`getVerdictSummary`、`exportHandoff`、`validateHandoff`、`runChartVerification`、`getVerificationLayers`、`runStaticAnalysis`、`runRecompute`、`computeBenchmarkMetrics`、`pauseTask`、`resumeTask`、`recoverStale`、`getProductionCheck`。全部走统一 request（自带 Bearer + 错误码）。
2. 新建 `frontend/src/pages/ProjectVerificationPage.tsx`（路由 `projects/:projectId/verification`，侧栏"项目验证"组）：三个 Tab 或分区——
   - **可信结论**：调 U1 verdict-summary，用 VerdictBadge 展示五态与三维；
   - **证据与图表验证**：调 chart-verification，展示已提取的表格数值/图注/plot 调用/结果值与 insufficient_data 提示；展示 evidence-graph 摘要（已有页面可链接）；
   - **验证引擎**：调 verification/layers 展示五层职责与是否执行；提供静态分析代码输入与数值重算输入（真实调用 API，展示返回结果）。
3. 新建 `frontend/src/pages/HandoffPage.tsx`（路由 `projects/:projectId/handoff`）：导出 ZIP（带 token 下载）、上传 ZIP 校验（展示 manifest 摘要、valid、import_mode 提示）。
4. 解析任务页 `ParseTasksPage.tsx` 增加 pause/resume 按钮（调真实 API）；批量恢复入口放在项目验证页（需 project_id）。
5. 基准指标计算入口放在 BenchmarkPage 或项目验证页（调 compute  API，展示 P/R/F1）。
6. 侧栏加两项导航（项目验证、交接包），无项目时退化为 /projects（沿用现有模式）。

### 验收标准
- 至少 4 项能力有可点击按钮且触发真实 fetch（代码审查+typecheck 确认，非纯静态）；
- 下载/上传走 Bearer；错误态/加载态/空态齐全；
- 不引入新依赖；typecheck/build 通过；后端测试不受影响。

---

## U4 · README 与新用户引导

### 设计
- README 重写：真实阶段（第六阶段 + 第九阶段调研重构）、真实能力清单（三态：已测试/仅 API/未实现）、快速开始、能力—入口—状态表、安全边界（不执行代码、需 LLM Key）。
- 保留启动命令与目录结构，不删除用户需要的操作说明。

### 验收标准
- README 不再出现"第一阶段""仅合成材料"等过时表述；
- 能力与 `STAGE6_REAL_STATUS.md` 一致；typecheck 无关。

---

## 全局约束与回滚
- 独立分支 `stage9/research-driven-refactor`；基线 tag `stage9-baseline`；
- 数据库无变化；回滚 = `git reset --hard stage9-baseline`（仅限本分支内的本阶段提交）；
- 不执行第三方代码；不购买服务；不伪造论文结果；
- 实施后由独立测试代理验收（第八步）。
