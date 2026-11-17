"""第二阶段解析任务 API。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Material
from app.models.stage2 import ParseTask
from app.services.task_service import STAGE_LABELS, TaskService

router = APIRouter(tags=["parse-tasks"])


def _view(t: ParseTask, material_name: str = "") -> dict:
    return {
        "task_id": t.id, "material_id": t.material_id,
        "material_name": material_name, "project_id": t.project_id,
        "status": t.status, "stage": t.stage,
        "stage_message": t.stage_message or STAGE_LABELS.get(t.stage, t.stage),
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "error_code": t.error_code, "error_message": t.error_message,
        "model": t.model, "prompt_version": t.prompt_version,
        "model_calls": t.model_calls, "total_tokens": t.total_tokens,
        "prompt_tokens": t.prompt_tokens, "completion_tokens": t.completion_tokens,
        "duration_ms": t.duration_ms, "facts_count": t.facts_count,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


@router.post("/materials/{material_id}/parse", dependencies=[Depends(require_admin)])
async def start_parse(material_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = TaskService(db)
    task = await service.start(material_id)
    was_cached = task.status == "completed"
    if not was_cached:
        task = await service.run(task.id)
    return ok(_view(task), getattr(request.state, "request_id", "-"))


@router.get("/parse-tasks/{task_id}")
async def get_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    task = (await db.execute(select(ParseTask).where(ParseTask.id == task_id))).scalar_one_or_none()
    if task is None:
        raise AppError("NOT_FOUND", "任务不存在。")
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.get("/parse-tasks")
async def list_tasks(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ParseTask).where(ParseTask.project_id == project_id)
        .order_by(ParseTask.created_at.desc())
    )).scalars().all()
    items = []
    for t in rows:
        m = (await db.execute(select(Material).where(Material.id == t.material_id))).scalar_one_or_none()
        items.append(_view(t, m.source_name if m else ""))
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.post("/parse-tasks/{task_id}/retry", dependencies=[Depends(require_admin)])
async def retry_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = TaskService(db)
    task = await service.retry(task_id)
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.delete("/parse-tasks/{task_id}", dependencies=[Depends(require_admin)])
async def cancel_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = TaskService(db)
    return ok(await service.cancel(task_id), getattr(request.state, "request_id", "-"))
