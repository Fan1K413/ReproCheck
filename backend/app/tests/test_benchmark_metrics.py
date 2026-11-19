"""科研审计基准指标引擎与 API 回归测试。"""
from __future__ import annotations

import pytest

from app.services.benchmark_metrics import (
    BenchmarkPrediction,
    BenchmarkTruth,
    compare_baseline,
    compute_metrics,
)


def T(item_id, category="cat_a", locator="loc"):
    return BenchmarkTruth(item_id=item_id, category=category, evidence_locator=locator)


def P(item_id, category="cat_a", locator="loc", confidence=0.9):
    return BenchmarkPrediction(item_id=item_id, category=category,
                               evidence_locator=locator, confidence=confidence)


def test_perfect_prediction_scores_one():
    r = compute_metrics([T("a"), T("b")], [P("a"), P("b")])
    assert r["precision"] == r["recall"] == r["f1"] == 1.0
    assert r["counts"]["tp"] == 2
    assert r["counts"]["fp"] == r["counts"]["fn"] == 0
    assert r["evidence_location_accuracy"] == 1.0
    assert r["category_accuracy"] == 1.0


def test_all_false_positives_precision_zero():
    r = compute_metrics([T("a")], [P("x"), P("y")])
    assert r["precision"] == 0.0
    assert r["counts"]["tp"] == 0
    assert r["counts"]["fp"] == 2
    assert r["counts"]["fn"] == 1
    assert r["false_positive_rate"] == 1.0
    assert r["evidence_location_accuracy"] is None
    assert any("TP 为 0" in n for n in r["formula_notes"])


def test_all_false_negatives_recall_zero():
    r = compute_metrics([T("a"), T("b")], [])
    assert r["recall"] == 0.0
    assert r["counts"]["fn"] == 2
    assert r["counts"]["fp"] == 0
    assert r["false_negative_rate"] == 1.0


def test_partial_correct_precision_recall_f1_rounded():
    # 2 个正确命中、1 个误报、1 个漏报：P=R=F1=2/3=0.67
    r = compute_metrics(
        [T("a"), T("b"), T("c")],
        [P("a"), P("b"), P("x")],
    )
    assert r["counts"]["tp"] == 2
    assert r["counts"]["fp"] == 1
    assert r["counts"]["fn"] == 1
    assert r["precision"] == 0.67
    assert r["recall"] == 0.67
    assert r["f1"] == 0.67


def test_misclassified_hit_counts_as_both_fp_and_fn():
    r = compute_metrics([T("a", "cat_a")], [P("a", "cat_b")])
    assert r["counts"]["tp"] == 0
    assert r["counts"]["matched_count"] == 1
    assert r["counts"]["fp"] == 1
    assert r["counts"]["fn"] == 1
    assert any("不一致" in n for n in r["formula_notes"])


def test_evidence_location_accuracy_only_among_true_positives():
    r = compute_metrics(
        [T("a", locator="L1"), T("b", locator="L2")],
        [P("a", locator="L1"), P("b", locator="WRONG")],
    )
    assert r["counts"]["tp"] == 2
    assert r["counts"]["evidence_correct_count"] == 1
    assert r["evidence_location_accuracy"] == 0.5


def test_category_accuracy_uses_all_matched_items():
    # 2 个命中，其中 1 个分类错误 -> 分类准确率 0.5
    r = compute_metrics(
        [T("a", "cat_a"), T("b", "cat_b")],
        [P("a", "cat_a"), P("b", "cat_wrong")],
    )
    assert r["counts"]["tp"] == 1
    assert r["counts"]["matched_count"] == 2
    assert r["category_accuracy"] == 0.5
    # 分类不一致的命中同时贡献 1 个 FP 和 1 个 FN
    assert r["counts"]["fp"] == 1
    assert r["counts"]["fn"] == 1


def test_empty_inputs_do_not_crash_and_zero_denominator_adds_note():
    r = compute_metrics([], [])
    assert r["precision"] == r["recall"] == r["f1"] == 0.0
    assert r["evidence_location_accuracy"] is None
    assert r["counts"]["truth_count"] == r["counts"]["pred_count"] == 0
    assert any("分母" in n for n in r["formula_notes"])


def test_duplicate_item_id_uses_first_occurrence_deterministically():
    r = compute_metrics(
        [T("a", "cat_a"), T("a", "cat_b")],
        [P("a", "cat_a"), P("a", "cat_b")],
    )
    assert r["counts"]["truth_count"] == 1
    assert r["counts"]["pred_count"] == 1
    assert r["precision"] == 1.0


def test_compare_baseline_detects_regression_and_blocks_gate():
    baseline = {"precision": 0.9, "recall": 0.8, "f1": 0.85}
    current = {"precision": 0.7, "recall": 0.9, "f1": 0.85}
    r = compare_baseline(current, baseline, ["precision", "recall", "f1"])
    assert r["gate_pass"] is False
    assert len(r["regressions"]) == 1
    assert r["regressions"][0]["metric"] == "precision"
    assert r["improvements"][0]["metric"] == "recall"


def test_compare_baseline_passes_when_no_metric_degraded():
    baseline = {"precision": 0.8, "f1": 0.7}
    current = {"precision": 0.8, "f1": 0.75}
    r = compare_baseline(current, baseline, ["precision", "f1"])
    assert r["gate_pass"] is True
    assert r["regressions"] == []
    assert len(r["improvements"]) == 1


@pytest.mark.asyncio
async def test_compute_api_returns_metrics(client):
    reg = await client.post("/api/v1/auth/register", json={
        "email": "metrics@example.com", "password": "password123",
        "display_name": "指标测试用户",
    })
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['data']['token']}"}
    r = await client.post("/api/v1/benchmark/metrics/compute?project_id=nonexistent", json={
        "truths": [
            {"item_id": "a", "category": "cat_a", "evidence_locator": "L1"},
            {"item_id": "b", "category": "cat_a", "evidence_locator": "L2"},
        ],
        "predictions": [
            {"item_id": "a", "category": "cat_a", "evidence_locator": "L1", "confidence": 0.9},
            {"item_id": "b", "category": "cat_a", "evidence_locator": "WRONG", "confidence": 0.8},
        ],
    }, headers=headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["precision"] == data["recall"] == data["f1"] == 1.0
    assert data["evidence_location_accuracy"] == 0.5
    assert data["counts"]["tp"] == 2


@pytest.mark.asyncio
async def test_compute_api_requires_auth(client):
    r = await client.post("/api/v1/benchmark/metrics/compute",
                          json={"truths": [], "predictions": []})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_schema_api_requires_auth_and_documents_formulas(client):
    unauth = await client.get("/api/v1/benchmark/metrics/schema")
    assert unauth.status_code == 401
    assert unauth.json()["error"]["code"] == "UNAUTHORIZED"

    reg = await client.post("/api/v1/auth/register", json={
        "email": "metrics-schema@example.com", "password": "password123",
        "display_name": "口径测试用户",
    })
    assert reg.status_code == 200, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['data']['token']}"}
    r = await client.get("/api/v1/benchmark/metrics/schema", headers=headers)
    assert r.status_code == 200
    data = r.json()["data"]
    names = {m["name"] for m in data["metrics"]}
    assert {"precision", "recall", "f1", "false_positive_rate",
            "false_negative_rate", "evidence_location_accuracy",
            "category_accuracy"}.issubset(names)
    assert any("误报率" in n for n in data["formula_notes"])
