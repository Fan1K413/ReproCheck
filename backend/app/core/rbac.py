"""第六阶段 RBAC 权限目录与角色映射（种子与 ROLE_PERMISSION_MATRIX.md 的单一事实来源）。

权限分两类作用域：
- org 级：组织管理、成员/邀请、规则、集成、API、治理、公共案例；
- project 级：项目内材料/审计/事实/评论/复核/报告。

判定优先级：平台管理员 > 项目所属组织的管理员 > 项目成员角色 > 组织成员角色。
所有判定在后端执行（见 api/deps.py），前端隐藏按钮不构成权限。
"""
from __future__ import annotations

# 权限键 -> (作用域, 说明)
PERMISSIONS: dict[str, tuple[str, str]] = {
    "org.manage": ("org", "管理组织设置与资源"),
    "member.manage": ("org", "邀请/移除成员、修改角色"),
    "project.create": ("org", "创建科研项目"),
    "project.manage": ("project", "管理项目设置、成员、删除"),
    "material.upload": ("project", "上传科研材料"),
    "material.delete": ("project", "删除材料"),
    "audit.run": ("project", "启动解析与审计"),
    "fact.revise": ("project", "人工修订科研事实"),
    "finding.review": ("project", "确认/标记审计问题"),
    "comment.write": ("project", "评论科研对象"),
    "review.decide": ("project", "审核复核申请与修复建议"),
    "report.generate": ("project", "生成与导出报告"),
    "case.manage": ("project", "创建/维护基准案例与事实"),
    "rule.manage": ("org", "管理审计规则与版本"),
    "integration.manage": ("org", "管理外部工具连接"),
    "api.manage": ("org", "管理开放 API Token"),
    "data.export": ("project", "导出本人/项目数据"),
    "data.manage": ("org", "数据治理与 AI 授权设置"),
}

# 角色键 -> (名称, 作用域, 说明, 权限键列表)
ROLES: dict[str, tuple[str, str, str, list[str]]] = {
    "org_admin": ("组织管理员", "org", "管理组织、成员、权限与资源配置", list(PERMISSIONS.keys())),
    "project_lead": ("项目负责人", "project", "管理项目、分配任务、审核结果", [
        "project.manage", "material.upload", "material.delete", "audit.run", "fact.revise",
        "finding.review", "comment.write", "review.decide", "report.generate", "case.manage", "data.export",
    ]),
    "researcher": ("研究人员", "project", "上传材料、执行审计、开展复现任务", [
        "material.upload", "audit.run", "fact.revise", "comment.write", "report.generate",
        "case.manage", "data.export",
    ]),
    "reviewer": ("审核人员", "project", "查看证据、审核问题、确认修复建议", [
        "finding.review", "comment.write", "review.decide", "report.generate",
    ]),
    "viewer": ("只读成员", "project", "查看项目、报告与历史，不能修改", []),
    "member": ("组织成员", "org", "组织内基础成员，可被分配项目角色", ["project.create"]),
}

# 项目角色等级（用于「至少某角色」判定）
PROJECT_ROLE_RANK = {"viewer": 0, "reviewer": 1, "researcher": 2, "project_lead": 3}


def role_permissions(role_key: str) -> set[str]:
    entry = ROLES.get(role_key)
    return set(entry[3]) if entry else set()