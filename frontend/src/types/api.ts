// 后端 API 契约类型定义 —— 字段名与大小写需与后端保持一致。

export type ApiErrorBody = {
  code: string
  message: string
  details: unknown
}

export type ApiResponse<T> = {
  success: boolean
  data: T | null
  error: ApiErrorBody | null
  request_id: string
}

/* ---------------- 健康检查 ---------------- */

export type HealthData = {
  status: string
  version: string
  timestamp: string
}

/* ---------------- LLM 模型服务 ---------------- */

export type TokenUsage = {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export type ConnectionStatus = 'unknown' | 'ok' | 'error'

export type LlmStatusData = {
  provider: string
  model: string
  api_key_configured: boolean
  connection_status: ConnectionStatus
  last_call_at: string | null
  last_call_duration_ms: number | null
  last_call_success: boolean | null
  last_token_usage: TokenUsage | null
}

export type LlmTestData = {
  success: boolean
  reply: string
  model: string
  duration_ms: number
  token_usage: TokenUsage | null
  tested_at: string
}

/* ---------------- 审计演示 ---------------- */

export type DemoAuditRequest = {
  project_name?: string
  material_a_text?: string
  material_b_text?: string
  use_default_materials?: boolean
}

export type ExtractedFact = {
  field_key: string
  raw_value: string
  normalized_value: string | number | null
  unit: string | null
  evidence_chunk_id: string
  confidence: number
}

export type MaterialFacts = {
  material_id: string
  facts: ExtractedFact[]
}

export type Material = {
  material_id: string
  source_name: string
  text: string
}

export type ComparisonStatus = 'conflict' | 'consistent' | 'missing'

export type Comparison = {
  field_key: string
  label: string
  value_a: string | number | null
  value_b: string | number | null
  status: ComparisonStatus
  evidence_a_id: string | null
  evidence_b_id: string | null
}

export type Evidence = {
  evidence_id: string
  source_name: string
  chunk_id: string
  original_text: string
}

export type Finding = {
  finding_id: string
  field_key: string
  severity: string
  title: string
  ai_explanation: string
  evidence: Evidence[]
}

export type LlmMeta = {
  calls: number
  total_tokens: number
  duration_ms: number
  model: string
}

export type AuditResult = {
  run_id: string
  status: string
  materials: Material[]
  extracted_facts: MaterialFacts[]
  comparisons: Comparison[]
  findings: Finding[]
  llm_meta: LlmMeta
}

/* ---------------- 项目 ---------------- */

export type Project = {
  id: string
  name: string
  domain: string
  paper_title: string
  description: string
  created_at: string
  owner_user_id?: string | null
  org_id?: string | null
}

export type ProjectsData = {
  items: Project[]
  total: number
}

export type CreateProjectRequest = {
  name: string
  domain: string
  paper_title: string
  description: string
  org_id?: string | null
  workspace_id?: string | null
}

/* ================= 第二阶段：材料 / 解析 / 事实 ================= */

/** 材料类型（与后端 MaterialType 字面量一致） */
export type MaterialType =
  | 'pdf'
  | 'python'
  | 'notebook'
  | 'zip'
  | 'yaml'
  | 'json'
  | 'toml'
  | 'requirements'
  | 'readme'
  | 'text'
  | 'csv'
  | 'xlsx'
  | 'code_repository'
  | 'unknown'

/** 材料 / 任务解析状态（与后端 ParseStatus 字面量一致） */
export type ParseStatus =
  | 'uploaded'
  | 'queued'
  | 'parsing'
  | 'extracting'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'unsupported'

/** 解析任务状态：覆盖后端 ParseStatus 及任务取消相关状态 */
export type TaskStatus =
  | 'uploaded'
  | 'queued'
  | 'running'
  | 'parsing'
  | 'extracting'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'unsupported'
  | 'cancelled'
  | 'cancel_requested'

/** GET /materials 列表项 */
export type MaterialView = {
  material_id: string
  project_id: string
  filename: string
  material_type: MaterialType
  size_bytes: number
  parse_status: ParseStatus
  sha256: string
  chunk_count: number
  fact_count: number
  created_at: string
  error_message: string | null
  external_url?: string | null
}

/** POST /materials/upload 响应 */
export type UploadMaterialResult = {
  material_id: string
  project_id: string
  filename: string
  material_type: MaterialType
  size_bytes: number
  parse_status: ParseStatus
  sha256: string
  created_at: string
}

export type MaterialsData = {
  items: MaterialView[]
  total: number
}

/** 解析告警：空页、跳过文件等 */
export type ParseWarning = {
  code: string
  message: string
  page_index: number | null
  line_number: number | null
}

/** GET /materials/{id} 详情 */
export type MaterialDetail = MaterialView & {
  metadata: Record<string, unknown>
  warnings: ParseWarning[]
  raw_preview: string
  can_preview: boolean
}

/** DELETE /materials/{id} 响应 */
export type DeleteMaterialResult = {
  deleted: boolean
  cascaded: {
    chunks: number
    facts: number
    evidence: number
  }
}

/** POST /materials/{id}/parse 响应 */
export type StartParseResult = {
  task_id: string
  material_id: string
  status: 'queued' | 'completed' | 'failed'
  idem_key: string
}

/** GET /parse-tasks/{id} 及列表项 */
export type ParseTaskView = {
  task_id: string
  material_id: string
  project_id: string
  status: TaskStatus
  stage: string
  stage_message: string
  started_at: string | null
  completed_at: string | null
  error_code: string | null
  error_message: string | null
  model: string
  model_calls: number
  total_tokens: number
  prompt_tokens: number
  completion_tokens: number
  duration_ms: number
  prompt_version: string
  facts_count: number
}

export type ParseTasksData = {
  items: ParseTaskView[]
  total: number
}

/** DELETE /parse-tasks/{id} 响应 */
export type CancelTaskResult = {
  cancelled: boolean
}

/* ---------------- 证据定位（按材料类型区分，不可混用） ---------------- */

export type PdfSourceLocator = {
  page_index: number
  viewer_page_number: number
  printed_page_number?: number | null
  page_number_source?: 'printed' | 'viewer'
  text_block_index?: number
  section?: string | null
  bbox?: number[] | null
}

export type CodeSourceLocator = {
  file_path: string
  start_line: number
  end_line: number
  cell_index?: number | null
  symbol?: string | null
}

export type ConfigSourceLocator = {
  file_path: string
  field_path: string
  original_key: string
  line_number?: number | null
}

export type DocSourceLocator = {
  section?: string | null
  start_line?: number | null
  end_line?: number | null
  block_index?: number
}

export type DataSourceLocator = {
  sheet_name?: string | null
  column_name?: string | null
  row_count?: number
}

export type SourceLocator =
  | PdfSourceLocator
  | CodeSourceLocator
  | ConfigSourceLocator
  | DocSourceLocator
  | DataSourceLocator

/** 证据视图（后端原文核对后的结果，不使用模型生成文本代替原文） */
export type EvidenceViewV2 = {
  evidence_id: string
  chunk_id: string
  quote: string
  source_name: string
  source_locator: SourceLocator | null
  verification_status: string
  original_text: string
}

/* ---------------- 科研事实 ---------------- */

export type AssertionType = 'explicit' | 'inferred' | 'ambiguous' | 'not_found'
export type ExtractionStatus = 'supported' | 'unsupported' | 'needs_review'
export type FactType =
  | 'research_info'
  | 'dataset'
  | 'model'
  | 'training_parameter'
  | 'metric'
  | 'environment'
  | 'runtime'
  | 'experiment_process'
  | 'other'

export type FactViewV2 = {
  fact_id: string
  project_id: string
  material_id: string
  fact_type: FactType
  field_key: string
  field_label: string
  raw_value: string
  normalized_value: string | number | null
  unit: string | null
  assertion_type: AssertionType
  extraction_status: ExtractionStatus
  parser_source: string
  extraction_run_id: string
  confidence: number
  evidence: EvidenceViewV2[]
  revision_count: number
  created_at: string
}

export type FactsData = {
  items: FactViewV2[]
  total: number
}

export type PatchFactBody = {
  field_key?: string
  field_label?: string
  raw_value?: string
  normalized_value?: string | number | null
  note?: string
}

export type FactRevision = {
  revision_id: string
  fact_id: string
  field_key: string
  old_value: string | number | null
  new_value: string | number | null
  revision_source: string
  note: string
  created_at: string
}

export type FactRevisionsData = {
  items: FactRevision[]
  total: number
}

export type FactsSummary = {
  total: number
  by_assertion: Record<AssertionType, number>
  by_status: Record<ExtractionStatus, number>
  with_evidence: number
  human_confirmed: number
  by_type: Record<string, number>
}

export type EvidenceGraphNode = {
  id: string
  type: 'fact' | 'evidence' | 'source_chunk' | 'material'
  label: string
  fact_id?: string
  evidence_id?: string
  chunk_id?: string
  material_id?: string
  project_id?: string
  field_key?: string
  value?: string | number | null
  extraction_status?: string
  verification_status?: string
  sha256?: string | null
  source_locator?: Record<string, unknown> | null
}

export type EvidenceGraphEdge = {
  source: string
  target: string
  type: 'supported_by' | 'quotes' | 'located_in'
}

export type EvidenceGraph = {
  project_id: string
  nodes: EvidenceGraphNode[]
  edges: EvidenceGraphEdge[]
  counts: {
    facts: number
    evidence: number
    materials: number
    source_chunks: number
    edges: number
  }
}

/* ---------------- 材料解析概览 ---------------- */

export type ParseOverview = {
  project_id: string
  materials: {
    total: number
    completed: number
    partially_completed: number
    failed: number
    pending: number
  }
  facts: {
    total: number
    with_evidence: number
    needs_review: number
    human_revised: number
  }
  llm: {
    total_calls: number
    total_tokens: number
  }
  by_type: Record<string, number>
}

/* ================= 第九阶段：能力驾驶舱（真实后端只读聚合 / 确定性验证） ================= */

/**
 * GET /projects/{id}/verdict-summary
 * 后端为增量聚合，字段可能扩展；这里保留索引签名，页面按实际收到的键渲染。
 */
export type VerdictSummary = {
  verdicts?: Record<string, number>
  verdict_labels?: Record<string, string>
  dimensions?: Record<string, {
    status?: string
    label?: string
    subtype?: string
    evidence_count?: number
    basis?: string
    [key: string]: unknown
  }>
  evidence_locator?: {
    total?: number
    with_location?: number
    ratio?: number | null
    [key: string]: unknown
  } | null
  scope_note?: string
  framework_note?: string
  counts?: Record<string, number>
  notes?: string[]
  [key: string]: unknown
}

/** POST /projects/{id}/chart-verification 后端逐条核对结果。 */
export type ChartVerification = {
  claim_id?: string | null
  metric_name?: string | null
  paper_values?: number[]
  result_values?: number[]
  diff?: number | null
  diff_details?: Array<Record<string, unknown>>
  method?: string
  evidence_missing?: string[]
  note?: string
  verdict?: string
  [key: string]: unknown
}

export type ChartVerificationResult = {
  captions: Array<Record<string, unknown>>
  table_claims: Array<Record<string, unknown>>
  plot_logic: Array<Record<string, unknown>>
  result_files: Array<Record<string, unknown>>
  verifications: ChartVerification[]
  summary: {
    total_claims?: number
    supported?: number
    conflicting?: number
    insufficient_data?: number
    [key: string]: unknown
  }
  limitations: string[]
  [key: string]: unknown
}

/** POST /projects/{id}/handoff/validate：仅校验，不写库。 */
export type HandoffManifest = {
  bundle_version?: string
  generated_at?: string
  project_id?: string
  files?: Record<string, { sha256?: string; size_bytes?: number; [key: string]: unknown }>
  counts?: Record<string, number>
  [key: string]: unknown
}

export type HandoffValidationResult = {
  valid: boolean
  import_mode: string
  manifest: HandoffManifest | null
  target_project_id?: string
  files: string[]
  note?: string
  [key: string]: unknown
}

/** GET /diagnosis/production-check */
export type ProductionCheckResult = {
  passed: boolean
  issues: string[]
  note: string
  [key: string]: unknown
}

/** POST /parse-tasks/recover-stale */
export type RecoverStaleResult = {
  recovered: number
  [key: string]: unknown
}
