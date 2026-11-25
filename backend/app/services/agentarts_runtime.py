"""Invoke a published AgentArts workflow and consume only its execution events."""
from __future__ import annotations

import json
import re
from asyncio import timeout
from urllib.parse import urlsplit

import httpx

from app.core.config import settings
from app.core.errors import AppError


def configured() -> bool:
    try:
        url = urlsplit(settings.agentarts_invoke_url)
    except ValueError:
        return False
    return bool(
        url.scheme == "https" and url.hostname and
        url.hostname.endswith(".myhuaweicloud.com") and
        not (url.username or url.password or url.query or url.fragment) and
        re.fullmatch(r"/runtimes/[\w-]+/invocations", url.path) and
        settings.agentarts_api_key.strip() and len(settings.agentarts_tool_secret) >= 32 and
        0 < len(settings.agentarts_workflow_version.strip()) <= 120
    )


async def invoke(run_id: str, tool_token: str) -> list[dict]:
    headers = {
        "Authorization": f"Bearer {settings.agentarts_api_key}",
        "X-Invoke-Mode": "published",
        "x-hw-agentarts-session-id": run_id,
        "Accept": "text/event-stream",
    }
    payload = {"inputs": {"run_id": run_id, "tool_token": tool_token}}
    steps: list[dict] = []
    completed = False
    consumed = 0
    try:
        async with timeout(settings.agentarts_timeout), httpx.AsyncClient(
            timeout=settings.agentarts_timeout, follow_redirects=False
        ) as client, client.stream(
            "POST", settings.agentarts_invoke_url, headers=headers, json=payload
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                consumed += len(line)
                if consumed > 2_000_000:
                    raise ValueError("oversized stream")
                if not line.startswith("data:"):
                    continue
                event = json.loads(line[5:])
                if not isinstance(event, dict):
                    raise ValueError("invalid event")
                name = event.get("event")
                data = event.get("data") or {}
                if not isinstance(data, dict):
                    data = {}
                if name in ("error", "exception", "node_wait"):
                    raise AppError("AGENTARTS_WORKFLOW_FAILED", "AgentArts 工作流报错或等待额外输入。", status_code=502)
                if name == "node_finished" and len(steps) < 80:
                    node_type = data.get("node_type")
                    node_name = data.get("node_name")
                    if isinstance(node_type, str) and isinstance(node_name, str):
                        steps.append({"node_type": node_type[:40], "name": node_name[:100]})
                if name == "workflow_finished":
                    if str(data.get("status", "")).lower() in {"failed", "failure", "error", "cancelled", "canceled"}:
                        raise AppError("AGENTARTS_WORKFLOW_FAILED", "AgentArts 工作流执行失败。", status_code=502)
                    completed = True
                if name == "end":
                    break
    except (TimeoutError, httpx.TimeoutException) as exc:
        raise AppError("AGENTARTS_TIMEOUT", "AgentArts 调用超时。可从审计页重新发起。", status_code=504) from exc
    except httpx.HTTPStatusError as exc:
        raise AppError("AGENTARTS_HTTP_ERROR", f"AgentArts 返回 HTTP {exc.response.status_code}。", status_code=502) from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise AppError("AGENTARTS_PROTOCOL_ERROR", "AgentArts 调用失败或响应格式无效。", status_code=502) from exc
    if not completed:
        raise AppError("AGENTARTS_INCOMPLETE", "AgentArts 未返回工作流完成事件。", status_code=502)
    return steps
