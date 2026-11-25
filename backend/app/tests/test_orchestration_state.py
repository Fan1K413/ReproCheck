"""编排状态机纯函数测试：DAG 拓扑、前置条件、就绪调度、状态聚合。

不依赖数据库，可直接运行；服务级集成测试在落盘阶段对齐 conftest 后补齐。
"""
from __future__ import annotations

from app.workflow import state


def _node(key, deps=None, status=state.NODE_PENDING, priority=5, preconditions=None):
    return {
        "node_key": key, "depends_on": deps or [], "status": status,
        "priority": priority, "preconditions": preconditions or {},
    }


def test_topo_sort_basic():
    nodes = [_node("B", ["A"]), _node("A"), _node("C", ["B"])]
    order, errors = state.topo_sort(nodes)
    assert errors == []
    assert order == ["A", "B", "C"]


def test_topo_sort_detects_cycle():
    nodes = [_node("A", ["C"]), _node("B", ["A"]), _node("C", ["B"])]
    order, errors = state.topo_sort(nodes)
    assert errors and "循环" in errors[0]


def test_topo_sort_unknown_dep():
    nodes = [_node("A", ["ghost"])]
    _, errors = state.topo_sort(nodes)
    assert errors


def test_preconditions_missing_material():
    node = _node("A", preconditions={"required_material_names": ["train.py"]})
    reasons = state.evaluate_preconditions(node, {"materials": [], "facts": [], "sandbox_available": True})
    assert any("train.py" in r for r in reasons)


def test_preconditions_satisfied():
    node = _node("A", preconditions={"required_facts": ["learning_rate"]})
    reasons = state.evaluate_preconditions(
        node, {"materials": [], "facts": [{"field_key": "learning_rate"}], "sandbox_available": True})
    assert reasons == []


def test_ready_nodes_priority_order():
    nodes = [_node("B", priority=2), _node("A", priority=9)]
    ready, reasons = state.ready_nodes(nodes, ["A", "B"], {"materials": [], "facts": [], "sandbox_available": True})
    assert [n["node_key"] for n in ready] == ["A", "B"]


def test_dep_failure_blocks_successor():
    nodes = [_node("A", status=state.NODE_FAILED), _node("B", ["A"])]
    ready, reasons = state.ready_nodes(nodes, ["A", "B"], {"materials": [], "facts": [], "sandbox_available": True})
    assert ready == []
    assert "A" in reasons["B"][0]


def test_unfinished_dependency_keeps_successor_pending():
    for status in (state.NODE_PENDING, state.NODE_RUNNING, state.NODE_AWAITING_CONFIRMATION):
        nodes = [_node("A", status=status), _node("B", ["A"])]
        ready, reasons = state.ready_nodes(nodes, ["A", "B"], {})
        assert all(node["node_key"] != "B" for node in ready)
        assert "B" not in reasons


def test_aggregate_failed_when_any_failed():
    nodes = [_node("A", status=state.NODE_COMPLETED), _node("B", status=state.NODE_FAILED)]
    assert state.aggregate_status(nodes, cancel_requested=False) == state.WF_FAILED


def test_aggregate_awaiting_confirmation():
    nodes = [_node("A", status=state.NODE_AWAITING_CONFIRMATION)]
    assert state.aggregate_status(nodes, cancel_requested=False) == state.WF_AWAITING_CONFIRMATION


def test_aggregate_completed():
    nodes = [_node("A", status=state.NODE_COMPLETED), _node("B", status=state.NODE_SKIPPED)]
    assert state.aggregate_status(nodes, cancel_requested=False) == state.WF_COMPLETED


def test_cancel_overrides():
    nodes = [_node("A", status=state.NODE_RUNNING)]
    assert state.aggregate_status(nodes, cancel_requested=True) == state.WF_CANCELLED
