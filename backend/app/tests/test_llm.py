"""LLM 适配层测试：用 httpx.MockTransport 模拟真实 OpenAI 兼容协议。

验证：成功调用 / 无 Key / 错误 Key / 限流 / 超时 / 异常 JSON / 修复请求 / 密钥不泄漏。
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.core.errors import (
    AppError,
    InvalidKeyError,
    InvalidModelFormatError,
    NotConfiguredError,
    RateLimitError,
    TimeoutError_,
)
from app.core.config import settings
from app.llm import LLMService
from app.schemas import FactsExtraction


def _resp(content: str, model="qwen-plus", usage=None, status=200):
    return httpx.Response(
        status_code=status,
        json={
            "model": model,
            "choices": [{"message": {"role": "assistant", "content": content}}],
            "usage": usage or {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        },
        request=httpx.Request("POST", "https://mock/v1/chat/completions"),
    )


def make_service(handler, monkeypatch, *, key="sk-test"):
    monkeypatch.setattr(settings, "llm_api_key", key)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return LLMService(client=client)


@pytest.mark.asyncio
async def test_success_and_token_usage(monkeypatch):
    svc = make_service(lambda req: _resp("ReproCheck API 连接成功。"), monkeypatch)
    r = await svc.test_connection()
    assert "连接成功" in r.content
    assert r.usage.total_tokens == 15
    assert r.duration_ms >= 0
    assert r.request_id.startswith("rc-")


@pytest.mark.asyncio
async def test_no_key_fails(monkeypatch):
    svc = make_service(lambda req: _resp("ok"), monkeypatch, key="")
    with pytest.raises(NotConfiguredError):
        await svc.test_connection()


@pytest.mark.asyncio
async def test_invalid_key_401(monkeypatch):
    svc = make_service(lambda req: httpx.Response(401, json={"error": "bad"},
                       request=httpx.Request("POST", "https://mock")), monkeypatch)
    with pytest.raises(InvalidKeyError):
        await svc.test_connection()


@pytest.mark.asyncio
async def test_rate_limit_429(monkeypatch):
    svc = make_service(lambda req: httpx.Response(429, json={"error": "rate"},
                       request=httpx.Request("POST", "https://mock")), monkeypatch)
    with pytest.raises(RateLimitError):
        await svc.test_connection()


@pytest.mark.asyncio
async def test_timeout(monkeypatch):
    def raise_timeout(req):
        raise httpx.TimeoutException("timeout")
    svc = make_service(raise_timeout, monkeypatch)
    with pytest.raises(TimeoutError_):
        await svc.test_connection()


@pytest.mark.asyncio
async def test_invalid_json_repaired(monkeypatch):
    valid = json.dumps({"facts": [
        {"field_key": "batch_size", "raw_value": "64", "normalized_value": 64,
         "unit": None, "evidence_chunk_id": "paper_chunk_001", "confidence": 0.9}
    ]}, ensure_ascii=False)
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return _resp("这不是 JSON")
        return _resp(valid)

    svc = make_service(handler, monkeypatch)
    r = await svc.chat(
        [{"role": "user", "content": "抽取"}], response_schema=FactsExtraction
    )
    assert calls["n"] == 2  # 首请求 + 一次修复
    assert r.parsed.facts[0].field_key == "batch_size"


@pytest.mark.asyncio
async def test_invalid_json_still_fails_after_repair(monkeypatch):
    svc = make_service(lambda req: _resp("始终不是 JSON"), monkeypatch)
    with pytest.raises(InvalidModelFormatError):
        await svc.chat([{"role": "user", "content": "抽取"}],
                       response_schema=FactsExtraction)


@pytest.mark.asyncio
async def test_secret_never_in_error_or_response(monkeypatch):
    secret = "sk-SUPER-SECRET-123456"
    svc = make_service(lambda req: httpx.Response(401, json={"error": "bad"},
                       request=httpx.Request("POST", "https://mock")), monkeypatch, key=secret)
    with pytest.raises(InvalidKeyError) as ei:
        await svc.test_connection()
    assert secret not in str(ei.value)
    assert secret not in str(ei.value.message)
