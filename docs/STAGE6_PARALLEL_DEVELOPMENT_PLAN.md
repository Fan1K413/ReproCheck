# ReproCheck 第六阶段 · 模块并行开发计划

> 原则：复用前五阶段分层（api/v1 → services → models），模块隔离，共享接口先冻结。
> 共享文件单一所有权：`models/stage6.py`、`db/migrate_stage6.py`、`api/deps.py`（认证/RBAC）、`api/__init__.py`（路由聚合）、`core/config.py`、`requirements.txt` 由 **A 组（集成负责人）** 统一维护；其他模块只新增自己的 service/router 文件，不改公共列与公共依赖。

## 1. 模块划分与文件所有权

| 组 | 职责 | 独占新增文件 | 只读依赖 |
|---|---|---|---|
| A 组织权限 | 认证/RBAC/组织/团队/邀请/协作/审计轨迹 + 共享基础 | models/stage6.py, db/migrate_stage6.py, alembic/0003, core/security.py, api/deps.py(扩展), services/auth_service.py, services/org_service.py, services/collab_service.py, services/trail_service.py, api/v1/auth.py, orgs.py, teams.py, comments.py, reviews.py, roles.py, activity.py | 现有 models |
| B 基准库 | 案例/事实/检索/质量 | services/benchmark_service.py, services/fact_schema.py, services/case_search.py, api/v1/cases.py, fact_schema.py | stage6 模型, deps |
| C 规则进化 | 规则/反馈/评估/RAG | services/rule_service.py, services/feedback_service.py, services/rag_service.py, services/rule_eval.py, api/v1/rules.py, feedback.py, rag.py | stage6 模型, deps, LLMService |
| D 集成 | 仓库/Notebook/开放API | services/repo_service.py, services/notebook_service.py, services/openapi_service.py, services/token_service.py, api/v1/integrations.py, api_tokens.py, api/open.py | stage6 模型, deps, parsers |
| E 治理安全 | 分类/同意/导出/删除/脱敏 | services/governance_service.py, services/export_service.py, core/redaction.py, api/v1/governance.py | stage6 模型, deps |

## 2. 开发顺序（依赖驱动）

1. **A0 共享基础**（先行，阻塞其他组）：stage6 模型 + 迁移 + security（pbkdf2/JWT/Fernet）+ deps（get_current_user/require_permission/项目隔离）+ auth/org 路由 + 种子角色权限 + 默认组织回填。
2. **A1 协作**：comments/reviews/activity + 既有读接口隔离改造。
3. **B/C/D/E 并行**：各自 service+router，仅依赖 A0 冻结接口。可在独立 worktree/分支开发，集成负责人合并。
4. **集成**：路由聚合、跨模块回归、契约一致性检查。
5. **前端**：契约冻结后并行开发 12 页面 + 认证 + 原语。
6. **测试与文档**：20 项专项测试 + 19 份交付文档。

## 3. 接口冻结点

- A0 完成后冻结：`get_current_user`、`require_permission`、`resolve_project_access`、stage6 模型列、信封格式、错误码。
- B/C/D/E 不得修改上述；如需扩展，提交契约变更 → 集成负责人更新 STAGE6_API_CONTRACT.md → 通知各组。

## 4. 并行策略

- 本会话采用「共享基础串行 + 模块文件并行」：A0 由集成负责人直接实现；B/C/D/E 的 service/router 文件互不重叠，可委派并行子代理在独立 worktree 实现后合并，或顺序实现。
- 共享模型/迁移/依赖只由 A0 写入，避免合并冲突。
- 每组自带 pytest 测试文件（test_stage6_<group>.py），独立可跑。

## 5. 验收门槛（每组）

- 后端权限测试：越权 403/404、组织隔离、邀请过期、成员撤销。
- 业务测试：真实逻辑（非 mock 冒充第三方）；外部服务无授权标 BLOCKED。
- 回归：前五阶段 73 测试不破坏。
- 文档：对应规格文档来自实际实现。

## 6. 风险

| 风险 | 应对 |
|---|---|
| 既有读接口加隔离破坏旧测试 | 旧测试用 conftest 注入认证用户+默认组织成员身份 |
| 真实 GitHub 授权无凭据 | 连接器实现授权模型+协议级测试，sync 标 BLOCKED，不冒充 |
| 真实执行沙箱不可用 | 保持 blocked_no_sandbox，不在第六阶段启用 |
| 子代理改公共文件 | 文件所有权表强制；合并前 diff 审查 |