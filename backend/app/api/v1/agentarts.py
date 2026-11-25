"""Project audit endpoints and scoped, expiring tools for AgentArts."""
from __future__ import annotations

import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.api.isolation import require_project_write
from app.core.config import settings
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import Project
from app.models.agentarts import PaperAuditCheck, PaperAuditRun
from app.models.stage6 import User
from app.services import agentarts_runtime
from app.services.governance_service import ensure_ai_consent
from app.services.paper_audit import (
    FIELDS, RULE_VERSION, AuditIn, CheckKind, ClaimIn, snapshot_materials, verify_claim,
)

router = APIRouter(tags=["agentarts-paper-audit"])
tools_router = APIRouter(tags=["agentarts-tools"])
MAX_CLAIMS = 24


class ToolIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_id: str = Field(min_length=32, max_length=32)
    tool_token: str = Field(min_length=64, max_length=64)


class VerifyIn(ToolIn):
    claim: ClaimIn


class FinishIn(ToolIn):
    check_ids: list[Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]] = Field(max_length=MAX_CLAIMS)


def _view(run: PaperAuditRun, *, include_result: bool = True) -> dict:
    status = run.status
    result = run.result if status in ("completed", "failed") else None
    if status == "running" and _expired(run):
        status = "failed"
        result = {"error": "此审计已超时或被中断，请重新发起。"}
    return {
        "id": run.id, "parent_id": run.parent_id, "status": status,
        "provider": "AgentArts", "workflow_version": run.workflow_version,
        "rule_version": run.rule_version, "created_at": run.created_at,
        "materials": _material_metadata(run.snapshot),
        "result": result if include_result else None,
    }


def _expired(run: PaperAuditRun) -> bool:
    return run.deadline.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)


def _material_metadata(snapshot: dict) -> dict:
    return {role: {key: item[key] for key in ("id", "name", "sha256")}
            for role, item in snapshot.items() if role != "review"}


def _token(run_id: str) -> str:
    return hmac.new(settings.agentarts_tool_secret.encode(), run_id.encode(), hashlib.sha256).hexdigest()


async def _load_run(db: AsyncSession, project_id: str, run_id: str) -> PaperAuditRun:
    run = await db.get(PaperAuditRun, run_id)
    if run is None or run.project_id != project_id:
        raise AppError("NOT_FOUND", "审计记录不存在或无权访问。", status_code=404)
    return run


async def _tool_run(db: AsyncSession, payload: ToolIn, *, lock: bool = False) -> PaperAuditRun:
    secret = settings.agentarts_tool_secret
    if len(secret) < 32 or not payload.tool_token.isascii() or not hmac.compare_digest(
        payload.tool_token, _token(payload.run_id)
    ):
        raise AppError("UNAUTHORIZED", "无效的审计工具凭证。", status_code=401)
    if lock:
        # Serialize check insertion and finish for this run on SQLite and PostgreSQL.
        await db.execute(update(PaperAuditRun).where(PaperAuditRun.id == payload.run_id)
                         .values(status=PaperAuditRun.status))
    run = await db.get(PaperAuditRun, payload.run_id)
    if run is None or run.status != "running" or _expired(run):
        raise AppError("NOT_FOUND", "当前审计工具会话已结束。", status_code=404)
    return run


async def _checks(db: AsyncSession, run_id: str) -> dict:
    rows = await db.scalars(select(PaperAuditCheck).where(PaperAuditCheck.run_id == run_id))
    return {row.id: row.finding for row in rows}


@router.get("/projects/{project_id}/paper-audits")
async def history(project_id: str, request: Request, db: AsyncSession = Depends(get_db),
                  _user: User = Depends(get_current_user)):
    rows = await db.scalars(select(PaperAuditRun).where(PaperAuditRun.project_id == project_id)
                            .order_by(PaperAuditRun.created_at.desc(), PaperAuditRun.id).limit(20))
    return ok({"configured": agentarts_runtime.configured(), "items": [_view(row, include_result=False) for row in rows]},
              request.state.request_id)


@router.get("/projects/{project_id}/paper-audits/{run_id}")
async def detail(project_id: str, run_id: str, request: Request, db: AsyncSession = Depends(get_db),
                 _user: User = Depends(get_current_user)):
    return ok(_view(await _load_run(db, project_id, run_id)), request.state.request_id)


@router.post("/projects/{project_id}/paper-audits",
             dependencies=[Depends(require_project_write("audit.run"))])
async def start(project_id: str, payload: AuditIn, request: Request, db: AsyncSession = Depends(get_db),
                _user: User = Depends(get_current_user)):
    if not agentarts_runtime.configured():
        raise AppError("AGENTARTS_NOT_CONFIGURED", "服务端尚未配置已发布的 AgentArts 工作流。", status_code=503)
    project = await db.get(Project, project_id)
    if project is None:
        raise AppError("NOT_FOUND", "项目不存在或无权访问。", status_code=404)
    await ensure_ai_consent(db, project_id, project.org_id)
    parent = await _load_run(db, project_id, payload.parent_id) if payload.parent_id else None
    snapshot = await snapshot_materials(db, project_id, payload)
    if parent:
        if parent.status != "completed" or not parent.result or parent.rule_version != RULE_VERSION:
            raise AppError("AUDIT_REVIEW_UNAVAILABLE", "仅支持复审使用当前规则的已完成审计。", status_code=409)
        if parent.snapshot["paper"]["sha256"] != snapshot["paper"]["sha256"]:
            raise AppError("AUDIT_PAPER_CHANGED", "论文已变更，请发起新的完整审计。", status_code=409)
        previous = parent.result["findings"]
        changed = {kind for kind in FIELDS.values() if
                   parent.snapshot.get(kind, {}).get("id") != snapshot.get(kind, {}).get("id") or
                   parent.snapshot.get(kind, {}).get("sha256") != snapshot.get(kind, {}).get("sha256")}
        review = [finding for finding in previous if finding["check"] in changed]
        if not review:
            raise AppError("AUDIT_NO_CHANGES", "所选材料未影响任何已记录的主张。", status_code=409)
        snapshot["review"] = {"checks": {item["id"]: item["claim"] for item in review},
                              "unchanged": [item for item in previous if item["check"] not in changed]}

    run = PaperAuditRun(
        id=uuid4().hex, project_id=project_id, parent_id=payload.parent_id, status="running",
        workflow_version=settings.agentarts_workflow_version, rule_version=RULE_VERSION, snapshot=snapshot,
        deadline=datetime.now(timezone.utc) + timedelta(seconds=settings.agentarts_timeout + 5),
    )
    db.add(run)
    await db.commit()
    try:
        steps = await agentarts_runtime.invoke(run.id, _token(run.id))
        await db.refresh(run)
        checked = await _checks(db, run.id)
        finalized = run.result
        if finalized is None or set(finalized["check_ids"]) != set(checked):
            raise AppError("AGENTARTS_RESULTS_MISSING", "工作流未提交完整的工具核验结果。", status_code=502)
        findings = list(checked.values()) + snapshot.get("review", {}).get("unchanged", [])
        findings.sort(key=lambda item: (item["claim"]["field"], item["id"]))
        run.result = {"findings": findings, "workflow_steps": steps, "checked_count": len(checked),
                      "limited": snapshot["paper"]["limited"]}
        run.status = "completed"
    except AppError as exc:
        run.result = {"error": exc.message, "error_code": exc.code}
        run.status = "failed"
    run.snapshot = _material_metadata(snapshot)
    await db.commit()
    return ok(_view(run), request.state.request_id)


@tools_router.post("/agentarts/tools/context")
async def context(payload: ToolIn, db: AsyncSession = Depends(get_db)):
    run = await _tool_run(db, payload)
    review = run.snapshot.get("review")
    return {
        "mode": "review" if review else "initial",
        "chunks": [] if review else [
            {"chunk_id": chunk["chunk_id"], "text": chunk["text"]}
            for chunk in run.snapshot["paper"]["chunks"]
        ],
        "review_claims": list(review["checks"].values()) if review else [],
    }


@tools_router.post("/agentarts/tools/verify/{kind}")
async def verify(kind: CheckKind, payload: VerifyIn, db: AsyncSession = Depends(get_db)):
    run = await _tool_run(db, payload, lock=True)
    finding = verify_claim(run.snapshot, kind, payload.claim)
    if "review" in run.snapshot and finding["id"] not in run.snapshot["review"]["checks"]:
        raise AppError("AUDIT_REVIEW_OUT_OF_SCOPE", "只能复核受材料变更影响的原有主张。", status_code=422)
    previous = await db.get(PaperAuditCheck, (run.id, finding["id"]))
    if previous is None:
        if run.result is not None or len(await _checks(db, run.id)) >= MAX_CLAIMS:
            raise AppError("AUDIT_CHECK_LIMIT", "本轮核验工具已结束或达到主张上限。", status_code=409)
        db.add(PaperAuditCheck(run_id=run.id, id=finding["id"], finding=finding))
    await db.commit()
    return {"check_id": finding["id"], "status": finding["status"], "note": finding["note"]}


@tools_router.post("/agentarts/tools/finish")
async def finish(payload: FinishIn, db: AsyncSession = Depends(get_db)):
    run = await _tool_run(db, payload, lock=True)
    checked = await _checks(db, run.id)
    supplied = set(payload.check_ids)
    if len(supplied) != len(payload.check_ids) or supplied != set(checked) or (
        "review" in run.snapshot and supplied != set(run.snapshot["review"]["checks"])
    ):
        raise AppError("AUDIT_INCOMPLETE_CHECKS", "运行回执与本轮应核验或已核验的主张不一致。", status_code=422)
    run.result = {"check_ids": sorted(supplied)}
    await db.commit()
    return {"accepted": True, "checked_count": len(supplied)}
