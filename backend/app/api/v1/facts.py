"""第二阶段科研事实与证据 API（含人工修订留痕）。"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_admin
from app.core.errors import AppError, ok
from app.db import get_db
from app.models import ExtractedFact, Material, SourceChunk
from app.models.stage2 import EvidenceItem, FactRevision

router = APIRouter(tags=["facts"])


class FactPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    field_key: str | None = None
    field_label: str | None = None
    raw_value: str | None = None
    normalized_value: str | None = None
    note: str = ""


def _evidence_view(ev: EvidenceItem) -> dict[str, Any]:
    locator: Any = None
    if ev.source_locator:
        try:
            locator = json.loads(ev.source_locator)
        except Exception:  # noqa: BLE001
            locator = None
    return {
        "evidence_id": ev.evidence_id, "chunk_id": ev.chunk_id,
        "quote": ev.quote, "source_name": ev.source_name,
        "source_locator": locator, "verification_status": ev.verification_status,
        "original_text": ev.original_text,
    }


def _fact_view(f: ExtractedFact, evidence: list[EvidenceItem], revisions: int = 0) -> dict[str, Any]:
    return {
        "fact_id": f.fact_id or str(f.id), "project_id": f.project_id,
        "material_id": f.material_id, "fact_type": f.fact_type,
        "field_key": f.field_key, "field_label": f.field_label or f.field_key,
        "raw_value": f.raw_value, "normalized_value": f.normalized_value,
        "unit": f.unit, "assertion_type": f.assertion_type,
        "extraction_status": f.extraction_status, "parser_source": f.parser_source,
        "extraction_run_id": f.extraction_run_id, "confidence": f.confidence,
        "source_name": f.source_name, "evidence": [_evidence_view(e) for e in evidence],
        "revision_count": revisions,
        "created_at": f.created_at.isoformat() if f.created_at else "",
    }


async def _load_evidence(db: AsyncSession, fact_id: str) -> list[EvidenceItem]:
    rows = (await db.execute(
        select(EvidenceItem).where(EvidenceItem.fact_id == fact_id)
    )).scalars().all()
    return list(rows)


@router.get("/facts")
async def list_facts(
    project_id: str, request: Request, db: AsyncSession = Depends(get_db),
    material_id: str | None = None,
):
    q = select(ExtractedFact).where(ExtractedFact.project_id == project_id)
    if material_id:
        q = q.where(ExtractedFact.material_id == material_id)
    rows = (await db.execute(q.order_by(ExtractedFact.created_at.desc()).limit(500))).scalars().all()
    items = []
    for f in rows:
        fid = f.fact_id or str(f.id)
        ev = await _load_evidence(db, fid)
        rc = (await db.execute(
            select(FactRevision.revision_id).where(FactRevision.fact_id == fid)
        )).all()
        items.append(_fact_view(f, ev, len(rc)))
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.patch("/facts/{fact_id}", dependencies=[Depends(require_admin)])
async def patch_fact(fact_id: str, payload: FactPatch, request: Request,
                     db: AsyncSession = Depends(get_db)):
    f = (await db.execute(
        select(ExtractedFact).where(ExtractedFact.fact_id == fact_id)
    )).scalar_one_or_none()
    if f is None:
        raise AppError("NOT_FOUND", "事实不存在。")

    changes: list[tuple[str, str | None, str | None]] = []
    for field in ("field_key", "field_label", "raw_value", "normalized_value"):
        new = getattr(payload, field)
        if new is None:
            continue
        old = getattr(f, field)
        if old != new:
            changes.append((field, old, new))
            setattr(f, field, new)

    if changes:
        # 第一次人工修订时保存 AI 原始快照，后续修订不再覆盖
        if f.parser_source == "model":
            f.ai_original_json = json.dumps({
                "field_key": f.field_key, "field_label": f.field_label,
                "raw_value": f.raw_value, "normalized_value": f.normalized_value,
            }, ensure_ascii=False)
        f.parser_source = "human"
        f.revision_count = (f.revision_count or 0) + 1
        for field, old, new in changes:
            db.add(FactRevision(
                revision_id=f"rev-{uuid.uuid4().hex[:14]}", fact_id=fact_id,
                field_key=field, old_value=old, new_value=new,
                revision_source="human", note=payload.note,
                created_at=datetime.now(timezone.utc),
            ))
        db.add(f)
        await db.commit()

    ev = await _load_evidence(db, fact_id)
    return ok(_fact_view(f, ev, f.revision_count or 0), getattr(request.state, "request_id", "-"))


@router.get("/facts/{fact_id}/revisions")
async def get_revisions(fact_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(FactRevision).where(FactRevision.fact_id == fact_id)
        .order_by(FactRevision.created_at)
    )).scalars().all()
    items = [{
        "revision_id": r.revision_id, "fact_id": r.fact_id, "field_key": r.field_key,
        "old_value": r.old_value, "new_value": r.new_value,
        "revision_source": r.revision_source, "note": r.note,
        "created_at": r.created_at.isoformat() if r.created_at else "",
    } for r in rows]
    return ok({"items": items, "total": len(items)}, getattr(request.state, "request_id", "-"))


@router.get("/projects/{project_id}/evidence-graph")
async def get_evidence_graph(
    project_id: str, request: Request, db: AsyncSession = Depends(get_db),
):
    """从已持久化事实、证据、材料和文本块构建只读证据图谱。

    只输出数据库中可追溯的关系；缺失的事实/证据/来源端点不会被补造。
    """
    facts = (await db.execute(
        select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        .order_by(ExtractedFact.created_at, ExtractedFact.id).limit(1000)
    )).scalars().all()
    fact_ids = [f.fact_id or str(f.id) for f in facts]
    facts_by_id = {f.fact_id or str(f.id): f for f in facts}
    evidence_rows: list[EvidenceItem] = []
    if fact_ids:
        evidence_rows = list((await db.execute(
            select(EvidenceItem).where(
                EvidenceItem.project_id == project_id,
                EvidenceItem.fact_id.in_(fact_ids),
            ).order_by(EvidenceItem.id).limit(5000)
        )).scalars().all())

    material_ids = {f.material_id for f in facts}
    materials: dict[str, Material] = {}
    if material_ids:
        materials = {m.id: m for m in (await db.execute(
            select(Material).where(
                Material.project_id == project_id, Material.id.in_(material_ids)
            )
        )).scalars().all()}

    chunk_ids = {e.chunk_id for e in evidence_rows}
    chunks: dict[tuple[str, str], SourceChunk] = {}
    if chunk_ids and material_ids:
        chunks = {(c.material_id, c.chunk_id): c for c in (await db.execute(
            select(SourceChunk).where(
                SourceChunk.material_id.in_(material_ids),
                SourceChunk.chunk_id.in_(chunk_ids),
            )
        )).scalars().all()}

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    fact_node_ids: set[str] = set()
    evidence_node_ids: set[str] = set()
    material_node_ids: set[str] = set()
    chunk_node_ids: set[str] = set()
    for fact in facts:
        fid = fact.fact_id or str(fact.id)
        node_id = f"fact:{fid}"
        fact_node_ids.add(node_id)
        nodes.append({
                "id": node_id, "type": "fact", "label": fact.field_label or fact.field_key,
                "fact_id": fid, "project_id": project_id, "material_id": fact.material_id,
                "field_key": fact.field_key,
                "value": fact.normalized_value if fact.normalized_value is not None else fact.raw_value,
            "extraction_status": fact.extraction_status,
        })

    for evidence in evidence_rows:
        # 防止遗留或手工写入的不一致数据形成跨材料/跨项目边。
        fact = facts_by_id.get(evidence.fact_id)
        material = materials.get(evidence.material_id)
        chunk = chunks.get((evidence.material_id, evidence.chunk_id))
        if fact is None or material is None or chunk is None:
            continue
        if fact.material_id != evidence.material_id or chunk.material_id != evidence.material_id:
            continue
        ev_node = f"evidence:{evidence.evidence_id}"
        material_node = f"material:{material.id}"
        chunk_node = f"chunk:{chunk.chunk_id}"
        if ev_node not in evidence_node_ids:
            evidence_node_ids.add(ev_node)
            nodes.append({
                "id": ev_node, "type": "evidence", "label": evidence.quote[:160],
                "evidence_id": evidence.evidence_id,
                "verification_status": evidence.verification_status,
                "source_locator": _evidence_view(evidence)["source_locator"],
            })
        if material_node not in material_node_ids:
            material_node_ids.add(material_node)
            nodes.append({
                "id": material_node, "type": "material", "label": material.source_name,
                "material_id": material.id, "sha256": material.sha256,
            })
        if chunk_node not in chunk_node_ids:
            chunk_node_ids.add(chunk_node)
            try:
                chunk_locator = json.loads(chunk.source_locator_json) if chunk.source_locator_json else None
            except (json.JSONDecodeError, TypeError):
                chunk_locator = None
            nodes.append({
                "id": chunk_node, "type": "source_chunk", "label": chunk.chunk_id,
                "chunk_id": chunk.chunk_id, "material_id": chunk.material_id,
                "source_locator": chunk_locator,
            })
        edges.extend([
            {"source": f"fact:{evidence.fact_id}", "target": ev_node, "type": "supported_by"},
            {"source": ev_node, "target": chunk_node, "type": "quotes"},
            {"source": chunk_node, "target": material_node, "type": "located_in"},
        ])

    return ok({
        "project_id": project_id, "nodes": nodes, "edges": edges,
        "counts": {
            "facts": len(fact_node_ids), "evidence": len(evidence_node_ids),
            "materials": len(material_node_ids), "source_chunks": len(chunk_node_ids),
            "edges": len(edges),
        },
    }, getattr(request.state, "request_id", "-"))


@router.get("/facts/summary")
async def facts_summary(project_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(ExtractedFact).where(ExtractedFact.project_id == project_id)
    )).scalars().all()
    by_assertion = {k: 0 for k in ("explicit", "inferred", "ambiguous", "not_found")}
    by_status = {k: 0 for k in ("supported", "unsupported", "needs_review")}
    by_type: dict[str, int] = {}
    with_evidence = 0
    human = 0
    for f in rows:
        if f.assertion_type in by_assertion:
            by_assertion[f.assertion_type] += 1
        if f.extraction_status in by_status:
            by_status[f.extraction_status] += 1
        by_type[f.fact_type] = by_type.get(f.fact_type, 0) + 1
        if f.parser_source == "human":
            human += 1
        fid = f.fact_id or str(f.id)
        if (await db.execute(
            select(EvidenceItem.id).where(EvidenceItem.fact_id == fid).limit(1)
        )).first():
            with_evidence += 1
    return ok({
        "total": len(rows), "by_assertion": by_assertion, "by_status": by_status,
        "with_evidence": with_evidence, "human_confirmed": human, "by_type": by_type,
    }, getattr(request.state, "request_id", "-"))
