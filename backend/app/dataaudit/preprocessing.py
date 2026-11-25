"""数据预处理审计（PRE-001 / 002 / 003 / 005）。

PRE-004（参数仅从训练集拟合的正向确认）由 leakage.code_leakage_scan 输出。
本模块基于确定性代码模式匹配 + 表结构对比，全部附代码行号或字段证据。
"""
from __future__ import annotations

import re
from pathlib import Path

from app.dataaudit.readers import TableData, is_missing, split_of
from app.dataaudit.schema import Evidence, Finding, get_rule

# (规则, 正则, 描述, 建议, 默认严重度)
_PRE_PATTERNS: list[tuple[str, str, str, str, str]] = [
    ("PRE-001",
     r"(?:StandardScaler|MinMaxScaler|RobustScaler|MaxAbsScaler|Normalizer)\s*\(",
     "代码中存在缩放/归一化操作",
     "确认 scaler 仅在训练集 fit，再 transform 测试集",
     "medium"),
    ("PRE-003",
     r"(?:fit_transform|fit)\s*\(\s*(?:X_test|X_val|test_data|val_data)",
     "在测试/验证集上调用 fit 或 fit_transform",
     "测试集只允许 transform，不允许 fit（否则预处理参数泄漏）",
     "high"),
    ("PRE-005",
     r"(?:augment|Augment|RandomFlip|RandomRotation|RandomCrop|"
     r"ColorJitter|Mixup|CutMix| albumentations|Compose\()",
     "代码中存在数据增强",
     "确认增强只作用于训练集；测试集应使用确定性预处理",
     "info"),
]

_FILL_PATTERNS = re.compile(
    r"(?:SimpleImputer|KNNImputer|fill_na|fillna|impute|"
    r"MissingIndicator|dropna)\s*\(", re.I)
_ENCODING_PATTERNS = re.compile(
    r"(?:OneHotEncoder|OrdinalEncoder|LabelEncoder|TargetEncoder|"
    r"get_dummies)\s*\(", re.I)
# 训练/测试分别走了不同预处理路径的迹象
_DIFF_PREPROCESS = re.compile(
    r"(?:train_transform|test_transform|train_tf|test_tf|"
    r"train_pipeline|test_pipeline)\s*=", re.I)


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


def _split_of(path: str, td: TableData | None = None) -> str | None:
    name = split_of(td, fallback=path) if td is not None else None
    if name is None:
        from app.dataaudit.readers import infer_split_name
        name = infer_split_name(path)
    if not name:
        return None
    return ("train" if name.startswith("train") else
            "val" if name.startswith(("val", "valid")) else
            "test" if name.startswith(("test", "dev")) else name)


def preprocessing_code_scan(code_files: list[tuple[str, str]]) -> list[Finding]:
    """扫描代码中的预处理操作（PRE-001 / PRE-003 / PRE-005）。"""
    out: list[Finding] = []
    for path, source in code_files:
        if not source or len(source) > 2_000_000:
            continue
        lines = source.splitlines()
        for rule_id, pattern, desc, suggestion, sev in _PRE_PATTERNS:
            rx = re.compile(pattern)
            hits = [i for i, line in enumerate(lines, 1) if rx.search(line)]
            if not hits:
                continue
            if rule_id == "PRE-001":
                # 拟合范围不明：只有当没有明确 fit(X_train) 时才提示
                if re.search(r"\.(?:fit|fit_transform)\s*\(\s*X_train", source):
                    continue  # leakage.py 的 PRE-004 已正向确认
                sev = "medium"
                conf = "low"
                just = "检测到缩放操作，但未找到 fit(X_train) 模式，" \
                       "无法确认参数只从训练集拟合"
            elif rule_id == "PRE-003":
                conf = "high"
                just = "在测试/验证数据上调用 fit，预处理参数将受测试集影响"
            else:  # PRE-005 正向确认
                conf = "medium"
                just = "存在数据增强操作；需人工确认仅作用于训练集"
            i = hits[0]
            out.append(_f(
                rule_id, sev,
                f"{desc}：{path}:{i}",
                evidence=[Evidence(file_path=path, code_location=f"{path}:{i}",
                                   detail=lines[i - 1].strip()[:200])],
                justification=just,
                suggestion=suggestion,
                confidence=conf,
                affects="train" if rule_id == "PRE-005" else "",
            ))
    return out


def train_test_preprocess_consistency(
    code_files: list[tuple[str, str]],
    tables: dict[str, TableData],
) -> list[Finding]:
    """PRE-003 训练与测试预处理一致性（代码路径 + 表结构两个角度）。"""
    out: list[Finding] = []

    # 角度一：代码中训练/测试 transform 定义内容不同
    for path, source in code_files:
        defs: dict[str, list[str]] = {}
        for i, line in enumerate(source.splitlines(), 1):
            m = _DIFF_PREPROCESS.search(line)
            if m:
                defs.setdefault(m.group(0).lower(), []).append(f"{path}:{i}")
        if len(defs) >= 2:
            locs = [v[0] for v in defs.values()]
            out.append(_f(
                "PRE-003", "medium",
                f"训练与测试定义了不同的预处理路径：{path}",
                evidence=[Evidence(file_path=path, code_location=loc,
                                   detail="独立的 train/test transform 定义")
                          for loc in locs],
                justification="存在独立的 train_transform 与 test_transform 定义，"
                              "两者内容可能不一致（需人工比对）",
                suggestion="统一预处理管道，仅在数据增强上区分训练/测试",
                confidence="low",
            ))

    # 角度二：同名列在 train/test 文件间的类型推断不一致
    splits: dict[str, dict[str, TableData]] = {}
    for p, td in tables.items():
        if td.parse_error or not td.rows:
            continue
        s = _split_of(p, td)
        if s:
            splits.setdefault(s, {})[p] = td
    if "train" in splits and "test" in splits:
        tr = next(iter(splits["train"].values()))
        te = next(iter(splits["test"].values()))
        for col in tr.columns:
            if col not in te.columns:
                continue
            def kind(td: TableData) -> str | None:
                nums = strs = 0
                for row in td.rows[:200]:
                    v = row.get(col)
                    if is_missing(v):
                        continue
                    try:
                        float(str(v).strip())
                        nums += 1
                    except (ValueError, TypeError):
                        strs += 1
                if nums and strs:
                    return "mixed"
                if nums:
                    return "numeric"
                return "str" if strs else None
            k1, k2 = kind(tr), kind(te)
            if k1 and k2 and k1 != k2 and "mixed" not in (k1, k2):
                out.append(_f(
                    "PRE-003", "high",
                    f"列 '{col}' 在训练与测试中的类型不一致"
                    f"（{k1} vs {k2}）",
                    evidence=[Evidence(file_path=tr.path, field=col,
                                       detail=f"train type={k1}"),
                              Evidence(file_path=te.path, field=col,
                                       detail=f"test type={k2}")],
                    justification="同一字段在两个划分中类型不同，"
                                  "说明编码/解析方式不一致，直接拼接会错位",
                    suggestion="统一读取与编码逻辑，保证 train/test 同一 schema",
                    confidence="medium", affects="train,test",
                ))
    return out


def missing_imputation_audit(
    tables: dict[str, TableData],
    code_files: list[tuple[str, str]],
) -> list[Finding]:
    """PRE-002 缺失值填充策略未声明：数据有缺失但代码中找不到填充逻辑。"""
    out: list[Finding] = []
    missing_tables: list[tuple[str, str, float]] = []
    for path, td in tables.items():
        if td.parse_error or not td.rows or not td.columns:
            continue
        n = len(td.rows)
        for col in td.columns:
            miss = sum(1 for r in td.rows if is_missing(r.get(col)))
            rate = miss / n
            if 0.05 < rate < 0.95:
                missing_tables.append((path, col, rate))
    if not missing_tables:
        return out

    has_impute = any(_FILL_PATTERNS.search(src) for _, src in code_files)
    if has_impute:
        return out  # 已声明填充策略 → 不报

    path, col, rate = missing_tables[0]
    out.append(_f(
        "PRE-002", "low",
        f"字段 '{col}' 缺失率 {rate:.1%}，但代码中未见缺失值填充策略",
        evidence=[Evidence(file_path=path, field=col,
                           detail=f"missing_rate={rate:.1%}")],
        justification="数据存在缺失且代码扫描未命中 fillna/Imputer/dropna 模式；"
                      "也可能是填充发生在未提供的代码中",
        suggestion="在代码或配置中声明缺失值处理（填充/删除/保留）",
        confidence="low",
    ))
    return out


def encoding_audit(tables: dict[str, TableData],
                   code_files: list[tuple[str, str]]) -> list[Finding]:
    """类别字段存在但代码无编码逻辑 → 并入 PRE-002 观察项。"""
    out: list[Finding] = []
    has_encode = any(_ENCODING_PATTERNS.search(src) for _, src in code_files)
    if has_encode:
        return out
    for path, td in tables.items():
        if td.parse_error or len(td.rows) < 20:
            continue
        for col in td.columns:
            vals = {str(r.get(col)).strip() for r in td.rows[:500]
                    if not is_missing(r.get(col))}
            if 2 <= len(vals) <= 20 and all(
                not _looks_numeric(v) for v in vals
            ):
                out.append(_f(
                    "PRE-002", "info",
                    f"类别字段 '{col}'（{len(vals)} 个取值）未见编码代码："
                    f"{Path(path).name}",
                    evidence=[Evidence(file_path=path, field=col,
                                       detail=f"sample_values={sorted(vals)[:5]}")],
                    justification="非数值类别字段存在，但代码中未见 "
                                  "OneHot/LabelEncoder/get_dummies 模式",
                    suggestion="确认特征编码发生在何处（可能在未提供的代码中）",
                    confidence="low",
                ))
                break
    return out


def _looks_numeric(v: str) -> bool:
    try:
        float(v)
        return True
    except ValueError:
        return False
