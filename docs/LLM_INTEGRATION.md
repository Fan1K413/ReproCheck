# LLM 集成说明

## 统一适配层

`app/llm/LLMService` 提供：

- `async chat(messages, response_schema=None, max_tokens=None)`：统一调用入口
- `async test_connection()`：连接测试，要求模型只回复指定内容

协议：OpenAI 兼容 `POST {LLM_BASE_URL}/chat/completions`。默认 qwen 兼容模式，任何 OpenAI 格式服务都可通过环境变量接入。

## 环境变量

见项目根目录 `.env.example`。关键项：

```env
LLM_PROVIDER=qwen
LLM_API_KEY=            # 真实 Key，仅后端读取，自行填入 .env
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_MODEL=qwen-plus
LLM_TIMEOUT=60
LLM_MAX_RETRIES=1
```

## 可靠性机制

| 机制 | 说明 |
|---|---|
| 超时 | `httpx.Timeout(LLM_TIMEOUT)`，超时抛 `LLM_TIMEOUT` |
| 鉴权失败 | 401/403 → `LLM_INVALID_KEY`，不重试 |
| 限流 | 429 → `LLM_RATE_LIMITED` |
| 网络异常 | `httpx.HTTPError` → `LLM_NETWORK_ERROR` |
| 5xx | → `LLM_PROVIDER_ERROR` |
| 重试限制 | 仅对"输出格式不符"做 1 次修复请求；网络/鉴权/限流不重试 |
| 请求 ID | 每次调用生成 `rc-xxx`，贯穿日志与响应 |
| Token 统计 | 从 `usage` 读取 prompt/completion/total |
| 真实模型名 | 从响应 `model` 读取并记录 |
| 结构化校验 | `response_schema` 经 Pydantic v2 校验 |
| JSON 修复 | 格式不符时回传校验错误请求一次；仍失败抛 `LLM_INVALID_FORMAT`，绝不虚构字段 |
| chunk_id 校验 | 模型引用的证据块必须来自本次提供的集合，否则 `EVIDENCE_VALIDATION_FAILED` |

## 安全

- 密钥只从后端环境变量读取，前端无 `VITE_*_KEY`。
- 日志、错误、接口响应均不回显密钥（见 SECURITY.md）。
- 连接测试与审计接口支持 `X-Admin-Token` 防止额度滥用。

## 当前环境的真实连通性结论

探测环境发现一个 `sk-` 开头的环境变量密钥，但对 OpenAI、通义千问、DeepSeek、月之暗面、智谱的兼容端点**全部返回 401（失效占位密钥）**；OpenAI 官方端点另被本地代理 502 拦截。因此：

- **真实 API 调用测试状态：待配置真实密钥**。
- 填好真实 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 后，连接测试与审计链路即可真实调用，无需改代码。
- 程序逻辑正确性已用协议级 mock（httpx.MockTransport）覆盖，见 TEST_REPORT.md。
