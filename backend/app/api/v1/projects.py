"""项目管理。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Project
from app.schemas import ProjectCreate, ProjectListData, ProjectView

router = APIRouter(tags=["projects"])


def _to_view(p: Project) -> ProjectView:
    return ProjectView(
        id=p.id, name=p.name, domain=p.domain or "",
        paper_title=p.paper_title or "", description=p.description or "",
        created_at=p.created_at.isoformat() if p.created_at else "",
    )


@router.get("/projects")
async def list_projects(request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Project).order_by(Project.created_at.desc()))).scalars().all()
    items = [_to_view(p) for p in rows]
    return ok(ProjectListData(items=items, total=len(items)),
              getattr(request.state, "request_id", "-"))


@router.post("/projects")
async def create_project(payload: ProjectCreate, request: Request, db: AsyncSession = Depends(get_db)):
    try:
        p = Project(
            id=f"proj-{uuid.uuid4().hex[:16]}",
            name=payload.name, domain=payload.domain,
            paper_title=payload.paper_title, description=payload.description,
        )
        db.add(p)
        await db.commit()
        await db.refresh(p)
        return ok(_to_view(p), getattr(request.state, "request_id", "-"))
    except Exception as exc:  # noqa: BLE001
        await db.rollback()
        raise AppError("DB_SAVE_FAILED", "项目保存失败。")
