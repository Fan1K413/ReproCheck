"""第二层：程序化事实校验。

冲突判断由程序完成，不交给大模型。支持：
- 字段别名标准化（Batch Size / batch_size / batch size -> batch_size）
- 数值比较（含科学计数法、相对容差）
- 字符串比较（大小写归一化）
- 单位处理
- 缺失字段识别
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.schemas import ComparisonView, FactView

# 字段别名 -> 规范 key 与展示名
FIELD_ALIASES: dict[str, tuple[str, str]] = {
    "batch_size": ("batch_size", "Batch Size"),
    "batchsize": ("batch_size", "Batch Size"),
    "batch size": ("batch_size", "Batch Size"),
    "批大小": ("batch_size", "Batch Size"),
    "learning_rate": ("learning_rate", "Learning Rate"),
    "learningrate": ("learning_rate", "Learning Rate"),
    "learning rate": ("learning_rate", "Learning Rate"),
    "lr": ("learning_rate", "Learning Rate"),
    "学习率": ("learning_rate", "Learning Rate"),
    "epochs": ("epochs", "Epochs"),
    "epoch": ("epochs", "Epochs"),
    "num_epochs": ("epochs", "Epochs"),
    "training_epochs": ("epochs", "Epochs"),
    "训练轮数": ("epochs", "Epochs"),
    "optimizer": ("optimizer", "Optimizer"),
    "optim": ("optimizer", "Optimizer"),
    "优化器": ("optimizer", "Optimizer"),
}

# 数值型字段的相对容差
NUMERIC_FIELDS = {"batch_size", "learning_rate", "epochs"}
REL_TOL = 1e-6


def normalize_field_key(raw: str) -> tuple[str, str]:
    key = (raw or "").strip().lower().replace("-", "_")
    key = re.sub(r"\s+", " ", key)
    return FIELD_ALIASES.get(key, (key, key))


def _to_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "")
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def values_equal(field_key: str, a: Any, b: Any, unit_a: str | None = None,
                 unit_b: str | None = None) -> bool | None:
    """返回 True/False；无法比较时返回 None。"""
    # 单位不同视为冲突（当前阶段简单处理，单位一致才比较数值）
    if unit_a and unit_b and unit_a.strip().lower() != unit_b.strip().lower():
        return False
    if field_key in NUMERIC_FIELDS:
        na, nb = _to_number(a), _to_number(b)
        if na is None or nb is None:
            return None
        return abs(na - nb) <= REL_TOL * max(abs(na), abs(nb), 1.0)
    # 字符串字段：大小写与首尾空白归一化
    sa = "" if a is None else str(a).strip().lower()
    sb = "" if b is None else str(b).strip().lower()
    return sa == sb


def build_comparisons(facts_a: list[FactView], facts_b: list[FactView]) -> list[ComparisonView]:
    """对两个材料抽取的事实做程序化比对。"""
    def index(facts: list[FactView]) -> tuple[dict[str, FactView], dict[str, str]]:
        by_key: dict[str, FactView] = {}
        label_map: dict[str, str] = {}
        for f in facts:
            key, label = normalize_field_key(f.field_key)
            by_key[key] = f
            label_map[key] = label
        return by_key, label_map

    a_map, a_labels = index(facts_a)
    b_map, b_labels = index(facts_b)
    all_keys: list[str] = []
    for key in list(a_map) + list(b_map):
        if key not in all_keys:
            all_keys.append(key)

    results: list[ComparisonView] = []
    for key in all_keys:
        fa, fb = a_map.get(key), b_map.get(key)
        label = a_labels.get(key) or b_labels.get(key) or key
        if fa is None or fb is None:
            status = "missing"
        else:
            eq = values_equal(key, fa.normalized_value if fa.normalized_value is not None else fa.raw_value,
                              fb.normalized_value if fb.normalized_value is not None else fb.raw_value,
                              fa.unit, fb.unit)
            status = "consistent" if eq is True else ("conflict" if eq is False else "missing")
        results.append(ComparisonView(
            field_key=key,
            label=label,
            value_a=(fa.normalized_value if fa and fa.normalized_value is not None else (fa.raw_value if fa else None)),
            value_b=(fb.normalized_value if fb and fb.normalized_value is not None else (fb.raw_value if fb else None)),
            status=status,
            evidence_a_id=fa.evidence_chunk_id if fa else None,
            evidence_b_id=fb.evidence_chunk_id if fb else None,
        ))
    return results
