"""科研项目交接包 API：导出 ZIP 与上传校验（只校验、不写库）。

路由挂载时统一带 enforce_project_isolation；本模块再用 get_current_user
明确要求登录，确保非项目成员无法导出或校验他人项目交接包。
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import handoff_service as svc

router = APIRouter(tags=["handoff"])


def _safe_filename(project_id: str) -> str:
    """路径参数进入下载文件名前净化，避免响应头注入。"""
    return re.sub(r"[^A-Za-z0-9_-]", "_", project_id) or "project"


@router.post("/projects/{project_id}/handoff/export")
async def export_handoff(
    project_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> Response:
    files = await svc.build_bundle(db, user, project_id)
    filename = f"handoff-{_safe_filename(project_id)}.zip"
    return Response(
        content=svc.write_zip(files),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/projects/{project_id}/handoff/validate")
async def validate_handoff(
    project_id: str,
    request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    data = await file.read()
    result = await svc.validate_bundle(db, user, data, project_id)
    return ok(result, getattr(request.state, "request_id", "-"))
