"""第六阶段 A 组测试：认证 / 组织隔离 / 项目权限 / 邀请过期 / 成员撤权 / 审计轨迹。

全部使用真实注册用户与 JWT，关闭匿名开发放行以验证真实隔离。
"""
from __future__ import annotations

import pytest


async def _register(client, email, password="password123", name="测试用户"):
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password, "display_name": name})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_register_login_me(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    data = await _register(client, "alice@example.com")
    assert data["token"]
    assert data["user"]["email"] == "alice@example.com"
    assert "password_hash" not in data["user"]

    r = await client.get("/api/v1/auth/me", headers=_auth(data["token"]))
    assert r.status_code == 200
    assert len(r.json()["data"]["organizations"]) == 1

    r = await client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "wrong"})
    assert r.status_code == 401
    r = await client.post("/api/v1/auth/login", json={"email": "alice@example.com", "password": "password123"})
    assert r.status_code == 200

    # 无令牌访问受保护接口
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_org_data_isolation(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "owner-a@example.com")
    b = await _register(client, "owner-b@example.com")
    org_a = a["user"] and (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    org_b = (await client.get("/api/v1/auth/me", headers=_auth(b["token"]))).json()["data"]["organizations"][0]["id"]

    # B 不能读取 A 的组织
    r = await client.get(f"/api/v1/orgs/{org_a}", headers=_auth(b["token"]))
    assert r.status_code == 404
    # B 不能列出 A 的成员
    r = await client.get(f"/api/v1/orgs/{org_a}/members", headers=_auth(b["token"]))
    assert r.status_code == 404
    # A 可读自己的组织
    r = await client.get(f"/api/v1/orgs/{org_a}", headers=_auth(a["token"]))
    assert r.status_code == 200
    assert org_a != org_b


@pytest.mark.asyncio
async def test_project_isolation_non_member_404(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "proj-a@example.com")
    b = await _register(client, "proj-b@example.com")
    r = await client.post("/api/v1/projects", json={"name": "A的项目"}, headers=_auth(a["token"]))
    pid = r.json()["data"]["id"]
    assert r.json()["data"]["owner_user_id"] == a["user"]["id"]

    # B 非成员：项目详情/材料/活动均 404
    assert (await client.get(f"/api/v1/projects/{pid}/members", headers=_auth(b["token"]))).status_code == 404
    assert (await client.get(f"/api/v1/materials?project_id={pid}", headers=_auth(b["token"]))).status_code == 404
    assert (await client.get(f"/api/v1/projects/{pid}/activity", headers=_auth(b["token"]))).status_code == 404
    assert (await client.get(f"/api/v1/projects/{pid}/evidence-graph", headers=_auth(b["token"]))).status_code == 404
    # A 作为负责人可访问
    assert (await client.get(f"/api/v1/projects/{pid}/members", headers=_auth(a["token"]))).status_code == 200
    # B 的项目列表不含 A 的项目
    items = (await client.get("/api/v1/projects", headers=_auth(b["token"]))).json()["data"]["items"]
    assert all(p["id"] != pid for p in items)


@pytest.mark.asyncio
async def test_invitation_accept_and_expiry(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "inviter@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    r = await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "invitee@example.com", "role_key": "member"}, headers=_auth(a["token"]))
    assert r.status_code == 200
    token = r.json()["data"]["token"]
    inv_id = r.json()["data"]["id"]

    invitee = await _register(client, "invitee@example.com")
    r = await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(invitee["token"]))
    assert r.status_code == 200 and r.json()["data"]["status"] == "accepted"
    # 重复接受冲突
    r = await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(invitee["token"]))
    assert r.status_code == 409

    # 过期邀请：新建一个并人工置为过期
    r = await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "late@example.com"}, headers=_auth(a["token"]))
    token2 = r.json()["data"]["token"]
    from app.main import app
    from app.db import get_db
    from app.models.stage6 import Invitation
    from app.core.security import hash_token
    from sqlalchemy import select
    from datetime import datetime, timezone, timedelta
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        inv = (await db.execute(select(Invitation).where(Invitation.token_hash == hash_token(token2)))).scalar_one()
        inv.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        await db.commit()
        break
    late = await _register(client, "late@example.com")
    r = await client.post("/api/v1/invitations/accept", json={"token": token2}, headers=_auth(late["token"]))
    assert r.status_code == 409 and "过期" in r.json()["error"]["message"]


@pytest.mark.asyncio
async def test_member_removal_revokes_project_access(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "lead@example.com")
    b = await _register(client, "member@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    pid = (await client.post("/api/v1/projects", json={"name": "团队项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    # 邀请 B 入组织并接受
    token = (await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "member@example.com"}, headers=_auth(a["token"]))).json()["data"]["token"]
    await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(b["token"]))
    # 分配 B 为项目研究人员
    r = await client.post(f"/api/v1/projects/{pid}/members", json={"user_id": b["user"]["id"], "role_key": "researcher"}, headers=_auth(a["token"]))
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/projects/{pid}/members", headers=_auth(b["token"]))).status_code == 200
    # 移除组织成员 → 项目权限同步撤销
    r = await client.delete(f"/api/v1/orgs/{org_a}/members/{b['user']['id']}", headers=_auth(a["token"]))
    assert r.status_code == 200
    assert (await client.get(f"/api/v1/projects/{pid}/members", headers=_auth(b["token"]))).status_code == 404


@pytest.mark.asyncio
async def test_audit_trail_records_before_after(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "trail@example.com")
    b = await _register(client, "trail2@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    token = (await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "trail2@example.com"}, headers=_auth(a["token"]))).json()["data"]["token"]
    await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(b["token"]))
    pid = (await client.post("/api/v1/projects", json={"name": "留痕项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post(f"/api/v1/projects/{pid}/members", json={"user_id": b["user"]["id"], "role_key": "viewer"}, headers=_auth(a["token"]))
    # 修改角色 viewer → researcher
    await client.patch(f"/api/v1/projects/{pid}/members/{b['user']['id']}", json={"role_key": "researcher"}, headers=_auth(a["token"]))
    activity = (await client.get(f"/api/v1/projects/{pid}/activity", headers=_auth(a["token"]))).json()["data"]["items"]
    role_changes = [a for a in activity if a["action"] == "project.member_role"]
    assert len(role_changes) == 1
    import json
    assert json.loads(role_changes[0]["before"])["role_key"] == "viewer"
    assert json.loads(role_changes[0]["after"])["role_key"] == "researcher"


@pytest.mark.asyncio
async def test_rbac_viewer_cannot_comment(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    a = await _register(client, "lead2@example.com")
    b = await _register(client, "viewer@example.com")
    org_a = (await client.get("/api/v1/auth/me", headers=_auth(a["token"]))).json()["data"]["organizations"][0]["id"]
    token = (await client.post(f"/api/v1/orgs/{org_a}/invitations", json={"email": "viewer@example.com"}, headers=_auth(a["token"]))).json()["data"]["token"]
    await client.post("/api/v1/invitations/accept", json={"token": token}, headers=_auth(b["token"]))
    pid = (await client.post("/api/v1/projects", json={"name": "权限项目"}, headers=_auth(a["token"]))).json()["data"]["id"]
    await client.post(f"/api/v1/projects/{pid}/members", json={"user_id": b["user"]["id"], "role_key": "viewer"}, headers=_auth(a["token"]))
    # viewer 可读取活动
    assert (await client.get(f"/api/v1/projects/{pid}/activity", headers=_auth(b["token"]))).status_code == 200
    # viewer 不能评论
    r = await client.post(f"/api/v1/projects/{pid}/comments", json={"target_type": "finding", "target_id": "f1", "body": "hi"}, headers=_auth(b["token"]))
    assert r.status_code == 403
    # researcher 可以评论
    await client.patch(f"/api/v1/projects/{pid}/members/{b['user']['id']}", json={"role_key": "researcher"}, headers=_auth(a["token"]))
    r = await client.post(f"/api/v1/projects/{pid}/comments", json={"target_type": "finding", "target_id": "f1", "body": "证据见第3页"}, headers=_auth(b["token"]))
    assert r.status_code == 200