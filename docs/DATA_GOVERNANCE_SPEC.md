# 第六阶段 · 安全与数据治理规范（E）

> 实现位置：`backend/app/services/governance_service.py`；路由 `api/v1/governance.py`；项目删除 `api/v1/projects.py`。

## 1. 数据分级

| 级别 | 示例 | 处理规则 |
|---|---|---|
| public 公开 | 公开基准案例、已发布报告摘要 | 可公开检索；不含未发表材料 |
| internal 内部 | 组织内项目元数据、审计规则 | 仅组织成员可见；导出需授权 |
| confidential 机密 | 未发表论文原文、抽取事实与证据 | 仅项目成员可见；外部 LLM 需 AI 授权；不得进入公共 RAG |
| restricted 受限 | 密码哈希、仓库令牌、API Token | 加密/哈希落库；绝不回显明文；不参与导出与模型输入 |

GET /governance/classification（认证）返回分级目录与原则。

## 2. AI 外部模型授权门

| 接口 | 权限 | 行为 |
|---|---|---|
| POST /governance/ai-consent | org_admin（data.manage）/ project_lead | 授予/撤销外部模型调用同意；同范围旧授权撤销留痕 |
| GET /governance/ai-consent?project_id | 项目成员 | 当前有效授权 + 历史 + require_ai_consent 开关 |

- 配置 `REQUIRE_AI_CONSENT=True` 时，`TaskService.start` 在调用外部 LLM 前执行 `ensure_ai_consent`：无有效 `allow_external_llm=True` 授权 → **403 AI_CONSENT_REQUIRED**，不静默发送材料。
- 默认 `False` 兼容本地演示与既有测试；生产建议开启。
- 授权门作用于解析抽取入口；复现规划/诊断的 LLM 入口可按同一 helper 扩展（见未实现）。

## 3. 本人数据导出

| 接口 | 权限 | 行为 |
|---|---|---|
| POST /governance/export | 认证（本人） | 生成 zip：本人可见项目的元数据 + 事实清单 |
| GET /governance/export/{id} | 本人 | 状态查询 |
| GET /governance/export/{id}/download | 本人 | 下载 zip |

- 导出范围：请求者作为成员/所有者的项目；含材料元信息（名称/sha256/解析状态）与事实（field_key/raw/normalized/parser_source）。
- **不含**密钥、令牌、他人私密材料原文。
- 落 `storage/exports/{user_id}/{request_id}.zip`；越权访问他人导出 → 404。

## 4. 保留策略

GET /governance/retention（org_admin）返回保留声明：材料随项目存续、审计轨迹保留 `DATA_RETENTION_DAYS`（默认 365）天且不可被结论修订覆盖、API 日志 90 天、撤销凭据立即清空。

## 5. 项目级联删除

DELETE /projects/{id}（project_lead/org_admin，min_rank=3）：
- 物理材料文件 + DB 级联（chunks/facts/evidence）。
- 复现引擎关联（plans/tasks/runs/environments/logs/artifacts/metrics/comparisons/diagnostics/proposals/reports）按 project_id 清理。
- 协作关联（comments/reviews/project_members）清理。
- **审计轨迹按保留策略留存**，并记录 project.delete 留痕。

## 6. 未实现（诚实标注）
- 自动保留清理 cron（当前为治理声明，需部署侧定时执行）。
- 复现规划/诊断 LLM 入口的授权门接线（helper 已就绪）。
- 导出包含材料原文附件（当前仅元数据与事实清单，避免机密原文外泄）。
- 异步导出队列（当前同步生成；大数据量需后台任务）。