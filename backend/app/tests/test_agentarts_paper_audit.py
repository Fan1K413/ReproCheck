from pathlib import Path

import fitz
import httpx
import pytest

from app.core.config import settings
from app.core.errors import AppError
from app.services import agentarts_runtime, material_service
from app.services.paper_audit import ClaimIn, verify_claim

FIXTURES = Path(__file__).resolve().parents[2] / "test_materials" / "agentarts"
CONFIG = {"id": "config", "name": "train.yaml", "sha256": "c",
          "leaves": [{"original_key": "batch_size", "original_path": "train.batch_size", "raw_value": "32"}]}
CODE = {"id": "code", "name": "train.py", "sha256": "d", "source": "import random\nrandom.seed(42)\n"}
METRICS = {
    "id": "metrics", "name": "counts.json", "sha256": "m",
    "metrics": {"split": "test", "average": "binary", "positive_label": 1,
                "counts": {"tp": 45, "fp": 5, "fn": 15, "correct": 92, "total": 100}},
}


@pytest.mark.parametrize(("kind", "field", "quote", "artifact", "status", "observed"), [
    ("config", "batch_size", "Batch size = 32.", CONFIG, "VERIFIED", 32),
    ("config", "batch_size", "Batch size = 64.", CONFIG, "CONFLICTING", 32),
    ("config", "batch_size", "batch_size: 32", None, "INSUFFICIENT_EVIDENCE", None),
    ("config", "batch_size", "批大小为32", CONFIG, "VERIFIED", 32),
    ("config", "batch_size", "batch_size = 0.32e2", CONFIG, "VERIFIED", 32),
    ("config", "learning_rate", "Learning rate = 0.001.", CONFIG, "INSUFFICIENT_EVIDENCE", None),
    ("config", "batch_size", "batch_size=32", {**CONFIG, "leaves": CONFIG["leaves"] * 2}, "INSUFFICIENT_EVIDENCE", None),
    ("code", "seed", "random seed = 42.", CODE, "PARTIALLY_VERIFIED", 42),
    ("code", "seed", "seed=7", CODE, "CONFLICTING", 42),
    ("code", "seed", "seed=42", None, "INSUFFICIENT_EVIDENCE", None),
    ("code", "seed", "seed=42", {**CODE, "source": "random.seed(x)"}, "INSUFFICIENT_EVIDENCE", None),
    ("code", "seed", "seed=42", {**CODE, "source": "random.seed(42"}, "INSUFFICIENT_EVIDENCE", None),
    ("metrics", "f1", "split=test; positive_label=1; F1 = 0.92.", METRICS, "CONFLICTING", 0.818182),
    ("metrics", "f1", "split=test; positive_label=1; F1 = 81.8%", METRICS, "VERIFIED", 0.818182),
    ("metrics", "f1", "split=validation; positive_label=1; F1 = 0.92", METRICS, "UNVERIFIABLE", None),
    ("metrics", "f1", "split=test; positive_label=0; F1 = 0.92", METRICS, "UNVERIFIABLE", None),
    ("metrics", "f1", "split=test; positive_label=1; macro F1 = 0.92", METRICS, "UNVERIFIABLE", None),
    ("metrics", "f1", "split=test; F1 = 0.92", METRICS, "INSUFFICIENT_EVIDENCE", None),
    ("metrics", "f1", "F1 = 0.92", None, "INSUFFICIENT_EVIDENCE", None),
    ("metrics", "accuracy", "split=test; accuracy = 92%", METRICS, "VERIFIED", 0.92),
    ("metrics", "accuracy", "split=test; accuracy = 99%", METRICS, "CONFLICTING", 0.92),
    ("metrics", "accuracy", "accuracy = 92%", METRICS, "INSUFFICIENT_EVIDENCE", None),
])
def test_labeled_findings(kind, field, quote, artifact, status, observed):
    paper = {"id": "paper", "name": "paper.pdf", "sha256": "p",
             "chunks": [{"chunk_id": "p1", "text": quote, "locator": {"viewer_page_number": 3}}]}
    snapshot = {"paper": paper}
    if artifact:
        snapshot[kind] = artifact
    result = verify_claim(snapshot, kind, ClaimIn(field=field, chunk_id="p1", quote=quote))
    assert result["status"] == status
    assert result["observed"] == observed
    assert result["evidence"][0]["text"] == quote
    assert result["evidence"][0]["locator"] == {"viewer_page_number": 3}


@pytest.mark.parametrize(("field", "chunk_id", "quote", "code"), [
    ("batch_size", "invented", "batch size = 32", "AUDIT_INVALID_REFERENCE"),
    ("batch_size", "real", "batch size = 33", "AUDIT_INVALID_REFERENCE"),
    ("learning_rate", "real", "batch size = 32", "AUDIT_INVALID_VALUE"),
    ("batch_size", "real", "batch size = 32 and batch size = 64", "AUDIT_INVALID_VALUE"),
    ("batch_size", "real", "batch size = 32%", "AUDIT_INVALID_VALUE"),
    ("batch_size", "real", "batch size = 32.4", "AUDIT_INVALID_VALUE"),
    ("batch_size", "real", "example: batch size = 32", "AUDIT_INVALID_VALUE"),
    ("f1", "real", "batch size = 32", "AUDIT_WRONG_TOOL"),
])
def test_rejects_invalid_references_and_values(field, chunk_id, quote, code):
    text = "batch size = 32 and batch size = 64. Also batch size = 32% and example: batch size = 32.4."
    paper = {"id": "paper", "name": "paper.pdf", "sha256": "p",
             "chunks": [{"chunk_id": "real", "text": text, "locator": {}}]}
    with pytest.raises(AppError) as exc:
        verify_claim({"paper": paper}, "config", ClaimIn(field=field, chunk_id=chunk_id, quote=quote))
    assert exc.value.code == code


async def _register(client, email):
    response = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "Testing_1234!", "display_name": "Test", "org_name": "Test group",
    })
    assert response.status_code == 200, response.text
    return {"Authorization": f'Bearer {response.json()["data"]["token"]}'}


async def _upload(client, auth, project_id, filename, payload):
    response = await client.post("/api/v1/materials/upload", headers=auth,
                                 data={"project_id": project_id}, files={"file": (filename, payload)})
    assert response.status_code == 200, response.text
    return response.json()["data"]["material_id"]


@pytest.mark.asyncio
async def test_audit_and_review_through_documented_sse_and_callbacks(client, monkeypatch, tmp_path):
    monkeypatch.setattr(material_service, "STORAGE_ROOT", tmp_path)
    monkeypatch.setattr(settings, "agentarts_invoke_url", "https://example.myhuaweicloud.com/runtimes/agent-arts-test/invocations")
    monkeypatch.setattr(settings, "agentarts_api_key", "unit-test")
    monkeypatch.setattr(settings, "agentarts_tool_secret", "c" * 32)
    monkeypatch.setattr(settings, "agentarts_workflow_version", "audit-test-v1")
    auth = await _register(client, "audit@example.com")
    outsider = await _register(client, "outsider@example.net")
    created = await client.post("/api/v1/projects", headers=auth, json={"name": "AgentArts"})
    project_id = created.json()["data"]["id"]
    endpoint = f"/api/v1/projects/{project_id}/paper-audits"
    tools = "/api/v1/agentarts/tools"

    with fitz.open() as doc:
        page = doc.new_page()
        page.insert_text((60, 70), "Batch size = 64.")
        page.insert_text((60, 105), "split=test; positive_label=1; F1 = 0.92.")
        paper_bytes = doc.tobytes()
    paper = await _upload(client, auth, project_id, "paper.pdf", paper_bytes)
    config = await _upload(client, auth, project_id, "training.yaml", (FIXTURES / "training.yaml").read_bytes())
    counts = await _upload(client, auth, project_id, "test-counts.json", (FIXTURES / "test-counts.json").read_bytes())
    posted_modes = []
    used_tokens = []
    real_client = httpx.AsyncClient
    failure = ""

    async def handler(request):
        import json

        assert request.headers["authorization"] == "Bearer unit-test"
        assert request.headers["x-invoke-mode"] == "published"
        inputs = json.loads(request.content)["inputs"]
        used_tokens.append(inputs)
        assert inputs["run_id"] == request.headers["x-hw-agentarts-session-id"]
        if failure == "http":
            return httpx.Response(401)
        assert (await client.post(f"{tools}/context", json={**inputs, "tool_token": "0" * 64})).status_code == 401
        response = await client.post(f"{tools}/context", json=inputs)
        assert response.status_code == 200, response.text
        context = response.json()
        posted_modes.append(context["mode"])
        claims = context["review_claims"]
        if context["mode"] == "initial":
            chunks = context["chunks"]
            claims = [
                {"field": field, "quote": quote,
                 "chunk_id": next(chunk["chunk_id"] for chunk in chunks if quote in chunk["text"])}
                for field, quote in (
                    ("batch_size", "Batch size = 64"),
                    ("f1", "split=test; positive_label=1; F1 = 0.92"),
                )
            ]
        assert len(claims) == (2 if context["mode"] == "initial" else 1)
        check_ids = []
        for claim in claims:
            kind = "metrics" if claim["field"] == "f1" else "config"
            response = await client.post(f"{tools}/verify/{kind}", json={**inputs, "claim": claim})
            assert response.status_code == 200, response.text
            receipt = response.json()["check_id"]
            check_ids.append(receipt)
            replay = await client.post(f"{tools}/verify/{kind}", json={**inputs, "claim": claim})
            assert replay.json()["check_id"] == receipt
        assert (await client.post(f"{tools}/finish", json={**inputs, "check_ids": []})).status_code == 422
        if failure != "no-callback":
            final = await client.post(f"{tools}/finish", json={**inputs, "check_ids": check_ids})
            assert final.json()["accepted"]
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, text=(
            'data: {"event":"workflow_started"}\n\n'
            'data: {"event":"node_finished","data":{"node_type":"Plugin","node_name":"核验材料"}}\n\n'
            'data: {"event":"workflow_finished"}\n\n'
            'data: {"event":"end"}\n\n'
        ))

    monkeypatch.setattr(agentarts_runtime.httpx, "AsyncClient",
                        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))

    data = {"paper": paper, "config": config, "allow_cloud_processing": True}
    assert (await client.post(endpoint, headers=auth, json={**data, "allow_cloud_processing": False})).status_code == 422
    first_response = await client.post(endpoint, headers=auth, json=data)
    assert first_response.status_code == 200, first_response.text
    first = first_response.json()["data"]
    assert first["status"] == "completed", first
    checks = {item["claim"]["field"]: item for item in first["result"]["findings"]}
    assert checks["batch_size"]["status"] == "CONFLICTING"
    assert checks["batch_size"]["evidence"][0]["locator"]["viewer_page_number"] == 1
    assert checks["f1"]["status"] == "INSUFFICIENT_EVIDENCE"
    assert first["result"]["workflow_steps"] == [{"node_type": "Plugin", "name": "核验材料"}]
    assert (await client.get(f'{endpoint}/{first["id"]}', headers=outsider)).status_code == 404

    reviewed = await client.post(endpoint, headers=auth, json={
        **data, "metrics": counts, "parent_id": first["id"],
    })
    assert reviewed.status_code == 200, reviewed.text
    second = reviewed.json()["data"]
    assert second["status"] == "completed", second
    changed = {item["claim"]["field"]: item for item in second["result"]["findings"]}
    assert changed["batch_size"] == checks["batch_size"]
    assert changed["f1"]["status"] == "CONFLICTING"
    assert changed["f1"]["observed"] == 0.818182
    assert changed["f1"]["id"] == checks["f1"]["id"]
    assert second["result"]["checked_count"] == 1
    assert posted_modes == ["initial", "review"]
    assert (await client.post(f"{tools}/context", json=used_tokens[0])).status_code == 404
    assert (await client.post(f"{tools}/context", json={
        **used_tokens[0], "run_id": second["id"],
    })).status_code == 401

    history = (await client.get(endpoint, headers=auth)).json()["data"]
    assert [item["id"] for item in history["items"]] == [second["id"], first["id"]]
    assert all(item["result"] is None for item in history["items"])
    stored = (await client.get(f'{endpoint}/{first["id"]}', headers=auth)).json()["data"]
    assert stored == first

    for failure, code in (("http", "AGENTARTS_HTTP_ERROR"), ("no-callback", "AGENTARTS_RESULTS_MISSING")):
        failed = (await client.post(endpoint, headers=auth, json=data)).json()["data"]
        assert failed["status"] == "failed"
        assert failed["result"]["error_code"] == code
        assert "findings" not in failed["result"]
