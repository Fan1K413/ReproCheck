# ReproCheck 第六阶段 · 团队协作规格

> 实现状态：后端已实现并通过测试（test_stage6_auth.py，7 项）。前端页面见第八节任务。
> 设计原则：协作围绕科研任务与证据组织，不做普通聊天软件；所有关键操作可追溯。

## 1. 组织模型

```
Organization (组织)
├── Workspace (工作空间，组织内分组)
├── Team (团队) ── TeamMember
├── OrgMember (组织成员，role_key: org_admin / member)
├── Invitation (邀请，token + 过期 + 状态机)
└── Project (科研项目，归属 org_id / workspace_id / owner_user_id)
    └── ProjectMember (项目成员，role_key: project_lead / researcher / reviewer / viewer)
```

- 兼容既有数据：迁移创建「默认组织（legacy）」，旧项目回填 org_id/owner_user_id，不破坏前五阶段数据。
- 每个注册用户自动获得一个个人组织（org_admin），可立即创建项目。
- 数据隔离：组织之间、用户之间在后端强制隔离（`resolve_project_access` / `ensure_org_member`）；非成员访问返回 404（隐藏存在性），角色不足返回 403。平台管理员与组织管理员合法 bypass。

## 2. 角色权限

见 `ROLE_PERMISSION_MATRIX.md`。权限一律后端校验（`app/api/deps.py`），前端隐藏按钮不构成权限。

## 3. 协作功能（已实现端点）

| 功能 | 端点 |
|---|---|
| 创建团队 | POST /orgs/{id}/teams |
| 邀请成员 | POST /orgs/{id}/invitations（明文 token 仅返回一次） |
| 接受邀请 | POST /invitations/accept（校验 pending + 未过期） |
| 撤销邀请 | POST /invitations/{id}/revoke |
| 分配项目成员 | POST /projects/{id}/members |
| 指定审核人 | POST /projects/{id}/reviews（reviewer_user_id） |
| 查看成员进度 | GET /projects/{id}/members + /activity |
| 评论科研对象 | POST /projects/{id}/comments（target_type ∈ finding/evidence/task/fact/material） |
| 提交复核申请 | POST /projects/{id}/reviews |
| 审核修复建议 | POST /reviews/{id}/decide（approved/rejected/changes_requested） |
| 项目活动记录 | GET /projects/{id}/activity（分页） |

评论必须关联具体科研事实/审计问题/证据/复现任务（target_type + target_id），不是自由聊天。

## 4. 邀请状态机

`pending → accepted`（接受）/ `expired`（过期接受时自动标记）/ `revoked`（管理员撤销）。
默认 7 天过期（`INVITATION_EXPIRE_DAYS`）。token 明文仅创建时返回，DB 存 sha256。

## 5. 成员离开 / 撤权

移除组织成员（DELETE /orgs/{id}/members/{uid}）会同步删除其在该组织所有项目中的 ProjectMember，立即撤销项目访问。测试 `test_member_removal_revokes_project_access` 验证。

## 6. 版本与操作审计

见 `PROJECT_AUDIT_TRAIL_SPEC.md`。

## 7. 安全约束

- 密码 pbkdf2_hmac（200k 迭代）；JWT HS256（12h）；邀请/API token 仅存哈希。
- 生产须设 `JWT_SECRET`、`ENCRYPTION_KEY`，并关闭 `ALLOW_UNAUTH_TEST_ENDPOINTS`。
- 既有项目相关读接口已挂载 `enforce_project_isolation`，生产强制认证与隔离。

## 8. 前端页面（第八节）

组织工作空间、团队管理、成员邀请、角色权限、科研协作任务。围绕科研任务组织信息，非简单成员列表。