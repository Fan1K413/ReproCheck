# 安全说明

## 密钥管理

1. **API Key 仅后端读取**：从环境变量 / 后端 `.env` 读取，无前端环境变量、无 localStorage、无浏览器缓存。
2. **不入库 Git**：`.gitignore` 排除 `.env`、`*.db` 等；仓库只保留 `.env.example`（空值/占位符）。
3. **不进日志**：`app/core/logging.py` 对含 `api_key/authorization/token/secret/password` 的字段做脱敏；日志只记录事件类型与请求 ID。
4. **不进错误/响应**：异常 message 为固定中文提示，不含密钥；`/llm/status` 只返回 `api_key_configured` 布尔值。
5. **不在提示词/README 泄露**：连接测试提示词为固定文本，不含真实 Key。

## 访问控制

- `POST /llm/test`、`POST /demo/audit` 会真实消耗额度。配置 `ADMIN_TOKEN` 后必须携带请求头 `X-Admin-Token`。
- 未配置令牌时由 `ALLOW_UNAUTH_TEST_ENDPOINTS` 控制；生产环境应设为 false 并配置令牌。
- 请求体大小限制 1MB（`max_request_bytes`）。

## 模型输出安全

- 严格 Pydantic 校验，格式不符只做一次修复请求，仍失败明确报错。
- **证据防伪造**：模型引用的 chunk_id 必须来自本次实际提供的集合；证据原文从后端材料读取，不使用模型生成的引用文本。
- 冲突判断由程序完成，不让模型直接下结论。

## 代码执行

- 不实现、不允许运行用户上传的代码。
- 不自动解压执行 ZIP。
- 第一阶段只处理文本材料。

## 环境隔离

- 测试环境与正式环境的密钥必须分离（各自 `.env` / 服务器 Secrets）。
- `.env.example` 只提供空值模板。

## 部署建议

- 生产：设置 `ADMIN_TOKEN`、收敛 CORS `allow_origins` 到前端域名、用 HTTPS、用服务器 Secret 管理密钥。
- 不要把 `.env` 或数据库文件放进前端 `dist/`。
