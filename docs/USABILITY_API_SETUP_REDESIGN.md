# API 配置重构：从技术墙到五步向导

日期：2026-11-24  
适用页面：`/settings/models?tab=setup`（个人 AI 连接）、`/settings/llm`（系统级状态与排错）  
核心约束：保留真实服务商、真实调用、真实模型配置；复杂项只折叠，不删除；不使用模拟成功。

## 1. 改造前的真实状态

旧版页面（`.screenshots/usability/models-1440.png`）同时展示：

- 供应商清单；
- 协议类型；
- 端点 / Base URL；
- 能力矩阵；
- 密钥管理；
- 模型配置；
- 默认模型；
- 按任务分配；
- 调用记录与用量。

对第一次配置的人，问题不是“信息不够”，而是**不知道第一步该做什么**：先选供应商？先填端点？先建密钥？先建模型？测试按钮在别处，错误信息是技术码。

旧版 `/settings/llm` 只有系统状态和“测试模型连接”，没有指向个人配置的清晰路径（`.screenshots/usability/llm-1440.png`）。

## 2. 五步向导

| 步 | 用户只回答一个问题 | 界面元素 | 真实动作 |
|---|---|---|---|
| 1 | 你用的是哪家 AI 服务？ | 11 张服务商卡：名称、常用模型数量、是否必须自填地址；附官方文档入口 | `GET /model-providers` |
| 2 | 把密钥粘贴进来 | 密码输入框；说明“只提交后端，浏览器不保存”；自建服务在此填地址 | 无网络请求，纯本地校验 |
| 3 | 使用哪个模型？ | 服务商默认模型按钮 + 手动模型名；高级设置默认折叠 | 无网络请求，准备参数 |
| 4 | 连接真的通吗？ | 配置摘要（服务商/模型/地址/密钥已填）、真实测试按钮 | `POST /model-credentials/test-draft` |
| 5 | 保存为默认助手 | 成功结果、延迟、返回预览、保存按钮 | `POST /model-setup`，凭据+模型配置同事务 |

### 关键交互规则

- **空密钥不能进入第 3 步**：第 2 步显示“请先粘贴 API 密钥…”，不发起网络请求。
- **空模型不能进入第 4 步**：第 3 步显示“请选择或填写模型名称”。
- **测试失败不能保存**：第 4 步只出现“重新测试”，不出现“保存为默认 AI 助手”。
- **失败可回退**：可以回第 3 步改模型，或回第 2 步改密钥；回退后测试结果清空，避免旧结果误保存。
- **高级设置不删除**：服务地址、超时、最大输出、温度都在“高级设置（通常不用改）”中；OpenAI 兼容服务在第 2 步直接要求填写服务地址。
- **系统页与个人页分开**：`/settings/llm` 只显示系统默认服务状态，不把系统密钥和个人密钥混在一起；主 CTA 指向个人五步向导。

## 3. 后端接口与安全边界

### `POST /api/v1/model-credentials/test-draft`

请求：`provider_key`、`api_key`、`model_id`、可选 `base_url`。

- 需要登录；
- 使用临时 `SimpleNamespace` 承载密钥，只在本次请求内存中存在；
- 不写入数据库、不写调用日志、不返回完整密钥；
- 调用与已保存凭据相同的模型网关；
- 返回 `status / provider / model / error_code / error_message / latency_ms / checked_at`；
- 即使服务端未配置 `MODEL_CREDENTIAL_KEY`，测试也能进行，因为测试不需要持久化加密。保存才需要该密钥。

### `POST /api/v1/model-setup`

请求：服务商、密钥、模型、显示名、可选地址/超时/最大输出/温度。

- 在同一个数据库事务中创建凭据与模型配置；
- 任一步失败整体 rollback，不留下“半个配置”；
- `key_ciphertext` 由 `MODEL_CREDENTIAL_KEY` 派生加密；列表只返回 `key_hint`，不回显明文；
- 不返回密钥；
- 如果服务端没有配置 `MODEL_CREDENTIAL_KEY`，返回 `ENCRYPTION_UNAVAILABLE`，前端显示可执行中文说明，而不是伪造保存成功。

## 4. 真实调用结果（本轮）

### 已验证的失败路径

- 时间：2026-11-24 20:14（UTC+8，重启后的 8000）
- 服务商：DeepSeek
- 模型：`deepseek-flash`
- 测试凭据：无效测试字符串（不是任何人的真实密钥）
- HTTP：200（业务结果在 envelope 内）
- 网关结果：`status=auth_failed`、`error_code=LLM_INVALID_KEY`、`latency_ms=139`
- 同时复验：在没有 `MODEL_CREDENTIAL_KEY` 的干净 8001 进程中，临时测试路径返回 `auth_failed`、`LLM_INVALID_KEY`、209ms，证明测试不再依赖持久化加密密钥。
- UI 结果：显示“密钥没有通过验证”，建议重新复制密钥/检查模型权限；技术详情折叠；保存按钮数量为 0。

证据：`.screenshots/usability/round2/14-api-final-no-key-real-failure-1440.png`、`usability-verify-final.json` 的 `final-api-no-key`。

### 未验证的成功路径

- 本机真实后端（8000）没有配置 `MODEL_CREDENTIAL_KEY`，无法完成“测试通过 → 保存成功”。
- 8000 与 8001 都已在不配置持久化密钥的进程中验证了“真实测试可发起”；但没有可用的真实服务商密钥，因此没有伪造“成功”。
- 结论：**临时测试能力已通过真实失败路径证明；成功保存链路仍待管理员配置密钥与真实有效密钥后验收。** 不得把失败路径写成“API 配置已完成”。

## 5. 错误翻译规则

| 后端状态 | 用户看到的标题 | 用户下一步 |
|---|---|---|
| `auth_failed` / `LLM_INVALID_KEY` | 密钥没有通过验证 | 重新复制，检查空格、模型权限 |
| `rate_limited` | 请求太频繁或额度用完了 | 稍后重试，检查额度/限流 |
| `timeout` | 服务商响应太慢 | 检查网络；高级设置中适当调大超时 |
| `network_error` | 连不上服务商 | 检查网络/代理/自建地址 |
| `incompatible_format` | 服务商返回格式不兼容 | 确认协议或换官方兼容接口 |
| `model_not_found` | 找不到这个模型 | 检查模型名/开放权限 |
| `capability_unsupported` | 这个模型不支持当前能力 | 换支持文本/对话的模型 |
| `ssrf_blocked` | 服务地址被安全策略拦截 | 必须是公网 http/https，不能内网/本机 |
| `provider_error` | 服务商返回了错误 | 展开技术详情，查权限/欠费/临时故障 |
| `ENCRYPTION_UNAVAILABLE` | 服务器没有配置模型凭据加密密钥 | 联系管理员配置 `MODEL_CREDENTIAL_KEY`；密钥没有被发送或写入 |

## 6. 旧能力保留清单

以下 section 仍保留在 `/settings/models`，只是降级为“高级管理模式”：

- 服务商详情；
- 密钥管理；
- 模型配置；
- 默认模型；
- 按任务分配；
- 调用记录；
- 用量统计。

没有被删除的路由、权限和真实 API 调用能力见 `USABILITY_CHANGED_FILES.md` 与 `USABILITY_OPEN_ISSUES.md`。
