# ReproCheck 第六阶段 · 项目操作审计轨迹规格

> 实现：`backend/app/services/trail_service.py` + `audit_trail` 表。测试 `test_audit_trail_records_before_after`。
> 原则：所有关键科研操作记录操作者、时间、对象与修改内容；重要判断保留修改前后，不覆盖原始 AI 判断与原始证据。

## 1. 记录字段（audit_trail）

| 字段 | 含义 |
|---|---|
| id | 轨迹 id |
| org_id / project_id | 归属（可空） |
| actor_user_id | 操作者（认证身份，非自由文本） |
| action | 操作类型（见 §2） |
| target_type / target_id | 对象类型与 id |
| before_json / after_json | 修改前 / 修改后内容（重要判断必填） |
| summary | 人类可读摘要 |
| request_id | 关联请求 |
| created_at | UTC 时间 |

## 2. 已留痕操作

| action | 触发 | before/after |
|---|---|---|
| user.register / user.login / user.logout | 认证 | — |
| org.create | 创建组织 | after |
| member.role_change | 组织角色修改 | before/after role_key |
| member.remove | 移除组织成员 | before role_key |
| invitation.create / accept / revoke | 邀请生命周期 | after |
| team.create | 创建团队 | — |
| project.create | 创建项目 | after name |
| project.member_add / member_role / member_remove | 项目成员变更 | before/after role_key |
| comment.create | 评论 | — |
| review.request / review.decide | 复核申请/裁定 | before/after status + note |

## 3. 与既有留痕机制的关系

- 事实人工修订：沿用 stage2 `fact_revisions`（old/new value），并保留 `extracted_facts.ai_original_json` 原始 AI 判断。
- 修复建议审核：沿用 stage4 `remediation_reviews`（original_preserved=True，不修改原始文件）。
- 第六阶段 `audit_trail` 补充组织/项目/协作层操作留痕，三者共同构成完整证据链。
- **不得因用户修改结论而覆盖原始 AI 判断与原始证据**：修订写入新记录，原始快照保留。

## 4. 查询

GET /projects/{id}/activity?limit&offset → 分页轨迹（项目成员可见）。前端「项目活动记录」页消费。

## 5. 待扩展（后续阶段）

材料上传/配置修改/审计启动/报告生成等操作的留痕接入点已预留（record_trail 可在对应 service 调用）；第六阶段优先覆盖协作与权限变更，其余在集成时按需补充。