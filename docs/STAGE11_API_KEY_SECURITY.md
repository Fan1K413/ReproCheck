# 交付 4：API Key 安全存储设计（第十一阶段）

## 1. 生命周期

```
浏览器 password 输入框（组件内存，提交后立即清空）
   → HTTPS 请求体（Authorization: Bearer 登录令牌）
   → 授权后端校验登录用户 + 归属隔离
   → SSRF 校验（自定义 URL）
   → Fernet / WebCrypto 加密
   → 数据库只存 ciphertext + 脱敏 key_hint
   → 调用时在服务端内存解密，使用后立即释放
```

## 2. 强制规则（已实现）

- 前端不硬编码 Key；不写 LocalStorage / SessionStorage；提交后输入框清空。
- 列表/详情 API 只返回 `id / provider_key / name / key_hint / base_url / status / has_key`，**无密文列**。
- 日志、错误响应、异常堆栈均不回显 Key；`redact_secrets()` 兜底清理。
- 支持撤销（status=revoked，调用时拒绝）与彻底删除（purge）。
- 所有凭据查询强制 `owner_user_id == current_user.id`；跨用户访问返回 404。
- 连接测试失败返回的是**状态码 + 规范化错误码**，不回显供应商原始错误体（可能含敏感信息）。

## 3. 加密密钥分离

| 部署 | 加密方式 | 密钥来源 | 与数据库分离 |
|---|---|---|---|
| 本地版 | Fernet（cryptography） | `MODEL_CREDENTIAL_KEY`（独立 Fernet key 或强口令；口令经 SHA-256 派生） | 是，环境变量/.env，不入库 |
| Site 版 | WebCrypto Fernet 兼容（AES-CBC + HMAC） | `APP_MODEL_KEY`（Sites → Settings → Secrets）；缺失时回落 `APP_JWT_SECRET` | 是，Deno.env，不入库 |

`MODEL_CREDENTIAL_KEY` 缺失时拒绝创建凭据（`ENCRYPTION_UNAVAILABLE` 503），不降级为明文。
Site 版回落到 `APP_JWT_SECRET` 属于安全隔离弱化，部署文档必须说明；建议单独配置 `APP_MODEL_KEY`。

## 4. SSRF 防护

本地版 `validate_base_url()`：
- 仅 HTTPS（`ALLOW_LOCAL_MODEL_ENDPOINT=true` 才允许 `http://localhost`，生产禁止）；
- 禁止 userinfo / query / fragment / 路径穿越；
- 解析全部 DNS A/AAAA 记录，拒绝私网、环回、链路本地、CGNAT、保留网段、云元数据域名；
- `httpx` 设 `follow_redirects=False`，重定向视为失败。

Site 版：Edge Function 无法做 DNS 解析，只能拦截字面私网地址/元数据域名并要求 HTTPS；
其余依赖平台出站网络策略。**这是明确的能力边界，不冒充本地版同等强度。**

两版都不允许自定义地址指向任意管理路径：URL 路径由适配器固定构造（`/chat/completions`、`/models` 等），
用户只能提供根 Base URL。

## 5. 审计与验证证据

- `test_modelhub.py::test_credential_encryption_masking_and_missing_key`：密文不含明文、脱敏、缺密钥拒绝。
- `test_modelhub.py::test_ssrf_blocks_private_metadata_and_userinfo`：私网、元数据、HTTP、userinfo 均被拒。
- `test_modelhub.py::test_api_credentials_are_masked_isolated_and_revocable`：API 响应无密文、跨用户 404、撤销生效。
- Site 桥接实测：创建凭据后列表仅返回 `key_hint`，`contains_plain=False`（见浏览器/桥接记录）。

## 6. 限制声明

- 本环境没有 KMS/HSM，也没有经认证的密钥轮换服务；采用"独立环境变量 + 加密存储"的替代方案。
- 加密密钥本身由部署方保管；若密钥丢失，已存密文无法恢复（这是安全特性，不是缺陷）。
- 不宣称通过了任何第三方安全认证或渗透测试。
