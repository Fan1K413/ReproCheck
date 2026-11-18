# 第四阶段依赖地图（STAGE4_DEPENDENCY_MAP）

## 1. 数据来源依赖（本阶段所有功能的输入）

```
projects (已有)
   └── materials (已有) ──> source_chunks (已有) ──> extracted_facts (已有)
                                                        └──> evidence_items (已有)
   └── audit_findings (第一阶段最小审计，非"第三阶段审计引擎")
   └── [适配层] Stage3AuditAdapter
         ├── 真实来源：extracted_facts + audit_findings 的程序化比对结果
         └── 明确标注：第三阶段专用审计引擎/证据图谱不存在，本适配层仅提供既有数据视图
```

**关键声明**：本阶段不假设第三阶段存在。`Stage3AuditAdapter` 只暴露第一阶段 demo 审计结果与 facts 的程序化视图，任何用到"审计问题"的 AI 提示词都注明数据来自该适配层，不伪造"第三阶段审计结论"。

## 2. 模块依赖图

```
[已有] LLMService ──────────────> [新增] ReproductionPlanner (AI 反向规划)
[已有] FactSchema ───────────────>      │
[适配] Stage3AuditAdapter ───────>      │
                                        v
                              ReproPlanSchema (Pydantic 严格校验)
                                        │
                                        v
                              [新增] FeasibilityChecker (确定性校验)
                                        │  ready / missing_* / blocked_security / ...
                                        v
                              [新增] DAG 编排 (拓扑排序/环检测/阻断传播)
                                        │
                    ┌───────────────────┼────────────────────┐
                    v                   v                    v
        [新增] SecurityPreflight  [新增] EnvDetector   [新增] ResultExtractor
        (静态安全扫描)            (环境/依赖识别)      (日志/CSV/JSON 指标提取)
                    │                   │                    │
                    v                   v                    v
        [新增] ExecutionSandbox   [新增] MetricComparator  [新增] QualityEvaluator
        (默认禁用真实执行)         (容差/对照规则)         (多维复现质量)
                    │
                    v
        [新增] FailureDiagnoser (复用 LLMService，无 Key 明确不可用)
                    │
                    v
        [新增] ReportGenerator (HTML/PDF，数据全部来自 DB)
                    │
                    v
        [新增] 前端复现工作台 (7 页面)
```

## 3. 新增数据表（12 张，增量迁移）

`reproduction_plans / reproduction_tasks / reproduction_runs / execution_environments /
execution_logs / execution_artifacts / reproduction_metrics / metric_comparisons /
failure_diagnostics / remediation_proposals / remediation_reviews / reproduction_reports`

全部含 `project_id` 关联，幂等迁移（复用 `app/db/migrate.py` Inspector 模式），保留前序数据。

## 4. 外部能力依赖与降级策略

| 能力 | 依赖 | 可用状态 | 降级策略 |
|---|---|---|---|
| AI 规划/诊断 | LLM_API_KEY + LLMService | ❌ 无真实 Key | 复用 LLMService，无 Key 抛 LLM_KEY_NOT_CONFIGURED；协议级 mock 验证逻辑 |
| 代码执行 | Rootless Docker/gVisor | ❌ 未安装 | 默认 `ENABLE_CODE_EXECUTION=false`；仅静态检查与环境分析；接口预留 |
| PDF 报告 | 报告库（weasyprint/reportlab） | 待安装验证 | 优先 HTML；PDF 用可用库，失败明确提示 |
| 数据库 | SQLite + aiosqlite | ✅ | — |
| 前端 | Node/npm | ✅ | — |

## 5. 接口契约策略

- 新增接口统一挂 `/api/v1/reproductions/*`，沿用统一信封 `{success,data,error,request_id}` 与既有错误码；
- 不改任何前序接口（第一/二阶段 19 条业务路由保持原样）；
- 前端通过适配层 `src/services/reproductionApi.ts` 对接，与既有 `api.ts` 并存。

## 6. 文件所有权（避免覆盖前序）

- 新增目录：`backend/app/reproduction/`、`backend/app/models/stage4.py`、`backend/app/api/v1/reproductions.py`、`frontend/src/pages/reproduction/*`、`frontend/src/features/reproduction/*`；
- 仅"追加式"修改：`app/api/__init__.py`（include_router）、`app/db/__init__.py`（迁移触发）、`app/models/__init__.py`（不改，新表独立放 stage4.py）、`App.tsx`（加路由）、`AppLayout.tsx`（加菜单）；
- 子代理边界：规划引擎与前端工作台分开文件，避免写冲突。
