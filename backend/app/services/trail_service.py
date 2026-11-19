"""操作审计轨迹：记录谁、何时、对什么对象、做了什么，保留修改前后内容。

重要判断（事实修订、问题确认、规则修改、修复批准、报告生成）必须留痕，
且不得因用户修改结论而覆盖原始 AI 判断与原始证据。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import new_id
from app.models.stage6 import AuditTrail


def _dump(value: Any | None) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


async def record_trail(
    db: AsyncSession,
    *,
    action: str,
    actor_user_id: str | None = None,
    org_id: str | None = None,
    project_id: str | None = None,
    target_type: str = "",
    target_id: str = "",
    before: Any | None = None,
    after: Any | None = None,
    summary: str = "",
    request_id: str = "",
) -> AuditTrail:
    entry = AuditTrail(
        id=new_id("trail"),
        org_id=org_id,
        project_id=project_id,
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        before_json=_dump(before),
        after_json=_dump(after),
        summary=summary,
        request_id=request_id,
    )
    db.add(entry)
    return entry