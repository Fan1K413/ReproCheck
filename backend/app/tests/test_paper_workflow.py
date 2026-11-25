"""新入口的回归测试使用独立测试数据库、材料目录与模拟模型。"""
from __future__ import annotations

from shutil import rmtree
from types import SimpleNamespace
from uuid import uuid4

import pymupdf
import pytest
from sqlalchemy import select

from app.core.config import settings
from app.modelhub.bridge import TaskLLM
from app.modelhub.gateway import model_gateway
from app.models import Material, Project
from app.models.modelhub import ModelCredential, ModelProfile
from app.schemas.parsing import FactsExtractionV2
from app.services import material_service


def _pdf(*pages: str) -> bytes:
    with pymupdf.open() as document:
        for content in pages:
            page = document.new_page()
            if content:
                page.insert_text((72, 72), content)
        return document.tobytes()


async def _register(client, name: str = "reader") -> dict[str, str]:
    response = await client.post("/api/v1/auth/register", json={
        "email": f"{name}@example.test", "password": "ordinary-research-password",
    })
    assert response.is_success, response.text
    return {"Authorization": "Bearer " + response.json()["data"]["token"]}


@pytest.fixture(autouse=True)
def isolated_uploads(monkeypatch):
    test_root = material_service.STORAGE_ROOT.parent.resolve()
    directory = (test_root / f"paper-test-{uuid4().hex}").resolve()
    assert directory.parent == test_root
    directory.mkdir(parents=True)
    monkeypatch.setattr(material_service, "STORAGE_ROOT", directory)
    monkeypatch.setattr(settings, "llm_api_key", "")
    yield
    rmtree(directory)


@pytest.mark.asyncio
async def test_upload_read_check_and_view_report_without_ai(client, session_fixture):
    headers = await _register(client)
    source = _pdf("Abstract\nAn experiment on a public dataset.", "Results\nAccuracy 0.91")
    upload = await client.post("/api/v1/papers", headers=headers, files={
        "file": ("comparison.pdf", source, "application/pdf"),
    })
    assert upload.status_code == 201, upload.text
    paper = upload.json()["data"]
    reading_link = paper["next_action"]["href"]
    repeated = await client.post("/api/v1/papers", headers=headers, files={
        "file": ("same-paper.pdf", source, "application/pdf"),
    })
    assert repeated.status_code == 200
    assert repeated.json()["data"]["id"] == paper["id"]
    assert len(list(await session_fixture.scalars(select(Project)))) == 1

    reading = (await client.get(reading_link, headers=headers, params={"page": 2})).json()["data"]
    assert reading["reading"]["page_count"] == 2
    assert "public dataset" in reading["reading"]["abstract_excerpt"]
    assert "Accuracy 0.91" in reading["reading"]["blocks"][0]["text"]
    assert not reading["key_points"]
    assert (await client.get(reading_link, headers=headers, params={"page": 3})).status_code == 404
    original = await client.get(paper["links"]["original"], headers=headers)
    assert original.content == source

    materials_link = reading["next_action"]["href"]
    materials = (await client.get(materials_link, headers=headers)).json()["data"]
    assert materials["items"] == []
    report_link = materials["next_action"]["href"]
    no_materials = (await client.get(report_link, headers=headers)).json()["data"]
    assert no_materials["status"] == "insufficient_evidence"
    assert no_materials["checks"][0]["status"] == "missing_evidence"

    added = await client.post(materials_link, headers=headers, files={
        "file": ("scores.csv", b"accuracy\n0.45\n", "text/csv"),
    })
    assert added.status_code == 201, added.text
    assert added.json()["data"]["next_action"]["href"] == report_link
    report = (await client.get(report_link, headers=headers)).json()["data"]
    assert report["status"] == "differences_found"
    check = report["checks"][0]
    assert check["paper_source"]["page"] == 2
    assert check["paper_source"]["quote"] == "Accuracy 0.91"
    assert check["results"][0]["filename"] == "scores.csv"
    assert check["results"][0]["line"] == 2
    assert check["results"][0]["value"] == 0.45

    await client.post(materials_link, headers=headers, files={
        "file": ("other-run.json", b'{"accuracy": 0.91}', "application/json"),
    })
    ambiguous = (await client.get(report_link, headers=headers)).json()["data"]
    assert ambiguous["checks"][0]["status"] == "needs_review"

    outsider = await _register(client, "outsider")
    assert (await client.get("/api/v1/papers", headers=outsider)).json()["data"]["items"] == []
    for link in (reading_link, report_link, materials_link):
        assert (await client.get(link, headers=outsider)).status_code == 404
        assert (await client.get(link)).status_code == 401
    unauthorized_write = await client.post(materials_link, headers=outsider, files={
        "file": ("private.csv", b"accuracy\n0.9", "text/csv"),
    })
    assert unauthorized_write.status_code == 404


@pytest.mark.asyncio
async def test_scanned_and_invalid_paper(client, session_fixture):
    headers = await _register(client)
    invalid = await client.post("/api/v1/papers", headers=headers, files={
        "file": ("broken.pdf", b"%PDF-1.7\nnot a document"),
    })
    assert invalid.status_code == 422
    assert list(await session_fixture.scalars(select(Project))) == []
    assert list(await session_fixture.scalars(select(Material))) == []
    assert list(material_service.STORAGE_ROOT.rglob("*.pdf")) == []

    uploaded = await client.post("/api/v1/papers", headers=headers, files={
        "file": ("scan.pdf", _pdf("")),
    })
    assert uploaded.status_code == 201, uploaded.text
    paper = uploaded.json()["data"]
    assert paper["reading_status"] == "original_only"
    reading = (await client.get(paper["links"]["reading"], headers=headers)).json()["data"]
    assert reading["reading"]["status"] == "original_only"
    assert reading["links"]["original"]


@pytest.mark.asyncio
async def test_ai_requires_confirmation_and_keeps_only_verified_quotes(client, monkeypatch):
    headers = await _register(client)
    paper = (await client.post("/api/v1/papers", headers=headers, files={
        "file": ("study.pdf", _pdf("Results\nAccuracy 0.91")),
    })).json()["data"]
    action = paper["links"]["key_points"]
    assert (await client.post(action, headers=headers, json={"allow_send_to_provider": False})).status_code == 422
    missing = await client.post(action, headers=headers, json={"allow_send_to_provider": True})
    assert missing.status_code == 503
    assert missing.json()["error"]["details"]["settings"] == "/api/v1/reading-assistant"

    calls = 0

    async def configured(*args):
        return True

    async def chat(self, messages, response_schema):
        nonlocal calls
        calls += 1
        chunk = f"pdf_{paper['id']}_p001_b00"
        facts = [
            {
                "fact_type": "metric", "field_key": field, "field_label": field,
                "raw_value": value, "normalized_value": value,
                "assertion_type": "explicit", "confidence": 0.9,
                "evidence_refs": [{"chunk_id": chunk, "quote": quote}],
            }
            for field, value, quote in [
                ("Accuracy", "0.91", "Accuracy 0.91"),
                ("F1", "0.99", "Fabricated quote"),
            ]
        ]
        return SimpleNamespace(
            parsed=FactsExtractionV2(facts=facts), model="test",
            usage=SimpleNamespace(prompt_tokens=10, completion_tokens=10, total_tokens=20),
        )

    monkeypatch.setattr(model_gateway, "is_configured", configured)
    monkeypatch.setattr(TaskLLM, "chat", chat)
    for _ in range(2):
        response = await client.post(action, headers=headers, json={"allow_send_to_provider": True})
        assert response.is_success, response.text
        assert response.json()["data"]["items"] == [{
            "label": "Accuracy", "value": "0.91", "kind": "explicit",
            "sources": [{"page": 1, "quote": "Accuracy 0.91"}],
        }]
    assert calls == 1


@pytest.mark.asyncio
async def test_previous_upload_works_without_manual_parsing(client, session_fixture):
    headers = await _register(client)
    project = (await client.post("/api/v1/projects", headers=headers, json={
        "name": "Existing project", "paper_title": "Previous paper",
    })).json()["data"]
    paper = (await client.post("/api/v1/materials/upload", headers=headers, data={
        "project_id": project["id"],
    }, files={"file": ("legacy.pdf", _pdf("Results\nAccuracy 0.91"))})).json()["data"]
    paper_url = f"/api/v1/papers/{paper['material_id']}"
    reading = (await client.get(paper_url, headers=headers)).json()["data"]
    assert reading["reading"]["status"] == "ready"
    assert reading["title"] == "Previous paper"
    original = await session_fixture.get(Material, paper["material_id"])
    assert original.parse_status == "uploaded"

    material = await client.post(reading["links"]["materials"], headers=headers, files={
        "file": ("legacy-results.json", b'{"accuracy": 0.91}'),
    })
    assert material.is_success, material.text
    report = (await client.get(reading["links"]["report"], headers=headers)).json()["data"]
    assert report["status"] == "values_match"
    assert report["checks"][0]["paper_source"]["page"] == 1


@pytest.mark.asyncio
async def test_assistant_setup_uses_provider_default_and_preserves_existing_connection(
    client, session_fixture, monkeypatch,
):
    headers = await _register(client)
    endpoint = "/api/v1/reading-assistant"
    monkeypatch.setattr(settings, "model_credential_key", "test-only-credential-encryption")
    calls = []

    async def test_connection(credential, profile):
        calls.append((credential.provider_key, profile.model_id))
        return {"status": "auth_failed" if credential.key_plaintext == "bad-key" else "success"}

    monkeypatch.setattr(model_gateway, "test_credential", test_connection)
    status = (await client.get(endpoint, headers=headers)).json()["data"]
    assert status["configured"] is False
    assert {option["id"] for option in status["providers"]} >= {"qwen", "openai"}
    assert "openai_compatible" not in {option["id"] for option in status["providers"]}
    rejected = await client.post(endpoint, headers=headers, json={"provider": "qwen", "api_key": "bad-key"})
    assert rejected.status_code == 502
    assert list(await session_fixture.scalars(select(ModelCredential))) == []

    mock_key = "fake-credential-for-workflow-tests"
    created = await client.post(endpoint, headers=headers, json={"provider": "qwen", "api_key": mock_key})
    assert created.is_success, created.text
    assert created.json()["data"]["configured"] is True
    assert (await client.get(endpoint, headers=headers)).json()["data"]["configured"] is True
    assert mock_key not in created.text
    credential = (await session_fixture.scalars(select(ModelCredential))).one()
    assert mock_key not in credential.key_ciphertext
    profile = (await session_fixture.scalars(select(ModelProfile))).one()
    assert profile.is_default and profile.model_id == calls[-1][1]

    duplicate = await client.post(endpoint, headers=headers, json={"provider": "openai", "api_key": mock_key})
    assert duplicate.status_code == 409
    assert len(calls) == 2
