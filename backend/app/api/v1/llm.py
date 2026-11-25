"""AI 模型服务：状态展示与真实连接测试。

优先反映当前登录用户在「模型管理中心」配置的默认提供商与模型；
未登录或未配置用户级模型时，回落展示后端环境变量配置。
"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_optional_user, require_admin
from app.core.config import settings
from app.core.errors import AppError, ok
from app.db import get_db
from app.llm import llm_service, runtime_state
from app.modelhub.gateway import model_gateway
from app.models.modelhub import ModelCallLog
from app.models.stage6 import User
from app.schemas import LLMStatusData, LLMTestData, TokenUsage

router = APIRouter(tags=["llm"])


@router.get("/llm/status")
async def llm_status(
    request: Request,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if user is not None:
        default_pair = await model_gateway.resolve_default_profile(db, user.id)
        if default_pair is not None:
            profile, cred = default_pair
            latest_log = (await db.execute(select(ModelCallLog).where(
                ModelCallLog.owner_user_id == user.id,
                ModelCallLog.provider_key == cred.provider_key,
                ModelCallLog.model_id == profile.model_id,
                ModelCallLog.created_at >= cred.updated_at,
            ).order_by(ModelCallLog.created_at.desc()).limit(1))).scalar_one_or_none()

            if latest_log is not None:
                connection_status = "ok" if latest_log.success else "error"
                last_call_at = latest_log.created_at.isoformat() if latest_log.created_at else None
                last_call_duration_ms = latest_log.duration_ms
                last_call_success = latest_log.success
                last_token_usage = TokenUsage(
                    prompt_tokens=latest_log.prompt_tokens,
                    completion_tokens=latest_log.completion_tokens,
                    total_tokens=latest_log.total_tokens,
                )
            elif cred.last_tested_at is not None:
                ok_test = not bool(cred.last_error_code)
                connection_status = "ok" if ok_test else "error"
                last_call_at = cred.last_tested_at.isoformat()
                last_call_duration_ms = None
                last_call_success = ok_test
                last_token_usage = None
            else:
                connection_status = "unknown"
                last_call_at = None
                last_call_duration_ms = None
                last_call_success = None
                last_token_usage = None

            data = LLMStatusData(
                provider=cred.name or cred.provider_key,
                model=profile.model_id,
                api_key_configured=bool(cred.key_ciphertext),
                connection_status=connection_status,
                last_call_at=last_call_at,
                last_call_duration_ms=last_call_duration_ms,
                last_call_success=last_call_success,
                last_token_usage=last_token_usage,
            )
            return ok(data, getattr(request.state, "request_id", "-"))

    data = LLMStatusData(
        provider=settings.llm_provider,
        model=settings.llm_model,
        api_key_configured=settings.is_llm_configured,
        connection_status=runtime_state.connection_status,
        last_call_at=runtime_state.last_call_at,
        last_call_duration_ms=runtime_state.last_call_duration_ms,
        last_call_success=runtime_state.last_call_success,
        last_token_usage=runtime_state.last_token_usage,
    )
    return ok(data, getattr(request.state, "request_id", "-"))


@router.post("/llm/test", dependencies=[Depends(require_admin)])
async def llm_test(
    request: Request,
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    if user is not None:
        default_pair = await model_gateway.resolve_default_profile(db, user.id)
        if default_pair is not None:
            profile, cred = default_pair
            now = datetime.now(timezone.utc)
            try:
                resp = await model_gateway.test_default_model(db, profile, cred)
                cred.last_tested_at = now
                cred.last_error_code = None
                await db.commit()
            except AppError as exc:
                cred.last_tested_at = now
                cred.last_error_code = exc.code
                await db.commit()
                raise

            data = LLMTestData(
                success=True,
                reply=resp.content.strip(),
                model=resp.model,
                duration_ms=resp.duration_ms,
                token_usage=TokenUsage(
                    prompt_tokens=resp.usage.prompt_tokens,
                    completion_tokens=resp.usage.completion_tokens,
                    total_tokens=resp.usage.total_tokens,
                ),
                tested_at=now.isoformat(),
            )
            return ok(data, getattr(request.state, "request_id", "-"))

    resp = await llm_service.test_connection()
    data = LLMTestData(
        success=True,
        reply=resp.content.strip(),
        model=resp.model,
        duration_ms=resp.duration_ms,
        token_usage=TokenUsage(
            prompt_tokens=resp.usage.prompt_tokens,
            completion_tokens=resp.usage.completion_tokens,
            total_tokens=resp.usage.total_tokens,
        ),
        tested_at=datetime.now(timezone.utc).isoformat(),
    )
    return ok(data, getattr(request.state, "request_id", "-"))
