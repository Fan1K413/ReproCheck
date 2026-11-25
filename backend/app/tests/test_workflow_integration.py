"""第七阶段：工作流编排 / 补证 / 恢复服务级集成测试（内存 SQLite + 真实服务方法）。

覆盖：模板建链与真实调度、幂等复用、补证闭环、恢复方案保留原始项目且未批准/无后端不写回。
不模拟完成进度：节点状态、尝试记录、审计结果均来自服务真实落库。
"""
from __future__ import annotations

import pytest

from app.core.errors import AppError
from app.models import ExtractedFact, Material, Project
from app.models.stage2 import EvidenceItem
from app.services.assistant_service import AssistantService
from app.services.evidence_gap_service import EvidenceGapService
from app.services.orchestration_service import OrchestrationService
from app.services.recovery_service import RecoveryService
from app.workflow import state


async def _seed_project(session, project_id: str, materials: list[dict] | None = None) -> None:
    session.add(Project(id=project_id, name="集成测试项目", domain="ML"))
    for index, m in enumerate(materials or []):
        session.add(Material(
            id=m.get("id", f"{project_id}-mat-{index}"), project_id=project_id,
            source_name=m["source_name"], material_type=m.get("material_type", "text"),
            raw_text=m.get("raw_text", ""),
        ))
    await session.commit()


async def _seed_fact(session, project_id: str, material_id: str, *, field_key: str,
                     raw_value: str, fact_id: str, confidence: float = 0.9) -> ExtractedFact:
    fact = ExtractedFact(
        run_id=f"run-{project_id}", project_id=project_id, material_id=material_id,
        chunk_id=f"chunk-{fact_id}", fact_id=fact_id, field_key=field_key,
        raw_value=raw_value, normalized_value=raw_value, unit=None, confidence=confidence,
        extraction_status="supported", parser_source="model", source_name="paper.txt",
    )
    session.add(fact)
    await session.commit()
    return fact


@pytest.mark.asyncio
async def test_template_workflow_dispatches_real_handlers(session_fixture):
    project_id = "wf-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "paper.txt", "raw_text": "Learning rate 0.001"},
    ])
    svc = OrchestrationService(session_fixture)
    wf = await svc.create_from_template(project_id, "ml_paper_reproduction", user_id="u1")
    wf = await svc.start(wf.id, user_id="u1")

    view = await svc.workflow_view(wf.id)
    nodes = view["nodes"]
    assert len(nodes) == 6
    statuses = {n["node_key"]: n["status"] for n in nodes}
    # 材料齐备 → 材料检查完成；默认无隔离后端，实验执行节点被前置条件阻断并保留原因
    assert statuses["T1"] == state.NODE_COMPLETED
    assert statuses["T5"] == state.NODE_BLOCKED
    t5 = next(n for n in nodes if n["node_key"] == "T5")
    assert t5["result"]["precondition_reasons"]
    # 每次执行都记录尝试；数据不足的节点记 skipped
    attempts = [a for n in nodes for a in n["attempts"]]
    assert attempts, "已执行节点必须有 NodeAttempt 历史"
    assert any(n["status"] == state.NODE_SKIPPED for n in nodes)


@pytest.mark.asyncio
async def test_human_confirm_node_waits_then_executes_after_approval(session_fixture):
    project_id = "confirm-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "paper.txt", "raw_text": "确认门控项目材料"},
    ])
    svc = OrchestrationService(session_fixture)
    node = {
        "node_key": "C1", "title": "高风险检查", "handler": "materials_presence",
        "needs_human_confirm": True, "risk_level": "high",
    }
    successor = {
        "node_key": "C2", "title": "复核材料", "handler": "materials_presence",
        "depends_on": ["C1"],
    }
    wf = await svc.create_manual(project_id, "确认门控任务", [node, successor], user_id="u1")
    wf = await svc.start(wf.id, user_id="u1")
    view = await svc.workflow_view(wf.id)
    c1, c2 = sorted(view["nodes"], key=lambda n: n["node_key"])
    assert c1["status"] == state.NODE_AWAITING_CONFIRMATION
    assert c2["status"] == state.NODE_PENDING
    assert not c2["attempts"]
    with pytest.raises(AppError) as wrong_workflow:
        await svc.confirm_node("other-workflow", c1["id"], "approved", user_id="u1")
    assert wrong_workflow.value.status_code == 404

    await svc.confirm_node(wf.id, c1["id"], "approved", note="放行", user_id="u1")
    view = await svc.workflow_view(wf.id)
    c1, c2 = sorted(view["nodes"], key=lambda n: n["node_key"])
    assert c1["status"] == state.NODE_COMPLETED
    assert c1["confirmed_by"] == "u1"
    assert c2["status"] == state.NODE_COMPLETED


@pytest.mark.asyncio
async def test_create_manual_is_idempotent(session_fixture):
    project_id = "idem-proj"
    await _seed_project(session_fixture, project_id)
    svc = OrchestrationService(session_fixture)
    nodes = [{"node_key": "A1", "title": "检查", "handler": "materials_presence"}]
    first = await svc.create_manual(project_id, "幂等任务", nodes, idem_key="idem-1")
    second = await svc.create_manual(project_id, "幂等任务", nodes, idem_key="idem-1")
    assert first.id == second.id


@pytest.mark.asyncio
async def test_evidence_gap_full_cycle(session_fixture):
    project_id = "gap-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "paper.txt", "raw_text": "Learning rate 0.001"},
        {"source_name": "train.py", "raw_text": "lr = 0.001"},
    ])
    await _seed_fact(session_fixture, project_id, f"{project_id}-mat-0",
                     field_key="learning_rate", raw_value="0.001", fact_id="fact-lr")
    code_fact = await _seed_fact(session_fixture, project_id, f"{project_id}-mat-1",
                                 field_key="learning_rate", raw_value="0.001", fact_id="fact-code-lr")
    code_fact.parser_source = "program"
    session_fixture.add(EvidenceItem(
        evidence_id="ev-code-lr", fact_id=code_fact.fact_id, project_id=project_id,
        material_id=code_fact.material_id, chunk_id=code_fact.chunk_id, source_name="train.py",
        quote="lr = 0.001", original_text="lr = 0.001", verification_status="verified",
    ))
    await session_fixture.commit()

    gap_svc = EvidenceGapService(session_fixture)
    summary = await gap_svc.analyze(project_id)
    assert summary["total_facts"] == 2
    gaps = await gap_svc.list_gaps(project_id)
    assert len(gaps) == 1
    gap = gaps[0]
    assert gap["missing_kind"] == "evidence_missing"
    assert gap["remediation_class"] == "extractable_from_existing"

    tasks = await gap_svc.create_tasks(project_id)
    assert len(tasks) == 1
    task = tasks[0]
    assert task["source"] == "existing_extract"
    assert task["status"] == "pending"

    await gap_svc.confirm_task(task["id"], user_id="u1")
    await gap_svc.execute_task(task["id"], user_id="u1")

    gaps = await gap_svc.list_gaps(project_id)
    assert gaps[0]["status"] == "closed"
    done = await gap_svc.list_tasks(project_id)
    assert done[0]["status"] == "completed"
    assert done[0]["result_evidence"]["found"] is True
    assert done[0]["result_evidence"]["evidence_id"]
    assert done[0]["linked_claim_id"] == "fact-lr"


@pytest.mark.asyncio
async def test_pause_resume_keeps_confirmation_gate(session_fixture):
    project_id = "pause-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "paper.txt", "raw_text": "暂停恢复项目材料"},
    ])
    svc = OrchestrationService(session_fixture)
    node = {"node_key": "P1", "title": "待确认节点", "handler": "materials_presence",
            "needs_human_confirm": True}
    wf = await svc.create_manual(project_id, "暂停恢复任务", [node], user_id="u1")
    wf = await svc.start(wf.id, user_id="u1")
    assert wf.status == state.WF_AWAITING_CONFIRMATION

    wf = await svc.pause(wf.id, user_id="u1")
    assert wf.status == state.WF_PAUSED
    wf = await svc.resume(wf.id, user_id="u1")
    assert wf.status == state.WF_AWAITING_CONFIRMATION

    events = [e["event_type"] for e in (await svc.workflow_view(wf.id))["events"]]
    assert "workflow_paused" in events and "workflow_resumed" in events


@pytest.mark.asyncio
async def test_cancel_marks_nonterminal_nodes_cancelled(session_fixture):
    project_id = "cancel-proj"
    await _seed_project(session_fixture, project_id)
    svc = OrchestrationService(session_fixture)
    nodes = [
        {"node_key": "A1", "title": "被阻断节点", "handler": "materials_presence",
         "preconditions": {"required_material_names": ["requirements.txt"]}},
        {"node_key": "B1", "title": "后继节点", "handler": "materials_presence",
         "depends_on": ["A1"]},
    ]
    wf = await svc.create_manual(project_id, "取消任务", nodes, user_id="u1")
    wf = await svc.start(wf.id, user_id="u1")
    view = await svc.workflow_view(wf.id)
    by_key = {n["node_key"]: n for n in view["nodes"]}
    assert by_key["A1"]["status"] == state.NODE_BLOCKED
    assert by_key["B1"]["status"] == state.NODE_PENDING

    result = await svc.cancel(wf.id, user_id="u1")
    assert result["cancelled"] is True
    view = await svc.workflow_view(wf.id)
    by_key = {n["node_key"]: n for n in view["nodes"]}
    assert view["workflow"]["status"] == state.WF_CANCELLED
    assert by_key["A1"]["status"] == state.NODE_CANCELLED
    assert by_key["B1"]["status"] == state.NODE_CANCELLED
    assert not by_key["B1"]["attempts"]


@pytest.mark.asyncio
async def test_manual_retry_keeps_all_attempt_history(session_fixture):
    project_id = "retry-proj"
    await _seed_project(session_fixture, project_id)
    svc = OrchestrationService(session_fixture)
    node = {"node_key": "R1", "title": "易失败节点", "handler": "unknown_handler",
            "max_retries": 0}
    wf = await svc.create_manual(project_id, "重试任务", [node], user_id="u1")
    wf = await svc.start(wf.id, user_id="u1")
    view = await svc.workflow_view(wf.id)
    r1 = view["nodes"][0]
    assert r1["status"] == state.NODE_FAILED
    assert r1["attempt_count"] == 1
    assert r1["error_code"] == "UNKNOWN_HANDLER"

    await svc.retry_node(wf.id, r1["id"], user_id="u1")
    view = await svc.workflow_view(wf.id)
    r1 = view["nodes"][0]
    assert r1["status"] == state.NODE_FAILED
    assert r1["attempt_count"] == 2
    assert len(r1["attempts"]) == 2  # 历史尝试不被覆盖
    assert r1["attempts"][0]["attempt_no"] == 1
    assert r1["attempts"][1]["attempt_no"] == 2


@pytest.mark.asyncio
async def test_recover_stale_terminates_expired_running_node(session_fixture):
    from datetime import datetime, timedelta, timezone
    project_id = "stale-proj"
    await _seed_project(session_fixture, project_id)
    svc = OrchestrationService(session_fixture)
    node = {"node_key": "S1", "title": "过期节点", "handler": "materials_presence"}
    wf = await svc.create_manual(project_id, "过期回收任务", [node], user_id="u1")
    view = await svc.workflow_view(wf.id)
    node_row = await svc._get_node(wf.id, view["nodes"][0]["id"])
    node_row.status = state.NODE_RUNNING
    node_row.heartbeat_at = datetime.now(timezone.utc) - timedelta(hours=2)
    session_fixture.add(node_row)
    await session_fixture.commit()

    recovered = await svc.recover_stale(stale_minutes=15)
    assert recovered == 1
    view = await svc.workflow_view(wf.id)
    s1 = view["nodes"][0]
    assert s1["status"] == state.NODE_FAILED
    assert s1["error_code"] == "STALE_RECOVERED"


class _AdminUser:
    id = "u1"
    is_platform_admin = True


@pytest.mark.asyncio
async def test_assistant_auto_locates_single_project_and_gates_high_risk(session_fixture):
    project_id = "asst-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "paper.txt", "raw_text": "Learning rate 0.001"},
    ])
    svc = AssistantService(session_fixture)
    result = await svc.plan(
        _AdminUser(), None,
        "检查这个项目中论文描述的学习率和代码实际使用的学习率是否一致。",
        user_id="u1",
    )
    assert result["needs_project_selection"] is False
    assert result["project_id"] == project_id
    assert result["intent"]["intent"] == "compare_parameter"
    assert result["intent"]["field_key"] == "learning_rate"
    node = result["workflow"]["nodes"][0]
    assert node["status"] in (state.NODE_COMPLETED, state.NODE_SKIPPED)

    high = await svc.plan(
        _AdminUser(), project_id, "重新训练一遍并对比批大小", user_id="u1",
    )
    assert high["high_risk"] is True
    assert high["workflow"]["nodes"][0]["status"] == state.NODE_AWAITING_CONFIRMATION


@pytest.mark.asyncio
async def test_assistant_asks_for_project_when_multiple_accessible(session_fixture):
    await _seed_project(session_fixture, "asst-multi-a")
    await _seed_project(session_fixture, "asst-multi-b")
    svc = AssistantService(session_fixture)
    result = await svc.plan(_AdminUser(), None, "检查数据集质量", user_id="u1")
    assert result["needs_project_selection"] is True
    assert result["intent"]["intent"] == "dataset_quality"


@pytest.mark.asyncio
async def test_recovery_plan_preserves_original_and_blocks_apply(session_fixture, tmp_path, monkeypatch):
    monkeypatch.setattr(
        "app.services.recovery_service._storage_root", lambda: tmp_path / "storage")
    project_id = "rec-proj"
    await _seed_project(session_fixture, project_id, [
        {"source_name": "train.py", "raw_text": "import torch"},
    ])
    svc = RecoveryService(session_fixture)
    plan = await svc.create_plan(
        project_id, raw_log="ModuleNotFoundError: No module named 'torch'",
        user_id="u1",
    )
    assert plan.original_preserved is True
    assert plan.failure_category
    # 无安全隔离后端时，隔离测试标记 skipped
    assert plan.test_status == "skipped"
    assert plan.isolation_copy_path

    await svc.review_plan(plan.id, "approved", user_id="u1")
    with pytest.raises(AppError) as exc:
        await svc.apply_plan(plan.id, consent_skip_test=True, user_id="u1")
    assert exc.value.code == "EXECUTION_DISABLED"

    view = await svc.plan_view(plan.id)
    assert view["original_preserved"] is True
    assert view["status"] != "applied"
