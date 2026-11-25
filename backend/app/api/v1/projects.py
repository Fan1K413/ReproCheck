"""项目管理（第六阶段：归属组织、所有者、成员与可见性隔离）。"""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_optional_user, resolve_project_access, user_has_permission
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Project
from app.models.stage6 import OrgMember, ProjectMember, User, Workspace
from app.schemas import ProjectCreate, ProjectListData, ProjectView
from app.services.trail_service import record_trail

router = APIRouter(tags=["projects"])


def _to_view(p: Project) -> ProjectView:
    return ProjectView(
        id=p.id, name=p.name, domain=p.domain or "",
        paper_title=p.paper_title or "", description=p.description or "",
        created_at=p.created_at.isoformat() if p.created_at else "",
        owner_user_id=p.owner_user_id, org_id=p.org_id,
    )


async def _visible_project_ids(db: AsyncSession, user: User) -> set[str] | None:
    """平台管理员返回 None（可见全部）；否则返回可见 project_id 集合。"""
    if user.is_platform_admin:
        return None
    pms = (await db.execute(select(ProjectMember).where(ProjectMember.user_id == user.id))).scalars().all()
    ids = {pm.project_id for pm in pms}
    oms = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id, OrgMember.role_key == "org_admin"))).scalars().all()
    admin_orgs = [om.org_id for om in oms]
    if admin_orgs:
        rows = (await db.execute(select(Project).where(Project.org_id.in_(admin_orgs)))).scalars().all()
        ids.update(p.id for p in rows)
    return ids


@router.get("/projects")
async def list_projects(request: Request, db: AsyncSession = Depends(get_db), user: User | None = Depends(get_optional_user)):
    rows = (await db.execute(select(Project).order_by(Project.created_at.desc()))).scalars().all()
    if user is not None:
        visible = await _visible_project_ids(db, user)
        if visible is not None:
            rows = [p for p in rows if p.id in visible]
    items = [_to_view(p) for p in rows]
    return ok(ProjectListData(items=items, total=len(items)), getattr(request.state, "request_id", "-"))


@router.post("/projects")
async def create_project(payload: ProjectCreate, request: Request, db: AsyncSession = Depends(get_db),
                         user: User | None = Depends(get_optional_user)):
    rid = getattr(request.state, "request_id", "-")
    try:
        org_id = payload.org_id
        if user is not None and not org_id:
            om = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().first()
            org_id = om.org_id if om else None
        if org_id and (user is None or not await user_has_permission(db, user, "project.create", org_id=org_id)):
            raise AppError("FORBIDDEN", "无权在指定组织创建项目。")
        if payload.workspace_id:
            workspace = await db.get(Workspace, payload.workspace_id)
            if not org_id or workspace is None or workspace.org_id != org_id:
                raise AppError("NOT_FOUND", "工作空间不存在或无权访问。")
        p = Project(
            id=f"proj-{uuid.uuid4().hex[:16]}",
            name=payload.name, domain=payload.domain,
            paper_title=payload.paper_title, description=payload.description,
            owner_user_id=user.id if user else None, org_id=org_id, workspace_id=payload.workspace_id,
        )
        db.add(p)
        await db.flush()
        if user is not None:
            db.add(ProjectMember(id=f"pm-{uuid.uuid4().hex[:16]}", project_id=p.id,
                                 user_id=user.id, role_key="project_lead", added_by=user.id))
            await record_trail(db, action="project.create", actor_user_id=user.id, org_id=org_id,
                               project_id=p.id, target_type="project", target_id=p.id,
                               after={"name": payload.name}, summary="创建项目", request_id=rid)
        await db.commit()
        await db.refresh(p)
        return ok(_to_view(p), rid)
    except AppError:
        raise
    except Exception:  # noqa: BLE001
        await db.rollback()
        raise AppError("DB_SAVE_FAILED", "项目保存失败。")


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                         user: User = Depends(get_optional_user)):
    """级联删除项目：材料/存储/复现与协作关联数据；审计轨迹按保留策略留存。"""
    rid = getattr(request.state, "request_id", "-")
    if user is None:
        raise AppError("UNAUTHORIZED", "需要登录。", status_code=401)
    proj = await resolve_project_access(db, project_id, user, min_rank=3)  # project_lead+

    from sqlalchemy import delete as sa_delete, update

    from app.models import Material
    from app.models.stage4 import (
        ExecutionArtifact, ExecutionEnvironment, ExecutionLog, FailureDiagnostic,
        MetricComparison, RemediationProposal, RemediationReview, ReproductionMetric, ReproductionPlan,
        ReproductionReport, ReproductionRun, ReproductionTask,
    )
    from app.models.data_audit import DataAuditRun
    from app.models.modelhub import TaskModelBinding
    from app.models.stage6 import AiConsent, Comment, RepositorySnapshot, ReviewRequest
    from app.models.stage7 import EvidenceGap, EvidenceTask, NodeAttempt, RecoveryPlan, Workflow, WorkflowEvent, WorkflowNode
    from app.models.stage12 import KnowledgeEntry
    from app.services.material_service import MaterialService

    # 物理材料文件 + DB 级联（chunks/facts/evidence）
    svc = MaterialService(db)
    materials = (await db.execute(select(Material).where(Material.project_id == project_id))).scalars().all()
    stored_paths = [m.stored_path for m in materials]
    for m in materials:
        await svc.delete(m.id, commit=False)

    # 复现引擎关联（按 project_id 清理；任务随计划 FK 级联）
    proposal_ids = select(RemediationProposal.id).where(RemediationProposal.project_id == project_id)
    await db.execute(sa_delete(RemediationReview).where(RemediationReview.proposal_id.in_(proposal_ids)))
    node_ids = select(WorkflowNode.id).where(WorkflowNode.project_id == project_id)
    await db.execute(sa_delete(NodeAttempt).where(NodeAttempt.node_id.in_(node_ids)))
    for model in (ExecutionLog, ExecutionArtifact, ReproductionMetric, MetricComparison,
                  FailureDiagnostic, RemediationProposal, ReproductionRun,
                  ExecutionEnvironment, ReproductionReport, ReproductionTask, ReproductionPlan,
                  WorkflowEvent, WorkflowNode, Workflow, EvidenceTask, EvidenceGap, RecoveryPlan,
                  DataAuditRun, RepositorySnapshot, AiConsent, TaskModelBinding):
        await db.execute(sa_delete(model).where(model.project_id == project_id))
    await db.execute(sa_delete(KnowledgeEntry).where(
        KnowledgeEntry.project_id == project_id, KnowledgeEntry.visibility == "project",
    ))
    await db.execute(update(KnowledgeEntry).where(KnowledgeEntry.project_id == project_id).values(project_id=None))
    # 协作关联（NotebookCell 随材料 FK 级联清理）
    await db.execute(sa_delete(Comment).where(Comment.project_id == project_id))
    await db.execute(sa_delete(ReviewRequest).where(ReviewRequest.project_id == project_id))
    await db.execute(sa_delete(ProjectMember).where(ProjectMember.project_id == project_id))

    await record_trail(db, action="project.delete", actor_user_id=user.id, org_id=proj.org_id,
                       project_id=project_id, target_type="project", target_id=project_id,
                       before={"name": proj.name}, summary="删除项目并级联清理", request_id=rid)
    await db.delete(proj)
    await db.commit()
    for path in stored_paths:
        svc.remove_file(path)
    return ok({"deleted": True, "project_id": project_id,
               "materials_removed": len(materials)}, rid)
