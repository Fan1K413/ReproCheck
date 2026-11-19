"""独立验收发现的 P2 缺陷回归测试。"""
from __future__ import annotations

import httpx
import pytest

from app.core.config import settings
from app.core.errors import ERROR_STATUS


def test_llm_invalid_key_is_not_user_unauthorized():
    """上游 LLM Key 失效是 502，不应与用户身份 401 混淆。"""
    assert ERROR_STATUS["LLM_INVALID_KEY"] == 502
    assert ERROR_STATUS["UNAUTHORIZED"] == 401


@pytest.mark.asyncio
async def test_start_parse_returns_material_name(client, monkeypatch):
    """POST /materials/{id}/parse 应返回材料名，与 GET /parse-tasks/{id} 一致。"""
    from app.llm import LLMService
    import app.services.task_service as ts_module
    import json

    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    r = await client.post("/api/v1/projects", json={
        "name": "P2回归", "domain": "", "paper_title": "", "description": ""
    })
    pid = r.json()["data"]["id"]
    r = await client.post(
        "/api/v1/materials/upload",
        data={"project_id": pid},
        files={"file": ("paper.txt", b"batch_size: 32", "text/plain")},
    )
    material_id = r.json()["data"]["material_id"]

    captured = {"ids": []}

    def handler(req):
        body = json.loads(req.content)
        import re
        captured["ids"] = re.findall(r'chunk_id="([^"]+)"', body["messages"][1]["content"])
        payload = {"facts": [{
            "fact_type": "training_parameter", "field_key": "batch_size",
            "field_label": "批大小", "raw_value": "32", "normalized_value": 32,
            "unit": None, "assertion_type": "explicit",
            "evidence_refs": [{"chunk_id": cid, "quote": "batch_size: 32"} for cid in captured["ids"][:1]],
            "confidence": 0.9,
        }]}
        return httpx.Response(200, json={
            "model": "qwen-plus",
            "choices": [{"message": {"role": "assistant", "content": json.dumps(payload, ensure_ascii=False)}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
        }, request=httpx.Request("POST", "https://mock/v1/chat/completions"))

    llm = LLMService(client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))

    def _init(self, db, extraction=None):
        from app.services.extraction_service import ExtractionService
        from app.services.material_service import MaterialService
        self.db = db
        self.materials = MaterialService(db)
        self.extraction = ExtractionService(db, llm=llm)

    monkeypatch.setattr(ts_module.TaskService, "__init__", _init)
    r = await client.post(f"/api/v1/materials/{material_id}/parse")
    assert r.status_code == 200, r.text
    assert r.json()["data"]["material_name"] == "paper.txt"

    task_id = r.json()["data"]["task_id"]
    r2 = await client.get(f"/api/v1/parse-tasks/{task_id}")
    assert r2.status_code == 200
    assert r2.json()["data"]["material_name"] == "paper.txt"
