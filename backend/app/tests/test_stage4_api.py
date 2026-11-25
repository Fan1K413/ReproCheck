"""第四阶段 API 集成测试（HTTP 层，真实 FastAPI app）。

覆盖：无 Key 明确失败、沙箱禁用、质量评估真实聚合、报告 14 章、项目隔离。
"""
from __future__ import annotations

import json

import pytest


@pytest.mark.asyncio
async def test_api_no_key_plan_and_diagnosis(client, monkeypatch):
    from app.core.config import settings
    monkeypatch.setattr(settings, "llm_api_key", "")
    r = await client.post("/api/v1/projects", json={
        "name": "API测试", "domain": "", "paper_title": "", "description": ""})
    pid = r.json()["data"]["id"]

    r = await client.post("/api/v1/reproductions/plans", json={"project_id": pid})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "LLM_KEY_NOT_CONFIGURED"

    r = await client.post("/api/v1/reproductions/diagnostics", json={
        "run_id": "rr-none", "project_id": pid})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "LLM_KEY_NOT_CONFIGURED"

    # 无失败结果落库
    r = await client.get(f"/api/v1/reproductions/plans?project_id={pid}")
    assert r.json()["data"]["total"] == 0


@pytest.mark.asyncio
async def test_api_manual_plan_needs_no_key_and_counts_tasks(client, monkeypatch):
    """显式 manual 模式只创建人工空规划，不改变默认 AI 无 Key 的失败契约。"""
    from app.core.config import settings
    monkeypatch.setattr(settings, "llm_api_key", "")
    r = await client.post("/api/v1/projects", json={
        "name": "人工规划测试", "domain": "", "paper_title": "", "description": ""})
    pid = r.json()["data"]["id"]

    r = await client.post("/api/v1/reproductions/plans", json={
        "project_id": pid, "title": "人工空规划", "mode": "manual"})
    assert r.status_code == 200
    plan = r.json()["data"]
    assert plan["source"] == "manual"
    assert plan["ai_available"] is False
    assert plan["task_count"] == 0

    r = await client.post(f"/api/v1/reproductions/plans/{plan['plan_id']}/tasks", json={
        "title": "人工任务", "description": "不调用 AI", "needs_human_confirm": True})
    assert r.status_code == 200

    r = await client.get(f"/api/v1/reproductions/plans/{plan['plan_id']}")
    assert len(r.json()["data"]["tasks"]) == 1
    r = await client.get(f"/api/v1/reproductions/plans?project_id={pid}")
    assert r.json()["data"]["items"][0]["task_count"] == 1


@pytest.mark.asyncio
async def test_api_sandbox_blocked_run_and_report(client):
    from app.models.stage4 import ReproductionPlan
    from app.main import app
    r = await client.post("/api/v1/projects", json={
        "name": "沙箱测试", "domain": "", "paper_title": "", "description": ""})
    pid = r.json()["data"]["id"]

    from app.db import get_db
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        db.add(ReproductionPlan(id="rplan-api", project_id=pid, title="plan",
                                status="generated", source="program"))
        await db.commit()
        break

    r = await client.post("/api/v1/reproductions/runs", json={
        "plan_id": "rplan-api", "task_ids": [], "requested_by": "tester"})
    assert r.status_code == 200
    run = r.json()["data"]
    assert run["status"] == "blocked_no_sandbox"
    assert run["execution_enabled"] is False
    assert run["security_check"]["sandbox_available"] is False

    r = await client.get(f"/api/v1/reproductions/runs/{run['run_id']}/logs")
    assert r.status_code == 200 and r.json()["data"]["total"] == 0

    r = await client.post("/api/v1/reproductions/reports", json={"project_id": pid})
    assert r.status_code == 200
    assert r.json()["data"]["section_count"] == 14
    assert r.json()["data"]["html_available"] is True
    assert r.json()["data"]["pdf_available"] is True

    report_id = r.json()["data"]["report_id"]
    r = await client.get(f"/api/v1/reproductions/reports/{report_id}/html")
    assert r.status_code == 200 and "第14章" in r.text

    # 没有预先保存的 PDF 时，直接使用已有的 HTML 生成含中文的 PDF。
    r = await client.get(f"/api/v1/reproductions/reports/{report_id}/pdf")
    assert r.status_code == 200
    assert r.headers["Content-Type"] == "application/pdf"
    assert r.headers["Content-Disposition"].startswith("attachment;")
    import pymupdf
    with pymupdf.open(stream=r.content, filetype="pdf") as pdf:
        text = "".join(page.get_text() for page in pdf)
    assert "项目基本信息" in text
    assert "最终复现结论与限制说明" in text


@pytest.mark.asyncio
async def test_form_project_id_isolation_does_not_reference_unbound_body(client, monkeypatch):
    """表单体带 project_id 时应经过项目访问校验，而不是触发 UnboundLocalError。"""
    from app.core.config import settings

    # 禁用匿名开发放行，确保请求进入项目隔离逻辑；没有登录应返回 401。
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    response = await client.post(
        "/api/v1/reproductions/plans",
        data={"project_id": "form-project"},
    )

    assert response.status_code == 401


@pytest.mark.asyncio
async def test_api_quality_from_real_db(client):
    r = await client.post("/api/v1/projects", json={
        "name": "质量测试", "domain": "", "paper_title": "", "description": ""})
    pid = r.json()["data"]["id"]
    r = await client.get(f"/api/v1/reproductions/quality?project_id={pid}")
    assert r.status_code == 200
    data = r.json()["data"]
    assert len(data["dimensions"]) == 7
    assert "Σ" in data["formula"]
    assert "不代表学术质量" in data["scope_note"]
    # 空项目不应得到高分（真实聚合）
    assert data["overall"] < 0.3


@pytest.mark.asyncio
async def test_api_manual_task_and_confirm(client):
    from app.models.stage4 import ReproductionPlan, ReproductionTask
    from app.main import app
    from app.db import get_db
    r = await client.post("/api/v1/projects", json={
        "name": "任务测试", "domain": "", "paper_title": "", "description": ""})
    pid = r.json()["data"]["id"]
    factory = app.dependency_overrides[get_db]
    async for db in factory():
        db.add(ReproductionPlan(id="rplan-task", project_id=pid, title="plan",
                                status="generated", source="program"))
        await db.commit()
        break
    r = await client.post("/api/v1/reproductions/plans/rplan-task/tasks", json={
        "title": "人工任务", "description": "test", "needs_human_confirm": True})
    assert r.status_code == 200
    task = r.json()["data"]
    assert task["task_key"] == "T01"
    assert task["needs_human_confirm"] is True

    r = await client.post(f"/api/v1/reproductions/tasks/{task['task_id']}/confirm")
    assert r.status_code == 200 and r.json()["data"]["confirmed"] is True
    assert r.json()["data"]["status"] == "confirmed"

    # 旧版已确认任务仍保留待确认标记，读取时也不能再次记为待确认。
    async for db in factory():
        saved = await db.get(ReproductionTask, task["task_id"])
        assert saved is not None
        assert saved.needs_human_confirm is False
        db.add(ReproductionTask(id="rtask-legacy-confirmed", plan_id="rplan-task", project_id=pid,
                                task_key="T02", title="旧版已确认任务", status="confirmed",
                                feasibility="needs_human_review", needs_human_confirm=True))
        await db.commit()
        break
    r = await client.get("/api/v1/reproductions/plans/rplan-task")
    plan = r.json()["data"]
    assert plan["feasibility_summary"] == {"unverifiable": 2}
    assert all(item["status"] == "confirmed" and not item["needs_human_confirm"] for item in plan["tasks"])
    assert all(item["feasibility"] == "unverifiable" for item in plan["dag"]["nodes"])

    # 重复 key 被拒
    r = await client.post("/api/v1/reproductions/plans/rplan-task/tasks", json={
        "title": "重复", "task_key": "T01"})
    assert r.status_code == 422
