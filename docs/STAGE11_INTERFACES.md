# 第十一阶段 · 接口与数据设计（先定契约，再并行实现）

## 1. 设计原则

1. 业务代码不依赖任何厂商 SDK；统一走 `ModelGateway`。
2. Provider（供应商定义）、Model（可用模型）、Credential（用户凭据）、ModelProfile（参数配置）、
   TaskModelBinding（任务绑定）、ModelCallLog（调用记录）、ModelHealth（健康状态）**七类实体分离**。
3. 能力矩阵驱动：接口方法存在 ≠ 所有供应商支持；不支持时返回 `CAPABILITY_UNSUPPORTED` + 明确原因。
4. API Key 只经授权后端传输；加密密钥与数据库分离；列表/详情接口只返回脱敏信息。
5. 兼容旧行为：未配置用户模型时，网关透明回落到既有 `LLMService`（环境变量），保证 219 项测试不回归。

## 2. 统一接口（`app/modelhub/base.py`）

```python
class Capability(StrEnum):
    TEXT = "text"
    STREAM = "stream"
    JSON_SCHEMA = "json_schema"
    TOOLS = "tools"
    MULTIMODAL = "multimodal"
    MODEL_LIST = "model_list"
    HEALTH = "health"

@dataclass
class ModelRequest:
    model: str
    messages: list[dict]           # OpenAI 风格消息；多模态时 content 可为 list
    temperature: float = 0.0
    max_tokens: int | None = None
    response_format: dict | None = None
    tools: list[dict] | None = None
    stream: bool = False
    extra: dict | None = None      # 用户自定义参数（仅白名单键）

@dataclass
class ModelResponse:
    content: str
    model: str                     # 响应中的真实模型名
    usage: TokenUsage
    duration_ms: int
    request_id: str
    provider: str
    raw: dict | None = None
    tool_calls: list[dict] | None = None

class ModelAdapter(ABC):
    provider_key: str
    capabilities: frozenset[Capability]
    async def chat(req: ModelRequest) -> ModelResponse
    async def chat_stream(req: ModelRequest) -> AsyncIterator[str]   # 默认抛不支持
    async def list_models() -> list[dict]                            # 默认抛不支持
    async def health() -> dict                                       # 默认基于轻量 chat
```

错误标准化沿用 `AppError` 码表，新增：
`CAPABILITY_UNSUPPORTED`(422)、`CREDENTIAL_NOT_FOUND`(404)、`CREDENTIAL_REVOKED`(410)、
`SSRF_BLOCKED`(422)、`MODEL_NOT_FOUND`(404)、`MODEL_DISABLED`(403)、
`ENCRYPTION_UNAVAILABLE`(503)、`ROUTE_DISABLED`(403)。

## 3. 供应商注册表（`app/modelhub/registry.py`，官方文档核实）

| key | 协议 | 官方 Base URL | 模型示例 |
|---|---|---|---|
| `qwen` | openai_compatible | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus |
| `deepseek` | openai_compatible | `https://api.deepseek.com` | deepseek-flash / deepseek-v4-pro |
| `zhipu` | openai_compatible | `https://open.bigmodel.cn/api/paas/v4` | glm-4-plus |
| `moonshot` | openai_compatible | `https://api.moonshot.cn/v1` | kimi-k3 |
| `volcengine` | openai_compatible | `https://ark.cn-beijing.volces.com/api/v3` | 端点 ID / doubao-* |
| `hunyuan` | openai_compatible | `https://api.hunyuan.cloud.tencent.com/v1` | hy4 / hunyuan-turbos-latest |
| `openai` | openai_compatible | `https://api.openai.com/v1` | gpt-* |
| `anthropic` | anthropic_messages | `https://api.anthropic.com/v1` | claude-* |
| `gemini` | gemini_generate | `https://generativelanguage.googleapis.com/v1beta` | gemini-* |
| `openai_compatible` | openai_compatible | 用户填写（必填，SSRF 校验） | 用户填写 |

> 官方来源已在会话中实际检索核实：DeepSeek api-docs.deepseek.com、智谱 open.bigmodel.cn/dev/api、
> Kimi platform.moonshot.cn/docs/api/overview、腾讯云 cloud.tencent.com/document/product/1729/111007、
> Google generativelanguage.googleapis.com/$discovery/rest。
> 未取得任何厂商真实 API Key：**适配层可测，真实联调状态一律标记"未联调"**。

## 4. 数据库新表（7 张，全部新增，不改既有 53 表）

| 表 | 关键列 | 说明 |
|---|---|---|
| `model_providers` | id, key, name, protocol, default_base_url, is_builtin, enabled, capabilities_json | 供应商定义，内置项不可删除 |
| `model_credentials` | id, owner_user_id, org_id, provider_key, name, key_ciphertext, key_hint, base_url, status, last_error_code | **密文**；API 永不返回 key_ciphertext |
| `model_profiles` | id, owner_user_id, org_id, provider_key, model_id, display_name, params_json, timeout_s, max_retries, max_tokens, enabled, is_default, is_fallback | 模型参数配置 |
| `task_model_bindings` | id, owner_user_id, org_id, project_id(nullable), task_key, primary_profile_id, fallback_profile_id, params_json, auto_route, cost_preference, enabled | 任务→模型绑定；项目级可覆盖用户级 |
| `model_call_logs` | id, request_id, owner_user_id, org_id, task_key, provider_key, model_id, success, error_code, prompt_tokens, completion_tokens, duration_ms, fallback_reason, created_at | 只记元数据，不记 Prompt/Key |
| `model_health` | provider_key, model_id, status, last_checked_at, last_error_code, latency_ms | 连接健康状态 |
| `model_routes` | id, owner_user_id, task_key, rule_json, enabled, created_at | 智能路由决策记录（含选择原因） |

- 所有表带 `owner_user_id` / `org_id`，查询强制按 `current_user` 过滤；平台管理员可查看全量统计但不可读他人密文。
- 加密：`MODEL_CREDENTIAL_KEY`（Fernet key，独立环境变量）→ 缺失时拒绝创建凭据并返回 `ENCRYPTION_UNAVAILABLE`；**不从数据库或 JWT 派生**。

## 5. 任务键（TaskModelBinding.task_key）

| key | 用途 | 结构化 | 长上下文 | 多模态 | 工具调用 |
|---|---|---|---|---|---|
| `pdf_extraction` | PDF 论文解析/事实抽取 | ✓ | ✓ | — | — |
| `fact_extraction` | 通用科研事实抽取 | ✓ | ✓ | — | — |
| `diff_analysis` | 论文与代码差异分析 | ✓ | ✓ | — | — |
| `failure_diagnosis` | 失败原因分析 | ✓ | — | — | — |
| `rag_qa` | RAG 问答 | — | ✓ | — | — |
| `report_generation` | 报告生成 | — | ✓ | — | — |
| `summary` | 科研材料总结 | — | ✓ | — | — |

> demo_audit / planning 沿用 `diff_analysis` / `report_generation` 的绑定，避免任务键无限膨胀。

## 6. 网关调用流程（`app/modelhub/gateway.py`）

```
chat(task_key, messages, response_schema, max_tokens, user_id=None)
  1. 解析绑定：项目级 → 用户级 → 系统默认 → 回落 LLMService(env)
  2. 校验 profile.enabled / credential.status / 能力矩阵（JSON_SCHEMA 等）
  3. 解密凭据（内存中使用，绝不落日志）
  4. 调用 adapter.chat()；失败按 fallback_profile_id 切换，记录 fallback_reason
  5. 结构化 schema 校验（沿用一次修复请求，最多 2 次调用）
  6. 写 model_call_logs（元数据）
  7. 返回与 LLMService.chat 兼容的 LLMResponse
```

- 自动路由默认**关闭**；开启时按能力矩阵 + 上下文长度 + 成本偏好选择，记录原因；**不切换到未授权供应商**。
- 成本数据若供应商未提供，标记 `estimate_unavailable`，不编造费用。

## 7. SSRF 防护（`app/modelhub/security.py`）

- 仅允许 `https`（本地回环显式 `ALLOW_LOCAL_MODEL_ENDPOINT=true` 才允许 `http://localhost`）。
- 拒绝 userinfo；拒绝非标准端口白名单外的端口？→ 不限制端口，但禁止私网/环回/链路本地/保留网段。
- 解析 DNS 后检查**所有** A/AAAA 记录：`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、
  `::1`、`fc00::/7`、`fe80::/10`、`0.0.0.0/8`、`100.64/10`、`198.18/15`、云元数据域名。
- `httpx` 设置 `follow_redirects=False`；重定向视为失败（`SSRF_BLOCKED`）。
- 禁止把自定义地址用于非 `/chat/completions`、`/models` 等已知路径（路径白名单由适配器构造，不接受用户路径）。

## 8. API 契约（prefix `/api/v1`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/model-providers` | 供应商 + 能力矩阵（无需 Key） |
| GET/POST/PATCH/DELETE | `/model-credentials` / `/{id}` | 凭据（创建/更新只回显脱敏） |
| POST | `/model-credentials/{id}/test` | **真实调用**目标 API，返回细分状态 |
| GET/POST/PATCH/DELETE | `/model-profiles` / `/{id}` | 模型配置 |
| POST | `/model-profiles/{id}/test` | 真实调用测试 |
| GET/PUT/DELETE | `/task-model-bindings` | 任务绑定（用户级/项目级） |
| GET | `/model-call-logs` | 调用记录（分页） |
| GET | `/model-stats` | 调用统计（次数/成功率/Token/P95/分组） |
| GET | `/model-health` | 连接健康 |
| GET | `/model-routes` | 路由决策记录 |
| GET | `/model-capabilities` | 能力矩阵 + 任务推荐 |

## 9. 本地版 / Site 版一致性矩阵

| 能力 | 本地版 | Site 版 |
|---|---|---|
| 模型管理 UI | ✓（同一 SPA 页面） | ✓（同一 SPA 页面） |
| 凭据加密存储 | Fernet + `MODEL_CREDENTIAL_KEY` | WebCrypto AES-GCM + `APP_MODEL_KEY`（服务端 Secret） |
| 真实连接测试 | ✓ | ✓（Edge Function 出站 fetch，受平台网络策略约束） |
| 项目级绑定 | ✓ | ✓ |
| 沙箱/执行 | ✓（默认关） | ✗（明确标注） |
| 密钥不落浏览器 | ✓ | ✓ |

两版共用同一套前端类型与 API 路径；Site 版在 `functions/domain_models.ts` 实现同一契约。
