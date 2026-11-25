"""回归：生产模式下项目读接口拒绝匿名；写接口在任何模式下都拒绝匿名。"""
from __future__ import annotations

import pytest

from app.core.config import settings
from app.models import ExtractedFact
from app.models.stage4 import RemediationProposal, RemediationReview


@pytest.mark.asyncio
async def test_read_endpoints_require_auth_in_production_mode(client, monkeypatch):
    """关闭开发匿名开关后，事实/证据图谱等读接口必须 401。"""
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    assert (await client.get("/api/v1/facts?project_id=p1")).status_code == 401
    assert (await client.get("/api/v1/facts/summary?project_id=p1")).status_code == 401
    assert (await client.get("/api/v1/projects/p1/evidence-graph")).status_code == 401
    assert (await client.get("/api/v1/projects/p1/chart-verification")).status_code in (401, 405)


@pytest.mark.asyncio
async def test_write_endpoints_require_auth_even_in_dev_mode(client):
    """写接口不依赖开发开关：匿名 pause/resume/recover 恒 401。"""
    assert (await client.post("/api/v1/parse-tasks/fake/pause")).status_code == 401
    assert (await client.post("/api/v1/parse-tasks/fake/resume")).status_code == 401
    assert (await client.post("/api/v1/parse-tasks/fake/retry")).status_code == 401
    assert (await client.delete("/api/v1/parse-tasks/fake")).status_code == 401
    assert (await client.post("/api/v1/parse-tasks/recover-stale")).status_code == 401


@pytest.mark.asyncio
async def test_chart_and_handoff_require_auth(client):
    """交接包导出与图表验证在任何模式下都要求登录（含开发默认）。"""
    r = await client.post("/api/v1/projects/p1/handoff/export")
    assert r.status_code == 401
    r = await client.post("/api/v1/projects/p1/chart-verification")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_fact_and_remediation_permissions_follow_resource_project(client, session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)

    async def register(email, name):
        response = await client.post("/api/v1/auth/register", json={
            "email": email, "password": "password123", "display_name": name,
        })
        data = response.json()["data"]
        return {"Authorization": f"Bearer {data['token']}"}, data["user"]["id"]

    owner, owner_id = await register("resource-owner@example.com", "项目负责人")
    outsider, _ = await register("resource-outsider@example.com", "其他用户")
    project = await client.post("/api/v1/projects", headers=owner, json={"name": "资源归属"})
    project_id = project.json()["data"]["id"]
    material = await client.post(
        "/api/v1/materials/upload", headers=owner, data={"project_id": project_id},
        files={"file": ("sample.txt", b"evidence")},
    )
    assert material.status_code == 200, material.text
    material_id = material.json()["data"]["material_id"]
    legacy_fact = ExtractedFact(
        project_id=project_id, run_id="run-resource", material_id=material_id,
        chunk_id="chunk-resource", field_key="epochs", raw_value="8",
    )
    session_fixture.add_all([
        ExtractedFact(
            fact_id="fact-resource", project_id=project_id, run_id="run-resource",
            material_id=material_id, chunk_id="chunk-resource",
            field_key="batch_size", raw_value="64",
        ),
        legacy_fact,
        RemediationProposal(id="rem-resource", diagnostic_id="diag-resource", project_id=project_id),
    ])
    await session_fixture.commit()

    assert (await client.get("/api/v1/facts/fact-resource/revisions", headers=outsider)).status_code == 404
    assert (await client.patch("/api/v1/facts/fact-resource", headers=outsider,
                               json={"raw_value": "32"})).status_code == 404
    legacy_path = f"/api/v1/facts/{legacy_fact.id}"
    repaired = await client.patch(legacy_path, headers=owner, json={"raw_value": "10"})
    assert repaired.status_code == 200, repaired.text
    assert repaired.json()["data"]["raw_value"] == "10"

    review_path = "/api/v1/reproductions/remediations/rem-resource/review"
    assert (await client.post(review_path, headers=outsider, json={"decision": "approve"})).status_code == 404
    approved = await client.post(review_path, headers=owner, json={"decision": "approve", "reviewer": "其他人"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["reviewer"] == "项目负责人"
    review = await session_fixture.get(RemediationReview, approved.json()["data"]["review_id"])
    assert review.reviewer_user_id == owner_id
