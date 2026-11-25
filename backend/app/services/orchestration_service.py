"""科研工作流编排引擎服务（第七阶段升级）。

在既有复现规划 DAG / 受控执行 / 日志 / 诊断 / 审核机制之上，提供多步骤编排：
依赖分析、前置条件检查、优先级、失败重试、暂停/恢复/取消、人工确认节点、执行历史。

真实性约束：
- 节点与工作流状态全部落库，前端轮询读取，不模拟完成进度；
- 每次执行尝试独立留痕（NodeAttempt），失败现场不被重试覆盖；
- 自动操作写审计轨迹（AuditTrail）；
- 幂等：同 idem_key 的活跃工作流复用，不重复建链；
- 资源：并发上限、节点超时、重试次数均受配置约束。

与第十二阶段 ResearchTask 的区别：ResearchTask 是协作待办项；本服务是可调度、
可追踪的 DAG 执行引擎，节点绑定确定性检查处理器。
"""
from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.models import ExtractedFact, Material
from app.models.stage7 import NodeAttempt, Workflow, WorkflowEvent, WorkflowNode
from app.reproduction.sandbox import ExecutionSandbox
from app.services import normalize_field_key
from app.services.trail_service import record_trail
from app.workflow import state
from app.workflow.handlers import (
    HandlerContext, R_COMPLETED, R_FAILED, R_INSUFFICIENT, R_SKIPPED, run_handler,
)
from app.workflow.templates import get_template


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime | None) -> datetime | None:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc) if value else None


def _dump(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False, default=str)


def _load(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return default


# 处理器结果状态 -> 节点状态
_RESULT_TO_NODE = {
    R_COMPLETED: state.NODE_COMPLETED,
    R_INSUFFICIENT: state.NODE_SKIPPED,
    R_SKIPPED: state.NODE_SKIPPED,
    R_FAILED: state.NODE_FAILED,
}


class OrchestrationService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # 基础读取

    async def _get_workflow(self, workflow_id: str) -> Workflow:
        wf = (await self.db.execute(
            select(Workflow).where(Workflow.id == workflow_id)
        )).scalar_one_or_none()
        if wf is None:
            raise AppError("NOT_FOUND", "工作流不存在。")
        return wf

    async def _get_node(self, workflow_id: str, node_id: str) -> WorkflowNode:
        node = (await self.db.execute(
            select(WorkflowNode).where(
                WorkflowNode.id == node_id, WorkflowNode.workflow_id == workflow_id,
            )
        )).scalar_one_or_none()
        if node is None:
            raise AppError("NOT_FOUND", "工作流节点不存在。")
        return node

    async def _nodes_of(self, workflow_id: str) -> list[WorkflowNode]:
        rows = (await self.db.execute(
            select(WorkflowNode).where(WorkflowNode.workflow_id == workflow_id)
            .order_by(WorkflowNode.created_at, WorkflowNode.id)
        )).scalars().all()
        return list(rows)

    async def _event(self, wf: Workflow, node: WorkflowNode | None,
                     event_type: str, message: str, payload: Any = None,
                     user_id: str | None = None) -> None:
        self.db.add(WorkflowEvent(
            id=f"wevt-{uuid.uuid4().hex[:16]}", workflow_id=wf.id,
            node_id=node.id if node else None, project_id=wf.project_id,
            event_type=event_type, message=message, payload_json=_dump(payload),
            actor_user_id=user_id,
        ))

    async def _trail(self, wf: Workflow, node: WorkflowNode | None, action: str,
                     summary: str, before: Any = None, after: Any = None,
                     user_id: str | None = None) -> None:
        await record_trail(
            self.db, action=action, actor_user_id=user_id, project_id=wf.project_id,
            target_type="workflow_node" if node else "workflow",
            target_id=node.id if node else wf.id,
            before=before, after=after, summary=summary,
        )

    # 上下文与前置条件

    async def _build_context(self, project_id: str) -> dict[str, Any]:
        materials = list((await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all())
        facts = list((await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        )).scalars().all())
        available, _reason = ExecutionSandbox.sandbox_available()
        return {
            "materials": [{
                "id": m.id, "source_name": m.source_name,
                "material_type": m.material_type, "parse_status": m.parse_status,
            } for m in materials],
            "facts": [{
                "field_key": normalize_field_key(f.field_key)[0],
                "fact_id": f.fact_id or str(f.id), "material_id": f.material_id,
            } for f in facts],
            "sandbox_available": available,
        }

    # 创建工作流

    async def create_from_template(
        self, project_id: str, template_key: str, *, title: str | None = None,
        node_overrides: dict[str, dict[str, Any]] | None = None,
        user_id: str | None = None, nl_query: str | None = None,
        idem_key: str | None = None,
    ) -> Workflow:
        template = get_template(template_key)
        if template is None:
            raise AppError("VALIDATION_ERROR", f"未知模板：{template_key}")
        nodes = [dict(n) for n in template["nodes"]]
        for node in nodes:
            override = (node_overrides or {}).get(node["node_key"]) or {}
            node.update(override)
        return await self._persist(
            project_id=project_id, title=title or template["name"],
            description=template["description"], source="template",
            template_key=template_key, nodes=nodes, user_id=user_id,
            nl_query=nl_query, idem_key=idem_key,
        )

    async def create_manual(
        self, project_id: str, title: str, nodes: list[dict[str, Any]], *,
        description: str = "", user_id: str | None = None,
        nl_query: str | None = None, idem_key: str | None = None,
    ) -> Workflow:
        return await self._persist(
            project_id=project_id, title=title, description=description,
            source="manual", template_key=None, nodes=nodes, user_id=user_id,
            nl_query=nl_query, idem_key=idem_key,
        )

    async def _persist(
        self, *, project_id: str, title: str, description: str, source: str,
        template_key: str | None, nodes: list[dict[str, Any]],
        user_id: str | None, nl_query: str | None, idem_key: str | None,
    ) -> Workflow:
        if not nodes:
            raise AppError("VALIDATION_ERROR", "工作流至少需要一个节点。")

        # DAG 校验：未知依赖 / 重复 key / 循环
        topo, errors = state.topo_sort(nodes)
        if errors:
            raise AppError("DAG_INVALID", "工作流依赖校验失败。", {"errors": errors})

        key = idem_key or f"{project_id}:{source}:{template_key or title}"
        existing = (await self.db.execute(
            select(Workflow).where(
                Workflow.idem_key == key,
                Workflow.status.in_([state.WF_DRAFT, state.WF_PENDING, state.WF_RUNNING,
                                     state.WF_PAUSED, state.WF_AWAITING_CONFIRMATION]),
            )
        )).scalars().first()
        if existing is not None:
            return existing

        wf = Workflow(
            id=f"wf-{uuid.uuid4().hex[:16]}", project_id=project_id, title=title,
            description=description, source=source, template_key=template_key,
            status=state.WF_DRAFT, priority=5, requested_by_user_id=user_id,
            nl_query=nl_query, context_json=None, idem_key=key,
        )
        self.db.add(wf)
        await self.db.flush()

        for n in nodes:
            self.db.add(WorkflowNode(
                id=f"wnode-{uuid.uuid4().hex[:16]}", workflow_id=wf.id,
                project_id=project_id, node_key=n["node_key"],
                title=n.get("title") or n["node_key"],
                description=n.get("description", ""),
                node_type=n.get("node_type", "check"), handler=n.get("handler", ""),
                depends_on_json=_dump(n.get("depends_on", [])) or "[]",
                preconditions_json=_dump(n.get("preconditions", {})) or "{}",
                required_materials_json=_dump(n.get("required_materials", [])) or "[]",
                action=n.get("action", ""), expected_result=n.get("expected_result", ""),
                acceptance_criteria=n.get("acceptance_criteria", ""),
                evidence_targets_json=_dump(n.get("evidence_targets", [])) or "[]",
                risk_level=n.get("risk_level", "low"),
                priority=int(n.get("priority") or 5),
                max_retries=int(n.get("max_retries") or 0),
                status=state.NODE_PENDING,
                needs_human_confirm=bool(n.get("needs_human_confirm", False)),
                timeout_seconds=int(n.get("timeout_seconds") or settings.workflow_node_timeout_seconds),
            ))
        await self.db.flush()
        await self._event(wf, None, "workflow_created", f"工作流已创建：{title}",
                          {"template_key": template_key, "node_count": len(nodes)}, user_id)
        await self._trail(wf, None, "workflow.create", f"创建工作流：{title}",
                          after={"source": source, "template_key": template_key}, user_id=user_id)
        await self.db.commit()
        await self.db.refresh(wf)
        return wf

    # 调度与执行

    async def start(self, workflow_id: str, user_id: str | None = None) -> Workflow:
        wf = await self._get_workflow(workflow_id)
        if wf.status in state.WF_TERMINAL:
            raise AppError("INVALID_STATE", "终态工作流不可启动。", status_code=409)
        wf.status = state.WF_PENDING
        wf.started_at = wf.started_at or _now()
        wf.heartbeat_at = _now()
        self.db.add(wf)
        await self._event(wf, None, "workflow_started", "工作流启动", user_id=user_id)
        await self._trail(wf, None, "workflow.start", "启动工作流", user_id=user_id)
        await self.db.commit()
        return await self.advance(workflow_id, user_id=user_id)

    async def advance(self, workflow_id: str, user_id: str | None = None) -> Workflow:
        """推进一轮调度：刷新阻断状态 → 选就绪节点 → 执行/等待确认。"""
        wf = await self._get_workflow(workflow_id)
        if wf.status in state.WF_TERMINAL or wf.cancel_requested:
            return wf
        if wf.status == state.WF_PAUSED:
            return wf

        context = await self._build_context(wf.project_id)
        cap = max(1, settings.workflow_max_concurrent_nodes)

        # 逐轮排空：每轮按并发上限执行就绪节点；节点状态变化后重新计算拓扑与就绪集，
        # 直到本轮没有可执行的非确认节点为止。人工确认节点停在等待态，不自动放行。
        while True:
            nodes = await self._nodes_of(workflow_id)
            if not nodes:
                raise AppError("VALIDATION_ERROR", "工作流没有节点。")
            node_dicts = [self._node_dict(n) for n in nodes]
            topo, errors = state.topo_sort(node_dicts)
            if errors:
                raise AppError("DAG_INVALID", "工作流依赖结构异常。", {"errors": errors})

            ready, reasons = state.ready_nodes(node_dicts, topo, context)
            by_id = {n.id: n for n in nodes}
            for n in nodes:
                nd = self._node_dict(n)
                if nd["status"] in state.NODE_TERMINAL or nd["status"] == state.NODE_AWAITING_CONFIRMATION:
                    continue
                unmet = reasons.get(nd["node_key"])
                if unmet and nd["status"] != state.NODE_BLOCKED:
                    n.status = state.NODE_BLOCKED
                    n.result_json = _dump({"precondition_reasons": unmet})
                    self.db.add(n)
                    await self._event(wf, n, "node_blocked", "前置条件未满足", {"reasons": unmet}, user_id)
                elif not unmet and nd["status"] == state.NODE_BLOCKED:
                    n.status = state.NODE_PENDING
                    self.db.add(n)

            if not ready:
                break
            progressed = False
            slots = cap
            for nd in ready:
                if slots <= 0:
                    break
                node = by_id[nd["id"]]
                if node.needs_human_confirm or (
                    node.node_type == "human_confirm" and node.confirmed_at is None
                ):
                    await self._await_confirmation(wf, node, user_id)
                    continue
                await self._execute_node(wf, node, context, user_id)
                slots -= 1
                progressed = True
            if not progressed:
                break

        nodes = await self._nodes_of(workflow_id)
        agg = state.aggregate_status([self._node_dict(n) for n in nodes],
                                    cancel_requested=wf.cancel_requested)
        wf.status = agg
        wf.heartbeat_at = _now()
        if agg in state.WF_TERMINAL:
            wf.finished_at = _now()
        self.db.add(wf)
        await self.db.commit()
        return wf

    async def _await_confirmation(self, wf: Workflow, node: WorkflowNode,
                                  user_id: str | None) -> None:
        node.status = state.NODE_AWAITING_CONFIRMATION
        node.heartbeat_at = _now()
        self.db.add(node)
        await self._event(wf, node, "awaiting_confirmation",
                          "节点等待人工确认（高风险操作不自动执行）",
                          {"action": node.action}, user_id)
        await self._trail(wf, node, "workflow.await_confirm",
                          f"节点 {node.node_key} 等待人工确认", user_id=user_id)

    async def _execute_node(self, wf: Workflow, node: WorkflowNode,
                            context: dict[str, Any], user_id: str | None) -> None:
        attempt_no = (node.attempt_count or 0) + 1
        node.attempt_count = attempt_no
        node.status = state.NODE_RUNNING
        node.started_at = node.started_at or _now()
        node.heartbeat_at = _now()
        node.error_code = None
        node.error_message = None
        self.db.add(node)
        await self.db.flush()

        attempt = NodeAttempt(
            id=f"attempt-{uuid.uuid4().hex[:16]}", node_id=node.id, workflow_id=wf.id,
            project_id=wf.project_id, attempt_no=attempt_no, status=state.NODE_RUNNING,
            handler=node.handler, actor_user_id=user_id, started_at=_now(),
            resource_json=_dump({
                "timeout_seconds": node.timeout_seconds,
                "max_retries": node.max_retries,
                "concurrent_cap": settings.workflow_max_concurrent_nodes,
            }),
        )
        self.db.add(attempt)
        await self.db.flush()

        t0 = time.perf_counter()
        ctx = HandlerContext(db=self.db, project_id=wf.project_id,
                             node=self._node_dict(node), user_id=user_id)
        result = await run_handler(ctx)
        duration_ms = int((time.perf_counter() - t0) * 1000)

        attempt.status = _RESULT_TO_NODE.get(result.status, state.NODE_FAILED)
        attempt.finished_at = _now()
        attempt.duration_ms = duration_ms
        attempt.log_excerpt = result.summary[:1000]
        attempt.error_code = result.error_code
        attempt.error_message = result.error_message
        attempt.result_json = _dump(result.result)
        self.db.add(attempt)

        node.heartbeat_at = _now()
        node.finished_at = _now()
        node.result_json = _dump({"handler_status": result.status, "summary": result.summary,
                                   "result": result.result, "evidence": result.evidence})

        if result.status == R_FAILED:
            await self._handle_failure(wf, node, attempt, result, user_id)
        else:
            node.status = _RESULT_TO_NODE[result.status]
            node.error_code = result.error_code
            node.error_message = result.error_message
            self.db.add(node)
            await self._event(wf, node, "node_finished", result.summary,
                              {"status": node.status, "attempt": attempt_no}, user_id)
            await self._trail(wf, node, "workflow.node_complete",
                              f"节点 {node.node_key} 完成：{node.status}",
                              after={"status": node.status, "summary": result.summary},
                              user_id=user_id)

    async def _handle_failure(self, wf: Workflow, node: WorkflowNode,
                              attempt: NodeAttempt, result: Any, user_id: str | None) -> None:
        retryable = (node.retry_count or 0) < (node.max_retries or 0)
        node.error_code = result.error_code or "HANDLER_ERROR"
        node.error_message = result.error_message
        if retryable:
            node.retry_count = (node.retry_count or 0) + 1
            node.status = state.NODE_PENDING
            node.finished_at = None
            await self._event(wf, node, "node_retry_scheduled",
                              f"失败，安排第 {node.retry_count} 次重试",
                              {"error_code": node.error_code}, user_id)
        else:
            node.status = state.NODE_FAILED
            node.failure_category = result.error_code or "unknown"
            await self._event(wf, node, "node_failed", result.error_message or "节点失败",
                              {"error_code": node.error_code, "attempt": attempt.attempt_no}, user_id)
            await self._trail(wf, node, "workflow.node_failed",
                              f"节点 {node.node_key} 失败：{node.error_code}",
                              after={"error_code": node.error_code, "attempt": attempt.attempt_no},
                              user_id=user_id)
        self.db.add(node)

    # 控制操作

    async def pause(self, workflow_id: str, user_id: str | None = None) -> Workflow:
        wf = await self._get_workflow(workflow_id)
        if wf.status not in (state.WF_PENDING, state.WF_RUNNING, state.WF_AWAITING_CONFIRMATION):
            raise AppError("INVALID_STATE", "仅排队/运行/待确认的工作流可暂停。", status_code=409)
        wf.status = state.WF_PAUSED
        self.db.add(wf)
        await self._event(wf, None, "workflow_paused", "工作流已暂停，在下一边界停止推进", user_id=user_id)
        await self._trail(wf, None, "workflow.pause", "暂停工作流", user_id=user_id)
        await self.db.commit()
        return wf

    async def resume(self, workflow_id: str, user_id: str | None = None) -> Workflow:
        wf = await self._get_workflow(workflow_id)
        if wf.status != state.WF_PAUSED:
            raise AppError("INVALID_STATE", "仅已暂停的工作流可恢复。", status_code=409)
        wf.status = state.WF_PENDING
        wf.heartbeat_at = _now()
        self.db.add(wf)
        await self._event(wf, None, "workflow_resumed", "工作流已恢复，等待重新调度", user_id=user_id)
        await self._trail(wf, None, "workflow.resume", "恢复工作流", user_id=user_id)
        await self.db.commit()
        return await self.advance(workflow_id, user_id=user_id)

    async def cancel(self, workflow_id: str, user_id: str | None = None) -> dict:
        wf = await self._get_workflow(workflow_id)
        if wf.status in state.WF_TERMINAL:
            return {"cancelled": False, "status": wf.status, "reason": "工作流已结束"}
        wf.cancel_requested = True
        wf.status = state.WF_CANCELLED
        wf.finished_at = _now()
        nodes = await self._nodes_of(workflow_id)
        for n in nodes:
            if n.status not in state.NODE_TERMINAL:
                n.status = state.NODE_CANCELLED
                n.finished_at = _now()
                self.db.add(n)
        self.db.add(wf)
        await self._event(wf, None, "workflow_cancelled", "工作流已取消", user_id=user_id)
        await self._trail(wf, None, "workflow.cancel", "取消工作流", user_id=user_id)
        await self.db.commit()
        return {"cancelled": True, "status": state.WF_CANCELLED}

    async def retry_node(
        self, workflow_id: str, node_id: str, user_id: str | None = None,
    ) -> WorkflowNode:
        node = await self._get_node(workflow_id, node_id)
        if node.status != state.NODE_FAILED:
            raise AppError("INVALID_STATE", "仅失败节点可重试。", status_code=409)
        node.status = state.NODE_PENDING
        node.error_code = None
        node.error_message = None
        node.failure_category = ""
        node.finished_at = None
        node.heartbeat_at = _now()
        self.db.add(node)
        wf = await self._get_workflow(node.workflow_id)
        # 工作流此前因该节点失败进入终态；手动重试需先把工作流拉回排队态再重新调度。
        if wf.status in state.WF_TERMINAL:
            wf.status = state.WF_PENDING
            wf.finished_at = None
            wf.heartbeat_at = _now()
            self.db.add(wf)
        await self._event(wf, node, "node_retry", "节点已手动重试", user_id=user_id)
        await self.db.commit()
        await self.advance(node.workflow_id, user_id=user_id)
        return node

    async def confirm_node(self, workflow_id: str, node_id: str, decision: str, *,
                           note: str = "", user_id: str | None = None) -> WorkflowNode:
        node = await self._get_node(workflow_id, node_id)
        if node.status != state.NODE_AWAITING_CONFIRMATION:
            raise AppError("INVALID_STATE", "仅等待确认的节点可审批。", status_code=409)
        if decision not in ("approved", "rejected"):
            raise AppError("VALIDATION_ERROR", "decision 必须为 approved 或 rejected。")
        wf = await self._get_workflow(node.workflow_id)
        node.confirmed_by = user_id
        node.confirmed_at = _now()
        if decision == "approved":
            node.status = state.NODE_PENDING
            node.needs_human_confirm = False
            await self._event(wf, node, "node_confirmed", f"人工批准：{note or '放行执行'}",
                              {"decision": decision}, user_id)
            await self._trail(wf, node, "workflow.node_approve",
                              f"批准节点 {node.node_key}", after={"decision": decision}, user_id=user_id)
        else:
            node.status = state.NODE_SKIPPED
            node.finished_at = _now()
            await self._event(wf, node, "node_rejected", f"人工拒绝：{note or '跳过该节点'}",
                              {"decision": decision}, user_id)
            await self._trail(wf, node, "workflow.node_reject",
                              f"拒绝节点 {node.node_key}", after={"decision": decision}, user_id=user_id)
        self.db.add(node)
        await self.db.commit()
        await self.advance(wf.id, user_id=user_id)
        return node

    # 历史与恢复

    async def recover_stale(self, stale_minutes: int | None = None,
                            project_id: str | None = None) -> int:
        threshold = _now() - timedelta(minutes=stale_minutes or settings.workflow_stale_minutes)
        stmt = select(WorkflowNode).where(WorkflowNode.status == state.NODE_RUNNING)
        if project_id:
            stmt = stmt.where(WorkflowNode.project_id == project_id)
        rows = (await self.db.execute(stmt)).scalars().all()
        recovered = 0
        for n in rows:
            heartbeat = _as_utc(n.heartbeat_at) or _as_utc(n.created_at)
            if heartbeat and heartbeat >= threshold:
                continue
            n.status = state.NODE_FAILED
            n.error_code = "STALE_RECOVERED"
            n.error_message = "节点心跳过期，已由服务重启恢复流程终止。"
            n.failure_category = "stale"
            n.finished_at = _now()
            self.db.add(n)
            recovered += 1
        if recovered:
            await self.db.commit()
        return recovered

    # 序列化视图

    @staticmethod
    def _node_dict(n: WorkflowNode) -> dict[str, Any]:
        return {
            "id": n.id, "node_key": n.node_key, "title": n.title,
            "description": n.description, "node_type": n.node_type, "handler": n.handler,
            "depends_on": _load(n.depends_on_json, []),
            "preconditions": _load(n.preconditions_json, {}),
            "priority": n.priority, "status": n.status,
            "needs_human_confirm": n.needs_human_confirm,
            "max_retries": n.max_retries, "retry_count": n.retry_count,
            "evidence_targets": _load(n.evidence_targets_json, []),
        }

    async def workflow_view(self, workflow_id: str) -> dict[str, Any]:
        wf = await self._get_workflow(workflow_id)
        nodes = await self._nodes_of(workflow_id)
        attempts = (await self.db.execute(
            select(NodeAttempt).where(NodeAttempt.workflow_id == workflow_id)
            .order_by(NodeAttempt.created_at)
        )).scalars().all()
        events = (await self.db.execute(
            select(WorkflowEvent).where(WorkflowEvent.workflow_id == workflow_id)
            .order_by(WorkflowEvent.created_at)
        )).scalars().all()
        return {
            "workflow": self._wf_view(wf),
            "nodes": [self._node_view(n, [a for a in attempts if a.node_id == n.id]) for n in nodes],
            "events": [self._event_view(e) for e in events],
        }

    def _wf_view(self, wf: Workflow) -> dict[str, Any]:
        return {
            "id": wf.id, "project_id": wf.project_id, "title": wf.title,
            "description": wf.description, "source": wf.source,
            "template_key": wf.template_key, "status": wf.status,
            "priority": wf.priority, "nl_query": wf.nl_query,
            "cancel_requested": wf.cancel_requested,
            "error_code": wf.error_code, "error_message": wf.error_message,
            "started_at": wf.started_at.isoformat() if wf.started_at else None,
            "finished_at": wf.finished_at.isoformat() if wf.finished_at else None,
            "created_at": wf.created_at.isoformat() if wf.created_at else "",
        }

    def _node_view(self, n: WorkflowNode, attempts: list[NodeAttempt]) -> dict[str, Any]:
        return {
            "id": n.id, "node_key": n.node_key, "title": n.title,
            "description": n.description, "node_type": n.node_type, "handler": n.handler,
            "depends_on": _load(n.depends_on_json, []),
            "preconditions": _load(n.preconditions_json, {}),
            "action": n.action, "expected_result": n.expected_result,
            "acceptance_criteria": n.acceptance_criteria,
            "evidence_targets": _load(n.evidence_targets_json, []),
            "risk_level": n.risk_level, "priority": n.priority,
            "status": n.status, "needs_human_confirm": n.needs_human_confirm,
            "max_retries": n.max_retries, "retry_count": n.retry_count,
            "attempt_count": n.attempt_count,
            "confirmed_by": n.confirmed_by,
            "confirmed_at": n.confirmed_at.isoformat() if n.confirmed_at else None,
            "result": _load(n.result_json, None),
            "error_code": n.error_code, "error_message": n.error_message,
            "failure_category": n.failure_category,
            "started_at": n.started_at.isoformat() if n.started_at else None,
            "finished_at": n.finished_at.isoformat() if n.finished_at else None,
            "attempts": [self._attempt_view(a) for a in attempts],
        }

    @staticmethod
    def _attempt_view(a: NodeAttempt) -> dict[str, Any]:
        return {
            "id": a.id, "attempt_no": a.attempt_no, "status": a.status,
            "handler": a.handler, "log_excerpt": a.log_excerpt,
            "error_code": a.error_code, "error_message": a.error_message,
            "result": _load(a.result_json, None),
            "resource": _load(a.resource_json, None),
            "duration_ms": a.duration_ms,
            "started_at": a.started_at.isoformat() if a.started_at else None,
            "finished_at": a.finished_at.isoformat() if a.finished_at else None,
        }

    @staticmethod
    def _event_view(e: WorkflowEvent) -> dict[str, Any]:
        return {
            "id": e.id, "node_id": e.node_id, "event_type": e.event_type,
            "message": e.message, "payload": _load(e.payload_json, None),
            "actor_user_id": e.actor_user_id,
            "created_at": e.created_at.isoformat() if e.created_at else "",
        }
