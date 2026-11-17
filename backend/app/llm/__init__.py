"""统一大模型服务适配层。

设计要点：
- 只走 OpenAI 兼容 chat/completions 协议（qwen 兼容模式 / 其他 OpenAI 兼容服务）。
- API Key 仅从后端配置读取，绝不进入日志、错误响应或前端。
- 有限重试、请求 ID、token 统计、耗时与真实模型名记录。
- 结构化输出经 Pydantic 严格校验；格式不合法时只做一次修复请求；仍失败则明确报错，绝不虚构结果。
"""
from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import settings
from app.core.errors import (
    InvalidKeyError,
    InvalidModelFormatError,
    NetworkError,
    RateLimitError,
    TimeoutError_,
)
from app.core.logging import logger
from app.schemas import TokenUsage

T = TypeVar("T", bound=BaseModel)

_JSON_BLOCK = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL)


def _extract_json(text: str) -> Any:
    """从模型回复中提取 JSON。优先代码块，其次首个 { 到末个 }。"""
    text = (text or "").strip()
    m = _JSON_BLOCK.search(text)
    candidate = m.group(1) if m else text
    candidate = candidate.strip()
    if not (candidate.startswith("{") or candidate.startswith("[")):
        first, last = candidate.find("{"), candidate.rfind("}")
        if first == -1:
            first, last = candidate.find("["), candidate.rfind("]")
        if first != -1 and last > first:
            candidate = candidate[first:last + 1]
    return json.loads(candidate)


@dataclass
class LLMResponse:
    content: str
    model: str
    usage: TokenUsage
    duration_ms: int
    request_id: str
    provider: str
    parsed: Any | None = None


@dataclass
class RuntimeState:
    """进程内最近一次调用状态，供 /llm/status 读取（重启后为 unknown）。"""

    last_call_at: str | None = None
    last_call_duration_ms: int | None = None
    last_call_success: bool | None = None
    last_token_usage: TokenUsage | None = None
    connection_status: str = "unknown"


runtime_state = RuntimeState()


class LLMService:
    def __init__(self, client: httpx.AsyncClient | None = None) -> None:
        self._client = client
        self.provider = settings.provider_kind
        self.model = settings.llm_model
        self.base_url = settings.llm_base_url
        self.timeout = settings.llm_timeout
        self.max_retries = settings.llm_max_retries

    def _client_ok(self) -> bool:
        return bool(settings.is_llm_configured)

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is not None:
            return self._client
        return httpx.AsyncClient(timeout=httpx.Timeout(self.timeout))

    def _headers(self, request_id: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
            "X-Request-Id": request_id,
        }

    async def _post(self, payload: dict[str, Any], request_id: str) -> dict[str, Any]:
        """单次 HTTP 调用，把各类失败映射为规范化业务异常（不含密钥/材料明文）。"""
        url = f"{self.base_url}/chat/completions"
        client = await self._get_client()
        try:
            resp = await client.post(
                url, headers=self._headers(request_id), json=payload, timeout=self.timeout
            )
        except httpx.TimeoutException:
            logger.warning("llm_call_timeout request_id=%s", request_id)
            raise TimeoutError_()
        except httpx.HTTPError as exc:
            logger.warning("llm_network_error request_id=%s type=%s", request_id, type(exc).__name__)
            raise NetworkError()

        if resp.status_code in (401, 403):
            logger.warning("llm_auth_failed request_id=%s status=%s", request_id, resp.status_code)
            raise InvalidKeyError()
        if resp.status_code == 429:
            logger.warning("llm_rate_limited request_id=%s", request_id)
            raise RateLimitError()
        if resp.status_code >= 500:
            logger.warning("llm_provider_error request_id=%s status=%s", request_id, resp.status_code)
            from app.core.errors import AppError
            raise AppError("LLM_PROVIDER_ERROR", f"模型服务返回 {resp.status_code}，请稍后重试。")
        if resp.status_code >= 400:
            logger.warning("llm_bad_request request_id=%s status=%s", request_id, resp.status_code)
            from app.core.errors import AppError
            raise AppError("LLM_PROVIDER_ERROR", f"模型服务请求被拒绝（{resp.status_code}）。")
        try:
            return resp.json()
        except Exception:
            raise InvalidModelFormatError("模型服务返回的响应不是合法 JSON。")

    def _build_payload(self, messages: list[dict[str, str]], want_json: bool,
                       max_tokens: int | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.0,
        }
        if want_json:
            payload["response_format"] = {"type": "json_object"}
        if max_tokens is not None:
            payload["max_tokens"] = max_tokens
        return payload

    async def _call_once(self, messages: list[dict[str, str]], want_json: bool,
                         request_id: str, max_tokens: int | None = None) -> dict[str, Any]:
        payload = self._build_payload(messages, want_json, max_tokens)
        return await self._post(payload, request_id)

    def _parse_response(self, data: dict[str, Any], request_id: str,
                        started: float, want_json: bool) -> tuple[str, TokenUsage, str]:
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise InvalidModelFormatError("模型响应缺少 choices/message/content。")
        actual_model = data.get("model", self.model)
        u = data.get("usage") or {}
        usage = TokenUsage(
            prompt_tokens=int(u.get("prompt_tokens") or 0),
            completion_tokens=int(u.get("completion_tokens") or 0),
            total_tokens=int(u.get("total_tokens") or 0),
        )
        # JSON 可解析性校验统一放在 chat 层的 schema 校验中，
        # 这样"完全不是 JSON"的情况也能进入一次修复请求，而不是被直接抛出。
        return content, usage, actual_model

    async def chat(
        self,
        messages: list[dict[str, str]],
        response_schema: type[T] | None = None,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        """统一调用入口。response_schema 非空时，返回内容必须是符合该 schema 的 JSON。"""
        if not self._client_ok():
            from app.core.errors import NotConfiguredError
            raise NotConfiguredError()

        request_id = f"rc-{uuid.uuid4().hex[:16]}"
        started = time.perf_counter()
        want_json = response_schema is not None
        success = False
        usage = TokenUsage()
        duration_ms = 0
        content = ""
        actual_model = self.model
        parsed: Any | None = None

        try:
            data = await self._call_once(
                messages, want_json, request_id,
                max_tokens=max_tokens or (2048 if response_schema else 256),
            )
            content, usage, actual_model = self._parse_response(data, request_id, started, want_json)

            if response_schema is not None:
                try:
                    parsed = response_schema.model_validate(_extract_json(content))
                except (ValidationError, ValueError, json.JSONDecodeError) as exc:
                    # 一次有限修复请求：把校验错误回传给模型，要求重新输出
                    fix_messages = list(messages) + [
                        {"role": "user",
                         "content": (
                             "你上一次的输出不符合要求的 JSON 结构。"
                             f"校验错误：{str(exc)[:400]}。"
                             "请只重新输出一个符合该结构的合法 JSON，不要附加任何解释文字。"
                         )},
                    ]
                    data2 = await self._call_once(
                        fix_messages, want_json, request_id,
                        max_tokens=max_tokens or 2048,
                    )
                    content, usage2, actual_model = self._parse_response(
                        data2, request_id, started, want_json
                    )
                    # 累加两次调用的 token
                    usage = TokenUsage(
                        prompt_tokens=usage.prompt_tokens + usage2.prompt_tokens,
                        completion_tokens=usage.completion_tokens + usage2.completion_tokens,
                        total_tokens=usage.total_tokens + usage2.total_tokens,
                    )
                    try:
                        parsed = response_schema.model_validate(_extract_json(content))
                    except (ValidationError, ValueError, json.JSONDecodeError) as exc2:
                        raise InvalidModelFormatError(
                            "模型输出经一次修复后仍不符合结构要求。",
                            details={"validation_error": str(exc2)[:400]},
                        )

            success = True
            return LLMResponse(
                content=content,
                model=actual_model,
                usage=usage,
                duration_ms=int((time.perf_counter() - started) * 1000),
                request_id=request_id,
                provider=self.provider,
                parsed=parsed,
            )
        except (InvalidKeyError, RateLimitError, TimeoutError_, NetworkError):
            # 这些是确定性失败，不重试
            raise
        except InvalidModelFormatError:
            raise
        except Exception as exc:  # noqa: BLE001 - 兜底，避免无限重试
            logger.warning("llm_unexpected_error request_id=%s type=%s", request_id, type(exc).__name__)
            from app.core.errors import AppError
            raise AppError("LLM_PROVIDER_ERROR", "模型调用发生未预期错误。")
        finally:
            duration_ms = int((time.perf_counter() - started) * 1000)
            runtime_state.last_call_at = datetime.now(timezone.utc).isoformat()
            runtime_state.last_call_duration_ms = duration_ms
            runtime_state.last_call_success = success
            runtime_state.last_token_usage = usage if (usage.total_tokens or success) else None
            runtime_state.connection_status = "ok" if success else "error"

    async def test_connection(self) -> LLMResponse:
        """要求模型只回复指定内容，用于连接测试。"""
        messages = [
            {"role": "system", "content": "你是一个连接测试助手，必须严格遵循用户的输出要求。"},
            {"role": "user", "content": "请只回复：ReproCheck API 连接成功。不要输出任何其他内容。"},
        ]
        return await self.chat(messages, response_schema=None)


# 进程内单例（测试可注入自定义 client 覆盖）
llm_service = LLMService()
