"""组织 / 成员 / 邀请 / 团队 / 工作空间路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import org_service as svc

router = APIRouter(tags=["organizations"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class OrgIn(BaseModel):
    name: str
    description: str = ""


class RoleIn(BaseModel):
    role_key: str


class InviteIn(BaseModel):
    email: str
    role_key: str = "member"


class AcceptIn(BaseModel):
    token: str


class TeamIn(BaseModel):
    name: str
    description: str = ""


class TeamMemberIn(BaseModel):
    user_id: str
    role_in_team: str = "member"


class WorkspaceIn(BaseModel):
    name: str
    description: str = ""


@router.post("/orgs")
async def create_org(payload: OrgIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_org(db, user, payload.name, payload.description, _rid(request)), _rid(request))


@router.get("/orgs")
async def list_orgs(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_orgs(db, user)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.get("/orgs/{org_id}")
async def get_org(org_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    org, role = await svc.ensure_org_member(db, user, org_id)
    data = svc.org_view(org)
    data["role_key"] = role
    return ok(data, _rid(request))


@router.get("/orgs/{org_id}/members")
async def list_members(org_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id)
    items = await svc.list_members(db, org_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.patch("/orgs/{org_id}/members/{user_id}")
async def update_member(org_id: str, user_id: str, payload: RoleIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id, admin=True)
    return ok(await svc.update_member_role(db, user, org_id, user_id, payload.role_key, _rid(request)), _rid(request))


@router.delete("/orgs/{org_id}/members/{user_id}")
async def remove_member(org_id: str, user_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id, admin=True)
    return ok(await svc.remove_member(db, user, org_id, user_id, _rid(request)), _rid(request))


@router.post("/orgs/{org_id}/invitations")
async def create_invitation(org_id: str, payload: InviteIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id, admin=True)
    return ok(await svc.create_invitation(db, user, org_id, payload.email, payload.role_key, _rid(request)), _rid(request))


@router.get("/orgs/{org_id}/invitations")
async def list_invitations(org_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id, admin=True)
    items = await svc.list_invitations(db, org_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/invitations/accept")
async def accept_invitation(payload: AcceptIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.accept_invitation(db, user, payload.token, _rid(request)), _rid(request))


@router.post("/invitations/{inv_id}/revoke")
async def revoke_invitation(inv_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.revoke_invitation(db, user, inv_id, _rid(request)), _rid(request))


@router.post("/orgs/{org_id}/teams")
async def create_team(org_id: str, payload: TeamIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_team(db, user, org_id, payload.name, payload.description, _rid(request)), _rid(request))


@router.get("/orgs/{org_id}/teams")
async def list_teams(org_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id)
    items = await svc.list_teams(db, org_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/teams/{team_id}/members")
async def add_team_member(team_id: str, payload: TeamMemberIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.add_team_member(db, user, team_id, payload.user_id, payload.role_in_team, _rid(request)), _rid(request))


@router.get("/teams/{team_id}/members")
async def list_team_members(team_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_team_members(db, user, team_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/orgs/{org_id}/workspaces")
async def create_workspace(org_id: str, payload: WorkspaceIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.create_workspace(db, user, org_id, payload.name, payload.description, _rid(request)), _rid(request))


@router.get("/orgs/{org_id}/workspaces")
async def list_workspaces(org_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await svc.ensure_org_member(db, user, org_id)
    items = await svc.list_workspaces(db, org_id)
    return ok({"items": items, "total": len(items)}, _rid(request))
