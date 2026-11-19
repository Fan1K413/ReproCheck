"""C 组 · 规则离线评估。

对带标注样本（input + expected + label）真实计算 precision / recall / fp_rate /
fn_rate / runtime_ms，落库 RuleEvaluation。支持「同一数据集跑两个版本」的
前后对比（before/after），用于新版本上线前的离线把关。

正类定义：规则预测 status == "conflict" 视为「检出问题」（positive）。
真值取自样本 expected（status == conflict 或任一问题字段列表非空）。
评估完全确定性，不调用大模型，绝不硬编码指标。
"""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.security import new_id
from app.models.stage6 import AuditRuleVersion, RuleEvaluation, User
from app.services.rule_service import (
    _active_version,
    _dumps,
    _get_rule,
    _loads,
    resolve_rule_org,
    run_check,
    sample_passes,
)
from app.services.trail_service import record_trail

_PROBLEM_KEYS = ("conflict_fields", "unit_mismatch_fields", "missing_evidence_fields")


def _expected_positive(expected: dict) -> bool:
    if not isinstance(expected, dict):
        return False
    if expected.get("status") == "conflict":
        return True
    return any(bool(expected.get(k)) for k in _PROBLEM_KEYS)


def _predicted_positive(prediction: dict) -> bool:
    return isinstance(prediction, dict) and prediction.get("status") == "conflict"


def compute_metrics(logic: dict, samples: list[dict]) -> dict:
    """真实计算混淆矩阵与衍生指标 + 逐条结果 + 运行耗时。"""
    tp = fp = fn = tn = 0
    matched = 0
    results: list[dict] = []
    started = time.perf_counter()
    for idx, s in enumerate(samples):
        inp = s.get("input") or {}
        exp = s.get("expected") or {}
        label = s.get("label", "") or f"sample_{idx}"
        try:
            pred = run_check(logic, inp)
            err = None
        except AppError as exc:
            pred, err = {}, exc.message
        gt = _expected_positive(exp)
        pp = _predicted_positive(pred)
        if gt and pp:
            tp += 1
        elif (not gt) and pp:
            fp += 1
        elif gt and (not pp):
            fn += 1
        else:
            tn += 1
        full_match = sample_passes(exp, pred)
        if full_match:
            matched += 1
        results.append({"label": label, "expected_positive": gt, "predicted_positive": pp,
                        "matched": full_match, "expected": exp, "actual": pred, "error": err})
    runtime_ms = int((time.perf_counter() - started) * 1000)
    total = len(samples)

    def _ratio(num: int, den: int) -> float:
        return round(num / den, 4) if den else 0.0

    metrics = {
        "total": total, "tp": tp, "fp": fp, "fn": fn, "tn": tn,
        "precision": _ratio(tp, tp + fp),
        "recall": _ratio(tp, tp + fn),
        "fp_rate": _ratio(fp, fp + tn),
        "fn_rate": _ratio(fn, fn + tp),
        "accuracy": _ratio(tp + tn, total),
        "pass_rate": _ratio(matched, total),
        "runtime_ms": runtime_ms,
    }
    return {"metrics": metrics, "results": results}


async def _version_logic(db: AsyncSession, rule_id: str, version: int | None) -> tuple[int, dict]:
    from sqlalchemy import select
    if version is None:
        rule = await _get_rule(db, rule_id)
        v = await _active_version(db, rule)
        return v.version, _loads(v.check_logic_json, {})
    row = (await db.execute(select(AuditRuleVersion).where(
        AuditRuleVersion.rule_id == rule_id, AuditRuleVersion.version == version))).scalar_one_or_none()
    if row is None:
        raise AppError("NOT_FOUND", f"版本不存在：v{version}。")
    return row.version, _loads(row.check_logic_json, {})


async def _persist(db: AsyncSession, rule_id: str, version: int, dataset_ref: str,
                   metrics: dict, user: User) -> RuleEvaluation:
    ev = RuleEvaluation(id=new_id("reval"), rule_id=rule_id, version=version,
                        dataset_ref=dataset_ref or "", metrics_json=_dumps(metrics), ran_by=user.id)
    db.add(ev)
    return ev


async def evaluate_rule(db: AsyncSession, user: User, rule_id: str, dataset_ref: str,
                        samples: list[dict], baseline_version: int | None = None,
                        request_id: str = "") -> dict:
    """离线评估当前激活版本；若给定 baseline_version 则做前后对比。

    单版本：计算指标 + 落库 RuleEvaluation + 留痕。
    双版本：对同一数据集分别评估 baseline 与 current，落库两条，返回 delta。
    """
    org_id = await resolve_rule_org(db, user)
    rule = await _get_rule(db, rule_id)
    if not samples:
        raise AppError("VALIDATION_ERROR", "评估样本不能为空。")
    for s in samples:
        if not isinstance(s, dict) or not isinstance(s.get("input"), dict) or not isinstance(s.get("expected"), dict):
            raise AppError("VALIDATION_ERROR", "每条评估样本须包含 input 与 expected 对象。")

    cur_version, cur_logic = await _version_logic(db, rule_id, None)
    cur = compute_metrics(cur_logic, samples)
    await _persist(db, rule_id, cur_version, dataset_ref, cur["metrics"], user)

    if baseline_version is None:
        await record_trail(db, action="rule.evaluate", actor_user_id=user.id, org_id=org_id,
                           target_type="audit_rule", target_id=rule_id,
                           after={"version": cur_version, "dataset_ref": dataset_ref, "metrics": cur["metrics"]},
                           summary=f"规则 {rule.rule_key} 离线评估 v{cur_version}", request_id=request_id)
        await db.commit()
        return {"rule_id": rule_id, "version": cur_version, "dataset_ref": dataset_ref,
                "metrics": cur["metrics"], "results": cur["results"]}

    base_version, base_logic = await _version_logic(db, rule_id, baseline_version)
    base = compute_metrics(base_logic, samples)
    await _persist(db, rule_id, base_version, dataset_ref, base["metrics"], user)
    delta = {k: round(cur["metrics"][k] - base["metrics"][k], 4)
             for k in ("precision", "recall", "fp_rate", "fn_rate", "accuracy", "pass_rate")}
    await record_trail(db, action="rule.evaluate_compare", actor_user_id=user.id, org_id=org_id,
                       target_type="audit_rule", target_id=rule_id,
                       before={"version": base_version, "metrics": base["metrics"]},
                       after={"version": cur_version, "metrics": cur["metrics"], "delta": delta},
                       summary=f"规则 {rule.rule_key} 版本对比 v{base_version}→v{cur_version}", request_id=request_id)
    await db.commit()
    return {"rule_id": rule_id, "dataset_ref": dataset_ref,
            "baseline": {"version": base_version, "metrics": base["metrics"], "results": base["results"]},
            "candidate": {"version": cur_version, "metrics": cur["metrics"], "results": cur["results"]},
            "delta": delta}