# 第六阶段 · 开放 API 规范（D）

> 实现位置：`backend/app/api/open_v1.py`、`services/api_token_service.py`；路由 `api/v1/api_tokens.py`。
> 独立路由前缀 `/api/open/v1`，与内部 JWT 路由完全分离。

## 1. Token 管理（内部 JWT 认证）

| 接口 | 权限 | 行为 |
|---|---|---|
| POST /api-tokens | api.manage（org） | 创建；明文 `rc_live_...` **仅此次返回**；DB 只存 sha256 |
| GET /api-tokens | 本人 | 列表；不含明文/哈希 |
| POST /api-tokens/{id}/revoke | 本人/org_admin | 立即失效 |
| GET /api-tokens/{id}/logs | 本人/org_admin | 调用日志（IP 仅哈希） |

合法 scope：`project.read` `project.write` `material.write` `audit.run` `audit.read` `repro.read` `report.read`。
创建时校验 scope 合法性（非法 422，空 scope 422）。可设 `rate_limit_per_min`、`expires_at`。

## 2. 开放 API 端点（Bearer rc_live_ 认证）

| 接口 | scope | 行为 |
|---|---|---|
| GET /api/open/v1/projects | project.read | 令牌所属用户可见项目 |
| POST /api/open/v1/projects | project.write | 创建项目（归属令牌用户/org） |
| POST /api/open/v1/materials | material.write | multipart 上传材料到可见项目 |
| POST /api/open/v1/audits | audit.run | 启动解析/审计任务（无 LLM Key 明确 503） |
| GET /api/open/v1/audits/{id} | audit.read | 任务状态（项目隔离） |
| GET /api/open/v1/reproductions | repro.read | 复现运行列表（项目隔离） |
| GET /api/open/v1/reports/{id} | report.read | 报告元信息（项目隔离） |

## 3. 治理机制
- **认证**：令牌前缀必须 `rc_live_`；sha256 反查；撤销/过期/用户停用 → 401。
- **scope**：缺对应 scope → 403。
- **速率限制**：进程内滑动窗口（每 token 每分钟 `rate_limit_per_min` 次），超限 → 429。所有已认证调用（含 scope 拒绝）计入窗口。
- **项目隔离**：所有读写按令牌所属用户的成员/组织管理员可见性过滤；越权 → 404。
- **调用日志**：每次成功调用落 ApiCallLog（endpoint/method/status_code/duration_ms/ip_hash）。

## 4. 未实现（诚实标注）
- 分布式速率限制（当前进程内；多副本部署需共享存储如 Redis）。
- 失败调用（401/403/429）的日志落库（当前仅记录成功调用；认证失败在依赖层抛出前未落日志）。
- Token 自动过期清理 cron。
- 开放 API 的写审计（POST /audits 触发内部任务，其留痕由内部服务负责）。