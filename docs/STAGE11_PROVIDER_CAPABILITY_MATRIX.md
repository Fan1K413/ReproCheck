# 交付 3：供应商适配能力矩阵（第十一阶段）

> 端点来源：官方 API 文档，已实际检索核实。真实联调：**全部未进行**（无授权真实 Key）。
> 测试性质：httpx.MockTransport / Edge fetch 模拟，仅证明协议实现正确。

| 供应商 | key | 协议 | 官方 Base URL | 文本 | 流式 | JSON | 工具 | 多模态 | 模型列表 | 长上下文 |
|---|---|---|---|---|---|---|---|---|---|---|
| 阿里云百炼 / 通义千问 | qwen | OpenAI 兼容 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| DeepSeek | deepseek | OpenAI 兼容 | `https://api.deepseek.com` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| 智谱 AI | zhipu | OpenAI 兼容 | `https://open.bigmodel.cn/api/paas/v4` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| 月之暗面 Kimi | moonshot | OpenAI 兼容 | `https://api.moonshot.cn/v1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 火山引擎 / 豆包 | volcengine | OpenAI 兼容 | `https://ark.cn-beijing.volces.com/api/v3` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| 腾讯混元 | hunyuan | OpenAI 兼容 | `https://api.hunyuan.cloud.tencent.com/v1` | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ |
| OpenAI | openai | OpenAI 兼容 | `https://api.openai.com/v1` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Anthropic Claude | anthropic | 原生 Messages | `https://api.anthropic.com/v1` | ✓ | ✓ | 约束式 | ✓ | — | ✓ | ✓ |
| Google Gemini | gemini | 原生 generateContent | `https://generativelanguage.googleapis.com/v1beta` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 自定义兼容接口 | openai_compatible | OpenAI 兼容 | 用户填写 | ✓ | ✓ | ✓ | ✓ | 视实现 | ✓ | 视实现 |

## 能力说明

- **JSON**：Anthropic 无 `response_format`，适配器通过系统指令约束，网关仍做 Pydantic 严格校验；
  不能把"约束式 JSON"误写为原生 JSON schema。
- **多模态**：矩阵标记为供应商声明支持；当前 ReproCheck 业务任务（PDF 等）仍由确定性解析器先转文本，
  尚未向模型发送图片，因此"支持多模态"不等于"业务已使用多模态"。
- **工具调用**：适配器具备 `tools` 透传能力；当前业务任务未使用工具调用，DAG/可行性仍由程序校验。
- **长上下文**：代码采用有界截断策略，不依赖超大上下文；标记为上下文窗口较大，不代表已实测超长输入。

## 厂商专属参数

统一适配器只下发通用字段。DeepSeek 的 `thinking`/`reasoning_effort`、Kimi 的 `partial` 等专属参数
可通过 ModelProfile 的 `params.extra` 白名单透传，但默认不启用，且不会写死在业务代码里。

## 变更维护

新增/变更供应商只改 `app/modelhub/registry.py`；Site 版同步改 `frontend/functions/domain_models.ts` 的 PROVIDERS 与协议分派。
两端契约路径相同，UI 不需要改动。
