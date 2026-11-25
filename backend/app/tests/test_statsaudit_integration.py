"""统计审计模块集成测试：引擎汇总 + 六类分类 + 因果守卫 + API 端到端。

这些测试刻意使用与子模块单元测试不同的独立样本，用于验证模块间的契约与编排，
而不是重复某一条公式。所有断言基于可复核的结构性质。
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.statsaudit import Verdict, get_catalog, run_stats_audit
from app.statsaudit.engine import _guard_finding


SAMPLE_PAYLOAD = {
    "claimed": {
        "accuracy": 0.91, "f1": 0.88, "macro_f1": 0.87,
        "mean": 0.85, "std": 0.02,
    },
    "samples": [0.84, 0.86, 0.85, 0.87, 0.83],
    "runs": [
        {"accuracy": 0.91, "f1": 0.88},
        {"accuracy": 0.90, "f1": 0.87},
        {"accuracy": 0.92, "f1": 0.89},
    ],
    "seed_scores": {
        "seed=1": [0.91, 0.90, 0.92],
        "seed=42": [0.88, 0.89, 0.87],
        "seed=7": [0.95, 0.94, 0.96],
    },
    "group_a": [0.84, 0.86, 0.85, 0.87, 0.83, 0.85],
    "group_b": [0.78, 0.80, 0.79, 0.81, 0.77, 0.79],
    "pvalues": [0.01, 0.04, 0.30],
    "alpha": 0.05,
    "y_true": [0, 1, 0, 1, 1, 0, 1, 0],
    "y_pred": [0, 1, 0, 1, 0, 0, 1, 1],
    "total_seeds": 5,
    "reported_seeds": 1,
    "n_repeats": 2,
    "effect_size": 0.15,
    "hyperparam_search": {"test_set_used": True, "search_trials": 20},
}


def test_catalog_has_six_verdicts_and_rules():
    catalog = get_catalog()
    assert len(catalog["verdicts"]) == 6
    values = {v["value"] for v in catalog["verdicts"]}
    assert values == {v.value for v in Verdict}
    rule_ids = {r["rule_id"] for r in catalog["rules"]}
    assert {"STAT-001", "MET-001", "DSN-001", "CRED-001"}.issubset(rule_ids)
    assert len(catalog["operations"]) >= 25


def test_run_stats_audit_returns_serializable_report():
    report = run_stats_audit(SAMPLE_PAYLOAD, project_id="p-test")
    d = report.to_dict()
    assert d["report_id"].startswith("statsaudit-")
    assert d["scope"]["project_id"] == "p-test"
    assert isinstance(d["findings"], list)
    assert isinstance(d["counts"], dict)
    assert any("相关性不等于因果" in x for x in d["limitations"])


def test_all_findings_use_valid_verdict_and_no_causal_language():
    report = run_stats_audit(SAMPLE_PAYLOAD)
    for f in report.findings:
        assert f.verdict in {v.value for v in Verdict}
        for banned in ("导致", "证明", "因为"):
            assert banned not in f.message, f"因果词出现在: {f.rule_id} {f.message}"
        for banned in ("学术不端", "造假", "欺诈"):
            assert banned not in f.suggestion


def test_guard_finding_downgrades_causal_claim():
    raw = {
        "rule_id": "STAT-999", "verdict": "verified", "category": "experiment_statistics",
        "message": "方法A导致准确率提升", "justification": "数值更高",
    }
    guarded = _guard_finding(raw)
    assert guarded.verdict == Verdict.NEEDS_HUMAN_REVIEW.value
    assert "相关性不等于因果" in guarded.message
    assert guarded.causal_language_checked is False


def test_guard_finding_rejects_unknown_verdict():
    raw = {"rule_id": "X", "verdict": "totally_fine", "message": "无因果词"}
    guarded = _guard_finding(raw)
    assert guarded.verdict == Verdict.NEEDS_HUMAN_REVIEW.value


def test_empty_payload_is_safe():
    report = run_stats_audit({})
    d = report.to_dict()
    assert isinstance(d["findings"], list)
    # 空输入不应把"实验统计/机器指标"判为已验证（CRED-001 守卫自检的 verified 属允许）。
    data_verdicts = [
        f["verdict"] for f in d["findings"]
        if f["category"] in ("experiment_statistics", "ml_metrics")
    ]
    assert "verified" not in data_verdicts


@pytest.mark.asyncio
async def test_api_catalog_and_compute_and_run(client: AsyncClient):
    reg = await client.post("/api/v1/auth/register", json={
        "email": "statsaudit@example.com", "password": "password123",
        "display_name": "统计审计测试用户",
    })
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['data']['token']}"}

    r = await client.get("/api/v1/stats-audit/catalog", headers=headers)
    assert r.status_code == 200
    assert r.json()["success"] is True
    assert len(r.json()["data"]["verdicts"]) == 6

    r = await client.post("/api/v1/stats-audit/compute", json={
        "operation": "mean", "kwargs": {"values": [1, 2, 3, 4, 5]},
    }, headers=headers)
    assert r.status_code == 200
    assert r.json()["data"]["value"] == pytest.approx(3.0)

    r = await client.post("/api/v1/stats-audit/compute", json={
        "operation": "__import__", "kwargs": {},
    }, headers=headers)
    assert r.json()["data"]["supported"] is False  # 白名单拦截

    r = await client.post("/api/v1/stats-audit/run", json={
        "experiment_statistics": SAMPLE_PAYLOAD,
    }, headers=headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert "findings" in data and "counts" in data
    assert data["report_id"].startswith("statsaudit-")
