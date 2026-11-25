"""数据泄漏审计（LEAK-001 ~ LEAK-010）。

核心原则：
- 不把所有重复样本都判定为泄漏——必须结合划分方式、重复比例与任务语义；
- 证据不足时输出 severity=unknown / confidence=low，不强行给结论；
- 代码扫描类规则（预处理泄漏 / 特征选择泄漏）基于确定性 AST 匹配，附代码行号。
"""
from __future__ import annotations

import ast
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.dataaudit.readers import (
    TableData,
    is_missing,
    split_of,
)
from app.dataaudit.schema import Evidence, Finding, get_rule

# 重复率阈值：低于此比例的重复更可能是正常情况（标注为 info 而非泄漏）
LOW_OVERLAP = 0.001      # 0.1%
MED_OVERLAP = 0.01       # 1%


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


# 样本级重复
def _row_key(row: dict[str, Any], exclude: set[str] | None = None) -> str:
    items = sorted(
        (k, str(v).strip()) for k, v in row.items()
        if k not in (exclude or set()) and not is_missing(v)
    )
    return "|".join(f"{k}={v}" for k, v in items)


def _label_columns(columns: list[str]) -> list[str]:
    hints = ("label", "target", "y_true", "class", "outcome", "diagnosis")
    return [c for c in columns if any(h in c.lower() for h in hints)]


def split_overlap_audit(tables: dict[str, TableData]) -> list[Finding]:
    """按文件路径推断划分，检测 train/val/test 间的重复样本。

    tables: 相对路径 -> TableData
    """
    out: list[Finding] = []
    splits: dict[str, list[tuple[str, TableData]]] = {}
    for path, td in tables.items():
        if td.parse_error or not td.columns:
            continue
        name = split_of(td, fallback=path)
        if name:
            norm = "train" if name in ("train", "training") else \
                   "val" if name in ("val", "valid", "validation") else \
                   "test" if name in ("test", "dev", "holdout") else name
            splits.setdefault(norm, []).append((path, td))

    if len(splits) < 2:
        out.append(_f(
            "LEAK-006", "unknown",
            "无法确定数据划分：文件名中未识别出 train/val/test 划分",
            evidence=[Evidence(file_path=list(tables)[0] if tables else "<none>",
                               detail=f"识别到的划分: {list(splits) or '无'}")],
            justification="没有划分信息就无法审计划分间泄漏；不强行判定",
            suggestion="按 train/val/test 命名数据文件，或提供 manifest 声明划分",
            confidence="high",
        ))
        return out

    # 建立每个划分的样本键集合
    keys: dict[str, dict[str, str]] = {}   # split -> key -> 出现的文件
    for split, entries in splits.items():
        keys[split] = {}
        for path, td in entries:
            for row in td.rows:
                k = _row_key(row)
                if k:
                    keys[split].setdefault(k, path)

    pairs = [("train", "test"), ("train", "val"), ("val", "test")]
    for a, b in pairs:
        if a not in keys or b not in keys:
            continue
        shared = set(keys[a]) & set(keys[b])
        if not shared:
            out.append(_f(
            "LEAK-001" if (a, b) == ("train", "test") else
            "LEAK-002" if (a, b) == ("train", "val") else "LEAK-005",
            "info",
            f"{a}/{b} 无完全重复样本（采样范围内）",
            evidence=[Evidence(file_path=f"{a} vs {b}",
                               detail=f"shared=0, {a}={len(keys[a])}, {b}={len(keys[b])}")],
            justification="键集合交集为空",
            confidence="medium",
            affects=f"{a},{b}",
        ))
            continue
        denom = max(min(len(keys[a]), len(keys[b])), 1)
        rate = len(shared) / denom
        sample = next(iter(shared))
        ev = [
            Evidence(file_path=keys[a].get(sample, "?"),
                     sample_id=sample[:120],
                     detail=f"{a}/{b} 共享 {len(shared)} 个样本键"),
            Evidence(file_path=keys[b].get(sample, "?"), sample_id=sample[:120]),
        ]
        # 比例低 + 无划分语义 → 不判为泄漏，标 info/unknown
        if rate < LOW_OVERLAP:
            out.append(_f(
                "LEAK-001" if (a, b) == ("train", "test") else "LEAK-002",
                "info",
                f"{a}/{b} 重复样本 {len(shared)} 个（{rate:.3%}），低于泄漏判定阈值",
                evidence=ev,
                justification=f"重复率 {rate:.3%} < {LOW_OVERLAP:.1%}，"
                              f"更可能是数据集固有重复而非划分泄漏",
                confidence="medium", affects=f"{a},{b}",
            ))
        elif rate < MED_OVERLAP:
            out.append(_f(
                "LEAK-001" if (a, b) == ("train", "test") else "LEAK-002",
                "medium",
                f"{a}/{b} 存在 {len(shared)} 个重复样本（{rate:.2%}），疑似划分泄漏",
                evidence=ev,
                justification=f"重复率 {rate:.2%} 超过低阈值但未达高阈值；"
                              f"需要结合任务语义判断（固有重复 vs 划分错误）",
                confidence="medium", suggestion="人工核查这些样本是否应被去重",
                affects=f"{a},{b}",
            ))
        else:
            out.append(_f(
                "LEAK-001" if (a, b) == ("train", "test") else "LEAK-002",
                "high",
                f"{a}/{b} 存在 {len(shared)} 个重复样本（{rate:.2%}），高概率数据泄漏",
                evidence=ev,
                justification=f"重复率 {rate:.2%} ≥ {MED_OVERLAP:.1%}，"
                              f"如此高的跨划分重复极可能是划分前未去重",
                suggestion="在划分前对全体数据去重，重新生成 train/val/test",
                affects=f"{a},{b}",
            ))
    return out


def internal_duplicate_audit(tables: dict[str, TableData]) -> list[Finding]:
    """LEAK-005 数据集内部重复（单个文件内的完全重复记录）。"""
    out: list[Finding] = []
    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        seen: dict[str, int] = {}
        for row in td.rows:
            k = _row_key(row)
            if k:
                seen[k] = seen.get(k, 0) + 1
        dups = {k: c for k, c in seen.items() if c > 1}
        if not dups:
            continue
        total_extra = sum(c - 1 for c in dups.values())
        rate = total_extra / max(len(td.rows), 1)
        sample_key = next(iter(dups))
        out.append(_f(
            "LEAK-005", "medium" if rate < 0.05 else "high",
            f"{Path(path).name} 内部存在 {total_extra} 条重复记录（{rate:.1%}）",
            evidence=[Evidence(file_path=path, sample_id=sample_key[:120],
                               detail=f"重复 {dups[sample_key]} 次")],
            justification=f"采样 {len(td.rows)} 行中 {rate:.1%} 为重复键",
            suggestion="训练前去重，避免模型对重复样本过拟合",
            confidence="medium",
        ))
    return out


def near_duplicate_audit(tables: dict[str, TableData],
                         image_paths: list[str]) -> list[Finding]:
    """LEAK-004 近似重复：文本 shingle Jaccard + 图片 aHash（Pillow 可用时）。"""
    out: list[Finding] = []

    # 文本近重复（字符 3-gram shingle，MinHash 简化为采样 Jaccard）
    def shingles(text: str, k: int = 3) -> set[str]:
        t = re.sub(r"\s+", " ", text.lower()).strip()
        return {t[i:i + k] for i in range(max(len(t) - k + 1, 0))}

    text_cols_cache: dict[str, list[tuple[str, str]]] = {}  # path -> [(row_idx, text)]
    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        str_cols = [c for c in td.columns
                    if any(isinstance(r.get(c), str) and len(str(r.get(c))) > 40
                           for r in td.rows[:5])]
        if not str_cols:
            continue
        entries = []
        for i, row in enumerate(td.rows):
            text = " ".join(str(row.get(c, "")) for c in str_cols)
            if len(text) > 40:
                entries.append((str(i), text))
        if entries:
            text_cols_cache[path] = entries

    all_entries: list[tuple[str, str, str]] = []  # (path, row_idx, text)
    for path, entries in text_cols_cache.items():
        for idx, text in entries:
            all_entries.append((path, idx, text))

    if len(all_entries) > 2:
        # 两两比较限制在采样上限内
        shingle_map = [(p, i, shingles(t)) for p, i, t in all_entries[:3000]]
        dup_pairs = 0
        first_pair: tuple[Any, ...] | None = None
        for a in range(len(shingle_map)):
            pa, ia, sa = shingle_map[a]
            if not sa:
                continue
            for b in range(a + 1, len(shingle_map)):
                pb, ib, sb = shingle_map[b]
                if not sb or (pa == pb and ia == ib):
                    continue
                inter = len(sa & sb)
                union = len(sa | sb)
                if union and inter / union >= 0.9:
                    dup_pairs += 1
                    if first_pair is None:
                        first_pair = (pa, ia, pb, ib)
        if dup_pairs and first_pair:
            pa, ia, pb, ib = first_pair
            out.append(_f(
                "LEAK-004", "medium",
                f"发现 {dup_pairs} 对近似重复文本样本（Jaccard ≥ 0.9）",
                evidence=[
                    Evidence(file_path=pa, sample_id=f"row#{ia}",
                             detail="近重复对之一"),
                    Evidence(file_path=pb, sample_id=f"row#{ib}",
                             detail="近重复对之二"),
                ],
                justification="字符 3-gram shingle Jaccard 相似度 ≥ 0.9",
                suggestion="确认是否为跨划分近重复；是则需去重后重新划分",
                confidence="medium",
            ))

    # 图片近重复（依赖 Pillow，缺失则明确 skipped）
    if image_paths:
        try:
            from PIL import Image  # type: ignore
        except ImportError:
            out.append(_f(
                "LEAK-004", "unknown",
                f"图片近重复检测已跳过（{len(image_paths)} 张图片）：Pillow 未安装",
                evidence=[Evidence(file_path=image_paths[0],
                                   detail="PIL import 失败")],
                justification="无法解码图片做感知哈希；不以字节哈希冒充近似检测",
                suggestion="pip install Pillow 以启用图片近重复检测",
                confidence="high",
            ))
        else:
            def ahash(p: str) -> int | None:
                try:
                    with Image.open(p) as im:          # 只读
                        g = im.convert("L").resize((8, 8))
                        px = list(g.getdata())
                    avg = sum(px) / 64
                    bits = 0
                    for i, v in enumerate(px):
                        if v >= avg:
                            bits |= 1 << i
                    return bits
                except Exception:  # noqa: BLE001
                    return None

            hashes: dict[int, list[str]] = {}
            unreadable = 0
            for p in image_paths[:500]:
                h = ahash(p)
                if h is None:
                    unreadable += 1
                else:
                    hashes.setdefault(h, []).append(p)
            groups = [g for g in hashes.values() if len(g) > 1]
            if groups:
                out.append(_f(
                    "LEAK-004", "medium",
                    f"{len(groups)} 组图片感知哈希完全相同（疑似同图不同文件名）",
                    evidence=[Evidence(file_path=g[0],
                                       detail=f"同组: {', '.join(g[1:3])}")],
                    justification="8×8 灰度均值哈希一致，图片内容高度相似",
                    suggestion="核查是否为同一图片以不同文件名进入不同划分",
                    confidence="medium",
                ))
            if unreadable:
                out.append(_f(
                    "INT-009", "medium",
                    f"{unreadable} 张图片无法解码（可能损坏）",
                    evidence=[Evidence(file_path=image_paths[0],
                                       detail=f"unreadable={unreadable}")],
                    justification="Pillow 打开/转换失败",
                    confidence="medium",
                ))
    return out


# 时序泄漏
def temporal_leakage_audit(tables: dict[str, TableData]) -> list[Finding]:
    """LEAK-006 时间序列未来信息泄漏。

    检测：1) 存在时间列但划分是随机命名（非按时间切分）；
          2) test 的最大时间早于 train 的最大时间（顺序倒置）。
    """
    out: list[Finding] = []
    time_hints = ("date", "time", "timestamp", "year", "month", "day")
    split_times: dict[str, tuple[float, float, str]] = {}  # split -> (min, max, col)

    for path, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        split = split_of(td, fallback=path)
        if not split:
            continue
        for col in td.columns:
            if not any(h in col.lower() for h in time_hints):
                continue
            nums: list[float] = []
            for row in td.rows:
                v = row.get(col)
                if is_missing(v):
                    continue
                m = re.search(r"(\d{4})[-/]?(\d{2})?[-/]?(\d{2})?", str(v))
                if m:
                    y = int(m.group(1))
                    mo = int(m.group(2) or 1)
                    d = int(m.group(3) or 1)
                    nums.append(y * 10000 + mo * 100 + d)
                else:
                    try:
                        nums.append(float(str(v)))
                    except (ValueError, TypeError):
                        pass
            if len(nums) >= 10:
                norm = "train" if split.startswith("train") else \
                       "test" if split.startswith("test") else \
                       "val" if split.startswith(("val", "valid")) else split
                split_times[norm] = (min(nums), max(nums), col)
                break

    if len(split_times) >= 2 and "train" in split_times and "test" in split_times:
        tr_min, tr_max, tr_col = split_times["train"]
        te_min, te_max, te_col = split_times["test"]
        # 顺序倒置：test 最大时间早于 train 最大时间 → test 不是"未来"
        if te_max < tr_max:
            out.append(_f(
                "LEAK-006", "high",
                f"测试集时间上界（{te_max:.0f}）早于训练集（{tr_max:.0f}），"
                f"时序划分疑似倒置",
                evidence=[Evidence(file_path="train", field=tr_col,
                                   detail=f"max={tr_max}"),
                          Evidence(file_path="test", field=te_col,
                                   detail=f"max={te_max}")],
                justification="若任务是时序预测，测试应代表未来；"
                              "当前测试时间早于训练，模型可能已'见过'未来",
                suggestion="按时间顺序重新划分：train 用较早时段，test 用较晚时段",
                confidence="medium",
            ))
        else:
            out.append(_f(
                "LEAK-006", "info",
                "训练/测试时间顺序正常（测试时间上界晚于训练）",
                evidence=[Evidence(file_path="train/test", field=tr_col,
                                   detail=f"train_max={tr_max}, test_max={te_max}")],
                justification="按时间顺序划分的必要条件满足",
                confidence="medium",
            ))
    elif len(split_times) >= 2:
        # 有时间列但没有 train/test 对，或没有时间列
        pass

    # 有时间列 + 划分文件名无时间语义 → 提示随机划分风险
    has_time_col = any(
        any(h in c.lower() for h in time_hints)
        for td in tables.values() for c in td.columns
    )
    has_random_split = any(
        split_of(td, fallback=p) in ("train", "training", "val", "valid",
                                     "validation", "test", "dev", "holdout")
        for p, td in tables.items()
    )
    if has_time_col and has_random_split and not any(
        re.search(r"(chronolog|time_?split|by_?time|temporal)", p, re.I)
        for p in tables
    ):
        out.append(_f(
            "LEAK-006", "medium",
            "数据含时间列但采用常规 train/val/test 命名，疑似随机划分",
            evidence=[Evidence(file_path=list(tables)[0],
                               detail="检测到时间列 + 常规划分命名")],
            justification="对时序任务随机划分会让未来信息进入训练集；"
                          "但无法从文件名确认是否按时间切分",
            suggestion="确认划分是否按时间进行；随机划分时序数据会引入泄漏",
            confidence="low",
        ))
    return out


# 标签泄漏
def label_leakage_audit(tables: dict[str, TableData]) -> list[Finding]:
    """LEAK-009 标签泄漏：输入特征与标签完全一致 / 标签名出现在特征列。"""
    out: list[Finding] = []
    for path, td in tables.items():
        if td.parse_error or not td.rows or not td.columns:
            continue
        labels = _label_columns(td.columns)
        if not labels:
            continue
        label = labels[0]
        label_vals = [str(r.get(label)) for r in td.rows]
        for col in td.columns:
            if col == label:
                continue
            col_vals = [str(r.get(col)) for r in td.rows]
            if label_vals == col_vals:
                out.append(_f(
                    "LEAK-009", "critical",
                    f"特征列 '{col}' 与标签列 '{label}' 完全相同：{Path(path).name}",
                    evidence=[Evidence(file_path=path, field=f"{col} == {label}",
                                       sample_id="all sampled rows",
                                       detail="两列逐行值完全一致")],
                    justification="标签被直接复制进输入特征，模型可直接读出答案",
                    suggestion="从特征集中移除该列",
                ))
            else:
                # 标签名直接出现在特征列名中（如 label_id 作为特征）
                if label.lower() in col.lower() and col.lower() != label.lower():
                    out.append(_f(
                        "LEAK-009", "high",
                        f"特征列名 '{col}' 包含标签名 '{label}'：{Path(path).name}",
                        evidence=[Evidence(file_path=path, field=col)],
                        justification="列名与标签同源，疑似标签派生特征进入输入",
                        suggestion="确认该列是否为目标的派生量，是则移除",
                        confidence="medium",
                    ))
    return out


# 代码扫描
_LEAK_SCAN_PATTERNS: list[tuple[str, str, str, str]] = [
    # (rule_id, regex, 判定描述, 建议)
    ("LEAK-007",
     r"\.(?:fit_transform|fit)\s*\(\s*(?:X\s*(?:=\s*)?)?\b(?:X_all|X_full|all_data|full_data|data\[.*\]|concat\s*\()",
     "预处理器在合并后的全量数据上 fit",
     "改为只在训练集上 fit，再 transform 训练/测试"),
    ("LEAK-007",
     r"StandardScaler\s*\(\s*\).*?(?:all|full|concat)",
     "StandardScaler 对全量数据拟合",
     "scaler.fit(X_train) 后分别 transform"),
    ("LEAK-008",
     r"(?:SelectKBest|RFECV|VarianceThreshold|PCA)\s*\([^)]*\).*?(?:fit_transform|fit)\s*\(\s*(?:X_all|X_full|concat)",
     "特征选择/降维在合并数据上执行",
     "特征选择只在训练集 fit"),
    ("LEAK-008",
     r"feature_select|select_features\s*\(\s*(?:X\s*\+\s*y|X_all|all_)",
     "特征选择疑似使用了全量数据",
     "特征选择仅使用训练集"),
    ("LEAK-010",
     r"(?:KFold|ShuffleSplit|train_test_split)\s*\([^)]*\)",
     "使用随机 K 折划分（需结合任务确认是否为时序）",
     "时序数据改用 TimeSeriesSplit / 按时间切分"),
]


def code_leakage_scan(code_files: list[tuple[str, str]]) -> list[Finding]:
    """扫描 Python 代码中的泄漏模式。code_files: [(rel_path, source)]。"""
    out: list[Finding] = []
    for path, source in code_files:
        if not source or len(source) > 2_000_000:
            continue
        # 预处理正向确认：fit(X_train) 模式
        has_train_fit = bool(re.search(
            r"\.(?:fit|fit_transform)\s*\(\s*X_train", source))
        has_full_fit = bool(re.search(
            r"\.(?:fit|fit_transform)\s*\(\s*(?:X_all|X_full|X\s*(?:,\s*y)?\s*\)|concat)",
            source))
        lines = source.splitlines()

        for rule_id, pattern, desc, suggestion in _LEAK_SCAN_PATTERNS:
            rx = re.compile(pattern, re.S)
            for i, line in enumerate(lines, 1):
                if rx.search(line):
                    # KFold 规则需额外确认不是 TimeSeriesSplit 场景
                    if rule_id == "LEAK-010" and "TimeSeriesSplit" in line:
                        continue
                    out.append(_f(
                        rule_id,
                        "high" if rule_id in ("LEAK-007", "LEAK-008") else "medium",
                        f"{desc}：{path}:{i}",
                        evidence=[Evidence(file_path=path,
                                           code_location=f"{path}:{i}",
                                           detail=line.strip()[:200])],
                        justification=f"代码行匹配已知泄漏模式：{desc}",
                        suggestion=suggestion,
                        confidence="medium",
                    ))

        # 正向确认 PRE-004 / LEAK-007 未命中
        if has_train_fit and not has_full_fit:
            out.append(_f(
                "PRE-004", "info",
                f"预处理参数仅从训练集拟合（正向确认）：{path}",
                evidence=[Evidence(file_path=path, detail="fit(X_train) 模式"),
                          Evidence(file_path=path,
                                   code_location=f"{path}:fit(X_train)")],
                justification="代码中仅见 X_train 上的 fit 调用，未见全量 fit",
                confidence="medium",
            ))
    return out


def cv_split_audit(code_files: list[tuple[str, str]],
                   tables: dict[str, TableData]) -> list[Finding]:
    """LEAK-010 交叉验证划分合理性：KFold 用于时序 / 分类未分层。"""
    out: list[Finding] = []
    has_time_col = any(
        any(h in c.lower() for h in ("date", "time", "timestamp", "year"))
        for td in tables.values() for c in td.columns
    )
    for path, source in code_files:
        for i, line in enumerate(source.splitlines(), 1):
            if "KFold(" in line and "TimeSeries" not in line and has_time_col:
                out.append(_f(
                    "LEAK-010", "medium",
                    f"时序数据可能使用随机 KFold：{path}:{i}",
                    evidence=[Evidence(file_path=path, code_location=f"{path}:{i}",
                                       detail=line.strip()[:200])],
                    justification="数据含时间列，随机 KFold 会打乱时间顺序",
                    suggestion="改用 TimeSeriesSplit 或按时间切分",
                    confidence="low",
                ))
            if re.search(r"StratifiedKFold", line):
                out.append(_f(
                    "LEAK-010", "info",
                    f"已使用分层 K 折（正向确认）：{path}:{i}",
                    evidence=[Evidence(file_path=path, code_location=f"{path}:{i}")],
                    justification="StratifiedKFold 保证类别比例一致",
                    confidence="high",
                ))
    return out
