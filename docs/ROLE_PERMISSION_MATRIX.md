# ReproCheck 第六阶段 · 角色权限矩阵

> 单一事实来源：`backend/app/core/rbac.py`（PERMISSIONS / ROLES）。本文档与代码种子一致。
> 判定优先级：平台管理员 > 项目所属组织管理员 > 项目成员角色 > 组织成员角色。全部后端校验。

## 1. 角色

| 角色 key | 名称 | 作用域 | 定位 |
|---|---|---|---|
| org_admin | 组织管理员 | org | 管理组织、成员、权限与资源配置 |
| project_lead | 项目负责人 | project | 管理项目、分配任务、审核结果 |
| researcher | 研究人员 | project | 上传材料、执行审计、开展复现任务 |
| reviewer | 审核人员 | project | 查看证据、审核问题、确认修复建议 |
| viewer | 只读成员 | project | 查看项目、报告与历史，不能修改 |
| member | 组织成员 | org | 组织内基础成员，可被分配项目角色（含 project.create） |

## 2. 权限矩阵

✓ = 拥有；空 = 无。org_admin 拥有全部权限。

| 权限 | 作用域 | org_admin | project_lead | researcher | reviewer | viewer | member |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|
| org.manage | org | ✓ | | | | | |
| member.manage | org | ✓ | | | | | |
| project.create | org | ✓ | | | | | ✓ |
| project.manage | project | ✓ | ✓ | | | | |
| material.upload | project | ✓ | ✓ | ✓ | | | |
| material.delete | project | ✓ | ✓ | | | | |
| audit.run | project | ✓ | ✓ | ✓ | | | |
| fact.revise | project | ✓ | ✓ | ✓ | | | |
| finding.review | project | ✓ | ✓ | | ✓ | | |
| comment.write | project | ✓ | ✓ | ✓ | ✓ | | |
| review.decide | project | ✓ | ✓ | | ✓ | | |
| report.generate | project | ✓ | ✓ | ✓ | ✓ | | |
| case.manage | project | ✓ | ✓ | ✓ | | | |
| rule.manage | org | ✓ | | | | | |
| integration.manage | org | ✓ | | | | | |
| api.manage | org | ✓ | | | | | |
| data.export | project | ✓ | ✓ | ✓ | | | |
| data.manage | org | ✓ | | | | | |

## 3. 校验实现

- `user_has_permission(db, user, perm, org_id, project_id)`：按优先级判定。
- `resolve_project_access(db, project_id, user, min_rank)`：可见性 + 角色等级（PROJECT_ROLE_RANK：viewer 0 / reviewer 1 / researcher 2 / project_lead 3）。
- `require_permission(perm)`：路由依赖工厂。
- 项目相关既有路由统一挂 `enforce_project_isolation`。

## 4. 测试覆盖

- viewer 不能评论（403），升级为 researcher 后可评论：`test_rbac_viewer_cannot_comment`。
- 非成员项目访问 404：`test_project_isolation_non_member_404`。
- 组织隔离 404：`test_org_data_isolation`。
- 成员撤权：`test_member_removal_revokes_project_access`。