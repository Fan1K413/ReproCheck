"""开放 API（D）：独立路由 /api/open/v1，rc_live_ 令牌认证 + scope + 速率限制 + 调用日志。

与内部 JWT 路由完全分离；所有访问按令牌所属用户的项目可见性隔离。失败明确报错，不伪造结果。
"""
from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, Depends, File, Form, Header, Request, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_project_permission, user_has_permission
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Material, Project
from app.models.stage2 import ParseTask
from app.models.stage4 import ReproductionReport, ReproductionRun
from app.models.stage6 import ApiToken, OrgMember, ProjectMember, User
from app.parsers.limits import MAX_SINGLE_FILE_BYTES
from app.services import api_token_service as tok
from app.services.material_service import MaterialService
from app.services.task_service import TaskService

open_router = APIRouter(prefix="/api/open/v1", tags=["open-api"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


async def _visible_ids(db: AsyncSession, user: User) -> set[str] | None:
    if user.is_platform_admin:
        return None
    pms = (await db.execute(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))).scalars().all()
    ids = set(pms)
    oms = (await db.execute(select(OrgMember.org_id).where(
        OrgMember.user_id == user.id, OrgMember.role_key == "org_admin"))).scalars().all()
    if oms:
        rows = (await db.execute(select(Project.id).where(Project.org_id.in_(oms)))).scalars().all()
        ids.update(rows)
    return ids


async def get_api_context(
    request: Request,
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
) -> tuple[ApiToken, User]:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError("UNAUTHORIZED", "需要开放 API 令牌（Bearer rc_live_...）。", status_code=401)
    plain = authorization.split(" ", 1)[1].strip()
    token = await tok.authenticate(db, plain)
    tok.check_rate_limit(token)
    user = (await db.execute(select(User).where(User.id == token.user_id))).scalar_one_or_none()
    if user is None or not user.is_active:
        raise AppError("UNAUTHORIZED", "令牌所属用户不可用。", status_code=401)
    request.state.api_token = token
    return token, user


async def _log(request: Request, db: AsyncSession, token: ApiToken, status_code: int, started: float) -> None:
    await tok.log_call(db, token, request.url.path, request.method, status_code,
                       int((time.perf_counter() - started) * 1000),
                       request.client.host if request.client else "")


@open_router.get("/projects")
async def list_projects(request: Request, ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "project.read")
    visible = await _visible_ids(db, user)
    rows = (await db.execute(select(Project).order_by(Project.created_at.desc()))).scalars().all()
    if visible is not None:
        rows = [p for p in rows if p.id in visible]
    items = [{"id": p.id, "name": p.name, "domain": p.domain or "", "org_id": p.org_id} for p in rows]
    await _log(request, db, token, 200, started)
    return ok({"items": items, "total": len(items)}, _rid(request))


@open_router.post("/projects")
async def create_project(request: Request, ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "project.write")
    if token.org_id and not await user_has_permission(db, user, "project.create", org_id=token.org_id):
        raise AppError("FORBIDDEN", "无权在指定组织创建项目。")
    body = await request.json()
    name = (body or {}).get("name")
    if not name:
        raise AppError("VALIDATION_ERROR", "缺少项目名称 name。")
    p = Project(id=f"proj-{uuid.uuid4().hex[:16]}", name=name, domain=(body or {}).get("domain", ""),
                paper_title=(body or {}).get("paper_title", ""), description=(body or {}).get("description", ""),
                owner_user_id=user.id, org_id=token.org_id)
    db.add(p)
    await db.flush()
    db.add(ProjectMember(id=f"pm-{uuid.uuid4().hex[:16]}", project_id=p.id, user_id=user.id,
                         role_key="project_lead", added_by=user.id))
    await db.commit()
    await db.refresh(p)
    await _log(request, db, token, 200, started)
    return ok({"id": p.id, "name": p.name, "org_id": p.org_id}, _rid(request))


@open_router.post("/materials")
async def upload_material(request: Request, project_id: str = Form(...), file: UploadFile = File(...),
                          ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "material.write")
    await check_project_permission(db, user, project_id, "material.upload")
    data = await file.read(MAX_SINGLE_FILE_BYTES + 1)
    material = await MaterialService(db).upload(project_id, file.filename or "unnamed", data)
    await _log(request, db, token, 200, started)
    return ok({"material_id": material.id, "parse_status": material.parse_status}, _rid(request))


@open_router.post("/audits")
async def start_audit(request: Request, ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "audit.run")
    body = await request.json()
    material_id = (body or {}).get("material_id")
    if not material_id:
        raise AppError("VALIDATION_ERROR", "缺少 material_id。")
    m = (await db.execute(select(Material).where(Material.id == material_id))).scalar_one_or_none()
    if m is None:
        raise AppError("NOT_FOUND", "材料不存在。")
    await check_project_permission(db, user, m.project_id, "audit.run")
    service = TaskService(db)
    task = await service.start(material_id)
    if task.status != "completed":
        task = await service.run(task.id)
    await _log(request, db, token, 200, started)
    return ok({"task_id": task.id, "status": task.status, "facts_count": task.facts_count,
               "error_code": task.error_code}, _rid(request))


@open_router.get("/audits/{task_id}")
async def get_audit(task_id: str, request: Request, ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "audit.read")
    t = (await db.execute(select(ParseTask).where(ParseTask.id == task_id))).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "审计任务不存在。")
    visible = await _visible_ids(db, user)
    if visible is not None and t.project_id not in visible:
        raise AppError("NOT_FOUND", "审计任务不存在或无权访问。")
    await _log(request, db, token, 200, started)
    return ok({"task_id": t.id, "status": t.status, "facts_count": t.facts_count,
               "model_calls": t.model_calls, "total_tokens": t.total_tokens}, _rid(request))


@open_router.get("/reproductions")
async def list_reproductions(request: Request, project_id: str | None = None,
                             ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "repro.read")
    visible = await _visible_ids(db, user)
    stmt = select(ReproductionRun).order_by(ReproductionRun.created_at.desc())
    if project_id:
        stmt = stmt.where(ReproductionRun.project_id == project_id)
    rows = (await db.execute(stmt)).scalars().all()
    if visible is not None:
        rows = [r for r in rows if r.project_id in visible]
    items = [{"run_id": r.id, "project_id": r.project_id, "status": r.status,
              "execution_enabled": r.execution_enabled} for r in rows]
    await _log(request, db, token, 200, started)
    return ok({"items": items, "total": len(items)}, _rid(request))


@open_router.get("/reports/{report_id}")
async def get_report(report_id: str, request: Request, ctx=Depends(get_api_context), db: AsyncSession = Depends(get_db)):
    started = time.perf_counter()
    token, user = ctx
    tok.check_scope(token, "report.read")
    r = (await db.execute(select(ReproductionReport).where(ReproductionReport.id == report_id))).scalar_one_or_none()
    if r is None:
        raise AppError("NOT_FOUND", "报告不存在。")
    visible = await _visible_ids(db, user)
    if visible is not None and r.project_id not in visible:
        raise AppError("NOT_FOUND", "报告不存在或无权访问。")
    await _log(request, db, token, 200, started)
    return ok({"report_id": r.id, "title": r.title, "status": r.status, "version": r.version,
               "html_available": bool(r.html), "scope_note": r.scope_note}, _rid(request))
