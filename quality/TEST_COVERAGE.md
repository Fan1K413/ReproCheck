# TEST_COVERAGE · 测试体系与覆盖缺口

> 本轮只统计**已执行**的用例；未安装 coverage.py，未测量行覆盖率，不伪造百分比。

## 1. 后端

- 位置：`backend/app/tests/`（注意：不在 `backend/tests/`）
- 文件：34 个
- 用例：**359**
- 本轮结果：359 passed / 0 failed / 6 warnings / 58.98s
- 测试基础设施：`conftest.py` 内存 SQLite + `httpx.ASGITransport` + LLM mock

### 1.1 用例数量分布（Top）

| 文件 | 用例 | 文件 | 用例 |
|---|---|---|---|
| `test_statsaudit_core.py` | 40 | `test_stage6_rules.py` | 10 |
| `test_parsers.py` | 26 | `test_handoff.py` | 10 |
| `test_stage4.py` | 20 | `test_data_audit.py` | 10 |
| `test_statsaudit_metrics.py` | 19 | `test_task_orchestration.py` | 10 |
| `test_verification_layers.py` | 18 | `test_deterministic_diagnosis.py` | 9 |
| `test_modelhub.py` | 16 | `test_stage6_integrations.py` | 8 |
| `test_statsaudit_design.py` | 15 | `test_llm.py` | 8 |
| `test_benchmark_metrics.py` | 14 | `test_statsaudit_integration.py` | 7 |
| `test_chart_verification.py` | 14 | `test_stage6_auth.py` | 7 |
| `test_verdict_service.py` | 12 | `test_extraction.py` | 6 |
| `test_stage6_benchmark.py` | 12 | `test_comparison.py` | 6 |
| `test_workflow_integration.py` | 11 | `test_stage4_api.py` | 6 |
| `test_orchestration_state.py` | 11 | `test_stage6_governance.py` | 6 |

### 1.2 覆盖到的模块

认证/隔离、材料/解析、任务编排、复现规划/运行、诊断、规则、交接、协作治理、基准、统计审计、数据审计、图表验证、模型中心、生产安全检查。

### 1.3 明确缺口

| 缺口 | 证据 |
|---|---|
| 无独立 `test_projects.py` | `projects` 仅 3 个操作，创建/删除由 auth/governance 间接覆盖 |
| 材料上传/删除的**权限矩阵**无用例 | 本轮实测 viewer/匿名可写，测试未拦住 |
| 匿名边界无用例 | `allow_unauth` 放行未被视为失败 |
| 项目编辑/详情不存在 | 无接口，无法测 |
| 数据集/环境/仓库克隆 | 无对应 API 或仅 GET，测试为空 |
| 报告 PDF | 501 行为无测试 |
| 前端 0 单测/0 正式 E2E | `frontend/package.json` 无 test 脚本 |

## 2. 前端

| 项 | 值 |
|---|---|
| 单元测试框架 | 无（无 vitest/jest） |
| 正式 E2E 套件 | 无 |
| 现有脚本 | 本轮新增 `quality/tools/user_journey.mjs`（1 条主流程） |
| 门禁 | `tsc --noEmit` + `vite build` |
| 页面 | 39 条路由、40 个页面文件 |
| 覆盖情况 | 登录、创建、上传、事实空态、概览、规划、任务、报告、持久化；**未覆盖**权限按钮、抽屉 footer、错误态、空库、并发 |

## 3. 本轮真正验证到的行为

| 行为 | 结果 | 证据 |
|---|---|---|
| 演示账号登录 | 4/4 200 | api-audit |
| 无效 token | 401 | api-audit |
| 非成员上传 | 404 | api-audit |
| 匿名读/写/删 | 200（缺陷） | api-audit + 补测 |
| PDF 解析 | 16 chunks，completed | 任务页/DB |
| 无 Key 抽取 | partial + 0 facts | 任务页 |
| 手动规划 | 1 份 draft | DB/UI |
| 新增任务 | T01 | UI |
| 报告生成 | 14 章 HTML 200 | DB/UI |
| 重进持久化 | 4/4 材料仍在 | UI |
| 390 宽溢出 | 0/8 路由溢出 | Playwright |

## 4. 建议补齐的测试（按优先级）

1. **权限矩阵**：viewer/researcher/reviewer/lead 对 upload/parse/delete/report/run 的 403/200 表。
2. **匿名边界**：未登录访问 projects/materials/tasks/download/upload 全部 401。
3. **抽屉布局**：1440/1180/390 三档断言 footer bottom ≤ viewport。
4. **材料状态语义**：completed vs partially_completed vs failed 的 UI 文案。
5. **报告契约**：14 章 key、sources、PDF 501 错误码。
6. **前端 E2E**：登录→创建→上传→解析→规划→报告→重进。
7. **并发/限流**：登录与上传 429/413 行为。

## 5. 未测量

- 行覆盖率/分支覆盖率（未安装 coverage/pytest-cov）。
- 变异测试、模糊测试、契约测试（schemathesis）。
- 生产环境性能与可用性。
