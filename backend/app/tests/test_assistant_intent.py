"""助手意图解析纯函数测试。"""
from __future__ import annotations

from app.services.assistant_service import parse_intent


def test_parse_compare_learning_rate():
    r = parse_intent("检查这个项目中论文描述的学习率和代码实际使用的学习率是否一致。")
    assert r["intent"] == "compare_parameter"
    assert r["field_key"] == "learning_rate"
    assert r["handler"] == "compare_parameter"


def test_parse_evidence_check():
    r = parse_intent("找出缺少证据支撑的主张")
    assert r["intent"] == "evidence_check"


def test_parse_dataset_quality():
    r = parse_intent("检查数据集有没有泄漏和分布异常")
    assert r["intent"] == "dataset_quality"


def test_parse_ablation():
    r = parse_intent("对比消融实验各变体的指标差异")
    assert r["intent"] == "ablation"


def test_parse_unknown():
    r = parse_intent("帮我订一杯咖啡")
    assert r["intent"] == "unknown"
    assert r["confidence"] == 0.0
