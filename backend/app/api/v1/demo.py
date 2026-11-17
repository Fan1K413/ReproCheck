"""审计演示：真实 AI 链路的端到端入口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.errors import ok
from app.db import get_db
from app.schemas import DemoAuditRequest
from app.services.audit_service import AuditService

router = APIRouter(tags=["demo"])


@router.post("/demo/audit", dependencies=[Depends(require_admin)])
async def demo_audit(payload: DemoAuditRequest, request: Request, db: AsyncSession = Depends(get_db)):
    service = AuditService(db)
    result = await service.run_audit(
        project_name=payload.project_name,
        material_a_text=payload.material_a_text,
        material_b_text=payload.material_b_text,
        use_default_materials=payload.use_default_materials,
    )
    return ok(result, getattr(request.state, "request_id", "-"))
