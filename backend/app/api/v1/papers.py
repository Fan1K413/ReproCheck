"""以论文为单位的入口：上传、阅读、核对材料和查看当前报告。"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field, SecretStr, StrictBool
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import check_project_permission, get_current_user, resolve_project_access
from app.api.v1.modelhub import (
    CredentialTestIn,
    GuidedModelSetupIn,
    create_guided_model_setup,
    test_draft_credential,
)
from app.api.v1.projects import _visible_project_ids, stage_project
from app.core.config import settings
from app.core.errors import AppError, ok
from app.db import get_db
from app.modelhub.gateway import model_gateway
from app.modelhub.registry import PROVIDERS, get_provider
from app.models import AIRun, Material, Project
from app.models.stage6 import User
from app.parsers.limits import MAX_SINGLE_FILE_BYTES
from app.schemas import ProjectCreate
from app.schemas.parsing import ParseResult
from app.services.extraction_service import ExtractionService
from app.services.governance_service import ensure_ai_consent
from app.services.material_service import MaterialService
from app.services.paper_service import (
    key_points,
    latest_key_points_run,
    material_view,
    paper_chunks,
    paper_report,
    parse_paper,
    reading_view,
    supporting_materials,
)
from app.services.task_service import DEFAULT_TIMEOUT_SECONDS, parsed_chunks, update_parse_metadata

router = APIRouter(tags=["论文工作台"])
ASSISTANT_PATH = "/api/v1/reading-assistant"


class KeyPointsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allow_send_to_provider: StrictBool


class ReadingAssistantIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: str = Field(min_length=1, max_length=40)
    api_key: SecretStr = Field(min_length=1, max_length=4096)


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


def _paper_view(paper: Material, project: Project) -> dict:
    base = f"/api/v1/papers/{paper.id}"
    return {
        "id": paper.id,
        "title": project.paper_title or Path(paper.source_name).stem,
        "filename": paper.source_name,
        "links": {
            "reading": base,
            "original": f"/api/v1/materials/{paper.id}/download" if paper.stored_path else None,
            "materials": f"{base}/materials",
            "report": f"{base}/report",
            "key_points": f"{base}/key-points",
        },
    }


async def _get_paper(db: AsyncSession, paper_id: str, user: User) -> tuple[Material, Project]:
    paper = await db.get(Material, paper_id)
    if paper is None or paper.material_type != "pdf":
        raise AppError("NOT_FOUND", "论文不存在或无权访问。")
    project = await resolve_project_access(db, paper.project_id, user)
    return paper, project


async def _read_upload(file: UploadFile) -> tuple[str, bytes]:
    data = await file.read(MAX_SINGLE_FILE_BYTES + 1)
    if len(data) > MAX_SINGLE_FILE_BYTES:
        raise AppError("VALIDATION_ERROR", "单个文件最多 20 MiB。", status_code=413)
    if not data:
        raise AppError("VALIDATION_ERROR", "文件内容为空，请重新选择文件。")
    return file.filename or "", data


@router.get("/papers")
async def list_papers(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """列出当前账号可访问的论文。"""
    ids = await _visible_project_ids(db, user)
    query = select(Material, Project).join(Project, Project.id == Material.project_id).where(
        Material.material_type == "pdf",
    )
    if ids is not None:
        query = query.where(Material.project_id.in_(ids))
    rows = (await db.execute(query.order_by(Material.created_at.desc(), Material.id))).all()
    return ok({"items": [_paper_view(paper, project) for paper, project in rows]}, _rid(request))


@router.post("/papers", status_code=201)
async def upload_paper(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """上传一份 PDF，建立个人论文记录并返回阅读入口。"""
    filename, data = await _read_upload(file)
    if not filename.lower().endswith(".pdf") or b"%PDF-" not in data[:1024]:
        raise AppError("VALIDATION_ERROR", "请选择 PDF 格式的论文。")
    # 同一账号重新提交同一份 PDF 时沿用论文记录。数据库主键也保护并发重试。
    digest = hashlib.sha256(data).hexdigest()
    project_id = "proj-" + hashlib.sha256(f"{user.id}:{digest}".encode()).hexdigest()[:30]
    owner_id = user.id
    existing = select(Material, Project).join(Project, Project.id == Material.project_id).where(
        Project.id == project_id, Project.owner_user_id == owner_id,
        Material.material_type == "pdf", Material.sha256 == digest,
    )
    row = (await db.execute(existing)).first()
    if row:
        response.status_code = 200
        return ok(_upload_view(*row), _rid(request))

    title = Path(filename.replace("\\", "/")).stem.strip()[:200] or "未命名论文"
    stored = None
    try:
        project = await stage_project(
            db, ProjectCreate(name=title, paper_title=title), user, _rid(request),
            inherit_org=False, project_id=project_id,
        )
        paper = await MaterialService(db).upload(project.id, filename, data, commit=False)
        stored = Path(paper.stored_path)
        parsed = await parse_paper(db, paper)
        if not parsed.chunks and not parsed.needs_ocr:
            message = {
                "PDF_PASSWORD_REQUIRED": "请上传解除密码保护后的 PDF。",
                "PDF_TOO_MANY_PAGES": "该 PDF 超过可处理的页数，请上传 300 页以内的副本。",
            }.get(parsed.error_code, "无法打开这份 PDF，请重新上传副本。")
            raise AppError("VALIDATION_ERROR", message)
        update_parse_metadata(paper, parsed)
        db.add_all(parsed_chunks(paper, parsed))
        await db.commit()
    except BaseException as error:
        await db.rollback()
        if stored is not None:
            stored.unlink(missing_ok=True)
        if isinstance(error, IntegrityError):
            row = (await db.execute(existing)).first()
            if row:
                response.status_code = 200
                return ok(_upload_view(*row), _rid(request))
        raise
    return ok(_upload_view(paper, project), _rid(request))


def _upload_view(paper: Material, project: Project) -> dict:
    view = _paper_view(paper, project)
    return {
        **view,
        "reading_status": "original_only" if paper.needs_ocr else "ready",
        "next_action": {"label": "阅读论文", "href": view["links"]["reading"]},
    }


@router.get("/papers/{paper_id}")
async def read_paper(
    paper_id: str, request: Request,
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """按阅读器页码返回原文、识别出的章节和已有的带引文要点。"""
    paper, project = await _get_paper(db, paper_id, user)
    chunks, parsed = await paper_chunks(db, paper)
    view = _paper_view(paper, project)
    reading = reading_view(paper, chunks, parsed, page)
    return ok({
        **view, "reading": reading,
        "key_points": await key_points(db, paper),
        "next_action": {"label": "核对材料", "href": view["links"]["materials"]},
        "reading_assistant": {
            "settings": ASSISTANT_PATH,
            "message": "可选。使用 AI 整理要点时，会将提取到的部分论文文字发送给模型供应商。",
        },
    }, _rid(request))


@router.get("/papers/{paper_id}/materials")
async def list_paper_materials(
    paper_id: str, request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """查看论文的补充材料。结果文件可参加数值核对。"""
    paper, project = await _get_paper(db, paper_id, user)
    materials = await supporting_materials(db, paper)
    view = _paper_view(paper, project)
    return ok({
        "items": [material_view(material) for material in materials],
        "upload_hint": "可以上传 CSV、JSON 或 TXT 结果文件，也可以直接查看当前报告。",
        "next_action": {"label": "查看审计报告", "href": view["links"]["report"]},
    }, _rid(request))


@router.post("/papers/{paper_id}/materials", status_code=201)
async def upload_paper_material(
    paper_id: str, request: Request,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """向现有论文记录补充一个文件。"""
    paper, project = await _get_paper(db, paper_id, user)
    await check_project_permission(db, user, paper.project_id, "material.upload")
    filename, data = await _read_upload(file)
    if filename.lower().endswith(".pdf"):
        raise AppError("VALIDATION_ERROR", "请从论文列表上传另一篇 PDF。")
    # 同一项目的上传在读取材料数量及哈希前排队，SQLite 也会锁定该写事务。
    await db.execute(
        update(Project).where(Project.id == project.id).values(updated_at=Project.updated_at)
    )
    material = await MaterialService(db).upload(paper.project_id, filename, data)
    return ok({
        **material_view(material),
        "next_action": {"label": "查看审计报告", "href": _paper_view(paper, project)["links"]["report"]},
    }, _rid(request))


@router.get("/papers/{paper_id}/report")
async def read_paper_report(
    paper_id: str, request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """用当前文件生成可复核的文本和数值报告，无需模型。"""
    paper, project = await _get_paper(db, paper_id, user)
    view = _paper_view(paper, project)
    return ok({
        "paper": view, **await paper_report(db, paper),
        "materials_href": view["links"]["materials"],
    }, _rid(request))


@router.post("/papers/{paper_id}/key-points")
async def extract_key_points(
    paper_id: str, payload: KeyPointsIn, request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """按需整理带逐字引文的要点，须明确同意向所用模型服务发送论文文字。"""
    paper, project = await _get_paper(db, paper_id, user)
    await check_project_permission(db, user, paper.project_id, "audit.run")
    if await latest_key_points_run(db, paper) is None:
        if not payload.allow_send_to_provider:
            raise AppError("VALIDATION_ERROR", "请先确认是否同意向模型供应商发送论文文字。")
        chunks, parsed = await paper_chunks(db, paper)
        if not chunks:
            raise AppError("VALIDATION_ERROR", "这份论文没有可提取的正文，可以下载 PDF 阅读。")
        if not await model_gateway.is_configured(db, "pdf_extraction", paper.project_id):
            raise AppError("LLM_KEY_NOT_CONFIGURED", "连接阅读助手后即可整理要点。", {
                "settings": ASSISTANT_PATH,
            })
        await ensure_ai_consent(db, project.id, project.org_id)
        # 在 AI 运行记录提交前锁定论文，避免重复请求发起两次外部调用。
        await db.execute(update(Material).where(Material.id == paper.id).values(
            parse_status=Material.parse_status,
        ))
        if await latest_key_points_run(db, paper) is None:
            cutoff = datetime.now(timezone.utc) - timedelta(seconds=DEFAULT_TIMEOUT_SECONDS)
            running = await db.scalar(select(AIRun.id).where(
                AIRun.project_id == paper.project_id, AIRun.material_id == paper.id,
                AIRun.run_type == "material_extraction", AIRun.status == "running",
                AIRun.created_at >= cutoff,
            ).limit(1))
            if running:
                raise AppError("CONFLICT", "正在整理这篇论文的要点，请稍后查看。")
            if parsed is None:
                # 抽取服务直接从数据库读取此次引用的真实原文。
                parsed = ParseResult(
                    material_id=paper.id, material_type="pdf",
                    parser_version=paper.parser_version or "", status="completed",
                )
            else:
                update_parse_metadata(paper, parsed)
                db.add_all(chunks)
                await db.flush()
            await ExtractionService(db).extract(
                material=paper, parse_result=parsed, project_id=paper.project_id, task_id="",
            )
    points = await key_points(db, paper)
    return ok({
        "items": points,
        "message": None if points else "暂无找到带原文引文的要点，可以继续阅读论文本身。",
    }, _rid(request))


@router.get("/reading-assistant")
async def reading_assistant(
    request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """给出可选阅读助手的配置状态和供应商选项。"""
    default = await model_gateway.resolve_default_profile(db, user.id)
    return ok({
        "configured": default is not None or settings.is_llm_configured,
        "providers": [
            {"id": spec.key, "name": spec.name}
            for spec in PROVIDERS if not spec.requires_custom_url and spec.default_models
        ],
        "optional": True,
    }, _rid(request))


@router.post("/reading-assistant")
async def connect_reading_assistant(
    payload: ReadingAssistantIn, request: Request,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """选择供应商并填写密钥；后端代选默认模型，连接测试成功后保存配置。"""
    spec = get_provider(payload.provider)
    if spec is None or spec.requires_custom_url or not spec.default_models:
        raise AppError("VALIDATION_ERROR", "请选择列表中的模型供应商。")
    if await model_gateway.resolve_default_profile(db, user.id) is not None:
        raise AppError("CONFLICT", "阅读助手已配置。请在模型设置中管理现有连接。")
    key = payload.api_key.get_secret_value().strip()
    model = spec.default_models[0]
    test = await test_draft_credential(
        CredentialTestIn(provider_key=spec.key, api_key=key, model_id=model), user=user,
    )
    if test["status"] != "success":
        message = (
            "供应商未接受这把密钥，请检查后重试。"
            if test["status"] == "auth_failed" else "暂时无法连接供应商，请稍后重试。"
        )
        raise AppError("LLM_PROVIDER_ERROR", message)
    # 测试连接期间可能有并发配置。写入前重新检查已有默认设置。
    await db.execute(update(User).where(User.id == user.id).values(is_active=User.is_active))
    if await model_gateway.resolve_default_profile(db, user.id) is not None:
        raise AppError("CONFLICT", "阅读助手已配置。请在模型设置中管理现有连接。")
    await create_guided_model_setup(
        GuidedModelSetupIn(provider_key=spec.key, api_key=key, model_id=model),
        user=user, db=db,
    )
    return ok({"configured": True, "provider": spec.name}, _rid(request))
