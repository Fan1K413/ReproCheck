"""回归：生产模式下项目读接口拒绝匿名；写接口在任何模式下都拒绝匿名。"""
from __future__ import annotations

import pytest

from app.core.config import settings


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
