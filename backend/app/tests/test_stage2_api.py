"""第二阶段 API 集成测试：材料上传→解析→事实→证据→修订→概览全链路。

用协议级 mock LLM 验证程序链路，真实模型连通性另行标注。
"""
from __future__ import annotations

import json

import httpx
import pytest

from app.core.config import settings
from app.models import Project
from app.services.task_service import TaskService

PAPER = "研究使用 Learning Rate 0.001, Batch Size 64, Epochs 100, 优化器 AdamW。"


def _mk(payload: dict):
    return httpx.Response(200, json={
        "model": "qwen-plus",
        "choices": [{"message": {"role": "assistant",
                                 "content": json.dumps(payload, ensure_ascii=False)}}],
        "usage": {"prompt_tokens": 120, "completion_tokens": 60, "total_tokens": 180},
    }, request=httpx.Request("POST", "https://mock/v1/chat/completions"))


def extract_payload(chunk_ids: list[str]):
    return {"facts": [{
        "fact_type": "training_parameter", "field_key": "learning_rate",
        "field_label": "学习率", "raw_value": "0.001", "normalized_value": 0.001,
        "unit": None, "assertion_type": "explicit",
        "evidence_refs": [{"chunk_id": cid, "quote": "Learning Rate 0.001"} for cid in chunk_ids],
        "confidence": 0.95,
    }]}


@pytest.mark.asyncio
async def test_full_pipeline_text_material(client, monkeypatch):
    """上传 TXT → 解析 → 抽取 → 事实 → 证据 → 修订 → 概览。"""
    # 项目
    r = await client.post("/api/v1/projects", json={
        "name": "第二阶段测试", "domain": "ML", "paper_title": "合成", "description": "test"
    })
    assert r.status_code == 200
    project_id = r.json()["data"]["id"]

    # 上传
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": project_id},
        files={"file": ("paper.txt", PAPER.encode("utf-8"), "text/plain")},
    )
    assert r.status_code == 200
    material_id = r.json()["data"]["material_id"]
    assert r.json()["data"]["parse_status"] == "uploaded"

    # mock LLM 并解析
    from app.llm import LLMService
    captured = {"ids": []}

    def handler(req):
        body = json.loads(req.content)
        # 从 prompt 中提取 chunk_id
        import re
        ids = re.findall(r'chunk_id="([^"]+)"', body["messages"][1]["content"])
        captured["ids"] = ids
        return _mk(extract_payload(ids[:1]))

    llm = LLMService(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    import app.services.task_service as ts_module
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    monkeypatch.setattr(ts_module.TaskService, "__init__",
                        lambda self, db, extraction=None: _init_with_llm(self, db, llm))

    r = await client.post(f"/api/v1/materials/{material_id}/parse")
    assert r.status_code == 200, r.text
    task = r.json()["data"]
    assert task["status"] == "completed", task
    assert task["model_calls"] == 1
    assert task["total_tokens"] == 180
    assert captured["ids"], "prompt 中应有 chunk_id"

    # 事实
    r = await client.get(f"/api/v1/facts?project_id={project_id}")
    assert r.status_code == 200
    facts = r.json()["data"]["items"]
    assert len(facts) >= 1
    fact = next(f for f in facts if f["field_key"] == "learning_rate")
    assert fact["assertion_type"] == "explicit"
    assert fact["extraction_status"] == "supported"
    assert fact["evidence"][0]["verification_status"] == "verified"

    # 证据图谱只输出有事实、证据、文本块、材料实体支撑的关系
    r = await client.get(f"/api/v1/projects/{project_id}/evidence-graph")
    assert r.status_code == 200, r.text
    graph = r.json()["data"]
    assert graph["project_id"] == project_id
    assert graph["counts"] == {"facts": 1, "evidence": 1, "materials": 1, "source_chunks": 1, "edges": 3}
    fact_node = next(node for node in graph["nodes"] if node["type"] == "fact")
    assert fact_node["value"] == "0.001"
    node_ids = {node["id"] for node in graph["nodes"]}
    assert {"fact:" + fact["fact_id"], "material:" + material_id}.issubset(node_ids)
    assert all(edge["source"] in node_ids and edge["target"] in node_ids for edge in graph["edges"])
    evidence_node = next(node for node in graph["nodes"] if node["type"] == "evidence")
    assert evidence_node["verification_status"] == "verified"

    # 来自其他项目的 ID 必须被隔离依赖拒绝，不得返回图谱数据
    other = await client.post("/api/v1/projects", json={
        "name": "另一项目", "domain": "ML", "paper_title": "隔离", "description": "test"
    })
    other_project_id = other.json()["data"]["id"]
    r = await client.get(f"/api/v1/projects/{other_project_id}/evidence-graph")
    assert r.status_code == 200
    assert r.json()["data"]["nodes"] == []

    # 人工修订留痕
    r = await client.patch(f"/api/v1/facts/{fact['fact_id']}", json={
        "normalized_value": "0.002", "note": "人工核实后修正"
    })
    assert r.status_code == 200
    revised = r.json()["data"]
    assert revised["parser_source"] == "human"
    assert revised["revision_count"] >= 1

    r = await client.get(f"/api/v1/facts/{fact['fact_id']}/revisions")
    assert r.status_code == 200
    revs = r.json()["data"]["items"]
    assert len(revs) >= 1
    assert revs[0]["revision_source"] == "human"

    # 概览（真实聚合）
    r = await client.get(f"/api/v1/projects/{project_id}/parse-overview")
    assert r.status_code == 200
    ov = r.json()["data"]
    assert ov["materials"]["total"] == 1
    assert ov["facts"]["total"] >= 1
    assert ov["facts"]["human_revised"] >= 1
    assert ov["llm"]["total_calls"] == 1

    # 任务查询
    r = await client.get(f"/api/v1/parse-tasks/{task['task_id']}")
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "completed"


def _init_with_llm(self, db, llm):
    from app.services.extraction_service import ExtractionService
    from app.services.material_service import MaterialService
    self.db = db
    self.materials = MaterialService(db)
    self.extraction = ExtractionService(db, llm=llm)


@pytest.mark.asyncio
async def test_no_key_parse_fails_explicitly(client, monkeypatch):
    """无 Key 时解析接口明确失败，不产生假事实。"""
    monkeypatch.setattr(settings, "llm_api_key", "")
    r = await client.post("/api/v1/projects", json={"name": "无Key", "domain": "", "paper_title": "", "description": ""})
    project_id = r.json()["data"]["id"]
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": project_id},
        files={"file": ("a.txt", b"batch_size: 32", "text/plain")},
    )
    material_id = r.json()["data"]["material_id"]
    r = await client.post(f"/api/v1/materials/{material_id}/parse")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "LLM_KEY_NOT_CONFIGURED"
    r = await client.get(f"/api/v1/facts?project_id={project_id}")
    assert r.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_unsupported_format_rejected(client, monkeypatch):
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    r = await client.post("/api/v1/projects", json={"name": "格式", "domain": "", "paper_title": "", "description": ""})
    project_id = r.json()["data"]["id"]
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": project_id},
        files={"file": ("evil.exe", b"MZ\x00", "application/octet-stream")},
    )
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.asyncio
async def test_material_delete_cascades_and_no_orphans(client, monkeypatch):
    """删除材料后，chunks/facts/evidence 不残留孤立记录。"""
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    r = await client.post("/api/v1/projects", json={"name": "删除", "domain": "", "paper_title": "", "description": ""})
    project_id = r.json()["data"]["id"]
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": project_id},
        files={"file": ("a.txt", b"epochs: 5", "text/plain")},
    )
    material_id = r.json()["data"]["material_id"]
    r = await client.delete(f"/api/v1/materials/{material_id}")
    assert r.status_code == 200
    assert "cascaded" in r.json()["data"]
    r = await client.get(f"/api/v1/materials?project_id={project_id}")
    assert r.json()["data"]["total"] == 0
