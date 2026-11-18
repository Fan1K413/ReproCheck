# 第四阶段 API 契约（追加，兼容前序）

Base `/api/v1`，统一信封 `{success,data,error,request_id}` 与既有错误码。
新增错误码：`EXECUTION_DISABLED`(423)、`SECURITY_BLOCKED`(422)、`DAG_INVALID`(422)、`METRIC_UNEXTRACTABLE`(422)。

## 规划

### POST /api/v1/reproductions/plans
body: `{project_id, title?, use_ai?: true}`
→ data: `{plan_id, project_id, title, status, task_count, feasibility_summary:{ready,blocked,needs_human_review,...}, created_at, ai_available:boolean, prompt_version}`
无 Key：`ai_available=false` 并 error=`LLM_KEY_NOT_CONFIGURED`（不返回假规划）。

### GET /api/v1/reproductions/plans/{plan_id}
→ data: PlanView + `{tasks: ReproTaskView[], dag:{nodes:[{id,label,status,feasibility}],edges:[{from,to}]}}`

### GET /api/v1/reproductions/plans?project_id=xxx
→ `{items: PlanView[], total}`

### POST /api/v1/reproductions/plans/{plan_id}/tasks
body: `{title, description, depends_on:string[], required_materials:string[], action, expected_result, acceptance_criteria, risk, needs_human_confirm, evidence_refs:string[]}`
→ data: ReproTaskView（程序化新增任务，不调 AI）

## 任务

ReproTaskView:
```json
{
  "task_id":"...", "plan_id":"...", "task_key":"T01", "title":"...", "description":"...",
  "depends_on":["T00"], "required_materials":["..."], "action":"...",
  "expected_result":"...", "acceptance_criteria":"...", "evidence_refs":["..."],
  "risk":"...", "feasibility":"ready|missing_material|missing_dependency|missing_configuration|needs_human_review|blocked_security|unverifiable",
  "feasibility_reason":"...", "needs_human_confirm":false, "status":"pending|blocked|confirmed|running|completed|failed|cancelled",
  "created_at":"..."
}
```
### GET /api/v1/reproductions/tasks/{task_id} → ReproTaskView
### POST /api/v1/reproductions/tasks/{task_id}/confirm  🔒  → `{confirmed:true, status}`

## 运行与执行

### POST /api/v1/reproductions/runs  🔒
body: `{plan_id, task_ids?:string[], requested_by, environment_id?:string}`
→ data: ReproRunView（含 `execution_enabled:boolean`、`security_blocked:boolean`、`security_reason`）。当前环境无容器时 execution_enabled=false，run 状态为 `blocked_no_sandbox`，**不伪造运行**。

### GET /api/v1/reproductions/runs/{run_id} → ReproRunView
ReproRunView: `{run_id, plan_id, status, execution_enabled, security_check:{passed:boolean,findings:[]}, environment_id, started_at, finished_at, duration_ms, resource_usage:{cpu_seconds?,memory_mb?}, error_message, created_at}`

### POST /api/v1/reproductions/runs/{run_id}/cancel  🔒 → `{cancelled:boolean, status}`
### GET /api/v1/reproductions/runs/{run_id}/logs → `{items:[{log_id,stream,content,created_at}],total}`
### GET /api/v1/reproductions/runs/{run_id}/artifacts → `{items:[{artifact_id,name,path,size_bytes,hash,created_at}],total}`
### GET /api/v1/reproductions/runs/{run_id}/metrics → `{items:MetricView[],total}`
### GET /api/v1/reproductions/runs?project_id=xxx → `{items:ReproRunView[],total}`

## 环境与指标

### GET /api/v1/reproductions/environments?project_id=xxx → `{items:EnvironmentView[],total}`
EnvironmentView: `{environment_id,project_id,python_version,frameworks:{},dependencies:[{name,declared_version,source}],hardware_requirements,entrypoints:[],missing:[],warnings:[],created_at}`

### GET /api/v1/reproductions/metric-comparisons?project_id=xxx → `{items:ComparisonView[],total}`
ComparisonView: `{comparison_id,metric_name,paper_value,reproduced_value,unit,diff_absolute,diff_relative,verdict:"exact_match|within_tolerance|significant_deviation|insufficient_data|not_comparable|needs_manual_review",rule,tolerance_basis,conditions_check:{same_dataset,same_split,same_metric,same_preprocessing,same_hyperparams,same_seed,environment_diff},created_at}`

### GET /api/v1/reproductions/quality?project_id=xxx
→ `{dimensions:[{key,label,score,max,weight,basis,missing}],formula,overall?,scope_note}`（明确不是学术质量判定）

## 诊断与修复

### POST /api/v1/reproductions/diagnostics  🔒
body: `{run_id, project_id}` → data: DiagnosticView 或 error=LLM_KEY_NOT_CONFIGURED（不伪造）
DiagnosticView: `{diagnostic_id,run_id,problem,error_evidence,possible_causes:[{cause,basis,confidence}],suggested_fix,needs_human_confirm,verification_method,ai_available,prompt_version,created_at}`

### POST /api/v1/reproductions/remediations/{proposal_id}/review  🔒
body: `{decision:"approve|reject|modify", reviewer, note?, modified_value?}` → `{review_id,status,original_preserved:true,...}`

## 报告

### POST /api/v1/reproductions/reports  🔒
body: `{project_id, plan_id?, run_ids?:[]}` → `{report_id,status,section_count,html_available,pdf_available,pdf_error?}`
### GET /api/v1/reproductions/reports/{report_id} → ReportView（含 sections，每节含 sources 证据引用）
### GET /api/v1/reproductions/reports/{report_id}/html → HTML 文本
### GET /api/v1/reproductions/reports/{report_id}/pdf → PDF 二进制（不可用则 501 + PDF_UNAVAILABLE）
### GET /api/v1/reproductions/reports?project_id=xxx → `{items,total}`

## 前端约定
- 新增 `src/services/reproductionApi.ts` 与 `src/types/reproduction.ts`，不改既有 api.ts 契约；
- 新增路由：`/projects/:pid/reproduction`（总览）、`/reproductions/plans/:planId`（规划DAG）、`/reproductions/runs/:runId`（控制台）、`/projects/:pid/reproduction/environment`、`/projects/:pid/reproduction/comparison`、`/projects/:pid/reproduction/diagnostics`、`/projects/:pid/reproduction/reports`；
- 所有状态来自后端，DAG 用后端 edges 渲染，禁止前端伪造进度；
- 执行禁用状态明确显示"当前环境不支持安全代码执行"，不显示假的运行成功。
