/** 统计学审计前端契约：与后端 /stats-audit/* 的 data 信封一一对应。 */

/** 六类可信度取值（后端 schema.Verdict 的唯一真源）。 */
export type StatsVerdict =
  | 'calculation_error'
  | 'method_inapplicable'
  | 'insufficient_evidence'
  | 'potential_bias'
  | 'needs_human_review'
  | 'verified'

/** 可复算证据：报告值、重算值、公式与重算输入。 */
export type StatsEvidence = {
  source?: string
  claimed?: Record<string, unknown>
  recomputed?: Record<string, unknown>
  formula?: string
  inputs?: Record<string, unknown>
  method?: string
  note?: string
}

/** 单条审计发现。 */
export type StatsFinding = {
  rule_id: string
  rule_name: string
  verdict: StatsVerdict
  verdict_label_zh: string
  category: string
  message: string
  evidence: StatsEvidence[]
  justification: string
  suggestion: string
  confidence: string
  affects: string
  causal_language_checked: boolean
}

/** 完整审计报告（POST /stats-audit/run 的 data）。 */
export type StatsReport = {
  report_id: string
  created_at: string
  version: string
  scope: Record<string, unknown>
  counts: Partial<Record<StatsVerdict, number>>
  blocking_count: number
  findings: StatsFinding[]
  computations: Record<string, unknown>
  limitations: string[]
}

/**
 * 单原语计算结果（POST /stats-audit/compute 的 data）。
 * 各原语会在七个公共字段之外附加自身结果（如 ci_low / pvalue），
 * 因此保留 unknown 索引签名，由使用方做类型守卫。
 */
export type StatsComputeResult = {
  supported: boolean
  value?: unknown
  values?: Record<string, unknown>
  formula?: string
  inputs?: Record<string, unknown>
  method?: string
  note?: string
  allowed_operations?: string[]
  [key: string]: unknown
}

/** 计算目录中的规则条目。 */
export type StatsCatalogRule = {
  rule_id: string
  name: string
  category: string
  default_verdict: string
  description: string
}

/** 审计能力目录（GET /stats-audit/catalog 的 data）。 */
export type StatsCatalog = {
  version: string
  verdicts: Array<{ value: StatsVerdict; label_zh: string }>
  rules: StatsCatalogRule[]
  operations: string[]
}

/** 请求体类型：用于约束前端出站参数形状。 */
export type StatsRunRequest = { experiment_statistics: Record<string, unknown> }
export type StatsComputeRequest = { operation: string; kwargs: Record<string, unknown> }
