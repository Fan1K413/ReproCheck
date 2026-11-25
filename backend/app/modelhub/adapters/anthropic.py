"""Anthropic Claude 原生 Messages API 适配器（官方 api.anthropic.com/v1）。

不使用 OpenAI 兼容层；直接实现 /messages 协议：
- 系统提示词放顶层 system 字段；
- 消息角色只接受 user/assistant；tool 结果转 user 文本块；
- max_tokens 为必填；usage 字段为 input_tokens/output_tokens。
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.errors import InvalidModelFormatError
from app.modelhub.base import ModelAdapter, ModelRequest, ModelResponse, map_http_error, map_transport_error
from app.modelhub.capabilities import Capability


class AnthropicAdapter(ModelAdapter):
    provider_key = "anthropic"
    protocol = "anthropic_messages"
    capabilities = frozenset({
        Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
        Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
        Capability.LONG_CONTEXT,
    })

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }

    @staticmethod
    def _convert(messages: list[dict[str, Any]]) -> tuple[str, list[dict[str, Any]]]:
        system_parts: list[str] = []
        converted: list[dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                system_parts.append(str(content or ""))
                continue
            if role == "tool":
                converted.append({"role": "user", "content": f"[工具结果] {content}"})
                continue
            if role not in ("user", "assistant"):
                role = "user"
            if isinstance(content, list):
                # 多模态块在 Anthropic 中也以 content blocks 表达，原样透传 text/image
                converted.append({"role": role, "content": content})
            else:
                converted.append({"role": role, "content": str(content or "")})
        return "\n".join(system_parts), converted

    def _payload(self, req: ModelRequest) -> dict[str, Any]:
        system, messages = self._convert(req.messages)
        payload: dict[str, Any] = {
            "model": req.model,
            "messages": messages,
            "max_tokens": req.max_tokens or 2048,
            "temperature": req.temperature,
        }
        if system:
            payload["system"] = system
        if req.response_format and req.response_format.get("type") == "json_object":
            # Anthropic 无 response_format 参数，用系统指令约束；网关仍做严格 schema 校验
            payload["system"] = (payload.get("system", "") +
                                 "\n请只输出一个合法 JSON 对象，不要附加解释文字。").strip()
        if req.tools:
            payload["tools"] = req.tools
        for key, value in (req.extra or {}).items():
            if key not in {"model", "messages", "system", "max_tokens", "stream"}:
                payload[key] = value
        return payload

    async def chat(self, req: ModelRequest) -> ModelResponse:
        started = time.perf_counter()
        client = await self._get_client(req.timeout)
        try:
            resp = await client.post(f"{self.base_url}/messages", headers=self._headers(),
                                     json=self._payload(req), timeout=req.timeout)
        except (httpx.TimeoutException, httpx.HTTPError) as exc:
            raise map_transport_error(exc) from exc
        finally:
            await self._release(client)
        if resp.status_code >= 400:
            raise map_http_error(resp.status_code)
        try:
            data = resp.json()
        except Exception as exc:  # noqa: BLE001
            raise InvalidModelFormatError("Claude 响应不是合法 JSON。") from exc
        try:
            blocks = data["content"]
            text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text")
        except (KeyError, TypeError) as exc:
            raise InvalidModelFormatError("Claude 响应缺少 content/text。") from exc
        usage = data.get("usage") or {}
        from app.schemas import TokenUsage
        prompt = int(usage.get("input_tokens") or 0)
        completion = int(usage.get("output_tokens") or 0)
        return ModelResponse(
            content=text,
            model=str(data.get("model") or req.model),
            usage=TokenUsage(prompt_tokens=prompt, completion_tokens=completion,
                             total_tokens=prompt + completion),
            duration_ms=int((time.perf_counter() - started) * 1000),
            request_id=req.request_id,
            provider=self.provider_key,
            raw=data,
        )

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
        except ValueError as exc:
            raise InvalidModelFormatError("Claude 模型列表响应不是合法 JSON。") from exc
        models = data.get("data") if isinstance(data, dict) else data
        if not isinstance(models, list):
            raise InvalidModelFormatError("Claude 响应缺少有效的模型列表。")
        return [{"id": str(m.get("id", "")), "owned_by": "anthropic"}
                for m in models if isinstance(m, dict)]
