# ReproCheck 第六阶段 · API 契约（共享基准 v1）

> 所有模块必须遵守本契约。修改公共接口须先更新本文件并经集成负责人确认。
> 基础路径 `/api/v1`。响应沿用现有信封：`{success, data, error:{code,message,details}, request_id}`。
> 认证：`Authorization: Bearer <JWT>`（HS256，PyJWT）。开放 API 用 `Authorization: Bearer <api_token>`（独立前缀 `rc_live_`）。
> 权限：后端依赖注入校验，**不得仅前端隐藏**。错误码：401 未认证 / 403 无权限 / 404 不存在或越权不可见 / 409 冲突 / 422 校验失败。

## 0. 认证与身份（A）
| 方法 路径 | 权限 | 说明 |
|---|---|---|
| POST /auth/register | 公开 | {email,password,display_name}→user+token；密码≥8 |
| POST /auth/login | 公开 | {email,password}→{token,user} |
| POST /auth/logout | 认证 | 客户端丢弃 token；记录审计 |
| GET /auth/me | 认证 | 当前 user + 所属组织/项目角色 |

JWT claims：`sub`(user_id), `email`, `exp`(默认 12h), `iat`。`get_current_user` 依赖解析；`require_permission(perm, scope)` 校验组织/项目角色。

## 1. 组织 / 团队 / 成员 / 邀请（A）
| 方法 路径 | 权限 |
|---|---|
| POST /orgs | 认证（创建者成为 org_admin） |
| GET /orgs | 认证（仅本人所属） |
| GET /orgs/{org_id} | org 成员 |
| GET /orgs/{org_id}/members | org 成员 |
| PATCH /orgs/{org_id}/members/{user_id} | org_admin（改 role_key） |
| DELETE /orgs/{org_id}/members/{user_id} | org_admin（撤销权限） |
| POST /orgs/{org_id}/invitations | org_admin |
| GET /orgs/{org_id}/invitations | org_admin |
| POST /invitations/accept | 公开（token）；校验过期/已用 |
| POST /invitations/{id}/revoke | org_admin |
| CRUD /orgs/{org_id}/teams, /teams/{id}/members | org_admin 管理 / 成员读 |
| CRUD /orgs/{org_id}/workspaces | org_admin |
| GET /roles, GET /permissions, GET /roles/{key}/permissions | 认证 |

邀请 token：明文仅返回一次，DB 存 sha256；默认 7 天过期；accept 校验 status=pending 且未过期。

## 2. 项目协作 / 审计轨迹（A）
| 方法 路径 | 权限 |
|---|---|
| POST /projects（扩展） | 认证；自动设 owner_user_id/org_id |
| GET /projects | 认证；仅本人可见项目（org 隔离） |
| GET /projects/{id} | 项目成员或 org_admin |
| POST /projects/{id}/members | project_lead/org_admin |
| GET /projects/{id}/members | 项目成员 |
| PATCH/DELETE /projects/{id}/members/{user_id} | project_lead/org_admin |
| GET /projects/{id}/activity | 项目成员（audit_trail 分页） |
| POST /projects/{id}/comments | researcher+；{target_type,target_id,body} |
| GET /projects/{id}/comments?target_type&target_id | 项目成员 |
| DELETE /comments/{id} | 作者或 project_lead |
| POST /projects/{id}/reviews | researcher+；{target_type,target_id,reviewer_user_id} |
| GET /projects/{id}/reviews | 项目成员 |
| POST /reviews/{id}/decide | 指定 reviewer 或 project_lead；{status,decision_note} |

**既有读接口（materials/facts/audit-runs/reproductions/reports）全部加项目级隔离**：通过 project_id 解析成员身份，非成员 404。变更接口在认证基础上校验对应权限。

## 3. 基准案例 / 事实（B）
| 方法 路径 | 权限 |
|---|---|
| POST /cases | researcher+（org 内）；公共案例需 org_admin |
| GET /cases?domain&research_task&dataset&quality_level&q | 认证；公共+本 org |
| GET /cases/{id} | 可见性同上 |
| POST /cases/{id}/facts | case 创建者/org_admin |
| GET /cases/{id}/facts | 可见 |
| POST /cases/{id}/verifications | reviewer+；{verification_type,conditions_json,result,notes} |
| POST /cases/{id}/quality/recompute | 系统按验证条件计算，**AI 不可直接设等级** |
| POST /cases/search | 认证；{query,filters,top_k}→[{case,score,match_basis[]}] |
| GET /fact-schema | 认证；标准字段目录 |

quality_level 规则（CASE_QUALITY_STANDARD.md）：无验证=unverified；有 review pass=partially_verified；有 execution pass（指定环境）=execution_verified；另有独立人工 review pass=independently_reviewed。recompute 只升不降需人工确认。

## 4. 规则 / 反馈 / RAG（C）
| 方法 路径 | 权限 |
|---|---|
| GET /rules | 认证 |
| POST /rules | org_admin/rule.manage |
| GET /rules/{id} | 认证 |
| PATCH /rules/{id} | rule.manage（启用/停用） |
| POST /rules/{id}/versions | rule.manage；新版本须附 test_samples |
| GET /rules/{id}/versions | 认证 |
| POST /rules/{id}/rollback | rule.manage；{version} |
| POST /rules/{id}/test | rule.manage；跑 test_samples→通过率 |
| GET /rules/{id}/evaluations | 认证 |
| POST /feedback | 项目成员；{finding_id,feedback_type,note,evidence_ref} |
| GET /feedback?project_id&status | 项目成员/org_admin |
| POST /feedback/{id}/triage | reviewer+；{status,resolution} |
| POST /rag/query | 认证；{query,project_id,top_k}→[{document,provenance_class,score,source_ref}] |
| GET /rag/documents, POST /rag/documents | rule.manage/case.manage |

RAG provenance_class ∈ {current_evidence, historical_case, external_knowledge, model_inference}；当前论文证据永远优先，历史案例不得覆盖当前事实。

## 5. 集成 / 开放 API（D）
| 方法 路径 | 权限 |
|---|---|
| POST /integrations/repositories | integration.manage；{provider,auth_type,token?,repo_allowlist} |
| GET /integrations/repositories | 本 org |
| POST /integrations/repositories/{id}/revoke | 创建者/org_admin |
| POST /integrations/repositories/{id}/sync | integration.manage；真实拉取（无凭据→BLOCKED 状态） |
| GET /integrations/repositories/{id}/snapshots | 本 org |
| GET /materials/{id}/notebook | 项目成员；cell 级结构 |
| POST /api-tokens | api.manage；{name,scopes,rate_limit_per_min,expires_at}→明文 token 仅一次 |
| GET /api-tokens | 本人 |
| POST /api-tokens/{id}/revoke | 本人/org_admin |
| GET /api-tokens/{id}/logs | 本人/org_admin |

开放 API（独立路由 `/api/open/v1`，token 认证 + scope + 速率限制 + 调用日志）：
GET/POST /projects, POST /materials, POST /audits, GET /audits/{id}, GET /reproductions, GET /reports/{id}。scope ∈ {project.read,project.write,material.write,audit.run,audit.read,repro.read,report.read}。

## 6. 治理（E）
| 方法 路径 | 权限 |
|---|---|
| GET /governance/classification | 认证 |
| POST /governance/ai-consent | org_admin/project_lead；{allow_external_llm,scope} |
| GET /governance/ai-consent?project_id | 项目成员 |
| POST /governance/export | 认证（本人数据）；异步生成 zip |
| GET /governance/export/{id} | 本人 |
| DELETE /projects/{id} | project_lead/org_admin；级联清理材料/存储/关联 |
| GET /governance/retention | org_admin |

AI 调用前检查 ai_consent：未授权外部模型时，LLM 服务拒绝并返回明确错误（不静默发送）。

## 7. DTO 约定
- 所有 id 为 uuid 字符串；时间 ISO8601 UTC。
- 列表分页：`?limit&offset`→`{items,total,limit,offset}`。
- 敏感字段（token_encrypted/password_hash）绝不出现在响应；token 明文仅创建时返回一次。
- 前后端字段 snake_case 一致；状态枚举以本契约为准。