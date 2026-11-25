"""数据分布与统计审计（DIST-001 / 002 / 005 / 006）。

DIST-003 极端值与 DIST-004 缺失已在 integrity.py 中实现，此处不重复。
全部为纯 Python 确定性计算：类别比例、PSI（群体稳定性指数）、规模评估。
"""
from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from app.dataaudit.readers import TableData, is_missing, split_of
from app.dataaudit.schema import Evidence, Finding, get_rule

# PSI 阈值（业界常用）：0.1 显著漂移，0.25 严重漂移
PSI_SIGNIFICANT = 0.1
PSI_SEVERE = 0.25
# 类别不平衡：少数类占比 < 5% 视为显著不平衡
IMBALANCE_MINORITY_RATIO = 0.05
IMBALANCE_RATIO = 0.05 / 0.95  # 少数:多数 < 1:19
# 数据集规模下限（低于此样本量难以支撑统计结论）
MIN_TOTAL_ROWS = 100
MIN_PER_SPLIT = 30

LABEL_HINTS = ("label", "target", "y_true", "class", "outcome", "diagnosis", "sentiment")


def _f(rule_id: str, severity: str, message: str, *,
       evidence: list[Evidence], justification: str,
       confidence: str = "high", suggestion: str = "",
       affects: str = "") -> Finding:
    rule = get_rule(rule_id)
    return Finding(
        rule_id=rule_id, rule_name=rule.name, severity=severity,
        message=message, confidence=confidence, evidence=evidence,
        justification=justification, suggestion=suggestion, affects=affects,
    )


def _label_column(td: TableData) -> str | None:
    for c in td.columns:
        low = c.lower()
        if any(h in low for h in LABEL_HINTS):
            return c
    return None


def _value_counts(td: TableData, col: str, *,
                  max_rows: int = 10_000) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in td.rows[:max_rows]:
        v = row.get(col)
        if is_missing(v):
            counts["<missing>"] = counts.get("<missing>", 0) + 1
        else:
            key = str(v).strip()[:80]
            counts[key] = counts.get(key, 0) + 1
    return counts


# DIST-001 类别不平衡
def class_balance_audit(tables: dict[str, TableData]) -> list[Finding]:
    """DIST-001 类别分布 / 不平衡。基于采样行，附类别比例证据。"""
    out: list[Finding] = []
    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        col = _label_column(td)
        if not col:
            continue
        counts = _value_counts(td, col)
        total = sum(counts.values())
        if total < 20 or len(counts) < 2:
            continue
        ranked = sorted(counts.items(), key=lambda kv: kv[1])
        minority_label, minority_n = ranked[0]
        majority_n = ranked[-1][1]
        minority_ratio = minority_n / total
        if minority_ratio < IMBALANCE_MINORITY_RATIO:
            ratio = minority_n / max(majority_n, 1)
            out.append(_f(
                "DIST-001", "medium",
                f"类别 '{col}' 严重不平衡：'{minority_label}' 仅占 "
                f"{minority_ratio:.2%}（{minority_n}/{total}）：{Path(path).name}",
                evidence=[Evidence(file_path=path, field=col,
                                   sample_id=f"class={minority_label}",
                                   detail=f"分布 top3: {dict(ranked[-3:])}")],
                justification=f"少数类占比 {minority_ratio:.2%} < "
                              f"{IMBALANCE_MINORITY_RATIO:.0%}，多数:少数 ≈ "
                              f"{1 / max(ratio, 1e-9):.0f}:1",
                suggestion="准确率指标在不平衡数据上不可信；"
                           "报告 F1/PR-AUC 或使用重采样/类别权重",
                confidence="medium",
            ))
        elif len(counts) > 20:
            out.append(finding_multi_class(path, col, counts, total))
    return out


def finding_multi_class(path: str, col: str, counts: dict[str, int],
                        total: int) -> Finding:
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:3]
    return _f(
        "DIST-001", "low",
        f"标签 '{col}' 有 {len(counts)} 个类别（多分类）：{Path(path).name}",
        evidence=[Evidence(file_path=path, field=col,
                           detail=f"top3={top}, total={total}")],
        justification="高基数标签需确认评估是否覆盖长尾类别",
        suggestion="检查长尾类别的召回率，必要时合并稀有类",
        confidence="medium",
    )


# DIST-002 训练/测试分布差异
def _psi(expected: list[float], actual: list[float], bins: int = 10) -> float:
    """群体稳定性指数。expected=训练分布, actual=测试分布。"""
    if not expected or not actual:
        return 0.0
    lo, hi = min(expected + actual), max(expected + actual)
    if hi <= lo:
        return 0.0
    width = (hi - lo) / bins

    def bucket(vals: list[float]) -> list[float]:
        cnt = [0.0] * bins
        for v in vals:
            idx = min(bins - 1, max(0, int((v - lo) / width)))
            cnt[idx] += 1
        n = sum(cnt) or 1.0
        # 拉普拉斯平滑，避免 0 占比导致 PSI 无穷
        return [(c + 0.5) / (n + 0.5 * bins) for c in cnt]

    e, a = bucket(expected), bucket(actual)
    return sum((a[i] - e[i]) * math.log(a[i] / e[i]) for i in range(bins))


def _numeric_values(td: TableData, col: str) -> list[float]:
    vals: list[float] = []
    for row in td.rows:
        v = row.get(col)
        if is_missing(v):
            continue
        try:
            vals.append(float(str(v).strip()))
        except (ValueError, TypeError):
            continue
    return vals


def distribution_shift_audit(tables: dict[str, TableData]) -> list[Finding]:
    """DIST-002 训练/测试分布差异：数值列 PSI + 标签分布卡方近似。"""
    out: list[Finding] = []
    splits: dict[str, dict[str, TableData]] = {}
    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        name = split_of(td, fallback=path)
        if not name:
            continue
        norm = ("train" if name.startswith("train") else
                "val" if name.startswith(("val", "valid")) else
                "test" if name.startswith(("test", "dev")) else name)
        splits.setdefault(norm, {})[path] = td

    if "train" not in splits or "test" not in splits:
        return out

    train_tables = list(splits["train"].values())
    test_tables = list(splits["test"].values())
    if not train_tables or not test_tables:
        return out
    tr, te = train_tables[0], test_tables[0]

    # 数值特征 PSI
    for col in tr.columns:
        if col not in te.columns:
            continue
        ev_tr = _numeric_values(tr, col)
        ev_te = _numeric_values(te, col)
        if len(ev_tr) < 30 or len(ev_te) < 30:
            continue
        psi = _psi(ev_tr, ev_te)
        if psi >= PSI_SIGNIFICANT:
            sev = "high" if psi >= PSI_SEVERE else "medium"
            out.append(_f(
                "DIST-002", sev,
                f"特征 '{col}' 训练/测试分布漂移 PSI={psi:.3f}",
                evidence=[Evidence(file_path=tr.path, field=col,
                                   detail=f"train n={len(ev_tr)}, "
                                          f"mean={sum(ev_tr)/len(ev_tr):.4g}"),
                          Evidence(file_path=te.path, field=col,
                                   detail=f"test n={len(ev_te)}, "
                                          f"mean={sum(ev_te)/len(ev_te):.4g}")],
                justification=f"PSI={psi:.3f} ≥ {PSI_SIGNIFICANT}，"
                              "训练与测试来自明显不同的分布",
                suggestion="确认数据划分是否随机；分布漂移会使离线指标高估线上表现",
                confidence="medium", affects="train,test",
            ))

    # 标签分布差异
    label = _label_column(tr)
    if label and label in te.columns:
        c_tr = _value_counts(tr, label)
        c_te = _value_counts(te, label)
        cats = set(c_tr) | set(c_te)
        if len(cats) >= 2:
            diffs = []
            for cat in sorted(cats):
                p_tr = c_tr.get(cat, 0) / max(sum(c_tr.values()), 1)
                p_te = c_te.get(cat, 0) / max(sum(c_te.values()), 1)
                diffs.append((cat, p_tr, p_te))
            max_gap = max(abs(a - b) for _, a, b in diffs)
            if max_gap > 0.1:
                worst = max(diffs, key=lambda d: abs(d[1] - d[2]))
                out.append(_f(
                    "DIST-002", "medium",
                    f"标签 '{label}' 训练/测试比例差异达 {max_gap:.1%}："
                    f"类别 '{worst[0]}' {worst[1]:.1%} vs {worst[2]:.1%}",
                    evidence=[Evidence(file_path=tr.path, field=label,
                                       detail=f"train dist={dict(c_tr)}"),
                              Evidence(file_path=te.path, field=label,
                                       detail=f"test dist={dict(c_te)}")],
                    justification="同一类别在两个划分中的占比相差超过 10 个百分点",
                    suggestion="使用分层划分（stratified split）保持类别比例一致",
                    confidence="medium", affects="train,test",
                ))
    return out


# DIST-005 样本偏差
def split_proportion_audit(tables: dict[str, TableData]) -> list[Finding]:
    """DIST-005 各划分的类别比例不一致（划分可能非随机 / 存在偏差）。"""
    out: list[Finding] = []
    split_props: dict[str, tuple[str, dict[str, int]]] = {}
    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        name = split_of(td, fallback=path)
        if not name:
            continue
        norm = ("train" if name.startswith("train") else
                "val" if name.startswith(("val", "valid")) else
                "test" if name.startswith(("test", "dev")) else name)
        col = _label_column(td)
        if not col:
            continue
        split_props[norm] = (path, _value_counts(td, col))

    if len(split_props) < 2:
        return out

    names = list(split_props)
    base_path, base_counts = split_props[names[0]]
    base_total = max(sum(base_counts.values()), 1)
    worst_gap, worst_cat, worst_pair = 0.0, "", ("", "")
    for other in names[1:]:
        o_path, o_counts = split_props[other]
        o_total = max(sum(o_counts.values()), 1)
        for cat in set(base_counts) | set(o_counts):
            p1 = base_counts.get(cat, 0) / base_total
            p2 = o_counts.get(cat, 0) / o_total
            if abs(p1 - p2) > worst_gap:
                worst_gap = abs(p1 - p2)
                worst_cat = cat
                worst_pair = (names[0], other)

    if worst_gap > 0.05:
        out.append(_f(
            "DIST-005", "medium",
            f"划分 '{worst_pair[0]}' 与 '{worst_pair[1]}' 的类别 "
            f"'{worst_cat}' 比例相差 {worst_gap:.1%}",
            evidence=[Evidence(file_path=base_path, field="label",
                               detail=f"{worst_pair[0]} dist={base_counts}"),
                      Evidence(file_path=split_props[worst_pair[1]][0],
                               field="label",
                               detail=f"{worst_pair[1]} dist="
                                      f"{split_props[worst_pair[1]][1]}")],
            justification="同一类别在不同划分中的占比差异超过 5 个百分点，"
                          "划分可能非随机或存在抽样偏差",
            suggestion="确认划分是否分层（stratified）；必要时重新划分",
            confidence="medium",
        ))
    return out


# DIST-006 规模
def dataset_scale_audit(tables: dict[str, TableData]) -> list[Finding]:
    """DIST-006 数据集规模过小。"""
    out: list[Finding] = []
    if not tables:
        return out
    total = sum(td.total_rows for td in tables.values() if not td.parse_error)
    paths = [p for p, td in tables.items() if not td.parse_error]

    if total < MIN_TOTAL_ROWS:
        out.append(_f(
            "DIST-006", "medium",
            f"数据集总规模仅 {total} 行，低于 {MIN_TOTAL_ROWS} 行参考下限",
            evidence=[Evidence(file_path=paths[0] if paths else "<none>",
                               detail=f"total_rows={total}, files={len(paths)}")],
            justification="小样本上的实验结论统计功效不足，"
                          "单次划分的偶然性会显著影响指标",
            suggestion="报告置信区间或多次划分的均值±方差；说明样本量限制",
            confidence="medium",
        ))

    split_rows: dict[str, int] = {}
    for path, td in tables.items():
        if td.parse_error:
            continue
        name = split_of(td, fallback=path)
        if name:
            norm = ("train" if name.startswith("train") else
                    "val" if name.startswith(("val", "valid")) else
                    "test" if name.startswith(("test", "dev")) else name)
            split_rows[norm] = split_rows.get(norm, 0) + td.total_rows
    for norm, n in sorted(split_rows.items()):
        if 0 < n < MIN_PER_SPLIT:
            out.append(_f(
                "DIST-006", "medium",
                f"划分 '{norm}' 仅 {n} 个样本（低于 {MIN_PER_SPLIT}）",
                evidence=[Evidence(file_path=norm, detail=f"rows={n}")],
                justification="测试/验证集过小，指标方差极大，"
                              "个别样本错误即可改变结论",
                suggestion="扩充该划分或使用交叉验证",
                confidence="medium", affects=norm,
            ))
    return out


def collect_dataset_stats(tables: dict[str, TableData]) -> dict[str, Any]:
    """汇总数据集统计（写入报告 stats）。"""
    stats: dict[str, Any] = {
        "files": len(tables),
        "total_rows": 0,
        "per_file": {},
        "splits": {},
    }
    for path, td in tables.items():
        if td.parse_error:
            stats["per_file"][path] = {"error": td.parse_error}
            continue
        stats["per_file"][path] = {
            "rows": td.total_rows,
            "sampled": len(td.rows),
            "columns": len(td.columns),
        }
        stats["total_rows"] += td.total_rows
        name = split_of(td, fallback=path)
        if name:
            norm = ("train" if name.startswith("train") else
                    "val" if name.startswith(("val", "valid")) else
                    "test" if name.startswith(("test", "dev")) else name)
            stats["splits"][norm] = stats["splits"].get(norm, 0) + td.total_rows
    return stats
