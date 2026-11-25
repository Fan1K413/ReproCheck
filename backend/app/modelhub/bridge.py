"""业务桥接：把 ModelGateway 伪装成 LLMService.chat 的同签名对象。

这样既有服务只需把默认 `llm_service` 换成 `TaskLLM(db, task_key)`，注入的 mock
（测试中用 LLMService(client=MockTransport)）仍可原样工作，保证 219 项测试不回归。
"""
from __future__ import annotations

from typing import Any, TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from app.modelhub.gateway import model_gateway

T = TypeVar("T")


class TaskLLM:
    def __init__(self, db: AsyncSession, task_key: str,
                 injected_llm: Any | None = None) -> None:
        self.db = db
        self.task_key = task_key
        self.project_id: str | None = None
        self.injected_llm = injected_llm
        self.provider = "modelhub"
        self.model = "task-bound"

    async def chat(self, messages: list[dict[str, Any]],
                   response_schema: type[T] | None = None,
                   max_tokens: int | None = None,
                   **_: Any):
        if self.injected_llm is not None:
            resp = await self.injected_llm.chat(
                messages, response_schema=response_schema, max_tokens=max_tokens)
        else:
            resp = await model_gateway.chat(
                messages, response_schema=response_schema, max_tokens=max_tokens,
                task_key=self.task_key, db=self.db, project_id=self.project_id)
        # 记录任务实际使用的模型，供 LLMMeta / ai_runs 使用
        self.provider = getattr(resp, "provider", self.provider)
        self.model = getattr(resp, "model", self.model)
        return resp
