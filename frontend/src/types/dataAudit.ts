/** 数据质量审计前端契约：与后端 /data-audits/* 的 data 信封一一对应。 */

export type DataAuditSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info'
  | 'unknown'

/** 证据：所有发现必须附带可定位的依据。 */
export interface DataAuditEvidence {
  file_path: string
  sample_id?: string
  field?: string
  code_location?: string
  paper_description?: string
  dataset_version?: string
  detail?: string
  log_ref?: string
}

export interface DataAuditFinding {
  rule_id: string
  rule_name: string
  severity: DataAuditSeverity
  message: string
  confidence: string
  evidence: DataAuditEvidence[]
  justification: string
  suggestion?: string
  affects?: string
}

export interface DataAuditReport {
  audit_id: string
  project_id: string
  created_at: string
  version: string
  scope: {
    data_roots: string[]
    code_files: number
    limits: Record<string, number>
    read_only: boolean
    external_calls: boolean
    [key: string]: unknown
  }
  findings: DataAuditFinding[]
  counts: Record<string, number>
  blocking_count: number
  stats: Record<string, unknown>
  rule_results: Record<string, string>
  duration_ms: number
}

export interface DataAuditRunSummary {
  audit_id: string
  created_at: string | null
  status: string
  finding_count: number
  blocking_count: number
  duration_ms: number
}

export interface DataAuditRule {
  rule_id: string
  name: string
  category: 'integrity' | 'leakage' | 'distribution' | 'preprocessing'
  default_severity: DataAuditSeverity
  description: string
}

export interface DataAuditRunRequest {
  files?: Array<{ name: string; text: string }>
  include_code_scan?: boolean
  max_files?: number
  sample_rows?: number
  max_rows?: number
}
