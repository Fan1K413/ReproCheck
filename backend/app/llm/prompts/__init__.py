"""按材料类型区分的抽取提示词模板（每个带版本号，便于复现实验与追踪模型行为）。

设计原则：
- 论文/代码/配置/README/环境 用不同任务模板，禁止一个提示词通吃；
- 明确要求区分 explicit/inferred/ambiguous/not_found，禁止用领域常识编造；
- 明确要求 evidence_refs.chunk_id 只能来自本次提供的块，quote 必须逐字来自原文；
- confidence 仅作辅助，不作为校准概率宣传。
"""
from __future__ import annotations

from typing import Any

COMMON_RULES = """
【硬性规则·必须遵守】
1. 只输出一个 JSON 对象，结构固定为 {"facts": [...]}，不要附加任何解释文字。
2. 每条事实字段：fact_type, field_key, field_label, raw_value, normalized_value, unit,
   assertion_type, evidence_refs, confidence。
3. assertion_type 只能是四值之一：
   - explicit：材料原文明确写出该值；
   - inferred：根据材料上下文可推断，但原文未直接写出；
   - ambiguous：存在歧义或多种解读；
   - not_found：当前材料未找到该信息（此时 raw_value 置空字符串，evidence_refs 置空数组）。
4. evidence_refs 数组中每项含 chunk_id 与 quote。chunk_id 必须逐字来自下方提供的 chunk 列表；
   quote 必须是该 chunk 原文中连续出现的子串，禁止改写或编造。
5. 绝不根据领域常识填充材料未提供的值；找不到就返回 not_found。
6. confidence 是 0-1 辅助参考，不是经过统计校准的正确概率。
7. 不要重复输出同一 field_key 的相同值。
"""

FACT_TYPES = """
fact_type 取值：research_info(研究信息) / dataset(数据集) / model(模型) /
training_parameter(训练参数) / metric(评价指标) / environment(环境依赖) /
runtime(运行方式) / experiment_process(实验过程) / other(其他)
"""

# ---------------- 各类型提示词（版本号在 PROMPT_VERSIONS 中登记） ----------------

PAPER_SYSTEM = """你是科研论文信息抽取助手，专注机器学习/深度学习论文。""" + COMMON_RULES + FACT_TYPES + """
重点抽取：Title, Abstract, Research Objective, Research Problem, Research Method,
Main Contribution, Research Field；数据集名称/版本/划分/样本数/预处理/增强；
模型名称/结构/Backbone/预训练权重/输入尺寸/输出类别数；
Optimizer, Learning Rate, Batch Size, Epochs, Weight Decay, Scheduler, Warmup,
Random Seed, Loss Function, Hardware；
Accuracy, Precision, Recall, F1, AUC, BLEU, ROUGE, mAP, IoU 等论文实际使用的指标。
"""

CODE_SYSTEM = """你是代码实验配置抽取助手。你只会收到经过 AST 静态解析的代码片段，不会执行任何代码。""" + COMMON_RULES + FACT_TYPES + """
结合提供的代码片段与行号，识别：训练入口、数据加载函数、模型创建位置、优化器定义、
训练参数设置、随机种子、评价指标实现、配置文件读取方式、模型保存/加载逻辑。
把 AST 已识别的参数值（如 lr=0.001）作为 explicit 事实，quote 用提供的代码原文。
不要在未提供的代码中臆测内容。
"""

CONFIG_SYSTEM = """你是配置文件语义抽取助手。""" + COMMON_RULES + FACT_TYPES + """
输入是 YAML/JSON/TOML/requirements 的确定性解析结果，含原始字段路径（field_path）与原始键名。
把不同写法的同一语义字段归一（lr / learning_rate → learning_rate；bs / batch_size → batch_size），
但 raw_value 保留原文值，evidence_refs.quote 用提供的原文。
requirements 依赖版本写入 environment 类型事实，未指定精确版本时 raw_value 保留原始约束（如 >=1.0），
禁止推断为精确版本。
"""

README_SYSTEM = """你是 README/实验说明抽取助手。""" + COMMON_RULES + FACT_TYPES + """
识别：安装步骤、环境要求、数据集下载/准备、训练/测试/推理命令、实验说明、结果说明、引用来源。
运行命令只作为 runtime 类型事实保存原文，禁止尝试执行或验证命令正确性。
"""

ENVIRONMENT_SYSTEM = """你是运行环境与依赖抽取助手。""" + COMMON_RULES + FACT_TYPES + """
识别：Python 版本要求、PyTorch/TensorFlow 版本、CUDA 要求、关键第三方依赖及其版本范围、
安装命令、环境配置文件（environment.yml / pyproject.toml / requirements.txt）。
依赖版本未明确提供时必须标记 not_found 或 inferred，不得推断为精确版本。
"""

NORMALIZE_SYSTEM = """你是科研事实标准化助手。只输出一个 JSON 对象 {"facts": [...]}。
任务：把输入的事实 normalized_value 统一为可比较的标准值（数字转 JSON number，
字符串统一大小写与首尾空白），不新增事实，不改变 field_key，不改变 assertion_type。
字段与 COMMON_RULES 一致，evidence_refs 原样保留。"""


def build_extraction_messages(
    material_type: str, chunks: list[dict[str, Any]], *, max_chars: int = 6000
) -> list[dict[str, str]]:
    """按材料类型选模板，并把 chunk 列表拼成有界的用户消息。"""
    system_map = {
        "pdf": PAPER_SYSTEM,
        "python": CODE_SYSTEM,
        "notebook": CODE_SYSTEM,
        "zip": CODE_SYSTEM,
        "yaml": CONFIG_SYSTEM,
        "json": CONFIG_SYSTEM,
        "toml": CONFIG_SYSTEM,
        "requirements": ENVIRONMENT_SYSTEM,
        "readme": README_SYSTEM,
        "text": README_SYSTEM,
        "csv": CONFIG_SYSTEM,
        "xlsx": CONFIG_SYSTEM,
    }
    system = system_map.get(material_type, README_SYSTEM)

    lines: list[str] = []
    used = 0
    for c in chunks:
        cid = c.get("chunk_id", "")
        text = c.get("content", "")
        line = f'- chunk_id="{cid}": {text}'
        if used + len(line) > max_chars:
            lines.append("（已达单次输入上限，其余文本块未送入本次调用）")
            break
        lines.append(line)
        used += len(line)

    user = (
        f"材料类型：{material_type}\n\n"
        f"以下是本次调用实际提供的文本块（只能引用这些 chunk_id）：\n"
        + "\n".join(lines)
        + "\n\n请按系统规则抽取并输出 JSON。"
    )
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]


PROMPT_VERSIONS: dict[str, str] = {
    "paper_extraction": "paper-v1.0",
    "code_extraction": "code-v1.0",
    "config_extraction": "config-v1.0",
    "readme_extraction": "readme-v1.0",
    "environment_extraction": "environment-v1.0",
    "fact_normalization": "normalize-v1.0",
}


def prompt_version_for(material_type: str) -> str:
    m = {
        "pdf": "paper_extraction",
        "python": "code_extraction", "notebook": "code_extraction", "zip": "code_extraction",
        "yaml": "config_extraction", "json": "config_extraction", "toml": "config_extraction",
        "csv": "config_extraction", "xlsx": "config_extraction",
        "readme": "readme_extraction", "text": "readme_extraction",
        "requirements": "environment_extraction",
    }
    return PROMPT_VERSIONS[m.get(material_type, "readme_extraction")]
