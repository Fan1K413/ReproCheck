from fastapi import APIRouter, Request

from app.core.errors import ok
from app.core.logging import logger

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(request: Request):
    from datetime import datetime, timezone
    return ok(
        {"status": "ok", "version": "1.0.0-stage1",
         "timestamp": datetime.now(timezone.utc).isoformat()},
        getattr(request.state, "request_id", "-"),
    )
