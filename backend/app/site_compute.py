"""Stateless compute API for the Qoder Site. Run with uvicorn app.site_compute:app."""
from __future__ import annotations

import os
import secrets
from pathlib import Path, PureWindowsPath
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.api.v1.data_audit import DataAuditRunIn
from app.api.v1.stats_audit import router as stats_router
from app.core.errors import AppError, app_error_handler, ok
from app.dataaudit import RULE_CATALOG, run_data_audit
from app.main import RequestBodyLimit, RequestTooLarge, request_too_large_handler
from app.services.verdict_service import summarize_verdict

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(RequestTooLarge, request_too_large_handler)
app.add_middleware(RequestBodyLimit)


def require_site_token(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.environ.get("REPROCHECK_SITE_COMPUTE_TOKEN", "")
    if len(expected) < 32:
        raise AppError("SERVICE_NOT_CONFIGURED", "Site 计算服务未配置。", status_code=503)
    if not authorization or not secrets.compare_digest(
        authorization.encode("utf-8"), f"Bearer {expected}".encode("utf-8"),
    ):
        raise AppError("UNAUTHORIZED", "需要 Site 计算服务凭据。")


app.dependency_overrides[get_current_user] = require_site_token
app.include_router(stats_router, prefix="/api/v1")


class CsvFile(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    text: str = Field(max_length=512 * 1024)


class DataAuditInput(DataAuditRunIn):
    project_id: str = Field(min_length=1, max_length=128)
    files: list[CsvFile] = Field(min_length=1, max_length=10)


@app.post("/api/v1/data-audits/run", dependencies=[Depends(require_site_token)])
def audit_site_data(payload: DataAuditInput):
    if sum(len(f.text.encode("utf-8")) for f in payload.files) > 512 * 1024:
        raise AppError("VALIDATION_ERROR", "Site 数据审计的 CSV 总大小上限为 512 KiB。", status_code=413)
    with TemporaryDirectory(prefix="reprocheck-site-") as work:
        root = Path(work)
        filenames = set()
        for upload in payload.files:
            name = upload.name
            if (
                Path(name).suffix.lower() != ".csv" or any(ch in name for ch in '/\\:*?"<>|')
                or PureWindowsPath(name).is_reserved()
                or any(ord(ch) < 32 for ch in name) or name.casefold() in filenames
            ):
                raise AppError("VALIDATION_ERROR", "请选择文件名不同的 CSV 文件。")
            filenames.add(name.casefold())
            (root / name).write_text(upload.text, encoding="utf-8", newline="")
        report = run_data_audit(
            project_id=payload.project_id, data_roots=[root], code_files=[],
            max_files=payload.max_files, sample_rows=payload.sample_rows, max_rows=payload.max_rows,
        ).to_dict()
        return ok(_public_paths(report, str(root)), "-")


def _public_paths(value: Any, root: str) -> Any:
    if isinstance(value, str):
        return value.replace(root, "site-upload").replace(Path(root).as_posix(), "site-upload")
    if isinstance(value, list):
        return [_public_paths(item, root) for item in value]
    if isinstance(value, dict):
        return {_public_paths(key, root): _public_paths(item, root) for key, item in value.items()}
    return value


@app.get("/api/v1/data-audits/rules", dependencies=[Depends(require_site_token)])
def site_data_audit_rules():
    items = [{
        "rule_id": r.rule_id, "name": r.name, "category": r.category,
        "default_severity": r.default_severity, "description": r.description,
    } for r in RULE_CATALOG.values()]
    return ok({"items": items, "total": len(items)}, "-")


class VerdictInput(BaseModel):
    project_id: str = Field(min_length=1, max_length=128)
    sources: dict[str, list[dict]] = Field(default_factory=dict)


@app.post("/api/v1/verdict-summary", dependencies=[Depends(require_site_token)])
def site_verdict(payload: VerdictInput):
    keys = (
        "materials", "facts", "evidence_items", "findings", "audit_evidences",
        "revisions", "metrics", "comparison_rows", "diagnostics",
    )
    sources = {
        key: [SimpleNamespace(**{
            "sha256": None, "extraction_status": None, "parser_source": None,
            "revision_count": None, "verdict": None, **row,
        }) for row in payload.sources.get(key, [])] for key in keys
    }
    return ok(summarize_verdict(
        payload.project_id, **sources,
        notes=["Site 统计基于项目已保存的记录，项目级 comparison 和公共基准案例未纳入。"],
    ), "-")
