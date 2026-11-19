# 第六阶段交付报告 · ReproCheck 核心能力闭环与科研验证引擎

生成时间：2026-11-19。状态口径：`PASS-TESTED`（真实运行证据）/ `IMPL-UNTESTED`（代码成立未走真实流程）/ `PARTIAL` / `MISSING`。
**本报告只陈述本回合实际观察与运行结果；界面存在/函数可调/路由可访问都不等于功能完成。**

## 1. Git 检查点与基线

- 前置检查点：`ae339ce`（含 Stage5/6 全部源码与文档，排除 ZIP/截图/报告/临时目录），标签 `stage6-checkpoint-preflight`。初始 HEAD 为 `1d32f51`（仅 3 个提交），此前所有未提交改动被完整保留进检查点，未丢弃、未覆盖。
- Git 历史：`01c878c` → `90a4830` → `1d32f51` → `ae339ce`（本阶段创建）。
- 验证基线：后端 pytest 120 passed；前端 typecheck + build（1691 modules）。

## 2. 原有功能完成度（前期成果真实清单）

详见 `docs/STAGE6_REAL_STATUS.md`。要点：
- 旧 `STAGE7_*` 报告"用户/权限/Stage6 API 未实现"是历史快照，当前 auth/orgs/collab/roles/rules/feedback/benchmark/RAG/integrations/governance 路由已实现且测试通过。
- 全年 365 天虚拟模拟、五篇权威论文实战审计、备份恢复、正式上线：`MISSING`，维持未完成标注。
- 总体发布状态：`NOT_READY`。

## 3. 本阶段新增实现清单（真实代码 + 测试）

| # | 功能 | 状态 | 文件 | 测试 |
|---|---|---|---|---|
| 1 | 任务编排器状态机（暂停/继续/超时/失败分类/重启恢复判定/幂等） | PASS-TESTED | `services/task_service.py`、`models/stage2.py`、`db/migrate.py`、`api/v1/parse_tasks.py` | test_task_orchestration.py 10 项 |
| 2 | 项目交接包导出/校验（ZIP+manifest 逐文件 sha256+Zip Slip 防护+权限） | PASS-TESTED | `services/handoff_service.py`、`api/v1/handoff.py` | test_handoff.py 10 项 |
| 3 | 确定性失败诊断（验证引擎第一层，独立于 LLM，11 类标准分类，候选原因） | PASS-TESTED | `reproduction/deterministic_diagnosis.py`、`api/v1/diagnosis.py` | test_deterministic_diagnosis.py 9 项 |
| 4 | 审计基准指标引擎（Precision/Recall/F1/误报/漏报/定位准确率/分类准确率+回归门禁） | PASS-TESTED | `services/benchmark_metrics.py`、`api/v1/benchmark_metrics.py` | test_benchmark_metrics.py 14 项 |
| 5 | 前端确定性诊断面板 + 三个二进制下载端点 Bearer 注入修复 | PARTIAL（未做浏览器 E2E） | `components/DeterministicDiagnosisPanel.tsx`、`api.ts`、`reproductionApi.ts` | typecheck/build 通过 |
| 6 | 证据图谱（上一轮已完成，本阶段纳入回归） | PASS-TESTED | `api/v1/facts.py`、`pages/EvidenceGraphPage.tsx` | test_stage2_api.py 含断言 |
| 7 | 论文图表反向验证（文本/数值层） | PASS-TESTED | `services/chart_verification_service.py`、`api/v1/chart_verification.py` | test_chart_verification.py 12 项 |
| 8 | 验证引擎第2层静态分析 + 第4层数值重算 | PASS-TESTED | `services/static_analysis_service.py`、`services/numeric_recompute_service.py`、`api/v1/verification_layers.py` | test_verification_layers.py 18 项 |
| 9 | 生产安全加固（自检 API + 启动守卫 + 手册） | PASS-TESTED | `core/config.py`、`main.py`、`.env.example`、`docs/PRODUCTION_HARDENING_GUIDE.md` | test_production_safety.py 5 项 |

新增测试共 78 项（43 核心 + 2 P2 回归 + 12 图表 + 18 验证引擎 + 5 生产安全）；后端全量从 120 → **200 passed**；前端 typecheck 通过、build 1692 modules 通过。

## 4. 科研复现工作流（实际状态）

现有链路：`ParseTask` 状态机（queued→parsing→extracting→completed/failed + pause/resume/timeout/recover，幂等 idem_key）真实可用；`ReproductionPlan/Task/Run/Log/Artifact/Metric/Report` 数据模型与 API 齐全。
- 完整 11 步流程（论文解析→主张提取→代码映射→配置→数据检查→环境→计划→确认→隔离执行→结果核验→报告）：**前半段（解析/主张/计划/确认）有真实实现；隔离执行无可用后端（`enable_code_execution=False`），不得执行上传代码**。
- 因此"科研人员独立完成全自动复现执行"当前不成立，标 `PARTIAL`。

## 5-10. 各专项模块真实状态

- **图表反向验证**：`PARTIAL→PASS-TESTED`（文本/数值层）。真实实现表格数值与图注提取（从 PDF 文本块）、AST 绘图逻辑检索（matplotlib/plotly）、CSV/JSON/日志结果文件数值提取、数值对比三态（supported/conflicting/insufficient_data）；缺数据时明确 `insufficient_data` + "未完成精确复核"。**OCR/图像级重绘对比仍缺失**，不声称已精确复核图像。
- **失败诊断中心**：`PARTIAL→PASS-TESTED`（新增确定性分类层）。旧 LLM 诊断无 Key 完全不可用；新增规则层无 Key 可用，但所有结论为候选（`is_confirmed=false`），原始日志/环境/命令/阶段字段部分已有。
- **项目交接包**：`PARTIAL→PASS-TESTED`（导出+校验）。导入为 `validated_not_applied`（只校验不写库），避免覆盖生产数据；不含私有数据集外传。
- **审计申诉复核**：`IMPL-UNTESTED`。`feedback_service.py` 已实现创建反馈→分诊（triaged/resolved/disputed）→争议转人工 ReviewRequest→审计轨迹；缺浏览器级 E2E。
- **独立验证引擎**：`PARTIAL（4/5 层落地）`。第1层确定性规则诊断、第2层 AST 静态分析、第4层数值重算、第5层 AI 辅助（原有 audit_service）均有真实实现；第3层动态执行仍关闭（`executed=False`，note 明说"隔离执行环境未启用"）。`GET /verification/layers` 展示每层职责/方法/是否实际执行/可信度，统一面板结构。
- **审计基准测试**：`PARTIAL→PASS-TESTED`（指标引擎）。案例库/人工验证已有；新增 P/R/F1/误报漏报/定位准确率计算与回归门禁，但尚无"人工标注真值集 + 检测器输出"的端到端自动回归流水线。
- **团队协作**：`IMPL-UNTESTED`。auth/orgs/collab/roles/RBAC 已实现并测试；未做多课题组隔离的浏览器级 E2E。

## 11. 数据库与 API 变更

- 数据库：ParseTask 新增 `paused_at`、`timeout_seconds`(默认 600)、`failure_category`(默认 '')、`resume_count`(默认 0)、`heartbeat_at`；全部 nullable/有默认值，`db/migrate.py` 幂等补列，已有库升级不丢数据。
- 新增 API：
  - `POST /api/v1/parse-tasks/{id}/pause`、`/resume`、`POST /api/v1/parse-tasks/recover-stale`
  - `POST /api/v1/projects/{id}/handoff/export`、`/handoff/validate`
  - `GET /api/v1/diagnosis/categories`、`POST /api/v1/diagnosis/classify`
  - `POST /api/v1/benchmark/metrics/compute`、`GET /api/v1/benchmark/metrics/schema`
- 所有新路由均需认证；项目相关路由经 `enforce_project_isolation` + 资源归属校验。

## 12. 测试报告

- 后端全量：**200 passed**，3 warnings（FastAPI on_event 弃用、pytest-asyncio fixture loop scope、fitz API 弃用）。退出时 Windows 临时目录清理有 `PermissionError`（环境问题，不影响测试结果）。
- 前端：`npm run typecheck` 通过；`npm run build` 通过（1692 modules，bundle >500KB 警告）。
- 独立验收：`docs/STAGE6_INDEPENDENT_ACCEPTANCE.md`（由未参与本阶段开发的测试智能体执行）。15/15 主步骤 PASS，P0=0、P1=0、P2=2；发现的两个 P2 缺陷（LLM Key 失效误报用户 401、parse 响应 material_name 空）已修复并加回归测试 `test_acceptance_p2_fixes.py`（2 项通过）。

## 12.5 独立验收摘要

| 维度 | 结果 |
|---|---|
| 主流程 15 步 | 15/15 PASS（注册→建项目→上传→解析→事实→证据图谱→复现规划/任务/run→暂停恢复→诊断→基准指标→交接包→反馈→重启数据留存） |
| 阻断项 | 2 项 BLOCKED：真实模型调用（无 LLM Key）、真实代码执行（无安全沙箱）——用协议级 mock 与 `blocked_no_sandbox` 真实状态处理，未伪造 |
| Bug | P0=0、P1=0、P2=2，均已修复并回归 |
| 总体 | 具备真实 Key 与沙箱后核心流程可独立走通；当前环境不宣称全自动复现完成 |

## 13. 性能与安全报告

- 安全默认值仍为开发态：`allow_unauth_test_endpoints=True`、`jwt_secret=dev-insecure-change-me`，**生产必须关闭/替换**，属上线阻断项。
- 二进制下载端点（材料/报告 HTML/PDF）仅依赖路由级项目隔离；默认 anonymous 放行时可被任意下载，须在生产关闭匿名后使用。
- 交接包导入有 Zip Slip 防护、大小/条目上限、哈希校验；不执行任何归档内代码。
- 未做真实并发压测、监控告警、容器隔离验证、备份恢复演练。

## 14. 未解决问题清单

| 级别 | 问题 | 状态 |
|---|---|---|
| P0 | 无真实代码隔离执行后端（Docker/GVisor 未验证），"全自动复现"不成立 | 阻断发布 |
| P0 | 生产安全默认值未收紧（匿名放行、开发 JWT 密钥） | 已提供 `strict_production_check()` + `STRICT_PRODUCTION=1` 启动守卫 + 自检 API + 手册；默认值仍为开发态以兼容测试，**部署时必须设置并验证**（见 PRODUCTION_HARDENING_GUIDE.md） |
| P1 | 图表反向验证的 OCR/图像级重绘对比 | 文本/数值层已实现；图像级未实现（缺数据/OCR 环境），标 BLOCKED |
| P1 | 无浏览器级真人 E2E（15 步流程尚未全部走通） | 待独立验收 |
| P1 | 导入交接包只校验不写库（避免覆盖，但非完整导入） | 设计约束 |
| P2 | 前端 bundle >500KB；FastAPI/pytest/fitz 弃用告警 | 优化项 |
| P2 | 五篇论文实战、365 天模拟、备份恢复、部署 | 未做 |

## 15. 下一版本建议

1. 引入 rootless Docker/GVisor 隔离执行后端并做真实最小实验（先解决 P0）。
2. 收紧生产安全默认（关闭匿名、强制 JWT 密钥/加密密钥配置、AI 授权 consent）。
3. 实现图表反向验证（PDF 表格单元格 + 图注提取、结果文件关联、重绘对比、人工校正）。
4. 建立"人工标注真值集 → 检测器输出 → 自动 P/R/F1 回归"流水线，接入 CI 门禁。
5. 补齐浏览器 E2E（Playwright）与备份恢复演练、可观测性。

## 结论

本阶段以**真实代码 + 真实测试**交付：核心 4 切片（任务编排、交接包、确定性诊断、基准指标）+ 缺口补齐 3 切片（文本/数值层图表反向验证、验证引擎第2/4层、生产安全自检与启动守卫），并修复独立验收发现的 2 个 P2 Bug。后端测试 120→200 全绿，前端构建通过，独立验收 15/15 主步骤 PASS。阻断项剩：真实隔离执行后端（无 Docker/GVisor）、生产配置实际收敛与备份恢复/部署验收、图表图像级重绘对比。**发布状态：NOT_READY；P0 未解决前不得正式发布。**
