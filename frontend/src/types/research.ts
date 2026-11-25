/** 第十一阶段新功能 DTO。 */
export type RunOption = {
  id: string
  status: string
  plan_id: string
  started_at: string | null
  duration_ms: number
  error_message: string | null
}

export type ConditionDiff = { dimension: string; status: string; unknown: boolean }
export type MetricDiff = {
  metric: string
  values: (number | null)[]
  absolute_diff: number | null
  relative_diff: number | null
  changed: boolean
  unknown: boolean
}
export type Explanation = { condition: string; metrics: string[]; text: string; relation: string }

export type DiffReport = {
  project_id: string
  run_ids: string[]
  snapshots: Record<string, unknown>[]
  conditions: ConditionDiff[]
  metric_diffs: MetricDiff[]
  possible_explanations: Explanation[]
  undetermined: string[]
  rerun_recommendation: { recommendation: string; reason: string }
  affected_audit_conclusions: Array<{ id: string; metric: string; verdict: string; impact: string }>
  causality_notice: string
}

export type ChangedFile = { path: string; status: string; category: string }
export type ChangeAnalysis = {
  project_id: string
  status: string
  reason?: string
  old_commit?: string
  new_commit?: string
  new_snapshot_id?: string
  commit_message?: string
  changed_files: ChangedFile[]
  categories: string[]
  affected_facts: Array<{ id: string; field: string; matched_file: string; impact: string }>
  affected_runs: Array<{ id: string; status: string; impact: string }>
  affected_conclusions: Array<{ id: string; metric: string; verdict: string; impact: string }>
  suggestions: Array<{ severity: string; title: string; reason: string; requires_confirmation: boolean }>
  notice?: string
}
