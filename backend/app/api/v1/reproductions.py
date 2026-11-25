"""第四阶段：复现规划/任务/运行/环境/指标/诊断/报告 API。

全部追加式注册，不改前序任何路由。
"""
from __future__ import annotations

import json
from typing import Any, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.errors import AppError, ok
from app.db import get_db
from app.models.stage4 import (
    ExecutionArtifact,
    ExecutionEnvironment,
    ExecutionLog,
    FailureDiagnostic,
    MetricComparison,
    ReproductionMetric,
    ReproductionPlan,
    ReproductionReport,
    ReproductionRun,
    ReproductionTask,
    RemediationReview,
)
from app.reproduction.diagnostics import FailureDiagnoser
from app.reproduction.planner import ReproductionPlanner
from app.reproduction.sandbox import ExecutionSandbox
from app.reproduction.results import QualityEvaluator

router = APIRouter(tags=["reproductions"])


# view helpers

def _task_view(t: ReproductionTask) -> dict[str, Any]:
    return {
        "task_id": t.id, "plan_id": t.plan_id, "task_key": t.task_key,
        "title": t.title, "description": t.description,
        "depends_on": json.loads(t.depends_on_json or "[]"),
        "required_materials": json.loads(t.required_materials_json or "[]"),
        "action": t.action, "expected_result": t.expected_result,
        "acceptance_criteria": t.acceptance_criteria,
        "evidence_refs": json.loads(t.evidence_refs_json or "[]"),
        "risk": t.risk, "feasibility": t.feasibility,
        "feasibility_reason": t.feasibility_reason,
        "needs_human_confirm": t.needs_human_confirm, "status": t.status,
        "created_at": t.created_at.isoformat() if t.created_at else "",
    }


def _plan_view(p: ReproductionPlan) -> dict[str, Any]:
    summary = json.loads(p.feasibility_summary_json or "{}")
    return {
        "plan_id": p.id, "project_id": p.project_id, "title": p.title,
        "status": p.status, "source": p.source, "ai_available": p.ai_available,
        "prompt_version": p.prompt_version or "", "model": p.model or "",
        # 可行性摘要可能含描述性字段（如变更重审草稿的触发信息），只对数值项计数，
        # 避免非数值字段导致 500（浏览器实测发现）。
        "feasibility_summary": summary,
        "task_count": sum(v for v in summary.values()
                          if isinstance(v, (int, float)) and not isinstance(v, bool)) if summary else 0,
        "created_at": p.created_at.isoformat() if p.created_at else "",
    }


def _run_view(r: ReproductionRun) -> dict[str, Any]:
    return {
        "run_id": r.id, "plan_id": r.plan_id, "project_id": r.project_id,
        "status": r.status, "execution_enabled": r.execution_enabled,
        "security_check": json.loads(r.security_check_json or "{}"),
        "environment_id": r.environment_id,
        "task_ids": json.loads(r.task_ids_json or "[]"),
        "started_at": r.started_at.isoformat() if r.started_at else None,
        "finished_at": r.finished_at.isoformat() if r.finished_at else None,
        "duration_ms": r.duration_ms,
        "resource_usage": {"cpu_seconds": r.cpu_seconds, "memory_mb": r.memory_mb},
        "error_message": r.error_message,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }


def _env_view(e: ExecutionEnvironment) -> dict[str, Any]:
    return {
        "environment_id": e.id, "project_id": e.project_id, "material_id": e.material_id or "",
        "python_version": e.python_version,
        "frameworks": json.loads(e.frameworks_json or "{}"),
        "dependencies": json.loads(e.dependencies_json or "[]"),
        "hardware_requirements": json.loads(e.hardware_json or "{}"),
        "entrypoints": json.loads(e.entrypoints_json or "[]"),
        "missing": json.loads(e.missing_json or "[]"),
        "warnings": json.loads(e.warnings_json or "[]"),
        "created_at": e.created_at.isoformat() if e.created_at else "",
    }


# request models

class PlanCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str
    title: str | None = None
    mode: Literal["ai", "manual"] = "ai"


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str
    description: str = ""
    depends_on: list[str] = []
    required_materials: list[str] = []
    action: str = ""
    expected_result: str = ""
    acceptance_criteria: str = ""
    risk: str = ""
    evidence_refs: list[str] = []
    needs_human_confirm: bool = True


class RunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    plan_id: str
    task_ids: list[str] = []
    requested_by: str = "local-user"


class DiagnosticCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    run_id: str
    project_id: str
    problem: str | None = None


class ReviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: str
    reviewer: str
    note: str = ""
    modified_value: str | None = None


class ReportCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project_id: str
    plan_id: str | None = None
    run_ids: list[str] = []


# plans / tasks

@router.post("/reproductions/plans", dependencies=[Depends(require_admin)])
async def create_plan(payload: PlanCreate, request: Request, db: AsyncSession = Depends(get_db)):
    planner = ReproductionPlanner(db)
    if payload.mode == "manual":
        plan = await planner.create_manual_plan(payload.project_id, payload.title)
    else:
        plan = await planner.create_plan(payload.project_id, payload.title)
    return ok(_plan_view(plan), getattr(request.state, "request_id", "-"))


@router.get("/reproductions/plans")
async def list_plans(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ReproductionPlan).where(ReproductionPlan.project_id == project_id)
        .order_by(ReproductionPlan.created_at.desc())
    )).scalars().all()
    items = [_plan_view(p) for p in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/plans/{plan_id}")
async def get_plan(plan_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    plan = (await db.execute(
        select(ReproductionPlan).where(ReproductionPlan.id == plan_id)
    )).scalar_one_or_none()
    if plan is None:
        raise AppError("NOT_FOUND", "复现规划不存在。")
    tasks = (await db.execute(
        select(ReproductionTask).where(ReproductionTask.plan_id == plan_id)
        .order_by(ReproductionTask.task_key)
    )).scalars().all()
    views = [_task_view(t) for t in tasks]
    edges = [{"from": d, "to": t["task_key"]}
             for t in views for d in t["depends_on"]]
    data = _plan_view(plan)
    data["tasks"] = views
    data["dag"] = {
        "nodes": [{"id": t["task_key"], "label": t["title"],
                   "status": t["status"], "feasibility": t["feasibility"]} for t in views],
        "edges": edges,
    }
    return ok(data, getattr(request.state, "request_id", "-"))


@router.post("/reproductions/plans/{plan_id}/tasks", dependencies=[Depends(require_admin)])
async def add_task(plan_id: str, payload: TaskCreate, request: Request,
                   db: AsyncSession = Depends(get_db)):
    task = await ReproductionPlanner(db).add_manual_task(plan_id, payload.model_dump())
    return ok(_task_view(task), getattr(request.state, "request_id", "-"))


@router.get("/reproductions/tasks/{task_id}")
async def get_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    t = (await db.execute(
        select(ReproductionTask).where(ReproductionTask.id == task_id)
    )).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "复现任务不存在。")
    return ok(_task_view(t), getattr(request.state, "request_id", "-"))


@router.post("/reproductions/tasks/{task_id}/confirm", dependencies=[Depends(require_admin)])
async def confirm_task(task_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    t = (await db.execute(
        select(ReproductionTask).where(ReproductionTask.id == task_id)
    )).scalar_one_or_none()
    if t is None:
        raise AppError("NOT_FOUND", "复现任务不存在。")
    t.status = "confirmed"
    db.add(t)
    await db.commit()
    return ok({"confirmed": True, "status": t.status}, getattr(request.state, "request_id", "-"))


# runs / env / logs / artifacts / metrics

@router.post("/reproductions/runs", dependencies=[Depends(require_admin)])
async def create_run(payload: RunCreate, request: Request, db: AsyncSession = Depends(get_db)):
    plan = (await db.execute(
        select(ReproductionPlan).where(ReproductionPlan.id == payload.plan_id)
    )).scalar_one_or_none()
    if plan is None:
        raise AppError("NOT_FOUND", "复现规划不存在。")
    run = await ExecutionSandbox(db).create_run(
        plan_id=plan.id, project_id=plan.project_id,
        task_ids=payload.task_ids, requested_by=payload.requested_by,
    )
    return ok(_run_view(run), getattr(request.state, "request_id", "-"))


@router.get("/reproductions/runs")
async def list_runs(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ReproductionRun).where(ReproductionRun.project_id == project_id)
        .order_by(ReproductionRun.created_at.desc())
    )).scalars().all()
    items = [_run_view(r) for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


def _check_project(row, project_id: str | None) -> None:
    """项目隔离校验：调用方声明 project_id 时必须匹配记录归属。"""
    if project_id and getattr(row, "project_id", None) != project_id:
        raise AppError("FORBIDDEN", "无权访问其他项目的记录。")


@router.get("/reproductions/runs/{run_id}")
async def get_run(run_id: str, request: Request, project_id: str | None = None,
                  db: AsyncSession = Depends(get_db)):
    r = (await db.execute(select(ReproductionRun).where(ReproductionRun.id == run_id))).scalar_one_or_none()
    if r is None:
        raise AppError("NOT_FOUND", "运行记录不存在。")
    _check_project(r, project_id)
    return ok(_run_view(r), getattr(request.state, "request_id", "-"))


@router.post("/reproductions/runs/{run_id}/cancel", dependencies=[Depends(require_admin)])
async def cancel_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    return ok(await ExecutionSandbox(db).cancel(run_id), getattr(request.state, "request_id", "-"))


async def _assert_run_access(db: AsyncSession, run_id: str, project_id: str | None) -> None:
    if not project_id:
        return
    row = (await db.execute(select(ReproductionRun).where(ReproductionRun.id == run_id))).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", "运行记录不存在。")
    _check_project(row, project_id)


@router.get("/reproductions/runs/{run_id}/logs")
async def get_logs(run_id: str, request: Request, project_id: str | None = None,
                   db: AsyncSession = Depends(get_db)):
    await _assert_run_access(db, run_id, project_id)
    rows = (await db.execute(
        select(ExecutionLog).where(ExecutionLog.run_id == run_id)
        .order_by(ExecutionLog.created_at)
    )).scalars().all()
    items = [{"log_id": r.log_id, "stream": r.stream, "content": r.content,
              "created_at": r.created_at.isoformat() if r.created_at else ""} for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/runs/{run_id}/artifacts")
async def get_artifacts(run_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ExecutionArtifact).where(ExecutionArtifact.run_id == run_id)
    )).scalars().all()
    items = [{"artifact_id": r.artifact_id, "name": r.name, "path": r.path,
              "size_bytes": r.size_bytes, "hash": r.hash,
              "created_at": r.created_at.isoformat() if r.created_at else ""} for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/runs/{run_id}/metrics")
async def get_run_metrics(run_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ReproductionMetric).where(ReproductionMetric.run_id == run_id)
    )).scalars().all()
    items = [{"metric_name": r.metric_name, "metric_value": r.metric_value, "unit": r.unit,
              "source": r.source, "extraction_method": r.extraction_method,
              "run_id": r.run_id, "confidence": r.confidence,
              "needs_manual_review": r.needs_manual_review,
              "created_at": r.created_at.isoformat() if r.created_at else ""} for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproduction_metrics/project")
async def get_project_metrics(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    """供对照使用的项目级真实指标（前端契约另有 metric-comparisons 接口）。"""
    rows = (await db.execute(
        select(ReproductionMetric).where(ReproductionMetric.project_id == project_id)
    )).scalars().all()
    items = [{"metric_name": r.metric_name, "metric_value": r.metric_value,
              "unit": r.unit, "source": r.source, "run_id": r.run_id} for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/environments")
async def list_environments(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ExecutionEnvironment).where(ExecutionEnvironment.project_id == project_id)
        .order_by(ExecutionEnvironment.created_at.desc())
    )).scalars().all()
    items = [_env_view(e) for e in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


# comparisons / quality

@router.get("/reproductions/metric-comparisons")
async def list_comparisons(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(MetricComparison).where(MetricComparison.project_id == project_id)
        .order_by(MetricComparison.created_at.desc())
    )).scalars().all()
    items = [{
        "comparison_id": r.id, "metric_name": r.metric_name,
        "paper_value": r.paper_value, "reproduced_value": r.reproduced_value,
        "unit": r.unit, "diff_absolute": r.diff_absolute, "diff_relative": r.diff_relative,
        "verdict": r.verdict, "rule": r.rule, "tolerance_basis": r.tolerance_basis,
        "conditions_check": json.loads(r.conditions_json or "{}"),
        "created_at": r.created_at.isoformat() if r.created_at else "",
    } for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/quality")
async def get_quality(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    from app.models import ExtractedFact
    facts = (await db.execute(
        select(ExtractedFact).where(ExtractedFact.project_id == project_id)
    )).scalars().all()
    from app.models.stage2 import EvidenceItem
    evidence_count = (await db.execute(
        select(EvidenceItem).where(EvidenceItem.project_id == project_id)
    )).scalars().all()
    runs = (await db.execute(
        select(ReproductionRun).where(ReproductionRun.project_id == project_id)
    )).scalars().all()
    comparisons = (await db.execute(
        select(MetricComparison).where(MetricComparison.project_id == project_id)
    )).scalars().all()
    envs = (await db.execute(
        select(ExecutionEnvironment).where(ExecutionEnvironment.project_id == project_id)
    )).scalars().all()
    env_missing: list[str] = []
    for e in envs:
        env_missing.extend(json.loads(e.missing_json or "[]"))
    result = QualityEvaluator().evaluate(
        facts, len(evidence_count),
        [{"status": r.status, "execution_enabled": r.execution_enabled} for r in runs],
        [{"verdict": c.verdict} for c in comparisons], env_missing,
    )
    return ok(result, getattr(request.state, "request_id", "-"))


# diagnostics / remediation

@router.post("/reproductions/diagnostics", dependencies=[Depends(require_admin)])
async def create_diagnostic(payload: DiagnosticCreate, request: Request,
                            db: AsyncSession = Depends(get_db)):
    d = await FailureDiagnoser(db).diagnose(
        payload.run_id, payload.project_id, payload.problem)
    return ok({
        "diagnostic_id": d.id, "run_id": d.run_id, "project_id": d.project_id,
        "problem": d.problem, "error_evidence": d.error_evidence,
        "possible_causes": json.loads(d.possible_causes_json or "[]"),
        "suggested_fix": d.suggested_fix,
        "verification_method": d.verification_method,
        "needs_human_confirm": d.needs_human_confirm, "ai_available": d.ai_available,
        "prompt_version": d.prompt_version or "",
        "created_at": d.created_at.isoformat() if d.created_at else "",
    }, getattr(request.state, "request_id", "-"))


@router.post("/reproductions/remediations/{proposal_id}/review", dependencies=[Depends(require_admin)])
async def review_remediation(proposal_id: str, payload: ReviewCreate, request: Request,
                             db: AsyncSession = Depends(get_db)):
    r = await FailureDiagnoser(db).review_remediation(
        proposal_id, decision=payload.decision, reviewer=payload.reviewer,
        note=payload.note, modified_value=payload.modified_value)
    return ok({
        "review_id": r.id, "proposal_id": r.proposal_id, "decision": r.decision,
        "reviewer": r.reviewer, "note": r.note, "modified_value": r.modified_value,
        "original_preserved": r.original_preserved,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }, getattr(request.state, "request_id", "-"))


# reports

@router.post("/reproductions/reports", dependencies=[Depends(require_admin)])
async def create_report(payload: ReportCreate, request: Request, db: AsyncSession = Depends(get_db)):
    from app.reproduction.report import ReportGenerator
    report = await ReportGenerator(db).generate(
        payload.project_id, payload.plan_id, payload.run_ids)
    return ok({
        "report_id": report.id, "status": report.status,
        "section_count": len(json.loads(report.sections_json or "[]")),
        "html_available": bool(report.html),
        "pdf_available": bool(report.pdf_path),
    }, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/reports")
async def list_reports(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ReproductionReport).where(ReproductionReport.project_id == project_id)
        .order_by(ReproductionReport.created_at.desc())
    )).scalars().all()
    items = [{
        "report_id": r.id, "project_id": r.project_id, "title": r.title,
        "status": r.status, "version": r.version,
        "section_count": len(json.loads(r.sections_json or "[]")),
        "html_available": bool(r.html), "pdf_available": bool(r.pdf_path),
        "scope_note": r.scope_note,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    } for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/reports/{report_id}")
async def get_report(report_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    r = (await db.execute(
        select(ReproductionReport).where(ReproductionReport.id == report_id)
    )).scalar_one_or_none()
    if r is None:
        raise AppError("NOT_FOUND", "复现报告不存在。")
    return ok({
        "report_id": r.id, "project_id": r.project_id, "title": r.title,
        "status": r.status, "version": r.version,
        "sections": json.loads(r.sections_json or "[]"),
        "html_available": bool(r.html), "pdf_available": bool(r.pdf_path),
        "scope_note": r.scope_note,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    }, getattr(request.state, "request_id", "-"))


@router.get("/reproductions/reports/{report_id}/html")
async def get_report_html(report_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi.responses import HTMLResponse
    r = (await db.execute(
        select(ReproductionReport).where(ReproductionReport.id == report_id)
    )).scalar_one_or_none()
    if r is None or not r.html:
        raise AppError("NOT_FOUND", "报告 HTML 不存在。")
    return HTMLResponse(r.html)


@router.get("/reproductions/reports/{report_id}/pdf")
async def get_report_pdf(report_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi.responses import FileResponse
    r = (await db.execute(
        select(ReproductionReport).where(ReproductionReport.id == report_id)
    )).scalar_one_or_none()
    if r is None:
        raise AppError("NOT_FOUND", "复现报告不存在。")
    if not r.pdf_path:
        raise AppError("PDF_UNAVAILABLE", "当前环境不支持 PDF 导出，请使用 HTML 导出。")
    return FileResponse(r.pdf_path, media_type="application/pdf",
                        filename=f"{r.title[:40]}.pdf")
