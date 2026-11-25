"""AI 失败诊断与修复建议闭环（复用现有 LLMService）。

无 Key 时明确报 AI 不可用，绝不返回预设诊断。
默认不得未经授权修改用户原始文件；涉及研究条件变更必须标记。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import AppError
from app.llm import LLMService, llm_service
from app.modelhub.bridge import TaskLLM
from app.models import ExtractedFact
from app.models.stage4 import (
    ExecutionEnvironment,
    ExecutionLog,
    FailureDiagnostic,
    RemediationProposal,
    RemediationReview,
    ReproductionRun,
)
from app.reproduction.adapter import Stage3AuditAdapter, SOURCE_NOTE
from app.reproduction.prompts import PROMPT_VERSIONS, build_diagnosis_messages
from app.reproduction.schemas import DiagnosticIn


class FailureDiagnoser:
    def __init__(self, db: AsyncSession, llm: LLMService | None = None) -> None:
        self.db = db
        self.llm = llm or TaskLLM(db, "failure_diagnosis")
        self.adapter = Stage3AuditAdapter(db)

    async def diagnose(self, run_id: str, project_id: str, problem: str | None = None) -> FailureDiagnostic:
        # 匿名/环境变量无 Key 时保持原有的 503 语义；已登录用户可由网关解析自己的绑定。
        from app.modelhub.context import current_user_id
        if not settings.is_llm_configured and not current_user_id.get():
            raise AppError("LLM_KEY_NOT_CONFIGURED",
                           "AI 诊断不可用：尚未配置真实 API Key，未生成任何诊断结论。")
        run = (await self.db.execute(
            select(ReproductionRun).where(ReproductionRun.id == run_id)
        )).scalar_one_or_none()
        if run is None:
            raise AppError("NOT_FOUND", "运行记录不存在。")
        if run.project_id != project_id:
            raise AppError("FORBIDDEN", "无权访问其他项目的运行记录。")

        logs = (await self.db.execute(
            select(ExecutionLog).where(ExecutionLog.run_id == run_id)
            .order_by(ExecutionLog.created_at).limit(200)
        )).scalars().all()
        env = (await self.db.execute(
            select(ExecutionEnvironment).where(ExecutionEnvironment.id == run.environment_id)
        )).scalar_one_or_none()
        facts = (await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id).limit(40)
        )).scalars().all()
        audit = await self.adapter.get_audit_view(project_id)

        log_text = "\n".join(f"[{l.stream}] {l.content}" for l in logs)
        evidence = {
            "logs": log_text[:3000] or run.error_message or "（无日志，执行可能被安全策略阻断）",
            "environment": (env.missing_json or "[]") + " " + (env.warnings_json or "[]"),
            "facts": json.dumps([{
                "field": f.field_key, "value": f.normalized_value or f.raw_value,
                "assertion": f.assertion_type,
            } for f in facts[:20]], ensure_ascii=False),
        }
        problem_text = problem or f"运行 {run_id} 状态：{run.status}。{run.error_message or ''}"
        messages = build_diagnosis_messages(problem_text + f"\n数据来源：{SOURCE_NOTE}", evidence)
        resp = await self.llm.chat(messages, response_schema=DiagnosticIn)
        diag: DiagnosticIn | None = resp.parsed
        if diag is None:
            raise AppError("LLM_INVALID_FORMAT", "模型未返回有效诊断结构。")

        diag_id = f"diag-{uuid.uuid4().hex[:14]}"
        row = FailureDiagnostic(
            id=diag_id, run_id=run_id, project_id=project_id,
            problem=diag.problem, error_evidence=diag.error_evidence,
            possible_causes_json=json.dumps(
                [c.model_dump() for c in diag.possible_causes], ensure_ascii=False),
            suggested_fix=diag.suggested_fix,
            verification_method=diag.verification_method,
            needs_human_confirm=True, ai_available=True,
            prompt_version=PROMPT_VERSIONS["failure_diagnosis"],
        )
        self.db.add(row)
        await self.db.flush()

        # 从建议中提取潜在修复提案（默认 pending，需人工审核，不改原文件）
        fix_text = diag.suggested_fix
        if fix_text:
            change_type = "other"
            if any(k in fix_text for k in ("版本", "version", "依赖")):
                change_type = "dependency"
            elif any(k in fix_text for k in ("路径", "path")):
                change_type = "data_path"
            elif any(k in fix_text for k in ("参数", "param", "学习率", "batch")):
                change_type = "parameter"
            elif any(k in fix_text for k in ("命令", "command", "python ")):
                change_type = "command"
            changes_research = change_type in ("parameter", "data_path")
            self.db.add(RemediationProposal(
                id=f"rem-{uuid.uuid4().hex[:14]}", diagnostic_id=diag_id,
                project_id=project_id, change_type=change_type,
                proposed_value=fix_text[:2000],
                changes_research_conditions=changes_research,
                status="pending",
            ))
        await self.db.commit()
        return row

    async def review_remediation(self, proposal_id: str, *, decision: str,
                                 reviewer: str, note: str = "",
                                 modified_value: str | None = None) -> RemediationReview:
        if decision not in ("approve", "reject", "modify"):
            raise AppError("VALIDATION_ERROR", "审核决定必须是 approve/reject/modify。")
        proposal = (await self.db.execute(
            select(RemediationProposal).where(RemediationProposal.id == proposal_id)
        )).scalar_one_or_none()
        if proposal is None:
            raise AppError("NOT_FOUND", "修复建议不存在。")
        if proposal.changes_research_conditions and decision == "approve":
            note = (note + "；注意：该修改可能改变原始研究条件，不能称为严格复现").strip("；")
        review = RemediationReview(
            id=f"rev-{uuid.uuid4().hex[:14]}", proposal_id=proposal_id,
            decision=decision, reviewer=reviewer, note=note,
            modified_value=modified_value, original_preserved=True,
        )
        proposal.status = {"approve": "approved", "reject": "rejected", "modify": "modified"}[decision]
        self.db.add_all([review, proposal])
        await self.db.commit()
        return review
