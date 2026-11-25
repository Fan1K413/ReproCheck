import httpx
import pytest

from app.site_compute import app


@pytest.mark.asyncio
async def test_site_compute_uses_real_audit_engines(monkeypatch):
    token = "test-site-compute-token-" + "x" * 32
    monkeypatch.setenv("REPROCHECK_SITE_COMPUTE_TOKEN", token)
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        assert (await client.get("/api/v1/stats-audit/catalog")).status_code == 401
        report = await client.post("/api/v1/stats-audit/compute", headers=headers, json={
            "operation": "mean", "kwargs": {"values": [1, 2, 3]},
        })
        assert report.status_code == 200, report.text
        assert report.json()["data"]["value"] == 2
        result = await client.post("/api/v1/data-audits/run", headers=headers, json={
            "project_id": "site-test", "files": [{"name": "train.csv", "text": "id,value\n1,2\n2,3\n"}],
        })
        assert result.status_code == 200, result.text
        data = result.json()["data"]
        assert data["project_id"] == "site-test"
        assert data["scope"]["data_roots"] == ["site-upload"]
        assert data["audit_id"]
        verdict = await client.post("/api/v1/verdict-summary", headers=headers, json={
            "project_id": "site-test", "sources": {"facts": [{"extraction_status": "supported"}]},
        })
        assert verdict.json()["data"]["verdicts"]["VERIFIED"] == 1
