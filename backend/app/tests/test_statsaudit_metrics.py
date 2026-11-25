"""机器学习指标审计引擎测试：手算基准、纯函数口径、端到端材料与返回契约。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.statsaudit.metrics import (
    audit,
    audit_metric_claims,
    compute_classification_metrics,
    compute_multiclass_averages,
    compute_pr_auc,
    compute_regression_metrics,
    compute_roc_auc,
    detect_split_mismatch,
    recompute_metric,
)
from app.statsaudit.schema import NAVIGATION_GUARD, Verdict

MATERIAL = (
    Path(__file__).resolve().parents[2]
    / "test_materials" / "statsaudit" / "ml_metrics.json"
)


@pytest.fixture(scope="module")
def material() -> dict:
    with MATERIAL.open(encoding="utf-8") as handle:
        return json.load(handle)


# 手算基准
def test_confusion_counts_manual_values():
    """TP=5,FP=2,FN=3,TN=10 的四项指标与手算结果一致。"""
    assert recompute_metric("precision", tp=5, fp=2, fn=3, tn=10)["value"] == pytest.approx(5 / 7, abs=1e-6)
    assert recompute_metric("recall", tp=5, fp=2, fn=3, tn=10)["value"] == pytest.approx(5 / 8, abs=1e-6)
    assert recompute_metric("f1", tp=5, fp=2, fn=3, tn=10)["value"] == pytest.approx(2 * 5 / (2 * 5 + 2 + 3), abs=1e-6)
    assert recompute_metric("accuracy", tp=5, fp=2, fn=3, tn=10)["value"] == pytest.approx(15 / 20, abs=1e-6)


def test_confusion_sample_level_matches_counts():
    """样本级输入与混淆计数的结果一致。"""
    y_true = [1] * 8 + [0] * 12
    y_pred = [1] * 5 + [0] * 3 + [0] * 10 + [1] * 2
    result = compute_classification_metrics(y_true, y_pred, average="binary")
    cell = result["values"]["per_class"]["1"]
    assert cell["tp"] == 5 and cell["fp"] == 2 and cell["fn"] == 3 and cell["tn"] == 10
    assert result["values"]["accuracy"] == pytest.approx(0.75, abs=1e-6)
    assert cell["precision"] == pytest.approx(0.714286, abs=1e-6)
    assert cell["recall"] == pytest.approx(0.625, abs=1e-6)
    assert cell["f1"] == pytest.approx(0.666667, abs=1e-6)


def test_three_class_averages_hand_computed(material):
    """三分类 macro / weighted / micro 与逐类手算值一致且互不相等。"""
    dataset = material["cases"]["multiclass_anomalies"]["dataset"]
    result = compute_classification_metrics(dataset["y_true"], dataset["y_pred"])
    averages = result["all_averages"]
    per_class = result["values"]["per_class"]

    manual_macro = sum(per_class[c]["f1"] for c in ("0", "1", "2")) / 3
    manual_weighted = sum(
        result["support"][c] * per_class[c]["f1"] for c in ("0", "1", "2")
    ) / sum(result["support"].values())

    assert averages["macro"]["f1"] == pytest.approx(manual_macro, abs=1e-6)
    assert averages["weighted"]["f1"] == pytest.approx(manual_weighted, abs=1e-6)
    assert averages["macro"]["f1"] == pytest.approx(0.542424, abs=1e-6)
    assert averages["weighted"]["f1"] == pytest.approx(0.59697, abs=1e-6)
    assert averages["micro"]["f1"] == pytest.approx(0.583333, abs=1e-6)
    assert len({
        averages["macro"]["f1"], averages["weighted"]["f1"], averages["micro"]["f1"]
    }) == 3
    assert averages["micro"]["f1"] == pytest.approx(result["values"]["accuracy"], abs=1e-6)


def test_multiclass_averages_pure_function(material):
    """独立汇总入口接受 class-major 与 metric-major 两种结构。"""
    dataset = material["cases"]["multiclass_anomalies"]["dataset"]
    result = compute_classification_metrics(dataset["y_true"], dataset["y_pred"])
    per_class = result["values"]["per_class"]
    support = result["support"]
    direct = compute_multiclass_averages(per_class, support, "weighted")
    assert direct["value"] == pytest.approx(0.59697, abs=1e-6)

    metric_major = {
        metric: {label: cell[metric] for label, cell in per_class.items()}
        for metric in ("precision", "recall", "f1")
    }
    transposed = compute_multiclass_averages(metric_major, support, "macro")
    assert transposed["value"] == pytest.approx(0.542424, abs=1e-6)
    bare = compute_multiclass_averages({}, {}, "macro")
    assert bare["supported"] is False


# AUC / PR-AUC
def test_binary_roc_auc_boundaries():
    """完美分离、随机并列与反向分离三种边界数值。"""
    assert compute_roc_auc([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])["value"] == pytest.approx(1.0)
    assert compute_roc_auc([0, 1], [0.5, 0.5])["value"] == pytest.approx(0.5)
    assert compute_roc_auc([1, 0], [0.1, 0.9])["value"] == pytest.approx(0.0)
    assert compute_roc_auc([0, 0, 1, 1], [0.5, 0.5, 0.5, 0.5])["value"] == pytest.approx(0.5)


def test_pr_auc_boundaries():
    """PR-AUC 的完美值与并列边界值。"""
    assert compute_pr_auc([0, 0, 1, 1], [0.1, 0.2, 0.9, 0.8])["value"] == pytest.approx(1.0)
    assert compute_pr_auc([0, 0, 1, 1], [0.5, 0.5, 0.5, 0.5])["value"] == pytest.approx(0.5)
    assert compute_pr_auc([0, 1], [0.9, 0.1])["value"] == pytest.approx(0.5)


def test_multiclass_roc_auc_ovr_macro(material):
    """多分类 OVR 的 macro AUC 等于各类 AUC 的算术平均。"""
    dataset = material["cases"]["multiclass_anomalies"]["dataset"]
    result = compute_roc_auc(dataset["y_true"], dataset["y_score"], labels=dataset["labels"])
    assert result["supported"] is True
    assert result["inputs"]["n_classes"] == 3
    values = list(result["per_class"].values())
    assert all(0.0 <= value <= 1.0 for value in values)
    assert result["value"] == pytest.approx(sum(values) / len(values), abs=1e-6)
    pr = compute_pr_auc(dataset["y_true"], dataset["y_score"], labels=dataset["labels"])
    assert pr["supported"] is True and 0.0 <= pr["value"] <= 1.0


def test_auc_missing_scores_not_fabricated():
    """缺少分数矩阵时返回 supported=False。"""
    result = compute_roc_auc([0, 1, 0, 1], None)
    assert result["supported"] is False
    assert result["value"] is None
    assert recompute_metric("roc_auc", y_true=[0, 1], y_score=None)["supported"] is False


# 回归指标
def test_regression_perfect_and_constant_prediction():
    """完美预测与常数预测的回归指标。"""
    perfect = compute_regression_metrics([1, 2, 3], [1, 2, 3])
    assert perfect["values"]["rmse"] == pytest.approx(0.0)
    assert perfect["values"]["mae"] == pytest.approx(0.0)
    assert perfect["values"]["r2"] == pytest.approx(1.0)
    constant = compute_regression_metrics([1, 2, 3], [2, 2, 2])
    assert constant["values"]["r2"] == pytest.approx(0.0)
    assert constant["values"]["mae"] == pytest.approx(2 / 3, abs=1e-6)


def test_regression_baseline_and_denominator():
    """RMSE/MAE 分母与 R² 的 SS_tot 口径显式可核对。"""
    result = compute_regression_metrics([1, 2, 3, 4, 5], [1.1, 2.1, 2.9, 3.8, 5.2])
    assert result["inputs"]["ss_tot_definition"] == "sum((y_true - mean(y_true))^2)"
    assert result["inputs"]["denominator"] == 5
    assert result["values"]["ss_res"] == pytest.approx(0.11, abs=1e-6)
    assert result["values"]["ss_tot"] == pytest.approx(10.0)
    assert result["values"]["r2"] == pytest.approx(0.989, abs=1e-6)
    assert result["values"]["r2_zero_baseline"] == pytest.approx(0.998, abs=1e-6)
    for name in ("rmse", "mae", "r2"):
        assert recompute_metric(name, y_true=[1, 2, 3, 4, 5],
                                y_pred=[1.1, 2.1, 2.9, 3.8, 5.2])["value"] == pytest.approx(
            result["values"][name], abs=1e-6
        )


def test_constant_true_values_r2_undefined():
    """y_true 为常数时 R² 未定义，value 置空。"""
    result = compute_regression_metrics([2, 2, 2], [2, 2, 2])
    assert result["supported"] is True
    assert result["values"]["r2"] is None
    assert "未定义" in result["note"]


# 返回契约
def test_audit_empty_payload_is_safe():
    """空输入不抛异常，七条 MET 规则全部给出证据不足。"""
    result = audit({})
    assert set(result.keys()) == {"findings", "computations", "notes"}
    assert len(result["findings"]) == 7
    assert all(f["verdict"] == Verdict.INSUFFICIENT_EVIDENCE.value for f in result["findings"])
    assert {f["rule_id"] for f in result["findings"]} == {
        f"MET-{index:03d}" for index in range(1, 8)
    }


def test_findings_contract_and_neutral_language(material):
    """每条发现字段齐全、证据可追溯，且文本不含因果断言措辞。"""
    for case in material["cases"].values():
        result = audit(case)
        for finding in result["findings"]:
            assert set(finding.keys()) == {
                "rule_id", "rule_name", "verdict", "category", "message",
                "evidence", "justification", "suggestion", "confidence", "affects",
            }
            assert finding["rule_id"].startswith("MET-")
            assert finding["verdict"] in {item.value for item in Verdict}
            assert finding["category"] == "ml_metrics"
            assert finding["confidence"] in {"high", "medium", "low"}
            assert isinstance(finding["evidence"], list)
            for evidence in finding["evidence"]:
                assert set(evidence.keys()) <= {
                    "source", "claimed", "recomputed", "formula", "inputs", "method", "note"
                }
            for text in (finding["message"], finding["justification"],
                         finding["suggestion"], *result["notes"]):
                assert all(word not in text for word in NAVIGATION_GUARD), text


def test_public_results_are_json_serializable(material):
    """所有纯函数与审计输出可直接 JSON 序列化且不含 NaN。"""
    dataset = material["cases"]["multiclass_anomalies"]["dataset"]
    outputs = [
        compute_classification_metrics(dataset["y_true"], dataset["y_pred"], average="weighted"),
        compute_multiclass_averages({}, {}, "macro"),
        compute_roc_auc(dataset["y_true"], dataset["y_score"], labels=dataset["labels"]),
        compute_pr_auc(dataset["y_true"], dataset["y_score"], labels=dataset["labels"]),
        compute_regression_metrics([1, 2, 3], [1, 2, 3]),
        recompute_metric("unknown_metric"),
        audit_metric_claims(material["cases"]["multiclass_anomalies"]),
        detect_split_mismatch(material["cases"]["multiclass_anomalies"]),
        audit(material["cases"]["regression"]),
    ]
    for output in outputs:
        assert set(output.keys()) >= {"supported", "value", "values", "formula", "inputs", "note", "method"} or "findings" in output
        json.dumps(output, allow_nan=False, ensure_ascii=False)


# 材料端到端
def test_e2e_binary_case(material):
    """二分类材料：四项一致、划分一致、无验证集误用标记。"""
    result = audit(material["cases"]["binary_confusion"])
    counts = result["computations"]["claim_comparison"]["values"]["counts"]
    assert counts == {"total": 4, "consistent": 4, "inconsistent": 0, "insufficient": 0}
    by_rule = {f["rule_id"]: f["verdict"] for f in result["findings"]}
    assert by_rule["MET-001"] == Verdict.VERIFIED.value
    assert by_rule["MET-004"] == Verdict.VERIFIED.value
    assert by_rule["MET-006"] == Verdict.VERIFIED.value


def test_e2e_multiclass_anomalies(material):
    """多分类材料：平均口径、AUC 口径、划分差异与来源标记异常均被记录。"""
    payload = material["cases"]["multiclass_anomalies"]
    result = audit(payload)
    by_rule: dict[str, list[str]] = {}
    for finding in result["findings"]:
        by_rule.setdefault(finding["rule_id"], []).append(finding["verdict"])

    assert Verdict.CALCULATION_ERROR.value in by_rule["MET-001"]
    assert Verdict.METHOD_INAPPLICABLE.value in by_rule["MET-002"]
    assert Verdict.METHOD_INAPPLICABLE.value in by_rule["MET-003"]
    assert Verdict.POTENTIAL_BIAS.value in by_rule["MET-004"]
    assert Verdict.CALCULATION_ERROR.value in by_rule["MET-005"]
    assert Verdict.POTENTIAL_BIAS.value in by_rule["MET-006"]

    split = result["computations"]["split_mismatch"]["values"]
    assert split["count_mismatches"][0]["split"] == "test"
    assert len(split["val_as_test"]) == 1
    evidence_blob = json.dumps(result["findings"], ensure_ascii=False)
    assert "0.59697" in evidence_blob or "0.596970" in evidence_blob


def test_e2e_regression_case(material):
    """回归材料：数值差异与 SS_tot baseline 口径分别记录。"""
    result = audit(material["cases"]["regression"])
    met007 = [f for f in result["findings"] if f["rule_id"] == "MET-007"]
    assert [f["verdict"] for f in met007] == [
        Verdict.CALCULATION_ERROR.value, Verdict.METHOD_INAPPLICABLE.value
    ]
    counts = result["computations"]["claim_comparison"]["values"]["counts"]
    assert counts["consistent"] == 3 and counts["inconsistent"] == 1


# 对比与划分
def test_audit_metric_claims_tolerance_and_insufficient(material):
    """容差内记为一致，缺字段记为证据不足。"""
    inconsistent_case = material["cases"]["regression"]
    report = audit_metric_claims(inconsistent_case)
    by_metric = {c["metric"]: c for c in report["values"]["comparisons"]}
    assert by_metric["rmse"]["status"] == "consistent"
    assert [c for c in report["values"]["comparisons"] if c["metric"] == "r2"][0]["status"] == "inconsistent"
    insufficient = audit_metric_claims({"claims": [{"metric": "f1", "claimed": 0.9}]})
    assert insufficient["values"]["comparisons"][0]["status"] == "insufficient"


def test_detect_split_mismatch_variants():
    """样本数差异、重叠标记与验证集来源标记均可识别。"""
    payload = {
        "dataset": {"split": {"train": {"sample_count": 80, "claimed_count": 80},
                              "test": {"sample_count": 20, "claimed_count": 30, "overlap": 5}}},
        "reported_holdout": "test",
        "claims": [{"metric": "f1", "claimed": 0.9, "holdout": "val"}],
    }
    result = detect_split_mismatch(payload)
    values = result["values"]
    assert values["count_mismatches"][0]["abs_diff"] == pytest.approx(10.0)
    assert values["overlaps"][0]["value"] == 5
    assert len(values["val_as_test"]) == 1
    assert result["value"] >= 3
