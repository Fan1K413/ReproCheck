"""统计学审计的共享契约：发现分类、可复算证据、报告结构与规则目录。

设计铁律（与 ReproCheck 既有引擎一致）：
1. 每条发现必须携带可复算证据（输入、公式、重算输出），否则不得发布；
2. 可信度分类六分，禁止把统计相关性描述为因果关系；
3. 禁止仅凭一组实验数据判定学术不端——只给证据与人工复核建议；
4. 缺数据一律 insufficient_evidence，不编造、不冒充已验证。

本文件是所有 stataudit 子模块的单一真相源，任何子模块只 import、不修改本文件。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


class Verdict(str, Enum):
    """六类可信度判断（用户指定的分类体系，不得增删语义）。"""

    CALCULATION_ERROR = "calculation_error"        # 计算错误：重算与报告不符
    METHOD_INAPPLICABLE = "method_inapplicable"    # 统计方法不适用：前提/口径不成立
    INSUFFICIENT_EVIDENCE = "insufficient_evidence"  # 证据不足：数据不足以判断
    POTENTIAL_BIAS = "potential_bias"              # 存在潜在偏差：选择性报告/划分差异等
    NEEDS_HUMAN_REVIEW = "needs_human_review"      # 需要人工复核：无法自动定性
    VERIFIED = "verified"                          # 已得到数据验证：可复算且一致

    @property
    def label_zh(self) -> str:
        return {
            Verdict.CALCULATION_ERROR: "计算错误",
            Verdict.METHOD_INAPPLICABLE: "统计方法不适用",
            Verdict.INSUFFICIENT_EVIDENCE: "证据不足",
            Verdict.POTENTIAL_BIAS: "存在潜在偏差",
            Verdict.NEEDS_HUMAN_REVIEW: "需要人工复核",
            Verdict.VERIFIED: "已得到数据验证",
        }[self]


VERDICT_ZH = {v.value: v.label_zh for v in Verdict}


@dataclass
class Evidence:
    """可追溯、可复算的证据。至少包含 claimed 与 recomputed 之一。"""

    source: str                                  # 数据来源标识：paper / code / dataset / input
    claimed: dict[str, Any] = field(default_factory=dict)     # 论文/调用方报告的值
    recomputed: dict[str, Any] = field(default_factory=dict)  # 本引擎按公开公式重算的值
    formula: str = ""                            # 使用的公开公式（可人工核对）
    inputs: dict[str, Any] = field(default_factory=dict)      # 重算输入（可复跑）
    method: str = ""                             # 计算方法标识（如 welch_t / cohens_d）
    note: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v not in (None, "", {}, [])}


@dataclass
class Finding:
    """单条审计发现。verdict 必须是 Verdict 六值之一。"""

    rule_id: str                   # 规则编号，如 STAT-001
    rule_name: str
    verdict: str                   # Verdict.value
    category: str                  # experiment_statistics / ml_metrics / experiment_design / credibility
    message: str                   # 中文结论；只陈述统计事实，禁止因果断言
    evidence: list[Evidence] = field(default_factory=list)
    justification: str = ""        # 判定依据
    suggestion: str = ""           # 人工复核建议
    confidence: str = "medium"     # high / medium / low
    affects: str = "all"           # 影响范围：train / val / test / all / unknown
    causal_language_checked: bool = True  # 已通过因果语言检查（见 engine.guard）

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["evidence"] = [e.to_dict() for e in self.evidence]
        d["verdict_label_zh"] = VERDICT_ZH.get(self.verdict, "未知")
        return d


@dataclass
class StatsReport:
    """一次统计审计的完整报告。所有字段可直接序列化为 JSON。"""

    report_id: str
    created_at: str
    scope: dict[str, Any] = field(default_factory=dict)   # 审计范围与输入摘要
    findings: list[Finding] = field(default_factory=list)
    computations: dict[str, Any] = field(default_factory=dict)  # 关键计算的可复算结果
    verdict_counts: dict[str, int] = field(default_factory=dict)
    limitations: list[str] = field(default_factory=list)  # 明确的边界与未验证项
    version: str = "statsaudit-v1"

    @property
    def blocking(self) -> list[Finding]:
        """需要阻断下结论的发现：计算错误 / 方法不适用 / 潜在偏差。"""
        return [f for f in self.findings if f.verdict in (
            Verdict.CALCULATION_ERROR.value,
            Verdict.METHOD_INAPPLICABLE.value,
            Verdict.POTENTIAL_BIAS.value,
        )]

    def to_dict(self) -> dict[str, Any]:
        return {
            "report_id": self.report_id,
            "created_at": self.created_at,
            "version": self.version,
            "scope": self.scope,
            "counts": self.verdict_counts,
            "blocking_count": len(self.blocking),
            "findings": [f.to_dict() for f in self.findings],
            "computations": self.computations,
            "limitations": self.limitations,
        }


@dataclass(frozen=True)
class RuleDef:
    rule_id: str
    name: str
    category: str
    default_verdict: str
    description: str


# 规则目录
RULE_CATALOG: dict[str, RuleDef] = {r.rule_id: r for r in [
    # 实验统计审计（用户要求的 10 项）
    RuleDef("STAT-001", "均值与标准差核验", "experiment_statistics", Verdict.CALCULATION_ERROR.value,
            "从原始样本重算 mean/std，与论文报告值对比；偏差超容差记为计算错误，缺样本记为证据不足。"),
    RuleDef("STAT-002", "多次实验结果一致性", "experiment_statistics", Verdict.NEEDS_HUMAN_REVIEW.value,
            "检查多次运行的均值/标准差/离散系数，识别不一致但与论文声称的'稳定'是否吻合。"),
    RuleDef("STAT-003", "随机种子影响分析", "experiment_statistics", Verdict.POTENTIAL_BIAS.value,
            "按种子分组统计，种子间差异过大却只报告单一种子 => 潜在选择偏差。"),
    RuleDef("STAT-004", "置信区间计算", "experiment_statistics", Verdict.INSUFFICIENT_EVIDENCE.value,
            "给出均值差的置信区间与计算方法；样本量过小或无原始数据 => 证据不足。"),
    RuleDef("STAT-005", "效应量计算", "experiment_statistics", Verdict.VERIFIED.value,
            "计算 Cohen's d / Hedges' g 等并给出阈值解读，区分统计显著与实际意义。"),
    RuleDef("STAT-006", "假设检验", "experiment_statistics", Verdict.METHOD_INAPPLICABLE.value,
            "按数据形态与前提选择 t 检验 / Welch / Mann-Whitney / 配对检验，前提不成立记为方法不适用。"),
    RuleDef("STAT-007", "多重比较校正", "experiment_statistics", Verdict.POTENTIAL_BIAS.value,
            "对多组比较做 Bonferroni / Holm / BH 校正；未校正且比较数>1 => 潜在偏差。"),
    RuleDef("STAT-008", "样本量与统计功效", "experiment_statistics", Verdict.INSUFFICIENT_EVIDENCE.value,
            "在给定效应量与显著性水平下计算检验功效/MDE；功效不足记为证据不足。"),
    RuleDef("STAT-009", "异常实验结果识别", "experiment_statistics", Verdict.NEEDS_HUMAN_REVIEW.value,
            "用 IQR / 修正 Z 分数识别离群运行；不自动删除，标记人工复核。"),
    RuleDef("STAT-010", "结果分布可视化数据", "experiment_statistics", Verdict.VERIFIED.value,
            "输出直方图/箱线图分位数等可复算数据供前端展示，不替代统计判断。"),
    # 机器学习指标审计
    RuleDef("MET-001", "指标定义正确性", "ml_metrics", Verdict.CALCULATION_ERROR.value,
            "按公开公式从混淆矩阵重算 Accuracy/P/R/F1 等，与报告值对比。"),
    RuleDef("MET-002", "类别平均方式一致性", "ml_metrics", Verdict.METHOD_INAPPLICABLE.value,
            "核对 macro/micro/weighted 平均是否与论文声称一致；多分类用二分类口径记为不适用。"),
    RuleDef("MET-003", "二分类与多分类混淆", "ml_metrics", Verdict.METHOD_INAPPLICABLE.value,
            "检查 ROC-AUC/PR-AUC 是否声明多分类平均策略，类别数>2 未声明记为不适用。"),
    RuleDef("MET-004", "数据集划分差异", "ml_metrics", Verdict.POTENTIAL_BIAS.value,
            "检查 train/val/test 划分口径是否一致，测试集参与调参记为潜在偏差。"),
    RuleDef("MET-005", "错误的指标汇总", "ml_metrics", Verdict.CALCULATION_ERROR.value,
            "报告值与任何标准平均口径都不符，或跨划分混算，记为计算错误。"),
    RuleDef("MET-006", "验证集指标误认为测试集", "ml_metrics", Verdict.POTENTIAL_BIAS.value,
            "检查指标来源标记；验证集数值被当作最终测试结论记为潜在偏差。"),
    RuleDef("MET-007", "回归指标审计", "ml_metrics", Verdict.CALCULATION_ERROR.value,
            "从预测/真值重算 RMSE/MAE/R²，核对 R² 的 baseline（SS_tot）口径。"),
    # 实验设计合理性
    RuleDef("DSN-001", "对照组充分性", "experiment_design", Verdict.INSUFFICIENT_EVIDENCE.value,
            "检查是否提供必要的对照/随机/盲法信息，缺失记为证据不足。"),
    RuleDef("DSN-002", "消融实验完整性", "experiment_design", Verdict.INSUFFICIENT_EVIDENCE.value,
            "对论文声称的每个核心组件检查是否有对应消融，缺项为证据不足。"),
    RuleDef("DSN-003", "基线模型合理性", "experiment_design", Verdict.NEEDS_HUMAN_REVIEW.value,
            "检查基线是否同期/是否调参充分；强弱基线合理性需人工复核。"),
    RuleDef("DSN-004", "超参数搜索偏差", "experiment_design", Verdict.POTENTIAL_BIAS.value,
            "超参若在同测试集上选择，或搜索次数未披露，记为潜在偏差。"),
    RuleDef("DSN-005", "选择性报告", "experiment_design", Verdict.POTENTIAL_BIAS.value,
            "只报告部分种子/划分/指标而隐藏其余，记为潜在偏差。"),
    RuleDef("DSN-006", "重复实验不足", "experiment_design", Verdict.INSUFFICIENT_EVIDENCE.value,
            "重复次数低于阈值时不能支撑稳定性结论，记为证据不足。"),
    RuleDef("DSN-007", "统计显著但实际意义小", "experiment_design", Verdict.NEEDS_HUMAN_REVIEW.value,
            "p 显著但效应量低于实际意义阈值时标记人工复核，不否定显著性本身。"),
    # 可信度边界
    RuleDef("CRED-001", "相关性不得表述为因果", "credibility", Verdict.NEEDS_HUMAN_REVIEW.value,
            "自动检查结论文本中的因果动词，出现即降级为人工复核并给出中性改写。"),
    RuleDef("CRED-002", "单一实验不构成不端的判定", "credibility", Verdict.NEEDS_HUMAN_REVIEW.value,
            "任何异常只表述为统计证据问题 + 人工复核建议，不得给出学术不端结论。"),
]}


NAVIGATION_GUARD: tuple[str, ...] = (
    "导致", "造成", "证明", "归因于", "因为", "所以", "必然", "决定了",
    "causes", "proves", "due to", "therefore", "as a result",
)


def get_rule(rule_id: str) -> RuleDef | None:
    return RULE_CATALOG.get(rule_id)
