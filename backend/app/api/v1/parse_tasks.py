"""第二阶段解析任务 API（含第六阶段暂停/恢复/超时恢复编排）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    check_project_permission,
    get_optional_user,
    require_admin,
    require_write_user,
    resolve_project_access,
)
from app.api.isolation import require_project_write
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Material
from app.models.stage2 import ParseTask
from app.models.stage6 import User
from app.services.task_service import STAGE_LABELS, TaskService

router = APIRouter(tags=["parse-tasks"])


def _view(t: ParseTask, material_name: str = "") -> dict:
    import json as _json
    result_data = None
    if t.result_json:
        try:
            result_data = _json.loads(t.result_json)
        except Exception:  # noqa: BLE001
            result_data = None
    return {
        "task_id": t.id, "material_id": t.material_id,
        "material_name": material_name, "project_id": t.project_id,
        "status": t.status, "stage": t.stage,
        "stage_message": t.stage_message or STAGE_LABELS.get(t.stage, t.stage),
        "started_at": t.started_at.isoformat() if t.started_at else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
        "error_code": t.error_code, "error_message": t.error_message,
        "failure_category": t.failure_category or "",
        "paused_at": t.paused_at.isoformat() if t.paused_at else None,
        "resume_count": t.resume_count or 0,
        "timeout_seconds": t.timeout_seconds or 600,
        "model": t.model, "prompt_version": t.prompt_version,
        "model_calls": t.model_calls, "total_tokens": t.total_tokens,
        "prompt_tokens": t.prompt_tokens, "completion_tokens": t.completion_tokens,
        "duration_ms": t.duration_ms, "facts_count": t.facts_count,
        "result": result_data,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


async def _task_for_request(
    request: Request,
    db: AsyncSession,
    task_id: str,
    user: User | None,
) -> ParseTask:
    """按 ID 读取任务并做项目级隔离。

    查询参数若提供项目，必须与任务实际归属一致。
    """
    task = (await db.execute(select(ParseTask).where(ParseTask.id == task_id))).scalar_one_or_none()
    if task is None:
        raise AppError("NOT_FOUND", "任务不存在。")
    if user is None or user.is_platform_admin:
        return task
    query_project_id = request.query_params.get("project_id")
    if query_project_id and query_project_id != task.project_id:
        raise AppError("NOT_FOUND", "任务不存在或无权访问。")
    await resolve_project_access(db, task.project_id, user)
    return task


class RecoverStaleBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str | None = None


# 注意：静态路径必须在 /parse-tasks/{task_id} 动态路由之前注册
@router.post("/parse-tasks/recover-stale", dependencies=[Depends(require_admin)])
async def recover_stale_tasks(
    request: Request,
    payload: RecoverStaleBody | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write_user),
):
    """管理员批量恢复心跳过期任务；非平台管理员必须指定可访问的项目。

    project_id 同时支持 query 与 JSON body（body 优先），避免 POST 端点只能靠 URL 传参。
    """
    project_id = (payload.project_id if payload else None) or request.query_params.get("project_id")
    if user is not None and not user.is_platform_admin:
        if not project_id:
            raise AppError("FORBIDDEN", "非平台管理员需通过 project_id 限定恢复范围。")
        await check_project_permission(db, user, project_id, "audit.run")
    service = TaskService(db)
    recovered = await service.recover_stale_tasks(project_id=project_id)
    return ok({"recovered": recovered}, getattr(request.state, "request_id", "-"))


@router.post("/materials/{material_id}/parse", dependencies=[
    Depends(require_admin), Depends(require_project_write("audit.run")),
])
async def start_parse(material_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    service = TaskService(db)
    task = await service.start(material_id)
    was_cached = task.status == "completed"
    if not was_cached:
        task = await service.run(task.id)
    # 与 GET /parse-tasks/{id} 保持一致：补全材料名，避免"刚解析完"与"随后查询"展示不一致。
    m = (await db.execute(
        select(Material).where(Material.id == task.material_id)
    )).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.get("/parse-tasks/{task_id}")
async def get_task(
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User | None = Depends(get_optional_user),
):
    task = await _task_for_request(request, db, task_id, user)
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.get("/parse-tasks")
async def list_tasks(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ParseTask, Material.source_name)
        .outerjoin(Material, Material.id == ParseTask.material_id)
        .where(ParseTask.project_id == project_id)
        .order_by(ParseTask.created_at.desc())
    )).all()
    items = [_view(task, source_name or "") for task, source_name in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.post("/parse-tasks/{task_id}/retry", dependencies=[
    Depends(require_admin), Depends(require_project_write("audit.run")),
])
async def retry_task(
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write_user),
):
    await _task_for_request(request, db, task_id, user)
    service = TaskService(db)
    task = await service.retry(task_id)
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.post("/parse-tasks/{task_id}/pause", dependencies=[
    Depends(require_admin), Depends(require_project_write("audit.run")),
])
async def pause_task(
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write_user),
):
    await _task_for_request(request, db, task_id, user)
    service = TaskService(db)
    task = await service.pause(task_id)
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.post("/parse-tasks/{task_id}/resume", dependencies=[
    Depends(require_admin), Depends(require_project_write("audit.run")),
])
async def resume_task(
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write_user),
):
    await _task_for_request(request, db, task_id, user)
    service = TaskService(db)
    task = await service.resume(task_id)
    m = (await db.execute(select(Material).where(Material.id == task.material_id))).scalar_one_or_none()
    return ok(_view(task, m.source_name if m else ""), getattr(request.state, "request_id", "-"))


@router.delete("/parse-tasks/{task_id}", dependencies=[
    Depends(require_admin), Depends(require_project_write("audit.run")),
])
async def cancel_task(
    task_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_write_user),
):
    await _task_for_request(request, db, task_id, user)
    service = TaskService(db)
    return ok(await service.cancel(task_id), getattr(request.state, "request_id", "-"))
