"""外部集成路由（D）：仓库连接器 / 快照 / Notebook 细胞结构。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import notebook_service, repository_service

router = APIRouter(tags=["integrations"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class RepoConnectIn(BaseModel):
    provider: str
    account_label: str = ""
    auth_type: str = "pat"
    token: str | None = None
    org_id: str | None = None
    repo_allowlist: list[str] = []
    scopes: list[str] = []


class RepoSyncIn(BaseModel):
    repo_full_name: str
    ref: str = ""


@router.post("/integrations/repositories")
async def connect(payload: RepoConnectIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await repository_service.connect_repository(db, user, payload.model_dump(), _rid(request)), _rid(request))


@router.get("/integrations/repositories")
async def list_repos(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await repository_service.list_repositories(db, user)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/integrations/repositories/{conn_id}/revoke")
async def revoke(conn_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await repository_service.revoke_repository(db, user, conn_id, _rid(request)), _rid(request))


@router.post("/integrations/repositories/{conn_id}/sync")
async def sync(conn_id: str, payload: RepoSyncIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await repository_service.sync_repository(db, user, conn_id, payload.repo_full_name, payload.ref, _rid(request)), _rid(request))


@router.get("/integrations/repositories/{conn_id}/snapshots")
async def snapshots(conn_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await repository_service.list_snapshots(db, user, conn_id)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.get("/materials/{material_id}/notebook")
async def notebook(material_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await notebook_service.get_notebook(db, user, material_id), _rid(request))