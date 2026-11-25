"""工作流状态机、DAG 调度与前置条件校验（纯函数，不访问数据库，便于测试）。

状态语义与既有 ParseTask / ReproductionRun 保持一致：
- 状态全部来自真实执行落库，不存在"模拟完成"；
- 暂停/取消在节点边界生效；
- 前置条件不满足时节点标记 blocked 并保留原因，不强行执行。
"""
from __future__ import annotations

from collections import deque
from typing import Any

# 工作流级状态
WF_DRAFT = "draft"
WF_PENDING = "pending"
WF_RUNNING = "running"
WF_PAUSED = "paused"
WF_AWAITING_CONFIRMATION = "awaiting_confirmation"
WF_COMPLETED = "completed"
WF_FAILED = "failed"
WF_CANCELLED = "cancelled"

WORKFLOW_STATUSES = (
    WF_DRAFT, WF_PENDING, WF_RUNNING, WF_PAUSED, WF_AWAITING_CONFIRMATION,
    WF_COMPLETED, WF_FAILED, WF_CANCELLED,
)
WF_TERMINAL = (WF_COMPLETED, WF_FAILED, WF_CANCELLED)

# 节点级状态
NODE_PENDING = "pending"
NODE_BLOCKED = "blocked"
NODE_READY = "ready"
NODE_RUNNING = "running"
NODE_AWAITING_CONFIRMATION = "awaiting_confirmation"
NODE_COMPLETED = "completed"
NODE_FAILED = "failed"
NODE_CANCELLED = "cancelled"
NODE_SKIPPED = "skipped"

NODE_STATUSES = (
    NODE_PENDING, NODE_BLOCKED, NODE_READY, NODE_RUNNING,
    NODE_AWAITING_CONFIRMATION, NODE_COMPLETED, NODE_FAILED,
    NODE_CANCELLED, NODE_SKIPPED,
)
NODE_ACTIVE = (NODE_READY, NODE_RUNNING, NODE_AWAITING_CONFIRMATION)
NODE_TERMINAL = (NODE_COMPLETED, NODE_FAILED, NODE_CANCELLED, NODE_SKIPPED)

# 依赖失败/取消/跳过后继节点的处置：block（阻断）或 skip（跳过）
ON_DEP_FAILURE = ("block", "skip")


def topo_sort(nodes: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """返回 (拓扑序, 错误列表)。校验未知依赖、重复 key 与循环依赖。"""
    keys = [n.get("node_key") or n.get("task_key") or "" for n in nodes]
    errors: list[str] = []
    if not keys or any(not k for k in keys):
        return [], ["工作流存在缺少 node_key 的节点"]
    if len(set(keys)) != len(keys):
        return [], ["工作流存在重复 node_key"]
    key_set = set(keys)
    graph: dict[str, list[str]] = {k: [] for k in keys}
    indegree: dict[str, int] = {k: 0 for k in keys}
    for n in nodes:
        k = n["node_key"]
        for dep in n.get("depends_on", []) or []:
            if dep not in key_set:
                errors.append(f"节点 {k} 依赖了不存在的节点 {dep}")
                continue
            graph[dep].append(k)
            indegree[k] += 1
    if errors:
        return [], errors
    q = deque([k for k, d in indegree.items() if d == 0])
    order: list[str] = []
    while q:
        cur = q.popleft()
        order.append(cur)
        for nxt in graph[cur]:
            indegree[nxt] -= 1
            if indegree[nxt] == 0:
                q.append(nxt)
    if len(order) != len(keys):
        return [], ["工作流 DAG 检测到循环依赖"]
    return order, []


def evaluate_preconditions(
    node: dict[str, Any], context: dict[str, Any]
) -> list[str]:
    """返回未满足的前置条件原因列表；空列表表示条件满足。

    context 约定：
    {
      "materials": [{"id", "source_name", "material_type", "parse_status"}],
      "facts": [{"field_key", "fact_id", "material_id"}],
      "sandbox_available": bool,
    }
    """
    pre = node.get("preconditions") or {}
    reasons: list[str] = []
    materials = context.get("materials") or []
    facts = context.get("facts") or []

    for name in pre.get("required_material_names") or []:
        if not any(name.lower() in (m.get("source_name") or "").lower() for m in materials):
            reasons.append(f"缺少必需材料：{name}")

    for mtype in pre.get("required_material_types") or []:
        if not any((m.get("material_type") or "") == mtype for m in materials):
            reasons.append(f"缺少类型为 {mtype} 的材料")

    for fkey in pre.get("required_facts") or []:
        if not any((f.get("field_key") or "") == fkey for f in facts):
            reasons.append(f"缺少必需事实：{fkey}")

    min_facts = int(pre.get("min_facts") or 0)
    if min_facts and len(facts) < min_facts:
        reasons.append(f"事实数量不足：需要 {min_facts} 条，现有 {len(facts)} 条")

    if pre.get("sandbox_required") and not context.get("sandbox_available"):
        reasons.append("当前环境无可用安全隔离执行后端，实验执行类节点不可运行")

    return reasons


def _dep_blocked(dep_status: str) -> bool:
    return dep_status in (NODE_FAILED, NODE_CANCELLED, NODE_SKIPPED, NODE_BLOCKED)


def ready_nodes(
    nodes: list[dict[str, Any]],
    topo: list[str],
    context: dict[str, Any],
) -> tuple[list[dict[str, Any]], dict[str, list[str]]]:
    """计算本轮可调度节点与各节点前置条件原因。

    返回 (ready 节点列表(按优先级降序、拓扑序升序), reasons 映射 node_key -> [str])。
    只基于状态与前置条件做纯判断，不执行任何处理器。
    """
    by_key = {n["node_key"]: n for n in nodes}
    reasons: dict[str, list[str]] = {}
    ready: list[dict[str, Any]] = []

    for key in topo:
        node = by_key[key]
        if node["status"] in NODE_TERMINAL or node["status"] == NODE_AWAITING_CONFIRMATION:
            continue
        deps = node.get("depends_on") or []
        dep_failed = False
        for dep in deps:
            dep_node = by_key.get(dep)
            if dep_node is None:
                continue
            if _dep_blocked(dep_node["status"]):
                dep_failed = True
                reasons.setdefault(key, []).append(
                    f"前置任务 {dep} 未成功完成（{dep_node['status']}）"
                )
        if dep_failed:
            continue

        unmet = evaluate_preconditions(node, context)
        if unmet:
            reasons[key] = reasons.get(key, []) + unmet
            continue
        if node["status"] in (NODE_PENDING, NODE_READY):
            ready.append(node)

    ready.sort(key=lambda n: (-int(n.get("priority") or 5), topo.index(n["node_key"])))
    return ready, reasons


def aggregate_status(nodes: list[dict[str, Any]], *, cancel_requested: bool) -> str:
    """根据节点状态聚合工作流状态（纯函数）。"""
    if cancel_requested:
        return WF_CANCELLED
    statuses = [n["status"] for n in nodes]
    if any(s == NODE_FAILED for s in statuses):
        return WF_FAILED
    if any(s == NODE_CANCELLED for s in statuses):
        return WF_CANCELLED
    if any(s == NODE_AWAITING_CONFIRMATION for s in statuses):
        return WF_AWAITING_CONFIRMATION
    if any(s in (NODE_RUNNING, NODE_READY) for s in statuses):
        return WF_RUNNING
    if statuses and all(s in (NODE_COMPLETED, NODE_SKIPPED) for s in statuses):
        return WF_COMPLETED
    if any(s == NODE_BLOCKED for s in statuses):
        return WF_PENDING
    return WF_PENDING
