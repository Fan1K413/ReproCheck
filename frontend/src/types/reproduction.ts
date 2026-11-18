// 第四阶段「科研复现工作台」API 契约类型。
// 字段名/枚举字面量严格对齐 docs/API_CONTRACT_STAGE4.md 与后端 models/stage4.py。
// 所有数据均来自后端，前端不生成任何统计、进度或诊断结论。

/* ---------------- 通用信封辅助 ---------------- */

export type ReproList<T> = {
  items: T[]
  total: number
}

/* ---------------- 枚举联合体 ---------------- */

/** 任务可行性（后端静态检查结论） */
export type TaskFeasibility =
  | 'ready'
  | 'missing_material'
  | 'missing_dependency'
  | 'missing_configuration'
  | 'needs_human_review'
  | 'blocked_security'
  | 'unverifiable'

/** 复现任务状态 */
export type ReproTaskStatus =
  | 'pending'
  | 'blocked'
  | 'confirmed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** 复现规划状态 */
export type ReproPlanStatus = 'draft' | 'active' | 'completed' | 'archived' | 'blocked'

/** 复现运行状态（含无沙箱/安全拦截的阻塞态） */
export type ReproRunStatus =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'cancel_requested'
  | 'blocked_no_sandbox'
  | 'blocked_security'

/** 指标对照判定 */
export type ComparisonVerdict =
  | 'exact_match'
  | 'within_tolerance'
  | 'significant_deviation'
  | 'insufficient_data'
  | 'not_comparable'
  | 'needs_manual_review'

/** 人工审核决定 */
export type RemediationDecision = 'approve' | 'reject' | 'modify'

/* ---------------- 规划 / DAG ---------------- */

/** feasibility_summary 的键由后端聚合给出，可能扩展，故使用索引签名。 */
export type FeasibilitySummary = Record<string, number>

export type PlanView = {
  plan_id: string
  project_id: string
  title: string
  status: ReproPlanStatus
  task_count: number
  feasibility_summary: FeasibilitySummary
  created_at: string
  ai_available?: boolean
  prompt_version?: string | null
  source?: string
}

export type PlanDetail = PlanView & {
  tasks: ReproTaskView[]
  dag: ReproductionDag
}

export type CreatePlanRequest = {
  project_id: string
  title?: string
}

/** POST plans 返回体即 PlanView 形态（含 ai_available / prompt_version）。 */
export type CreatePlanResult = PlanView

export type ReproTaskView = {
  task_id: string
  plan_id: string
  task_key: string
  title: string
  description: string
  depends_on: string[]
  required_materials: string[]
  action: string
  expected_result: string
  acceptance_criteria: string
  evidence_refs: string[]
  risk: string
  feasibility: TaskFeasibility
  feasibility_reason: string
  needs_human_confirm: boolean
  status: ReproTaskStatus
  created_at: string
}

export type CreateTaskRequest = {
  title: string
  description: string
  depends_on: string[]
  required_materials: string[]
  action: string
  expected_result: string
  acceptance_criteria: string
  risk: string
  needs_human_confirm: boolean
  evidence_refs: string[]
}

export type ConfirmTaskResult = {
  confirmed: boolean
  status: ReproTaskStatus
}

export type DagNode = {
  id: string
  label: string
  status: ReproTaskStatus | string
  feasibility: TaskFeasibility | string
}

export type DagEdge = {
  from: string
  to: string
}

export type ReproductionDag = {
  nodes: DagNode[]
  edges: DagEdge[]
}

/* ---------------- 运行 / 执行 ---------------- */

export type SecurityFinding = Record<string, unknown>

export type ReproRunView = {
  run_id: string
  plan_id: string
  status: ReproRunStatus
  execution_enabled: boolean
  /** 契约字段；模型层可能缺省，这里声明为可选以兼容。 */
  security_blocked?: boolean
  security_reason?: string | null
  security_check: {
    passed: boolean
    reason?: string
    findings: SecurityFinding[]
  }
  environment_id: string | null
  started_at: string | null
  finished_at: string | null
  duration_ms: number | null
  resource_usage: {
    cpu_seconds?: number | null
    memory_mb?: number | null
  }
  error_message: string | null
  created_at: string
}

export type CreateRunRequest = {
  plan_id: string
  task_ids?: string[]
  requested_by: string
  environment_id?: string
}

export type CancelRunResult = {
  cancelled: boolean
  status: ReproRunStatus
}

export type LogEntry = {
  log_id: string
  stream: string
  content: string
  created_at: string
}

export type ArtifactEntry = {
  artifact_id: string
  name: string
  path: string | null
  size_bytes: number
  hash: string | null
  created_at: string
}

export type MetricView = {
  metric_id?: string
  metric_name: string
  metric_value: number | null
  unit: string | null
  source: string
  extraction_method: string
  experiment?: string | null
  dataset?: string | null
  confidence?: number
  needs_manual_review?: boolean
  created_at?: string
}

/* ---------------- 环境 ---------------- */

export type DependencyView = {
  name: string
  declared_version: string | null
  source: string
}

export type EnvironmentView = {
  environment_id: string
  project_id: string
  python_version: string | null
  frameworks: Record<string, unknown>
  dependencies: DependencyView[]
  /** 后端返回的硬件要求可能为对象或文本，渲染层统一安全展示。 */
  hardware_requirements: unknown
  entrypoints: string[]
  missing: string[]
  warnings: string[]
  created_at: string
  changed_from_original?: string[]
}

/* ---------------- 指标对照 / 质量 ---------------- */

export type ConditionsCheck = {
  same_dataset: boolean | null
  same_split: boolean | null
  same_metric: boolean | null
  same_preprocessing: boolean | null
  same_hyperparams: boolean | null
  same_seed: boolean | null
  environment_diff: boolean | null
  [key: string]: boolean | null | undefined
}

export type ComparisonView = {
  comparison_id: string
  metric_name: string
  paper_value: number | null
  reproduced_value: number | null
  unit: string | null
  diff_absolute: number | null
  diff_relative: number | null
  verdict: ComparisonVerdict
  rule: string
  tolerance_basis: string
  conditions_check: ConditionsCheck
  created_at: string
}

export type QualityDimension = {
  key: string
  label: string
  score: number
  max: number
  weight: number
  basis: string
  missing: string[]
}

export type QualityView = {
  dimensions: QualityDimension[]
  formula: string
  overall?: number | null
  /** 明确声明该评分不是学术质量判定。 */
  scope_note: string
}

/* ---------------- 诊断 / 修复 ---------------- */

export type PossibleCause = {
  cause: string
  basis: string
  confidence: number
}

/** 后端可能随诊断返回可人工审核的修复提案；字段以实际返回为准。 */
export type RemediationProposalView = {
  proposal_id?: string
  change_type?: string
  target_file?: string | null
  original_value?: string | null
  proposed_value?: string | null
  changes_research_conditions?: boolean
  status?: string
}

export type DiagnosticView = {
  diagnostic_id: string
  run_id: string
  problem: string
  error_evidence: string
  possible_causes: PossibleCause[]
  suggested_fix: string
  needs_human_confirm: boolean
  verification_method: string
  ai_available: boolean
  prompt_version: string | null
  created_at: string
  remediation_proposals?: RemediationProposalView[]
  proposal_id?: string | null
}

export type CreateDiagnosticRequest = {
  run_id: string
  project_id: string
}

export type ReviewRemediationRequest = {
  decision: RemediationDecision
  reviewer: string
  note?: string
  modified_value?: string
}

export type ReviewRemediationResult = {
  review_id: string
  status: string
  original_preserved: boolean
  [key: string]: unknown
}

/* ---------------- 报告 ---------------- */

export type ReportSource = {
  evidence_id?: string
  source_id?: string
  label?: string
  title?: string
  quote?: string
  source_name?: string
  locator?: unknown
  [key: string]: unknown
}

export type ReportConclusion = {
  text?: string
  statement?: string
  sources?: Array<ReportSource | string>
  [key: string]: unknown
}

/** 章节结构可能因模板扩展；保留索引签名以安全容纳后端附加字段。 */
export type ReportSection = {
  section_id?: string
  key?: string
  index?: number
  /** 后端报告生成器使用 chapter 字段，部分模板可能改用 title。 */
  chapter?: string
  title?: string
  origin?: string
  summary?: string
  content?: string
  conclusions?: ReportConclusion[]
  key_conclusions?: ReportConclusion[]
  sources?: Array<ReportSource | string>
  [key: string]: unknown
}

export type ReportView = {
  report_id: string
  project_id: string
  title: string
  status: string
  version: number
  /** 列表接口返回该字段；详情接口以 sections 数组为准，可能缺省。 */
  section_count?: number
  html_available: boolean
  pdf_available: boolean
  pdf_error?: string | null
  scope_note: string
  sections: ReportSection[]
  created_at: string
}

export type CreateReportRequest = {
  project_id: string
  plan_id?: string
  run_ids?: string[]
}

export type CreateReportResult = Pick<
  ReportView,
  'report_id' | 'status' | 'section_count' | 'html_available' | 'pdf_available'
> & {
  pdf_error?: string | null
}
