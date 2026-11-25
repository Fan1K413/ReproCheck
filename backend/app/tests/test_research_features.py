"""第十一阶段新功能独立测试：实验差异分析 + 项目变化监控。"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import settings
from app.models import Project
from app.models.stage4 import ReproductionMetric, ReproductionRun
from app.models.stage6 import ProjectMember, RepositoryConnection, RepositorySnapshot


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _register(client, email):
    r = await client.post("/api/v1/auth/register", json={
        "email": email, "password": "password123", "display_name": "科研用户"})
    assert r.status_code == 200, r.text
    return r.json()["data"]


def _seed_run(session, project_id: str, run_id: str, value: float, commit: str,
              snap_offset: int = 0, run_offset: int = 0):
    base = datetime.now(timezone.utc)
    run = ReproductionRun(id=run_id, project_id=project_id, plan_id="plan-x",
                          status="completed", duration_ms=1000,
                          created_at=base + timedelta(seconds=run_offset))
    session.add(run)
    session.add(ReproductionMetric(metric_name="accuracy", metric_value=value,
                                   run_id=run_id, project_id=project_id))
    session.add(RepositorySnapshot(
        id=f"snap-{commit}", connection_id="conn-1", project_id=project_id,
        repo_full_name="lab/repro", commit_sha=commit,
        fetched_at=base + timedelta(seconds=snap_offset),
        version_diff_json=json.dumps({"status": "synced", "message": "", "files": []})))
    return run


@pytest.mark.asyncio
async def test_experiment_diff_reports_correlation_not_causation(client, session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    user = await _register(client, "diff@example.com")
    pid = "proj-diff"
    session_fixture.add(Project(id=pid, name="差异分析"))
    session_fixture.add(ProjectMember(id="pm-diff", project_id=pid,
                                      user_id=user["user"]["id"], role_key="lead"))
    _seed_run(session_fixture, pid, "run-a", 0.80, "aaa111", snap_offset=1, run_offset=2)
    _seed_run(session_fixture, pid, "run-b", 0.90, "bbb222", snap_offset=10, run_offset=20)
    session_fixture.add(RepositoryConnection(id="conn-1", user_id=user["user"]["id"],
                                             provider="github", status="connected"))
    await session_fixture.commit()

    r = await client.post("/api/v1/experiments/diff", headers=_auth(user["token"]), json={
        "project_id": pid, "run_ids": ["run-a", "run-b"]})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert len(data["snapshots"]) == 2
    assert any(c["dimension"] == "git_commit" and c["status"] == "changed"
               for c in data["conditions"])
    metric = next(m for m in data["metric_diffs"] if m["metric"] == "accuracy")
    assert metric["changed"] is True and round(metric["absolute_diff"], 2) == 0.1
    assert data["possible_explanations"]
    assert all(e["relation"] == "correlation_only" for e in data["possible_explanations"])
    assert "不认定因果" in data["causality_notice"]
    assert data["rerun_recommendation"]["recommendation"] in ("recommended", "optional")


@pytest.mark.asyncio
async def test_experiment_diff_requires_two_runs(client, session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    user = await _register(client, "diff-min@example.com")
    session_fixture.add(Project(id="proj-diff-min", name="差异"))
    session_fixture.add(ProjectMember(id="pm-diff-min", project_id="proj-diff-min",
                                      user_id=user["user"]["id"], role_key="lead"))
    await session_fixture.commit()
    r = await client.post("/api/v1/experiments/diff", headers=_auth(user["token"]), json={
        "project_id": "proj-diff-min", "run_ids": ["only-one"]})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_change_monitor_docs_only_does_not_force_rerun(client, session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    user = await _register(client, "monitor@example.com")
    uid = user["user"]["id"]
    pid = "proj-monitor"
    session_fixture.add(Project(id=pid, name="变化监控"))
    session_fixture.add(ProjectMember(id="pm-m", project_id=pid, user_id=uid, role_key="lead"))
    session_fixture.add(RepositoryConnection(id="conn-m", user_id=uid,
                                             provider="github", status="connected"))
    session_fixture.add(RepositorySnapshot(
        id="s-old", connection_id="conn-m", project_id=pid, repo_full_name="lab/repro",
        commit_sha="old1",
        version_diff_json=json.dumps({"status": "synced", "files": [
            {"path": "src/train.py", "status": "modified"}]})))
    session_fixture.add(RepositorySnapshot(
        id="s-new", connection_id="conn-m", project_id=pid, repo_full_name="lab/repro",
        commit_sha="new1",
        version_diff_json=json.dumps({"status": "synced", "files": [
            {"path": "README.md", "status": "modified"}]})))
    session_fixture.add(ReproductionRun(id="run-m", project_id=pid, plan_id="p",
                                        status="completed"))
    await session_fixture.commit()

    r = await client.get("/api/v1/change-monitor/analyze", headers=_auth(user["token"]),
                         params={"project_id": pid})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "analyzed"
    assert data["categories"] == ["docs"]
    assert data["affected_runs"] == []
    assert any(s["severity"] == "low" for s in data["suggestions"])


@pytest.mark.asyncio
async def test_change_monitor_code_change_and_confirmed_plan(client, session_fixture, monkeypatch):
    monkeypatch.setattr(settings, "allow_unauth_test_endpoints", False)
    user = await _register(client, "monitor2@example.com")
    uid = user["user"]["id"]
    pid = "proj-monitor2"
    session_fixture.add(Project(id=pid, name="变化监控2"))
    session_fixture.add(ProjectMember(id="pm-m2", project_id=pid, user_id=uid, role_key="lead"))
    session_fixture.add(RepositoryConnection(id="conn-m2", user_id=uid,
                                             provider="github", status="connected"))
    session_fixture.add(RepositorySnapshot(
        id="s-old2", connection_id="conn-m2", project_id=pid, repo_full_name="lab/repro",
        commit_sha="old2",
        version_diff_json=json.dumps({"status": "synced", "files": []})))
    session_fixture.add(RepositorySnapshot(
        id="s-new2", connection_id="conn-m2", project_id=pid, repo_full_name="lab/repro",
        commit_sha="new2",
        version_diff_json=json.dumps({"status": "synced", "message": "fix lr", "files": [
            {"path": "configs/train.yaml", "status": "modified"}]})))
    await session_fixture.commit()

    r = await client.get("/api/v1/change-monitor/analyze", headers=_auth(user["token"]),
                         params={"project_id": pid})
    data = r.json()["data"]
    assert data["categories"] == ["config"]
    assert any(s["severity"] == "high" for s in data["suggestions"])

    r = await client.post("/api/v1/change-monitor/create-review-plan",
                          headers=_auth(user["token"]), json={
                              "project_id": pid, "snapshot_id": "s-new2", "confirmed": False})
    assert r.status_code == 422
    r = await client.post("/api/v1/change-monitor/create-review-plan",
                          headers=_auth(user["token"]), json={
                              "project_id": pid, "snapshot_id": "s-new2", "confirmed": True})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["status"] == "draft"
