# ReproCheck 第六阶段 · 数据库迁移计划

> 数据库：SQLite（aiosqlite async）。迁移约定：沿用现有「启动 `create_all` + 幂等加列」模式，新增 `app/db/migrate_stage6.py`，并补 Alembic `0003_stage6`。
> 兼容原则：**不破坏前五阶段 23 张表与既有数据**。新增表全部独立；对既有表仅「加可空列」，旧数据归入默认组织。

## 1. 新增表清单（按模块）

### A 组 · 身份 / 组织 / 权限 / 协作 / 审计轨迹
| 表 | 关键列 | 说明 |
|---|---|---|
| users | id(uuid pk), email(unique), password_hash, display_name, is_active, is_platform_admin, created_at, last_login_at | 密码用 stdlib pbkdf2_hmac |
| organizations | id, name, slug(unique), description, owner_user_id→users, created_at | |
| org_members | id, org_id→organizations, user_id→users, role_key, joined_at; unique(org_id,user_id) | 组织级角色 |
| workspaces | id, org_id→organizations, name, description, created_at | 组织内分组 |
| teams | id, org_id→organizations, name, description, created_at | |
| team_members | id, team_id→teams, user_id→users, role_in_team, joined_at; unique(team_id,user_id) | |
| project_members | id, project_id→projects, user_id→users, role_key, added_by, added_at; unique(project_id,user_id) | 项目级角色 |
| invitations | id, org_id, email, role_key, token_hash(unique), status(pending/accepted/expired/revoked), expires_at, invited_by, created_at, accepted_at | 邀请链接过期处理 |
| roles | id, key(unique), name, scope(org/project), description, is_system | 种子：org_admin/project_lead/researcher/reviewer/viewer |
| permissions | id, key(unique), description | 种子见 ROLE_PERMISSION_MATRIX.md |
| role_permissions | role_id→roles, permission_id→permissions; unique(role_id,permission_id) | RBAC 映射 |
| comments | id, project_id, author_user_id, target_type(finding/evidence/task/fact/material), target_id, body, created_at, updated_at | 评论关联具体科研对象 |
| review_requests | id, project_id, target_type(finding/remediation), target_id, requested_by, reviewer_user_id, status(pending/approved/rejected/changes_requested), decision_note, created_at, decided_at | 复核申请 |
| audit_trail | id, org_id, project_id(nullable), actor_user_id, action, target_type, target_id, before_json, after_json, summary, request_id, created_at | 保留修改前后内容 |

### B 组 · 基准案例 / 事实
| 表 | 关键列 |
|---|---|
| benchmark_cases | id, title, doi, source_url, domain, research_task, model_architecture, dataset_name, code_repo_url, code_commit, license, quality_level, quality_evidence_json, version, org_id(nullable), is_public, created_by, created_at, updated_at, summary |
| case_facts | id, case_id→benchmark_cases, field_key, raw_field, raw_value, normalized_value, unit, source_type, source_ref, context, applicable_experiment, confidence, created_at |
| case_verifications | id, case_id, verifier_user_id, verification_type(execution/review), conditions_json, result(pass/fail/partial), notes, created_at |

### C 组 · 规则 / 反馈 / RAG
| 表 | 关键列 |
|---|---|
| audit_rules | id, rule_key(unique), name, domain, description, risk_level, evidence_requirement, current_version, is_enabled, created_by, created_at, updated_at |
| audit_rule_versions | id, rule_id→audit_rules, version, check_logic_json, change_note, created_by, created_at, is_active; unique(rule_id,version) |
| rule_test_samples | id, rule_version_id→audit_rule_versions, input_json, expected_json, label |
| rule_evaluations | id, rule_id, version, dataset_ref, metrics_json, ran_by, created_at |
| audit_feedback | id, project_id, finding_id(nullable), run_id(nullable), user_id, feedback_type(confirm/false_positive/insufficient_evidence/request_review/supplement/fix_note), context_json, evidence_ref, note, status(open/triaged/resolved/disputed), created_at, resolved_by, resolved_at |
| knowledge_documents | id, source_type(verified_case/normalized_fact/audit_rule/repro_method/env_config/failure_diagnosis), source_ref, title, content, org_id(nullable), is_public, created_by, created_at |

### D 组 · 集成 / 开放 API
| 表 | 关键列 |
|---|---|
| repository_connections | id, org_id, user_id, provider(github/gitlab/gitee), account_label, auth_type(oauth/pat), token_encrypted, scopes_json, status(connected/revoked/error), repo_allowlist_json, created_at, revoked_at |
| repository_snapshots | id, connection_id→repository_connections, project_id(nullable), repo_full_name, default_branch, commit_sha, tag, branch, version_diff_json, fetched_at |
| notebook_cells | id, material_id→materials, cell_id, cell_type, source, execution_count, outputs_json, order_index |
| api_tokens | id, user_id, org_id, name, token_hash(unique), prefix, scopes_json, rate_limit_per_min, expires_at, last_used_at, is_revoked, created_at |
| api_call_logs | id, token_id→api_tokens, endpoint, method, status_code, duration_ms, ip_hash, created_at |

### E 组 · 治理
| 表 | 关键列 |
|---|---|
| ai_consents | id, org_id(nullable), project_id(nullable), user_id, allow_external_llm, scope, granted_at, revoked_at |
| data_export_requests | id, user_id, org_id, status(pending/ready/failed), file_path, created_at, completed_at |

## 2. 既有表加列（可空，向后兼容）

| 表 | 新列 | 默认/回填 |
|---|---|---|
| projects | owner_user_id(nullable), org_id(nullable), workspace_id(nullable) | 旧项目回填到「默认组织」+ 首个平台管理员 |
| reproduction_runs | requested_by_user_id(nullable) | 旧值保留 requested_by 文本 |
| remediation_reviews | reviewer_user_id(nullable) | 旧值保留 reviewer 文本 |

## 3. 默认组织与数据回填

- 迁移创建 `default` 组织（slug=`legacy`）与首个平台管理员（来自 env `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`，仅首次）。
- 既有 projects.org_id 回填为 default 组织 id；owner_user_id 回填为管理员。
- 不删除、不覆盖任何既有行；加列用 Inspector 检测存在性，幂等。

## 4. 迁移执行与回滚

- 执行：启动 `init_db()` 调 `migrate_stage6()`；或 `python -m app.db.migrate_stage6`；或 `alembic upgrade head`（0003）。
- 0003 upgrade：`create_all`（仅新表）+ 加列 + 种子 roles/permissions/默认组织。downgrade：drop 新表 + 移除新列（SQLite 用 batch_alter_table）。
- **不可逆操作（删表/删列）仅在 downgrade 显式执行；upgrade 全程 additive，无数据丢失。**
- 备份：迁移前复制 `reprocheck.db` → `reprocheck.db.pre_stage6.bak`（脚本自动）。

## 5. 索引

- project_members(project_id), (user_id)；org_members(org_id),(user_id)；invitations(token_hash),(org_id,status)
- audit_trail(project_id,created_at),(org_id,created_at)；comments(project_id,target_type,target_id)
- benchmark_cases(domain),(research_task),(quality_level),(is_public)；case_facts(case_id,field_key)
- audit_rule_versions(rule_id,version)；audit_feedback(project_id,status)
- api_tokens(token_hash)；api_call_logs(token_id,created_at)；notebook_cells(material_id,order_index)

## 6. 文件所有权

- `app/models/stage6.py`：全部新模型（单一文件，A 组负责创建，B/C/D/E 只读引用，不改公共列）。
- `app/db/migrate_stage6.py`：A 组负责。
- `alembic/versions/0003_stage6.py`：A 组负责。
- 共享模型版本冻结于本计划；任何模块需改公共接口必须先更新 STAGE6_API_CONTRACT.md 并经集成负责人确认。