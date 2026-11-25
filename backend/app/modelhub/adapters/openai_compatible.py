"""OpenAI 兼容 chat/completions 适配器。

覆盖 8 家官方 OpenAI 兼容接口：qwen / deepseek / zhipu / moonshot / volcengine /
hunyuan / openai / openai_compatible（自定义）。不同供应商的差异通过端点与模型名配置，
不写供应商专属 SDK 参数。
"""
from __future__ import annotations

import asyncio
import json
import time
from typing import Any, AsyncIterator

import httpx

from app.core.errors import AppError, InvalidModelFormatError
from app.modelhub.base import (
    ModelAdapter, ModelRequest, ModelResponse, StreamChunk,
    map_http_error, map_transport_error, parse_usage,
)
from app.modelhub.capabilities import Capability


class OpenAICompatibleAdapter(ModelAdapter):
    provider_key = "openai_compatible"
    protocol = "openai_compatible"
    capabilities = frozenset({
        Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
        Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
        Capability.LONG_CONTEXT,
    })

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _payload(self, req: ModelRequest) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": req.model,
            "messages": req.messages,
            "temperature": req.temperature,
        }
        if req.max_tokens is not None:
            payload["max_tokens"] = req.max_tokens
        if req.response_format is not None:
            payload["response_format"] = req.response_format
        if req.tools:
            payload["tools"] = req.tools
        if req.stream:
            payload["stream"] = True
        # 用户自定义参数只允许标量/简单结构，且不得覆盖核心字段
        for key, value in (req.extra or {}).items():
            if key in {"model", "messages", "stream", "response_format", "tools"}:
                continue
            payload[key] = value
        return payload

    async def _post(self, req: ModelRequest, client: httpx.AsyncClient) -> httpx.Response:
        url = f"{self.base_url}/chat/completions"
        payload = self._payload(req)
        headers = self._headers()
        headers["X-Request-Id"] = req.request_id
        last_exc: AppError | None = None
        attempt = 0
        max_attempts = max(0, req.max_retries) + 1
        while attempt < max_attempts:
            attempt += 1
            try:
                resp = await client.post(url, headers=headers, json=payload,
                                         timeout=req.timeout)
            except (httpx.TimeoutException, httpx.HTTPError) as exc:
                last_exc = map_transport_error(exc)
                if attempt >= max_attempts:
                    break
                await asyncio.sleep(0.2 * attempt)
                continue
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < max_attempts:
                await asyncio.sleep(0.3 * attempt)
                continue
            return resp
        assert last_exc is not None
        raise last_exc

    async def chat(self, req: ModelRequest) -> ModelResponse:
        started = time.perf_counter()
        client = await self._get_client(req.timeout)
        try:
            resp = await self._post(req, client)
        finally:
            await self._release(client)
        if resp.status_code >= 400:
            raise map_http_error(resp.status_code)
        try:
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            raise InvalidModelFormatError("模型服务返回的响应不是合法 JSON。") from exc
        try:
            choice = data["choices"][0]
            content = choice["message"].get("content") or ""
            finish = choice.get("finish_reason")
        except (KeyError, IndexError, TypeError) as exc:
            raise InvalidModelFormatError("模型响应缺少 choices/message/content。") from exc
        tool_calls = choice["message"].get("tool_calls")
        return ModelResponse(
            content=content,
            model=str(data.get("model") or req.model),
            usage=parse_usage(data),
            duration_ms=int((time.perf_counter() - started) * 1000),
            request_id=req.request_id,
            provider=self.provider_key,
            raw=data,
            tool_calls=tool_calls,
            finish_reason=finish,
        )

    async def chat_stream(self, req: ModelRequest) -> AsyncIterator[StreamChunk]:
        self.require(Capability.STREAM)
        req.stream = True
        client = await self._get_client(req.timeout)
        try:
            url = f"{self.base_url}/chat/completions"
            async with client.stream("POST", url, headers=self._headers(),
                                     json=self._payload(req), timeout=req.timeout) as resp:
                if resp.status_code >= 400:
                    raise map_http_error(resp.status_code)
                async for line in resp.aiter_lines():
                    line = line.strip()
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk.get("choices") or []
                    if not choices:
                        usage = parse_usage(chunk)
                        if usage.total_tokens:
                            yield StreamChunk(delta="", usage=usage)
                        continue
                    delta = choices[0].get("delta") or {}
                    yield StreamChunk(
                        delta=delta.get("content") or "",
                        finish_reason=choices[0].get("finish_reason"),
                    )
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            raise map_transport_error(exc) from exc
        finally:
            await self._release(client)

    async def list_models(self) -> list[dict[str, Any]]:
        self.require(Capability.MODEL_LIST)
        client = await self._get_client(30.0)
        try:
            resp = await client.get(f"{self.base_url}/models", headers=self._headers(),
                                    timeout=30.0)
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            raise map_transport_error(exc) from exc
        finally:
            await self._release(client)
        if resp.status_code >= 400:
            raise map_http_error(resp.status_code)
        try:
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            raise InvalidModelFormatError("模型列表响应不是合法 JSON。") from exc
        models = data.get("data") if isinstance(data, dict) else data
        if not isinstance(models, list):
            raise InvalidModelFormatError("模型列表响应格式不兼容。")
        return [{"id": str(m.get("id", "")), "owned_by": str(m.get("owned_by", ""))}
                for m in models if isinstance(m, dict)]


def adapter_for(key: str, base_url: str, api_key: str,
                client: httpx.AsyncClient | None = None) -> OpenAICompatibleAdapter:
    """按供应商 key 生成适配器（同一协议，不同能力标签）。"""
    adapter = OpenAICompatibleAdapter(base_url=base_url, api_key=api_key, client=client)
    adapter.provider_key = key
    return adapter
