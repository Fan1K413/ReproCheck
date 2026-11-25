"""Google Gemini 原生 generateContent 适配器（generativelanguage.googleapis.com/v1beta）。

原生协议：
- API Key 用 x-goog-api-key 请求头（不放 query，避免进日志/URL）；
- contents 角色仅 user/model；system 提示词放 systemInstruction；
- JSON 输出用 generationConfig.responseMimeType="application/json"；
- usage 从 usageMetadata 读取。
"""
from __future__ import annotations

import time
from typing import Any

import httpx

from app.core.errors import InvalidModelFormatError, InvalidKeyError
from app.modelhub.base import ModelAdapter, ModelRequest, ModelResponse, map_http_error, map_transport_error
from app.modelhub.capabilities import Capability


class GeminiAdapter(ModelAdapter):
    provider_key = "gemini"
    protocol = "gemini_generate"
    capabilities = frozenset({
        Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
        Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
        Capability.MULTIMODAL, Capability.LONG_CONTEXT,
    })

    def _headers(self) -> dict[str, str]:
        return {"x-goog-api-key": self.api_key, "Content-Type": "application/json"}

    @staticmethod
    def _convert(messages: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        system_parts: list[str] = []
        contents: list[dict[str, Any]] = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                system_parts.append(str(content or ""))
                continue
            if role == "tool":
                role = "user"
            gemini_role = "model" if role == "assistant" else "user"
            if isinstance(content, list):
                parts = content
            else:
                parts = [{"text": str(content or "")}]
            contents.append({"role": gemini_role, "parts": parts})
        system = ({"parts": [{"text": "\n".join(system_parts)}]} if system_parts else None)
        return system, contents

    def _payload(self, req: ModelRequest) -> dict[str, Any]:
        system, contents = self._convert(req.messages)
        generation: dict[str, Any] = {"temperature": req.temperature}
        if req.max_tokens is not None:
            generation["maxOutputTokens"] = req.max_tokens
        if req.response_format and req.response_format.get("type") == "json_object":
            generation["responseMimeType"] = "application/json"
        payload: dict[str, Any] = {"contents": contents, "generationConfig": generation}
        if system:
            payload["systemInstruction"] = system
        if req.tools:
            payload["tools"] = req.tools
        for key, value in (req.extra or {}).items():
            if key not in {"contents", "systemInstruction", "generationConfig"}:
                payload[key] = value
        return payload

    def _model_path(self, model: str) -> str:
        name = model if model.startswith("models/") else f"models/{model}"
        return f"{self.base_url}/{name}:generateContent"

    async def chat(self, req: ModelRequest) -> ModelResponse:
        if not self.api_key:
            raise InvalidKeyError()
        started = time.perf_counter()
        client = await self._get_client(req.timeout)
        try:
            resp = await client.post(self._model_path(req.model), headers=self._headers(),
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
            raise InvalidModelFormatError("Gemini 响应不是合法 JSON。") from exc
        try:
            candidates = data["candidates"]
            parts = candidates[0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts)
        except (KeyError, IndexError, TypeError) as exc:
            raise InvalidModelFormatError("Gemini 响应缺少 candidates/content/parts。") from exc
        meta = data.get("usageMetadata") or {}
        prompt = int(meta.get("promptTokenCount") or 0)
        completion = int(meta.get("candidatesTokenCount") or 0)
        from app.schemas import TokenUsage
        return ModelResponse(
            content=text,
            model=str(data.get("modelVersion") or req.model),
            usage=TokenUsage(prompt_tokens=prompt, completion_tokens=completion,
                             total_tokens=int(meta.get("totalTokenCount") or prompt + completion)),
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
        data = resp.json()
        models = data.get("models") if isinstance(data, dict) else data
        return [{"id": str(m.get("name", "")).removeprefix("models/"), "owned_by": "google"}
                for m in (models or []) if isinstance(m, dict)]
