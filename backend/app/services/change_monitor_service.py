"""功能 B：科研项目变化监控与影响分析（确定性规则，不调用大模型）。

输入：用户自己的仓库连接产生的真实快照（含远端返回的变更文件清单）。
输出：受影响的事实/实验/审计结论与建议；普通 README 修改不触发全量重跑。
任何"创建重审任务"必须用户显式确认。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access
from app.core.errors import AppError
from app.models import ExtractedFact
from app.models.stage4 import MetricComparison, ReproductionRun, ReproductionPlan
from app.models.stage6 import RepositoryConnection, RepositorySnapshot, User

from app.services.experiment_diff_service import _classify_path

HIGH_IMPACT = {"code", "config", "data"}


def _json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value) if value else default
    except (ValueError, TypeError):
        return default


def _files_of(snapshot: RepositorySnapshot) -> list[dict[str, str]]:
    diff = _json(snapshot.version_diff_json, {})
    files = diff.get("files", []) if isinstance(diff, dict) else []
    return [f for f in files if isinstance(f, dict)] if isinstance(files, list) else []


async def analyze(db: AsyncSession, user: User, project_id: str) -> dict[str, Any]:
    await resolve_project_access(db, project_id, user)
    rows = (await db.execute(select(RepositorySnapshot).join(
        RepositoryConnection, RepositorySnapshot.connection_id == RepositoryConnection.id
    ).where(
        RepositoryConnection.user_id == user.id,
        RepositorySnapshot.project_id == project_id,
        RepositorySnapshot.commit_sha != "",
    ).order_by(RepositorySnapshot.fetched_at.desc()))).scalars().all()
    synced = [s for s in rows if _json(s.version_diff_json, {}).get("status") == "synced"]
    if len(synced) < 2:
        return {
            "project_id": project_id,
            "status": "insufficient_data",
            "reason": "至少需要两次成功同步且 commit 不同的仓库快照。",
            "snapshots": [{"id": s.id, "commit_sha": s.commit_sha,
                           "fetched_at": s.fetched_at.isoformat() if s.fetched_at else None}
                          for s in rows[:5]],
            "changed_files": [], "affected_facts": [], "affected_runs": [],
            "affected_conclusions": [], "suggestions": [],
        }
    new, old = synced[0], synced[1]
    if not new.commit_sha or new.commit_sha == old.commit_sha:
        return {"project_id": project_id, "status": "no_change",
                "reason": "最新快照与上一快照 commit 相同。",
                "old_commit": old.commit_sha, "new_commit": new.commit_sha,
                "changed_files": [], "affected_facts": [], "affected_runs": [],
                "affected_conclusions": [], "suggestions": []}

    changed = []
    for f in _files_of(new):
        path = str(f.get("path") or "")
        if not path:
            continue
        changed.append({"path": path, "status": f.get("status", ""),
                        "category": _classify_path(path)})
    categories = sorted({f["category"] for f in changed})
    high = bool(set(categories) & HIGH_IMPACT)
    docs_only = bool(changed) and set(categories) <= {"docs"}

    # 只做"名称相关"的弱匹配，明确标注为待人工确认，而不是断言事实失效。
    facts = (await db.execute(select(ExtractedFact).where(
        ExtractedFact.project_id == project_id).limit(300))).scalars().all()
    tokens = {f["path"].rsplit("/", 1)[-1].lower() for f in changed}
    affected_facts = []
    for fact in facts:
        text = f"{fact.field_key or ''} {fact.raw_value or ''} {fact.source_name or ''}".lower()
        hit = next((t for t in tokens if t and t in text), None)
        if hit:
            affected_facts.append({"id": fact.id, "field": fact.field_key,
                                   "matched_file": hit, "impact": "待人工确认"})
    runs = (await db.execute(select(ReproductionRun).where(
        ReproductionRun.project_id == project_id).order_by(
        ReproductionRun.created_at.desc()).limit(50))).scalars().all()
    affected_runs = [{"id": r.id, "status": r.status,
                      "impact": "可能受影响" if high else "无直接证据"}
                     for r in runs if high]
    conclusions = (await db.execute(select(MetricComparison).where(
        MetricComparison.project_id == project_id))).scalars().all()
    affected_conclusions = [{"id": c.id, "metric": c.metric_name, "verdict": c.verdict,
                             "impact": "需重新核查" if high else "无直接证据"}
                            for c in conclusions[:50]]

    suggestions = []
    if high:
        suggestions.append({
            "severity": "high", "title": "代码/配置/数据发生变化",
            "reason": "远端 commit 包含可能影响研究条件的文件变化，建议核查相关事实与结论。",
            "requires_confirmation": True,
        })
    if docs_only:
        suggestions.append({
            "severity": "low", "title": "仅文档类文件变化",
            "reason": "README/文档修改不构成重新执行实验的依据；不生成全量重跑建议。",
            "requires_confirmation": False,
        })
    if not changed:
        suggestions.append({
            "severity": "medium", "title": "commit 变化但文件清单未知",
            "reason": "快照未包含远端返回的文件清单，无法确定影响范围；需要人工查看 commit。",
            "requires_confirmation": True,
        })
    return {
        "project_id": project_id, "status": "analyzed",
        "old_commit": old.commit_sha, "new_commit": new.commit_sha,
        "old_snapshot_id": old.id, "new_snapshot_id": new.id,
        "commit_message": _json(new.version_diff_json, {}).get("message", ""),
        "changed_files": changed, "categories": categories,
        "affected_facts": affected_facts[:50],
        "affected_runs": affected_runs,
        "affected_conclusions": affected_conclusions,
        "suggestions": suggestions,
        "notice": "影响分析基于文件类别的确定性规则；相关不等于因果，创建重审任务需用户确认。",
    }


async def create_review_plan(db: AsyncSession, user: User, project_id: str,
                             snapshot_id: str, confirmed: bool, title: str | None = None) -> dict:
    """用户确认后创建"变更重审计划（草稿）"，不自动执行任何实验或覆盖既有结论。"""
    if confirmed is not True:
        raise AppError("VALIDATION_ERROR", "必须显式确认后才能创建重审任务。")
    await resolve_project_access(db, project_id, user)
    snap = (await db.execute(select(RepositorySnapshot).where(
        RepositorySnapshot.id == snapshot_id,
        RepositorySnapshot.project_id == project_id))).scalar_one_or_none()
    if snap is None:
        raise AppError("NOT_FOUND", "仓库快照不存在或不属于该项目。")
    plan = ReproductionPlan(
        id=f"rplan-{__import__('uuid').uuid4().hex[:16]}",
        project_id=project_id,
        title=(title or f"仓库变更重审：{snap.commit_sha[:12]}")[:300],
        status="draft", source="manual", ai_available=False,
        feasibility_summary_json=json.dumps({
            "trigger": "repository_change", "snapshot_id": snapshot_id,
            "commit_sha": snap.commit_sha, "confirmed_by": user.id,
            "note": "由用户确认创建的重审草稿；尚未执行，未修改任何审计结论。",
        }, ensure_ascii=False),
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return {"plan_id": plan.id, "title": plan.title, "status": plan.status,
            "next": "请到复现规划页人工确认任务后再执行。"}
