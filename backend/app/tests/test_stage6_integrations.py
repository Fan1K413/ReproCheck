"""第六阶段 D 组测试：仓库连接器/快照/Notebook/开放 API Token 与调用治理。"""
from __future__ import annotations

import json

import pytest


async def _register(client, email, name="测试用户"):
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": "password123", "display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_repository_connect_encrypts_and_hides_token(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "repo-a@example.com")
    r = await client.post("/api/v1/integrations/repositories", json={
        "provider": "github", "account_label": "lab", "token": "ghp_secret_xyz",
        "repo_allowlist": ["lab/repro"]}, headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["has_token"] is True
    assert data["status"] == "connected"
    assert "token" not in data and "token_encrypted" not in data
    assert "ghp_secret_xyz" not in r.text
    # 落库为密文
    from app.main import app
    from app.db import get_db
    from app.models.stage6 import RepositoryConnection
    from sqlalchemy import select
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        conn = (await db.execute(select(RepositoryConnection).where(RepositoryConnection.id == data["connection_id"]))).scalar_one()
        assert conn.token_encrypted and "ghp_secret_xyz" not in conn.token_encrypted
        break


@pytest.mark.asyncio
async def test_sync_without_credentials_blocked(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "repo-nokey@example.com")
    cid = (await client.post("/api/v1/integrations/repositories", json={"provider": "github"}, headers=_auth(a["token"]))).json()["data"]["connection_id"]
    r = await client.post(f"/api/v1/integrations/repositories/{cid}/sync", json={"repo_full_name": "lab/repro", "ref": "main"}, headers=_auth(a["token"]))
    assert r.status_code == 200
    snap = r.json()["data"]
    assert snap["status"] == "blocked_no_credentials"
    assert snap["commit_sha"] == ""


@pytest.mark.asyncio
async def test_sync_with_credentials_real_fetch_and_allowlist(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    import app.services.repository_service as rs

    async def fake_fetch(provider, token, repo, ref):
        assert token == "ghp_secret_xyz"
        return {"commit_sha": "abc123def", "branch": ref or "main", "default_branch": "main", "message": "init"}

    monkeypatch.setattr(rs, "_fetch_remote_commit", fake_fetch)
    a = await _register(client, "repo-sync@example.com")
    cid = (await client.post("/api/v1/integrations/repositories", json={
        "provider": "github", "token": "ghp_secret_xyz", "repo_allowlist": ["lab/repro"]}, headers=_auth(a["token"]))).json()["data"]["connection_id"]
    # 白名单外仓库被拒
    r = await client.post(f"/api/v1/integrations/repositories/{cid}/sync", json={"repo_full_name": "other/repo"}, headers=_auth(a["token"]))
    assert r.status_code == 403
    # 白名单内真实同步
    r = await client.post(f"/api/v1/integrations/repositories/{cid}/sync", json={"repo_full_name": "lab/repro", "ref": "main"}, headers=_auth(a["token"]))
    assert r.status_code == 200
    assert r.json()["data"]["status"] == "synced"
    assert r.json()["data"]["commit_sha"] == "abc123def"
    snaps = (await client.get(f"/api/v1/integrations/repositories/{cid}/snapshots", headers=_auth(a["token"]))).json()["data"]
    assert snaps["total"] == 1


@pytest.mark.asyncio
async def test_repository_revoke_and_isolation(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "repo-own@example.com")
    b = await _register(client, "repo-other@example.com")
    cid = (await client.post("/api/v1/integrations/repositories", json={"provider": "gitlab", "token": "glpat-x"}, headers=_auth(a["token"]))).json()["data"]["connection_id"]
    # B 跨组织不可见
    assert (await client.post(f"/api/v1/integrations/repositories/{cid}/revoke", headers=_auth(b["token"]))).status_code == 404
    items = (await client.get("/api/v1/integrations/repositories", headers=_auth(b["token"]))).json()["data"]["items"]
    assert all(c["connection_id"] != cid for c in items)
    # 创建者撤销
    r = await client.post(f"/api/v1/integrations/repositories/{cid}/revoke", headers=_auth(a["token"]))
    assert r.status_code == 200 and r.json()["data"]["status"] == "revoked"
    assert r.json()["data"]["has_token"] is False
    r = await client.post(f"/api/v1/integrations/repositories/{cid}/sync", json={"repo_full_name": "x/y"}, headers=_auth(a["token"]))
    assert r.status_code == 409


@pytest.mark.asyncio
async def test_notebook_cell_structure(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "nb@example.com")
    pid = (await client.post("/api/v1/projects", json={"name": "NB项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    nb = {"cells": [
        {"cell_type": "markdown", "source": ["# 实验说明"], "id": "c0"},
        {"cell_type": "code", "source": "print('hi')", "execution_count": 3, "outputs": [{"output_type": "stream", "text": "hi"}], "id": "c1"},
    ], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}
    r = await client.post("/api/v1/materials/upload", data={"project_id": pid},
                          files={"file": ("exp.ipynb", json.dumps(nb).encode(), "application/x-ipynb+json")},
                          headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    mid = r.json()["data"]["material_id"]
    r = await client.get(f"/api/v1/materials/{mid}/notebook", headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["cell_count"] == 2
    assert data["cells"][0]["cell_type"] == "markdown"
    assert data["cells"][1]["execution_count"] == 3
    assert data["cells"][1]["output_count"] == 1


@pytest.mark.asyncio
async def test_api_token_lifecycle_and_open_api(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "tok@example.com")
    r = await client.post("/api/v1/api-tokens", json={"name": "ci", "scopes": ["project.read", "project.write"], "rate_limit_per_min": 100}, headers=_auth(a["token"]))
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    plain = data["token"]
    assert plain.startswith("rc_live_")
    tid = data["token_id"]
    # 列表不含明文/哈希
    lst = (await client.get("/api/v1/api-tokens", headers=_auth(a["token"]))).json()["data"]["items"]
    assert all("token" not in t and "token_hash" not in t for t in lst)
    # 开放 API 创建项目
    h = {"Authorization": f"Bearer {plain}"}
    r = await client.post("/api/open/v1/projects", json={"name": "开放项目"}, headers=h)
    assert r.status_code == 200, r.text
    pid = r.json()["data"]["id"]
    r = await client.get("/api/open/v1/projects", headers=h)
    assert any(p["id"] == pid for p in r.json()["data"]["items"])
    # 调用日志
    logs = (await client.get(f"/api/v1/api-tokens/{tid}/logs", headers=_auth(a["token"]))).json()["data"]
    assert logs["total"] >= 2
    # 撤销后开放 API 失效
    await client.post(f"/api/v1/api-tokens/{tid}/revoke", headers=_auth(a["token"]))
    assert (await client.get("/api/open/v1/projects", headers=h)).status_code == 401


@pytest.mark.asyncio
async def test_open_api_scope_and_rate_limit(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "scope@example.com")
    # 只读 token，速率限制 2/分钟
    plain = (await client.post("/api/v1/api-tokens", json={"name": "ro", "scopes": ["project.read"], "rate_limit_per_min": 2}, headers=_auth(a["token"]))).json()["data"]["token"]
    h = {"Authorization": f"Bearer {plain}"}
    # 写操作缺 scope → 403（仍计入速率窗口第 1 次）
    assert (await client.post("/api/open/v1/projects", json={"name": "x"}, headers=h)).status_code == 403
    # 读操作第 2 次成功，第 3 次触发限流 429
    assert (await client.get("/api/open/v1/projects", headers=h)).status_code == 200
    assert (await client.get("/api/open/v1/projects", headers=h)).status_code == 429
    # 无令牌 → 401
    assert (await client.get("/api/open/v1/projects")).status_code == 401


@pytest.mark.asyncio
async def test_integration_requires_permission(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "int-lead@example.com")
    b = await _register(client, "int-viewer@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    token = (await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "int-viewer@example.com"}, headers=_auth(a["token"]))).json()["data"]["token"]
    await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(b["token"]))
    pid = (await client.post("/api/v1/projects", json={"name": "集成权限"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post(f"/api/v1/projects/{pid}/members", json={"user_id": b["user"]["id"], "role_key": "viewer"}, headers=_auth(a["token"]))
    # viewer 无 integration.manage → 403
    r = await client.post("/api/v1/integrations/repositories", json={"provider": "github", "org_id": org_a}, headers=_auth(b["token"]))
    assert r.status_code == 403