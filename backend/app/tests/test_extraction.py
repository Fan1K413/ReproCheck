"""事实抽取服务测试（协议级 mock，验证校验链路而非真实模型连通性）。

覆盖：chunk_id 存在性校验 / quote 逐字校验 / assertion_type 区分 /
证据落库原文来自后端 / 无 Key 不伪造 / not_found 处理。
"""
from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import AppError
from app.llm import LLMService
from app.models import ExtractedFact, Material, Project, SourceChunk
from app.models.stage2 import EvidenceItem
from app.schemas.parsing import (
    ConfigLocator,
    ParseResult,
    ParseStatus,
    SourceChunk as SourceChunkSchema,
)
from app.services.extraction_service import ExtractionService


def _mk(payload: dict, model="qwen-plus"):
    return httpx.Response(200, json={
        "model": model,
        "choices": [{"message": {"role": "assistant",
                                 "content": json.dumps(payload, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 40, "total_tokens": 140},
    }, request=httpx.Request("POST", "https://mock/v1/chat/completions"))


@pytest.mark.asyncio
async def test_extract_with_verified_evidence(session_fixture, monkeypatch):
    project = Project(id="p1", name="test")
    material = Material(id="m1", project_id="p1", source_name="config.yaml",
                        material_type="yaml", raw_text="")
    chunk = SourceChunk(
        id=1, material_id="m1", chunk_id="cfg_001", chunk_index=0,
        original_text="learning_rate: 0.001", locator_type="yaml",
        project_id="p1", material_type="yaml", content_hash="abc",
        parser_version="config-v1",
        source_locator_json=json.dumps(ConfigLocator(
            file_path="config.yaml", field_path="learning_rate", original_key="learning_rate"
        ).model_dump()),
    )
    session_fixture.add_all([project, material, chunk])
    await session_fixture.commit()

    payload = {"facts": [{
        "fact_type": "training_parameter", "field_key": "learning_rate",
        "field_label": "学习率", "raw_value": "0.001", "normalized_value": 0.001,
        "unit": None, "assertion_type": "explicit",
        "evidence_refs": [{"chunk_id": "cfg_001", "quote": "learning_rate: 0.001"}],
        "confidence": 0.95,
    }]}
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk(payload))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")

    parse_result = ParseResult(
        material_id="m1", material_type="yaml", parser_version="config-v1",
        status="completed", chunks=[],
    )
    svc = ExtractionService(session_fixture, llm=llm)
    ex = await svc.extract(material=material, parse_result=parse_result,
                           project_id="p1", task_id="t1")

    assert ex.facts_created == 1
    assert ex.evidence_created == 1
    assert ex.evidence_rejected == 0
    assert ex.by_assertion["explicit"] == 1

    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    assert len(facts) == 1
    assert facts[0].extraction_status == "supported"
    assert facts[0].parser_source == "model"
    evs = (await session_fixture.execute(select(EvidenceItem))).scalars().all()
    assert len(evs) == 1
    assert evs[0].verification_status == "verified"
    # 证据原文来自后端材料，不是模型生成
    assert evs[0].original_text == "learning_rate: 0.001"


@pytest.mark.asyncio
async def test_reject_fabricated_chunk_id(session_fixture, monkeypatch):
    project = Project(id="p2", name="test")
    material = Material(id="m2", project_id="p2", source_name="a.yaml", material_type="yaml")
    chunk = SourceChunk(id=2, material_id="m2", chunk_id="real_001", chunk_index=0,
                        original_text="batch_size: 32", locator_type="yaml")
    session_fixture.add_all([project, material, chunk])
    await session_fixture.commit()

    payload = {"facts": [{
        "fact_type": "training_parameter", "field_key": "batch_size",
        "raw_value": "32", "normalized_value": 32, "assertion_type": "explicit",
        "evidence_refs": [{"chunk_id": "FAKE_999", "quote": "batch_size: 32"}],
        "confidence": 0.9,
    }]}
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk(payload))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    parse_result = ParseResult(material_id="m2", material_type="yaml",
                               parser_version="v1", status="completed", chunks=[])
    ex = await ExtractionService(session_fixture, llm=llm).extract(
        material=material, parse_result=parse_result, project_id="p2", task_id="t2")

    # 虚构 chunk 被拒绝，事实保留但无有效证据 → needs_review
    assert ex.evidence_rejected == 1
    assert ex.evidence_created == 0
    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    assert facts[0].extraction_status == "needs_review"


@pytest.mark.asyncio
async def test_fake_quote_marked_unverified(session_fixture, monkeypatch):
    project = Project(id="p3", name="test")
    material = Material(id="m3", project_id="p3", source_name="a.yaml", material_type="yaml")
    chunk = SourceChunk(id=3, material_id="m3", chunk_id="real_001", chunk_index=0,
                        original_text="epochs: 100", locator_type="yaml")
    session_fixture.add_all([project, material, chunk])
    await session_fixture.commit()

    payload = {"facts": [{
        "fact_type": "training_parameter", "field_key": "epochs",
        "raw_value": "100", "normalized_value": 100, "assertion_type": "explicit",
        # quote 与原文不符（原文是 epochs: 100）
        "evidence_refs": [{"chunk_id": "real_001", "quote": "epochs: 999"}],
        "confidence": 0.9,
    }]}
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk(payload))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    parse_result = ParseResult(material_id="m3", material_type="yaml",
                               parser_version="v1", status="completed", chunks=[])
    ex = await ExtractionService(session_fixture, llm=llm).extract(
        material=material, parse_result=parse_result, project_id="p3", task_id="t3")

    evs = (await session_fixture.execute(select(EvidenceItem))).scalars().all()
    assert evs[0].verification_status == "unverified"
    assert ex.facts_created == 1


@pytest.mark.asyncio
async def test_not_found_and_inferred_distinguished(session_fixture, monkeypatch):
    project = Project(id="p4", name="test")
    material = Material(id="m4", project_id="p4", source_name="a.yaml", material_type="yaml")
    chunk = SourceChunk(id=4, material_id="m4", chunk_id="real_001", chunk_index=0,
                        original_text="batch_size: 64", locator_type="yaml")
    session_fixture.add_all([project, material, chunk])
    await session_fixture.commit()

    payload = {"facts": [
        {"fact_type": "training_parameter", "field_key": "learning_rate",
         "raw_value": "", "assertion_type": "not_found", "evidence_refs": [], "confidence": 0.0},
        {"fact_type": "model", "field_key": "backbone",
         "raw_value": "ResNet", "assertion_type": "inferred",
         "evidence_refs": [{"chunk_id": "real_001", "quote": "batch_size: 64"}], "confidence": 0.4},
    ]}
    llm = LLMService(client=httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: _mk(payload))))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    parse_result = ParseResult(material_id="m4", material_type="yaml",
                               parser_version="v1", status="completed", chunks=[])
    ex = await ExtractionService(session_fixture, llm=llm).extract(
        material=material, parse_result=parse_result, project_id="p4", task_id="t4")

    assert ex.by_assertion.get("not_found") == 1
    assert ex.by_assertion.get("inferred") == 1
    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    nf = next(f for f in facts if f.field_key == "learning_rate")
    assert nf.extraction_status == "unsupported"
    assert nf.raw_value == ""


@pytest.mark.asyncio
async def test_no_key_fails_without_fake_facts(session_fixture, monkeypatch):
    project = Project(id="p5", name="test")
    material = Material(id="m5", project_id="p5", source_name="a.yaml", material_type="yaml")
    chunk = SourceChunk(id=5, material_id="m5", chunk_id="real_001", chunk_index=0,
                        original_text="x: 1", locator_type="yaml")
    session_fixture.add_all([project, material, chunk])
    await session_fixture.commit()

    monkeypatch.setattr(settings, "llm_api_key", "")
    parse_result = ParseResult(material_id="m5", material_type="yaml",
                               parser_version="v1", status="completed", chunks=[])
    with pytest.raises(AppError) as ei:
        await ExtractionService(session_fixture, llm=LLMService()).extract(
            material=material, parse_result=parse_result, project_id="p5", task_id="t5")
    assert ei.value.code == "LLM_KEY_NOT_CONFIGURED"
    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    assert len(facts) == 0  # 无 Key 不产生任何事实


@pytest.mark.asyncio
async def test_program_fact_has_verified_source_evidence(session_fixture):
    from app.schemas.parsing import SourceChunk as ParsedSourceChunk

    project = Project(id="p-program", name="program evidence")
    material = Material(id="m-program", project_id="p-program", source_name="config.yaml", material_type="yaml")
    session_fixture.add_all([project, material])
    await session_fixture.commit()
    content = "learning_rate: 0.001"
    parsed = ParsedSourceChunk(
        chunk_id="chunk-program", material_id="m-program", material_type="yaml",
        content=content, content_hash=ParsedSourceChunk.make_hash(content), parser_version="test-v1",
        source_locator={"locator_type": "yaml", "field_path": "learning_rate", "original_key": "learning_rate"},
    )
    result = ParseResult(material_id="m-program", material_type="yaml", parser_version="test-v1",
                         status="completed", chunks=[parsed])
    created = await ExtractionService(session_fixture).add_program_facts(
        material=material, parse_result=result, project_id="p-program")
    assert created == 1
    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    evidence = (await session_fixture.execute(select(EvidenceItem))).scalars().all()
    assert len(facts) == 1 and len(evidence) == 1
    assert evidence[0].fact_id == facts[0].fact_id
    assert evidence[0].verification_status == "verified"
    assert evidence[0].original_text == content
