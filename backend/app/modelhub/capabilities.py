"""能力矩阵：接口方法存在 ≠ 供应商支持。业务调用前必须检查能力。

设计：能力是"声明式"的，来自 provider registry；适配器在不支持时抛 CAPABILITY_UNSUPPORTED，
并在 details 中给出明确原因（绝不静默降级、绝不假装成功）。
"""
from __future__ import annotations

from enum import StrEnum


class Capability(StrEnum):
    TEXT = "text"                       # 普通文本生成
    STREAM = "stream"                   # 流式输出（SSE）
    JSON_SCHEMA = "json_schema"         # 结构化 JSON 输出（response_format / schema）
    TOOLS = "tools"                     # 工具 / function calling
    MULTIMODAL = "multimodal"           # 多模态输入（图片等）
    MODEL_LIST = "model_list"           # 服务端模型列表
    HEALTH = "health"                   # 健康检查（轻量调用）
    LONG_CONTEXT = "long_context"       # 长上下文（>32k）

    @staticmethod
    def all() -> frozenset["Capability"]:
        return frozenset(Capability)


CAPABILITY_LABELS: dict[Capability, str] = {
    Capability.TEXT: "文本生成",
    Capability.STREAM: "流式输出",
    Capability.JSON_SCHEMA: "结构化 JSON",
    Capability.TOOLS: "工具调用",
    Capability.MULTIMODAL: "多模态输入",
    Capability.MODEL_LIST: "模型列表",
    Capability.HEALTH: "健康检查",
    Capability.LONG_CONTEXT: "长上下文",
}
