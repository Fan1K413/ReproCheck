# 审计反馈治理规范（FEEDBACK_GOVERNANCE_SPEC）

> 阶段六 · C 组。对应实现：`app/services/feedback_service.py`、`app/api/v1/feedback.py`；
> 数据表 `audit_feedback`（见 `app/models/stage6.py`），争议复核复用 `review_requests`。
> 测试：`app/tests/test_stage6_rules.py`。

## 1. 治理原则

1. **单条用户反馈不是绝对真理。** 反馈只是「待治理信号」，创建即 `status=open`，
   进入人工分诊队列，**绝不自动改写任何生产规则 / 规则版本 / 启停状态**。
2. **AI 不能自动把用户判断学习进生产规则。** 规则的任何变更只能走
   `rule_service` 的显式版本流程（`rule.manage` + ≥1 测试样本 + 离线验证）。
3. **争议（disputed）必须转人工复核**，系统不自行裁定真伪。
4. 重要操作（创建、分诊）全部留痕，保留 before/after，不覆盖原始 AI 判断与证据。

## 2. 反馈类型与状态

- `feedback_type ∈ {confirm, false_positive, insufficient_evidence, request_review, supplement, fix_note}`，
  非法值 → 422。`supplement/fix_note/insufficient_evidence` 需提供 `note` 或 `evidence_ref`。
- 生命周期状态：`open`（创建）→ `triaged` / `resolved` / `disputed`（分诊）。
  分诊非法状态（如 `auto_learn`）→ 422。

## 3. 接口与权限

| 方法 路径 | 权限 | 说明 |
|---|---|---|
| `POST /feedback` | 项目成员（`resolve_project_access`） | `{project_id, finding_id?, run_id?, feedback_type, note?, evidence_ref?, context_json?}`；`status=open`；留痕；**不触碰规则表** |
| `GET /feedback?project_id&status` | 项目成员 | 按状态过滤，时间降序 |
| `POST /feedback/{id}/triage` | `finding.review`（审核人员及以上） | `{status, resolution}`；留痕 before/after |

- 非项目成员访问 → 404（隐藏存在性）；无 `finding.review` 分诊 → 403。
- `finding_id` 为可空 opaque 引用，不强制校验存在性（可来自不同 run）。

## 4. 分诊行为

- `triaged` / `resolved`：记录 `resolved_by` / `resolved_at`；`resolution` 文本合并进
  `context_json.resolution`（**模型无独立 resolution 列**，故存于 context，保留原始上下文）。
- `disputed`：生成一条 `ReviewRequest`（`target_type="feedback"`、`target_id=反馈id`、
  `status="pending"`、`reviewer_user_id=None` 即未指派的人工队列），返回
  `review_id` 与 `requires_human_review=True`；`resolved_by/at` 置空，等待人工裁定。
  可在 `GET /projects/{pid}/reviews` 看到该复核申请。
- 分诊**同样不改任何规则**。

## 5. 与规则层的隔离（关键不变量）

`feedback_service` 不 import、不写入 `audit_rules` / `audit_rule_versions`。
测试 `test_feedback_does_not_change_rule` 断言：提交 `false_positive` 反馈后，
目标规则的 `current_version`、`check_logic`、`is_enabled` 与版本总数**完全不变**。

## 6. 未实现 / 后续（诚实标注）

- **无反馈→规则提案的自动聚合管线**：把多条同类反馈聚合成「规则变更提案」供人工评审，
  是后续工作；当前仅记录与分诊，变更须人工显式走版本流程。
- **无自动阈值触发**（如「N 条 false_positive 自动停用规则」）——刻意不实现，避免单点反馈污染生产。
- **争议复核无自动通知/指派**：`ReviewRequest` 进入未指派人工队列，指派与提醒由协作模块后续接入。
- `resolution` 无独立数据库列，存于 `context_json`（已如实标注）；如需独立列须由 owner 走迁移。