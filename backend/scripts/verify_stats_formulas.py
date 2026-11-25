"""独立人工校验脚本：用教科书/Excel 已知结果核对 stataudit 的关键计算。

本脚本的期望值全部来自闭式手算或标准统计表，不调用 stataudit 内部任何公式函数，
因此构成对引擎的独立交叉验证（人工校验结果）。

用法：
    cd backend
    PYTHONPATH=. ./.venv/Scripts/python.exe scripts/verify_stats_formulas.py
"""
from __future__ import annotations

import math
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.statsaudit.core import (  # noqa: E402
    confidence_interval, effect_size, hypothesis_test, mean,
    multiple_comparison, std, variance,
)
from app.statsaudit.metrics import (  # noqa: E402
    compute_classification_metrics, compute_regression_metrics,
)

PASS = 0
FAIL = 0


def check(label: str, got, expected, tol: float = 1e-4):
    global PASS, FAIL
    ok = False
    if isinstance(expected, (int, float)) and not isinstance(expected, bool):
        try:
            ok = abs(float(got) - float(expected)) <= tol
        except (TypeError, ValueError):
            ok = False
    else:
        ok = got == expected
    if ok:
        PASS += 1
        print(f"  PASS {label}: got={got} expected={expected}")
    else:
        FAIL += 1
        print(f"  FAIL {label}: got={got} expected={expected}")


def main():
    print("=== 1. 描述统计（手算） ===")
    xs = [1, 2, 3, 4, 5]
    check("mean([1..5])", mean(xs)["value"], 3.0)
    check("variance ddof=1", variance(xs, ddof=1)["value"], 2.5)
    check("std ddof=1", std(xs, ddof=1)["value"], math.sqrt(2.5))

    print("=== 2. 置信区间（Excel CONFIDENCE.T 已知值） ===")
    # [1,2,3,4,5]: mean=3, s=sqrt(2.5)=1.5811388, se=0.7071068,
    # t(0.975, df=4)=2.7764451, margin=1.96331 -> CI=[1.03669, 4.96331]
    ci = confidence_interval(xs, level=0.95, method="t")
    check("CI mean", ci["values"]["mean"], 3.0)
    check("CI se", ci["values"]["se"], math.sqrt(2.5) / math.sqrt(5))
    check("CI critical t(0.975,4)", ci["values"]["critical_value"], 2.7764451, tol=1e-5)
    check("CI low", ci["values"]["ci_low"], 1.03669, tol=1e-4)
    check("CI high", ci["values"]["ci_high"], 4.96331, tol=1e-4)

    print("=== 3. Cohen's d（手算） ===")
    # A=[1,2,3], B=[4,5,6]: meanA=2 meanB=5, sA=sB=1, pooled=1, d=-3
    da = effect_size([1, 2, 3], [4, 5, 6], kind="cohens_d")
    check("cohens_d", da["value"], -3.0)
    check("pooled_std", da["values"]["pooled_std"], 1.0)

    print("=== 4. 假设检验 Welch t（手算） ===")
    # 同上两组: t=(2-5)/sqrt(1/3+1/3)=-3/0.816497=-3.674235
    ht = hypothesis_test([1, 2, 3], [4, 5, 6], kind="welch", alpha=0.05)
    check("welch t statistic", ht["values"]["statistic"], -3.674235, tol=1e-5)

    print("=== 5. 多重比较校正（手算） ===")
    # Bonferroni: [0.01,0.04,0.30] * 3 = [0.03,0.12,0.90]
    bon = multiple_comparison([0.01, 0.04, 0.30], method="bonferroni", alpha=0.05)
    check("bonferroni p1", bon["values"]["adjusted_pvalues"][0], 0.03)
    check("bonferroni p2", bon["values"]["adjusted_pvalues"][1], 0.12)
    # Holm: sorted p=[0.01,0.04,0.30]; adj=[0.03,0.08,0.30] (0.30 capped)
    holm = multiple_comparison([0.01, 0.04, 0.30], method="holm", alpha=0.05)
    check("holm p1", holm["values"]["adjusted_pvalues"][0], 0.03)
    check("holm p2", holm["values"]["adjusted_pvalues"][1], 0.08)

    print("=== 6. 分类指标（混淆矩阵手算） ===")
    # TP=5 FP=2 FN=3 TN=10 => P=5/7, R=5/8, F1=2PR/(P+R)=10/17, Acc=15/20
    # 注意：compute_classification_metrics 默认 average="macro"，
    # 二分类正类口径需显式 average="binary"，且标签排序后正类为 1。
    cm = compute_classification_metrics(
        y_true=[1]*8 + [0]*12,
        y_pred=[1]*5 + [0]*3 + [1]*2 + [0]*10,
        average="binary", labels=[0, 1],
    )
    check("accuracy", cm["values"]["accuracy"], 15/20)
    check("precision(binary,pos=1)", cm["values"]["precision"], 5/7)
    check("recall(binary,pos=1)", cm["values"]["recall"], 5/8)
    check("f1(binary,pos=1)", cm["values"]["f1"], 2*(5/7)*(5/8)/((5/7)+(5/8)))  # =10/15
    # 交叉验证：macro precision 应等于两类 precision 的等权平均 (5/7 + 10/13)/2
    check("macro precision", cm["values"]["macro"]["precision"], (5/7 + 10/13)/2)

    print("=== 7. 回归指标（手算） ===")
    reg = compute_regression_metrics([1, 2, 3], [1.5, 2.5, 3.5])
    check("RMSE", reg["values"]["rmse"], 0.5)
    check("MAE", reg["values"]["mae"], 0.5)
    # y mean=2, SS_tot=2, SS_res=0.75, R2=1-0.75/2=0.625
    check("R2", reg["values"]["r2"], 0.625)

    print(f"\n=== 结果: {PASS} PASS / {FAIL} FAIL ===")
    if FAIL:
        sys.exit(1)


if __name__ == "__main__":
    main()
