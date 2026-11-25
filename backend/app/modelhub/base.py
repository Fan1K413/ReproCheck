"""统一模型适配接口。所有供应商适配器实现同一契约，业务层不感知厂商差异。"""
from __future__ import annotations

import abc
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

from app.core.errors import (
    InvalidKeyError,
    InvalidModelFormatError,
    NetworkError,
    RateLimitError,
    TimeoutError_,
)
from app.core.errors import AppError
from app.modelhub.capabilities import Capability
from app.modelhub.errors import CapabilityUnsupportedError
from app.schemas import TokenUsage


@dataclass
class ModelRequest:
    model: str
    messages: list[dict[str, Any]]
    temperature: float = 0.0
    max_tokens: int | None = None
    response_format: dict[str, Any] | None = None
    tools: list[dict[str, Any]] | None = None
    stream: bool = False
    extra: dict[str, Any] = field(default_factory=dict)
    timeout: float = 60.0
    max_retries: int = 1
    request_id: str = field(default_factory=lambda: f"rc-{uuid.uuid4().hex[:16]}")


@dataclass
class ModelResponse:
    content: str
    model: str
    usage: TokenUsage
    duration_ms: int
    request_id: str
    provider: str
    raw: dict[str, Any] | None = None
    tool_calls: list[dict[str, Any]] | None = None
    finish_reason: str | None = None


@dataclass
class StreamChunk:
    delta: str
    finish_reason: str | None = None
    usage: TokenUsage | None = None


def new_request_id() -> str:
    return f"rc-{uuid.uuid4().hex[:16]}"


def map_http_error(status: int) -> AppError:
    """把 HTTP 状态码映射为规范化业务异常（不含任何响应体/密钥）。"""
    if status in (401, 403):
        return InvalidKeyError()
    if status == 404:
        from app.modelhub.errors import ModelNotFoundError
        return ModelNotFoundError("credential model")
    if status == 429:
        return RateLimitError()
    if status >= 500:
        return AppError("LLM_PROVIDER_ERROR", f"模型服务返回 {status}，请稍后重试。")
    return AppError("LLM_PROVIDER_ERROR", f"模型服务请求被拒绝（{status}）。")


def map_transport_error(exc: Exception) -> AppError:
    if isinstance(exc, httpx.TimeoutException):
        return TimeoutError_()
    if isinstance(exc, httpx.HTTPError):
        return NetworkError()
    return AppError("LLM_PROVIDER_ERROR", "模型调用发生未预期错误。")


def parse_usage(data: dict[str, Any], *, prompt_key: str = "prompt_tokens",
                completion_key: str = "completion_tokens",
                total_key: str = "total_tokens") -> TokenUsage:
    u = data.get("usage") or {}
    def _int(key: str) -> int:
        try:
            return int(u.get(key) or 0)
        except (TypeError, ValueError):
            return 0
    return TokenUsage(prompt_tokens=_int(prompt_key),
                      completion_tokens=_int(completion_key),
                      total_tokens=_int(total_key))


class ModelAdapter(abc.ABC):
    """供应商适配器基类。默认实现的能力方法在不支持时明确抛错。"""

    provider_key: str = "base"
    protocol: str = "openai_compatible"
    capabilities: frozenset[Capability] = frozenset({Capability.TEXT})

    def __init__(self, *, base_url: str, api_key: str,
                 client: httpx.AsyncClient | None = None) -> None:
        self.base_url = (base_url or "").rstrip("/")
        self.api_key = api_key
        self._client = client
        self._owns_client = client is None
        self.pinned_ip: str | None = None

    def supports(self, capability: Capability) -> bool:
        return capability in self.capabilities

    def require(self, capability: Capability) -> None:
        if not self.supports(capability):
            raise CapabilityUnsupportedError(
                self.provider_key, str(capability),
                "该供应商的官方 API 未提供此能力，ReproCheck 不会模拟或伪造该能力。",
            )

    async def _get_client(self, timeout: float) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        if self.pinned_ip:
            return httpx.AsyncClient(
                timeout=httpx.Timeout(timeout), follow_redirects=False, trust_env=False,
                transport=PinnedModelTransport(self.pinned_ip),
            )
        return httpx.AsyncClient(timeout=httpx.Timeout(timeout), follow_redirects=False)

    async def _release(self, client: httpx.AsyncClient) -> None:
        if self._owns_client:
            await client.aclose()

    @abc.abstractmethod
    async def chat(self, req: ModelRequest) -> ModelResponse:
        """普通文本/结构化生成。 schema 校验由网关统一处理。"""

    async def chat_stream(self, req: ModelRequest) -> AsyncIterator[StreamChunk]:
        self.require(Capability.STREAM)
        raise CapabilityUnsupportedError(self.provider_key, "stream", "未实现流式适配器")
        yield  # pragma: no cover - 使函数成为异步生成器

    async def list_models(self) -> list[dict[str, Any]]:
        self.require(Capability.MODEL_LIST)
        raise CapabilityUnsupportedError(self.provider_key, "model_list", "未实现模型列表适配器")

    async def health(self) -> dict[str, Any]:
        self.require(Capability.HEALTH)
        started = time.perf_counter()
        resp = await self.chat(ModelRequest(model="", messages=[{
            "role": "user", "content": "请只回复：OK"}], max_tokens=16))
        return {"status": "ok", "latency_ms": int((time.perf_counter() - started) * 1000),
                "model": resp.model}

    def __repr__(self) -> str:  # 防止密钥被日志打印
        return f"<{type(self).__name__} provider={self.provider_key} key=***>"


class PinnedModelTransport(httpx.AsyncHTTPTransport):
    """连接已经验证的 IP，并保留原域名用于 Host、TLS SNI 和证书验证。"""

    def __init__(self, address: str) -> None:
        super().__init__(trust_env=False)
        self.address = address

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        pinned_request = httpx.Request(
            request.method, request.url.copy_with(host=self.address),
            headers=request.headers, stream=request.stream,
            extensions={**request.extensions, "sni_hostname": request.url.host},
        )
        return await super().handle_async_request(pinned_request)
