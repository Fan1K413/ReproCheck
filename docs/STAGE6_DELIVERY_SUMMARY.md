# 第六阶段交付文档汇总（团队协作平台 + Qoder Site）

生成时间：2026-11-19
状态：本地开发与验证完成；Qoder Site 草稿已就绪，**待 `APP_JWT_SECRET` 录入后发布**（见 §6）。

## 1. 阶段目标

将单用户科研复现审计工具升级为团队协作平台：组织/项目/角色权限、审计轨迹、科研复现基准库与事实标准化、审计规则生命周期与反馈治理、受控 RAG、外部集成与开放 API、安全与数据治理；并以 Qoder Site（SPA + 单 `app` Edge Function + 托管数据库）形式交付。

## 2. 交付物清单

### 2.1 后端（FastAPI，`backend/`）

| 组 | 模块 | 说明 |
|---|---|---|
| A 组织协作 | `org_service` `collab_service` `trail_service` `auth_service` | 组织/项目/邀请/角色 RBAC、评论与活动、审计轨迹、JWT 认证 |
| B 基准库 | `benchmark_service` `case_search` `fact_schema` | 案例/事实/核验、质量分仅由核验重算、检索、事实 schema 与人工修订留痕 |
| C 规则治理 | `rule_service` `rule_eval` `feedback_service` `rag_service` | 规则版本生命周期、测试样本与评估对照、反馈 triage（单条不自动改生产规则）、受控 RAG |
| D 外部集成 | `repository_service` `notebook_service` `api_token_service` | 仓库连接器/快照、Notebook 解析、开放 API 令牌（明文仅一次、哈希不外泄、可撤销、调用日志） |
| E 安全治理 | `governance_service` | 同意管理、数据导出（ZIP）、保留策略 |

数据模型：`app/models/stage6.py`（增量新表，含 project_id 隔离）；路由 `app/api/v1/` 对应模块；测试 `app/tests/test_stage6_*.py` + `test_stage4*.py` 共 68 项（全库 120 项）。

### 2.2 前端（React + Vite，`frontend/`）

- 第六阶段 12 页：`src/pages/stage6/`（Organizations/Roles/ProjectTeam/Benchmark/CaseDetail/FactSchema/Rules/Feedback/Knowledge/Integrations/ApiTokens/Governance）
- 认证与交互原语：登录/注册、令牌注入（`src/services/api.ts`）、表格/对话框/页签等
- 第四阶段复现 7 页沿用并修复鉴权与依赖渲染（`src/pages/reproduction/`）
- 浏览器实测：`scripts/verify_ui.mjs`（38 步，桌面 1440×900 + 移动 390×844，截图 `.verify-shots/`）

### 2.3 Qoder Site Function（`frontend/functions/`）

- `core.ts`：路由/鉴权镜像（optionalUser 静默 null、Bearer 大小写不敏感、401 文案对齐）、`nextIntId`、错误日志
- 四域：`domain_identity.ts` `domain_benchmark.ts` `domain_rules.ts` `domain_integrations.ts` + `routes.ts`
- 校验层镜像后端 Pydantic 语义（422 + loc/msg、extra-forbid、整数参数 clamp）
- `seed_data.ts`：53 表 / 375 行全量种子（运行时 ensureSeed 幂等灌入），演示数据均带标注
- 本地桥：`dev/function-local.mjs`（Node 直跑 TS + 内存假 DB），冒烟 `dev/site-smoke.mjs` 45 项

### 2.4 云资源与迁移

- Project `01a1f1d6-5032-7416-843e-bcdbca8c31c5` / Site `01a1f1d6-5033-7397-88f0-71a524bd368c`
- 地址（私有）：`reprocheck-audit-98l19k1u2he.qoder.zone`
- 数据库：53 表 / 81 索引，迁移分块全部 applied（identity、C1–C4、I1–I5、stage2）；目录已刷新校验 stale=false
- 草稿 action：`935f9b67-e07c-4c10-87f4-5417f92076c8`（artifactReady=true，preparation ready）

### 2.5 文档（`docs/`）

| 文档 | 内容 |
|---|---|
| STAGE6_ARCHITECTURE_AUDIT.md | 现状架构审计 |
| STAGE6_API_CONTRACT.md | 接口契约 |
| STAGE6_DATABASE_MIGRATION_PLAN.md | 数据库迁移计划 |
| STAGE6_PARALLEL_DEVELOPMENT_PLAN.md | 模块开发计划 |
| STAGE6_SECURITY_REVIEW.md | 安全评审 |
| TEAM_COLLABORATION_SPEC.md | 团队协作规格 |
| TEST_REPORT_STAGE6.md | 专项测试 20 项 + 汇总证据（120 / 45/45 / 38/38） |
| 本文件 | 交付汇总 |

沿用前序：API_CONTRACT*、DATABASE_SCHEMA、SECURITY*、RESULT_COMPARISON_SPEC、REPORT_GENERATION_SPEC 等。

## 3. 演示账号与数据

密码统一 `ReproCheck#2026`（演示环境公开文档化，非生产凭据）：

| 邮箱 | 姓名 | 角色 |
|---|---|---|
| lead@reprocheck.demo | 林晚晴 | 组织管理员/项目负责人 |
| researcher@reprocheck.demo | 陈叙 | researcher |
| reviewer@reprocheck.demo | 沈知微 | reviewer |
| viewer@reprocheck.demo | 顾远 | viewer |

种子故事线：ResNet-50/ImageNet 复现审计（12 事实含人工修订留痕、5 任务 DAG、失败 run+诊断+修复审核、成功 run 61.5h、4 条指标对照含 not_comparable、最终报告）。界面所有演示数据带"演示/历史快照"标注。

## 4. 安全约定（已实现并测试）

- 密钥/Secret 仅服务端读取；`password_hash`/`token_hash`/`token_encrypted` 永不返回；令牌明文仅创建时一次
- 非成员项目访问一律 404；AI/客户端不可写案例质量分（仅核验重算）
- 单条反馈不自动修改生产规则；当前论文证据优先于历史案例
- Secret 值仅经 Site Settings 专用输入框录入，不经聊天/命令行/日志

## 5. 已知限制（诚实降级）

- Site 环境无安全沙箱执行运行时与在线 AI Key：开放审计执行、材料上传等返回 **501 DEMO_LIMIT**，不伪造成功；AI 相关种子标注"历史演示快照，非在线调用"
- 站点保持 **private**；公开访问需另行授权

## 6. 发布状态与后续

- 阻塞项：`APP_JWT_SECRET` 缺失（`sites_secret_not_ready`）。录入路径：Sites 面板 → 站点 → Settings → Secrets。
- 录入后：`publish_site`（同一 action）→ 验证 `published: true` → 线上验收 6 项（health/登录/种子/mutation/501 降级/移动视口）→ 回填 TEST_REPORT_STAGE6 §6 → 完成报告。