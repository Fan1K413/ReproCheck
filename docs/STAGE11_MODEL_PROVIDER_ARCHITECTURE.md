# 交付 1：多模型供应商架构设计文档（第十一阶段）

## 1. 目标与边界

把"业务服务 → 单一 `LLMService` → 千问端点"改造为"业务任务 → `ModelGateway` → 统一适配器 → 官方 API"，
同时保证历史环境变量配置零回归。

## 2. 分层

```
app/api/v1/modelhub.py         API 管理中心（用户鉴权、脱敏视图）
app/services/*  (5 处)         业务任务 → TaskLLM(db, task_key)
app/modelhub/bridge.py         同签名桥接，兼容既有 mock 注入
app/modelhub/gateway.py        绑定解析 / 凭据解密 / 能力校验 / 备用切换 / 日志
app/modelhub/adapters/*        OpenAI 兼容 / Anthropic Messages / Gemini generateContent
app/modelhub/registry.py       10 家供应商官方端点与能力矩阵
app/modelhub/security.py       Fernet 加密、脱敏、SSRF 防护
app/models/modelhub.py         7 张新表（不改原 53 表）
```

## 3. 七类实体

Provider（供应商）/ Model（模型 ID）/ Credential（用户加密凭据）/ ModelProfile（参数与超时）/
TaskModelBinding（任务绑定）/ ModelCallLog（调用元数据）/ ModelHealth + ModelRoute（健康与路由决策）。
定义与字段见 `STAGE11_INTERFACES.md`。

## 4. 统一接口与能力矩阵

`ModelAdapter.chat/chat_stream/list_models/health`；接口存在不代表供应商支持。
不支持时抛 `CAPABILITY_UNSUPPORTED` 并返回 `details.reason`，绝不模拟。
能力枚举：text / stream / json_schema / tools / multimodal / model_list / health / long_context。

## 5. 结构化输出与可靠性

- 沿用既有 Pydantic `extra="forbid"` 严格校验；`response_format={"type":"json_object"}` 仅在能力矩阵声明支持时下发。
- 格式不符最多一次修复请求；仍失败抛 `LLM_INVALID_FORMAT`，不填充虚构字段。
- 网络/鉴权/限流/超时映射为既有规范化错误码；仅 429/5xx/网络抖动重试，401 不重试。
- Token 用量、请求 ID、耗时、真实响应模型名写入调用记录；`cost_estimate=unavailable`（无真实价格数据，不编造）。

## 6. 已接入的业务任务

| 任务键 | 原调用点 | 现状 |
|---|---|---|
| pdf_extraction / fact_extraction | `extraction_service.py` | 按材料类型动态选择 |
| diff_analysis | `audit_service.py`（演示审计） | 已切换 |
| report_generation | `reproduction/planner.py` | 已切换，保留匿名 503 语义 |
| failure_diagnosis | `reproduction/diagnostics.py` | 已切换，保留匿名 503 语义 |
| rag_qa | `rag_service.py` | 已切换（有用户上下文走网关） |

未配置用户绑定的任务透明回落 `LLMService`（环境变量），这是 219 项历史测试保持通过的机制。

## 7. 自动路由（可选，默认关闭）

只在用户显式开启后生效；候选模型限定为**当前用户自己配置**的 profile；记录 `model_routes` 选择与原因。
不切换到未授权供应商；低成本模型输出不自动视为高可信事实；模型推断不写入已验证事实。

## 8. 未联调声明

适配层端点均来自官方 API 文档并已实际检索核实；**本环境未取得任何厂商真实 API Key**。
全部供应商测试使用 `httpx.MockTransport` 在协议层模拟，报告只能写"适配层测试通过"，不能写"真实联调通过"。
用户保存自己的 Key 后，连接测试会真实调用目标 API 并返回细分状态。
