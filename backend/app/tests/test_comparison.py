"""程序化事实比对单测：不依赖大模型，纯逻辑验证。"""
import pytest

from app.schemas import FactView
from app.services import build_comparisons, normalize_field_key, values_equal


def f(key, raw, norm, chunk="paper_chunk_001"):
    return FactView(field_key=key, raw_value=str(raw), normalized_value=norm,
                    unit=None, evidence_chunk_id=chunk, confidence=0.95)


def test_field_alias_normalization():
    assert normalize_field_key("Batch Size")[0] == "batch_size"
    assert normalize_field_key("learning rate")[0] == "learning_rate"
    assert normalize_field_key("lr")[0] == "learning_rate"
    assert normalize_field_key("训练轮数")[0] == "epochs"


def test_numeric_conflict_and_consistent():
    assert values_equal("batch_size", 64, 32) is False
    assert values_equal("batch_size", 100, 100) is True
    assert values_equal("learning_rate", 0.001, 0.0001) is False
    assert values_equal("learning_rate", 1e-3, 0.001) is True


def test_string_comparison():
    assert values_equal("optimizer", "AdamW", "adamw") is True
    assert values_equal("optimizer", "AdamW", "SGD") is False


def test_unit_mismatch_is_conflict():
    assert values_equal("batch_size", 64, 64, "images", "steps") is False


def test_build_comparisons_expected_results():
    paper = [f("batch_size", "64", 64), f("learning_rate", "0.001", 0.001),
             f("epochs", "100", 100), f("optimizer", "AdamW", "AdamW")]
    config = [f("batch_size", "32", 32, "config_chunk_001"),
              f("learning_rate", "0.0001", 0.0001, "config_chunk_002"),
              f("epochs", "100", 100, "config_chunk_003"),
              f("optimizer", "AdamW", "AdamW", "config_chunk_004")]
    result = {c.field_key: c.status for c in build_comparisons(paper, config)}
    assert result["batch_size"] == "conflict"
    assert result["learning_rate"] == "conflict"
    assert result["epochs"] == "consistent"
    assert result["optimizer"] == "consistent"


def test_missing_field_detected():
    result = build_comparisons([f("batch_size", "64", 64)], [])
    assert result[0].status == "missing"
