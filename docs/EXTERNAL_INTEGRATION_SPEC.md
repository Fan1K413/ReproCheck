# 第六阶段 · 外部集成规范（D）

> 实现位置：`backend/app/services/repository_service.py`、`notebook_service.py`；路由 `api/v1/integrations.py`。
> 本文档反映已实现行为；未实现项在末尾诚实标注。

## 1. 仓库连接器

支持服务商：`github` / `gitlab` / `gitee`。

| 接口 | 权限 | 行为 |
|---|---|---|
| POST /integrations/repositories | integration.manage（org） | 创建连接；令牌 Fernet 加密落库；可设仓库白名单 |
| GET /integrations/repositories | 本人/本 org | 列表；绝不返回明文或密文令牌，仅 `has_token` 布尔 |
| POST /integrations/repositories/{id}/revoke | 创建者/org_admin | 状态置 revoked，**立即清空密文**，记录 revoked_at |
| POST /integrations/repositories/{id}/sync | integration.manage | 真实拉取远端 commit；落 RepositorySnapshot |
| GET /integrations/repositories/{id}/snapshots | 本人/本 org | 快照历史 |

### 同步真实性保证
- 有凭据：调用对应服务商 API（GitHub `GET /repos/{full}/commits/{ref}`、GitLab `GET /projects/{id}/repository/commits/{ref}`、Gitee `GET /repos/{full}/commits/{ref}`）取真实 `commit_sha`。
- 无凭据：落 `status=blocked_no_credentials` 快照，`commit_sha` 为空，**绝不伪造版本号**。
- 拉取失败：落 `status=blocked_fetch_failed`，记录异常类型，不伪造。
- 白名单：连接设了 `repo_allowlist` 时，同步白名单外仓库返回 403。
- 已撤销连接同步返回 409。

### 凭据安全
- 令牌仅经 `encrypt_secret`（cryptography.Fernet）加密后存 `token_encrypted`；密钥来自后端配置 `ENCRYPTION_KEY`（为空时由 `JWT_SECRET` 派生，仅开发）。
- 任何响应、日志、审计轨迹均不含明文/密文令牌。
- 跨组织不可见：非创建者且非本 org 成员访问连接返回 404（隐藏存在性）。

## 2. Notebook 细胞级解析

| 接口 | 权限 | 行为 |
|---|---|---|
| GET /materials/{id}/notebook | 项目成员 | 返回 cell 级结构；首次访问自动解析 |

- 仅读取后端已存储的 `.ipynb` 文件/原文，**绝不执行 notebook 代码**。
- 解析 `cells[]`：保留 `cell_type`、`source`、`execution_count`、`outputs` 引用计数、`order_index`。
- 幂等：重复解析先清理旧细胞再重建。
- 非 notebook 材料或非法 JSON 明确 422，不伪造细胞。

## 3. 未实现（诚实标注）
- 仓库代码批量克隆/增量 diff 计算（当前仅取 commit 元信息快照）。
- GitLab 自建实例 / Gitee 企业版自定义域名（当前用公共 API 域名）。
- 连接器 OAuth 流程（当前仅 PAT 令牌）。
- 前端集成管理页面（见前端任务）。