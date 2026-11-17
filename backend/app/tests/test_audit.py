"""端到端审计链路测试（协议级 mock，验证程序逻辑正确性）。

覆盖：真实调用链编排 / 两项预设冲突 / 证据关联 / 虚构 chunk_id 拒绝 / 数据库持久化 / run_id 历史查询。
注意：这是对"程序逻辑"的验证；真实模型连通性需配置真实 Key 后另行验证。
"""
from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.core.errors import AppError
from app.llm import llm_service
from app.models import AIRun, AuditFinding, Evidence, ExtractedFact
from app.services.audit_service import AuditService


def _mk_response(payload: dict, model="qwen-plus"):
    return httpx.Response(
        200,
        json={
            "model": model,
            "choices": [{"message": {"role": "assistant",
                                     "content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        },
        request=httpx.Request("POST", "https://mock/v1/chat/completions"),
    )


def paper_facts(cid="paper_chunk_001"):
    return {"facts": [
        {"field_key": "batch_size", "raw_value": "64", "normalized_value": 64,
         "unit": None, "evidence_chunk_id": cid, "confidence": 0.98},
        {"field_key": "learning_rate", "raw_value": "0.001", "normalized_value": 0.001,
         "unit": None, "evidence_chunk_id": cid, "confidence": 0.97},
        {"field_key": "epochs", "raw_value": "100", "normalized_value": 100,
         "unit": None, "evidence_chunk_id": cid, "confidence": 0.99},
        {"field_key": "optimizer", "raw_value": "AdamW", "normalized_value": "AdamW",
         "unit": None, "evidence_chunk_id": cid, "confidence": 0.98},
    ]}


def config_facts():
    return {"facts": [
        {"field_key": "batch_size", "raw_value": "32", "normalized_value": 32,
         "unit": None, "evidence_chunk_id": "config_chunk_001", "confidence": 0.99},
        {"field_key": "learning_rate", "raw_value": "0.0001", "normalized_value": 0.0001,
         "unit": None, "evidence_chunk_id": "config_chunk_002", "confidence": 0.99},
        {"field_key": "epochs", "raw_value": "100", "normalized_value": 100,
         "unit": None, "evidence_chunk_id": "config_chunk_003", "confidence": 0.99},
        {"field_key": "optimizer", "raw_value": "AdamW", "normalized_value": "AdamW",
         "unit": None, "evidence_chunk_id": "config_chunk_004", "confidence": 0.99},
    ]}


def risks():
    return {"explanations": [
        {"finding_id": "batch_size_conflict", "field_key": "batch_size",
         "severity": "high", "title": "Batch Size 在论文与配置中不一致",
         "explanation": "论文与配置材料的 batch size 不同，可能影响复现。",
         "suggested_fix": "核实以哪个数值为准并统一。"},
        {"finding_id": "learning_rate_conflict", "field_key": "learning_rate",
         "severity": "high", "title": "Learning Rate 在论文与配置中不一致",
         "explanation": "学习率相差一个数量级，可能导致结果无法复现。",
         "suggested_fix": "确认最终采用的学习率。"},
    ]}


@pytest.mark.asyncio
async def test_end_to_end_two_conflicts(session_fixture, monkeypatch):
    state = {"n": 0}

    def handler(req):
        state["n"] += 1
        if state["n"] == 1:
            return _mk_response(paper_facts())
        if state["n"] == 2:
            return _mk_response(config_facts())
        return _mk_response(risks())

    # 直接构造注入 mock client 的 LLMService
    from app.llm import LLMService
    llm = LLMService(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(settings, "llm_api_key", "sk-test-key")
    svc = AuditService(session_fixture, llm=llm)

    result = await svc.run_audit(
        project_name="端到端测试", material_a_text=None,
        material_b_text=None, use_default_materials=True,
    )
    assert result.status == "completed"
    assert result.llm_meta.calls == 3

    comp = {c.field_key: c.status for c in result.comparisons}
    assert comp["batch_size"] == "conflict"
    assert comp["learning_rate"] == "conflict"
    assert comp["epochs"] == "consistent"
    assert comp["optimizer"] == "consistent"

    assert len(result.findings) == 2
    # 证据原文必须来自后端材料
    ev_texts = {e.original_text for f in result.findings for e in f.evidence}
    assert "研究实验使用 Batch Size 为 64" in " ".join(ev_texts)
    assert "batch_size: 32" in ev_texts

    # 数据库持久化
    runs = (await session_fixture.execute(select(AIRun))).scalars().all()
    findings = (await session_fixture.execute(select(AuditFinding))).scalars().all()
    facts = (await session_fixture.execute(select(ExtractedFact))).scalars().all()
    evidences = (await session_fixture.execute(select(Evidence))).scalars().all()
    assert len(runs) == 1 and runs[0].success is True
    assert len(findings) == 2
    assert len(facts) == 8
    assert len(evidences) == 4

    # run_id 历史查询
    from app.services.audit_service import get_audit_result_from_db
    hist = await get_audit_result_from_db(session_fixture, result.run_id)
    assert hist is not None and hist["run_id"] == result.run_id


@pytest.mark.asyncio
async def test_reject_fabricated_chunk_id(session_fixture, monkeypatch):
    from app.llm import LLMService
    monkeypatch.setattr(settings, "llm_api_key", "sk-test-key")

    def handler(req):
        # 第一份材料抽取时返回虚构 chunk_id
        return _mk_response(paper_facts(cid="fabricated_chunk_999"))

    llm = LLMService(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    svc = AuditService(session_fixture, llm=llm)
    with pytest.raises(AppError) as ei:
        await svc.run_audit(
            project_name="虚构证据测试", material_a_text=None,
            material_b_text=None, use_default_materials=True,
        )
    assert ei.value.code == "EVIDENCE_VALIDATION_FAILED"


@pytest.mark.asyncio
async def test_no_key_reports_failure_not_fake_success(session_fixture, monkeypatch):
    from app.llm import LLMService
    monkeypatch.setattr(settings, "llm_api_key", "")
    svc = AuditService(session_fixture, llm=LLMService())
    with pytest.raises(AppError) as ei:
        await svc.run_audit(
            project_name="无 Key 测试", material_a_text=None,
            material_b_text=None, use_default_materials=True,
        )
    assert ei.value.code == "LLM_KEY_NOT_CONFIGURED"
