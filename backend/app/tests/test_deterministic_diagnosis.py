"""确定性诊断分类器测试（验证引擎第一层，独立于大模型）。"""
from __future__ import annotations

import pytest

from app.reproduction.deterministic_diagnosis import (
    FAILURE_CATEGORIES,
    classify_failure,
)


def test_all_required_categories_present():
    for c in ("paper_material_missing", "code_implementation_error",
              "config_parameter_error", "dataset_missing", "data_format_error",
              "env_dependency_conflict", "hardware_resource_shortage",
              "external_service_unavailable", "run_timeout",
              "result_inconsistent", "other_unknown"):
        assert c in FAILURE_CATEGORIES


def test_timeout_log_classified():
    r = classify_failure(raw_log="Process timed out after 600s", stage="execution")
    assert r.primary_category == "run_timeout"
    assert r.candidates[0].confidence > 0


def test_cuda_oom_classified_as_hardware():
    r = classify_failure(raw_log="RuntimeError: CUDA out of memory. Tried to allocate 2GiB")
    assert r.primary_category == "hardware_resource_shortage"


def test_syntax_error_classified_as_code():
    r = classify_failure(raw_log="File train.py line 42\nSyntaxError: invalid syntax")
    assert r.primary_category == "code_implementation_error"


@pytest.mark.parametrize("prefix", ["", 'Traceback (most recent call last):\n  File "train.py", line 1\n    import numpy\n'])
def test_missing_module_classified_as_dependency(prefix):
    result = classify_failure(raw_log=f"{prefix}ModuleNotFoundError: No module named 'numpy'")
    assert result.primary_category == "env_dependency_conflict"
    assert "导入日志中的模块" in result.candidates[0].suggested_fix
    assert all(candidate.category != "code_implementation_error" for candidate in result.candidates)


def test_dataset_missing_classified():
    r = classify_failure(raw_log="FileNotFoundError: dataset/train.csv no such file or directory")
    assert r.primary_category == "dataset_missing"


def test_unknown_log_never_invents_root_cause():
    r = classify_failure(raw_log="something odd happened xyz123")
    assert r.primary_category == "other_unknown"
    assert r.candidates[0].confidence == 0.0
    assert "证据不足" in r.candidates[0].suggested_fix


def test_all_candidates_are_unconfirmed():
    r = classify_failure(raw_log="Traceback ... ModuleNotFoundError ... timeout 600s")
    assert len(r.candidates) >= 2
    assert all(c.is_confirmed is False for c in r.candidates)
    assert all(0.0 <= c.confidence <= 0.9 for c in r.candidates)
    assert r.method == "deterministic_rule_v1"
    assert "候选原因" in r.note


def test_error_code_direct_mapping():
    r = classify_failure(error_code="TASK_TIMEOUT")
    assert r.primary_category == "run_timeout"
    assert any("error_code" in e for e in r.candidates[0].matched_evidence)


@pytest.mark.asyncio
async def test_classify_api_requires_auth(client):
    r = await client.post("/api/v1/diagnosis/classify", json={"raw_log": "timeout"})
    assert r.status_code == 401
