"""C 组 · 受控 RAG 知识检索路由。

POST /rag/query 认证即可（给定 project_id 时校验项目访问并强制当前证据优先）；
GET /rag/documents 认证可见公共 + 本 org 文档；
POST /rag/documents 需 rule.manage 或 case.manage（service 内校验）。
检索确定性、带来源与 provenance_class；可选合成标注 model_inference。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.errors import ok
from app.db import get_db
from app.models.stage6 import User
from app.services import rag_service as svc

router = APIRouter(tags=["rag-knowledge"])


def _rid(request: Request) -> str:
    return getattr(request.state, "request_id", "-")


class RagQueryIn(BaseModel):
    query: str
    project_id: str | None = None
    top_k: int = 5
    synthesize: bool = False


class DocumentIn(BaseModel):
    source_type: str
    source_ref: str = ""
    title: str
    content: str
    is_public: bool = False


@router.post("/rag/query")
async def rag_query(payload: RagQueryIn, request: Request, db: AsyncSession = Depends(get_db),
                    user: User = Depends(get_current_user)):
    data = await svc.query(db, user, payload.query, payload.project_id, payload.top_k,
                           payload.synthesize, _rid(request))
    return ok(data, _rid(request))


@router.get("/rag/documents")
async def list_documents(request: Request, source_type: str | None = None,
                         db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    items = await svc.list_documents(db, user, source_type)
    return ok({"items": items, "total": len(items)}, _rid(request))


@router.post("/rag/documents")
async def add_document(payload: DocumentIn, request: Request, db: AsyncSession = Depends(get_db),
                       user: User = Depends(get_current_user)):
    data = await svc.add_document(db, user, payload.source_type, payload.source_ref, payload.title,
                                  payload.content, payload.is_public, _rid(request))
    return ok(data, _rid(request))