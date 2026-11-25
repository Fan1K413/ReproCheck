"""组织 / 团队 / 工作空间 / 成员 / 邀请服务。组织级数据隔离在此强制。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.core.rbac import ROLES
from app.core.security import generate_token, hash_token, new_id
from app.models import Project
from app.models.stage6 import (
    Invitation,
    OrgMember,
    Organization,
    ProjectMember,
    Team,
    TeamMember,
    User,
    Workspace,
)
from app.services.trail_service import record_trail


def org_view(o: Organization) -> dict:
    return {"id": o.id, "name": o.name, "slug": o.slug, "description": o.description or "",
            "owner_user_id": o.owner_user_id, "created_at": o.created_at.isoformat() if o.created_at else ""}


async def ensure_org_member(db: AsyncSession, user: User, org_id: str, admin: bool = False) -> tuple[Organization, str]:
    org = (await db.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if org is None:
        raise AppError("NOT_FOUND", "组织不存在或无权访问。")
    if user.is_platform_admin:
        return org, "org_admin"
    m = (await db.execute(select(OrgMember).where(
        OrgMember.org_id == org_id, OrgMember.user_id == user.id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "组织不存在或无权访问。")
    if admin and m.role_key != "org_admin":
        raise AppError("FORBIDDEN", "需要组织管理员权限。")
    return org, m.role_key


async def create_org(db: AsyncSession, user: User, name: str, description: str, request_id: str = "") -> dict:
    if not name.strip():
        raise AppError("VALIDATION_ERROR", "组织名称不能为空。")
    slug = f"org-{new_id('x')[-12:]}"
    org = Organization(id=new_id("org"), name=name.strip(), slug=slug,
                       description=description, owner_user_id=user.id)
    db.add(org)
    await db.flush()
    db.add(OrgMember(id=new_id("om"), org_id=org.id, user_id=user.id, role_key="org_admin"))
    await record_trail(db, action="org.create", actor_user_id=user.id, org_id=org.id,
                       target_type="org", target_id=org.id, summary=f"创建组织 {name}", request_id=request_id)
    await db.commit()
    return org_view(org)


async def list_orgs(db: AsyncSession, user: User) -> list[dict]:
    if user.is_platform_admin:
        rows = (await db.execute(select(Organization).order_by(Organization.created_at.desc()))).scalars().all()
        return [org_view(o) for o in rows]
    ms = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().all()
    out = []
    for m in ms:
        o = (await db.execute(select(Organization).where(Organization.id == m.org_id))).scalar_one_or_none()
        if o:
            v = org_view(o)
            v["role_key"] = m.role_key
            out.append(v)
    return out


async def list_members(db: AsyncSession, org_id: str) -> list[dict]:
    ms = (await db.execute(select(OrgMember).where(OrgMember.org_id == org_id))).scalars().all()
    out = []
    for m in ms:
        u = (await db.execute(select(User).where(User.id == m.user_id))).scalar_one_or_none()
        out.append({"user_id": m.user_id, "email": u.email if u else "", "display_name": u.display_name if u else "",
                    "role_key": m.role_key, "joined_at": m.joined_at.isoformat() if m.joined_at else ""})
    return out


async def update_member_role(db: AsyncSession, actor: User, org_id: str, target_user_id: str,
                             role_key: str, request_id: str = "") -> dict:
    if role_key not in ("org_admin", "member"):
        raise AppError("VALIDATION_ERROR", "组织角色仅支持 org_admin / member。")
    m = (await db.execute(select(OrgMember).where(
        OrgMember.org_id == org_id, OrgMember.user_id == target_user_id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "成员不存在。")
    before = m.role_key
    m.role_key = role_key
    await record_trail(db, action="member.role_change", actor_user_id=actor.id, org_id=org_id,
                       target_type="org_member", target_id=target_user_id,
                       before={"role_key": before}, after={"role_key": role_key},
                       summary="修改组织角色", request_id=request_id)
    await db.commit()
    return {"user_id": target_user_id, "role_key": role_key}


async def remove_member(db: AsyncSession, actor: User, org_id: str, target_user_id: str, request_id: str = "") -> dict:
    m = (await db.execute(select(OrgMember).where(
        OrgMember.org_id == org_id, OrgMember.user_id == target_user_id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "成员不存在。")
    await db.delete(m)
    # 撤销该成员在本组织所有项目中的权限
    projects = (await db.execute(select(Project).where(Project.org_id == org_id))).scalars().all()
    pids = [p.id for p in projects]
    if pids:
        pms = (await db.execute(select(ProjectMember).where(
            ProjectMember.user_id == target_user_id, ProjectMember.project_id.in_(pids)))).scalars().all()
        for pm in pms:
            await db.delete(pm)
    await record_trail(db, action="member.remove", actor_user_id=actor.id, org_id=org_id,
                       target_type="org_member", target_id=target_user_id,
                       before={"role_key": m.role_key}, summary="移除成员并撤销项目权限", request_id=request_id)
    await db.commit()
    return {"removed": target_user_id, "revoked_projects": len(pids)}


async def create_invitation(db: AsyncSession, actor: User, org_id: str, email: str,
                            role_key: str, request_id: str = "") -> dict:
    if role_key not in ("org_admin", "member"):
        raise AppError("VALIDATION_ERROR", "邀请角色仅支持 org_admin / member。")
    plain, thash = generate_token("rc_invite")
    inv = Invitation(id=new_id("inv"), org_id=org_id, email=email.strip().lower(), role_key=role_key,
                     token_hash=thash, status="pending",
                     expires_at=datetime.now(timezone.utc) + timedelta(days=settings.invitation_expire_days),
                     invited_by=actor.id)
    db.add(inv)
    await record_trail(db, action="invitation.create", actor_user_id=actor.id, org_id=org_id,
                       target_type="invitation", target_id=inv.id, after={"email": email, "role_key": role_key},
                       summary="创建邀请", request_id=request_id)
    await db.commit()
    return {"id": inv.id, "email": inv.email, "role_key": role_key, "status": inv.status,
            "expires_at": inv.expires_at.isoformat(), "token": plain}


async def list_invitations(db: AsyncSession, org_id: str) -> list[dict]:
    rows = (await db.execute(select(Invitation).where(Invitation.org_id == org_id)
                             .order_by(Invitation.created_at.desc()))).scalars().all()
    return [{"id": i.id, "email": i.email, "role_key": i.role_key, "status": i.status,
             "expires_at": i.expires_at.isoformat(), "created_at": i.created_at.isoformat()} for i in rows]


async def accept_invitation(db: AsyncSession, user: User, token: str, request_id: str = "") -> dict:
    inv = (await db.execute(select(Invitation).where(
        Invitation.token_hash == hash_token(token)))).scalar_one_or_none()
    if inv is None:
        raise AppError("NOT_FOUND", "邀请链接无效。")
    if inv.status != "pending":
        raise AppError("CONFLICT", f"邀请已{inv.status}，无法接受。")
    if user.email.strip().casefold() != inv.email.strip().casefold():
        raise AppError("FORBIDDEN", "请使用受邀邮箱对应的账号接受邀请。")
    now = datetime.now(timezone.utc)
    expires = inv.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        inv.status = "expired"
        await db.commit()
        raise AppError("CONFLICT", "邀请链接已过期。")
    existing = (await db.execute(select(OrgMember).where(
        OrgMember.org_id == inv.org_id, OrgMember.user_id == user.id))).scalar_one_or_none()
    if not existing:
        db.add(OrgMember(id=new_id("om"), org_id=inv.org_id, user_id=user.id, role_key=inv.role_key))
    inv.status = "accepted"
    inv.accepted_at = now
    await record_trail(db, action="invitation.accept", actor_user_id=user.id, org_id=inv.org_id,
                       target_type="invitation", target_id=inv.id, summary="接受邀请", request_id=request_id)
    await db.commit()
    return {"org_id": inv.org_id, "role_key": inv.role_key, "status": "accepted"}


async def revoke_invitation(db: AsyncSession, actor: User, inv_id: str, request_id: str = "") -> dict:
    inv = (await db.execute(select(Invitation).where(Invitation.id == inv_id))).scalar_one_or_none()
    if inv is None:
        raise AppError("NOT_FOUND", "邀请不存在。")
    await ensure_org_member(db, actor, inv.org_id, admin=True)
    inv.status = "revoked"
    await record_trail(db, action="invitation.revoke", actor_user_id=actor.id, org_id=inv.org_id,
                       target_type="invitation", target_id=inv.id, summary="撤销邀请", request_id=request_id)
    await db.commit()
    return {"id": inv_id, "status": "revoked"}


# 团队 / 工作空间

async def create_team(db: AsyncSession, actor: User, org_id: str, name: str, description: str, request_id: str = "") -> dict:
    await ensure_org_member(db, actor, org_id, admin=True)
    t = Team(id=new_id("team"), org_id=org_id, name=name, description=description)
    db.add(t)
    await record_trail(db, action="team.create", actor_user_id=actor.id, org_id=org_id,
                       target_type="team", target_id=t.id, summary=f"创建团队 {name}", request_id=request_id)
    await db.commit()
    return {"id": t.id, "org_id": org_id, "name": t.name, "description": t.description or ""}


async def list_teams(db: AsyncSession, org_id: str) -> list[dict]:
    rows = (await db.execute(select(Team).where(Team.org_id == org_id))).scalars().all()
    out = []
    for t in rows:
        cnt = (await db.execute(select(TeamMember).where(TeamMember.team_id == t.id))).scalars().all()
        out.append({"id": t.id, "name": t.name, "description": t.description or "", "member_count": len(cnt)})
    return out


async def add_team_member(db: AsyncSession, actor: User, team_id: str, user_id: str, role_in_team: str, request_id: str = "") -> dict:
    t = (await db.execute(select(Team).where(Team.id == team_id))).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "团队不存在。")
    await ensure_org_member(db, actor, t.org_id, admin=True)
    exists = (await db.execute(select(TeamMember).where(
        TeamMember.team_id == team_id, TeamMember.user_id == user_id))).scalar_one_or_none()
    if exists:
        raise AppError("CONFLICT", "该用户已在团队中。")
    tm = TeamMember(id=new_id("tm"), team_id=team_id, user_id=user_id, role_in_team=role_in_team)
    db.add(tm)
    await db.commit()
    return {"team_id": team_id, "user_id": user_id, "role_in_team": role_in_team}


async def list_team_members(db: AsyncSession, actor: User, team_id: str) -> list[dict]:
    team = await db.get(Team, team_id)
    if team is None:
        raise AppError("NOT_FOUND", "团队不存在。")
    _, role = await ensure_org_member(db, actor, team.org_id)
    if not actor.is_platform_admin and role != "org_admin":
        membership = await db.scalar(select(TeamMember.id).where(
            TeamMember.team_id == team_id, TeamMember.user_id == actor.id,
        ))
        if membership is None:
            raise AppError("NOT_FOUND", "团队不存在或无权访问。")
    rows = (await db.execute(select(TeamMember).where(TeamMember.team_id == team_id))).scalars().all()
    out = []
    for tm in rows:
        u = (await db.execute(select(User).where(User.id == tm.user_id))).scalar_one_or_none()
        out.append({"user_id": tm.user_id, "email": u.email if u else "", "role_in_team": tm.role_in_team})
    return out


async def create_workspace(db: AsyncSession, actor: User, org_id: str, name: str, description: str, request_id: str = "") -> dict:
    await ensure_org_member(db, actor, org_id, admin=True)
    w = Workspace(id=new_id("ws"), org_id=org_id, name=name, description=description)
    db.add(w)
    await db.commit()
    return {"id": w.id, "org_id": org_id, "name": w.name, "description": w.description or ""}


async def list_workspaces(db: AsyncSession, org_id: str) -> list[dict]:
    rows = (await db.execute(select(Workspace).where(Workspace.org_id == org_id))).scalars().all()
    return [{"id": w.id, "name": w.name, "description": w.description or ""} for w in rows]
