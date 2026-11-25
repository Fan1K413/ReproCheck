"""实验统计计算引擎（STAT-001 ~ STAT-010）。

设计约束
--------
1. 只依赖标准库；scipy 可用时用 scipy 的分布函数，不可用时用纯 Python 后备
   （erf 正态 CDF、不完全 beta 连分式的 t 分布 CDF、二分法求分位数）。
   两条路径的公开数值一致到 1e-4 以内。
2. 所有对外函数返回 JSON 可序列化的 dict，统一含
   ``supported / value / values / formula / inputs / note / method`` 七个字段。
   计算得到的数值统一 round 到 6 位；inputs 保留调用方原值以便复跑。
3. 数据不足一律 ``supported=False``，绝不编造数值；``audit`` 对缺失字段产出
   ``insufficient_evidence`` 发现。
4. finding 的 message 只陈述统计事实，不含因果断言。

``audit(payload)`` 的 payload 结构（全部字段可选，缺失即对应规则证据不足）::

    {
      "claims": {"mean": 3.0, "std": 1.58},          # 论文/调用方报告值
      "samples": {"values": [1, 2, 3, 4, 5], "ddof": 1},  # 原始样本（也接受 list）
      "runs": [{"name": "r1", "values": [...]}, ...],     # 多次独立运行
      "seed_scores": {"seed42": [..], "seed7": [..]},     # 按随机种子分组的分数
      "group_a": [...], "group_b": [...],                 # 两组样本
      "alpha": 0.05,                                      # 显著性水平
      "test_kind": "welch", "paired": false, "mu0": 0.0,   # 假设检验选项
      "pvalues": [0.01, 0.02, 0.03],                       # 多重比较原始 p 值
      "multiple_method": "holm",                          # bonferroni/holm/bh/by
      "effect_kind": "cohens_d",                          # cohens_d/hedges_g/glass_delta
      "ci_level": 0.95, "ci_method": "t",                 # 置信区间选项
      "power": 0.8, "power_kind": "two_sample",           # 功效分析选项
      "outlier_method": "iqr", "outlier_threshold": 1.5,  # 异常识别选项
      "bins": 10                                          # 直方图分箱数
    }

返回值::

    {"findings": [FindingDict, ...], "computations": {...}, "notes": [...]}
"""
from __future__ import annotations

import math
from typing import Any, Iterable

try:  # schema 是单一真相源；这里只 import，不修改
    from .schema import Evidence, Verdict, get_rule
except ImportError:  # pragma: no cover - 兼容以顶层包方式导入
    from app.statsaudit.schema import Evidence, Verdict, get_rule

try:  # scipy 为可选加速依赖，缺失时全程走纯 Python 后备
    from scipy import stats as _sp_stats  # type: ignore
except Exception:  # pragma: no cover - 环境未安装 scipy
    _sp_stats = None


# 通用工具

def _json_safe(obj: Any) -> Any:
    """把不可 JSON 序列化的浮点（nan/inf）转为 None，其余原样返回。"""
    if isinstance(obj, bool) or obj is None or isinstance(obj, str):
        return obj
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, int):
        return obj
    if isinstance(obj, dict):
        return {str(k): _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [_json_safe(v) for v in obj]
    return str(obj)


def _deep_round(obj: Any) -> Any:
    """对计算结果中的数值统一保留 6 位；bool 不当作数值处理。"""
    if isinstance(obj, bool) or obj is None or isinstance(obj, str):
        return obj
    if isinstance(obj, float):
        return round(obj, 6) if math.isfinite(obj) else None
    if isinstance(obj, int):
        return obj
    if isinstance(obj, dict):
        return {k: _deep_round(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_deep_round(v) for v in obj]
    return obj


def _result(
    *,
    supported: bool,
    value: Any = None,
    values: dict[str, Any] | None = None,
    formula: str = "",
    inputs: dict[str, Any] | None = None,
    method: str = "",
    note: str = "",
    **extra: Any,
) -> dict[str, Any]:
    """构造统一返回契约；七个必备字段始终存在。"""
    out: dict[str, Any] = {
        "supported": bool(supported),
        "value": _deep_round(value),
        "values": _deep_round(values or {}),
        "formula": formula,
        "inputs": _json_safe(inputs or {}),
        "method": method,
        "note": note,
    }
    for key, val in extra.items():
        out[key] = _deep_round(val)
    return out


def _unsupported(method: str, formula: str, inputs: dict[str, Any], note: str, **extra: Any) -> dict[str, Any]:
    return _result(supported=False, values={}, formula=formula, inputs=inputs,
                   method=method, note=note, **extra)


def _clean(values: Any) -> list[float]:
    """抽取有限数值；无法解析的条目静默跳过。"""
    if values is None:
        return []
    if isinstance(values, (str, bytes)):
        return []
    try:
        iterator: Iterable[Any] = list(values)
    except TypeError:
        return []
    out: list[float] = []
    for v in iterator:
        if isinstance(v, bool):
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            out.append(f)
    return out


def _mean(xs: list[float]) -> float:
    return sum(xs) / len(xs)


def _var(xs: list[float], ddof: int = 1) -> float | None:
    n = len(xs)
    if n - ddof <= 0:
        return None
    m = _mean(xs)
    return sum((x - m) ** 2 for x in xs) / (n - ddof)


def _std(xs: list[float], ddof: int = 1) -> float | None:
    v = _var(xs, ddof)
    return math.sqrt(v) if v is not None and v >= 0 else None


def _quantile(xs: list[float], q: float) -> float:
    """线性插值分位数（与 numpy 默认口径一致）。"""
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    pos = (len(s) - 1) * min(max(q, 0.0), 1.0)
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    if lo == hi:
        return s[lo]
    return s[lo] * (hi - pos) + s[hi] * (pos - lo)


# 纯 Python 分布函数后备

def _betacf(a: float, b: float, x: float) -> float:
    """正则化不完全 beta 的连分式（Lentz 算法）。"""
    maxit, eps, fpmin = 300, 3.0e-14, 1.0e-300
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < fpmin:
        d = fpmin
    d = 1.0 / d
    h = d
    for m in range(1, maxit + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < fpmin:
            d = fpmin
        c = 1.0 + aa / c
        if abs(c) < fpmin:
            c = fpmin
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < eps:
            break
    return h


def _betai(a: float, b: float, x: float) -> float:
    """正则化不完全 beta 函数 I_x(a,b)。"""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    try:
        log_bt = (math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b)
                  + a * math.log(x) + b * math.log1p(-x))
        bt = math.exp(log_bt)
    except (ValueError, OverflowError):
        return 0.0
    if x < (a + 1.0) / (a + b + 2.0):
        return max(0.0, min(1.0, bt * _betacf(a, b, x) / a))
    return max(0.0, min(1.0, 1.0 - bt * _betacf(b, a, 1.0 - x) / b))


def _norm_cdf_py(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def _norm_ppf_py(p: float) -> float:
    p = min(max(p, 1.0e-12), 1.0 - 1.0e-12)
    lo, hi = -40.0, 40.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _norm_cdf_py(mid) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _t_sf_py(t: float, df: float) -> float:
    """t 分布右尾概率 t>0。"""
    if df <= 0:
        return float("nan")
    if t <= 0:
        return 0.5 - 0.5 * _betai(df / 2.0, 0.5, df / (df + t * t)) if t < 0 else 0.5
    return 0.5 * _betai(df / 2.0, 0.5, df / (df + t * t))


def _t_two_sided_p(t: float, df: float) -> float:
    if df <= 0 or not math.isfinite(t):
        return float("nan")
    if _sp_stats is not None:  # scipy 可用时优先
        try:
            return float(2.0 * _sp_stats.t.sf(abs(t), df))
        except Exception:  # pragma: no cover
            pass
    return max(0.0, min(1.0, _betai(df / 2.0, 0.5, df / (df + t * t))))


def _t_cdf(t: float, df: float) -> float:
    if _sp_stats is not None:  # scipy 可用时优先
        try:
            return float(_sp_stats.t.cdf(t, df))
        except Exception:  # pragma: no cover
            pass
    return 1.0 - _t_sf_py(t, df)


def _t_ppf(p: float, df: float) -> float:
    if df <= 0:
        return float("nan")
    if _sp_stats is not None:  # scipy 可用时优先
        try:
            return float(_sp_stats.t.ppf(p, df))
        except Exception:  # pragma: no cover
            pass
    if p < 0.5:
        return -_t_ppf(1.0 - p, df)
    p = min(max(p, 1.0e-12), 1.0 - 1.0e-12)
    lo, hi = 0.0, 1000.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if _t_cdf(mid, df) < p:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _norm_cdf(z: float) -> float:
    if _sp_stats is not None:  # scipy 可用时优先
        try:
            return float(_sp_stats.norm.cdf(z))
        except Exception:  # pragma: no cover
            pass
    return _norm_cdf_py(z)


def _norm_ppf(p: float) -> float:
    if _sp_stats is not None:  # scipy 可用时优先
        try:
            return float(_sp_stats.norm.ppf(p))
        except Exception:  # pragma: no cover
            pass
    return _norm_ppf_py(p)


def _distribution_backend() -> str:
    return "scipy" if _sp_stats is not None else "pure_python"


# 基础原语 mean/std/var

def mean(values: Any) -> dict[str, Any]:
    """算术均值：mean = sum(x_i) / n。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values)}
    if not xs:
        return _unsupported("arithmetic_mean", "mean = sum(x_i) / n", inputs,
                            "没有可用样本，均值未计算。", n=0)
    m = _mean(xs)
    return _result(supported=True, value=m, values={"mean": m, "n": len(xs), "sum": sum(xs)},
                   formula="mean = sum(x_i) / n", inputs=inputs,
                   method="arithmetic_mean", note="样本已过滤非数值与无穷值。", n=len(xs))


def std(values: Any, ddof: int = 1) -> dict[str, Any]:
    """标准差；默认 ddof=1 即样本标准差。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values), "ddof": ddof}
    formula = "s = sqrt( sum((x_i - mean)^2) / (n - ddof) )"
    if not xs or len(xs) - ddof <= 0 or ddof < 0:
        return _unsupported("sample_std", formula, inputs,
                            "样本量不足以按给定 ddof 计算标准差。", n=len(xs), ddof=ddof)
    s = _std(xs, ddof)
    if s is None:
        return _unsupported("sample_std", formula, inputs, "标准差计算遇到无效数值。", n=len(xs))
    return _result(supported=True, value=s,
                   values={"std": s, "mean": _mean(xs), "n": len(xs), "ddof": ddof},
                   formula=formula, inputs=inputs, method="sample_std",
                   note="ddof=1 为样本标准差（无偏方差的平方根）。", n=len(xs), ddof=ddof)


def variance(values: Any, ddof: int = 1) -> dict[str, Any]:
    """方差；默认 ddof=1 即样本方差。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values), "ddof": ddof}
    formula = "s^2 = sum((x_i - mean)^2) / (n - ddof)"
    if not xs or len(xs) - ddof <= 0 or ddof < 0:
        return _unsupported("sample_variance", formula, inputs,
                            "样本量不足以按给定 ddof 计算方差。", n=len(xs), ddof=ddof)
    v = _var(xs, ddof)
    if v is None or v < 0:
        return _unsupported("sample_variance", formula, inputs, "方差计算遇到无效数值。", n=len(xs))
    return _result(supported=True, value=v,
                   values={"variance": v, "mean": _mean(xs), "n": len(xs), "ddof": ddof},
                   formula=formula, inputs=inputs, method="sample_variance",
                   note="ddof=1 为无偏样本方差。", n=len(xs), ddof=ddof)


def _samples_from(samples: Any) -> tuple[list[float], int]:
    """从 samples 的多种写法中抽取样本与 ddof。"""
    if isinstance(samples, dict):
        raw = samples.get("values", samples.get("sample", samples.get("samples", samples.get("data"))))
        ddof = samples.get("ddof", 1)
    else:
        raw, ddof = samples, 1
    try:
        ddof = int(ddof)
    except (TypeError, ValueError):
        ddof = 1
    return _clean(raw), ddof


# STAT-001 ~ 010

def verify_mean_std(claimed: dict | None, samples: dict | None, tolerance: float = 0.01) -> dict[str, Any]:
    """STAT-001：从原始样本重算 mean/std，与报告值按绝对容差核对。"""
    claimed = claimed if isinstance(claimed, dict) else {}
    xs, ddof = _samples_from(samples)
    inputs = {"claimed": _json_safe(claimed), "samples": _json_safe(samples), "tolerance": tolerance}
    formula = "mean = sum(x_i)/n; s = sqrt(sum((x_i-mean)^2)/(n-ddof)); |claimed-recomputed| <= tolerance"
    cmean, cstd = claimed.get("mean"), claimed.get("std", claimed.get("sd"))
    has_claim = cmean is not None or cstd is not None
    if not xs or not has_claim:
        return _unsupported("claim_vs_recompute", formula, inputs,
                            "缺少原始样本或报告值，均值与标准差核验未执行。",
                            tolerance=tolerance, consistent=None, mean_ok=None, std_ok=None)

    m = _mean(xs)
    s = _std(xs, ddof)
    try:
        tol = abs(float(tolerance))
    except (TypeError, ValueError):
        tol = 0.01
    mean_diff = abs(float(cmean) - m) if cmean is not None else None
    std_diff = abs(float(cstd) - s) if (cstd is not None and s is not None) else None
    mean_ok = mean_diff <= tol if mean_diff is not None else None
    std_ok = std_diff <= tol if std_diff is not None else None
    checked = [v for v in (mean_ok, std_ok) if v is not None]
    consistent = all(checked) if checked else None
    return _result(
        supported=True,
        value=consistent,
        values={
            "claimed_mean": float(cmean) if cmean is not None else None,
            "claimed_std": float(cstd) if cstd is not None else None,
            "recomputed_mean": m,
            "recomputed_std": s,
            "mean_diff": mean_diff,
            "std_diff": std_diff,
            "mean_ok": mean_ok,
            "std_ok": std_ok,
            "consistent": consistent,
            "tolerance": tol,
            "n": len(xs),
            "ddof": ddof,
        },
        formula=formula, inputs=inputs, method="claim_vs_recompute",
        note="按绝对容差逐项核对；未提供某一报告值则该项不参与判断。",
        tolerance=tol, consistent=consistent, mean_ok=mean_ok, std_ok=std_ok,
    )


def check_consistency(runs: list[dict] | list[float] | None, cv_threshold: float = 0.05) -> dict[str, Any]:
    """STAT-002：多次运行的均值离散系数；cv_threshold 为启发式阈值。"""
    runs = runs if isinstance(runs, (list, tuple)) else []
    inputs = {"runs": _json_safe(runs), "cv_threshold": cv_threshold}
    formula = "cv_runs = std(run_means, ddof=1) / |mean(run_means)|"
    summaries: list[dict[str, Any]] = []
    for idx, run in enumerate(runs):
        name = f"run_{idx + 1}"
        if isinstance(run, dict):
            name = str(run.get("name", run.get("run_id", name)))
            xs = _clean(run.get("values", run.get("data", run.get("scores"))))
            if xs:
                m, sd = _mean(xs), _std(xs, 1)
            else:
                m = float(run["mean"]) if run.get("mean") is not None else None
                sd = float(run["std"]) if run.get("std") is not None else None
        elif isinstance(run, (int, float)) and not isinstance(run, bool):
            m, sd = float(run), 0.0
        else:
            continue
        if m is None or not math.isfinite(m):
            continue
        cv = (sd / abs(m)) if (sd is not None and m != 0 and math.isfinite(sd)) else None
        summaries.append({"name": name, "mean": m, "std": sd, "cv": cv})
    if len(summaries) < 2:
        return _unsupported("run_consistency", formula, inputs,
                            "少于两次有效运行，离散程度无法评估。",
                            consistent=None, run_count=len(summaries))
    means = [s["mean"] for s in summaries]
    grand = _mean(means)
    sd_means = _std(means, 1)
    cv_means = (sd_means / abs(grand)) if (sd_means is not None and grand != 0) else None
    threshold = abs(float(cv_threshold)) if isinstance(cv_threshold, (int, float)) else 0.05
    consistent = (cv_means <= threshold) if cv_means is not None else None
    spread = max(means) - min(means)
    return _result(
        supported=True, value=cv_means,
        values={
            "run_summaries": summaries,
            "grand_mean": grand,
            "std_of_run_means": sd_means,
            "cv_of_run_means": cv_means,
            "mean_spread": spread,
            "threshold": threshold,
            "consistent": consistent,
            "run_count": len(summaries),
        },
        formula=formula, inputs=inputs, method="run_consistency",
        note="离散系数为启发式波动指标；一致性阈值需结合领域口径复核。",
        consistent=consistent, cv=cv_means, threshold=threshold,
    )


def analyze_seed_impact(seed_scores: dict[str, list[float]] | None, relative_threshold: float = 0.1) -> dict[str, Any]:
    """STAT-003：按随机种子分组比较均值极差与相对波动。"""
    seed_scores = seed_scores if isinstance(seed_scores, dict) else {}
    inputs = {"seed_scores": _json_safe(seed_scores), "relative_threshold": relative_threshold}
    formula = ("seed_mean = mean(scores_of_seed); spread = max(seed_means) - min(seed_means); "
               "relative_spread = spread / |mean(all_scores)|")
    per_seed: list[dict[str, Any]] = []
    all_values: list[float] = []
    for seed, raw in seed_scores.items():
        xs = _clean(raw)
        if not xs:
            continue
        m, sd = _mean(xs), _std(xs, 1)
        all_values.extend(xs)
        per_seed.append({"seed": str(seed), "n": len(xs), "mean": m, "std": sd})
    if len(per_seed) < 2:
        return _unsupported("seed_impact", formula, inputs,
                            "少于两个有效种子的分数记录，种子影响未评估。",
                            high_variability=None, seed_count=len(per_seed))
    seed_means = [s["mean"] for s in per_seed]
    overall = _mean(all_values)
    spread = max(seed_means) - min(seed_means)
    relative = (spread / abs(overall)) if overall != 0 else None
    between = _std(seed_means, 1)
    within_sq = [(s["std"] ** 2) for s in per_seed if s["std"] is not None]
    within = math.sqrt(_mean(within_sq)) if within_sq else None
    ratio = (between / within) if (between is not None and within and within > 0) else None
    threshold = abs(float(relative_threshold)) if isinstance(relative_threshold, (int, float)) else 0.1
    high = (relative is not None and relative > threshold) or (ratio is not None and ratio > 1.0)
    return _result(
        supported=True, value=spread,
        values={
            "per_seed": per_seed,
            "seed_count": len(per_seed),
            "seed_means": seed_means,
            "overall_mean": overall,
            "spread": spread,
            "relative_spread": relative,
            "between_seed_std": between,
            "within_seed_std": within,
            "variance_ratio": ratio,
            "threshold": threshold,
            "high_variability": high,
        },
        formula=formula, inputs=inputs, method="seed_impact",
        note="极差与方差比只描述种子间差异，不做因果解释；报告口径需人工复核。",
        spread=spread, relative_spread=relative, high_variability=high, threshold=threshold,
    )


def confidence_interval(values: Any, level: float = 0.95, method: str = "t") -> dict[str, Any]:
    """STAT-004：均值置信区间。method='t'（默认）用 df=n-1；'normal'/'z' 用正态近似。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values), "level": level, "method": method}
    formula = "CI = mean +/- critical * (s / sqrt(n)); t: df=n-1, normal: critical=z_(1-alpha/2)"
    mkey = str(method).lower()
    if mkey in ("normal", "z", "gaussian"):
        mkey = "normal"
    elif mkey in ("t", "student", "student_t", "auto"):
        mkey = "t" if mkey != "auto" or len(xs) < 100 else "normal"
    else:
        return _unsupported("confidence_interval", formula, inputs,
                            f"不支持的置信区间方法：{method}。")
    try:
        lv = float(level)
    except (TypeError, ValueError):
        lv = 0.95
    if not (0.0 < lv < 1.0):
        return _unsupported("confidence_interval", formula, inputs, "置信水平需位于 (0,1)。")
    if len(xs) < 2:
        return _unsupported("confidence_interval", formula, inputs,
                            "样本量小于 2，置信区间未计算。", n=len(xs))
    s = _std(xs, 1)
    if s is None:
        return _unsupported("confidence_interval", formula, inputs, "标准差计算无效。", n=len(xs))
    m = _mean(xs)
    se = s / math.sqrt(len(xs))
    alpha = 1.0 - lv
    df = len(xs) - 1 if mkey == "t" else None
    try:
        critical = _t_ppf(1.0 - alpha / 2.0, df) if mkey == "t" else _norm_ppf(1.0 - alpha / 2.0)
    except Exception:
        return _unsupported("confidence_interval", formula, inputs, "临界值求解失败。")
    if not math.isfinite(critical):
        return _unsupported("confidence_interval", formula, inputs, "临界值无效。")
    margin = critical * se
    lo, hi = m - margin, m + margin
    note = ("t 分布临界值基于 df=n-1；" if mkey == "t" else "采用正态近似临界值；")
    note += f"分布函数来源：{_distribution_backend()}；区间为双侧 {lv:.2f}。"
    return _result(
        supported=True, value=[lo, hi],
        values={
            "mean": m, "ci_low": lo, "ci_high": hi, "se": se, "df": df,
            "critical_value": critical, "level": lv, "alpha": alpha,
            "n": len(xs), "std": s, "margin": margin, "method": mkey,
        },
        formula=formula, inputs=inputs, method="confidence_interval_t" if mkey == "t" else "confidence_interval_normal",
        note=note, ci_low=lo, ci_high=hi, se=se, df=df, critical_value=critical,
    )


def effect_size(group_a: Any, group_b: Any, kind: str = "cohens_d", control: str = "b") -> dict[str, Any]:
    """STAT-005：Cohen's d / Hedges' g / Glass's delta 及经验阈值解读。"""
    a, b = _clean(group_a), _clean(group_b)
    inputs = {"group_a": _json_safe(group_a), "group_b": _json_safe(group_b),
              "kind": kind, "control": control}
    formula = ("d = (mean_a - mean_b) / s_pooled; s_pooled = sqrt(((na-1)sa^2+(nb-1)sb^2)/(na+nb-2)); "
               "Hedges g = d * (1 - 3/(4*(na+nb)-9)); Glass delta = (mean_a-mean_b)/s_control")
    k = str(kind).lower().replace("-", "_")
    aliases = {"cohen_d": "cohens_d", "d": "cohens_d", "hedges_g": "hedges_g", "g": "hedges_g",
               "glass_delta": "glass_delta", "glass": "glass_delta"}
    k = aliases.get(k, k)
    if k not in ("cohens_d", "hedges_g", "glass_delta"):
        return _unsupported("effect_size", formula, inputs, f"不支持的效应量类型：{kind}。")
    if len(a) < 2 or len(b) < 2:
        return _unsupported("effect_size", formula, inputs,
                            "两组样本量均需至少 2，效应量未计算。", effect=None)
    ma, mb = _mean(a), _mean(b)
    sa, sb = _std(a, 1), _std(b, 1)
    if sa is None or sb is None:
        return _unsupported("effect_size", formula, inputs, "组内标准差计算无效。")
    diff = ma - mb
    if k == "glass_delta":
        use_b = str(control).lower() not in ("a", "group_a", "first")
        ref = sb if use_b else sa
        if ref == 0:
            return _unsupported("effect_size", formula, inputs,
                                "对照组标准差为 0，Glass's delta 未计算（除零）。")
        effect = diff / ref
        extra = {"control_std": ref, "control": "b" if use_b else "a"}
    else:
        pooled = math.sqrt(((len(a) - 1) * sa ** 2 + (len(b) - 1) * sb ** 2) / (len(a) + len(b) - 2))
        if pooled == 0:
            return _unsupported("effect_size", formula, inputs,
                                "合并标准差为 0，效应量未计算（除零）。")
        d = diff / pooled
        if k == "hedges_g":
            correction = 1.0 - 3.0 / (4.0 * (len(a) + len(b)) - 9.0)
            effect = d * correction
        else:
            correction, effect = None, d
        extra = {"pooled_std": pooled, "cohens_d": d, "correction_factor": correction}
    magnitude = ("negligible" if abs(effect) < 0.2 else "small" if abs(effect) < 0.5
                 else "medium" if abs(effect) < 0.8 else "large")
    extra.update({
        "effect": effect, "magnitude": magnitude,
        "group_a_mean": ma, "group_b_mean": mb,
        "group_a_std": sa, "group_b_std": sb,
        "mean_difference": diff, "n_a": len(a), "n_b": len(b),
    })
    return _result(
        supported=True, value=effect, values=extra, formula=formula, inputs=inputs,
        method=k,
        note="阈值 |d|<0.2 negligible / <0.5 small / <0.8 medium / >=0.8 large 仅为经验性解读，不替代领域判断。",
        effect=effect, magnitude=magnitude,
    )


def hypothesis_test(
    group_a: Any,
    group_b: Any = None,
    kind: str = "welch",
    alpha: float = 0.05,
    paired: bool = False,
    mu0: float = 0.0,
) -> dict[str, Any]:
    """STAT-006：Welch / Student / 配对 / Mann-Whitney / 单样本检验。

    group_b 传数字时作为单样本检验的 mu0；样本量 < 3 记为证据不足。
    """
    a = _clean(group_a)
    b = _clean(group_b) if isinstance(group_b, (list, tuple)) else []
    k = str(kind).lower().replace("-", "_").replace(" ", "_")
    if paired and k not in ("paired", "paired_t", "t_paired"):
        k = "paired"
    aliases = {"welch_t": "welch", "t_test": "student", "student_t": "student", "t": "student",
               "paired_t": "paired", "t_paired": "paired", "mann_whitney_u": "mannwhitney",
               "mann_whitney": "mannwhitney", "mwu": "mannwhitney", "wilcoxon_rank_sum": "mannwhitney",
               "one_sample_t": "one_sample", "onesample": "one_sample", "one": "one_sample"}
    k = aliases.get(k, k)
    scalar_mu = group_b if isinstance(group_b, (int, float)) and not isinstance(group_b, bool) else mu0
    inputs = {"group_a": _json_safe(group_a), "group_b": _json_safe(group_b),
              "kind": kind, "alpha": alpha, "paired": bool(paired), "mu0": scalar_mu}
    formula = {
        "welch": "t=(mean_a-mean_b)/sqrt(sa^2/na+sb^2/nb); df=(sa^2/na+sb^2/nb)^2/((sa^2/na)^2/(na-1)+(sb^2/nb)^2/(nb-1))",
        "student": "t=(mean_a-mean_b)/(s_pooled*sqrt(1/na+1/nb)); df=na+nb-2",
        "paired": "t=mean(d)/(sd(d)/sqrt(n)), d=a_i-b_i; df=n-1",
        "mannwhitney": "U=sum(rank_a)-na(na+1)/2; z=(U-na*nb/2-0.5*sign)/sigma; p=2*(1-Phi(|z|))",
        "one_sample": "t=(mean_a-mu0)/(s_a/sqrt(n)); df=n-1",
    }.get(k, "")
    valid = ("welch", "student", "paired", "mannwhitney", "one_sample")
    if k not in valid:
        return _unsupported("hypothesis_test", formula or "unsupported kind", inputs,
                            f"不支持的检验类型：{kind}。", statistic=None, pvalue=None, df=None,
                            alpha=alpha, significant=None)
    try:
        aalpha = float(alpha)
    except (TypeError, ValueError):
        aalpha = 0.05
    if not (0.0 < aalpha < 1.0):
        return _unsupported("hypothesis_test", formula, inputs, "alpha 需位于 (0,1)。",
                            statistic=None, pvalue=None, df=None, alpha=alpha, significant=None)
    notes: list[str] = ["样本独立性未经自动核验。"]
    statistic: float | None = None
    pvalue: float | None = None
    df: float | None = None
    detail: dict[str, Any] = {"alpha": aalpha}

    if k == "one_sample":
        if len(a) < 3:
            return _unsupported("hypothesis_test", formula, inputs,
                                "样本量小于 3，单样本 t 检验未执行。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        ma, sa = _mean(a), _std(a, 1)
        se = sa / math.sqrt(len(a))
        if se == 0:
            return _unsupported("hypothesis_test", formula, inputs,
                                "样本标准差为 0，t 统计量未计算（除零）。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        statistic = (ma - float(scalar_mu)) / se
        df = len(a) - 1
        pvalue = _t_two_sided_p(statistic, df)
        detail.update({"mean": ma, "std": sa, "n": len(a), "mu0": float(scalar_mu), "se": se})
        notes.append("单样本 t 检验要求均值近似正态，该前提需人工确认。")
    elif k == "paired":
        if len(a) < 3 or len(b) < 3 or len(a) != len(b):
            return _unsupported("hypothesis_test", formula, inputs,
                                "配对样本需长度相同且至少 3 对，配对 t 检验未执行。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        d = [x - y for x, y in zip(a, b)]
        md, sd = _mean(d), _std(d, 1)
        se = sd / math.sqrt(len(d))
        if se == 0:
            return _unsupported("hypothesis_test", formula, inputs,
                                "差值标准差为 0，t 统计量未计算（除零）。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        statistic = md / se
        df = len(d) - 1
        pvalue = _t_two_sided_p(statistic, df)
        detail.update({"mean_difference": md, "std_difference": sd, "pairs": len(d), "se": se})
        notes.append("配对关系与差值近似正态的前提需人工确认。")
    else:
        if len(a) < 3 or len(b) < 3:
            return _unsupported("hypothesis_test", formula, inputs,
                                "两组样本量均需至少 3，检验未执行。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        ma, mb = _mean(a), _mean(b)
        sa, sb = _std(a, 1), _std(b, 1)
        if sa is None or sb is None:
            return _unsupported("hypothesis_test", formula, inputs, "组内标准差无效。",
                                statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
        va, vb = sa ** 2, sb ** 2
        ratio = (va / vb) if vb > 0 else None
        detail.update({"group_a_mean": ma, "group_b_mean": mb, "group_a_std": sa,
                       "group_b_std": sb, "n_a": len(a), "n_b": len(b),
                       "variance_ratio": ratio, "mean_difference": ma - mb})
        if k == "welch":
            term_a, term_b = va / len(a), vb / len(b)
            denom = math.sqrt(term_a + term_b)
            if denom == 0:
                return _unsupported("hypothesis_test", formula, inputs,
                                    "合并标准误为 0，Welch 统计量未计算（除零）。",
                                    statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
            statistic = (ma - mb) / denom
            df_den = (term_a ** 2) / (len(a) - 1) + (term_b ** 2) / (len(b) - 1)
            df = ((term_a + term_b) ** 2 / df_den) if df_den > 0 else None
            pvalue = _t_two_sided_p(statistic, df) if df else None
            notes.append("Welch 检验不假设两组方差相等；" +
                         (f"方差比={ratio:.4f}。" if ratio is not None else "方差比不可用。"))
        elif k == "student":
            pooled = math.sqrt(((len(a) - 1) * va + (len(b) - 1) * vb) / (len(a) + len(b) - 2))
            se = pooled * math.sqrt(1.0 / len(a) + 1.0 / len(b))
            if se == 0:
                return _unsupported("hypothesis_test", formula, inputs,
                                    "合并标准误为 0，t 统计量未计算（除零）。",
                                    statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
            statistic = (ma - mb) / se
            df = len(a) + len(b) - 2
            pvalue = _t_two_sided_p(statistic, df)
            notes.append("Student t 检验使用合并方差，含等方差假设；" +
                         (f"方差比={ratio:.4f}；方差比明显偏离 1 时可考虑 Welch 检验。"
                          if ratio is not None else "方差比不可用。"))
        else:  # mannwhitney
            combined = [(v, 0) for v in a] + [(v, 1) for v in b]
            combined.sort(key=lambda item: item[0])
            ranks = [0.0] * len(combined)
            i = 0
            tie_sum = 0.0
            while i < len(combined):
                j = i
                while j + 1 < len(combined) and combined[j + 1][0] == combined[i][0]:
                    j += 1
                avg_rank = (i + 1 + j + 1) / 2.0
                for pos in range(i, j + 1):
                    ranks[pos] = avg_rank
                tie_count = j - i + 1
                tie_sum += tie_count ** 3 - tie_count
                i = j + 1
            rank_a = sum(r for r, (_, grp) in zip(ranks, combined) if grp == 0)
            u = rank_a - len(a) * (len(a) + 1) / 2.0
            n_tot = len(a) + len(b)
            mu = len(a) * len(b) / 2.0
            var_u = (len(a) * len(b) / 12.0
                     * ((n_tot + 1.0) - tie_sum / (n_tot * (n_tot - 1.0))))
            if var_u <= 0:
                return _unsupported("hypothesis_test", formula, inputs,
                                    "U 统计量方差为 0，正态近似未计算。",
                                    statistic=None, pvalue=None, df=None, alpha=aalpha, significant=None)
            z = (abs(u - mu) - 0.5) / math.sqrt(var_u)
            z = max(0.0, z)
            statistic = u
            df = None
            pvalue = 2.0 * (1.0 - _norm_cdf(z))
            detail.update({"U": u, "z": z, "tie_correction": tie_sum})
            notes.append("Mann-Whitney U 采用正态近似（样本量需足够大）并做并列值连续性校正；"
                         "该检验针对分布位置，不直接针对均值差，前提需人工确认。")
    if statistic is None or pvalue is None or not math.isfinite(statistic) or not math.isfinite(pvalue):
        return _unsupported("hypothesis_test", formula, inputs, "统计量或 p 值无效。",
                            statistic=None, pvalue=None, df=df, alpha=aalpha, significant=None)
    pvalue = min(max(pvalue, 0.0), 1.0)
    significant = pvalue < aalpha
    detail.update({"statistic": statistic, "pvalue": pvalue, "df": df,
                   "alpha": aalpha, "significant": significant})
    note = " ".join(notes) + f" 分布函数来源：{_distribution_backend()}。"
    return _result(
        supported=True, value=statistic, values=detail, formula=formula, inputs=inputs,
        method={"welch": "welch_t", "student": "student_t", "paired": "paired_t",
                "mannwhitney": "mann_whitney_u_normal_approx", "one_sample": "one_sample_t"}[k],
        note=note, statistic=statistic, pvalue=pvalue, df=df, alpha=aalpha,
        significant=significant,
    )


def multiple_comparison(pvalues: Any, method: str = "holm", alpha: float = 0.05) -> dict[str, Any]:
    """STAT-007：bonferroni / holm / bh(BH-FDR) / by 校正。"""
    ps = _clean(pvalues)
    mkey = str(method).lower().replace("-", "").replace("_", "")
    inputs = {"pvalues": _json_safe(pvalues), "method": method, "alpha": alpha}
    formula = ("bonferroni: min(1,m*p); holm: max_{j<=i}((m-j+1)*p_j); "
               "BH: min_{j>=i}(m/j*p_j); BY: H_m * BH_adj, H_m=sum(1/i)")
    aliases = {"bh": "bh", "fdr_bh": "bh", "benjamini_hochberg": "bh",
               "by": "by", "fdr_by": "by", "benjamini_yekutieli": "by",
               "holm": "holm", "holmbonferroni": "holm", "bonferroni": "bonferroni"}
    mkey = aliases.get(mkey, mkey)
    if not ps:
        return _unsupported("multiple_comparison", formula, inputs,
                            "没有可用 p 值，多重比较校正未执行。",
                            adjusted_pvalues=[], rejected=[], method_name=mkey)
    if any(p < 0.0 or p > 1.0 for p in ps):
        return _unsupported("multiple_comparison", formula, inputs,
                            "p 值需位于 [0,1]，校正未执行。",
                            adjusted_pvalues=[], rejected=[], method_name=mkey)
    if mkey not in ("bonferroni", "holm", "bh", "by"):
        return _unsupported("multiple_comparison", formula, inputs,
                            f"不支持的校正方法：{method}。",
                            adjusted_pvalues=[], rejected=[], method_name=mkey)
    try:
        aalpha = float(alpha)
    except (TypeError, ValueError):
        aalpha = 0.05
    m = len(ps)
    order = sorted(range(m), key=lambda i: ps[i])
    sorted_p = [ps[i] for i in order]
    if mkey == "bonferroni":
        adj_sorted = [min(1.0, m * p) for p in sorted_p]
    elif mkey == "holm":
        adj_sorted, running = [], 0.0
        for j, p in enumerate(sorted_p):
            running = max(running, (m - j) * p)
            adj_sorted.append(min(1.0, running))
    else:
        adj_sorted = [0.0] * m
        running = 1.0
        for j in range(m - 1, -1, -1):
            running = min(running, (m / (j + 1.0)) * sorted_p[j])
            adj_sorted[j] = min(1.0, running)
        if mkey == "by":
            h_m = sum(1.0 / i for i in range(1, m + 1))
            adj_sorted = [min(1.0, h_m * v) for v in adj_sorted]
    adjusted = [0.0] * m
    for idx, orig in enumerate(order):
        adjusted[orig] = adj_sorted[idx]
    rejected = [p <= aalpha for p in adjusted]
    note = ("BH 采用从最大 p 值开始的单调性修正；BY 在 BH 基础上乘 H_m；"
            "Holm 采用逐步向下取最大值。" if mkey in ("bh", "by") else
            "Bonferroni 为单步校正；Holm 采用逐步向下取最大值。")
    return _result(
        supported=True, value=adjusted,
        values={
            "adjusted_pvalues": adjusted, "rejected": rejected,
            "rejected_count": sum(rejected), "method": mkey, "alpha": aalpha,
            "comparison_count": m,
        },
        formula=formula, inputs=inputs, method=mkey, note=note,
        adjusted_pvalues=adjusted, rejected=rejected, method_name=mkey,
        rejected_count=sum(rejected),
    )


def power_analysis(
    effect_size: float | None = None,
    n: float | None = None,
    alpha: float = 0.05,
    power: float | None = None,
    kind: str = "two_sample",
) -> dict[str, Any]:
    """STAT-008：给定效应量与 n 算 power；给定效应量与 power 反解 n；并给出 MDE。

    公开数值统一使用正态近似（scipy 可用时用其正态分位数），两条路径一致；
    scipy 可用时另附非中心 t 的参考功效，不作为公开 value。
    """
    k = str(kind).lower().replace("-", "_").replace(" ", "_")
    if k not in ("two_sample", "two_sample_t", "independent", "one_sample", "one_sample_t"):
        k = "two_sample"
    inputs = {"effect_size": effect_size, "n": n, "alpha": alpha, "power": power, "kind": kind}
    formula = ("delta = d*sqrt(n/2) (two_sample) 或 d*sqrt(n) (one_sample); "
               "power ~ Phi(delta - z_(1-alpha/2)); n_needed = 2*((z_(1-alpha/2)+z_power)/d)^2")
    try:
        aalpha = float(alpha)
    except (TypeError, ValueError):
        aalpha = 0.05
    if not (0.0 < aalpha < 1.0):
        return _unsupported("power_analysis", formula, inputs, "alpha 需位于 (0,1)。",
                            power=None, n=None, mde=None)
    try:
        d = abs(float(effect_size)) if effect_size is not None else None
    except (TypeError, ValueError):
        d = None
    try:
        nn = float(n) if n is not None else None
    except (TypeError, ValueError):
        nn = None
    try:
        target = float(power) if power is not None else None
    except (TypeError, ValueError):
        target = None
    if d is None or d <= 0:
        return _unsupported("power_analysis", formula, inputs,
                            "缺少有效的效应量，功效分析未执行。", power=None, n=None, mde=None)
    factor = (math.sqrt(nn / 2.0) if k.startswith("two") else math.sqrt(nn)) if nn is not None else None
    zcrit = _norm_ppf(1.0 - aalpha / 2.0)

    def _power_at(n_val: float) -> float:
        delta = d * (math.sqrt(n_val / 2.0) if k.startswith("two") else math.sqrt(n_val))
        return min(1.0, max(0.0, _norm_cdf(delta - zcrit) + _norm_cdf(-delta - zcrit)))

    if nn is not None and nn >= 2:
        computed_power = _power_at(nn)
        effective_n = int(math.ceil(nn)) if nn == int(nn) else nn
        mde = ((zcrit + (zcrit if target is None else _norm_ppf(target))) / factor
               if factor > 0 else None) if target is not None else ((zcrit + zcrit) / factor if factor > 0 else None)
        note = "公开 power 采用正态近似；" + f"分布函数来源：{_distribution_backend()}。"
        ref: float | None = None
        if _sp_stats is not None and d > 0:  # 仅作参考，不参与公开 value
            try:
                nc = d * factor
                df = 2 * nn - 2 if k.startswith("two") else nn - 1
                tcrit = _t_ppf(1.0 - aalpha / 2.0, df)
                ref = float(_sp_stats.nct.sf(tcrit, df, nc) + _sp_stats.nct.cdf(-tcrit, df, nc))
                note += " scipy 可用时另给非中心 t 参考功效 power_scipy_nct。"
            except Exception:  # pragma: no cover
                ref = None
        return _result(
            supported=True, value=computed_power,
            values={
                "power": computed_power, "n": effective_n, "alpha": aalpha,
                "mde": mde, "effect_size": d, "z_critical": zcrit,
                "noncentrality": d * factor, "kind": k,
                "power_scipy_nct": ref,
            },
            formula=formula, inputs=inputs, method="power_normal_approximation",
            note=note, power=computed_power, n=effective_n, mde=mde, alpha=aalpha,
        )
    if target is not None and 0.0 < target < 1.0 and nn is None:
        z_power = _norm_ppf(target)
        raw_n = 2.0 * ((zcrit + z_power) / d) ** 2 if k.startswith("two") else ((zcrit + z_power) / d) ** 2
        needed = max(2, int(math.ceil(raw_n)))
        achieved = _power_at(needed)
        mde = (zcrit + z_power) / (math.sqrt(needed / 2.0) if k.startswith("two") else math.sqrt(needed))
        return _result(
            supported=True, value=needed,
            values={
                "power": achieved, "n": needed, "alpha": aalpha, "mde": mde,
                "effect_size": d, "target_power": target, "kind": k,
            },
            formula=formula, inputs=inputs, method="power_sample_size_normal_approximation",
            note="每组样本量按正态近似反解并向上取整；正态近似在样本量较小时为粗略估计。",
            power=achieved, n=needed, mde=mde, alpha=aalpha,
        )
    return _unsupported("power_analysis", formula, inputs,
                        "缺少 n 或有效目标 power，功效分析未执行。",
                        power=None, n=None, mde=None)


def detect_outliers(values: Any, method: str = "iqr", threshold: float = 1.5) -> dict[str, Any]:
    """STAT-009：IQR 或修正 Z 分数（MAD）识别离群点；不自动删除数据。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values), "method": method, "threshold": threshold}
    formula = ("IQR: bounds = [Q1-k*IQR, Q3+k*IQR]; "
               "modified_z = 0.6745*(x-median)/MAD, |modified_z|>threshold")
    mkey = str(method).lower().replace("-", "_")
    if mkey in ("iqr", "tukey", "boxplot"):
        mkey = "iqr"
    elif mkey in ("modified_z", "modified_z_score", "mad", "median_absolute_deviation"):
        mkey = "modified_z"
    else:
        return _unsupported("outlier_detection", formula, inputs, f"不支持的异常识别方法：{method}。",
                            outlier_indices=[], outlier_values=[], needs_human_review=True)
    if len(xs) < 3:
        return _unsupported("outlier_detection", formula, inputs,
                            "少于 3 个观测值，异常识别未执行。",
                            outlier_indices=[], outlier_values=[], needs_human_review=True)
    try:
        k = abs(float(threshold))
    except (TypeError, ValueError):
        k = 1.5
    if mkey == "iqr":
        q1, q3 = _quantile(xs, 0.25), _quantile(xs, 0.75)
        iqr = q3 - q1
        low, high = q1 - k * iqr, q3 + k * iqr
        indices = [i for i, x in enumerate(xs) if x < low or x > high]
        detail = {"q1": q1, "q3": q3, "iqr": iqr, "threshold": k}
        bounds = {"lower": low, "upper": high}
        note = f"IQR({k}) 界限为 [{low}, {high}]；修正 Z 分数可使用 method='modified_z'（阈值建议 3.5）。"
    else:
        med = _quantile(xs, 0.5)
        mad = _quantile([abs(x - med) for x in xs], 0.5)
        if mad == 0:
            return _unsupported("outlier_detection", formula, inputs,
                                "MAD 为 0，修正 Z 分数未计算（除零）。",
                                outlier_indices=[], outlier_values=[], needs_human_review=True)
        scores = [0.6745 * (x - med) / mad for x in xs]
        indices = [i for i, z in enumerate(scores) if abs(z) > k]
        detail = {"median": med, "mad": mad, "threshold": k, "modified_z_scores": scores}
        bounds = {"lower": med - k * mad / 0.6745, "upper": med + k * mad / 0.6745}
        note = f"修正 Z 分数阈值为 {k}；建议值 3.5。"
    outliers = [xs[i] for i in indices]
    return _result(
        supported=True, value=outliers,
        values={
            "outlier_indices": indices, "outlier_values": outliers,
            "bounds": bounds, "outlier_count": len(indices), **detail,
        },
        formula=formula, inputs=inputs, method=mkey,
        note=note + " 仅标记候选离群点，不自动删除任何数据；需人工复核。",
        outlier_indices=indices, outlier_values=outliers, bounds=bounds,
        needs_human_review=bool(indices),
    )


def distribution_data(values: Any, bins: int = 10) -> dict[str, Any]:
    """STAT-010：直方图 counts/bin_edges、四分位数、偏度峰度与极值。"""
    xs = _clean(values)
    inputs = {"values": _json_safe(values), "bins": bins}
    formula = ("counts_i = #{x | edge_i <= x < edge_(i+1)}（最右端闭）; "
               "quartiles: 线性插值; skewness: G1=g1*sqrt(n(n-1))/(n-2); "
               "excess kurtosis: G2 = ((n+1)*g2+6)*(n-1)/((n-2)(n-3))")
    if not xs:
        return _unsupported("distribution_data", formula, inputs, "没有可用样本，分布数据未生成。",
                            counts=[], bin_edges=[])
    try:
        nb = int(bins)
    except (TypeError, ValueError):
        nb = 10
    if nb <= 0:
        return _unsupported("distribution_data", formula, inputs, "分箱数需为正整数。",
                            counts=[], bin_edges=[])
    lo, hi = min(xs), max(xs)
    if lo == hi:
        edges = [lo - 0.5, hi + 0.5]
        counts = [len(xs)]
    else:
        width = (hi - lo) / nb
        edges = [lo + width * i for i in range(nb + 1)]
        edges[-1] = hi
        counts = [0] * nb
        for x in xs:
            idx = int((x - lo) / width)
            idx = min(max(idx, 0), nb - 1)
            counts[idx] += 1
    q1, q2, q3 = _quantile(xs, 0.25), _quantile(xs, 0.5), _quantile(xs, 0.75)
    m = _mean(xs)
    var_pop = sum((x - m) ** 2 for x in xs) / len(xs)
    sd = _std(xs, 1)
    skew = kurtosis = None
    if len(xs) >= 3 and var_pop > 0:
        m2 = var_pop
        m3 = sum((x - m) ** 3 for x in xs) / len(xs)
        g1 = m3 / (m2 ** 1.5)
        skew = g1 * math.sqrt(len(xs) * (len(xs) - 1)) / (len(xs) - 2)
        if len(xs) >= 4:
            m4 = sum((x - m) ** 4 for x in xs) / len(xs)
            g2 = m4 / (m2 ** 2) - 3.0
            kurtosis = ((len(xs) + 1) * g2 + 6.0) * (len(xs) - 1) / ((len(xs) - 2) * (len(xs) - 3))
    note = "偏度与峰度为样本调整口径；n<3 时偏度、n<4 时峰度不输出。"
    return _result(
        supported=True, value=counts,
        values={
            "counts": counts, "bin_edges": edges, "bins": len(counts),
            "quartiles": {"q1": q1, "q2": q2, "q3": q3, "iqr": q3 - q1},
            "min": lo, "max": hi, "mean": m, "std": sd,
            "skewness": skew, "kurtosis": kurtosis, "n": len(xs),
        },
        formula=formula, inputs=inputs, method="distribution_data", note=note,
        counts=counts, bin_edges=edges, skewness=skew, kurtosis=kurtosis,
    )


# audit 汇总

_CATEGORY = "experiment_statistics"


def _finding(
    rule_id: str,
    verdict: Verdict,
    message: str,
    evidence: list[dict[str, Any]] | None = None,
    justification: str = "",
    suggestion: str = "",
    confidence: str = "medium",
    affects: str = "all",
) -> dict[str, Any]:
    """构造严格遵循统一返回契约的 FindingDict（只含指定 10 个字段）。"""
    rule = get_rule(rule_id)
    return {
        "rule_id": rule_id,
        "rule_name": rule.name if rule else rule_id,
        "verdict": verdict.value,
        "category": _CATEGORY,
        "message": message,
        "evidence": evidence or [],
        "justification": justification,
        "suggestion": suggestion,
        "confidence": confidence,
        "affects": affects,
    }


def _ev(
    *,
    source: str = "input",
    claimed: dict[str, Any] | None = None,
    recomputed: dict[str, Any] | None = None,
    formula: str = "",
    inputs: dict[str, Any] | None = None,
    method: str = "",
    note: str = "",
) -> dict[str, Any]:
    """用 schema.Evidence 生成证据 dict，字段集合受 schema 约束。"""
    return Evidence(
        source=source,
        claimed=claimed or {},
        recomputed=recomputed or {},
        formula=formula,
        inputs=inputs or {},
        method=method,
        note=note,
    ).to_dict()


def _confidence_for(verdict: Verdict) -> str:
    if verdict in (Verdict.VERIFIED, Verdict.CALCULATION_ERROR):
        return "high"
    if verdict in (Verdict.NEEDS_HUMAN_REVIEW, Verdict.POTENTIAL_BIAS):
        return "medium"
    return "low"


def _fmt(x: Any) -> str:
    if x is None:
        return "不可用"
    if isinstance(x, bool):
        return "是" if x else "否"
    if isinstance(x, float):
        return f"{x:.6g}"
    return str(x)


def _raw_values(container: Any) -> Any:
    """payload 中的样本字段既可为 list，也可为 {'values': [...]}。"""
    if isinstance(container, dict):
        return container.get("values", container.get("sample",
                             container.get("samples", container.get("data"))))
    return container


def audit(payload: dict | None = None) -> dict[str, Any]:
    """对 payload 执行 STAT-001 ~ STAT-010 审计并汇总。

    payload 结构见模块 docstring；任何字段缺失时对应规则产出
    verdict=insufficient_evidence 的 finding，不编造数值。
    """
    p = payload if isinstance(payload, dict) else {}
    findings: list[dict[str, Any]] = []
    computations: dict[str, Any] = {}
    notes: list[str] = []

    def put(rule_id: str, result: dict[str, Any], finding: dict[str, Any]) -> None:
        computations[rule_id] = result
        findings.append(finding)

    # STAT-001 均值与标准差核验
    claims = p.get("claims") if isinstance(p.get("claims"), dict) else {}
    r1 = verify_mean_std(claims, p.get("samples"), float(p.get("tolerance", 0.01) or 0.01))
    ev1 = [_ev(source="paper+input", claimed=claims,
               recomputed={k: r1["values"].get(k) for k in ("recomputed_mean", "recomputed_std")},
               formula=r1["formula"], inputs=r1["inputs"], method=r1["method"], note=r1["note"])]
    if not r1["supported"]:
        f1 = _finding("STAT-001", Verdict.INSUFFICIENT_EVIDENCE,
                      "未提供可重算的样本或报告值，均值与标准差的核验未执行。", ev1,
                      "核验至少需要一组样本与一项报告值。",
                      "补充原始样本及论文报告的均值/标准差后重跑。",
                      affects="unknown")
        notes.append("STAT-001 缺少样本或报告值，未生成重算数值。")
    elif r1["values"].get("consistent") is True:
        f1 = _finding("STAT-001", Verdict.VERIFIED,
                      f"按样本重算的均值与标准差与报告值一致，容差为 {_fmt(r1['values'].get('tolerance'))}。",
                      ev1, "逐项绝对偏差均不超过容差。", "保留原始样本以便复核。")
    else:
        f1 = _finding("STAT-001", Verdict.CALCULATION_ERROR,
                      f"重算值与报告值存在超出容差的差异：均值差 {_fmt(r1['values'].get('mean_diff'))}，"
                      f"标准差差 {_fmt(r1['values'].get('std_diff'))}。",
                      ev1, "绝对偏差超过给定容差。", "核对报告口径（样本标准差 ddof=1）与原始样本。")
    put("STAT-001", r1, f1)

    # STAT-002 多次运行一致性
    runs = p.get("runs")
    r2 = check_consistency(runs, p.get("cv_threshold", 0.05))
    ev2 = [_ev(recomputed={k: r2["values"].get(k) for k in
                           ("grand_mean", "std_of_run_means", "cv_of_run_means", "mean_spread")},
               formula=r2["formula"], inputs=r2["inputs"], method=r2["method"], note=r2["note"])]
    if not r2["supported"]:
        f2 = _finding("STAT-002", Verdict.INSUFFICIENT_EVIDENCE,
                      "多次运行记录不足两条，运行间离散程度无法评估。", ev2,
                      "至少需要两次带均值或原始值的运行记录。", "补充各次运行的原始结果或均值/标准差。",
                      affects="unknown")
        notes.append("STAT-002 缺少多次运行记录。")
    elif r2["values"].get("consistent") is True:
        f2 = _finding("STAT-002", Verdict.VERIFIED,
                      f"各次运行均值的离散系数为 {_fmt(r2['values'].get('cv_of_run_means'))}，"
                      f"未超过阈值 {_fmt(r2['values'].get('threshold'))}。", ev2,
                      "离散系数为启发式波动指标。", "结合领域口径复核一致性阈值。")
    else:
        f2 = _finding("STAT-002", Verdict.NEEDS_HUMAN_REVIEW,
                      f"各次运行均值的离散系数为 {_fmt(r2['values'].get('cv_of_run_means'))}，"
                      f"超过阈值 {_fmt(r2['values'].get('threshold'))}。", ev2,
                      "离散系数高于启发式阈值。", "复核运行条件差异与记录完整性。")
    put("STAT-002", r2, f2)

    # STAT-003 随机种子影响
    seeds = p.get("seed_scores")
    r3 = analyze_seed_impact(seeds, p.get("relative_threshold", 0.1))
    ev3 = [_ev(recomputed={k: r3["values"].get(k) for k in
                           ("seed_count", "spread", "relative_spread", "variance_ratio")},
               formula=r3["formula"], inputs=r3["inputs"], method=r3["method"], note=r3["note"])]
    if not r3["supported"]:
        f3 = _finding("STAT-003", Verdict.INSUFFICIENT_EVIDENCE,
                      "少于两个有效种子的分数记录，随机种子影响未评估。", ev3,
                      "至少需要两个种子且各种子有可用分数。", "补充各种子下的完整分数列表。",
                      affects="unknown")
        notes.append("STAT-003 缺少按种子分组的分数。")
    elif r3["values"].get("high_variability"):
        f3 = _finding("STAT-003", Verdict.POTENTIAL_BIAS,
                      f"种子间均值极差为 {_fmt(r3['values'].get('spread'))}，"
                      f"相对波动为 {_fmt(r3['values'].get('relative_spread'))}；报告口径需人工复核。",
                      ev3, "种子间波动高于启发式阈值。", "核对是否披露全部种子及选取口径。")
    else:
        f3 = _finding("STAT-003", Verdict.VERIFIED,
                      f"种子间均值极差为 {_fmt(r3['values'].get('spread'))}，"
                      f"相对波动为 {_fmt(r3['values'].get('relative_spread'))}。", ev3,
                      "种子间波动未超过启发式阈值。", "保留各种子的完整记录。")
    put("STAT-003", r3, f3)

    # 基础样本统计（供后续规则复用，也写入 computations）
    sample_values = _raw_values(p.get("samples"))
    samples_result = std(sample_values, 1) if sample_values is not None else _unsupported(
        "sample_std", "s = sqrt(sum((x_i-mean)^2)/(n-1))", {}, "未提供样本。")
    computations["mean"] = mean(sample_values)
    computations["std"] = samples_result
    computations["variance"] = variance(sample_values, 1)

    # STAT-004 置信区间
    ci_source = _raw_values(p.get("ci_values", p.get("samples")))
    r4 = confidence_interval(ci_source, p.get("ci_level", 0.95), p.get("ci_method", "t"))
    ev4 = [_ev(recomputed={k: r4["values"].get(k) for k in
                           ("mean", "ci_low", "ci_high", "se", "df", "critical_value")},
               formula=r4["formula"], inputs=r4["inputs"], method=r4["method"], note=r4["note"])]
    if not r4["supported"]:
        f4 = _finding("STAT-004", Verdict.INSUFFICIENT_EVIDENCE,
                      "样本量不足或参数无效，置信区间未计算。", ev4,
                      "至少需要两个有限观测值且置信水平在 (0,1)。", "提供原始样本后重算区间。",
                      affects="unknown")
        notes.append("STAT-004 缺少有效样本，置信区间未计算。")
    else:
        f4 = _finding("STAT-004", Verdict.VERIFIED,
                      f"在 {_fmt(r4['values'].get('level'))} 置信水平下，"
                      f"均值的区间为 [{_fmt(r4['values'].get('ci_low'))}, {_fmt(r4['values'].get('ci_high'))}]，"
                      f"标准误为 {_fmt(r4['values'].get('se'))}。", ev4,
                      "按公开公式重算并给出临界值与自由度。", "复核方法选择与样本独立性前提。")
    put("STAT-004", r4, f4)

    # STAT-005 效应量
    r5 = effect_size(p.get("group_a"), p.get("group_b"), p.get("effect_kind", "cohens_d"))
    ev5 = [_ev(recomputed={k: r5["values"].get(k) for k in
                           ("effect", "magnitude", "group_a_mean", "group_b_mean", "pooled_std")},
               formula=r5["formula"], inputs=r5["inputs"], method=r5["method"], note=r5["note"])]
    if not r5["supported"]:
        f5 = _finding("STAT-005", Verdict.INSUFFICIENT_EVIDENCE,
                      "两组样本不足或标准差为 0，效应量未计算。", ev5,
                      "两组各需至少两个有限观测值且分母非 0。", "补充两组原始样本后重算。",
                      affects="unknown")
        notes.append("STAT-005 缺少两组样本，效应量未计算。")
    else:
        f5 = _finding("STAT-005", Verdict.VERIFIED,
                      f"{_fmt(r5['values'].get('method')) if 'method' in r5['values'] else r5['method']}"
                      f" 的效应量为 {_fmt(r5['values'].get('effect'))}，"
                      f"经验阈值解读为 {_fmt(r5['values'].get('magnitude'))}；该阈值仅为经验性解读。",
                      ev5, "按合并标准差口径重算。", "结合领域实际意义阈值复核。")
    put("STAT-005", r5, f5)

    # STAT-006 假设检验
    r6 = hypothesis_test(p.get("group_a"), p.get("group_b"), p.get("test_kind", "welch"),
                         p.get("alpha", 0.05), bool(p.get("paired", False)), p.get("mu0", 0.0))
    ev6 = [_ev(recomputed={k: r6["values"].get(k) for k in
                           ("statistic", "pvalue", "df", "alpha", "significant", "variance_ratio")},
               formula=r6["formula"], inputs=r6["inputs"], method=r6["method"], note=r6["note"])]
    if not r6["supported"]:
        f6 = _finding("STAT-006", Verdict.INSUFFICIENT_EVIDENCE,
                      "样本量不足或参数无效，假设检验未执行。", ev6,
                      "两组检验各需至少 3 个观测值。", "补充样本或改用合适的检验口径。",
                      affects="unknown")
        notes.append("STAT-006 样本或参数不足，检验未执行。")
    else:
        sig = bool(r6["values"].get("significant"))
        premise_risk = (r6["method"] == "student_t"
                        and r6["values"].get("variance_ratio") is not None
                        and (r6["values"]["variance_ratio"] > 4 or r6["values"]["variance_ratio"] < 0.25))
        verdict6 = (Verdict.METHOD_INAPPLICABLE if premise_risk else Verdict.VERIFIED)
        conclusion = "拒绝原假设" if sig else "未拒绝原假设"
        f6 = _finding(
            "STAT-006", verdict6,
            f"{r6['method']} 的统计量为 {_fmt(r6['values'].get('statistic'))}，"
            f"p 值为 {_fmt(r6['values'].get('pvalue'))}；在 alpha={_fmt(r6['values'].get('alpha'))} 下{conclusion}。",
            ev6,
            "方差比偏离 1 较明显，合并方差口径前提存疑。" if premise_risk else "按所选检验口径重算。",
            "复核前提后选用 Welch 检验。" if premise_risk else "样本独立性与分布前提需人工确认。",
        )
    put("STAT-006", r6, f6)

    # STAT-007 多重比较
    r7 = multiple_comparison(p.get("pvalues"), p.get("multiple_method", "holm"), p.get("alpha", 0.05))
    ev7 = [_ev(recomputed={k: r7["values"].get(k) for k in
                           ("adjusted_pvalues", "rejected", "rejected_count", "method")},
               formula=r7["formula"], inputs=r7["inputs"], method=r7["method"], note=r7["note"])]
    if not r7["supported"]:
        f7 = _finding("STAT-007", Verdict.INSUFFICIENT_EVIDENCE,
                      "缺少可用 p 值，多重比较校正未执行。", ev7,
                      "至少需要一项位于 [0,1] 的 p 值。", "提供各比较的原始 p 值后重算。",
                      affects="unknown")
        notes.append("STAT-007 缺少 p 值，校正未执行。")
    else:
        raw_sig = sum(1 for v in _clean(p.get("pvalues")) if v < float(p.get("alpha", 0.05) or 0.05))
        adj_sig = int(r7["values"].get("rejected_count", 0))
        count = int(r7["values"].get("comparison_count", 0))
        corrected = bool(p.get("multiple_comparison_corrected", False))
        verdict7 = Verdict.POTENTIAL_BIAS if (count > 1 and (raw_sig > adj_sig or not corrected)) else Verdict.VERIFIED
        f7 = _finding("STAT-007", verdict7,
                      f"共 {count} 项比较，{r7['method']} 校正后有 {adj_sig} 项保持显著，"
                      f"未校正的显著项数为 {raw_sig}。", ev7,
                      "多重比较会增加至少一项犯第一类错误的概率，校正结果供核对。",
                      "核对是否披露并应用多重比较校正。")
    put("STAT-007", r7, f7)

    # STAT-008 功效分析
    r8 = power_analysis(p.get("effect_size"), p.get("n"), p.get("alpha", 0.05),
                        p.get("power"), p.get("power_kind", "two_sample"))
    ev8 = [_ev(recomputed={k: r8["values"].get(k) for k in ("power", "n", "alpha", "mde")},
               formula=r8["formula"], inputs=r8["inputs"], method=r8["method"], note=r8["note"])]
    if not r8["supported"]:
        f8 = _finding("STAT-008", Verdict.INSUFFICIENT_EVIDENCE,
                      "缺少效应量或样本量信息，功效未计算。", ev8,
                      "需要效应量与每组样本量，或效应量与目标功效。", "补充效应量与样本量后重算。",
                      affects="unknown")
        notes.append("STAT-008 缺少效应量/样本量，功效未计算。")
    elif r8["values"].get("power") is not None and r8["values"]["power"] < 0.8:
        f8 = _finding("STAT-008", Verdict.INSUFFICIENT_EVIDENCE,
                      f"正态近似功效为 {_fmt(r8['values'].get('power'))}，"
                      f"每组样本量为 {_fmt(r8['values'].get('n'))}，MDE 为 {_fmt(r8['values'].get('mde'))}。",
                      ev8, "功效低于 0.8 这一常用参考线。", "结合领域要求复核样本量是否充分。",
                      affects="unknown")
    else:
        f8 = _finding("STAT-008", Verdict.VERIFIED,
                      f"正态近似功效为 {_fmt(r8['values'].get('power'))}，"
                      f"每组样本量为 {_fmt(r8['values'].get('n'))}，MDE 为 {_fmt(r8['values'].get('mde'))}。",
                      ev8, "功效达到常用参考线。", "正态近似在小样本下为粗略估计，需复核。")
    put("STAT-008", r8, f8)

    # STAT-009 异常识别
    outlier_values = _raw_values(p.get("outlier_values", p.get("samples")))
    r9 = detect_outliers(outlier_values, p.get("outlier_method", "iqr"),
                         p.get("outlier_threshold", 1.5))
    ev9 = [_ev(recomputed={k: r9["values"].get(k) for k in
                           ("outlier_indices", "outlier_values", "bounds")},
               formula=r9["formula"], inputs=r9["inputs"], method=r9["method"], note=r9["note"])]
    if not r9["supported"]:
        f9 = _finding("STAT-009", Verdict.INSUFFICIENT_EVIDENCE,
                      "样本不足或参数无效，异常识别未执行。", ev9,
                      "IQR/修正 Z 分数至少需要 3 个观测值。", "提供完整样本后重跑异常识别。",
                      affects="unknown")
        notes.append("STAT-009 样本不足，异常识别未执行。")
    elif r9["values"].get("outlier_indices"):
        f9 = _finding("STAT-009", Verdict.NEEDS_HUMAN_REVIEW,
                      f"{r9['method']} 标记出 {len(r9['values']['outlier_indices'])} 个候选离群点，"
                      f"索引为 {_fmt(r9['values']['outlier_indices'])}；数据未被自动删除。", ev9,
                      "离群点仅作标记，未做删除或替换。", "逐条复核原始记录与实验日志。")
    else:
        f9 = _finding("STAT-009", Verdict.VERIFIED,
                      f"{r9['method']} 未标记候选离群点；数据未被自动删除。", ev9,
                      "按给定阈值未超出界限。", "保留阈值设定以便复核。")
    put("STAT-009", r9, f9)

    # STAT-010 分布数据
    dist_values = _raw_values(p.get("distribution_values", p.get("samples")))
    r10 = distribution_data(dist_values, p.get("bins", 10))
    ev10 = [_ev(recomputed={k: r10["values"].get(k) for k in
                            ("counts", "bin_edges", "quartiles", "skewness", "kurtosis", "min", "max")},
                formula=r10["formula"], inputs=r10["inputs"], method=r10["method"], note=r10["note"])]
    if not r10["supported"]:
        f10 = _finding("STAT-010", Verdict.INSUFFICIENT_EVIDENCE,
                       "没有可用样本，分布数据未生成。", ev10,
                       "至少需要一条有限观测值。", "提供样本后生成直方图与分位数。",
                       affects="unknown")
        notes.append("STAT-010 无样本，分布数据未生成。")
    else:
        f10 = _finding("STAT-010", Verdict.VERIFIED,
                       f"已生成 {r10['values'].get('n')} 个观测的直方图分箱与四分位数，"
                       f"偏度为 {_fmt(r10['values'].get('skewness'))}，"
                       f"峰度为 {_fmt(r10['values'].get('kurtosis'))}，供前端展示。", ev10,
                       "分位数与矩统计量按公开公式重算。", "图形展示不替代统计判断。")
    put("STAT-010", r10, f10)

    # 计算结果的按函数名别名，便于调用方按原语名取用
    computations["verify_mean_std"] = r1
    computations["check_consistency"] = r2
    computations["analyze_seed_impact"] = r3
    computations["confidence_interval"] = r4
    computations["effect_size"] = r5
    computations["hypothesis_test"] = r6
    computations["multiple_comparison"] = r7
    computations["power_analysis"] = r8
    computations["detect_outliers"] = r9
    computations["distribution_data"] = r10
    notes.append("全部发现仅陈述可复算的统计事实，未包含因果断言；缺少的字段一律记为证据不足。")
    notes.append(f"分布函数来源：{_distribution_backend()}。")
    return {"findings": findings, "computations": computations, "notes": notes}
