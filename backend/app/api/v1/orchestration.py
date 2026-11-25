"""第七阶段 · 科研工作流编排路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, resolve_project_access
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services.orchestration_service import OrchestrationService
from app.workflow.templates import list_templates

router = APIRouter(tags=["orchestration"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class TemplateCreateIn(BaseModel):
    title: str | None = None
    node_overrides: dict[str, dict] | None = None


class ManualNodeIn(BaseModel):
    node_key: str
    title: str
    handler: str
    node_type: str = "check"
    depends_on: list[str] = []
    priority: int = 5
    preconditions: dict = {}
    action: str = ""
    expected_result: str = ""
    acceptance_criteria: str = ""
    evidence_targets: list[str] = []
    risk_level: str = "low"
    needs_human_confirm: bool = False
    max_retries: int = 0


class ManualCreateIn(BaseModel):
    title: str
    description: str = ""
    nodes: list[ManualNodeIn]


class ConfirmIn(BaseModel):
    decision: str
    note: str = ""


@router.get("/workflow-templates")
async def list_workflow_templates():
    return ok({"items": list_templates()})


@router.get("/projects/{project_id}/workflows")
async def list_workflows(project_id: str, request: Request,
                         db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = OrchestrationService(db)
    from app.models.stage7 import Workflow
    from sqlalchemy import select
    rows = (await db.execute(
        select(Workflow).where(Workflow.project_id == project_id).order_by(Workflow.created_at)
    )).scalars().all()
    return ok({"items": [svc._wf_view(w) for w in rows]}, _rid(request))


@router.post("/projects/{project_id}/workflows/templates/{template_key}")
async def create_from_template(project_id: str, template_key: str, payload: TemplateCreateIn,
                               request: Request, db: AsyncSession = Depends(get_db),
                               user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = OrchestrationService(db)
    wf = await svc.create_from_template(
        project_id, template_key, title=payload.title,
        node_overrides=payload.node_overrides, user_id=user.id,
    )
    return ok(await svc.workflow_view(wf.id), _rid(request))


@router.post("/projects/{project_id}/workflows/manual")
async def create_manual(project_id: str, payload: ManualCreateIn, request: Request,
                        db: AsyncSession = Depends(get_db),
                        user: User = Depends(get_current_user)):
    await resolve_project_access(db, project_id, user)
    svc = OrchestrationService(db)
    nodes = [n.model_dump() for n in payload.nodes]
    wf = await svc.create_manual(
        project_id, payload.title, nodes, description=payload.description, user_id=user.id,
    )
    return ok(await svc.workflow_view(wf.id), _rid(request))


@router.get("/workflows/{workflow_id}")
async def get_workflow(workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    return ok(await svc.workflow_view(workflow_id), _rid(request))


@router.post("/workflows/{workflow_id}/start")
async def start_workflow(workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    await svc.start(workflow_id, user_id=user.id)
    return ok(await svc.workflow_view(workflow_id), _rid(request))


@router.post("/workflows/{workflow_id}/pause")
async def pause_workflow(workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    await svc.pause(workflow_id, user_id=user.id)
    return ok(await svc.workflow_view(workflow_id), _rid(request))


@router.post("/workflows/{workflow_id}/resume")
async def resume_workflow(workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    await svc.resume(workflow_id, user_id=user.id)
    return ok(await svc.workflow_view(workflow_id), _rid(request))


@router.post("/workflows/{workflow_id}/cancel")
async def cancel_workflow(workflow_id: str, request: Request, db: AsyncSession = Depends(get_db),
                          user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    result = await svc.cancel(workflow_id, user_id=user.id)
    return ok(result, _rid(request))


@router.post("/workflows/{workflow_id}/nodes/{node_id}/confirm")
async def confirm_node(workflow_id: str, node_id: str, payload: ConfirmIn, request: Request,
                       db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    await svc.confirm_node(node_id, payload.decision, note=payload.note, user_id=user.id)
    return ok(await svc.workflow_view(workflow_id), _rid(request))


@router.post("/workflows/{workflow_id}/nodes/{node_id}/retry")
async def retry_node(workflow_id: str, node_id: str, request: Request,
                     db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    svc = OrchestrationService(db)
    wf = await svc._get_workflow(workflow_id)
    await resolve_project_access(db, wf.project_id, user)
    await svc.retry_node(node_id, user_id=user.id)
    return ok(await svc.workflow_view(workflow_id), _rid(request))
