"""FastAPI 应用入口。"""
from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import api_router
from app.api.open_v1 import open_router
from app.core.config import settings
from app.core.errors import AppError, app_error_handler, fail
from app.core.logging import configure_logging, logger
from app.db import init_db
from app.modelhub.context import set_current, reset_current

configure_logging()

app = FastAPI(
    title="ReproCheck API",
    description="科研复现审计官 - 第一阶段核心 API",
    version="1.0.0-stage1",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,  # 开发期默认放行；生产在配置中收敛为前端域名
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_exception_handler(AppError, app_error_handler)  # type: ignore[arg-type]


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    rid = getattr(request.state, "request_id", "-")
    return JSONResponse(
        status_code=422,
        content=fail("VALIDATION_ERROR", "请求参数校验失败。", rid,
                     details=[{"loc": list(e.get("loc", [])), "msg": e.get("msg", "")}
                              for e in exc.errors()[:10]]),
    )


@app.exception_handler(Exception)
async def generic_error_handler(request: Request, exc: Exception):
    rid = getattr(request.state, "request_id", "-")
    logger.error("unhandled_error request_id=%s type=%s", rid, type(exc).__name__)
    return JSONResponse(
        status_code=500,
        content=fail("INTERNAL_ERROR", "服务器内部错误。", rid),
    )


@app.middleware("http")
async def request_context(request: Request, call_next):
    request.state.request_id = f"req-{uuid.uuid4().hex[:12]}"
    # 请求体大小限制
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > settings.max_request_bytes:
        return JSONResponse(
            status_code=413,
            content=fail("VALIDATION_ERROR", "请求体过大。", request.state.request_id),
        )
    # 第十一阶段：把当前用户注入模型网关上下文（仅用于凭据归属解析；鉴权仍在路由层）。
    tokens = [set_current(None, None)]
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        try:
            from app.core.security import decode_access_token
            claims = decode_access_token(auth.split(" ", 1)[1].strip())
            uid = claims.get("sub")
            if isinstance(uid, str):
                tokens.append(set_current(uid, claims.get("org_id")))
        except Exception:  # noqa: BLE001 - 无效令牌由路由层返回 401
            pass
    try:
        return await call_next(request)
    finally:
        for token in reversed(tokens):
            reset_current(token)


@app.on_event("startup")
async def on_startup() -> None:
    await init_db()
    logger.info("reprocheck_started llm_configured=%s", settings.is_llm_configured)
    # 生产安全自检：只告警不强制失败，避免破坏本地开发/测试；部署方须按清单收敛配置。
    # 设置 STRICT_PRODUCTION=1 时可让不安全配置直接阻止启动。
    import os
    issues = settings.strict_production_check()
    if issues:
        logger.warning("production_security_check issues=%s", " | ".join(issues))
        if os.getenv("STRICT_PRODUCTION", "").strip() in ("1", "true", "True"):
            raise RuntimeError("生产安全配置未通过，拒绝启动：" + " | ".join(issues))


app.include_router(api_router)
app.include_router(open_router)
