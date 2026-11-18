"""反向复现规划引擎：真实调用 LLMService → Pydantic 校验 → 程序可行性校验 → DAG → 落库。

无 Key 时明确抛 LLM_KEY_NOT_CONFIGURED，不返回任何假规划。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.llm import LLMService, llm_service
from app.models import Material
from app.models.stage4 import ReproductionPlan, ReproductionTask
from app.reproduction.adapter import SOURCE_NOTE, Stage3AuditAdapter, propagate_blocking, validate_dag
from app.reproduction.feasibility import check_feasibility
from app.reproduction.prompts import PROMPT_VERSIONS, build_planning_messages
from app.reproduction.schemas import ReproductionPlanIn


class PlanningError(AppError):
    def __init__(self, message: str, details=None):
        super().__init__("DAG_INVALID", message, details)


class ReproductionPlanner:
    def __init__(self, db: AsyncSession, llm: LLMService | None = None) -> None:
        self.db = db
        self.llm = llm or llm_service
        self.adapter = Stage3AuditAdapter(db)

    async def create_plan(self, project_id: str, title: str | None = None) -> ReproductionPlan:
        """AI 驱动生成复现规划；任何失败明确上抛，不伪造。"""
        if not settings.is_llm_configured:
            raise AppError("LLM_KEY_NOT_CONFIGURED",
                           "AI 复现规划不可用：尚未配置真实 API Key，未生成任何规划。")

        facts = await self.adapter.get_facts_view(project_id)
        audit = await self.adapter.get_audit_view(project_id)
        conflicts = await self.adapter.programmatic_conflicts(project_id)
        audit.extend({
            "title": f"程序化比对发现 {c['field_key']} 值不一致",
            "ai_explanation": f"值：{', '.join(c['values'])}（来源：{c['source']}）",
        } for c in conflicts[:10])

        messages = build_planning_messages(facts, audit, SOURCE_NOTE)
        resp = await self.llm.chat(messages, response_schema=ReproductionPlanIn)
        plan_in: ReproductionPlanIn | None = resp.parsed
        if plan_in is None or not plan_in.tasks:
            raise AppError("LLM_INVALID_FORMAT", "模型未返回任何有效复现任务，规划失败。")

        # DAG 结构校验
        task_dicts = [t.model_dump() for t in plan_in.tasks]
        topo, errors = validate_dag(task_dicts)
        if errors:
            raise PlanningError("；".join(errors), {"errors": errors})

        # 程序化可行性校验（AI 的 feasibility 仅作参考，程序规则覆盖）
        materials = (await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all()
        for t in task_dicts:
            program_feasibility, reason = check_feasibility(t, materials, facts)
            t["feasibility"] = program_feasibility
            t["feasibility_reason"] = f"程序校验：{reason}（AI 原判定：{t.get('feasibility')}）"

        task_dicts = propagate_blocking(task_dicts, topo)

        plan_id = f"rplan-{uuid.uuid4().hex[:16]}"
        summary: dict[str, int] = {}
        for t in task_dicts:
            summary[t["feasibility"]] = summary.get(t["feasibility"], 0) + 1
        plan = ReproductionPlan(
            id=plan_id, project_id=project_id,
            title=plan_in.title or title or "AI 反向复现规划",
            status="generated", source="ai", ai_available=True,
            prompt_version=PROMPT_VERSIONS["reproduction_planning"],
            model=resp.model,
            feasibility_summary_json=json.dumps(summary, ensure_ascii=False),
            source_refs_json=json.dumps({
                "source_note": SOURCE_NOTE,
                "fact_ids": [f["fact_id"] for f in facts[:50]],
                "audit_ids": [a["id"] for a in audit[:30]],
            }, ensure_ascii=False),
        )
        self.db.add(plan)
        await self.db.flush()
        for i, t in enumerate(task_dicts, start=1):
            self.db.add(ReproductionTask(
                id=f"rtask-{uuid.uuid4().hex[:16]}", plan_id=plan_id,
                project_id=project_id, task_key=t.get("task_key") or f"T{i:02d}",
                title=t["title"], description=t.get("description", ""),
                depends_on_json=json.dumps(t.get("depends_on", []), ensure_ascii=False),
                required_materials_json=json.dumps(t.get("required_materials", []), ensure_ascii=False),
                action=t.get("action", ""), expected_result=t.get("expected_result", ""),
                acceptance_criteria=t.get("acceptance_criteria", ""),
                evidence_refs_json=json.dumps(t.get("evidence_refs", []), ensure_ascii=False),
                risk=t.get("risk", ""), feasibility=t["feasibility"],
                feasibility_reason=t.get("feasibility_reason", ""),
                needs_human_confirm=bool(t.get("needs_human_confirm", True)),
                status="blocked" if t["feasibility"] in (
                    "missing_material", "missing_dependency", "missing_configuration",
                    "blocked_security", "unverifiable") else "pending",
            ))
        await self.db.commit()
        return plan

    async def add_manual_task(self, plan_id: str, payload: dict) -> ReproductionTask:
        """程序化新增任务（不调 AI）。"""
        plan = (await self.db.execute(
            select(ReproductionPlan).where(ReproductionPlan.id == plan_id)
        )).scalar_one_or_none()
        if plan is None:
            raise AppError("NOT_FOUND", "复现规划不存在。")
        exists = (await self.db.execute(
            select(ReproductionTask).where(ReproductionTask.plan_id == plan_id)
        )).scalars().all()
        task_key = payload.get("task_key") or f"T{len(exists)+1:02d}"
        if any(t.task_key == task_key for t in exists):
            raise AppError("VALIDATION_ERROR", "任务 key 已存在。")
        deps = payload.get("depends_on", []) or []
        known = {t.task_key for t in exists}
        if any(d not in known for d in deps):
            raise AppError("DAG_INVALID", "任务依赖了不存在的任务。")
        task = ReproductionTask(
            id=f"rtask-{uuid.uuid4().hex[:16]}", plan_id=plan_id,
            project_id=plan.project_id, task_key=task_key,
            title=payload["title"], description=payload.get("description", ""),
            depends_on_json=json.dumps(deps, ensure_ascii=False),
            required_materials_json=json.dumps(payload.get("required_materials", []), ensure_ascii=False),
            action=payload.get("action", ""), expected_result=payload.get("expected_result", ""),
            acceptance_criteria=payload.get("acceptance_criteria", ""),
            evidence_refs_json=json.dumps(payload.get("evidence_refs", []), ensure_ascii=False),
            risk=payload.get("risk", ""), feasibility="needs_human_review",
            feasibility_reason="人工新增任务，需确认",
            needs_human_confirm=bool(payload.get("needs_human_confirm", True)),
            status="pending",
        )
        self.db.add(task)
        await self.db.commit()
        return task
