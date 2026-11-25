"""数据审计的报告结构与规则目录。

所有发现（Finding）必须带证据（Evidence）；证据为空的发现不允许发布。
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


class Severity(str, Enum):
    CRITICAL = "critical"   # 确定性泄漏 / 数据损坏 → 结论不可信
    HIGH = "high"           # 高概率问题，需要修复
    MEDIUM = "medium"       # 明显问题，建议修复
    LOW = "low"             # 轻微问题
    INFO = "info"           # 观察项 / 正向确认（如"参数仅从训练集拟合"）
    UNKNOWN = "unknown"     # 证据不足，无法判断（不强行给结论）


@dataclass
class Evidence:
    """可追溯证据。file_path 必填，其余按规则能力提供。"""
    file_path: str
    sample_id: str | None = None        # 样本标识（行号 / 图片文件名 / 记录 ID）
    field: str | None = None            # 数据字段（列名）
    code_location: str | None = None    # 代码位置 file:line
    paper_description: str | None = None  # 论文描述（如有）
    dataset_version: str | None = None  # 数据集版本
    detail: str | None = None           # 人类可读的细节
    log_ref: str | None = None          # 审计日志引用

    def to_dict(self) -> dict[str, Any]:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Finding:
    rule_id: str
    rule_name: str
    severity: str                        # Severity 值
    message: str
    confidence: str                      # high / medium / low
    evidence: list[Evidence] = field(default_factory=list)
    justification: str = ""              # 判定依据（为什么是这个问题）
    suggestion: str = ""                 # 修复建议
    affects: str = ""                    # 影响范围（train/test/both/all）

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["evidence"] = [e.to_dict() for e in self.evidence]
        return {k: v for k, v in d.items() if v not in (None, "", [])}


@dataclass
class AuditReport:
    audit_id: str
    project_id: str
    created_at: str
    scope: dict[str, Any]                # 审计范围（文件列表、参数、限额）
    findings: list[Finding] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)   # 数据集统计
    rule_results: dict[str, str] = field(default_factory=dict)  # rule_id -> pass/fail/skipped
    duration_ms: int = 0
    version: str = "dataaudit-v1"

    @property
    def counts(self) -> dict[str, int]:
        out: dict[str, int] = {}
        for f in self.findings:
            out[f.severity] = out.get(f.severity, 0) + 1
        return out

    @property
    def blocking(self) -> list[Finding]:
        """阻断级发现：critical/high。"""
        return [f for f in self.findings if f.severity in ("critical", "high")]

    def to_dict(self) -> dict[str, Any]:
        return {
            "audit_id": self.audit_id,
            "project_id": self.project_id,
            "created_at": self.created_at,
            "version": self.version,
            "scope": self.scope,
            "counts": self.counts,
            "blocking_count": len(self.blocking),
            "findings": [f.to_dict() for f in self.findings],
            "stats": self.stats,
            "rule_results": self.rule_results,
            "duration_ms": self.duration_ms,
        }


# 规则目录
@dataclass(frozen=True)
class RuleDef:
    rule_id: str
    name: str
    category: str        # integrity / leakage / distribution / preprocessing
    default_severity: str
    description: str


RULE_CATALOG: dict[str, RuleDef] = {r.rule_id: r for r in [
    # 完整性
    RuleDef("INT-001", "文件哈希缺失", "integrity", "medium",
            "数据文件没有 SHA256，无法验证完整性与追溯版本"),
    RuleDef("INT-002", "文件重复（内容相同）", "integrity", "medium",
            "项目内两个文件 SHA256 相同，可能是重复上传或冗余副本"),
    RuleDef("INT-003", "空文件/缺失内容", "integrity", "high",
            "数据文件为 0 字节或无可解析内容，声明的数据实际缺失"),
    RuleDef("INT-004", "数据格式错误", "integrity", "high",
            "CSV 列数不一致 / JSON 解析失败 / 编码错误，数据可能已损坏"),
    RuleDef("INT-005", "数据字段异常", "integrity", "medium",
            "列名为空、重复或包含非法字符"),
    RuleDef("INT-006", "数据类型异常", "integrity", "medium",
            "数值列中混入非数值内容（类型污染）"),
    RuleDef("INT-007", "空值率过高", "integrity", "medium",
            "某字段缺失值比例超过阈值"),
    RuleDef("INT-008", "异常值（IQR）", "integrity", "low",
            "数值字段存在超出 3×IQR 的极端观测"),
    RuleDef("INT-009", "数据损坏", "integrity", "critical",
            "文件无法读取、被截断或结构不完整"),
    RuleDef("INT-010", "数据集版本识别", "integrity", "info",
            "从目录/文件名识别数据集版本，用于可追溯性"),
    RuleDef("INT-011", "数据来源追踪", "integrity", "info",
            "从 manifest / README 识别数据来源声明"),
    # 泄漏
    RuleDef("LEAK-001", "训练/测试重复样本", "leakage", "high",
            "训练集与测试集存在完全相同的样本，模型可能在测试集上作弊"),
    RuleDef("LEAK-002", "训练/验证重复样本", "leakage", "high",
            "训练集与验证集存在完全相同的样本"),
    RuleDef("LEAK-003", "同内容不同文件名", "leakage", "medium",
            "文件内容哈希相同但文件名不同，可能是数据集划分时的副本泄漏"),
    RuleDef("LEAK-004", "近似重复样本", "leakage", "medium",
            "高相似度样本（文本 shingle / 图片字节），疑似近重复泄漏"),
    RuleDef("LEAK-005", "文本样本重复", "leakage", "medium",
            "文本数据集内部或跨划分存在重复记录"),
    RuleDef("LEAK-006", "时间序列未来信息泄漏", "leakage", "high",
            "时序数据使用随机划分或测试时间早于训练时间，存在未来信息泄漏"),
    RuleDef("LEAK-007", "预处理阶段信息泄漏", "leakage", "high",
            "预处理器在训练+测试全量数据上 fit（如 StandardScaler.fit 全量）"),
    RuleDef("LEAK-008", "特征选择使用测试集信息", "leakage", "high",
            "特征选择/降维在合并数据上执行，测试集信息进入特征选择"),
    RuleDef("LEAK-009", "标签泄漏", "leakage", "critical",
            "输入特征中包含标签本身或与标签完全同源的列"),
    RuleDef("LEAK-010", "交叉验证划分不合理", "leakage", "medium",
            "时序数据用 KFold 随机划分 / 分类任务未分层，划分方式与任务不匹配"),
    # 分布
    RuleDef("DIST-001", "类别不平衡", "distribution", "medium",
            "类别分布极不均衡，可能影响指标可信度"),
    RuleDef("DIST-002", "训练/测试分布差异", "distribution", "high",
            "训练与测试的特征/标签分布差异显著（PSI 超阈值）"),
    RuleDef("DIST-003", "极端值", "distribution", "low",
            "存在远超正常范围的观测值"),
    RuleDef("DIST-004", "数据缺失严重", "distribution", "medium",
            "字段缺失率超过阈值，可能造成样本偏差"),
    RuleDef("DIST-005", "样本偏差（划分比例不一致）", "distribution", "medium",
            "各划分的类别比例不一致，划分可能非随机或存在偏差"),
    RuleDef("DIST-006", "数据集规模过小", "distribution", "medium",
            "样本量不足以支撑论文声称的实验结论"),
    # 预处理
    RuleDef("PRE-001", "归一化/标准化存在但拟合范围不明", "preprocessing", "medium",
            "代码中存在缩放操作，但无法确认仅在训练集上 fit"),
    RuleDef("PRE-002", "缺失值填充策略未声明", "preprocessing", "low",
            "存在缺失值但代码/配置中未见填充策略"),
    RuleDef("PRE-003", "训练与测试预处理不一致", "preprocessing", "high",
            "训练与测试使用了不同的预处理路径"),
    RuleDef("PRE-004", "预处理参数仅从训练集拟合", "preprocessing", "info",
            "正向确认：缩放参数只在训练集上 fit（合规）"),
    RuleDef("PRE-005", "数据增强仅用于训练", "preprocessing", "info",
            "正向确认：增强仅作用于训练集（合规）"),
]}


def get_rule(rule_id: str) -> RuleDef:
    return RULE_CATALOG[rule_id]
