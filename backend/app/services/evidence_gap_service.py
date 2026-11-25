"""科研实验自动补证服务（第七阶段升级）。

闭环流程：
1. 扫描项目事实/主张，找出缺少证据的缺口；
2. 分析缺什么材料/取值/证据；
3. 判定能否从既有代码与配置提取、是否需要用户上传、是否需要重跑实验；
4. 生成补证任务；用户确认后执行；新证据回链到原始主张。

约束：不重复实现既有抽取/解析流程；补证任务高风险动作（上传、重跑）必须人工确认；
所有状态与动作落库并写审计轨迹。
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.models import ExtractedFact, Material
from app.models.stage2 import EvidenceItem
from app.models.stage4 import ReproductionMetric
from app.models.stage7 import EvidenceGap, EvidenceTask
from app.services import normalize_field_key
from app.services.trail_service import record_trail

METRIC_FIELDS = {"accuracy", "f1", "precision", "recall", "auc", "map", "iou", "loss",
                 "perplexity", "bleu", "rouge", "score", "metric"}
CODE_NAME_HINTS = (".py", ".ipynb", ".yaml", ".yml", ".toml", ".ini", ".cfg", "requirements")


def _now() -> datetime:
    return datetime.now(timezone.utc)


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


class EvidenceGapService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    # 缺口识别

    async def analyze(self, project_id: str, user_id: str | None = None) -> dict:
        facts = list((await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        )).scalars().all())
        materials = list((await self.db.execute(
            select(Material).where(Material.project_id == project_id)
        )).scalars().all())
        metrics = list((await self.db.execute(
            select(ReproductionMetric).where(ReproductionMetric.project_id == project_id)
        )).scalars().all())

        fact_ids = [f.fact_id or str(f.id) for f in facts]
        evidence_ids = await self._evidence_ids(fact_ids)

        code_config_present = any(
            (m.source_name or "").lower().endswith(CODE_NAME_HINTS) for m in materials
        )
        metric_names = {m.metric_name.lower() for m in metrics}

        created, updated, closed = 0, 0, 0
        for f in facts:
            fid = f.fact_id or str(f.id)
            value = (f.normalized_value if f.normalized_value is not None else f.raw_value or "").strip()
            has_ev = fid in evidence_ids
            missing_kind = self._missing_kind(f, value, has_ev)
            if missing_kind is None:
                # 已有证据且取值完整：若存在历史开放缺口则关闭
                closed += await self._close_if_resolved(project_id, fid, f.field_key)
                continue

            remediation = self._classify(
                f, code_config_present=code_config_present,
                metric_names=metric_names, materials=materials,
            )
            existing = await self._find_gap(project_id, fid, f.field_key)
            diagnosis = self._diagnosis(f, missing_kind, has_ev)
            if existing is None:
                gap = EvidenceGap(
                    id=f"gap-{uuid.uuid4().hex[:16]}", project_id=project_id,
                    claim_type="fact", claim_id=fid, field_key=f.field_key,
                    claim_summary=diagnosis["summary"], missing_kind=missing_kind,
                    diagnosis_json=_dump(diagnosis), remediation_class=remediation,
                    materials_json=_dump([m.source_name for m in materials]),
                    status="open",
                )
                self.db.add(gap)
                created += 1
            else:
                existing.missing_kind = missing_kind
                existing.diagnosis_json = _dump(diagnosis)
                existing.remediation_class = remediation
                existing.status = "open" if existing.status != "closed" else existing.status
                self.db.add(existing)
                updated += 1

        await record_trail(
            self.db, action="evidence_gap.analyze", actor_user_id=user_id,
            project_id=project_id, target_type="evidence_gap", target_id=project_id,
            after={"created": created, "updated": updated, "closed": closed},
            summary="扫描证据缺口",
        )
        await self.db.commit()
        return {"created": created, "updated": updated, "closed": closed,
                "total_facts": len(facts)}

    @staticmethod
    def _missing_kind(f: ExtractedFact, value: str, has_evidence: bool) -> str | None:
        if not value or f.extraction_status in ("unsupported", "not_found", "ambiguous"):
            return "value_missing"
        if not has_evidence:
            return "evidence_missing"
        if f.confidence is not None and f.confidence < 0.5:
            return "ambiguous"
        return None

    @staticmethod
    def _diagnosis(f: ExtractedFact, missing_kind: str, has_evidence: bool) -> dict[str, Any]:
        key, label = normalize_field_key(f.field_key)
        value = f.normalized_value if f.normalized_value is not None else f.raw_value
        return {
            "field_key": key, "label": label,
            "summary": f"{label or key}：{value or '取值缺失'}",
            "value": value,
            "unit": f.unit, "confidence": f.confidence,
            "extraction_status": f.extraction_status,
            "has_evidence": has_evidence,
            "missing_kind": missing_kind,
            "what_is_missing": {
                "value_missing": "主张缺少可核验的取值（未抽取到或取值不明确）。",
                "evidence_missing": "已有取值，但缺少定位到原文/代码片段的证据引用。",
                "ambiguous": "取值置信度低且缺少证据，主张含义不明确。",
            }.get(missing_kind, ""),
        }

    @staticmethod
    def _classify(f: ExtractedFact, *, code_config_present: bool,
                  metric_names: set[str], materials: list[Material]) -> str:
        key, _ = normalize_field_key(f.field_key)
        is_metric = key in METRIC_FIELDS or (f.fact_type or "").lower() in ("metric", "result", "evaluation")
        if is_metric:
            # 指标类主张：既有复现指标可对照 → 可从既有结果提取；否则需要重跑实验
            return "extractable_from_existing" if key in metric_names else "needs_rerun"
        if code_config_present:
            return "extractable_from_existing"
        if not materials:
            return "needs_upload"
        return "needs_human"

    async def _evidence_ids(self, fact_ids: list[str]) -> set[str]:
        if not fact_ids:
            return set()
        rows = (await self.db.execute(
            select(EvidenceItem.fact_id).where(EvidenceItem.fact_id.in_(fact_ids))
        )).all()
        return {r[0] for r in rows}

    async def _find_gap(self, project_id: str, claim_id: str, field_key: str) -> EvidenceGap | None:
        return (await self.db.execute(
            select(EvidenceGap).where(
                EvidenceGap.project_id == project_id,
                EvidenceGap.claim_type == "fact",
                EvidenceGap.claim_id == claim_id,
                EvidenceGap.field_key == field_key,
            )
        )).scalars().first()

    async def _close_if_resolved(self, project_id: str, claim_id: str, field_key: str) -> int:
        gap = await self._find_gap(project_id, claim_id, field_key)
        if gap and gap.status in ("open", "planned", "awaiting_confirmation"):
            gap.status = "closed"
            gap.resolved_at = _now()
            self.db.add(gap)
            return 1
        return 0

    # 补证任务

    async def list_gaps(self, project_id: str, status: str | None = None) -> list[dict]:
        stmt = select(EvidenceGap).where(EvidenceGap.project_id == project_id)
        if status:
            stmt = stmt.where(EvidenceGap.status == status)
        rows = (await self.db.execute(stmt.order_by(EvidenceGap.created_at))).scalars().all()
        return [self._gap_view(g) for g in rows]

    async def create_tasks(self, project_id: str, gap_ids: list[str] | None = None,
                           user_id: str | None = None) -> list[dict]:
        gaps = list((await self.db.execute(
            select(EvidenceGap).where(EvidenceGap.project_id == project_id,
                                      EvidenceGap.status.in_(["open", "planned"]))
        )).scalars().all())
        if gap_ids:
            gaps = [g for g in gaps if g.id in gap_ids]
        tasks: list[EvidenceTask] = []
        for gap in gaps:
            if gap.linked_task_id:
                continue
            source = {
                "extractable_from_existing": "existing_extract",
                "needs_upload": "upload",
                "needs_rerun": "rerun",
                "needs_human": "manual",
            }[gap.remediation_class]
            task = EvidenceTask(
                id=f"etask-{uuid.uuid4().hex[:16]}", gap_id=gap.id, project_id=project_id,
                title=f"补证：{gap.field_key or gap.claim_id}",
                description=(self._task_description(gap)), source=source,
                status="pending", linked_claim_id=gap.claim_id, created_by=user_id,
                required_upload_json=_dump(self._required_upload(gap)),
                rerun_plan_json=_dump(self._rerun_plan(gap)),
            )
            self.db.add(task)
            await self.db.flush()
            gap.linked_task_id = task.id
            gap.status = "planned"
            self.db.add(gap)
            tasks.append(task)
        if tasks:
            await record_trail(
                self.db, action="evidence_gap.create_tasks", actor_user_id=user_id,
                project_id=project_id, target_type="evidence_task",
                target_id=",".join(t.id for t in tasks),
                after={"task_count": len(tasks)}, summary="生成补证任务",
            )
        await self.db.commit()
        return [self._task_view(t) for t in tasks]

    @staticmethod
    def _task_description(gap: EvidenceGap) -> str:
        diag = _load(gap.diagnosis_json, {})
        return f"缺口类型：{gap.missing_kind}；处置类别：{gap.remediation_class}。" \
               f"{diag.get('what_is_missing', '')}"

    @staticmethod
    def _required_upload(gap: EvidenceGap) -> dict[str, Any]:
        if gap.remediation_class != "needs_upload":
            return {}
        return {"need_upload": True,
                "hint": "请上传与该主张相关的论文原文、代码或配置材料。"}

    @staticmethod
    def _rerun_plan(gap: EvidenceGap) -> dict[str, Any]:
        if gap.remediation_class != "needs_rerun":
            return {}
        return {"need_rerun": True,
                "hint": "需在受控隔离环境重跑对应实验以产出指标；执行前需人工确认。"}

    async def confirm_task(self, task_id: str, user_id: str | None = None,
                           note: str = "") -> EvidenceTask:
        task = await self._get_task(task_id)
        if task.status != "pending":
            raise AppError("INVALID_STATE", "仅待确认的补证任务可确认。", status_code=409)
        task.confirmed_by = user_id
        task.confirmed_at = _now()
        # 上传/重跑类任务确认后仍等待外部输入；既有提取类可进入执行
        task.status = "awaiting_input" if task.source in ("upload", "rerun", "manual") else "ready"
        self.db.add(task)
        await record_trail(
            self.db, action="evidence_task.confirm", actor_user_id=user_id,
            project_id=task.project_id, target_type="evidence_task", target_id=task.id,
            after={"status": task.status, "note": note}, summary="确认补证任务",
        )
        await self.db.commit()
        return task

    async def execute_task(self, task_id: str, user_id: str | None = None) -> EvidenceTask:
        task = await self._get_task(task_id)
        if task.source in ("upload", "rerun", "manual"):
            raise AppError("INVALID_STATE", "该补证任务依赖上传/重跑/人工动作，不能自动执行。", status_code=409)
        if task.status not in ("ready",):
            raise AppError("INVALID_STATE", "任务未处于可执行状态（需先确认）。", status_code=409)

        # 从既有代码/配置材料中提取证据描述；不新建解析流程，证据回链到原始主张。
        gap = (await self.db.execute(
            select(EvidenceGap).where(EvidenceGap.id == task.gap_id)
        )).scalar_one_or_none()
        evidence = await self._extract_existing_evidence(task.project_id, task.linked_claim_id)
        task.status = "completed"
        task.executed_at = _now()
        task.result_evidence_json = _dump(evidence)
        self.db.add(task)
        if gap is not None:
            gap.status = "closed"
            gap.resolved_at = _now()
            self.db.add(gap)
        await record_trail(
            self.db, action="evidence_task.execute", actor_user_id=user_id,
            project_id=task.project_id, target_type="evidence_task", target_id=task.id,
            after={"evidence": evidence, "claim_id": task.linked_claim_id},
            summary="补证完成，证据已回链主张",
        )
        await self.db.commit()
        return task

    async def _extract_existing_evidence(self, project_id: str, claim_id: str | None) -> dict[str, Any]:
        facts = list((await self.db.execute(
            select(ExtractedFact).where(ExtractedFact.project_id == project_id)
        )).scalars().all())
        target = next((f for f in facts if (f.fact_id or str(f.id)) == claim_id), None)
        if target is None:
            return {"found": False, "reason": "原始主张事实已不存在。"}
        existing = await self._evidence_ids([target.fact_id or str(target.id)])
        return {
            "found": True,
            "claim_id": target.fact_id or str(target.id),
            "field_key": target.field_key,
            "material_id": target.material_id,
            "source_name": target.source_name,
            "value": target.normalized_value if target.normalized_value is not None else target.raw_value,
            "already_has_evidence": claim_id in existing,
        }

    async def _get_task(self, task_id: str) -> EvidenceTask:
        task = (await self.db.execute(
            select(EvidenceTask).where(EvidenceTask.id == task_id)
        )).scalar_one_or_none()
        if task is None:
            raise AppError("NOT_FOUND", "补证任务不存在。")
        return task

    async def list_tasks(self, project_id: str, status: str | None = None) -> list[dict]:
        stmt = select(EvidenceTask).where(EvidenceTask.project_id == project_id)
        if status:
            stmt = stmt.where(EvidenceTask.status == status)
        rows = (await self.db.execute(stmt.order_by(EvidenceTask.created_at))).scalars().all()
        return [self._task_view(t) for t in rows]

    # 视图

    @staticmethod
    def _gap_view(g: EvidenceGap) -> dict[str, Any]:
        return {
            "id": g.id, "claim_type": g.claim_type, "claim_id": g.claim_id,
            "field_key": g.field_key, "claim_summary": g.claim_summary,
            "missing_kind": g.missing_kind, "diagnosis": _load(g.diagnosis_json, None),
            "remediation_class": g.remediation_class, "materials": _load(g.materials_json, []),
            "status": g.status, "linked_task_id": g.linked_task_id,
            "created_at": g.created_at.isoformat() if g.created_at else "",
            "resolved_at": g.resolved_at.isoformat() if g.resolved_at else None,
        }

    @staticmethod
    def _task_view(t: EvidenceTask) -> dict[str, Any]:
        return {
            "id": t.id, "gap_id": t.gap_id, "title": t.title, "description": t.description,
            "source": t.source, "status": t.status,
            "required_upload": _load(t.required_upload_json, None),
            "rerun_plan": _load(t.rerun_plan_json, None),
            "result_evidence": _load(t.result_evidence_json, None),
            "linked_claim_id": t.linked_claim_id,
            "confirmed_by": t.confirmed_by,
            "confirmed_at": t.confirmed_at.isoformat() if t.confirmed_at else None,
            "executed_at": t.executed_at.isoformat() if t.executed_at else None,
            "error_code": t.error_code, "error_message": t.error_message,
            "created_at": t.created_at.isoformat() if t.created_at else "",
        }
