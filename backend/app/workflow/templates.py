"""科研任务模板库。

模板不是空白表单：每个模板给出真实的节点链、依赖、前置条件、处理器、
验收标准与风险等级，节点处理器对接既有确定性审计引擎（事实比对、数据质量、
统计核验、图表核验、数值重算等）；无数据/无执行后端时处理器如实返回
insufficient_data / blocked，不伪造结果。

模板分类覆盖任务要求的八类场景：
机器学习论文复现 / 计算机视觉实验 / NLP 模型实验 / 消融实验 / 超参数对比 /
数据集质量检查 / 模型评测 / 统计结果核验。
"""
from __future__ import annotations

from typing import Any

# 节点默认值工厂，避免可变默认引用
def _node(
    *, key: str, title: str, handler: str, description: str = "",
    depends_on: list[str] | None = None, priority: int = 5,
    node_type: str = "check", preconditions: dict[str, Any] | None = None,
    action: str = "", expected_result: str = "", acceptance: str = "",
    evidence_targets: list[str] | None = None, risk_level: str = "low",
    needs_human_confirm: bool = False, max_retries: int = 0,
) -> dict[str, Any]:
    return {
        "node_key": key, "title": title, "description": description,
        "node_type": node_type, "handler": handler,
        "depends_on": depends_on or [], "priority": priority,
        "preconditions": preconditions or {}, "action": action,
        "expected_result": expected_result, "acceptance_criteria": acceptance,
        "evidence_targets": evidence_targets or [], "risk_level": risk_level,
        "needs_human_confirm": needs_human_confirm, "max_retries": max_retries,
    }


TEMPLATES: list[dict[str, Any]] = [
    {
        "key": "ml_paper_reproduction",
        "name": "机器学习论文复现",
        "domain": "machine_learning",
        "description": "从材料完整性、参数一致性、数据质量、环境依赖到指标对照的完整复现审计链；"
                       "实验执行节点受安全隔离后端门禁控制。",
        "nodes": [
            _node(
                key="T1", title="材料完整性检查", handler="materials_presence", priority=10,
                description="核对论文、代码、配置三类材料是否齐备并完成解析。",
                action="枚举项目材料，按论文/代码/配置分类，检查解析状态。",
                expected_result="返回各类材料清单与缺失项。",
                acceptance="论文材料与至少一份代码或配置材料存在；缺失项被明确列出。",
                preconditions={"min_facts": 0},
            ),
            _node(
                key="T2", title="关键参数论文-代码一致性核对", handler="compare_parameter",
                depends_on=["T1"], priority=9,
                description="比对学习率、批大小、训练轮数、优化器等关键参数在论文描述与代码/配置中的取值。",
                action="按规范字段分组事实，跨材料做程序化数值/字符串比对。",
                expected_result="逐字段给出 consistent / conflict / missing 结论与证据引用。",
                acceptance="每个已抽取字段都有比对结论；冲突字段附双方证据定位。",
                evidence_targets=["learning_rate", "batch_size", "epochs", "optimizer"],
            ),
            _node(
                key="T3", title="数据集质量检查", handler="dataset_quality_check",
                depends_on=["T1"], priority=7,
                description="检查数据文件可达性、字段结构、编码与明显的缺失/泄漏风险。",
                action="对数据类材料运行数据质量审计引擎；无数据文件时如实标注不足。",
                expected_result="质量问题清单与严重级别；无数据时返回 insufficient_data。",
                acceptance="问题项可追溯到具体材料；不使用合成数据替代缺失数据集。",
            ),
            _node(
                key="T4", title="环境与依赖核对", handler="env_dependency_check",
                depends_on=["T1"], priority=6,
                description="识别 Python 版本、框架、依赖声明与硬件要求，列出缺失项。",
                action="静态解析依赖声明文件与代码文本，不执行安装命令。",
                expected_result="环境画像与缺失/警告清单。",
                acceptance="缺失依赖被明确标注；不据此推断论文结果不可复现。",
            ),
            _node(
                key="T5", title="复现实验执行", handler="experiment_run",
                depends_on=["T2", "T3", "T4"], priority=5, node_type="experiment",
                risk_level="high", needs_human_confirm=True, max_retries=1,
                description="在隔离副本中按复现计划运行训练/评测；无安全后端时保持禁用并如实记录。",
                action="经人工确认后，在受控隔离环境执行入口脚本并采集日志与产物。",
                expected_result="运行日志、产物与指标；无后端时 blocked_no_sandbox。",
                acceptance="执行启用时产物哈希可追溯；禁用时状态与原因如实落库。",
                preconditions={"sandbox_required": True},
            ),
            _node(
                key="T6", title="指标对照与结论核验", handler="model_evaluation",
                depends_on=["T5"], priority=4,
                description="将复现指标与论文声明对照，按容差给出一致/不一致/数据不足结论。",
                action="读取既有指标与事实，做口径核对与容差比较。",
                expected_result="逐指标对照结论与证据；无指标数据时 insufficient_data。",
                acceptance="结论区分一致、冲突与数据不足三类，不把数据不足判为失败。",
            ),
        ],
    },
    {
        "key": "cv_experiment",
        "name": "计算机视觉实验",
        "domain": "computer_vision",
        "description": "面向图像分类/检测/分割实验的材料、数据、配置、训练与评测链。",
        "nodes": [
            _node(
                key="T1", title="图像数据集与标注材料检查", handler="materials_presence", priority=10,
                description="核对图像/标注/划分清单与读取代码是否齐备。",
                expected_result="材料分类清单与缺失项。",
                acceptance="图像或标注材料存在时给出数量；缺失时明确列出。",
            ),
            _node(
                key="T2", title="数据划分与泄漏检查", handler="dataset_quality_check",
                depends_on=["T1"], priority=8,
                description="检查训练/验证/测试划分是否存在重叠或泄漏风险。",
                expected_result="泄漏/分布问题清单；无数据时 insufficient_data。",
                acceptance="泄漏结论基于真实数据划分证据。",
            ),
            _node(
                key="T3", title="模型配置核对", handler="compare_parameter",
                depends_on=["T1"], priority=7,
                description="核对主干网络、输入分辨率、增广策略、批大小等配置与论文描述。",
                evidence_targets=["backbone", "input_size", "batch_size", "epochs", "learning_rate"],
                expected_result="逐字段一致性结论与证据。",
                acceptance="配置字段均可追溯到材料原文。",
            ),
            _node(
                key="T4", title="训练实验执行", handler="experiment_run",
                depends_on=["T2", "T3"], priority=5, node_type="experiment",
                risk_level="high", needs_human_confirm=True, max_retries=1,
                preconditions={"sandbox_required": True},
                description="隔离副本中训练；无安全后端时禁用并记录原因。",
            ),
            _node(
                key="T5", title="评测指标核对", handler="model_evaluation",
                depends_on=["T4"], priority=4,
                description="核对 Acc/mAP/IoU 等指标口径与取值。",
                expected_result="指标对照结论；无指标数据时 insufficient_data。",
            ),
            _node(
                key="T6", title="结果图表核验", handler="chart_verification_check",
                depends_on=["T5"], priority=3,
                description="把论文图表中的数值陈述与代码绘图逻辑、结果文件做文本层核验。",
                expected_result="图表主张核验清单；无图表材料时 insufficient_data。",
            ),
        ],
    },
    {
        "key": "nlp_experiment",
        "name": "NLP 模型实验",
        "domain": "natural_language_processing",
        "description": "面向文本分类/序列标注/生成任务的语料、超参、训练与评测链。",
        "nodes": [
            _node(
                key="T1", title="语料与分词材料检查", handler="materials_presence", priority=10,
                description="核对语料、词典/分词器、预处理脚本与论文是否齐备。",
                expected_result="材料分类清单与缺失项。",
            ),
            _node(
                key="T2", title="超参与模型配置核对", handler="compare_parameter",
                depends_on=["T1"], priority=8,
                evidence_targets=["learning_rate", "batch_size", "epochs", "optimizer", "max_seq_len"],
                description="核对学习率、批大小、序列长度、优化器、训练轮数等。",
                expected_result="逐字段一致性结论与证据。",
            ),
            _node(
                key="T3", title="语料分布与泄漏检查", handler="dataset_quality_check",
                depends_on=["T1"], priority=7,
                description="检查类别分布、样本重叠与预处理一致性。",
                expected_result="质量/泄漏问题清单；无数据时 insufficient_data。",
            ),
            _node(
                key="T4", title="训练实验执行", handler="experiment_run",
                depends_on=["T2", "T3"], priority=5, node_type="experiment",
                risk_level="high", needs_human_confirm=True, max_retries=1,
                preconditions={"sandbox_required": True},
            ),
            _node(
                key="T5", title="评测指标核对", handler="model_evaluation",
                depends_on=["T4"], priority=4,
                description="核对 F1/Accuracy/PPL/BLEU 等指标口径与取值。",
                expected_result="指标对照结论；无指标数据时 insufficient_data。",
            ),
        ],
    },
    {
        "key": "ablation_study",
        "name": "消融实验",
        "domain": "ablation",
        "description": "核对基线与各变体配置、逐变体指标差异及结论一致性。",
        "nodes": [
            _node(
                key="T1", title="基线与变体清单核对", handler="materials_presence", priority=10,
                description="确认基线模型与各消融变体的配置/结果材料齐全。",
                expected_result="变体清单与缺失项。",
            ),
            _node(
                key="T2", title="变体配置差异核对", handler="compare_parameter",
                depends_on=["T1"], priority=8,
                description="核对每个变体相对基线改动的组件/超参是否与论文描述一致。",
                expected_result="逐变体配置差异结论。",
            ),
            _node(
                key="T3", title="逐变体指标对照", handler="ablation_check",
                depends_on=["T2"], priority=6,
                description="按变体分组对照指标，检查差值方向与论文主张是否一致。",
                expected_result="变体指标对照与方向核验；分组不足时 insufficient_data。",
                acceptance="每个结论标注所属变体与证据来源。",
            ),
            _node(
                key="T4", title="结论一致性核验", handler="stats_verify",
                depends_on=["T3"], priority=4,
                description="核验消融结论措辞与指标差异方向、显著性是否匹配。",
                expected_result="结论一致性核验；统计证据不足时如实标注。",
            ),
        ],
    },
    {
        "key": "hyperparam_comparison",
        "name": "超参数对比",
        "domain": "hyperparameter",
        "description": "多组超参配置的抽取、一致性核对与结果指标横向对比。",
        "nodes": [
            _node(
                key="T1", title="超参清单抽取核对", handler="materials_presence", priority=10,
                description="确认多组配置（代码/配置/日志）材料齐备。",
                expected_result="配置材料清单。",
            ),
            _node(
                key="T2", title="配置取值一致性核对", handler="compare_parameter",
                depends_on=["T1"], priority=8,
                evidence_targets=["learning_rate", "batch_size", "epochs", "optimizer"],
                description="核对论文声明的超参与代码/配置实际取值。",
                expected_result="逐字段一致性结论。",
            ),
            _node(
                key="T3", title="多组结果指标横向对比", handler="hyperparam_compare",
                depends_on=["T2"], priority=6,
                description="按配置分组对比指标，定位最优配置与异常组。",
                expected_result="分组指标对比表；分组不足时 insufficient_data。",
            ),
            _node(
                key="T4", title="最优配置判定核验", handler="model_evaluation",
                depends_on=["T3"], priority=4,
                description="核验论文给出的最优超参与实测指标排序是否一致。",
                expected_result="判定一致性结论；数据不足时标注。",
            ),
        ],
    },
    {
        "key": "dataset_quality",
        "name": "数据集质量检查",
        "domain": "data_quality",
        "description": "面向数据集本身的可达性、结构、分布、编码与泄漏专项审计。",
        "nodes": [
            _node(
                key="T1", title="数据文件可达性检查", handler="materials_presence", priority=10,
                description="确认数据文件已上传且可读取，记录文件类型与规模。",
                expected_result="数据文件清单与可读性状态。",
            ),
            _node(
                key="T2", title="模式/编码/字段检查", handler="dataset_quality_check",
                depends_on=["T1"], priority=8,
                description="检查列名、类型、编码、分隔符与缺失值情况。",
                expected_result="结构问题清单；无法解析时记录原始错误。",
            ),
            _node(
                key="T3", title="分布与泄漏检查", handler="dataset_quality_check",
                depends_on=["T2"], priority=6,
                description="检查类别/数值分布异常与跨划分重叠。",
                expected_result="分布与泄漏风险清单；无数据时 insufficient_data。",
            ),
            _node(
                key="T4", title="质量问题与补证建议", handler="fact_evidence_check",
                depends_on=["T3"], priority=4,
                description="汇总未覆盖主张与缺失证据，生成补证建议清单。",
                expected_result="问题→所需材料/复现动作的映射清单。",
            ),
        ],
    },
    {
        "key": "model_evaluation",
        "name": "模型评测",
        "domain": "evaluation",
        "description": "评测集材料、指标口径、指标复算与显著性核验链。",
        "nodes": [
            _node(
                key="T1", title="评测集与脚本核对", handler="materials_presence", priority=10,
                description="确认评测集、评测脚本与结果记录材料齐备。",
                expected_result="材料清单与缺失项。",
            ),
            _node(
                key="T2", title="指标口径核对", handler="compare_parameter",
                depends_on=["T1"], priority=8,
                description="核对指标定义、阈值、平均方式（macro/micro）与论文描述。",
                expected_result="口径一致性结论。",
            ),
            _node(
                key="T3", title="指标复算与对照", handler="model_evaluation",
                depends_on=["T2"], priority=6,
                description="基于计数/结果数据复算 F1/Accuracy 并与声明值对照。",
                expected_result="复算值、偏差与对照结论；数据不足时标注。",
            ),
            _node(
                key="T4", title="统计显著性核验", handler="stats_verify",
                depends_on=["T3"], priority=4,
                description="核验样本量、分组与显著性表述是否有统计证据支撑。",
                expected_result="统计核验结论；证据不足时明确标注。",
            ),
        ],
    },
    {
        "key": "stats_verification",
        "name": "统计结果核验",
        "domain": "statistics",
        "description": "实验设计、样本量、数值重算、显著性与结论措辞的专项核验。",
        "nodes": [
            _node(
                key="T1", title="统计设计核对", handler="materials_presence", priority=10,
                description="确认实验设计、分组、样本量与指标声明材料齐备。",
                expected_result="设计要素清单与缺失项。",
            ),
            _node(
                key="T2", title="数值重算核验", handler="stats_verify",
                depends_on=["T1"], priority=8,
                description="对比例、均值、F1 等可重算指标按原始计数复核。",
                expected_result="重算值与偏差；缺少原始计数时 insufficient_data。",
            ),
            _node(
                key="T3", title="显著性与容差核验", handler="stats_verify",
                depends_on=["T2"], priority=6,
                description="核验显著性表述、置信区间与容差阈值是否有据可依。",
                expected_result="核验结论与证据引用。",
            ),
            _node(
                key="T4", title="结论措辞一致性检查", handler="fact_evidence_check",
                depends_on=["T3"], priority=4,
                description="检查论文结论措辞是否超出统计证据所能支撑的范围。",
                expected_result="措辞-证据匹配清单；过度声称被标出。",
            ),
        ],
    },
]

TEMPLATE_MAP: dict[str, dict[str, Any]] = {t["key"]: t for t in TEMPLATES}


def list_templates() -> list[dict[str, Any]]:
    """返回模板元信息（不含节点长描述，供列表页使用）。"""
    return [{
        "key": t["key"], "name": t["name"], "domain": t["domain"],
        "description": t["description"], "node_count": len(t["nodes"]),
        "node_keys": [n["node_key"] for n in t["nodes"]],
    } for t in TEMPLATES]


def get_template(key: str) -> dict[str, Any] | None:
    return TEMPLATE_MAP.get(key)
