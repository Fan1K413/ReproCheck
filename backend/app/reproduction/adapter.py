"""第三阶段审计适配层与 DAG 工具。

关键：第三阶段审计引擎/证据图谱在磁盘上不存在。本适配层只暴露既有数据视图
（第一阶段 audit_findings + 第二阶段 extracted_facts 的程序化比对），
并明确标注数据来源，绝不伪造"第三阶段审计结论"。
"""
from __future__ import annotations

from collections import defaultdict, deque
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditFinding, ExtractedFact
from app.services import normalize_field_key, values_equal


SOURCE_NOTE = (
    "第三阶段专用审计引擎与证据图谱在当前项目中不存在。"
    "本规划仅使用第一阶段最小审计记录(audit_findings)与第二阶段科研事实(extracted_facts)的既有数据视图，"
    "不得将其描述为第三阶段审计结论。"
)


class Stage3AuditAdapter:
    """兼容适配层：提供审计发现的统一视图，明确来源。"""

    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get_audit_view(self, project_id: str) -> list[dict[str, Any]]:
        findings = (await self.db.execute(
            select(AuditFinding).where(AuditFinding.project_id == project_id)
            .order_by(AuditFinding.created_at.desc()).limit(50)
        )).scalars().all()
        return [{
            "id": f"af-{f.id}", "field_key": f.field_key, "title": f.title,
            "ai_explanation": f.ai_explanation, "severity": f.severity,
            "source": "stage1_audit_findings",
        } for f in findings]

    async def get_facts_view(self, project_id: str) -> list[dict[str, Any]]:
        facts = (await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id)
            .order_by(ExtractedFact.created_at.desc()).limit(120)
        )).scalars().all()
        return [{
            "fact_id": f.fact_id or f"fact-{f.id}", "field_key": f.field_key,
            "raw_value": f.raw_value, "normalized_value": f.normalized_value,
            "assertion_type": f.assertion_type, "fact_type": f.fact_type,
            "material_id": f.material_id, "source": "stage2_extracted_facts",
        } for f in facts]

    async def programmatic_conflicts(self, project_id: str) -> list[dict[str, Any]]:
        """基于既有事实做程序化比对（不调用模型），供规划参考。"""
        facts = await self.get_facts_view(project_id)
        by_key: dict[str, list[dict]] = defaultdict(list)
        for f in facts:
            key, label = normalize_field_key(f["field_key"])
            by_key[key].append({**f, "label": label})
        conflicts = []
        for key, group in by_key.items():
            if len(group) < 2:
                continue
            vals = {str(g.get("normalized_value") if g.get("normalized_value") is not None
                         else g["raw_value"]) for g in group}
            if len(vals) > 1:
                conflicts.append({
                    "field_key": key, "values": sorted(vals),
                    "fact_ids": [g["fact_id"] for g in group],
                    "source": "programmatic_comparison_of_stage2_facts",
                })
        return conflicts


def validate_dag(tasks: list[dict[str, Any]]) -> tuple[list[str], list[str]]:
    """返回 (拓扑序, 错误列表)。检测未知依赖与环。"""
    keys = [t.get("task_key", "") for t in tasks]
    errors: list[str] = []
    if len(set(keys)) != len(keys):
        errors.append("DAG_INVALID: 存在重复 task_key")
        return [], errors
    key_set = set(keys)
    graph: dict[str, list[str]] = {k: [] for k in keys}
    indegree: dict[str, int] = {k: 0 for k in keys}
    for t in tasks:
        k = t.get("task_key", "")
        for dep in t.get("depends_on", []) or []:
            if dep not in key_set:
                errors.append(f"DAG_INVALID: 任务 {k} 依赖不存在的任务 {dep}")
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
        errors.append("DAG_INVALID: 检测到循环依赖")
        return [], errors
    return order, []


def propagate_blocking(tasks: list[dict[str, Any]], topo: list[str]) -> list[dict[str, Any]]:
    """阻断传播：前置任务未完成/不可执行时，后继任务标记 blocked。"""
    by_key = {t["task_key"]: t for t in tasks}
    blocking_states = {"missing_material", "missing_dependency", "missing_configuration",
                       "blocked_security", "unverifiable", "needs_human_review"}
    for key in topo:
        task = by_key[key]
        for dep in task.get("depends_on", []) or []:
            parent = by_key.get(dep)
            if parent is None:
                continue
            parent_blocked = (parent.get("feasibility") in blocking_states
                              or parent.get("status") in ("blocked", "failed", "cancelled"))
            if parent_blocked and task.get("feasibility") == "ready":
                task["feasibility"] = "missing_dependency"
                task["feasibility_reason"] = (
                    f"前置任务 {dep} 尚未具备执行条件（{parent.get('feasibility')}），阻断后继任务"
                )
                task["status"] = "blocked"
    return tasks
