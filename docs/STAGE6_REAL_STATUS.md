# 第六阶段 · 前期成果真实状态清单

审计时间：2026-11-19。审计依据：当前工作树源码、实际运行结果、后端/前端盘点代理的 `文件:行号` 证据。
状态口径：`PASS-TESTED`（有通过的真实运行证据）/ `IMPL-UNTESTED`（代码存在但未按真实流程测通）/ `PARTIAL`（部分子能力成立）/ `UI-ONLY`（仅有界面/展示）/ `MISSING`（未实现）。
**禁止把文件存在、函数可调、路由可访问等同于功能完成。** 旧 `STAGE7_*` 报告的"未实现"结论是历史快照，不能覆盖当前源码事实；同样，当前源码存在也不等于流程可用。

## 0. 基线与检查点

| 项 | 事实 |
|---|---|
| 初始 HEAD | `1d32f5133346a3d2c6b4de3103ed829f983319de`（3 个提交） |
| 检查点提交 | `ae339ceb13ffca1ed7558fed56c1a0633fb0f89e`，含 Stage5/6 全部源码与文档，已排除 ZIP/截图/报告/临时目录 |
| 回退标签 | `stage6-checkpoint-preflight` |
| 工作区 | 检查点后干净；所有既有未提交改动均已被纳入检查点，未丢弃 |
| 后端测试基线 | 120 passed（pytest，`.venv`，含本轮证据图谱） |
| 前端基线 | typecheck 通过；build 通过（1691 modules，bundle >500KB 警告） |

## 1. 十一个重点能力真实状态

| 能力 | 状态 | 已核验事实（证据） | 缺口（不得冒称完成） |
|---|---|---|---|
| 科研复现任务编排器 | PARTIAL | `models/stage2.py:62-88` ParseTask 有 queued→parsing→extracting→completed/failed 状态、`idem_key` 幂等、`cancel_requested`；`services/task_service.py:40-288` start/run/retry/cancel 真实实现 | 缺暂停/继续、超时字段与执行、服务重启后 in-flight 任务恢复；`stage4` 的 ReproductionRun 有 cancel_requested（`models/stage4.py:82-104`）但无真实执行器 |
| 论文图表反向验证 | MISSING | `parsers/pdf_parser.py:69-210` 只抽文本块、记录 `table_pages`，明确无 OCR；`reproduction/results.py:20-97` 只做标量指标正则提取+容差对比 | 无表格单元格/图注提取、无绘图逻辑检索、无结果图/CSV 关联、无重绘对比、无人工校正；**不得声称图表已精确复核** |
| 复现失败诊断中心 | PARTIAL | `models/stage4.py:191-221` FailureDiagnostic/RemediationProposal/RemediationReview 表；`api/v1/reproductions.py:386-417` create_diagnostic/review_remediation 路由 | 有数据结构，但错误分类标准、候选原因置信度、原始日志/环境/命令字段、修复是否验证闭环未做真实 E2E |
| 项目交接包导出/导入 | PARTIAL | `api/v1/governance.py:45-58` 3 个导出路由；`services/governance_service.py:147-170` 生成 ZIP | 仅本人项目元数据+事实清单+README，**不含**论文/代码/配置/数据/环境/报告/日志/结果/未解决问题/修复历史；无导入；无 ZIP 完整性校验；无 `data.manage` 权限 |
| 审计结论申诉与复核 | PARTIAL | `api/v1/feedback.py`、`api/v1/rules.py`、`remediation review` 路由存在 | 缺"接受/质疑/补充证据/重新检查/复核报告"完整状态链与不可篡改历史；未 E2E |
| 独立验证引擎分层 | PARTIAL | `services/rule_eval.py`、`rule_service.py` 确定性规则；`reproductions` 有安全预检；execution 默认关闭（`core/config.py:56-63`） | 五层职责未显式分层建模；静态代码分析、数值重算、AI 层边界与可信度标注未系统实现；动态执行无可用后端（不得执行不可信代码） |
| 科研审计基准测试 | PARTIAL | `services/benchmark_service.py` 案例库+人工验证+质量评估；`test_stage6_benchmark.py` 通过 | 无 Precision/Recall/F1/误报/漏报/证据定位准确率/分类准确率计算；无规则修改后自动回归门禁 |
| 科研团队协作 | IMPL-UNTESTED | `api/v1/auth.py/orgs.py/collab.py/roles.py`、`core/rbac.py`、`test_stage6_auth.py` 有真实 JWT/组织/邀请/撤权/项目隔离测试并通过 | 问题指派、审计结果评论/证据补充、复核任务有部分 API，但未做多课题组隔离的浏览器级 E2E |
| 前端真实交互 | PARTIAL | `App.tsx:38-77` 已挂载登录路由与 RequireAuth；Stage2/4/6 页面均调用真实 API client；证据图谱页已接入 | 下载/HTML/PDF 导出等二进制端点未注入 Bearer（`services/api.ts`），登录后仍可能 401；图表反向验证、交接包、申诉复核无前端入口 |
| 工程质量/部署 | PARTIAL | SQLite+Alembic+启动迁移；`core/config.py` 有资源上限；login 已接线 | 无真实任务队列/worker、无监控告警、无备份恢复演练、无容器隔离验证、无部署编排；安全默认值仍为开发态 |
| 独立验收 | MISSING | 旧 STAGE7 报告为历史快照，不构成本阶段独立验收 | 尚未由未参与开发的测试智能体走 15 步普通用户流程 |

## 2. 第五阶段十项重点工作回看

`docs/STAGE5_FEATURE_ACCEPTANCE_MATRIX.md` 将 22 项功能标为 NOT_TESTED/BLOCKED/NOT_IMPLEMENTED，且"无任何一项 PASS"。本轮事实更新：
- 用户与权限：旧报告称"无用户"已过时——Stage6 auth/orgs/RBAC 已实现且测试通过（`test_stage6_auth.py`）。
- 证据图谱：本轮已新增真实只读 API + 前端页面 + 测试（后端全量 120 passed），状态由"未测"更新为 `PASS-TESTED`（限 API/数据链，非浏览器 E2E）。
- 全年虚拟 365 天模拟、五篇论文实战审计、备份恢复、正式上线：仍未完成，维持未完成标注。
- 二元结论：整体发布状态 `NOT_READY`；P0/P1 未完成前不得发布。

## 2.5 本阶段（第六阶段）新增实现与验证（2026-11-19 续）

基线后新增 4 个真实代码切片，全部有后端测试；后端全量从 120 → **149 passed**，前端 typecheck/build 通过（1692 modules）。

| 新增能力 | 状态 | 证据 | 边界 |
|---|---|---|---|
| 任务编排器状态机（pause/resume/timeout/重启恢复/失败分类） | PASS-TESTED | `services/task_service.py` pause/resume/mark_timeout/recover_stale_tasks；`api/v1/parse_tasks.py` 新路由；`tests/test_task_orchestration.py` 10 项通过 | 恢复是"标记卡死任务为失败"而非真的续跑未完成任务；不执行上传代码 |
| 项目交接包导出/校验 | PASS-TESTED | `services/handoff_service.py`、`api/v1/handoff.py`、`tests/test_handoff.py` 10 项通过；ZIP 含材料原文/事实/证据，manifest 逐文件 sha256，Zip Slip 防护 | 导入为 `validated_not_applied`（只校验不写库），避免覆盖生产数据；不含私有数据集外传 |
| 确定性失败诊断（验证引擎第一层） | PASS-TESTED | `reproduction/deterministic_diagnosis.py`、`api/v1/diagnosis.py`、`tests/test_deterministic_diagnosis.py` 9 项通过；11 类标准分类，候选原因 `is_confirmed=false`，独立于 LLM | 只做日志规则分类，不是确定根因；无 Key 也可用 |
| 前端确定性诊断面板 + 二进制下载 token 修复 | PARTIAL | `components/DeterministicDiagnosisPanel.tsx` 挂载到诊断页；`api.ts`/`reproductionApi.ts` 三个下载端点注入 Bearer；typecheck 通过 | 未做浏览器真人操作验证；后端下载端点依赖默认 `allow_unauth_test_endpoints=True`，生产须关闭（上线阻断项） |
| 审计基准指标引擎（P/R/F1 等） | 实现中 | `services/benchmark_metrics.py` 已建；API/测试由并行代理收尾 | 尚未纳入全量回归 |

申诉复核链核查修正：`services/feedback_service.py` 已实现创建反馈→分诊 (`triaged/resolved/disputed`)→争议转人工 ReviewRequest→审计轨迹留痕，比本清单初版的 PARTIAL 判断更完整；状态更新为 `IMPL-UNTESTED`（代码成立，缺浏览器级 E2E）。

## 3. 本阶段不做什么（边界声明）

- 不执行任何上传的第三方代码；`enable_code_execution=False`、`execution_backend=none` 保持默认。
- 不购买服务器/域名/GPU/付费服务；不做真实生产部署。
- 不使用固定进度条或预制数据伪装任务执行、审计结论或论文复核结果。
- 不复现五篇权威论文的实验数值——除非在隔离环境有真实数据与授权；当前一律标 `MISSING`。
