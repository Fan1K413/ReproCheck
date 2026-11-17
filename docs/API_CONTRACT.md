# API 契约（v1）

Base：`/api/v1`

所有响应统一结构：

```json
{
  "success": true,
  "data": { ... },
  "error": null,
  "request_id": "req-xxxxxxxxxxxx"
}
```

失败时：

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "LLM_INVALID_KEY",
    "message": "API Key 无效或已过期，请检查后端 LLM_API_KEY。",
    "details": null
  },
  "request_id": "req-xxxxxxxxxxxx"
}
```

## 错误码与 HTTP 状态

| code | HTTP | 含义 |
|---|---|---|
| VALIDATION_ERROR | 422/413 | 参数错误 / 请求体过大 |
| NOT_FOUND | 404 | 资源不存在 |
| LLM_KEY_NOT_CONFIGURED | 503 | 尚未配置 API Key |
| LLM_INVALID_KEY | 401 | API Key 无效 |
| LLM_NETWORK_ERROR | 502 | 网络连接失败 |
| LLM_TIMEOUT | 504 | 模型服务超时 |
| LLM_RATE_LIMITED | 429 | 模型服务限流 |
| LLM_INVALID_FORMAT | 502 | 模型返回格式异常（含修复失败） |
| LLM_PROVIDER_ERROR | 502 | 模型服务其他错误 |
| EVIDENCE_VALIDATION_FAILED | 422 | 证据验证失败（虚构 chunk_id） |
| DB_SAVE_FAILED | 500 | 数据库保存失败 |
| FORBIDDEN | 403 | 未通过访问控制 |
| INTERNAL_ERROR | 500 | 未预期错误 |

**任何失败都不会被包装为审计成功**——`data` 为 null，`success` 为 false。

## 接口清单

### GET /api/v1/health
健康检查。data: `{ status, version, timestamp }`

### GET /api/v1/llm/status
模型配置与最近调用状态（不含密钥明文）。data:
```json
{
  "provider": "qwen",
  "model": "qwen-plus",
  "api_key_configured": true,
  "connection_status": "unknown | ok | error",
  "last_call_at": null,
  "last_call_duration_ms": null,
  "last_call_success": null,
  "last_token_usage": null
}
```

### POST /api/v1/llm/test  🔒
真实调用模型，要求其只回复"ReproCheck API 连接成功"。data:
```json
{
  "success": true, "reply": "ReproCheck API 连接成功。",
  "model": "qwen-plus", "duration_ms": 820,
  "token_usage": { "prompt_tokens": 20, "completion_tokens": 8, "total_tokens": 28 },
  "tested_at": "2026-11-17T..."
}
```

### POST /api/v1/demo/audit  🔒
端到端审计。请求体：
```json
{
  "project_name": "演示",
  "use_default_materials": true,
  "material_a_text": null,
  "material_b_text": null
}
```
data: `{ run_id, status, materials, extracted_facts, comparisons, findings, llm_meta }`。
- `comparisons[].status` ∈ `conflict | consistent | missing`
- `findings[].evidence[]` 中 `original_text` 来自后端材料原文

### GET /api/v1/audit-runs/{run_id}
按 run_id 查询历史审计结果（data 结构同 demo/audit）。

### GET /api/v1/projects
data: `{ items: [{id,name,domain,paper_title,description,created_at}], total }`

### POST /api/v1/projects
请求体：`{ name, domain, paper_title, description }`，data 为创建的项目对象。

🔒 标注的接口在配置 `ADMIN_TOKEN` 后需在请求头带 `X-Admin-Token`。

Swagger 文档：`/docs`，OpenAPI JSON：`/openapi.json`。
