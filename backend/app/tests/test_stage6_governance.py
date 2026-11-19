"""第六阶段 E 组测试：数据分级 / AI 授权门 / 本人数据导出 / 保留策略 / 项目级联删除。"""
from __future__ import annotations

import pytest


async def _register(client, email, name="测试用户"):
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123", "display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_classification_catalog(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "class@example.com")
    r = await client.get("/api/v1/governance/classification", headers=_auth(a["token"]))
    assert r.status_code == 200
    levels = {c["level"] for c in r.json()["data"]["classes"]}
    assert {"public", "internal", "confidential", "restricted"} <= levels


@pytest.mark.asyncio
async def test_ai_consent_gate_blocks_then_allows(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    monkeypatch.setattr(settings, "require_ai_consent", True)
    monkeypatch.setattr(settings, "llm_api_key", "sk-test")
    a = await _register(client, "consent@example.com")
    pid = (await client.post("/api/v1/projects", json={"name": "授权项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    mid = (await client.post("/api/v1/materials/upload", data={"project_id": pid},
                             files={"file": ("p.txt", b"learning rate 0.001", "text/plain")},
                             headers=_auth(a["token"]))).json()["data"]["material_id"]
    # 未授权 → 明确 403，不静默调用模型
    r = await client.post(f"/api/v1/materials/{mid}/parse", headers=_auth(a["token"]))
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "AI_CONSENT_REQUIRED"
    # 授予授权
    r = await client.post("/api/v1/governance/ai-consent", json={"allow_external_llm": True, "project_id": pid}, headers=_auth(a["token"]))
    assert r.status_code == 200 and r.json()["data"]["allow_external_llm"] is True
    # 授权后治理门放行（服务层直接验证，避免真实网络调用）
    from app.main import app
    from app.db import get_db
    from app.services.governance_service import ensure_ai_consent
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        await ensure_ai_consent(db, pid, None)  # 不应抛异常
        break
    got = (await client.get(f"/api/v1/governance/ai-consent?project_id={pid}", headers=_auth(a["token"]))).json()["data"]
    assert got["active"]["allow_external_llm"] is True


@pytest.mark.asyncio
async def test_consent_requires_lead_or_admin(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "consent-lead@example.com")
    b = await _register(client, "consent-viewer@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    token = (await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "consent-viewer@example.com"}, headers=_auth(a["token"]))).json()["data"]["token"]
    await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(b["token"]))
    pid = (await client.post("/api/v1/projects", json={"name": "授权权限"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post(f"/api/v1/projects/{pid}/members", json={"user_id": b["user"]["id"], "role_key": "viewer"}, headers=_auth(a["token"]))
    r = await client.post("/api/v1/governance/ai-consent", json={"allow_external_llm": True, "project_id": pid}, headers=_auth(b["token"]))
    assert r.status_code in (403, 404)


@pytest.mark.asyncio
async def test_data_export_self_only(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "export-a@example.com")
    b = await _register(client, "export-b@example.com")
    pid = (await client.post("/api/v1/projects", json={"name": "导出项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post("/api/v1/materials/upload", data={"project_id": pid},
                      files={"file": ("p.txt", b"epochs 5", "text/plain")}, headers=_auth(a["token"]))
    r = await client.post("/api/v1/governance/export", headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    eid = r.json()["data"]["export_id"]
    assert r.json()["data"]["status"] == "completed"
    assert r.json()["data"]["file_available"] is True
    # 下载 zip
    r = await client.get(f"/api/v1/governance/export/{eid}/download", headers=_auth(a["token"]))
    assert r.status_code == 200
    assert r.content[:2] == b"PK"
    # B 不能访问 A 的导出
    assert (await client.get(f"/api/v1/governance/export/{eid}", headers=_auth(b["token"]))).status_code == 404


@pytest.mark.asyncio
async def test_retention_admin_only(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "ret-admin@example.com")
    # 组织管理员可读保留策略
    r = await client.get("/api/v1/governance/retention", headers=_auth(a["token"]))
    assert r.status_code == 200
    assert r.json()["data"]["default_days"] >= 1
    # 未认证拒绝
    assert (await client.get("/api/v1/governance/retention")).status_code == 401


@pytest.mark.asyncio
async def test_project_delete_cascades(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "del-lead@example.com")
    b = await _register(client, "del-other@example.com")
    pid = (await client.post("/api/v1/projects", json={"name": "待删项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post("/api/v1/materials/upload", data={"project_id": pid},
                      files={"file": ("p.txt", b"batch 32", "text/plain")}, headers=_auth(a["token"]))
    # 非负责人不能删除
    assert (await client.delete(f"/api/v1/projects/{pid}", headers=_auth(b["token"]))).status_code in (403, 404)
    r = await client.delete(f"/api/v1/projects/{pid}", headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    assert r.json()["data"]["deleted"] is True
    assert r.json()["data"]["materials_removed"] >= 1
    # 项目与材料不再可见
    assert (await client.get(f"/api/v1/materials?project_id={pid}", headers=_auth(a["token"]))).status_code == 404