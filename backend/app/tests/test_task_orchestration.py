"""第六阶段 Wave A：科研任务编排器状态机测试。

覆盖暂停/恢复/超时/心跳恢复/失败分类与 API 项目隔离，全部使用内存 SQLite 与真实服务方法。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.core.errors import AppError
from app.models import ExtractedFact, Material, Project
from app.models.stage2 import ParseTask
from app.models.stage6 import ProjectMember
from app.services.task_service import ACTIVE_STATUSES, TaskService


def _utc(delta_seconds: int = 0) -> datetime:
    return datetime.now(timezone.utc) + timedelta(seconds=delta_seconds)


async def _seed_task(
    session,
    *,
    prefix: str,
    status: str = "queued",
    create_project: bool = True,
    **overrides,
) -> ParseTask:
    """构造项目/材料/任务最小行；overrides 直接覆盖 ParseTask 字段。"""
    project_id = overrides.pop("project_id", f"{prefix}-project")
    material_id = overrides.pop("material_id", f"{prefix}-material")
    task_id = overrides.pop("id", f"{prefix}-task")
    if create_project:
        session.add(Project(id=project_id, name=f"{prefix}项目", domain="ML"))
    session.add(Material(
        id=material_id, project_id=project_id, source_name="paper.txt",
        material_type="text", raw_text="Learning Rate 0.001", stored_path="/tmp/paper.txt",
    ))
    values = dict(
        id=task_id, project_id=project_id, material_id=material_id,
        idem_key=f"{prefix}-idem", status=status, stage=status,
        stage_message="测试任务", failure_category="", timeout_seconds=600,
        resume_count=0, heartbeat_at=_utc(),
    )
    values.update(overrides)
    task = ParseTask(**values)
    session.add(task)
    await session.commit()
    return task


async def _reload(session, task_id: str) -> ParseTask:
    task = (await session.execute(
        select(ParseTask).where(ParseTask.id == task_id)
    )).scalar_one()
    await session.refresh(task)
    return task


async def _fact_count(session) -> int:
    return (await session.execute(
        select(func.count()).select_from(ExtractedFact)
    )).scalar_one()


@pytest.mark.asyncio
async def test_pause_allows_only_active_states(session_fixture):
    """四个活跃状态可暂停；终态任务必须被拒绝。"""
    service = TaskService(session_fixture)
    for index, status in enumerate(ACTIVE_STATUSES):
        task = await _seed_task(session_fixture, prefix=f"active{index}", status=status)
        paused = await service.pause(task.id)
        assert paused.status == "paused"
        assert paused.paused_at is not None

    terminal = await _seed_task(session_fixture, prefix="terminal", status="completed")
    with pytest.raises(AppError) as caught:
        await service.pause(terminal.id)
    assert caught.value.code == "INVALID_STATE"
    assert (await _reload(session_fixture, terminal.id)).status == "completed"


@pytest.mark.asyncio
async def test_resume_only_paused_and_never_auto_runs(session_fixture, monkeypatch):
    """recover 只改状态，不触发 run；事实数量保持不变。"""
    task = await _seed_task(session_fixture, prefix="resume", status="paused", facts_count=3)

    called = []

    async def _unexpected_run(self, task_id):
        called.append(task_id)
        raise AssertionError("resume 不得自动重跑任务")

    monkeypatch.setattr(TaskService, "run", _unexpected_run)
    service = TaskService(session_fixture)

    resumed = await service.resume(task.id)
    assert resumed.status == "queued"
    assert resumed.stage == "queued"
    assert resumed.resume_count == 1
    assert resumed.paused_at is None
    assert resumed.facts_count == 3
    assert called == []

    with pytest.raises(AppError) as caught:
        await service.resume(task.id)
    assert caught.value.code == "INVALID_STATE"


@pytest.mark.asyncio
async def test_mark_timeout_sets_status_error_code_and_category(session_fixture):
    task = await _seed_task(session_fixture, prefix="timeout", status="extracting")
    updated = await TaskService(session_fixture).mark_timeout(task.id)
    assert updated.status == "failed"
    assert updated.error_code == "TASK_TIMEOUT"
    assert updated.failure_category == "timeout"
    assert updated.completed_at is not None


@pytest.mark.asyncio
async def test_recover_stale_tasks_only_touches_expired_active_rows(session_fixture):
    stale = await _seed_task(
        session_fixture, prefix="stale", status="running", heartbeat_at=_utc(-3600)
    )
    fresh = await _seed_task(session_fixture, prefix="fresh", status="parsing")
    done = await _seed_task(
        session_fixture, prefix="done", status="completed", heartbeat_at=_utc(-7200)
    )
    new_without_heartbeat = await _seed_task(
        session_fixture, prefix="new", status="queued", heartbeat_at=None, created_at=_utc()
    )

    recovered = await TaskService(session_fixture).recover_stale_tasks(stale_minutes=15)
    assert recovered == 1

    stale_row = await _reload(session_fixture, stale.id)
    assert stale_row.status == "failed"
    assert stale_row.error_code == "STALE_RECOVERED"
    assert stale_row.failure_category == "stale"
    assert (await _reload(session_fixture, fresh.id)).status == "parsing"
    assert (await _reload(session_fixture, done.id)).status == "completed"
    assert (await _reload(session_fixture, new_without_heartbeat.id)).status == "queued"


@pytest.mark.asyncio
async def test_retry_clears_failure_category(session_fixture, monkeypatch):
    task = await _seed_task(
        session_fixture, prefix="retry", status="failed", failure_category="parse"
    )

    async def _noop_run(self, task_id):
        return await self._get_task(task_id)

    monkeypatch.setattr(TaskService, "run", _noop_run)
    retried = await TaskService(session_fixture).retry(task.id)
    assert retried.status == "queued"
    assert retried.failure_category == ""
    assert retried.error_code is None


@pytest.mark.asyncio
async def test_run_paused_raises_and_creates_no_facts(session_fixture, monkeypatch):
    task = await _seed_task(session_fixture, prefix="paused-run", status="paused")

    def _must_not_parse(*args, **kwargs):
        raise AssertionError("paused 任务不得进入解析阶段")

    import app.services.task_service as task_service_module
    monkeypatch.setattr(task_service_module, "parse_file", _must_not_parse)

    with pytest.raises(AppError) as caught:
        await TaskService(session_fixture).run(task.id)
    assert caught.value.code == "TASK_PAUSED"
    assert (await _reload(session_fixture, task.id)).status == "paused"
    assert await _fact_count(session_fixture) == 0


@pytest.mark.asyncio
async def test_run_detects_timeout_before_parsing(session_fixture, monkeypatch):
    task = await _seed_task(
        session_fixture, prefix="expired-run", status="queued",
        started_at=_utc(-3600), timeout_seconds=1,
    )

    def _must_not_parse(*args, **kwargs):
        raise AssertionError("超时任务不得进入解析阶段")

    import app.services.task_service as task_service_module
    monkeypatch.setattr(task_service_module, "parse_file", _must_not_parse)

    with pytest.raises(AppError) as caught:
        await TaskService(session_fixture).run(task.id)
    assert caught.value.code == "TASK_TIMEOUT"
    row = await _reload(session_fixture, task.id)
    assert row.status == "failed"
    assert row.error_code == "TASK_TIMEOUT"
    assert row.failure_category == "timeout"
    assert await _fact_count(session_fixture) == 0


@pytest.mark.asyncio
async def test_api_pause_resume_exposes_orchestration_fields(client, session_fixture):
    task = await _seed_task(session_fixture, prefix="api-flow", status="running")
    # 写操作端点强制登录：注册用户并设为项目 owner（安全收紧后的合法访问）。
    reg = await client.post("/api/v1/auth/register", json={
        "email": "flow-owner@example.com", "password": "password123", "display_name": "流程负责人"})
    assert reg.status_code == 200, reg.text
    uid = reg.json()["data"]["user"]["id"]
    headers = {"Authorization": f"Bearer {reg.json()['data']['token']}"}
    proj = (await session_fixture.execute(
        select(Project).where(Project.id == task.project_id))).scalar_one()
    proj.owner_user_id = uid
    session_fixture.add(ProjectMember(
        id="pm-flow", project_id=task.project_id, user_id=uid, role_key="project_lead"))
    await session_fixture.commit()

    paused = await client.post(f"/api/v1/parse-tasks/{task.id}/pause", headers=headers)
    assert paused.status_code == 200, paused.text
    data = paused.json()["data"]
    assert data["status"] == "paused"
    assert data["paused_at"]
    assert data["resume_count"] == 0
    assert data["timeout_seconds"] == 600
    assert data["failure_category"] == ""

    resumed = await client.post(f"/api/v1/parse-tasks/{task.id}/resume", headers=headers)
    assert resumed.status_code == 200, resumed.text
    data = resumed.json()["data"]
    assert data["status"] == "queued"
    assert data["paused_at"] is None
    assert data["resume_count"] == 1


@pytest.mark.asyncio
async def test_api_recover_stale_is_static_route(client, session_fixture):
    task = await _seed_task(
        session_fixture, prefix="api-stale", status="extracting", heartbeat_at=_utc(-3600)
    )
    # 写操作端点强制登录：注册平台管理员并带上 token。
    reg = await client.post("/api/v1/auth/register", json={
        "email": "stale-admin@example.com", "password": "password123", "display_name": "恢复管理员"})
    assert reg.status_code == 200, reg.text
    uid = reg.json()["data"]["user"]["id"]
    headers = {"Authorization": f"Bearer {reg.json()['data']['token']}"}
    session_fixture.add(ProjectMember(
        id="pm-stale", project_id=task.project_id, user_id=uid, role_key="project_lead"))
    await session_fixture.commit()
    # 非平台管理员必须限定 project_id；这里传任务所属项目。
    response = await client.post("/api/v1/parse-tasks/recover-stale",
                                 json={"project_id": task.project_id}, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["data"]["recovered"] == 1


@pytest.mark.asyncio
async def test_api_cross_project_task_access_is_isolated(client, session_fixture, monkeypatch):
    """两个真实注册用户：非项目成员不能暂停任务，也不能恢复他人项目的陈旧任务。"""
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)

    a = await client.post("/api/v1/auth/register", json={
        "email": "orch-a@example.com", "password": "password123", "display_name": "编排A"
    })
    b = await client.post("/api/v1/auth/register", json={
        "email": "orch-b@example.com", "password": "password123", "display_name": "编排B"
    })
    assert a.status_code == 200 and b.status_code == 200
    token_a = a.json()["data"]["token"]
    token_b = b.json()["data"]["token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}
    headers_b = {"Authorization": f"Bearer {token_b}"}

    project_a = await client.post("/api/v1/projects", json={
        "name": "编排项目A", "domain": "ML", "paper_title": "", "description": ""
    }, headers=headers_a)
    project_b = await client.post("/api/v1/projects", json={
        "name": "编排项目B", "domain": "ML", "paper_title": "", "description": ""
    }, headers=headers_b)
    assert project_a.status_code == 200 and project_b.status_code == 200
    pid_a = project_a.json()["data"]["id"]
    pid_b = project_b.json()["data"]["id"]

    task = await _seed_task(
        session_fixture, prefix="cross", status="queued", create_project=False,
        project_id=pid_a, heartbeat_at=_utc(-3600),
    )

    denied = await client.post(f"/api/v1/parse-tasks/{task.id}/pause", headers=headers_b)
    assert denied.status_code == 404, denied.text
    allowed = await client.post(f"/api/v1/parse-tasks/{task.id}/pause", headers=headers_a)
    assert allowed.status_code == 200, allowed.text

    denied_recover = await client.post(
        f"/api/v1/parse-tasks/recover-stale?project_id={pid_a}", headers=headers_b
    )
    assert denied_recover.status_code == 404
    allowed_recover = await client.post(
        f"/api/v1/parse-tasks/recover-stale?project_id={pid_b}", headers=headers_b
    )
    assert allowed_recover.status_code == 200
    assert (await _reload(session_fixture, task.id)).status == "paused"
