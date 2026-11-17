"""AI 模型服务：状态展示与真实连接测试。"""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request

from app.api.deps import require_admin
from app.core.config import settings
from app.core.errors import ok
from app.llm import llm_service, runtime_state
from app.schemas import LLMStatusData, LLMTestData, TokenUsage

router = APIRouter(tags=["llm"])


@router.get("/llm/status")
async def llm_status(request: Request):
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
async def llm_test(request: Request):
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
