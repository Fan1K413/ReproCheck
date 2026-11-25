"""实验统计计算引擎（STAT-001 ~ STAT-010）回归测试。

覆盖：手工可算样例、每个原语的正常与缺数据/零除路径、BH/Holm 手算校正、
scipy 与纯 Python 后备的一致性、``audit({})`` 的契约、因果语言检查，以及
test_materials/statsaudit/experiment_statistics.json 驱动的端到端断言。
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

import app.statsaudit.core as core
from app.statsaudit.core import (
    analyze_seed_impact,
    audit,
    check_consistency,
    confidence_interval,
    detect_outliers,
    distribution_data,
    effect_size,
    hypothesis_test,
    mean,
    multiple_comparison,
    power_analysis,
    std,
    variance,
    verify_mean_std,
)
from app.statsaudit.schema import Verdict

FIXTURE_PATH = (Path(__file__).resolve().parents[2] / "test_materials" / "statsaudit"
                / "experiment_statistics.json")

RESULT_KEYS = {"supported", "value", "values", "formula", "inputs", "note", "method"}
FINDING_KEYS = {"rule_id", "rule_name", "verdict", "category", "message", "evidence",
                "justification", "suggestion", "confidence", "affects"}
EVIDENCE_KEYS = {"source", "claimed", "recomputed", "formula", "inputs", "method", "note"}
CAUSAL_WORDS = ("导致", "证明", "因为", "造成", "归因于", "必然", "决定了",
                "causes", "proves", "due to", "therefore", "as a result")


@pytest.fixture(scope="module")
def fixture_data() -> dict:
    assert FIXTURE_PATH.is_file(), f"缺少测试材料：{FIXTURE_PATH}"
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def assert_result_contract(result: dict) -> None:
    assert isinstance(result, dict)
    assert RESULT_KEYS <= set(result)
    assert isinstance(result["supported"], bool)
    assert isinstance(result["values"], dict)
    assert isinstance(result["inputs"], dict)
    assert isinstance(result["formula"], str)
    assert isinstance(result["method"], str)
    assert isinstance(result["note"], str)
    json.dumps(result, ensure_ascii=False)  # 必须 JSON 可序列化


def assert_finding_contract(finding: dict) -> None:
    assert set(finding) == FINDING_KEYS
    assert finding["verdict"] in {v.value for v in Verdict}
    assert finding["category"] == "experiment_statistics"
    assert isinstance(finding["evidence"], list)
    for ev in finding["evidence"]:
        assert set(ev) <= EVIDENCE_KEYS
        json.dumps(ev, ensure_ascii=False)
    assert finding["rule_id"] in {f"STAT-{i:03d}" for i in range(1, 11)}
    # 整合层的因果语言守卫会扫描 message + justification，suggestion 亦不得越界
    for field in ("message", "justification", "suggestion"):
        assert not any(w in finding[field] for w in CAUSAL_WORDS), (field, finding[field])
    json.dumps(finding, ensure_ascii=False)


# 手工可算样例

def test_mean_std_variance_hand_computed() -> None:
    xs = [1, 2, 3, 4, 5]
    m, v, s = mean(xs), variance(xs), std(xs)
    for r in (m, v, s):
        assert_result_contract(r)
        assert r["supported"] is True
    assert m["value"] == 3.0
    assert v["value"] == pytest.approx(2.5, abs=1e-6)
    assert s["value"] == pytest.approx(math.sqrt(2.5), abs=1e-6)
    # ddof=0 的总体方差为 2.0，用于确认默认是样本口径
    assert variance(xs, ddof=0)["value"] == pytest.approx(2.0, abs=1e-6)


def test_confidence_interval_hand_computed() -> None:
    # n=5, mean=3, s=sqrt(2.5), se=sqrt(0.5), t_0.975,4=2.776445105
    r = confidence_interval([1, 2, 3, 4, 5])
    assert_result_contract(r)
    assert r["supported"] is True
    v = r["values"]
    assert v["mean"] == 3.0
    assert v["se"] == pytest.approx(math.sqrt(0.5), abs=1e-6)
    assert v["df"] == 4
    assert v["critical_value"] == pytest.approx(2.776445105, abs=1e-5)
    margin = 2.776445105 * math.sqrt(0.5)
    assert v["ci_low"] == pytest.approx(3.0 - margin, abs=1e-5)
    assert v["ci_high"] == pytest.approx(3.0 + margin, abs=1e-5)
    assert r["ci_low"] < r["values"]["mean"] < r["ci_high"]
    assert r["value"] == pytest.approx([r["ci_low"], r["ci_high"]], abs=1e-6)


def test_confidence_interval_normal_method() -> None:
    z = confidence_interval([1, 2, 3, 4, 5], method="normal")
    t = confidence_interval([1, 2, 3, 4, 5], method="t")
    assert z["values"]["critical_value"] == pytest.approx(1.959963985, abs=1e-5)
    assert z["values"]["df"] is None
    assert z["values"]["ci_low"] > t["values"]["ci_low"]  # t 区间更宽


def test_cohens_d_and_hedges_g_hand_computed() -> None:
    a, b = [1, 2, 3, 4, 5], [2, 3, 4, 5, 6]
    d = effect_size(a, b)
    assert_result_contract(d)
    assert d["supported"] is True
    # 两组均值 3 与 4，合并标准差 sqrt(2.5)，故 d = -1/sqrt(2.5)
    assert d["value"] == pytest.approx(-1.0 / math.sqrt(2.5), abs=1e-6)
    assert d["values"]["pooled_std"] == pytest.approx(math.sqrt(2.5), abs=1e-6)
    assert d["values"]["magnitude"] == "medium"
    g = effect_size(a, b, "hedges_g")
    assert g["value"] == pytest.approx(d["value"] * (1.0 - 3.0 / 31.0), abs=1e-6)
    assert effect_size(a, b, "glass_delta")["value"] == pytest.approx(-1.0 / math.sqrt(2.5), abs=1e-6)
    assert "经验" in effect_size(a, b)["note"]


# 原语正常路径

def test_verify_mean_std_tolerance_paths() -> None:
    ok = verify_mean_std({"mean": 3.0, "std": 1.58}, {"values": [1, 2, 3, 4, 5]})
    assert_result_contract(ok)
    assert ok["supported"] is True
    assert ok["values"]["consistent"] is True
    bad = verify_mean_std({"mean": 3.5, "std": 1.0}, {"values": [1, 2, 3, 4, 5]}, 0.01)
    assert bad["values"]["consistent"] is False
    assert bad["values"]["mean_diff"] == pytest.approx(0.5, abs=1e-6)


def test_check_consistency_stable_and_unstable() -> None:
    stable = check_consistency([{"values": [9.8, 10, 10.2]}, {"values": [10, 10.2, 10.4]}])
    assert_result_contract(stable)
    assert stable["supported"] is True
    assert stable["values"]["cv_of_run_means"] == pytest.approx(0.014004, abs=1e-5)
    assert stable["values"]["consistent"] is True
    unstable = check_consistency([{"mean": 1.0}, {"mean": 10.0}], cv_threshold=0.05)
    assert unstable["values"]["consistent"] is False
    assert unstable["values"]["mean_spread"] == pytest.approx(9.0, abs=1e-6)


def test_seed_impact_paths() -> None:
    low = analyze_seed_impact({"s1": [49, 50, 51], "s2": [50, 51, 52]})
    assert_result_contract(low)
    assert low["supported"] is True
    assert low["values"]["spread"] == pytest.approx(1.0, abs=1e-6)
    assert low["values"]["high_variability"] is False
    high = analyze_seed_impact({"s1": [1, 2], "s2": [100, 101]})
    assert high["values"]["high_variability"] is True


def test_hypothesis_test_all_kinds() -> None:
    a, b = [1, 2, 3, 4, 5], [2, 4, 5, 6, 9]
    expected_df = {
        "welch": pytest.approx(6.620258, abs=1e-5),
        "student": 8,
        "mannwhitney": None,
        "one_sample": 4,
    }
    for kind in ("welch", "student", "mannwhitney"):
        r = hypothesis_test(a, b, kind)
        assert_result_contract(r)
        assert r["supported"] is True
        assert 0.0 <= r["pvalue"] <= 1.0
        assert isinstance(r["significant"], bool)
        assert r["df"] == expected_df[kind]
        assert "前提" in r["note"] or "假设" in r["note"]
    paired = hypothesis_test(a, [2, 3, 4, 5, 7], "paired", paired=True)
    assert paired["supported"] is True
    assert paired["df"] == 4
    assert paired["statistic"] == pytest.approx(-6.0, abs=1e-6)
    one = hypothesis_test(a, 2.5, kind="one_sample")
    assert one["supported"] is True
    assert one["values"]["mu0"] == 2.5
    assert one["df"] == 4


def test_multiple_comparison_holm_bh_by_bonferroni_hand_computed() -> None:
    ps = [0.01, 0.02, 0.03, 0.04]
    holm = multiple_comparison(ps, "holm", 0.05)
    assert_result_contract(holm)
    assert holm["supported"] is True
    assert holm["adjusted_pvalues"] == pytest.approx([0.04, 0.06, 0.06, 0.06], abs=1e-6)
    # Holm 为逐步向下法：0.02 > 0.05/3，自第二项起停止拒绝
    assert holm["rejected"] == [True, False, False, False]
    assert multiple_comparison(ps, "bonferroni")["adjusted_pvalues"] == pytest.approx(
        [0.04, 0.08, 0.12, 0.16], abs=1e-6)
    bh = multiple_comparison(ps, "bh")
    assert bh["adjusted_pvalues"] == pytest.approx([0.04, 0.04, 0.04, 0.04], abs=1e-6)
    # BY = H_4 * BH，H_4 = 1+1/2+1/3+1/4 = 25/12
    assert multiple_comparison(ps, "by")["adjusted_pvalues"] == pytest.approx(
        [0.04 * 25 / 12] * 4, abs=1e-5)


def test_bh_monotonicity_correction() -> None:
    # 原始顺序刻意打乱；BH 校正后按 p 升序排列必须非递减
    ps = [0.03, 0.001, 0.02, 0.5, 0.04]
    r = multiple_comparison(ps, "bh", 0.05)
    adj = r["adjusted_pvalues"]
    sorted_pairs = sorted(zip(ps, adj))
    assert [p for p, _ in sorted_pairs] == sorted(ps)
    assert [a for _, a in sorted_pairs] == sorted([a for _, a in sorted_pairs])
    assert all(0.0 <= x <= 1.0 for x in adj)


def test_power_analysis_forward_inverse_and_mde() -> None:
    r = power_analysis(0.5, n=30)
    assert_result_contract(r)
    assert r["supported"] is True
    # delta = 0.5*sqrt(15)，power ≈ Phi(delta - 1.959964)（含左尾极小项）
    delta = 0.5 * math.sqrt(15.0)
    z = 1.959963985
    expected = 0.5 * (1 + math.erf((delta - z) / math.sqrt(2)))
    assert r["power"] == pytest.approx(expected, abs=1e-4)
    inv = power_analysis(0.5, power=0.8)
    assert inv["n"] == 63  # 2*((1.959964+0.841621)/0.5)^2 = 62.72 -> 向上取整
    assert inv["power"] >= 0.8
    assert inv["mde"] == pytest.approx(0.5, abs=0.01)
    assert r["mde"] == pytest.approx((z + z) / math.sqrt(15.0), abs=1e-4)


def test_detect_outliers_iqr_and_modified_z() -> None:
    xs = [1, 2, 3, 4, 5, 100]
    r = detect_outliers(xs)
    assert_result_contract(r)
    assert r["supported"] is True
    assert r["outlier_indices"] == [5]
    assert r["outlier_values"] == [100]
    assert r["bounds"] == pytest.approx({"lower": -1.5, "upper": 8.5}, abs=1e-6)
    assert r["needs_human_review"] is True
    assert "不自动删除" in r["note"]
    mad = detect_outliers([1, 2, 3, 4, 5, 100], "modified_z", 3.5)
    assert mad["supported"] is True
    assert mad["values"]["median"] == pytest.approx(3.5, abs=1e-6)
    assert 5 in mad["outlier_indices"]


def test_distribution_data_hand_computed() -> None:
    r = distribution_data([1, 2, 3, 4, 5], bins=5)
    assert_result_contract(r)
    assert r["supported"] is True
    assert r["counts"] == [1, 1, 1, 1, 1]
    assert len(r["bin_edges"]) == 6
    assert r["values"]["quartiles"]["q1"] == pytest.approx(2.0, abs=1e-6)
    assert r["values"]["quartiles"]["q3"] == pytest.approx(4.0, abs=1e-6)
    assert r["skewness"] == pytest.approx(0.0, abs=1e-6)
    assert r["kurtosis"] == pytest.approx(-1.2, abs=1e-6)
    assert r["values"]["min"] == 1.0 and r["values"]["max"] == 5.0


# 每个原语的缺数据/零除路径

@pytest.mark.parametrize("factory", [
    lambda: mean([]),
    lambda: std([]),
    lambda: variance([]),
    lambda: std([1], ddof=1),
    lambda: verify_mean_std({}, {}),
    lambda: check_consistency([]),
    lambda: analyze_seed_impact({}),
    lambda: confidence_interval([]),
    lambda: effect_size([], []),
    lambda: hypothesis_test([], []),
    lambda: multiple_comparison([]),
    lambda: power_analysis(),
    lambda: detect_outliers([]),
    lambda: distribution_data([]),
], ids=["mean", "std", "variance", "std_ddof", "verify", "consistency", "seed",
        "ci", "effect", "test", "mc", "power", "outlier", "dist"])
def test_primitives_insufficient_data_do_not_crash(factory) -> None:
    result = factory()
    assert_result_contract(result)
    assert result["supported"] is False
    assert result["value"] is None


@pytest.mark.parametrize("factory", [
    lambda: effect_size([1, 1, 1], [1, 1, 1]),
    lambda: detect_outliers([1, 1, 1, 1], "modified_z", 3.5),
    lambda: hypothesis_test([1, 1, 1], [1, 1, 1]),
    lambda: power_analysis(effect_size=0.0, n=30),
    lambda: confidence_interval([1, 2, 3], method="unknown"),
    lambda: multiple_comparison([0.1, -0.2]),
    lambda: distribution_data([1, 2, 3], bins=0),
], ids=["effect_zero_div", "mad_zero_div", "welch_zero_div", "power_zero_effect",
        "bad_ci_method", "bad_pvalue", "bad_bins"])
def test_primitives_zero_division_and_invalid_params_are_safe(factory) -> None:
    result = factory()
    assert_result_contract(result)
    assert result["supported"] is False


# scipy / 后备一致性

def _numeric_snapshot(result: dict) -> dict[str, float]:
    out: dict[str, float] = {}

    def walk(obj, prefix: str) -> None:
        if obj is None or isinstance(obj, bool):
            return
        if isinstance(obj, (int, float)):
            out[prefix] = float(obj)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, f"{prefix}.{k}" if prefix else str(k))
        elif isinstance(obj, list):
            for i, v in enumerate(obj):
                walk(v, f"{prefix}[{i}]")

    walk(result.get("value"), "value")
    walk(result.get("values"), "values")
    return out


def test_scipy_and_pure_python_fallback_agree(monkeypatch) -> None:
    calls = [
        lambda: confidence_interval([1, 2, 3, 4, 5]),
        lambda: confidence_interval([1, 2, 3, 4, 5], method="normal"),
        lambda: hypothesis_test([1, 2, 3, 4, 5], [2, 4, 5, 6, 9], "welch"),
        lambda: hypothesis_test([1, 2, 3, 4, 5], [2, 4, 5, 6, 9], "student"),
        lambda: hypothesis_test([1, 2, 3, 4, 5], [2, 3, 4, 5, 7], "paired", paired=True),
        lambda: hypothesis_test([1, 2, 3, 4, 5], [2, 3, 4, 5, 6], "mannwhitney"),
        lambda: hypothesis_test([1, 2, 3, 4, 5], 2.5, "one_sample"),
        lambda: power_analysis(0.5, n=30),
        lambda: power_analysis(0.5, power=0.8),
    ]
    scipy_results = [f() for f in calls]
    monkeypatch.setattr(core, "_sp_stats", None)
    python_results = [f() for f in calls]
    for with_scipy, fallback in zip(scipy_results, python_results):
        assert_result_contract(fallback)
        a, b = _numeric_snapshot(with_scipy), _numeric_snapshot(fallback)
        common = set(a) & set(b)
        assert common, "两条路径应共享可比的数值字段"
        for key in common:
            assert abs(a[key] - b[key]) <= 1e-4, (key, a[key], b[key])


# audit 契约

def test_audit_empty_payload_is_safe_and_complete() -> None:
    report = audit({})
    assert set(report) == {"findings", "computations", "notes"}
    assert len(report["findings"]) == 10
    assert [f["rule_id"] for f in report["findings"]] == [f"STAT-{i:03d}" for i in range(1, 11)]
    assert all(f["verdict"] == Verdict.INSUFFICIENT_EVIDENCE.value for f in report["findings"])
    for f in report["findings"]:
        assert_finding_contract(f)
    assert isinstance(report["computations"], dict)
    assert report["computations"]["STAT-001"]["supported"] is False
    assert report["notes"]
    json.dumps(report, ensure_ascii=False)


def test_audit_finding_contract_and_no_causal_language(fixture_data: dict) -> None:
    for payload in ({}, fixture_data["payload"]):
        report = audit(payload)
        assert len(report["findings"]) == 10
        for f in report["findings"]:
            assert_finding_contract(f)
            for word in CAUSAL_WORDS:
                assert word not in f["message"]


def test_audit_detects_claimed_mean_error(fixture_data: dict) -> None:
    report = audit(fixture_data["payload"])
    by_id = {f["rule_id"]: f for f in report["findings"]}
    assert by_id["STAT-001"]["verdict"] == Verdict.CALCULATION_ERROR.value
    assert by_id["STAT-001"]["evidence"][0]["claimed"]["mean"] == 3.2
    assert by_id["STAT-001"]["evidence"][0]["recomputed"]["recomputed_mean"] == 3.0


def test_audit_accepts_plain_list_samples() -> None:
    report = audit({"samples": [1, 2, 3, 4, 5], "claims": {"mean": 3.0, "std": 1.581139}})
    by_id = {f["rule_id"]: f for f in report["findings"]}
    assert by_id["STAT-001"]["verdict"] == Verdict.VERIFIED.value
    assert by_id["STAT-004"]["verdict"] == Verdict.VERIFIED.value
    assert by_id["STAT-010"]["verdict"] == Verdict.VERIFIED.value


# JSON 材料端到端

def test_fixture_end_to_end(fixture_data: dict) -> None:
    payload, exp = fixture_data["payload"], fixture_data["expected"]
    report = audit(payload)
    c = report["computations"]
    assert c["mean"]["value"] == pytest.approx(exp["mean"], abs=1e-6)
    assert c["variance"]["value"] == pytest.approx(exp["sample_variance"], abs=1e-6)
    assert c["std"]["value"] == pytest.approx(exp["sample_std"], abs=1e-6)
    # 置信区间
    ci = c["confidence_interval"]["values"]
    for key, expected in exp["confidence_interval"].items():
        assert ci[key] == pytest.approx(expected, abs=1e-5)
    # 报告值核验
    vms = c["verify_mean_std"]["values"]
    for key, expected in exp["verify_mean_std"].items():
        if isinstance(expected, bool):
            assert vms[key] is expected
        elif isinstance(expected, (int, float)):
            assert vms[key] == pytest.approx(expected, abs=1e-5)
        else:
            assert vms[key] == expected
    # 效应量与检验
    assert c["effect_size"]["value"] == pytest.approx(exp["cohens_d"], abs=1e-6)
    assert effect_size(payload["group_a"], payload["group_b"], "hedges_g")["value"] == pytest.approx(
        exp["hedges_g"], abs=1e-6)
    assert effect_size(payload["group_a"], payload["group_b"], "glass_delta")["value"] == pytest.approx(
        exp["glass_delta"], abs=1e-6)
    wt = c["hypothesis_test"]["values"]
    for key, expected in exp["welch"].items():
        if isinstance(expected, bool):
            assert wt[key] is expected
        elif isinstance(expected, (int, float)):
            assert wt[key] == pytest.approx(expected, abs=1e-5)
        else:
            assert wt[key] == expected
    # 多重比较
    assert multiple_comparison(payload["pvalues"], "holm")["adjusted_pvalues"] == pytest.approx(
        exp["holm_adjusted"], abs=1e-6)
    assert multiple_comparison(payload["pvalues"], "bh")["adjusted_pvalues"] == pytest.approx(
        exp["bh_adjusted"], abs=1e-6)
    assert multiple_comparison(payload["pvalues"], "by")["adjusted_pvalues"] == pytest.approx(
        exp["by_adjusted"], abs=1e-5)
    assert multiple_comparison(payload["pvalues"], "bonferroni")["adjusted_pvalues"] == pytest.approx(
        exp["bonferroni_adjusted"], abs=1e-6)
    # 一致性 / 种子 / 功效
    assert c["check_consistency"]["values"]["cv_of_run_means"] == pytest.approx(exp["consistency_cv"], abs=1e-5)
    seed = c["analyze_seed_impact"]["values"]
    assert seed["spread"] == pytest.approx(exp["seed_spread"], abs=1e-6)
    assert seed["relative_spread"] == pytest.approx(exp["seed_relative_spread"], abs=1e-5)
    pw = c["power_analysis"]["values"]
    assert pw["power"] == pytest.approx(exp["power"], abs=1e-5)
    assert pw["mde"] == pytest.approx(exp["mde"], abs=1e-5)
    # 异常与分布
    out = c["detect_outliers"]["values"]
    assert out["outlier_indices"] == exp["outlier_indices"]
    assert out["outlier_values"] == pytest.approx(exp["outlier_values"], abs=1e-6)
    assert out["bounds"]["lower"] == pytest.approx(exp["outlier_bounds"]["lower"], abs=1e-6)
    assert out["bounds"]["upper"] == pytest.approx(exp["outlier_bounds"]["upper"], abs=1e-6)
    dist = c["distribution_data"]["values"]
    assert dist["counts"] == exp["distribution"]["counts"]
    for key in ("q1", "q2", "q3"):
        assert dist["quartiles"][key] == pytest.approx(exp["distribution"][key], abs=1e-6)
    assert dist["skewness"] == pytest.approx(exp["distribution"]["skewness"], abs=1e-6)
    assert dist["kurtosis"] == pytest.approx(exp["distribution"]["kurtosis"], abs=1e-6)
    # 端到端判定
    actual = {f["rule_id"]: f["verdict"] for f in report["findings"]}
    assert actual == exp["expected_verdicts"]
