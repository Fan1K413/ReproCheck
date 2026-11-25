"""第十一阶段：多模型供应商架构 / API 管理中心 / 安全存储独立测试组。

所有真实供应商调用均用 httpx.MockTransport 在协议层模拟；
本仓库没有真实 API Key，任何测试都不宣称"真实联调通过"。
"""
from __future__ import annotations

import json
import socket
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import BaseModel

from app.core.config import settings
from app.core.errors import AppError, InvalidKeyError, RateLimitError
from app.modelhub.adapters import AnthropicAdapter, GeminiAdapter, OpenAICompatibleAdapter
from app.modelhub.capabilities import Capability
from app.modelhub.context import set_current, reset_current
from app.modelhub.errors import (
    CapabilityUnsupportedError, EncryptionUnavailableError, SSRFBlockedError,
)
from app.modelhub.gateway import model_gateway
from app.modelhub.registry import get_provider, list_providers
from app.modelhub.security import decrypt_credential, encrypt_credential, mask_key, validate_base_url
from app.models.modelhub import ModelCallLog, ModelCredential, ModelProfile, TaskModelBinding


class SimpleAnswer(BaseModel):
    answer: str


def _json_handler(payload: dict[str, Any] | None = None, status: int = 200):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status, json=payload or {
            "model": "mock-model",
            "choices": [{"message": {"content": '{"answer":"ok"}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 11, "completion_tokens": 3, "total_tokens": 14},
        })
    return handler


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _register(client, email: str):
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "password123", "display_name": "模型测试员"})
    assert r.status_code == 200, r.text
    return r.json()["data"]


# 注册表 / 能力矩阵

def test_provider_registry_has_ten_official_providers():
    providers = list_providers()
    assert len(providers) == 10
    keys = {p["key"] for p in providers}
    assert {"qwen", "deepseek", "zhipu", "moonshot", "volcengine", "hunyuan",
            "openai", "anthropic", "gemini", "openai_compatible"} <= keys
    for p in providers:
        assert p["protocol"] in ("openai_compatible", "anthropic_messages", "gemini_generate")
        assert p["real_api_tested"] is False  # 未联调供应商不应标记为已连接
    assert get_provider("qwen").default_base_url == "https://dashscope.aliyuncs.com/compatible-mode/v1"
    assert get_provider("deepseek").default_base_url == "https://api.deepseek.com"
    assert get_provider("anthropic").protocol == "anthropic_messages"
    assert get_provider("gemini").protocol == "gemini_generate"


def test_capability_matrix_rejects_unsupported_with_reason():
    adapter = OpenAICompatibleAdapter(base_url="https://example.com", api_key="sk-test")
    adapter.capabilities = frozenset({Capability.TEXT})  # 模拟不支持流式
    with pytest.raises(CapabilityUnsupportedError) as exc:
        adapter.require(Capability.STREAM)
    assert "不支持" in exc.value.message
    assert exc.value.details["capability"] == "stream"


# 加密 / 脱敏 / SSRF

def test_credential_encryption_masking_and_missing_key(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "model_credential_key", "unit-test-independent-key")
    secret = "sk-abcdefghijklmnop"
    cipher = encrypt_credential(secret)
    assert secret not in cipher
    assert decrypt_credential(cipher) == secret
    hint = mask_key(secret)
    assert hint.startswith("sk-a") and hint.endswith("op") and "bcdef" not in hint
    assert mask_key("short") == "****"

    # 非严格生产模式下未配置环境变量时，自动生成并持久化本地独立密钥
    monkeypatch.setattr(settings, "model_credential_key", "")
    monkeypatch.setattr(settings, "strict_production", False)
    key_file = tmp_path / ".model_credential_key"
    monkeypatch.setattr("app.modelhub.security._LOCAL_CREDENTIAL_KEY_FILE", key_file)
    auto_cipher = encrypt_credential(secret)
    assert key_file.is_file()
    assert decrypt_credential(auto_cipher) == secret

    # 严格生产模式下未配置环境变量仍拒绝加密保存
    monkeypatch.setattr(settings, "strict_production", True)
    with pytest.raises(EncryptionUnavailableError):
        encrypt_credential(secret)


def test_parallel_first_use_keeps_one_credential_key(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "model_credential_key", "")
    monkeypatch.setattr(settings, "strict_production", False)
    monkeypatch.setattr("app.modelhub.security._LOCAL_CREDENTIAL_KEY_FILE", tmp_path / ".model_credential_key")
    first_use = Barrier(2, timeout=5)
    generate = Fernet.generate_key

    def generate_together():
        first_use.wait()
        return generate()

    monkeypatch.setattr(Fernet, "generate_key", staticmethod(generate_together))
    with ThreadPoolExecutor(max_workers=2) as pool:
        encrypted = list(pool.map(encrypt_credential, ["first", "second"]))
    assert [decrypt_credential(value) for value in encrypted] == ["first", "second"]


def test_ssrf_blocks_private_and_invalid_urls_by_default(monkeypatch):
    monkeypatch.setattr(settings, "allow_local_model_endpoint", False)
    for bad in ("file:///etc/passwd", "ftp://example.com/v1", "http://127.0.0.1:8000/v1",
                "http://192.168.1.10:11434/v1",
                "https://user:pass@example.com/v1", "https://example.com/v1?a=1",
                "https://example.com/v1/../admin"):
        with pytest.raises(SSRFBlockedError):
            validate_base_url(bad)

    def fake_resolve(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.5", port))]
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolve)
    for bad in ("https://internal.example.com/v1", "http://example.com/v1",
                "https://metadata.google.internal/v1"):
        with pytest.raises(SSRFBlockedError):
            validate_base_url(bad)


def test_ssrf_accepts_public_https(monkeypatch):
    def fake_resolve(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]
    monkeypatch.setattr(socket, "getaddrinfo", fake_resolve)
    assert validate_base_url("https://api.example.com/v1/") == "https://api.example.com/v1"


def test_ssrf_allows_loopback_only_when_explicitly_enabled():
    assert validate_base_url("http://127.0.0.1:8000/v1/", allow_local=True) == "http://127.0.0.1:8000/v1"


# 适配器协议级测试（MockTransport，非真实联调）

@pytest.mark.asyncio
async def test_openai_compatible_adapter_chat_and_error_mapping():
    client = httpx.AsyncClient(transport=httpx.MockTransport(_json_handler()))
    adapter = OpenAICompatibleAdapter(base_url="https://mock.local/v1", api_key="sk-x", client=client)
    resp = await adapter.chat(__import__("app.modelhub.base", fromlist=["ModelRequest"]).ModelRequest(
        model="mock-model", messages=[{"role": "user", "content": "hi"}]))
    assert resp.content == '{"answer":"ok"}'
    assert resp.usage.total_tokens == 14
    assert resp.model == "mock-model"
    assert "sk-x" not in repr(adapter)

    bad = httpx.AsyncClient(transport=httpx.MockTransport(_json_handler(status=401)))
    with pytest.raises(InvalidKeyError):
        await OpenAICompatibleAdapter(base_url="https://mock.local/v1", api_key="sk-x",
                                      client=bad).chat(
            __import__("app.modelhub.base", fromlist=["ModelRequest"]).ModelRequest(
                model="m", messages=[{"role": "user", "content": "hi"}]))
    limited = httpx.AsyncClient(transport=httpx.MockTransport(_json_handler(status=429)))
    with pytest.raises(RateLimitError):
        await OpenAICompatibleAdapter(base_url="https://mock.local/v1", api_key="sk-x",
                                      client=limited).chat(
            __import__("app.modelhub.base", fromlist=["ModelRequest"]).ModelRequest(
                model="m", messages=[{"role": "user", "content": "hi"}], max_retries=0))


@pytest.mark.asyncio
async def test_openai_compatible_stream_and_model_list():
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/models"):
            return httpx.Response(200, json={"data": [{"id": "m1", "owned_by": "x"}]})
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"你"},"finish_reason":null}]}\n\n'
                                        'data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\n'
                                        'data: [DONE]\n\n')
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    from app.modelhub.base import ModelRequest
    adapter = OpenAICompatibleAdapter(base_url="https://mock.local/v1", api_key="sk-x", client=client)
    chunks = [c.delta async for c in adapter.chat_stream(ModelRequest(
        model="m", messages=[{"role": "user", "content": "hi"}]))]
    assert "".join(chunks) == "你好"
    assert seen["body"]["stream"] is True
    models = await adapter.list_models()
    assert models[0]["id"] == "m1"


@pytest.mark.asyncio
async def test_anthropic_adapter_converts_system_and_roles():
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "model": "claude-mock",
            "content": [{"type": "text", "text": "hello"}],
            "usage": {"input_tokens": 5, "output_tokens": 2},
        })
    from app.modelhub.base import ModelRequest
    adapter = AnthropicAdapter(base_url="https://mock.local/v1", api_key="sk-ant",
                               client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    resp = await adapter.chat(ModelRequest(model="claude-mock", messages=[
        {"role": "system", "content": "规则"},
        {"role": "user", "content": "问题"},
    ], max_tokens=100))
    assert resp.content == "hello"
    assert resp.usage.prompt_tokens == 5 and resp.usage.total_tokens == 7
    assert seen["body"]["system"] == "规则"
    assert seen["body"]["messages"] == [{"role": "user", "content": "问题"}]
    assert seen["headers"]["x-api-key"] == "sk-ant"
    assert seen["headers"]["anthropic-version"] == "2023-06-01"


@pytest.mark.asyncio
async def test_gemini_adapter_converts_roles_and_usage():
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["headers"] = dict(request.headers)
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": "gemini-ok"}]}}],
            "usageMetadata": {"promptTokenCount": 7, "candidatesTokenCount": 4,
                              "totalTokenCount": 11},
            "modelVersion": "gemini-mock",
        })
    from app.modelhub.base import ModelRequest
    adapter = GeminiAdapter(base_url="https://mock.local/v1beta", api_key="gm-key",
                            client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    resp = await adapter.chat(ModelRequest(model="gemini-mock", messages=[
        {"role": "system", "content": "规则"},
        {"role": "user", "content": "问题"},
        {"role": "assistant", "content": "回答"},
    ], response_format={"type": "json_object"}))
    assert resp.content == "gemini-ok"
    assert resp.usage.total_tokens == 11
    assert seen["headers"]["x-goog-api-key"] == "gm-key"
    assert seen["body"]["contents"][0]["role"] == "user"
    assert seen["body"]["contents"][1]["role"] == "model"
    assert seen["body"]["generationConfig"]["responseMimeType"] == "application/json"


# 网关：任务绑定 / 结构化校验 / 备用策略 / 回落

@pytest.mark.asyncio
async def test_gateway_resolves_user_binding_validates_and_logs(session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "model_credential_key", "gw-test-key")
    cred = ModelCredential(id="mc-1", owner_user_id="u1", provider_key="qwen", name="q",
                           key_ciphertext=encrypt_credential("sk-real-secret"),
                           key_hint=mask_key("sk-real-secret"))
    profile = ModelProfile(id="mp-1", owner_user_id="u1", provider_key="qwen",
                           credential_id="mc-1", model_id="mock-model", is_default=True)
    binding = TaskModelBinding(id="mb-1", owner_user_id="u1", task_key="fact_extraction",
                               primary_profile_id="mp-1")
    session_fixture.add_all([cred, profile, binding])
    await session_fixture.commit()

    def build(provider_key, base_url, api_key, client=None):
        assert api_key == "sk-real-secret"
        return OpenAICompatibleAdapter(base_url=base_url, api_key=api_key,
                                       client=httpx.AsyncClient(transport=httpx.MockTransport(
                                           _json_handler({
                                               "model": "mock-model",
                                               "choices": [{"message": {"content": '{"answer":"ok"}'},
                                                            "finish_reason": "stop"}],
                                               "usage": {"prompt_tokens": 10, "completion_tokens": 2,
                                                         "total_tokens": 12},
                                           }))))
    monkeypatch.setattr("app.modelhub.gateway.build_adapter", build)
    tokens = set_current("u1", None)
    try:
        resp = await model_gateway.chat([{"role": "user", "content": "hi"}],
                                        response_schema=SimpleAnswer,
                                        task_key="fact_extraction", db=session_fixture)
    finally:
        reset_current(tokens)
    assert isinstance(resp.parsed, SimpleAnswer)
    assert resp.parsed.answer == "ok"
    log = (await session_fixture.execute(__import__("sqlalchemy").select(ModelCallLog))).scalar_one()
    assert log.success and log.task_key == "fact_extraction"
    assert "sk-real-secret" not in json.dumps({"error_code": log.error_code})


@pytest.mark.asyncio
async def test_gateway_falls_back_only_to_authorized_profile(session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "model_credential_key", "gw-test-key")
    session_fixture.add_all([
        ModelCredential(id="mc-a", owner_user_id="u2", provider_key="qwen",
                        key_ciphertext=encrypt_credential("sk-a"), key_hint="sk-a"),
        ModelCredential(id="mc-b", owner_user_id="u2", provider_key="deepseek",
                        key_ciphertext=encrypt_credential("sk-b"), key_hint="sk-b"),
        ModelProfile(id="mp-a", owner_user_id="u2", provider_key="qwen",
                     credential_id="mc-a", model_id="bad-model"),
        ModelProfile(id="mp-b", owner_user_id="u2", provider_key="deepseek",
                     credential_id="mc-b", model_id="good-model"),
        TaskModelBinding(id="mb-2", owner_user_id="u2", task_key="diff_analysis",
                         primary_profile_id="mp-a", fallback_profile_id="mp-b"),
    ])
    await session_fixture.commit()

    def build(provider_key, base_url, api_key, client=None):
        status = 500 if api_key == "sk-a" else 200
        payload = {"model": "good-model",
                   "choices": [{"message": {"content": "fallback-ok"}, "finish_reason": "stop"}],
                   "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}
        handler = _json_handler(payload, status=status)

        def assert_model(request):
            assert json.loads(request.content)["model"] == ("bad-model" if status == 500 else "good-model")
            return handler(request)

        return OpenAICompatibleAdapter(base_url=base_url, api_key=api_key,
                                       client=httpx.AsyncClient(transport=httpx.MockTransport(
                                           assert_model)))
    monkeypatch.setattr("app.modelhub.gateway.build_adapter", build)
    tokens = set_current("u2", None)
    try:
        resp = await model_gateway.chat([{"role": "user", "content": "hi"}],
                                        task_key="diff_analysis", db=session_fixture)
    finally:
        reset_current(tokens)
    assert resp.content == "fallback-ok"
    log = (await session_fixture.execute(__import__("sqlalchemy").select(ModelCallLog))).scalar_one()
    assert log.success and "LLM_PROVIDER_ERROR" in (log.fallback_reason or "")


@pytest.mark.asyncio
async def test_gateway_without_user_keeps_env_behavior(monkeypatch):
    """无用户上下文时透明回落到既有 LLMService，历史任务零回归。"""
    called = {}
    class FakeLLM:
        async def chat(self, messages, response_schema=None, max_tokens=None):
            called["messages"] = messages
            return __import__("app.llm", fromlist=["LLMResponse"]).LLMResponse(
                content="env-ok", model="env-model",
                usage=__import__("app.schemas", fromlist=["TokenUsage"]).TokenUsage(),
                duration_ms=1, request_id="r", provider="env")
    monkeypatch.setattr("app.modelhub.gateway.llm_service", FakeLLM())
    resp = await model_gateway.chat([{"role": "user", "content": "hi"}])
    assert resp.content == "env-ok" and called["messages"]


# API：脱敏 / 隔离 / 真实连接测试语义

@pytest.mark.asyncio
async def test_api_credentials_are_masked_isolated_and_revocable(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "model_credential_key", "api-test-key")
    a = await _register(client, "model-a@example.com")
    b = await _register(client, "model-b@example.com")
    r = await client.post("/api/v1/model-credentials", headers=_auth(a["token"]), json={
        "provider_key": "qwen", "name": "我的千问", "api_key": "sk-super-secret-1234"})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert "key_ciphertext" not in data and "sk-super-secret-1234" not in r.text
    assert data["key_hint"].startswith("sk-s") and data["has_key"] is True

    r = await client.get("/api/v1/model-credentials", headers=_auth(a["token"]))
    assert r.status_code == 200 and len(r.json()["data"]) == 1
    assert "sk-super-secret-1234" not in r.text
    r = await client.get("/api/v1/model-credentials", headers=_auth(b["token"]))
    assert r.json()["data"] == []

    cid = data["id"]
    r = await client.patch(f"/api/v1/model-credentials/{cid}", headers=_auth(b["token"]),
                           json={"status": "revoked"})
    assert r.status_code == 404  # 严格归属隔离
    r = await client.delete(f"/api/v1/model-credentials/{cid}", headers=_auth(a["token"]))
    assert r.status_code == 200 and r.json()["data"]["revoked"] is True


@pytest.mark.asyncio
async def test_api_connection_test_is_real_and_reports_failure(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "model_credential_key", "api-test-key")
    user = await _register(client, "model-test@example.com")
    r = await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "qwen", "api_key": "sk-anything"})
    cid = r.json()["data"]["id"]

    def build(provider_key, base_url, api_key, client=None):
        return OpenAICompatibleAdapter(base_url=base_url, api_key=api_key,
                                       client=httpx.AsyncClient(transport=httpx.MockTransport(
                                           _json_handler({
                                               "model": "qwen-plus",
                                               "choices": [{"message": {"content": "OK"},
                                                            "finish_reason": "stop"}],
                                               "usage": {"prompt_tokens": 2,
                                                         "completion_tokens": 1,
                                                         "total_tokens": 3},
                                           }))))
    monkeypatch.setattr("app.modelhub.gateway.build_adapter", build)
    r = await client.post(f"/api/v1/model-credentials/{cid}/test", headers=_auth(user["token"]),
                          params={"model_id": "qwen-plus"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "success"
    assert "sk-anything" not in r.text

    def bad_build(provider_key, base_url, api_key, client=None):
        return OpenAICompatibleAdapter(base_url=base_url, api_key=api_key,
                                       client=httpx.AsyncClient(transport=httpx.MockTransport(
                                           _json_handler(status=401))))
    monkeypatch.setattr("app.modelhub.gateway.build_adapter", bad_build)
    r = await client.post(f"/api/v1/model-credentials/{cid}/test", headers=_auth(user["token"]),
                          params={"model_id": "qwen-plus"})
    assert r.json()["data"]["status"] == "auth_failed"
    assert r.json()["data"]["error_code"] == "LLM_INVALID_KEY"


@pytest.mark.asyncio
async def test_api_rejects_custom_ssrf_url_and_requires_key(client, monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "allow_local_model_endpoint", False)
    monkeypatch.setattr(settings, "strict_production", False)
    monkeypatch.setattr(settings, "model_credential_key", "")
    monkeypatch.setattr("app.modelhub.security._LOCAL_CREDENTIAL_KEY_FILE", tmp_path / ".model_credential_key")
    user = await _register(client, "model-ssrf@example.com")
    # 地址验证先于本地密钥初始化。
    r = await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "openai_compatible", "api_key": "sk-local-1234",
        "base_url": "http://127.0.0.1:8000/v1"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "SSRF_BLOCKED"
    assert not (tmp_path / ".model_credential_key").exists()
    r = await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "qwen", "api_key": "sk-local-1234"})
    assert r.status_code == 200, r.text
    # 非法协议与携带账密的 URL 仍拦截
    r = await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "openai_compatible", "api_key": "sk-x",
        "base_url": "https://user:pass@example.com/v1"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "SSRF_BLOCKED"
    r = await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "openai_compatible", "api_key": ""})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_api_stats_and_binding_roundtrip(client, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "model_credential_key", "api-test-key")
    user = await _register(client, "model-bind@example.com")
    cred = (await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "qwen", "api_key": "sk-bind-secret"})).json()["data"]
    prof = (await client.post("/api/v1/model-profiles", headers=_auth(user["token"]), json={
        "provider_key": "qwen", "credential_id": cred["id"], "model_id": "qwen-plus",
        "is_default": True})).json()["data"]
    # 普通创建返回冲突，保留已保存参数。显式更新时保留模型 ID。
    dup = await client.post("/api/v1/model-profiles", headers=_auth(user["token"]), json={
        "provider_key": "qwen", "credential_id": cred["id"], "model_id": "qwen-plus",
        "display_name": "千问 Plus", "max_tokens": 4096, "is_default": True})
    assert dup.status_code == 409, dup.text
    listed = (await client.get("/api/v1/model-profiles", headers=_auth(user["token"]))).json()["data"]
    assert [(p["id"], p["max_tokens"]) for p in listed] == [(prof["id"], None)]
    r = await client.put("/api/v1/task-model-bindings", headers=_auth(user["token"]), json={
        "task_key": "rag_qa", "primary_profile_id": prof["id"], "auto_route": False})
    assert r.status_code == 200 and r.json()["data"]["task_key"] == "rag_qa"
    r = await client.get("/api/v1/task-model-bindings", headers=_auth(user["token"]))
    assert any(b["task_key"] == "rag_qa" for b in r.json()["data"])
    r = await client.get("/api/v1/model-stats", headers=_auth(user["token"]))
    assert r.json()["data"]["total_calls"] == 0
    assert "不编造费用" in r.json()["data"]["cost_note"]
    # 彻底删除提供商时同步清理其关联的模型配置
    del_resp = await client.delete(f"/api/v1/model-credentials/{cred['id']}/purge",
                                   headers=_auth(user["token"]))
    assert del_resp.status_code == 200 and del_resp.json()["data"]["deleted"] is True
    left_profiles = (await client.get("/api/v1/model-profiles", headers=_auth(user["token"]))).json()["data"]
    assert left_profiles == []
    bindings = (await client.get("/api/v1/task-model-bindings", headers=_auth(user["token"]))).json()["data"]
    assert bindings[0]["primary_profile_id"] is None


@pytest.mark.asyncio
async def test_guided_setup_requires_confirmation_to_replace_model(client, monkeypatch):
    monkeypatch.setattr(settings, "model_credential_key", "wizard-test-key")
    user = await _register(client, "model-wizard@example.com")
    headers = _auth(user["token"])
    body = {"provider_key": "qwen", "api_key": "sk-original", "model_id": "qwen-plus"}
    created = await client.post("/api/v1/model-setup", headers=headers, json=body)
    assert created.status_code == 200, created.text
    original = created.json()["data"]["profile"]

    revised = {**body, "api_key": "sk-replacement", "max_tokens": 2048}
    duplicate = await client.post("/api/v1/model-setup", headers=headers, json=revised)
    assert duplicate.status_code == 409, duplicate.text
    current = (await client.get("/api/v1/model-credentials", headers=headers)).json()["data"]
    assert [row["id"] for row in current] == [original["credential_id"]]

    updated = await client.post("/api/v1/model-setup", headers=headers, json={**revised, "replace_existing": True})
    assert updated.status_code == 200, updated.text
    profile = updated.json()["data"]["profile"]
    assert profile["id"] == original["id"] and profile["credential_id"] != original["credential_id"]
    assert profile["max_tokens"] == 2048


@pytest.mark.asyncio
async def test_llm_status_and_test_use_user_default_model(client, monkeypatch):
    """用户配置默认模型后，/api/v1/llm/status 与 /api/v1/llm/test 自动反映并调用该默认模型。"""
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "model_credential_key", "llm-status-key")
    monkeypatch.setattr(settings, "llm_api_key", "")
    user = await _register(client, "llm-default@example.com")

    cred = (await client.post("/api/v1/model-credentials", headers=_auth(user["token"]), json={
        "provider_key": "openai",
        "name": "测试 OpenAI",
        "api_key": "sk-model-test-1234",
    })).json()["data"]
    prof = (await client.post("/api/v1/model-profiles", headers=_auth(user["token"]), json={
        "provider_key": "openai",
        "credential_id": cred["id"],
        "model_id": "gpt-6.2-sol",
    })).json()["data"]
    assert prof["model_id"] == "gpt-6.2-sol"

    before = (await client.get("/api/v1/llm/status", headers=_auth(user["token"]))).json()["data"]
    assert before["api_key_configured"] is False
    selected = await client.patch(f"/api/v1/model-profiles/{prof['id']}", headers=_auth(user["token"]),
                                  json={"is_default": True})
    assert selected.status_code == 200, selected.text

    st = await client.get("/api/v1/llm/status", headers=_auth(user["token"]))
    assert st.status_code == 200, st.text
    st_data = st.json()["data"]
    assert st_data["provider"] == "测试 OpenAI"
    assert st_data["model"] == "gpt-6.2-sol"
    assert st_data["api_key_configured"] is True

    def build(provider_key, base_url, api_key, client=None):
        return OpenAICompatibleAdapter(
            base_url=base_url, api_key=api_key,
            client=httpx.AsyncClient(transport=httpx.MockTransport(_json_handler({
                "model": "gpt-6.2-sol-versioned",
                "choices": [{"message": {"content": "ReproCheck API 连接成功。"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 8, "completion_tokens": 6, "total_tokens": 14},
            }))),
        )
    monkeypatch.setattr("app.modelhub.gateway.build_adapter", build)

    test_resp = await client.post("/api/v1/llm/test", headers=_auth(user["token"]))
    assert test_resp.status_code == 200, test_resp.text
    test_data = test_resp.json()["data"]
    assert test_data["success"] is True
    assert test_data["model"] == "gpt-6.2-sol-versioned"
    assert test_data["token_usage"]["total_tokens"] == 14

    st2 = (await client.get("/api/v1/llm/status", headers=_auth(user["token"]))).json()["data"]
    assert st2["connection_status"] == "ok"
    assert st2["last_call_success"] is True
    assert st2["last_token_usage"]["total_tokens"] == 14
