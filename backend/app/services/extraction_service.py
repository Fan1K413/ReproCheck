"""科研事实抽取服务（第二阶段核心）。

严格链路：ParseResult.chunks → 按类型提示词调用真实 LLM → Pydantic 校验 →
chunk_id 存在性校验 → quote 逐字校验 → 落库 extracted_facts / evidence_items / ai_runs。

任何失败都明确抛错，绝不返回预制结果或虚构证据。
"""
from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError, EvidenceValidationError
from app.core.logging import logger
from app.llm import LLMService, llm_service
from app.llm.prompts import build_extraction_messages, prompt_version_for
from app.models import AIRun, ExtractedFact, Material, SourceChunk
from app.models.stage2 import EvidenceItem
from app.schemas.parsing import (
    EvidenceRef,
    ExtractedFactIn,
    FactsExtractionV2,
    ParseResult,
)

# 单次解析的硬上限（成本控制）
MAX_LLM_CALLS_PER_TASK = 3
MAX_FACTS_PER_MATERIAL = 80


@dataclass
class ExtractionResult:
    facts_created: int = 0
    evidence_created: int = 0
    evidence_rejected: int = 0
    calls: int = 0
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    prompt_version: str = ""
    duration_ms: int = 0
    run_id: str = ""
    by_assertion: dict[str, int] = field(default_factory=dict)


def _quote_in_text(quote: str, text: str) -> bool:
    """quote 必须在 chunk 原文中逐字连续出现（忽略首尾空白差异）。"""
    if not quote or not quote.strip():
        return False
    return quote.strip() in text


def _normalize_for_compare(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, float):
        return repr(value)
    return str(value)


class ExtractionService:
    def __init__(self, db: AsyncSession, llm: LLMService | None = None) -> None:
        self.db = db
        self.llm = llm or llm_service

    async def extract(
        self,
        *,
        material: Material,
        parse_result: ParseResult,
        project_id: str,
        task_id: str,
    ) -> ExtractionResult:
        """对单个材料的解析结果执行事实抽取并落库。"""
        result = ExtractionResult(
            run_id=f"llm-{uuid.uuid4().hex[:16]}",
            prompt_version=prompt_version_for(parse_result.material_type),
        )
        import time
        t0 = time.perf_counter()

        # 载入该材料真实的 chunks（证据原文唯一来源，禁止用模型输出构造）
        db_chunks = (
            await self.db.execute(
                select(SourceChunk).where(SourceChunk.material_id == material.id)
            )
        ).scalars().all()
        # 兼容：若解析结果尚未落库 chunk，则以 parse_result.chunks 为准
        chunk_map: dict[str, SourceChunk] = {c.chunk_id: c for c in db_chunks}
        if not chunk_map:
            for sc in parse_result.chunks:
                virtual = SourceChunk(
                    id=0, material_id=material.id, chunk_id=sc.chunk_id,
                    chunk_index=sc.chunk_index, original_text=sc.content,
                    locator_type="text_paragraph", page_number=None, line_number=None,
                    created_at=datetime.now(timezone.utc),
                    project_id=project_id, material_type=sc.material_type,
                    content_hash=sc.content_hash, parser_version=sc.parser_version,
                    source_locator_json=json.dumps(sc.source_locator, ensure_ascii=False),
                )
                chunk_map[sc.chunk_id] = virtual
                self.db.add(virtual)
            await self.db.flush()

        valid_ids = set(chunk_map.keys())
        if not valid_ids:
            # 没有可用文本块——明确失败，不伪造事实
            raise AppError("EVIDENCE_VALIDATION_FAILED", "材料无可解析文本块，无法进行事实抽取。")

        # 构造 prompt 输入（有界）
        prompt_chunks = [
            {"chunk_id": c.chunk_id, "content": c.original_text}
            for c in chunk_map.values()
        ][:60]
        messages = build_extraction_messages(
            parse_result.material_type, prompt_chunks, max_chars=6000,
        )

        ai_run = AIRun(
            id=result.run_id, project_id=project_id, material_id=material.id,
            run_type="material_extraction", status="running",
            provider=self.llm.provider, model=self.llm.model,
            prompt_version=result.prompt_version,
        )
        self.db.add(ai_run)
        await self.db.flush()

        try:
            resp = await self.llm.chat(messages, response_schema=FactsExtractionV2)
        except AppError as exc:
            ai_run.status = "failed"
            ai_run.success = False
            ai_run.error_code = exc.code
            ai_run.finished_at = datetime.now(timezone.utc)
            self.db.add(ai_run)
            await self.db.commit()
            raise
        except Exception as exc:  # noqa: BLE001
            logger.warning("extraction_unexpected_error run=%s type=%s", result.run_id, type(exc).__name__)
            ai_run.status = "failed"
            ai_run.success = False
            ai_run.error_code = "INTERNAL_ERROR"
            ai_run.finished_at = datetime.now(timezone.utc)
            self.db.add(ai_run)
            await self.db.commit()
            raise AppError("INTERNAL_ERROR", "事实抽取发生未预期错误。")

        result.calls = 1
        result.prompt_tokens = resp.usage.prompt_tokens
        result.completion_tokens = resp.usage.completion_tokens
        result.total_tokens = resp.usage.total_tokens
        result.model = resp.model

        extraction: FactsExtractionV2 = resp.parsed or FactsExtractionV2(facts=[])

        # 去重 + 数量上限
        seen: set[tuple[str, str]] = set()
        accepted: list[ExtractedFactIn] = []
        for fact in extraction.facts:
            key = (fact.field_key, _normalize_for_compare(fact.normalized_value) or fact.raw_value)
            if key in seen:
                continue
            seen.add(key)
            accepted.append(fact)
            if len(accepted) >= MAX_FACTS_PER_MATERIAL:
                break

        for fact in accepted:
            # ---- chunk_id 存在性 + material 归属校验 ----
            verified_refs: list[tuple[EvidenceRef, SourceChunk, bool]] = []
            for ref in fact.evidence_refs:
                if ref.chunk_id not in valid_ids:
                    result.evidence_rejected += 1
                    logger.warning("reject_unknown_chunk run=%s chunk=%s", result.run_id, ref.chunk_id)
                    continue  # 拒绝该引用，但保留事实（若无有效证据则标 unsupported）
                chunk = chunk_map[ref.chunk_id]
                if chunk.material_id != material.id:
                    result.evidence_rejected += 1
                    continue
                quote_ok = _quote_in_text(ref.quote, chunk.original_text)
                verified_refs.append((ref, chunk, quote_ok))

            # 只有有效原文支持的事实才能标 supported
            has_verified = any(ok for _, _, ok in verified_refs)
            if fact.assertion_type == "not_found" or not fact.evidence_refs:
                extraction_status = "unsupported"
            elif has_verified:
                extraction_status = "supported"
            else:
                extraction_status = "needs_review"  # 有引用但 quote 未通过校验

            fact_id = f"fact-{uuid.uuid4().hex[:14]}"
            locator = verified_refs[0][1].source_locator_json if verified_refs else None
            source_name = material.source_name

            db_fact = ExtractedFact(
                run_id=result.run_id, project_id=project_id,
                material_id=material.id,
                chunk_id=(verified_refs[0][1].chunk_id if verified_refs else ""),
                field_key=fact.field_key,
                raw_value=fact.raw_value or "",
                normalized_value=_normalize_for_compare(fact.normalized_value),
                unit=fact.unit, confidence=fact.confidence,
                fact_id=fact_id, fact_type=fact.fact_type,
                field_label=fact.field_label or fact.field_key,
                assertion_type=fact.assertion_type,
                extraction_status=extraction_status,
                parser_source="model", extraction_run_id=result.run_id,
                quote=(verified_refs[0][0].quote if verified_refs else ""),
                source_locator_json=locator, source_name=source_name,
                created_at=datetime.now(timezone.utc),
                ai_original_json=json.dumps(fact.model_dump(), ensure_ascii=False, default=str),
            )
            self.db.add(db_fact)
            await self.db.flush()
            result.facts_created += 1
            result.by_assertion[fact.assertion_type] = result.by_assertion.get(fact.assertion_type, 0) + 1

            for ref, chunk, quote_ok in verified_refs:
                evidence_id = f"ev-{uuid.uuid4().hex[:14]}"
                self.db.add(EvidenceItem(
                    evidence_id=evidence_id, fact_id=fact_id,
                    project_id=project_id, material_id=material.id,
                    chunk_id=chunk.chunk_id, source_name=source_name,
                    quote=ref.quote,
                    original_text=chunk.original_text,  # 后端材料原文
                    source_locator=chunk.source_locator_json,
                    verification_status="verified" if quote_ok else "unverified",
                ))
                result.evidence_created += 1

        # 更新运行记录
        result.duration_ms = int((time.perf_counter() - t0) * 1000)
        ai_run.status = "completed"
        ai_run.success = True
        ai_run.model = result.model
        ai_run.calls = result.calls
        ai_run.prompt_tokens = result.prompt_tokens
        ai_run.completion_tokens = result.completion_tokens
        ai_run.total_tokens = result.total_tokens
        ai_run.finished_at = datetime.now(timezone.utc)
        ai_run.result_json = json.dumps({
            "facts_created": result.facts_created,
            "evidence_created": result.evidence_created,
            "by_assertion": result.by_assertion,
        }, ensure_ascii=False)
        await self.db.commit()
        return result

    async def add_program_facts(
        self,
        *,
        material: Material,
        parse_result: ParseResult,
        project_id: str,
    ) -> int:
        """从确定性解析器结果生成 program-sourced 事实（不调用模型）。

        配置/代码的确定性事实优先由程序给出，模型负责语义补充。
        只对能明确定位的字段生成，避免把整段文本当作事实。
        """
        created = 0
        for sc in parse_result.chunks:
            loc = sc.source_locator or {}
            field_path = loc.get("field_path") or loc.get("symbol") or ""
            original_key = loc.get("original_key") or ""
            raw = sc.content.strip()
            if not field_path or not raw:
                continue
            # 只处理看起来像“键: 值”的短片段，避免把长代码/长文本当事实
            if len(raw) > 160 or ":" not in raw and "=" not in raw:
                continue
            fact_id = f"fact-{uuid.uuid4().hex[:14]}"
            self.db.add(ExtractedFact(
                run_id=f"program-{parse_result.parser_version}", project_id=project_id,
                material_id=material.id, chunk_id=sc.chunk_id,
                field_key=field_path.split("@")[0].split(".")[-1],
                raw_value=raw[:200], normalized_value=None, unit=None, confidence=1.0,
                fact_id=fact_id, fact_type="training_parameter",
                field_label=original_key or field_path,
                assertion_type="explicit", extraction_status="supported",
                parser_source="program", extraction_run_id=f"program-{parse_result.parser_version}",
                quote=raw[:200], source_locator_json=json.dumps(sc.source_locator, ensure_ascii=False),
                source_name=material.source_name,
                created_at=datetime.now(timezone.utc),
            ))
            created += 1
        await self.db.flush()
        return created
