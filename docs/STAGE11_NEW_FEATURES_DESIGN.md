# 交付 8：新增科研功能技术设计（第十一阶段）

按用户要求从 6 个候选中选出 2 项落地：功能 A（实验差异分析）与功能 B（项目变化监控）。
选择依据：两者都消费现有真实数据库数据、不需要新外部运行时、与"独立核对层"定位一致。
功能 C（证据图谱）与 D（审稿工作台）已有部分基础/需更多调研，本阶段只做可行性说明，不宣称落地。

## 功能 A：科研实验差异分析中心

- 后端：`app/services/experiment_diff_service.py` + `POST /api/v1/experiments/diff`。
- 输入：项目 ID + 2~5 个运行 ID；全部经 `resolve_project_access` 校验成员权限。
- 数据来源（真实表）：`reproduction_runs`、`execution_environments`、`reproduction_metrics`、
  `execution_artifacts`、`materials.sha256`、`extracted_facts`、`repository_snapshots`、`metric_comparisons`。
- 输出结构：每次运行快照 + 条件变化维度 + 指标绝对/相对差 + 可能解释 + 不确定项 + 重跑建议 + 受影响审计结论。
- 因果性纪律：
  - 所有解释标注 `relation="correlation_only"`，文案明确"不认定因果"；
  - 快照与运行无外键强关联，按"不晚于运行创建时间的最新快照"弱关联并在报告中标注限制；
  - 缺少的数据标 `unknown`，不用固定数字填充；
  - 不生成"某代码变化导致结果变化"的断言。
- 前端：`/projects/:projectId/experiments/diff`，多选运行 → 生成报告 → 分区展示，含显著因果性提示。

## 功能 B：科研项目变化监控与影响分析

- 后端：`app/services/change_monitor_service.py` + `GET /api/v1/change-monitor/analyze` +
  `POST /api/v1/change-monitor/create-review-plan`。
- 前置增强：`repository_service._fetch_remote_commit()` 现在把 GitHub `files[].filename/status`
  与 GitLab `changes[]` 真实写入快照的 `version_diff_json`，没有清单时为空数组，不猜测文件内容。
- 分析逻辑：
  - 同一用户、同一项目的两次成功快照 commit 不同才继续；
  - 文件按扩展名/路径分为 code/config/data/docs/other；
  - 只在 code/config/data 变化时标记事实、运行、审计结论"可能受影响"；
  - README/文档类变化只给出 low 级建议，明确**不要求重新执行全部实验**；
  - 事实匹配只做文件名弱匹配并标注"待人工确认"。
- 用户确认：创建重审草稿必须 `confirmed=true`，生成 `reproduction_plans` 的 draft 记录，
  记录触发快照与 commit，不执行实验、不覆盖既有结论。
- 前端：`/projects/:projectId/change-monitor`，展示 commit 对比、变更文件、影响面、建议；
  创建任务需勾选确认框。

## 未落地项的可行性说明（不冒充完成）

- **科研证据图谱**：已有 `EvidenceGraphPage` + `/evidence-graph` API（事实/证据/块/材料节点），
  可扩展为"主张→证据→代码→配置→任务→日志→结论"全链路，但节点间跨系统关联字段尚不完整，需专项设计。
- **审稿辅助工作台**：需要新增意见、补充材料、复核版本等表与流程；本阶段未新增，避免做静态壳。
- **资源预算分析 / 项目交接归档**：现有 `handoff` 导出 + 运行 resource 字段是基础，但预算估算缺少真实定价来源，
  不能编造成本；本阶段未落地。

## 测试

- `test_research_features.py` 4 项：相关性标注、至少两个运行、文档变化不触发重跑、配置变化 + 确认后创建草稿。
- 回归：全量 pytest 含历史基线与新测试全部通过。
