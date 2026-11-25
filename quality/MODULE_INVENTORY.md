# MODULE_INVENTORY · 模块清单与真实状态

> 口径：**已测试**＝本轮真实跑过并留下证据；**有自动化测试**＝仓库 pytest 中存在对应用例；
> **未验证**＝本轮未执行，不因“代码存在/页面能开”判为通过；**未实现**＝无接口或无入口。

## A. 身份与项目域

| 模块 | 后端实现 | 前端入口 | 测试 | 本轮实测 | 状态 / 缺口 |
|---|---|---|---|---|---|
| 注册/登录/JWT | `api/v1/auth.py`、`services/auth_service.py` | `/login` | `test_stage6_auth.py`(7)、`test_bugfix_auth_boundary.py`(3) | 4 个演示账号登录 200；无效 token `/auth/me` 401 | 可用；**默认 `jwt_secret` 为开发值** |
| 组织/成员/角色 | `orgs.py`、`roles.py`、`core/rbac.py`、`collab.py` | `/orgs`、`/roles` | `test_stage6_auth.py`、`test_stage6_governance.py` | 仅角色权限矩阵静态核对；未跑组织管理 UI | 部分验证；**viewer 写权限未在后端强制** |
| 项目列表/创建/删除 | `api/v1/projects.py`（仅 3 个操作） | `/projects`、`/projects/new` | 无独立 `test_projects.py`；auth/governance 间接覆盖 | UI 创建成功；列表重进可见；DELETE 级联清理 3 个 QA 项目成功 | **缺项目详情 GET、项目编辑 PATCH**；列表匿名可读（BUG-001） |
| 项目隔离 | `api/isolation.py`、`deps.resolve_project_access` | — | `test_stage6_auth.py`、`test_bugfix_auth_boundary.py` | viewer 非成员上传 → 404；viewer 删除他项目 → 404；匿名 → 200 放行 | 已登录隔离有效；**匿名绕过**（BUG-001） |

## B. 材料与解析域

| 模块 | 后端实现 | 前端入口 | 测试 | 本轮实测 | 状态 / 缺口 |
|---|---|---|---|---|---|
| 材料上传/列表/下载/删除 | `materials.py`、`material_service.py` | `/projects/:id/materials`、`/materials/:id` | `test_stage2_api.py`(4)、`test_parsers.py`(26) | 4 文件（PDF/CSV/PY/YAML）上传成功；详情抽屉可读；PDF 下载匿名 200/486 B | 功能可用；**匿名上传/删除 200，viewer 上传 200**（BUG-002/003） |
| PDF/代码/配置解析器 | `parsers/`（pdf、python、config、notebook、data、zip、readme） | 材料页 | `test_parsers.py`(26) | `sample.pdf` 真实解析：16 块、3.73 KB、耗时 143–260 ms | 已测试；扫描版 OCR、超大文件未跑 |
| 解析任务编排 | `parse_tasks.py`、`services/task_service.py` | `/projects/:id/tasks` | `test_task_orchestration.py`(10)、`test_orchestration_state.py`(11) | 无 Key：`partially_completed`，错误码 `LLM_NOT_CONFIGURED`，耗时 143 ms | 可用；暂停/恢复/超时未在本轮重跑 |
| AI 事实抽取 | `services/extraction_service.py`、`api/v1/facts.py` | `/projects/:id/facts` | `test_extraction.py`(6)、`test_llm.py`(8) | 0 事实；页面明确显示空态，无假数据 | **阻塞**：无真实 LLM Key |
| 证据图谱/逐字定位 | `evidence_gaps.py`、`rag.py`、事实模型 | `/projects/:id/evidence-graph` | `test_extraction.py`、`test_research_features.py`(4) | 未跑（无事实可定位） | 未验证 |

## C. 审计与复现域

| 模块 | 后端实现 | 前端入口 | 测试 | 本轮实测 | 状态 / 缺口 |
|---|---|---|---|---|---|
| 审计规则/生命周期 | `rules.py`、`rule_service.py`、`docs/AUDIT_RULE_LIFECYCLE.md` | `/rules` | `test_stage6_rules.py`(10) | 未跑 UI | 有自动化测试 |
| 确定性失败诊断 | `reproduction/deterministic_diagnosis.py`、`diagnostics.py` | `/projects/:id/reproduction/diagnostics` | `test_deterministic_diagnosis.py`(9) | 未跑 | 有自动化测试 |
| 复现规划（AI） | `reproduction/planner.py`、`reproductions.py` | `/projects/:id/reproduction` | `test_stage4.py`(20)、`test_stage4_api.py`(6) | 未配置 Key：AI 规划不可用；UI 提供「手动新建规划」 | 可用（手动）；AI 规划**阻塞** |
| 规划任务/DAG | `reproductions.py`、`reproduction/schemas.py` | `/reproductions/plans/:id` | `test_stage4.py` | 手动规划 + 新增任务成功：`任务 1 / T01 / 待执行` | 可用；`needs_human_confirm` 未确认 |
| 复现运行/执行 | `reproductions.runs`、`reproduction/sandbox.py` | `/reproductions/runs/:id` | `test_stage4.py`、`test_workflow_integration.py`(11) | 无安全沙箱，UI 明确「禁用执行」；本轮未创建新运行 | **阻塞**：执行后端默认 `none` |
| 执行环境管理 | `reproductions` 仅 `GET /environments` | `/projects/:id/reproduction/environment` | `test_stage4.py` | 仅页面可打开，未创建/销毁 | **能力缺口**：无环境创建/锁定/销毁 API |
| 指标抽取/结果对照 | `reproduction/results.py`、`metric-comparisons` | `.../comparison` | `test_comparison.py`(6) | 无运行输出，未跑 | 未验证 |
| 复现报告 | `reproduction/report.py`、`reproductions.reports` | `/projects/:id/reproduction/reports` | `test_stage4.py` | 真实生成 `rreport-…`：14 章、HTML 200/4,281 B；PDF 501 `PDF_UNAVAILABLE` | 可用（无运行数据仍出报告）；PDF 不可用 |
| 项目交接包 | `handoff.py`、`handoff_service.py` | `/projects/:id/handoff` | `test_handoff.py`(10) | 未跑 | 有自动化测试；导入只校验未写库 |
| 基准与指标 | `benchmark_metrics.py`、`benchmark_service.py` | `/benchmark`、`/benchmark/:caseId` | `test_stage6_benchmark.py`(12)、`test_benchmark_metrics.py`(14) | 未跑 UI；库内 4 个 case | 有自动化测试 |
| 统计审计 | `statsaudit/`（core/design/metrics） | `/stats-audit` | 81 项（core 40、metrics 19、design 15、integration 7） | 未跑 UI | 后端测试最充分域之一 |
| 数据审计 | `dataaudit/` | `/projects/:id/data-audit` | `test_data_audit.py`(10) | 未跑 | 有自动化测试 |
| 图表反向验证/验证层 | `chart_verification.py`、`verification_layers.py` | `/projects/:id/verification` | 14 + 18 项 | 未跑 | 有自动化测试 |

## D. 平台与协作域

| 模块 | 后端实现 | 前端入口 | 测试 | 本轮实测 | 状态 / 缺口 |
|---|---|---|---|---|---|
| 知识库/RAG | `knowledge.py`、`rag.py`、`knowledge_service.py` | `/knowledge` | `test_research_features.py` 等 | 未跑 | 有 API/UI，未验证 |
| 协作/评论/复核 | `collab.py`、`feedback.py`、`governance.py` | `/projects/:id/team`、`/feedback`、`/governance` | `test_stage6_governance.py`(6) | 未跑 | 浏览器 E2E 缺口（stage10 文档亦承认） |
| 生命周期/数据集/稿件 | `lifecycle.py`（19 操作） | **无独立前端路由** | 无专属测试文件 | 未跑；OpenAPI 有 datasets/designs/experiments/manuscripts | **前后端落差**：API 有、UI 无入口 |
| 代码仓库集成 | `integrations.py`（connect/sync/snapshots/revoke） | `/integrations` | `test_stage6_integrations.py`(8) | 未跑；无 clone API | 仅连接+快照，不克隆代码 |
| 模型中心/LLM 设置 | `modelhub/`、`llm.py` | `/settings/models`、`/settings/llm` | `test_modelhub.py`(16)、`test_llm.py`(8) | 未配置 Key；`/llm/status` 未跑 | 可用但未连通真实模型 |
| API Token/开放 API | `api_tokens.py`、`open_v1.py` | `/api-tokens` | 无专属测试 | 未跑 | 需补契约/撤销测试 |
| 助手/演示审计 | `assistant.py`、`demo.py` | `/projects` 助手入口、`/demo/audit` | `test_assistant_intent.py`(5) | 未跑；demo 依赖 LLM，预期 503 | 部分可用 |

## 能力缺口（非缺陷，按第七阶段要求如实登记）

1. **项目编辑**：无 `PATCH/PUT /projects/{id}`，也无独立项目详情 GET；前端仅靠列表数据。
2. **数据集独立管理**：有 `lifecycle` API（datasets GET/POST/PATCH），无前端路由与页面。
3. **仓库克隆/分支/Commit 固定**：仅有仓库连接、同步、快照；无 clone、无 branch/commit 固定接口。
4. **执行环境创建/锁定/销毁/复用**：只有环境列表 GET；无创建/销毁/复用接口。
5. **实验暂停**：解析任务支持暂停/恢复；复现运行只有 cancel，无 pause/resume。
6. **真实执行**：`execution_backend=none`，无 Docker/GVisor；运行创建会被安全策略阻塞。
7. **OCR/扫描版 PDF**：解析器可标记 `needs_ocr`，无 OCR 图像级识别。
8. **真实 LLM 链路**：无 Key，AI 抽取/规划/演示审计全部阻塞（明确 503/partial，不造假）。

## 状态汇总

- 有自动化测试覆盖的模块：认证、隔离、材料/解析、任务编排、复现规划/运行、诊断、规则、基准、统计审计、数据审计、交接、协作、模型中心等。
- 本轮真实跑通的用户链路：项目创建 → 4 类材料上传 → PDF 解析（partial）→ 事实空态 → 概览 → 手动规划 → 新增任务 → 14 章报告 → 重进持久化。
- 未跑/阻塞：真实 LLM、真实执行、环境创建、数据集 UI、仓库克隆、并发/压力、移动真机。
