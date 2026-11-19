"""回归：POST /parse-tasks/recover-stale 的 project_id 同时支持 query 与 JSON body。"""
from __future__ import annotations

import pytest


@pytest.mark.asyncio
async def test_recover_stale_accepts_body_project_id(client):
    """真实用户通过 JSON body 传 project_id 时不应再被误判为越权。"""
    reg = await client.post("/api/v1/auth/register", json={
        "email": "recover-body@example.com", "password": "password123",
        "display_name": "恢复测试"})
    assert reg.status_code == 200, reg.text
    token = reg.json()["data"]["token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/v1/projects", json={
        "name": "恢复项目", "domain": "", "paper_title": "", "description": ""},
        headers=headers)
    assert r.status_code == 200, r.text
    pid = r.json()["data"]["id"]

    # body 传参：修复前返回 403，修复后应 200
    r = await client.post("/api/v1/parse-tasks/recover-stale",
                          json={"project_id": pid}, headers=headers)
    assert r.status_code == 200, r.text
    assert "recovered" in r.json()["data"]

    # query 传参（原行为）仍可用
    r = await client.post(f"/api/v1/parse-tasks/recover-stale?project_id={pid}",
                          headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.asyncio
async def test_recover_stale_body_other_project_rejected(client):
    """body 传参同样受项目隔离：非成员项目返回 404。"""
    a = await client.post("/api/v1/auth/register", json={
        "email": "recover-a@example.com", "password": "password123", "display_name": "A"})
    b = await client.post("/api/v1/auth/register", json={
        "email": "recover-b@example.com", "password": "password123", "display_name": "B"})
    ha = {"Authorization": f"Bearer {a.json()['data']['token']}"}
    hb = {"Authorization": f"Bearer {b.json()['data']['token']}"}
    pid = (await client.post("/api/v1/projects", json={
        "name": "A项目", "domain": "", "paper_title": "", "description": ""},
        headers=ha)).json()["data"]["id"]
    r = await client.post("/api/v1/parse-tasks/recover-stale",
                          json={"project_id": pid}, headers=hb)
    assert r.status_code == 404, r.text
