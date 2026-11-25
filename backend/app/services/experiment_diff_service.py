"""功能 A：科研实验差异分析中心（确定性分析，不调用大模型）。

比较两次或多次运行的真实数据库记录，输出条件变化、指标变化、可能解释与不确定项。
明确区分"相关性"与"因果性"：任何代码/配置变化只标记为"可能解释"，绝不认定为原因。
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import resolve_project_access
from app.core.errors import AppError
from app.models import ExtractedFact, Material
from app.models.stage4 import (
    ExecutionArtifact, ExecutionEnvironment, MetricComparison, ReproductionMetric,
    ReproductionRun,
)
from app.models.stage6 import RepositorySnapshot
from app.models.stage6 import User

CHANGE_KEYS = {
    "code": {"py", "ipynb", "js", "ts", "java", "cpp", "cu", "r"},
    "config": {"yaml", "yml", "json", "toml", "ini", "cfg", "txt"},
    "data": {"csv", "parquet", "npy", "npz", "h5", "hdf5", "tsv", "xlsx"},
    "docs": {"md", "rst", "pdf", "docx"},
}


def _json(value: str | None, default: Any) -> Any:
    try:
        return json.loads(value) if value else default
    except (ValueError, TypeError):
        return default


def _classify_path(path: str) -> str:
    low = path.lower()
    ext = low.rsplit(".", 1)[-1] if "." in low else ""
    if low.startswith(("readme", "docs/", "doc/", "license", "changelog")) or ext in CHANGE_KEYS["docs"]:
        return "docs"
    if ext in CHANGE_KEYS["code"]:
        return "code"
    if ext in CHANGE_KEYS["data"] or low.startswith(("data/", "dataset/")):
        return "data"
    if ext in CHANGE_KEYS["config"] or "requirements" in low:
        return "config"
    return "other"


def _diff_values(values: list[Any]) -> str:
    uniq: list[str] = []
    for v in values:
        text = "—" if v is None or v == "" else str(v)
        if text not in uniq:
            uniq.append(text)
    return "unchanged" if len(uniq) == 1 else "changed"


async def _snapshot(db: AsyncSession, project_id: str, run: ReproductionRun) -> dict[str, Any]:
    env = None
    if run.environment_id:
        env = (await db.execute(select(ExecutionEnvironment).where(
            ExecutionEnvironment.id == run.environment_id))).scalar_one_or_none()
    metrics = (await db.execute(select(ReproductionMetric).where(
        ReproductionMetric.run_id == run.id))).scalars().all()
    artifacts = (await db.execute(select(ExecutionArtifact).where(
        ExecutionArtifact.run_id == run.id))).scalars().all()
    materials = (await db.execute(select(Material).where(
        Material.project_id == project_id))).scalars().all()
    facts = (await db.execute(select(ExtractedFact).where(
        ExtractedFact.project_id == project_id).limit(200))).scalars().all()
    # 快照与运行没有外键关联：按"不晚于运行创建时间的最新快照"做弱关联，
    # 并在结果中明确标注该关联不是运行级强绑定，避免伪造因果关系。
    snap = (await db.execute(select(RepositorySnapshot).where(
        RepositorySnapshot.project_id == project_id,
        RepositorySnapshot.commit_sha != "",
        RepositorySnapshot.fetched_at <= run.created_at,
    ).order_by(RepositorySnapshot.fetched_at.desc()).limit(1))).scalar_one_or_none()
    if snap is None:
        snap = (await db.execute(select(RepositorySnapshot).where(
            RepositorySnapshot.project_id == project_id, RepositorySnapshot.commit_sha != "").order_by(
            RepositorySnapshot.fetched_at.desc()).limit(1))).scalar_one_or_none()
    frameworks = _json(env.frameworks_json, {}) if env else {}
    hardware = _json(env.hardware_json, {}) if env else {}
    param_keys = ("learning_rate", "lr", "batch_size", "seed", "random_seed",
                  "epochs", "optimizer", "model", "model_name", "dataset")
    params = {}
    for f in facts:
        key = (f.field_key or "").lower()
        if any(k in key for k in param_keys):
            params[f.field_key] = f.normalized_value or f.raw_value
    return {
        "run_id": run.id,
        "plan_id": run.plan_id,
        "status": run.status,
        "started_at": run.started_at.isoformat() if run.started_at else None,
        "finished_at": run.finished_at.isoformat() if run.finished_at else None,
        "duration_ms": run.duration_ms,
        "error_message": run.error_message,
        "git_commit": snap.commit_sha if snap else None,
        "git_commit_note": ("项目级最新快照，未与运行建立外键绑定" if snap else "无仓库快照"),
        "python_version": env.python_version if env else None,
        "frameworks": frameworks,
        "cuda_version": hardware.get("cuda_version") or hardware.get("cuda") or None,
        "hardware": hardware,
        "model_params": params,
        "data_hashes": sorted({f"sha256:{m.sha256}" for m in materials if m.sha256}),
        "artifacts": [{"name": a.name, "hash": a.hash, "size_bytes": a.size_bytes} for a in artifacts],
        "metrics": {m.metric_name: {"value": m.metric_value, "unit": m.unit,
                                    "dataset": m.dataset, "experiment": m.experiment}
                    for m in metrics},
    }


async def compare_runs(db: AsyncSession, user: User, project_id: str,
                       run_ids: list[str]) -> dict[str, Any]:
    if len(run_ids) < 2:
        raise AppError("VALIDATION_ERROR", "请至少选择两次运行进行比较。")
    await resolve_project_access(db, project_id, user)
    rows = (await db.execute(select(ReproductionRun).where(
        ReproductionRun.id.in_(run_ids), ReproductionRun.project_id == project_id))).scalars().all()
    found = {r.id: r for r in rows}
    missing = [rid for rid in run_ids if rid not in found]
    if missing:
        raise AppError("NOT_FOUND", "部分运行不存在或不属于该项目。")
    snapshots = [_snapshot(db, project_id, found[rid]) for rid in run_ids]
    snaps = []
    for s in snapshots:
        snaps.append(await s)

    # 条件维度变化
    dimension_specs = {
        "git_commit": lambda s: s["git_commit"],
        "python_version": lambda s: s["python_version"],
        "cuda_version": lambda s: s["cuda_version"],
        "frameworks": lambda s: json.dumps(s["frameworks"], sort_keys=True, ensure_ascii=False),
        "model_params": lambda s: json.dumps(s["model_params"], sort_keys=True, ensure_ascii=False),
        "data_hashes": lambda s: json.dumps(s["data_hashes"], sort_keys=True),
        "artifact_hashes": lambda s: json.dumps(sorted(a["hash"] or "" for a in s["artifacts"])),
        "duration_ms": lambda s: "same" if s["duration_ms"] == snaps[0]["duration_ms"] else "diff",
    }
    conditions = []
    for name, getter in dimension_specs.items():
        values = [getter(s) for s in snaps]
        status = _diff_values(values)
        conditions.append({"dimension": name, "status": status,
                           "unknown": all(v in (None, "", "[]", "{}", "—") for v in values)})

    # 指标变化（数值差）
    metric_names: list[str] = []
    for s in snaps:
        for name in s["metrics"]:
            if name not in metric_names:
                metric_names.append(name)
    metric_diffs = []
    for name in metric_names:
        vals = [s["metrics"].get(name, {}).get("value") for s in snaps]
        numeric = [v for v in vals if isinstance(v, (int, float))]
        if len(numeric) >= 2:
            first, last = numeric[0], numeric[-1]
            abs_diff = round(last - first, 6)
            rel = round(abs_diff / abs(first), 6) if first else None
            changed = abs(abs_diff) > 1e-9
        else:
            abs_diff, rel, changed = None, None, (len({str(v) for v in vals}) > 1)
        metric_diffs.append({"metric": name, "values": vals, "absolute_diff": abs_diff,
                             "relative_diff": rel, "changed": changed,
                             "unknown": any(v is None for v in vals)})

    # 可能解释（相关性，不是因果性）
    explanations = []
    changed_dims = {c["dimension"] for c in conditions if c["status"] == "changed"}
    changed_metrics = [m["metric"] for m in metric_diffs if m["changed"]]
    if changed_metrics:
        hints = {
            "git_commit": "代码版本变化与指标变化同时出现，可能是相关因素；需查看具体 diff 后判断。",
            "python_version": "Python 版本变化可能影响依赖解析与数值结果；属相关性线索。",
            "cuda_version": "CUDA 版本变化可能影响浮点与算子行为；属相关性线索。",
            "frameworks": "框架版本变化可能影响训练/推理行为；属相关性线索。",
            "model_params": "模型或超参变化可能解释结果差异；需核对参数来源。",
            "data_hashes": "数据哈希变化意味着输入数据不同；可能解释指标变化。",
            "artifact_hashes": "产物哈希变化说明输出不同；本身不解释原因。",
        }
        for dim in sorted(changed_dims):
            explanations.append({"condition": dim, "metrics": changed_metrics,
                                 "text": hints.get(dim, "条件变化与指标变化共存，但无法确定因果。"),
                                 "relation": "correlation_only"})
    undetermined = [c["dimension"] for c in conditions if c["unknown"]]
    if not changed_dims and not changed_metrics:
        rerun = {"recommendation": "not_needed", "reason": "未观察到条件与指标变化。"}
    elif changed_dims & {"git_commit", "python_version", "cuda_version", "frameworks", "model_params", "data_hashes"} and changed_metrics:
        rerun = {"recommendation": "recommended",
                 "reason": "存在可能影响结果的条件变化且指标已变化，建议在受控环境重跑验证。"}
    else:
        rerun = {"recommendation": "optional",
                 "reason": "仅有非关键条件变化或缺少可比较指标，是否重跑由人工判断。"}

    affected = (await db.execute(select(MetricComparison).where(
        MetricComparison.project_id == project_id))).scalars().all()
    affected_conclusions = [{
        "id": c.id, "metric": c.metric_name, "verdict": c.verdict,
        "impact": "需重新核查" if changed_metrics and c.metric_name in changed_metrics else "无直接证据表明受影响",
    } for c in affected[:50]]

    return {
        "project_id": project_id,
        "run_ids": run_ids,
        "snapshots": snaps,
        "conditions": conditions,
        "metric_diffs": metric_diffs,
        "possible_explanations": explanations,
        "undetermined": undetermined,
        "rerun_recommendation": rerun,
        "affected_audit_conclusions": affected_conclusions,
        "causality_notice": "本报告只标注相关性与可能解释，不认定因果；模型推断不写入已验证事实。",
    }
