"""确定性失败诊断分类器（验证引擎第一层，独立于大模型）。

职责边界：
- 只根据原始错误日志/环境/阶段等**确定性证据**做模式匹配分类；
- 输出一律是「候选原因」（is_confirmed=False + confidence），绝不把推测包装成确定根因；
- 无匹配时归入 other_unknown，不编造原因；
- 不执行任何代码，不调用外部服务。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field


# 用户要求的 11 类标准化错误分类（+ other_unknown 兜底）
FAILURE_CATEGORIES = (
    "paper_material_missing",     # 论文材料缺失
    "code_implementation_error",  # 代码实现错误
    "config_parameter_error",     # 配置参数错误
    "dataset_missing",            # 数据集缺失
    "data_format_error",          # 数据格式错误
    "env_dependency_conflict",    # 环境依赖冲突
    "hardware_resource_shortage", # 硬件资源不足
    "external_service_unavailable", # 外部服务不可用
    "run_timeout",                # 运行超时
    "result_inconsistent",        # 结果不一致
    "other_unknown",              # 其他未知原因
)

CATEGORY_LABELS = {
    "paper_material_missing": "论文材料缺失",
    "code_implementation_error": "代码实现错误",
    "config_parameter_error": "配置参数错误",
    "dataset_missing": "数据集缺失",
    "data_format_error": "数据格式错误",
    "env_dependency_conflict": "环境依赖冲突",
    "hardware_resource_shortage": "硬件资源不足",
    "external_service_unavailable": "外部服务不可用",
    "run_timeout": "运行超时",
    "result_inconsistent": "结果不一致",
    "other_unknown": "其他未知原因",
}

# 每类：正则模式（命中任一即得分）+ 基础置信度 + 修复建议
_RULES: dict[str, tuple[list[str], float, str]] = {
    "paper_material_missing": (
        [r"论文.{0,12}(缺失|未找到|不存在|not\s*found)", r"(paper|pdf).{0,20}(missing|not\s*found)"],
        0.6, "检查论文材料是否已上传并完成解析。"),
    "code_implementation_error": (
        [r"traceback", r"syntaxerror", r"nameerror", r"typeerror", r"attributeerror",
         r"modulenotfounderror", r"\.py.{0,20}(line|行)", r"assertionerror"],
        0.7, "核对报错栈定位的源码文件与行号，确认实现与论文描述一致。"),
    "config_parameter_error": (
        [r"(learning_rate|batch_size|epoch|lr|参数).{0,20}(错误|无效|invalid|非法|缺失)",
         r"keyerror", r"config.{0,15}(error|missing|invalid)"],
        0.55, "对照论文与代码配置，核对关键参数的名称与取值。"),
    "dataset_missing": (
        [r"(dataset|数据集|data).{0,20}(missing|缺失|not\s*found|不存在|找不到)",
         r"filenotfounderror", r"no such file or directory"],
        0.65, "确认数据集清单与文件路径；缺失时标为材料缺失，不得用合成数据替代。"),
    "data_format_error": (
        [r"(csv|json|yaml|parquet|格式).{0,20}(error|错误|invalid|非法|malformed|解析失败)",
         r"valueerror", r"unicodedecodeerror"],
        0.55, "检查数据文件的编码、分隔符与字段结构是否与代码预期一致。"),
    "env_dependency_conflict": (
        [r"(module|package|依赖|dependency).{0,20}(version|版本|conflict|冲突|incompatible|不兼容)",
         r"importerror", r"could not find version", r"requirement"],
        0.6, "对照环境依赖清单，核对冲突包的版本约束。"),
    "hardware_resource_shortage": (
        [r"out of memory", r"\bom\b", r"cuda.{0,15}(out of memory|oom)", r"no cuda",
         r"insufficient (memory|gpu|disk)", r"内存不足", r"显存不足", r"磁盘空间不足"],
        0.7, "核对硬件资源上限；当前环境未配置 GPU，不得据此推断论文结果不可复现。"),
    "external_service_unavailable": (
        [r"connection (refused|timed out)", r"dns", r"网络.{0,10}(不可达|超时|失败)",
         r"service unavailable", r"503", r"502"],
        0.5, "确认外部服务可用性与网络策略；本平台不主动上传受限数据。"),
    "run_timeout": (
        [r"timeout", r"timed out", r"超时", r"deadline exceeded"],
        0.8, "核对超时阈值与资源上限；提高阈值前先确认不是死循环。"),
    "result_inconsistent": (
        [r"(accuracy|f1|loss|metric|指标).{0,20}(mismatch|不一致|diff|差异|不一致)",
         r"结果.{0,10}(不一致|不符)", r"tolerance exceeded"],
        0.6, "核对指标提取口径、容差阈值与实验条件是否一致。"),
}

_COMPILED = {
    cat: [re.compile(p, re.IGNORECASE) for p in pats]
    for cat, (pats, _, _) in _RULES.items()
}


@dataclass
class CandidateCause:
    """候选原因：所有结论都不是确定根因。"""
    category: str
    label: str
    confidence: float
    is_confirmed: bool = False
    matched_evidence: list[str] = field(default_factory=list)
    suggested_fix: str = ""


@dataclass
class DeterministicDiagnosis:
    primary_category: str
    primary_label: str
    candidates: list[CandidateCause]
    raw_log_present: bool
    method: str = "deterministic_rule_v1"
    note: str = "本结果由确定性规则从原始日志推断，均为候选原因（is_confirmed=false）；需人工核实，不等同于确定根因。"


def classify_failure(
    *, raw_log: str = "", stage: str = "", error_code: str = "",
    environment_missing: str = "",
) -> DeterministicDiagnosis:
    """从确定性证据推断失败类别，返回候选原因（不冒充确定根因）。"""
    evidence_text = "\n".join(
        part for part in (raw_log or "", stage or "", error_code or "", environment_missing or "") if part
    )
    candidates: list[CandidateCause] = []
    for cat, patterns in _COMPILED.items():
        matches = [p.pattern for p in patterns if p.search(evidence_text)]
        if not matches:
            continue
        base = _RULES[cat][1]
        # 证据越充分置信度略增，但上限 0.9，永远不标记为确定
        confidence = min(0.9, base + 0.05 * (len(matches) - 1))
        candidates.append(CandidateCause(
            category=cat, label=CATEGORY_LABELS[cat], confidence=round(confidence, 2),
            is_confirmed=False, matched_evidence=matches[:5],
            suggested_fix=_RULES[cat][2],
        ))
    candidates.sort(key=lambda c: c.confidence, reverse=True)

    # 已知 error_code 直接映射，作为高优先级单一候选
    code_map = {
        "TASK_TIMEOUT": "run_timeout", "METRIC_UNEXTRACTABLE": "result_inconsistent",
        "EVIDENCE_VALIDATION_FAILED": "data_format_error", "EXECUTION_DISABLED": "env_dependency_conflict",
        "SECURITY_BLOCKED": "code_implementation_error",
    }
    if error_code in code_map:
        cat = code_map[error_code]
        direct = CandidateCause(
            category=cat, label=CATEGORY_LABELS[cat], confidence=0.9,
            is_confirmed=False, matched_evidence=[f"error_code={error_code}"],
            suggested_fix=_RULES[cat][2],
        )
        # 错误码是确定性证据，置顶；同类别的模糊正则命中去重，避免同一类别重复列举。
        candidates = [direct] + [c for c in candidates if c.category != cat]

    if not candidates:
        candidates.append(CandidateCause(
            category="other_unknown", label=CATEGORY_LABELS["other_unknown"],
            confidence=0.0, is_confirmed=False, matched_evidence=[],
            suggested_fix="证据不足，无法给出候选原因；请补充原始错误日志与环境信息后重试。",
        ))

    return DeterministicDiagnosis(
        primary_category=candidates[0].category,
        primary_label=candidates[0].label,
        candidates=candidates,
        raw_log_present=bool(raw_log and raw_log.strip()),
    )
