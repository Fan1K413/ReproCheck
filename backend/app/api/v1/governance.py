"""安全与数据治理路由（E）：数据分级 / AI 授权 / 本人数据导出 / 保留策略。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, user_has_permission
from app.core.errors import AppError, ok
from app.db import get_db
from app.models.stage6 import User
from app.services import governance_service as svc

router = APIRouter(tags=["governance"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class ConsentIn(BaseModel):
    allow_external_llm: bool = False
    scope: str = "project"
    project_id: str | None = None
    org_id: str | None = None


@router.get("/governance/classification")
async def classification(request: Request, user: User = Depends(get_current_user)):
    return ok(svc.classification_view(), _rid(request))


@router.post("/governance/ai-consent")
async def grant_consent(payload: ConsentIn, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.grant_ai_consent(db, user, payload.model_dump(), _rid(request)), _rid(request))


@router.get("/governance/ai-consent")
async def get_consent(request: Request, project_id: str | None = None, org_id: str | None = None,
                      db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.get_ai_consent(db, user, project_id, org_id), _rid(request))


@router.post("/governance/export")
async def export(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.request_export(db, user, _rid(request)), _rid(request))


@router.get("/governance/export/{request_id}")
async def get_export(request_id: str, request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    return ok(await svc.get_export(db, user, request_id), _rid(request))


@router.get("/governance/export/{request_id}/download")
async def download_export(request_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    path = await svc.export_file_path(db, user, request_id)
    return FileResponse(path, media_type="application/zip", filename=f"{request_id}.zip")


@router.get("/governance/retention")
async def retention(request: Request, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    from sqlalchemy import select

    from app.models.stage6 import OrgMember
    allowed = user.is_platform_admin
    if not allowed:
        admin_orgs = (await db.execute(select(OrgMember.org_id).where(
            OrgMember.user_id == user.id, OrgMember.role_key == "org_admin"))).scalars().all()
        for oid in admin_orgs:
            if await user_has_permission(db, user, "data.manage", org_id=oid):
                allowed = True
                break
    if not allowed:
        raise AppError("FORBIDDEN", "缺少权限：data.manage（组织管理员）。")
    return ok(svc.retention_view(), _rid(request))