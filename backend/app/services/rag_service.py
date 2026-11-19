"""C 组 · 受控 RAG 知识检索服务。

核心约束（见 docs/RAG_KNOWLEDGE_ARCHITECTURE.md）：
- 检索完全确定性：纯 Python TF-IDF + 余弦相似度（含中文 unigram/bigram），
  不依赖任何向量数据库，不调用大模型；每条命中都带 source_ref 与 provenance_class。
- 来源分级（provenance_class）四分类：
    current_evidence   当前论文 / 材料的原始证据（最高优先，来自被审计对象本身，不入库）
    historical_case    历史基准案例 / 标准化事实 / 失败诊断
    external_knowledge 审计规则 / 复现方法 / 环境配置等外部知识
    model_inference    大模型合成内容（可选，必须显式标注，且不得冒充证据）
- 给定 project_id 时，强制提示：当前论文原始证据永远优先，历史案例不得覆盖当前事实。
- 可选合成（synthesize=True）才使用 LLMService，且保留来源标签、标注 model_inference；
  未配置 / 失败时优雅降级为纯检索，绝不阻断核心体验。
"""
from __future__ import annotations

import json
import math
import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access, user_has_permission
from app.core.config import settings
from app.core.errors import AppError
from app.core.security import new_id
from app.models.stage6 import KnowledgeDocument, OrgMember, ProjectMember, User
from app.services.trail_service import record_trail

SOURCE_TYPES = {"verified_case", "normalized_fact", "audit_rule",
                "repro_method", "env_config", "failure_diagnosis"}

PROVENANCE_MAP = {
    "verified_case": "historical_case",
    "normalized_fact": "historical_case",
    "failure_diagnosis": "historical_case",
    "audit_rule": "external_knowledge",
    "repro_method": "external_knowledge",
    "env_config": "external_knowledge",
}

PROVENANCE_CLASSES = {
    "current_evidence": "当前论文/材料原始证据，最高优先，来自被审计对象本身",
    "historical_case": "历史基准案例/标准化事实/失败诊断，仅供参考，不得覆盖当前事实",
    "external_knowledge": "审计规则/复现方法/环境配置等外部知识",
    "model_inference": "大模型合成内容，必须显式标注，不得冒充证据",
}

CURRENT_EVIDENCE_PRIORITY_NOTE = (
    "当前论文原始证据（current_evidence）永远优先；历史案例（historical_case）与"
    "外部知识（external_knowledge）只能补充参考，不得覆盖或改写当前事实。"
)

_WORD = re.compile(r"[a-z0-9]+")
_CJK = re.compile(r"[\u4e00-\u9fff]")


def tokenize(text: str) -> list[str]:
    """确定性分词：英文/数字词 + 中文单字 + 中文二元组（无需外部分词依赖）。"""
    t = (text or "").lower()
    tokens = _WORD.findall(t)
    cjk = _CJK.findall(t)
    tokens.extend(cjk)
    tokens.extend(cjk[i] + cjk[i + 1] for i in range(len(cjk) - 1))
    return tokens


def _tf(tokens: list[str]) -> dict[str, int]:
    out: dict[str, int] = {}
    for t in tokens:
        out[t] = out.get(t, 0) + 1
    return out


def _cosine(qv: dict[str, float], dv: dict[str, float]) -> float:
    if not qv or not dv:
        return 0.0
    dot = sum(w * dv.get(t, 0.0) for t, w in qv.items())
    nq = math.sqrt(sum(w * w for w in qv.values()))
    nd = math.sqrt(sum(w * w for w in dv.values()))
    if nq == 0.0 or nd == 0.0:
        return 0.0
    return dot / (nq * nd)


def doc_view(d: KnowledgeDocument) -> dict:
    return {
        "id": d.id, "source_type": d.source_type, "source_ref": d.source_ref or "",
        "title": d.title, "content": d.content, "org_id": d.org_id, "is_public": d.is_public,
        "created_by": d.created_by, "provenance_class": PROVENANCE_MAP.get(d.source_type, "external_knowledge"),
        "created_at": d.created_at.isoformat() if d.created_at else "",
    }


async def _user_org_ids(db: AsyncSession, user: User) -> list[str]:
    rows = (await db.execute(select(OrgMember).where(OrgMember.user_id == user.id))).scalars().all()
    return [m.org_id for m in rows]


async def _can_manage_knowledge(db: AsyncSession, user: User) -> str | None:
    """rule.manage（org）或 case.manage（project）任一即可管理知识库；返回归属 org_id。"""
    if user.is_platform_admin:
        orgs = await _user_org_ids(db, user)
        return orgs[0] if orgs else None
    for org_id in await _user_org_ids(db, user):
        if await user_has_permission(db, user, "rule.manage", org_id=org_id):
            return org_id
    pms = (await db.execute(select(ProjectMember).where(ProjectMember.user_id == user.id))).scalars().all()
    for pm in pms:
        if await user_has_permission(db, user, "case.manage", project_id=pm.project_id):
            from app.models import Project
            proj = (await db.execute(select(Project).where(Project.id == pm.project_id))).scalar_one_or_none()
            return proj.org_id if proj else None
    raise AppError("FORBIDDEN", "缺少权限：rule.manage 或 case.manage。")


async def _visible_docs(db: AsyncSession, user: User) -> list[KnowledgeDocument]:
    rows = (await db.execute(select(KnowledgeDocument).order_by(KnowledgeDocument.created_at.asc()))).scalars().all()
    if user.is_platform_admin:
        return list(rows)
    org_ids = set(await _user_org_ids(db, user))
    return [d for d in rows if d.is_public or (d.org_id and d.org_id in org_ids) or d.created_by == user.id]


async def add_document(db: AsyncSession, user: User, source_type: str, source_ref: str,
                       title: str, content: str, is_public: bool, request_id: str = "") -> dict:
    org_id = await _can_manage_knowledge(db, user)
    if source_type not in SOURCE_TYPES:
        raise AppError("VALIDATION_ERROR", f"source_type 须为 {sorted(SOURCE_TYPES)}。")
    if not (title or "").strip() or not (content or "").strip():
        raise AppError("VALIDATION_ERROR", "title 与 content 不能为空。")
    d = KnowledgeDocument(id=new_id("kd"), source_type=source_type, source_ref=source_ref or "",
                          title=title.strip(), content=content, org_id=org_id,
                          is_public=bool(is_public), created_by=user.id)
    db.add(d)
    await record_trail(db, action="rag.document_add", actor_user_id=user.id, org_id=org_id,
                       target_type="knowledge_document", target_id=d.id,
                       after={"source_type": source_type, "provenance_class": PROVENANCE_MAP[source_type],
                              "is_public": bool(is_public)},
                       summary=f"入库知识文档（{source_type}）", request_id=request_id)
    await db.commit()
    return doc_view(d)


async def list_documents(db: AsyncSession, user: User, source_type: str | None = None) -> list[dict]:
    docs = await _visible_docs(db, user)
    if source_type:
        docs = [d for d in docs if d.source_type == source_type]
    return [doc_view(d) for d in docs]


def _retrieve(query: str, docs: list[KnowledgeDocument], top_k: int) -> list[dict]:
    """确定性 TF-IDF 余弦检索；命中按分数降序、id 升序稳定排序，仅保留 score>0。"""
    q_tokens = tokenize(query)
    if not q_tokens or not docs:
        return []
    corpus = [tokenize(d.title) * 2 + tokenize(d.content) for d in docs]
    n = len(docs)
    df: dict[str, int] = {}
    for tokens in corpus:
        for t in set(tokens):
            df[t] = df.get(t, 0) + 1
    idf = {t: math.log((n + 1) / (c + 1)) + 1.0 for t, c in df.items()}
    q_tf = _tf(q_tokens)
    qv = {t: c * idf.get(t, math.log((n + 1) / 1) + 1.0) for t, c in q_tf.items()}
    scored: list[tuple[float, KnowledgeDocument]] = []
    for d, tokens in zip(docs, corpus):
        dv = {t: c * idf.get(t, 0.0) for t, c in _tf(tokens).items()}
        score = _cosine(qv, dv)
        if score > 0.0:
            scored.append((score, d))
    scored.sort(key=lambda x: (-x[0], x[1].id))
    hits = []
    for score, d in scored[:max(1, top_k)]:
        hits.append({"document": doc_view(d), "score": round(score, 6),
                     "source_ref": d.source_ref or "", "provenance_class": PROVENANCE_MAP.get(d.source_type, "external_knowledge")})
    return hits


async def _synthesize(query: str, hits: list[dict]) -> dict | None:
    """可选合成：仅在配置了 LLM 时调用；保留来源标签，标注 model_inference；失败优雅降级。"""
    if not settings.is_llm_configured or not hits:
        return None
    try:
        from app.llm import llm_service
        sources = "\n".join(
            f"[{i+1}] ({h['provenance_class']}) {h['document']['title']} | source_ref={h['source_ref']}\n{h['document']['content'][:600]}"
            for i, h in enumerate(hits)
        )
        messages = [
            {"role": "system", "content": (
                "你是科研复现审计知识助手。只能依据给定带来源标签的资料回答，"
                "不得编造证据。当前论文原始证据（current_evidence）永远优先，"
                "历史案例与外部知识不得覆盖当前事实。回答末尾列出引用的来源编号。"
            )},
            {"role": "user", "content": f"问题：{query}\n\n资料：\n{sources}\n\n请给出简洁回答并标注来源编号。"},
        ]
        resp = await llm_service.chat(messages, response_schema=None, max_tokens=512)
        return {"provenance_class": "model_inference", "answer": resp.content,
                "model": resp.model, "sources": [{"index": i + 1, "source_ref": h["source_ref"],
                                                 "provenance_class": h["provenance_class"],
                                                 "document_id": h["document"]["id"]} for i, h in enumerate(hits)]}
    except AppError:
        return None
    except Exception:  # noqa: BLE001 - 合成失败绝不阻断确定性检索
        return None


async def query(db: AsyncSession, user: User, query: str, project_id: str | None,
                top_k: int = 5, synthesize: bool = False, request_id: str = "") -> dict:
    if not (query or "").strip():
        raise AppError("VALIDATION_ERROR", "query 不能为空。")
    top_k = max(1, min(int(top_k or 5), 50))
    priority_note = None
    if project_id:
        await resolve_project_access(db, project_id, user)
        priority_note = CURRENT_EVIDENCE_PRIORITY_NOTE
    docs = await _visible_docs(db, user)
    hits = _retrieve(query, docs, top_k)
    synthesis = await _synthesize(query, hits) if synthesize else None
    return {
        "query": query, "project_id": project_id, "top_k": top_k, "hits": hits,
        "total_candidates": len(docs),
        "provenance": {
            "classes": PROVENANCE_CLASSES,
            "current_evidence_priority": priority_note or CURRENT_EVIDENCE_PRIORITY_NOTE,
            "note": "检索为确定性 TF-IDF，命中均带 source_ref 与 provenance_class；知识库内容永远不是 current_evidence。",
        },
        "synthesis": synthesis,
    }