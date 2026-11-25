"""统一模型适配器集合。业务只依赖 ModelAdapter 抽象。"""
from app.modelhub.adapters.anthropic import AnthropicAdapter
from app.modelhub.adapters.gemini import GeminiAdapter
from app.modelhub.adapters.openai_compatible import OpenAICompatibleAdapter, adapter_for

__all__ = ["AnthropicAdapter", "GeminiAdapter", "OpenAICompatibleAdapter", "adapter_for"]
