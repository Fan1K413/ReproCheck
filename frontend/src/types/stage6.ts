/* 第六阶段：团队协作平台实体类型（与后端 services 视图一一对应）。 */

/* ---------------- 认证 / 组织 ---------------- */

export type AuthUser = {
  id: string
  email: string
  display_name: string
  is_platform_admin: boolean
  created_at: string
  last_login_at: string | null
}

export type AuthResult = { token: string; user: AuthUser }

export type OrgSummary = { id: string; name: string; slug: string; role_key: string }

export type MeData = { user: AuthUser; organizations: OrgSummary[] }

export type Organization = {
  id: string
  name: string
  slug: string
  description: string
  owner_user_id: string
  created_at: string
  role_key?: string
}

export type OrgMember = {
  user_id: string
  email: string
  display_name: string
  role_key: string
  joined_at: string
}

export type Invitation = {
  id: string
  email: string
  role_key: string
  status: string
  expires_at: string
  created_at?: string
}

export type InvitationCreated = Invitation & { token: string }

export type Team = { id: string; name: string; description: string; member_count: number }

export type TeamMember = { user_id: string; email: string; role_in_team: string }

export type Workspace = { id: string; name: string; description: string }

/* ---------------- RBAC ---------------- */

export type Role = { key: string; name: string; scope: string; description: string }

export type Permission = { key: string; description: string }

export type RolePermissions = { role_key: string; permissions: Permission[] }

/* ---------------- 项目协作 ---------------- */

export type ProjectMember = {
  user_id: string
  email: string
  display_name: string
  role_key: string
  added_at: string
}

export type Comment = {
  id: string
  target_type: string
  target_id: string
  body: string
  author_user_id: string
  author_name: string
  created_at: string
}

export type ReviewRequest = {
  id: string
  target_type: string
  target_id: string
  status: string
  requested_by: string
  reviewer_user_id: string | null
  decision_note: string
  created_at: string
  decided_at: string | null
}

export type ActivityItem = {
  id: string
  action: string
  actor_user_id: string | null
  target_type: string | null
  target_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  summary: string
  created_at: string
}

export type ActivityData = { items: ActivityItem[]; total: number; limit: number; offset: number }

/* ---------------- 基准案例库 ---------------- */

export type Traceability = {
  has_source: boolean
  has_code: boolean
  has_code_commit: boolean
  has_license: boolean
  complete: boolean
  redistribution: string
  warnings: string[]
}

export type QualityEvidence = {
  level?: string
  computed_level?: string
  previous_level?: string
  rule_version?: string
  computed_at?: string
  downgrade_blocked?: boolean
  confirm_downgrade?: boolean
  basis?: { verification_id: string; verification_type: string; result: string; verifier_user_id: string | null; created_at: string; reason: string }[]
  supporting?: { verification_id: string; verification_type: string; result: string; verifier_user_id: string | null; created_at: string; reason: string }[]
  environment?: Record<string, unknown>
  independent_reviewer_user_id?: string | null
  counts?: Record<string, number>
  notes?: string[]
}

export type BenchmarkCase = {
  id: string
  title: string
  doi: string
  source_url: string
  domain: string
  research_task: string
  model_architecture: string
  dataset_name: string
  code_repo_url: string
  code_commit: string
  license: string
  quality_level: string
  quality_label: string
  quality_evidence: QualityEvidence
  version: number
  org_id: string | null
  is_public: boolean
  created_by: string
  created_by_name?: string
  summary: string
  traceability: Traceability
  fact_count?: number
  verification_count?: number
  verifications?: CaseVerification[]
  quality_standard?: QualityStandard
  created_at: string
  updated_at: string
}

export type CaseListData = {
  items: BenchmarkCase[]
  total: number
  limit: number
  offset: number
  sort: string
}

export type CaseFact = {
  id: string
  case_id: string
  field_key: string
  label: string
  label_en: string
  category: string
  category_label: string
  is_standard: boolean
  raw_field: string
  raw_value: string
  normalized_value: string
  unit: string
  source_type: string
  source_ref: string
  context: string
  applicable_experiment: string
  confidence: number
  created_at: string
}

export type CaseVerification = {
  id: string
  case_id: string
  verification_type: string
  result: string
  verifier_user_id: string
  verifier_name: string
  conditions: Record<string, unknown>
  conditions_json: string
  notes: string
  created_at: string
}

export type QualityStandard = {
  rule_version: string
  levels: { key: string; label: string; requirement: string }[]
  verification_types: string[]
  results: string[]
  environment_keys: string[]
  principles: string[]
}

export type QualityRecomputeResult = {
  case_id: string
  quality_level: string
  quality_label: string
  computed_level: string
  previous_level: string
  changed: boolean
  downgrade_blocked: boolean
  quality_evidence: QualityEvidence
  verification_count: number
}

export type VerificationCreated = QualityRecomputeResult & { verification: CaseVerification }

export type CaseSearchHit = {
  case: BenchmarkCase
  score: number
  match_basis: string[]
  matched_fields: string[]
  text_similarity: number
  provenance_class: string
  usage_note: string
}

export type CaseSearchData = {
  items: CaseSearchHit[]
  query: string
  total: number
  top_k: number
  provenance_class: string
  disclaimer: string
  algorithm: string
  score_weights: Record<string, number>
  search_fields: Record<string, { weight: number; label: string }>
}

/* ---------------- 事实字段目录 ---------------- */

export type FactSchemaField = {
  field_key: string
  label: string
  label_en: string
  category: string
  category_label: string
  unit: string
  value_type: string
  value_type_label: string
  aliases: string[]
  is_numeric: boolean
}

export type FactSchemaData = {
  version: string
  total: number
  categories: { key: string; label: string; field_count: number }[]
  fields: FactSchemaField[]
  normalization_rules: string[]
}

/* ---------------- 审计规则 ---------------- */

export type AuditRule = {
  id: string
  rule_key: string
  name: string
  domain: string
  description: string
  risk_level: string
  evidence_requirement: string
  current_version: number
  is_enabled: boolean
  created_by: string | null
  created_at: string
  updated_at: string
  check_logic?: Record<string, unknown>
}

export type RuleVersion = {
  id: string
  rule_id: string
  version: number
  check_logic: Record<string, unknown>
  change_note: string
  is_active: boolean
  created_by: string | null
  sample_count: number
  created_at: string
}

export type RuleTestSample = {
  id: string
  label: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
}

export type RuleDetail = AuditRule & {
  check_logic: Record<string, unknown>
  active_version: RuleVersion
  test_samples: RuleTestSample[]
}

export type RuleTestResult = {
  rule_id: string
  version: number
  total: number
  passed: number
  failed: number
  pass_rate: number
  results: {
    sample_id: string
    label: string
    passed: boolean
    expected: Record<string, unknown>
    actual: Record<string, unknown>
    error: string | null
  }[]
}

export type RuleMetrics = {
  precision: number
  recall: number
  fp_rate: number
  fn_rate: number
  accuracy: number
  pass_rate: number
  [key: string]: number
}

export type RuleEvaluation = {
  id: string
  rule_id: string
  version: number
  dataset_ref: string
  metrics: RuleMetrics
  ran_by: string | null
  ran_by_name: string | null
  created_at: string
}

export type RuleEvalSingle = {
  rule_id: string
  version: number
  dataset_ref: string
  metrics: RuleMetrics
  results: unknown[]
}

export type RuleEvalCompare = {
  rule_id: string
  dataset_ref: string
  baseline: { version: number; metrics: RuleMetrics; results: unknown[] }
  candidate: { version: number; metrics: RuleMetrics; results: unknown[] }
  delta: Record<string, number>
}

export type RuleSeedResult = { seeded: string[]; skipped: string[]; total: number }

/* ---------------- 反馈治理 ---------------- */

export type Feedback = {
  id: string
  project_id: string
  finding_id: string | null
  run_id: string | null
  user_id: string
  user_name: string | null
  feedback_type: string
  note: string
  evidence_ref: string
  context: Record<string, unknown>
  status: string
  created_at: string
  resolved_by: string | null
  resolved_by_name: string | null
  resolved_at: string | null
}

/* ---------------- 受控 RAG ---------------- */

export type KnowledgeDocument = {
  id: string
  source_type: string
  source_ref: string
  title: string
  content: string
  org_id: string | null
  is_public: boolean
  created_by: string
  provenance_class: string
  created_at: string
}

export type RagHit = {
  document: KnowledgeDocument
  score: number
  source_ref: string
  provenance_class: string
}

export type RagSynthesis = {
  provenance_class: string
  answer: string
  model: string
  sources: { index: number; source_ref: string; provenance_class: string; document_id: string }[]
}

export type RagQueryData = {
  query: string
  project_id: string | null
  top_k: number
  hits: RagHit[]
  total_candidates: number
  provenance: {
    classes: Record<string, string>
    current_evidence_priority: string
    note: string
  }
  synthesis: RagSynthesis | null
}

/* ---------------- 外部集成 ---------------- */

export type RepositoryConnection = {
  connection_id: string
  provider: string
  account_label: string
  auth_type: string
  status: string
  org_id: string | null
  repo_allowlist: string[]
  has_token: boolean
  created_at: string
  revoked_at: string | null
}

export type RepoSnapshot = {
  snapshot_id: string
  connection_id: string
  repo_full_name: string
  default_branch: string
  commit_sha: string
  tag: string
  branch: string
  status: string
  detail: Record<string, unknown>
  fetched_at: string
}

export type NotebookOutput = {
  output_type?: string
  name?: string
  text?: string | string[]
  data?: Record<string, unknown>
  ename?: string
  evalue?: string
  traceback?: string[]
}

export type NotebookCell = {
  cell_id: string
  nb_cell_id: string
  cell_type: string
  source: string
  execution_count: number | null
  order_index: number
  output_count: number
  outputs: NotebookOutput[]
}

export type NotebookData = { material_id: string; cell_count: number; cells: NotebookCell[] }

/* ---------------- 开放 API ---------------- */

export type ApiToken = {
  token_id: string
  name: string
  prefix: string
  scopes: string[]
  rate_limit_per_min: number
  org_id: string | null
  is_revoked: boolean
  expires_at: string | null
  last_used_at: string | null
  created_at: string
}

export type ApiTokenCreated = ApiToken & { token: string }

export type ApiCallLog = {
  log_id: string
  endpoint: string
  method: string
  status_code: number
  duration_ms: number
  created_at: string
}

/* ---------------- 数据治理 ---------------- */

export type DataClass = {
  level: string
  label: string
  examples: string[]
  handling: string
}

export type ClassificationData = { classes: DataClass[]; principle: string }

export type AiConsent = {
  consent_id: string
  org_id: string | null
  project_id: string | null
  allow_external_llm: boolean
  scope: string
  granted_at: string
  revoked_at: string | null
}

export type ConsentData = {
  active: AiConsent | null
  require_ai_consent: boolean
  history?: AiConsent[]
}

export type ExportRequest = {
  export_id: string
  status: string
  file_available: boolean
  created_at: string
  completed_at: string | null
}

export type RetentionPolicy = {
  default_days: number
  rules: { data: string; retention: string }[]
  note: string
}

/* ---------------- 通用列表信封 ---------------- */

export type Items<T> = { items: T[]; total: number }