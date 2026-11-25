"""实验设计合理性审计与可信度边界守卫的回归测试。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.statsaudit.design import (
    audit,
    check_ablation_completeness,
    check_baseline_reasonableness,
    check_control_group,
    check_hyperparameter_bias,
    check_practical_significance,
    check_repetition_sufficiency,
    check_selective_reporting,
    guard_causal_language,
)
from app.statsaudit.schema import NAVIGATION_GUARD, Verdict

DATASET = (
    Path(__file__).resolve().parents[2]
    / "test_materials" / "statsaudit" / "experiment_design.json"
)
FINDING_KEYS = {
    "rule_id", "rule_name", "verdict", "category", "message",
    "evidence", "justification", "suggestion", "confidence", "affects",
}


@pytest.fixture(scope="module")
def cases() -> dict:
    payload = json.loads(DATASET.read_text(encoding="utf-8"))
    return payload["cases"]


def verdict_of(report: dict, rule_id: str) -> str:
    matches = [f["verdict"] for f in report["findings"] if f["rule_id"] == rule_id]
    assert len(matches) == 1, f"{rule_id} 应恰好出现一次，实际 {matches}"
    return matches[0]


def test_dataset_file_exists():
    assert DATASET.is_file(), f"缺少端到端测试数据集：{DATASET}"


def test_guard_causal_language_rewrites_cause():
    result = guard_causal_language("A 导致 B 提升")
    assert result["has_causal"] is True
    assert "导致" in result["matched"]
    assert result["original"] == "A 导致 B 提升"
    assert "导致" not in result["rewritten"]
    assert "相关" in result["rewritten"]


def test_guard_causal_language_handles_other_patterns_and_clean_text():
    rewritten = guard_causal_language("因为 A，所以 B 必然提升")["rewritten"]
    for term in NAVIGATION_GUARD:
        assert term.lower() not in rewritten.lower(), (term, rewritten)

    english = guard_causal_language("A causes B")
    assert english["has_causal"] is True
    assert "causes" not in english["rewritten"].lower()
    assert "相关" in english["rewritten"]
    clean = guard_causal_language("准确率为 0.91。")
    assert clean["has_causal"] is False
    assert clean["matched"] == []
    assert clean["rewritten"] == "准确率为 0.91。"


def test_audit_empty_payload_is_safe_and_insufficient(cases):
    report = audit(cases["empty"])
    assert set(report) == {"findings", "computations", "notes"}
    assert report["findings"]
    assert verdict_of(report, "DSN-001") == Verdict.INSUFFICIENT_EVIDENCE.value
    assert verdict_of(report, "DSN-002") == Verdict.INSUFFICIENT_EVIDENCE.value
    assert verdict_of(report, "DSN-006") == Verdict.INSUFFICIENT_EVIDENCE.value
    insufficiency = [
        f for f in report["findings"]
        if f["verdict"] == Verdict.INSUFFICIENT_EVIDENCE.value
    ]
    assert insufficiency
    for finding in report["findings"]:
        assert set(finding) == FINDING_KEYS
        assert finding["verdict"] in {v.value for v in Verdict}


def test_audit_empty_payload_literal_dict():
    report = audit({})
    assert isinstance(report["findings"], list)
    assert any(
        f["verdict"] == Verdict.INSUFFICIENT_EVIDENCE.value
        for f in report["findings"]
    )


def test_full_design_payload_verdicts(cases):
    report = audit(cases["full_design"])
    assert verdict_of(report, "DSN-001") == Verdict.VERIFIED.value
    assert verdict_of(report, "DSN-002") == Verdict.VERIFIED.value
    assert verdict_of(report, "DSN-003") == Verdict.NEEDS_HUMAN_REVIEW.value
    assert verdict_of(report, "DSN-004") == Verdict.VERIFIED.value
    assert verdict_of(report, "DSN-005") == Verdict.VERIFIED.value
    assert verdict_of(report, "DSN-006") == Verdict.VERIFIED.value
    assert verdict_of(report, "DSN-007") == Verdict.VERIFIED.value
    assert verdict_of(report, "CRED-001") == Verdict.VERIFIED.value
    assert verdict_of(report, "CRED-002") == Verdict.NEEDS_HUMAN_REVIEW.value
    assert report["computations"]["causal_guard"]["rewritten"] == 0


def test_selective_reporting_detected(cases):
    payload = cases["selective_reporting"]
    check = check_selective_reporting(payload)
    assert check["supported"] is False
    assert check["values"]["issues"]

    report = audit(payload)
    assert verdict_of(report, "DSN-005") == Verdict.POTENTIAL_BIAS.value
    evidence_text = json.dumps(
        report["findings"][4]["evidence"], ensure_ascii=False
    )
    assert "reported_seeds" in evidence_text


def test_hyperparameter_test_set_contamination(cases):
    check = check_hyperparameter_bias(cases["hyperparam_contamination"])
    assert check["supported"] is False
    assert check["value"] == "test_set_used"

    report = audit(cases["hyperparam_contamination"])
    assert verdict_of(report, "DSN-004") == Verdict.POTENTIAL_BIAS.value


def test_missing_search_trials_is_potential_bias(cases):
    assert check_hyperparameter_bias(cases["missing_search_trials"])["value"] == "search_trials_missing"
    assert verdict_of(audit(cases["missing_search_trials"]), "DSN-004") == Verdict.POTENTIAL_BIAS.value


def test_repetition_insufficiency(cases):
    assert check_repetition_sufficiency(cases["few_repeats"])["supported"] is False
    report = audit(cases["few_repeats"])
    assert verdict_of(report, "DSN-006") == Verdict.INSUFFICIENT_EVIDENCE.value
    assert "低于阈值" in next(
        f["message"] for f in report["findings"] if f["rule_id"] == "DSN-006"
    )


def test_significant_but_small_effect(cases):
    payload = cases["small_effect"]
    check = check_practical_significance(payload, threshold=0.2)
    assert check["values"]["significant"] is True
    assert check["values"]["small_effect"] is True
    assert check["supported"] is False

    report = audit(payload)
    assert verdict_of(report, "DSN-007") == Verdict.NEEDS_HUMAN_REVIEW.value
    message = next(f["message"] for f in report["findings"] if f["rule_id"] == "DSN-007")
    assert "显著性本身不被否定" in message

    # 显式参数优先于 payload 中的值。
    overridden = check_practical_significance(payload, effect_size=0.9, pvalue=0.01, threshold=0.2)
    assert overridden["supported"] is True


def test_cred001_downgrades_causal_finding(cases):
    report = audit(cases["causal_language"])
    assert report["computations"]["causal_guard"]["rewritten"] >= 1
    assert verdict_of(report, "DSN-003") == Verdict.NEEDS_HUMAN_REVIEW.value
    assert verdict_of(report, "CRED-001") == Verdict.NEEDS_HUMAN_REVIEW.value
    rewritten = next(
        f["message"] for f in report["findings"] if f["rule_id"] == "DSN-003"
    )
    assert "导致" not in rewritten
    assert "相关性不等于因果" in rewritten


def test_all_messages_and_suggestions_are_safe(cases):
    for name, payload in cases.items():
        report = audit(payload)
        for finding in report["findings"]:
            for term in NAVIGATION_GUARD:
                assert term.lower() not in finding["message"].lower(), (name, finding["rule_id"], term)
            assert "学术不端" not in finding["suggestion"], (name, finding["rule_id"])
            assert "人工复核建议" in finding["suggestion"], (name, finding["rule_id"])
            assert "需补充的证据" in finding["suggestion"], (name, finding["rule_id"])
            assert finding["category"] in {"experiment_design", "credibility"}


def test_check_functions_return_contract(cases):
    payload = cases["full_design"]
    checks = [
        check_control_group(payload),
        check_ablation_completeness(payload),
        check_baseline_reasonableness(payload),
        check_hyperparameter_bias(payload),
        check_selective_reporting(payload),
        check_repetition_sufficiency(payload),
        check_practical_significance(payload),
    ]
    for check in checks:
        assert set(check) == {"supported", "value", "values", "note", "method"}
        assert check["method"]
        assert check["note"]
        assert isinstance(check["values"], dict)


def test_ablation_and_baseline_check_details(cases):
    incomplete = check_ablation_completeness({
        "claimed_components": ["a", "b", "c"], "ablations": ["a"],
    })
    assert incomplete["supported"] is False
    assert incomplete["values"]["missing"] == ["b", "c"]

    random_only = check_baseline_reasonableness(cases["random_baseline"])
    assert random_only["supported"] is False
    assert random_only["values"]["random_count"] == 1

    control = check_control_group(cases["full_design"])
    assert control["supported"] is True
    assert control["value"] == "complete"
