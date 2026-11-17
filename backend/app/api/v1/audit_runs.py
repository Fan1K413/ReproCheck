"""按 run_id 读取历史审计结果。"""
from __future__ import annotations

from fastapi import APIRouter, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, ok
from app.db import get_db
from app.services.audit_service import get_audit_result_from_db
from fastapi import Depends

router = APIRouter(tags=["audit-runs"])


@router.get("/audit-runs/{run_id}")
async def get_audit_run(run_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    result = await get_audit_result_from_db(db, run_id)
    if result is None:
        raise AppError("NOT_FOUND", f"未找到审计运行 {run_id}。")
    return ok(result, getattr(request.state, "request_id", "-"))
