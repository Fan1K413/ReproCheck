"""任务可行性确定性校验。

安全阻断必须由程序规则决定，AI 只能辅助解释。
材料缺失 ≠ 研究造假；未记录 ≠ 未实施。
"""
from __future__ import annotations

from typing import Any

from app.models import Material

# 高风险关键词（静态规则，命中即 blocked_security）
HIGH_RISK_PATTERNS = [
    "sudo", "rm -rf", "chmod 777", "curl | sh", "wget | sh", "eval(", "exec(",
    "subprocess", "os.system", "pip install", "conda install", "apt-get",
    "docker run --privileged", "--no-sandbox", "ssh ", "scp ", "nc -",
]

REQUIRED_KEYWORDS = {
    "dataset": ["dataset", "data", "数据集", "数据"],
    "dependency": ["requirement", "dependency", "依赖", "torch", "tensorflow"],
    "configuration": ["config", "参数", "配置", "yaml", "seed", "batch"],
}


def check_feasibility(
    task: dict[str, Any],
    materials: list[Material],
    available_facts: list[dict[str, Any]],
) -> tuple[str, str]:
    """返回 (feasibility, reason)。纯程序规则，不调用模型。"""
    text = " ".join([
        task.get("title", ""), task.get("description", ""), task.get("action", "")
    ]).lower()

    # 1. 安全阻断（最高优先级）
    for pattern in HIGH_RISK_PATTERNS:
        if pattern in text:
            return ("blocked_security",
                    f"任务操作命中高风险模式「{pattern}」，需人工审查后方可执行")

    # 2. 材料存在性
    material_names = {m.source_name.lower() for m in materials}
    required = task.get("required_materials", []) or []
    missing_materials = [r for r in required
                         if r.lower() not in material_names
                         and not any(r.lower() in n for n in material_names)]
    if missing_materials:
        return ("missing_material",
                f"任务所需材料当前项目中未找到：{', '.join(missing_materials[:3])}。"
                "注意：这仅表示当前材料库缺少记录，不代表该材料不存在。")

    # 3. 依赖可验证性（根据事实中是否存在相应字段）
    fact_keys = {str(f.get("field_key", "")).lower() for f in available_facts}
    action = task.get("action", "")
    if any(k in action for k in ("train", "训练", "run ", "执行训练")):
        has_lr = any("learning_rate" in k or k == "lr" for k in fact_keys)
        has_bs = any("batch_size" in k for k in fact_keys)
        if not has_lr or not has_bs:
            missing = []
            if not has_lr:
                missing.append("学习率")
            if not has_bs:
                missing.append("Batch Size")
            return ("missing_configuration",
                    f"执行类任务缺少关键配置事实：{', '.join(missing)}。"
                    "材料未记录不等于研究者未设置，需人工核实。")

    # 4. 数据集检查
    if any(k in text for k in ("dataset", "数据集")) and not material_names:
        return ("missing_material", "当前项目无材料记录，数据集来源无法从材料核实")

    # 5. 人工确认
    if task.get("needs_human_confirm", True):
        return ("needs_human_review", "任务标记为需要人工确认后才能执行")

    # 6. 具备条件
    return ("ready", "材料与配置条件满足，可进入执行队列")
