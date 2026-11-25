"""第十二阶段 · 项目健康度确定性指标引擎。

七项指标全部由既有项目数据按固定规则计算，numerator/denominator 与数据来源逐项可追溯；
不调用大模型、不做主观打分。指标口径：

1. material_completeness  材料完整性：必备材料类别已上传数 / 必备类别总数。
2. evidence_completeness  证据完整性：已核验事实数 / 事实总数。
3. experiment_completion  实验完成度：已完成复现任务与实验数 / 总数。
4. environment_usability  环境可用性：依据环境登记、缺失依赖与告警判定档位。
5. unresolved_issues      未解决问题：待复核/待确认/阻塞/开放反馈计数与风险档位。
6. audit_risk             历史审计风险：按问题严重度、失败运行、开放反馈确定性加权。
7. handoff_completeness   交接完整度：最新交接记录状态 + 清单关闭比例。

所有阈值集中在本文件顶部，规则变更必须修改这里并在验收报告中记录，禁止运行时由 AI 调整。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access
from app.core.errors import AppError
from app.models import AuditFinding, ExtractedFact, Material
from app.models.stage2 import EvidenceItem, ParseTask
from app.models.stage4 import (
    ExecutionEnvironment,
    FailureDiagnostic,
    ReproductionMetric,
    ReproductionRun,
    ReproductionTask,
)
from app.models.stage6 import AuditFeedback
from app.models.stage12 import Experiment, HandoffRecord, ResearchTask

# 必备材料类别 -> 归入该类的 material_type
REQUIRED_MATERIAL_CATEGORIES: dict[str, tuple[str, ...]] = {
    "paper": ("pdf",),
    "code": ("python", "notebook", "zip"),
    "config": ("yaml", "json", "toml", "requirements"),
    "data": ("csv", "xlsx"),
    "docs": ("readme", "text"),
}

# 风险档位阈值（计数）
UNRESOLVED_LOW_MAX = 0
UNRESOLVED_MEDIUM_MAX = 5
AUDIT_WEIGHT = {"high": 3, "medium": 2, "low": 1}
AUDIT_LOW_MAX = 3
AUDIT_MEDIUM_MAX = 8

DONE_TASK_STATUSES = ("completed", "done", "skipped", "verified")
DONE_EXPERIMENT_STATUSES = ("completed",)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_list(value: str | None) -> list:
    try:
        parsed = json.loads(value or "[]")
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _level_from_score(score: float) -> str:
    if score >= 80:
        return "good"
    if score >= 50:
        return "warning"
    return "risk"


def _metric(key: str, label: str, score: float, rule: str, data_source: str,
            numerator: int, denominator: int, details: list[dict], level: str | None = None) -> dict:
    return {
        "key": key, "label": label, "score": round(max(0.0, min(100.0, score)), 1),
        "level": level or _level_from_score(score),
        "rule": rule, "data_source": data_source,
        "numerator": numerator, "denominator": denominator, "details": details,
    }


async def compute_health(db: AsyncSession, user, project_id: str) -> dict:
    proj = await resolve_project_access(db, project_id, user)

    # 1. 材料完整性
    materials = (await db.execute(select(Material).where(Material.project_id == project_id))).scalars().all()
    present_categories: dict[str, list[str]] = {c: [] for c in REQUIRED_MATERIAL_CATEGORIES}
    for m in materials:
        mtype = m.material_type or "unknown"
        for category, types in REQUIRED_MATERIAL_CATEGORIES.items():
            if mtype in types:
                present_categories[category].append(m.id)
    present_count = sum(1 for ids in present_categories.values() if ids)
    total_categories = len(REQUIRED_MATERIAL_CATEGORIES)
    material_metric = _metric(
        "material_completeness", "材料完整性",
        present_count / total_categories * 100,
        "必备材料类别（论文/代码/配置/数据/文档）中已上传至少一份材料的类别占比。",
        "materials.material_type",
        present_count, total_categories,
        [{"category": c, "present": bool(ids), "material_ids": ids} for c, ids in present_categories.items()],
    )

    # 2. 证据完整性
    facts = (await db.execute(select(ExtractedFact).where(ExtractedFact.project_id == project_id))).scalars().all()
    facts_verified = [f for f in facts if (f.extraction_status or "supported") != "needs_review"]
    evidence_items = (await db.execute(select(EvidenceItem).where(EvidenceItem.project_id == project_id))).scalars().all()
    ev_verified = [e for e in evidence_items if e.verification_status == "verified"]
    fact_score = (len(facts_verified) / len(facts) * 100) if facts else 100.0
    evidence_metric = _metric(
        "evidence_completeness", "证据完整性", fact_score,
        "已核验（非 needs_review）事实数 / 事实总数；并列示未核验证据项数量。",
        "extracted_facts.extraction_status, evidence_items.verification_status",
        len(facts_verified), len(facts),
        [{"verified_evidence_items": len(ev_verified), "unverified_evidence_items": len(evidence_items) - len(ev_verified)}],
    )

    # 3. 实验完成度
    repro_tasks = (await db.execute(select(ReproductionTask).where(ReproductionTask.project_id == project_id))).scalars().all()
    experiments = (await db.execute(select(Experiment).where(Experiment.project_id == project_id))).scalars().all()
    tasks_done = [t for t in repro_tasks if t.status in DONE_TASK_STATUSES]
    exps_done = [e for e in experiments if e.status in DONE_EXPERIMENT_STATUSES]
    total_work = len(repro_tasks) + len(experiments)
    done_work = len(tasks_done) + len(exps_done)
    experiment_score = (done_work / total_work * 100) if total_work else 100.0
    experiment_metric = _metric(
        "experiment_completion", "实验完成度", experiment_score,
        "已完成复现任务与实验数 / 复现任务与实验总数；无工作项时记 100（不扣分）。",
        "reproduction_tasks.status, experiments.status",
        done_work, total_work,
        [{"repro_tasks_done": len(tasks_done), "repro_tasks_total": len(repro_tasks),
          "experiments_done": len(exps_done), "experiments_total": len(experiments)}],
    )

    # 4. 环境可用性
    envs = (await db.execute(select(ExecutionEnvironment).where(ExecutionEnvironment.project_id == project_id))).scalars().all()
    env_details: list[dict] = []
    if not envs:
        env_score = 0.0
        env_level = "risk"
    else:
        usable = 0
        for env in envs:
            missing = _parse_list(env.missing_json)
            warnings = _parse_list(env.warnings_json)
            ok = not missing and not warnings
            usable += 1 if ok else 0
            env_details.append({"environment_id": env.id, "missing": missing, "warnings": warnings, "usable": ok})
        env_score = usable / len(envs) * 100
        env_level = "good" if usable == len(envs) else ("warning" if usable > 0 else "risk")
    environment_metric = _metric(
        "environment_usability", "环境可用性", env_score,
        "存在环境登记且无缺失依赖/告警的环境占比；无环境登记记 0 分。",
        "execution_environments.missing_json, warnings_json",
        sum(1 for d in env_details if d["usable"]), len(envs), env_details, level=env_level,
    )

    # 5. 未解决问题
    diagnostics = (await db.execute(select(FailureDiagnostic).where(
        FailureDiagnostic.project_id == project_id, FailureDiagnostic.needs_human_confirm.is_(True)))).scalars().all()
    metrics_review = (await db.execute(select(ReproductionMetric).where(
        ReproductionMetric.project_id == project_id, ReproductionMetric.needs_manual_review.is_(True)))).scalars().all()
    feedbacks_open = (await db.execute(select(AuditFeedback).where(
        AuditFeedback.project_id == project_id, AuditFeedback.status == "open"))).scalars().all()
    blocked_tasks = (await db.execute(select(ResearchTask).where(
        ResearchTask.project_id == project_id, ResearchTask.status == "blocked"))).scalars().all()
    facts_review = [f for f in facts if (f.extraction_status or "") == "needs_review"]
    pending_repro = [t for t in repro_tasks if t.needs_human_confirm]
    unresolved = {
        "facts_needing_review": len(facts_review),
        "repro_tasks_needing_confirm": len(pending_repro),
        "diagnostics_needing_confirm": len(diagnostics),
        "metrics_needing_review": len(metrics_review),
        "open_feedback": len(feedbacks_open),
        "blocked_tasks": len(blocked_tasks),
    }
    unresolved_count = sum(unresolved.values())
    if unresolved_count <= UNRESOLVED_LOW_MAX:
        unresolved_level = "good"
        unresolved_score = 100.0
    elif unresolved_count <= UNRESOLVED_MEDIUM_MAX:
        unresolved_level = "warning"
        unresolved_score = 60.0
    else:
        unresolved_level = "risk"
        unresolved_score = 20.0
    unresolved_metric = _metric(
        "unresolved_issues", "未解决问题", unresolved_score,
        "待复核事实/待确认任务与诊断/待复核指标/开放反馈/阻塞任务计数；0=good，1-5=warning，>5=risk。",
        "extracted_facts, reproduction_tasks, failure_diagnostics, reproduction_metrics, audit_feedback, research_tasks",
        unresolved_count, unresolved_count, [unresolved], level=unresolved_level,
    )

    # 6. 历史审计风险
    findings = (await db.execute(select(AuditFinding).where(AuditFinding.project_id == project_id))).scalars().all()
    failed_runs = (await db.execute(select(ReproductionRun).where(
        ReproductionRun.project_id == project_id, ReproductionRun.status == "failed"))).scalars().all()
    weighted = sum(AUDIT_WEIGHT.get(f.severity, 1) for f in findings)
    weighted += len(failed_runs) + len(feedbacks_open)
    if weighted <= AUDIT_LOW_MAX:
        audit_level = "good"
        audit_score = 100.0
    elif weighted <= AUDIT_MEDIUM_MAX:
        audit_level = "warning"
        audit_score = 60.0
    else:
        audit_level = "risk"
        audit_score = 20.0
    audit_metric = _metric(
        "audit_risk", "历史审计风险", audit_score,
        "问题加权（high=3/medium=2/low=1）+ 失败运行数 + 开放反馈数；≤3=good，4-8=warning，>8=risk。",
        "audit_findings.severity, reproduction_runs.status, audit_feedback.status",
        weighted, weighted,
        [{"findings_by_severity": {s: sum(1 for f in findings if f.severity == s) for s in AUDIT_WEIGHT},
          "failed_runs": len(failed_runs), "open_feedback": len(feedbacks_open), "weighted": weighted}],
        level=audit_level,
    )

    # 7. 交接完整度
    latest = (await db.execute(select(HandoffRecord).where(
        HandoffRecord.project_id == project_id).order_by(HandoffRecord.created_at.desc()))).scalars().first()
    handoff_score = 0.0
    handoff_level = "risk"
    handoff_details: list[dict] = {"latest_status": None}
    if latest is not None:
        from app.models.stage12 import HandoffItem
        items = (await db.execute(select(HandoffItem).where(HandoffItem.handoff_id == latest.id))).scalars().all()
        closed = sum(1 for i in items if i.status == "closed")
        ratio = closed / len(items) if items else 1.0
        base = {"completed": 100.0, "accepted": 70.0, "offered": 40.0}.get(latest.status, 0.0)
        handoff_score = base * (0.7 + 0.3 * ratio)
        handoff_level = _level_from_score(handoff_score)
        handoff_details = {"latest_status": latest.status, "items_total": len(items),
                           "items_closed": closed, "closed_ratio": round(ratio, 3)}
    handoff_metric = _metric(
        "handoff_completeness", "交接完整度", handoff_score,
        "最新交接状态基础分（completed=100/accepted=70/offered=40/无=0）×（70% 状态分 + 30% 清单关闭比例）。",
        "handoff_records.status, handoff_items.status",
        handoff_details.get("items_closed", 0) if latest else 0,
        handoff_details.get("items_total", 0) if latest else 0,
        [handoff_details], level=handoff_level,
    )

    metrics = [material_metric, evidence_metric, experiment_metric, environment_metric,
               unresolved_metric, audit_metric, handoff_metric]
    composite = round(sum(m["score"] for m in metrics) / len(metrics), 1)
    return {
        "project_id": project_id,
        "computed_at": _now().isoformat(),
        "composite_score": composite,
        "composite_level": _level_from_score(composite),
        "note": "所有指标由确定性规则从项目真实数据计算，未使用 AI 主观打分；阈值见 health_service 顶部常量。",
        "metrics": metrics,
    }
