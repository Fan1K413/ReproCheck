"""供应商注册表（官方 API 文档核实，见 docs/STAGE11_INTERFACES.md）。

原则：只登记官方公开端点；不猜测地址；不声称未联调的供应商"已连接成功"。
新增/变更供应商只改本文件，适配器按 protocol 路由。
"""
from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from app.modelhub.adapters import AnthropicAdapter, GeminiAdapter, OpenAICompatibleAdapter, adapter_for
from app.modelhub.base import ModelAdapter
from app.modelhub.capabilities import Capability


@dataclass(frozen=True)
class ProviderSpec:
    key: str
    name: str
    protocol: str                       # openai_compatible | anthropic_messages | gemini_generate
    default_base_url: str               # 自定义供应商为空
    capabilities: frozenset[Capability]
    default_models: tuple[str, ...] = ()
    docs_url: str = ""
    notes: str = ""
    requires_custom_url: bool = False


_COMMON_OPENAI = frozenset({
    Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
    Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
    Capability.LONG_CONTEXT,
})

PROVIDERS: tuple[ProviderSpec, ...] = (
    ProviderSpec("qwen", "阿里云百炼 / 通义千问", "openai_compatible",
                 "https://dashscope.aliyuncs.com/compatible-mode/v1",
                 _COMMON_OPENAI | frozenset({Capability.MULTIMODAL}),
                 ("qwen-plus", "qwen-max", "qwen-long"),
                 "https://help.aliyun.com/zh/model-studio/getting-started",
                 "兼容模式；官方端点已核实"),
    ProviderSpec("deepseek", "DeepSeek", "openai_compatible",
                 "https://api.deepseek.com", _COMMON_OPENAI,
                 ("deepseek-flash", "deepseek-v4-pro"),
                 "https://api-docs.deepseek.com/guides/openai_api",
                 "官方 OpenAI 兼容端点已核实；支持 thinking/reasoning_effort 扩展"),
    ProviderSpec("zhipu", "智谱 AI (GLM)", "openai_compatible",
                 "https://open.bigmodel.cn/api/paas/v4", _COMMON_OPENAI,
                 ("glm-4-plus", "glm-4-air", "glm-4-flash"),
                 "https://open.bigmodel.cn/dev/api", "官方 v4 chat/completions 已核实"),
    ProviderSpec("moonshot", "月之暗面 Kimi", "openai_compatible",
                 "https://api.moonshot.cn/v1", _COMMON_OPENAI | frozenset({Capability.MULTIMODAL}),
                 ("kimi-k3", "kimi-k2.6"),
                 "https://platform.moonshot.cn/docs/api/overview",
                 "官方 OpenAI 兼容端点已核实；另有 Anthropic 兼容端点"),
    ProviderSpec("volcengine", "火山引擎 / 豆包", "openai_compatible",
                 "https://ark.cn-beijing.volces.com/api/v3", _COMMON_OPENAI,
                 ("doubao-pro-32k", "doubao-seed"),
                 "https://www.volcengine.com/docs/82379/1330310",
                 "方舟 Ark OpenAI 兼容端点；模型常用推理接入点 ID"),
    ProviderSpec("hunyuan", "腾讯混元", "openai_compatible",
                 "https://api.hunyuan.cloud.tencent.com/v1", _COMMON_OPENAI,
                 ("hy4", "hunyuan-turbos-latest"),
                 "https://cloud.tencent.com/document/product/1729/111007",
                 "官方 OpenAI 兼容端点已核实；旧控制台接口已预下线"),
    ProviderSpec("openai", "OpenAI", "openai_compatible",
                 "https://api.openai.com/v1", _COMMON_OPENAI | frozenset({Capability.MULTIMODAL}),
                 ("gpt-4o-mini", "gpt-4o"),
                 "https://platform.openai.com/docs/api-reference", "官方端点"),
    ProviderSpec("anthropic", "Anthropic Claude", "anthropic_messages",
                 "https://api.anthropic.com/v1",
                 frozenset({Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
                            Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
                            Capability.LONG_CONTEXT}),
                 ("claude-sonnet-4-5", "claude-haiku-4-5"),
                 "https://docs.anthropic.com/en/api/messages",
                 "原生 Messages API；x-api-key + anthropic-version 头"),
    ProviderSpec("gemini", "Google Gemini", "gemini_generate",
                 "https://generativelanguage.googleapis.com/v1beta",
                 frozenset({Capability.TEXT, Capability.STREAM, Capability.JSON_SCHEMA,
                            Capability.TOOLS, Capability.MODEL_LIST, Capability.HEALTH,
                            Capability.MULTIMODAL, Capability.LONG_CONTEXT}),
                 ("gemini-2.5-flash", "gemini-2.5-pro"),
                 "https://ai.google.dev/gemini-api/docs",
                 "原生 generateContent；x-goog-api-key 头"),
    ProviderSpec("openai_compatible", "自定义 OpenAI 兼容接口", "openai_compatible",
                 "", _COMMON_OPENAI, (),
                 "https://platform.openai.com/docs/api-reference",
                 "用户自填 Base URL；强制 SSRF 校验"),
)

_BY_KEY = {p.key: p for p in PROVIDERS}


def get_provider(key: str) -> ProviderSpec | None:
    return _BY_KEY.get(key)


def list_providers() -> list[dict]:
    return [{
        "key": p.key,
        "name": p.name,
        "protocol": p.protocol,
        "default_base_url": p.default_base_url,
        "capabilities": sorted(str(c) for c in p.capabilities),
        "default_models": list(p.default_models),
        "docs_url": p.docs_url,
        "notes": p.notes,
        "requires_custom_url": p.requires_custom_url,
        "builtin": p.key != "openai_compatible",
        "real_api_tested": False,   # 是否已完成真实 API 联调
    } for p in PROVIDERS]


def build_adapter(provider_key: str, base_url: str, api_key: str,
                  client: httpx.AsyncClient | None = None) -> ModelAdapter:
    spec = _BY_KEY.get(provider_key)
    if spec is None:
        raise ValueError(f"未知供应商：{provider_key}")
    if spec.protocol == "anthropic_messages":
        return AnthropicAdapter(base_url=base_url, api_key=api_key, client=client)
    if spec.protocol == "gemini_generate":
        return GeminiAdapter(base_url=base_url, api_key=api_key, client=client)
    adapter = adapter_for(provider_key, base_url, api_key, client)
    return adapter
