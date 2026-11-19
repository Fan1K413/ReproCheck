CREATE TABLE app.ai_consents (
  id text PRIMARY KEY,
  org_id text,
  project_id text,
  user_id text NOT NULL,
  allow_external_llm boolean NOT NULL,
  scope text NOT NULL,
  granted_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE app.ai_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  run_type text NOT NULL,
  status text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  request_id text NOT NULL,
  task_type text,
  prompt_version text,
  material_id text,
  calls integer NOT NULL,
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  total_tokens integer NOT NULL,
  duration_ms integer NOT NULL,
  success boolean NOT NULL,
  error_code text,
  result_json text,
  created_at timestamptz NOT NULL,
  finished_at timestamptz
);
CREATE TABLE app.api_tokens (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  org_id text,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  scopes_json text NOT NULL,
  rate_limit_per_min integer NOT NULL,
  expires_at timestamptz,
  last_used_at timestamptz,
  is_revoked boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.audit_feedback (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  finding_id text,
  run_id text,
  user_id text NOT NULL,
  feedback_type text NOT NULL,
  context_json text,
  evidence_ref text NOT NULL,
  note text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_by text,
  resolved_at timestamptz
);
CREATE TABLE app.audit_findings (
  id integer PRIMARY KEY,
  run_id text NOT NULL,
  project_id text NOT NULL,
  field_key text NOT NULL,
  severity text NOT NULL,
  title text NOT NULL,
  ai_explanation text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.audit_rules (
  id text PRIMARY KEY,
  rule_key text NOT NULL UNIQUE,
  name text NOT NULL,
  domain text NOT NULL,
  description text NOT NULL,
  risk_level text NOT NULL,
  evidence_requirement text NOT NULL,
  current_version integer NOT NULL,
  is_enabled boolean NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE app.audit_trail (
  id text PRIMARY KEY,
  org_id text,
  project_id text,
  actor_user_id text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before_json text,
  after_json text,
  summary text NOT NULL,
  request_id text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.benchmark_cases (
  id text PRIMARY KEY,
  title text NOT NULL,
  doi text NOT NULL,
  source_url text NOT NULL,
  domain text NOT NULL,
  research_task text NOT NULL,
  model_architecture text NOT NULL,
  dataset_name text NOT NULL,
  code_repo_url text NOT NULL,
  code_commit text NOT NULL,
  license text NOT NULL,
  quality_level text NOT NULL,
  quality_evidence_json text,
  version integer NOT NULL,
  org_id text,
  is_public boolean NOT NULL,
  created_by text,
  summary text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE app.data_export_requests (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  org_id text,
  status text NOT NULL,
  file_path text,
  created_at timestamptz NOT NULL,
  completed_at timestamptz
);
CREATE TABLE app.execution_artifacts (
  id integer PRIMARY KEY,
  artifact_id text NOT NULL,
  run_id text NOT NULL,
  project_id text NOT NULL,
  name text NOT NULL,
  path text,
  size_bytes integer NOT NULL,
  hash text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.execution_environments (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  material_id text,
  python_version text,
  frameworks_json text NOT NULL,
  dependencies_json text NOT NULL,
  hardware_json text NOT NULL,
  entrypoints_json text NOT NULL,
  missing_json text NOT NULL,
  warnings_json text NOT NULL,
  changed_from_original_json text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.execution_logs (
  id integer PRIMARY KEY,
  log_id text NOT NULL,
  run_id text NOT NULL,
  project_id text NOT NULL,
  stream text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.failure_diagnostics (
  id text PRIMARY KEY,
  run_id text NOT NULL,
  project_id text NOT NULL,
  problem text NOT NULL,
  error_evidence text NOT NULL,
  possible_causes_json text NOT NULL,
  suggested_fix text NOT NULL,
  verification_method text NOT NULL,
  needs_human_confirm boolean NOT NULL,
  ai_available boolean NOT NULL,
  prompt_version text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.knowledge_documents (
  id text PRIMARY KEY,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  org_id text,
  is_public boolean NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.metric_comparisons (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  metric_name text NOT NULL,
  paper_value text,
  reproduced_value text,
  unit text,
  diff_absolute text,
  diff_relative text,
  verdict text NOT NULL,
  rule text NOT NULL,
  tolerance_basis text NOT NULL,
  conditions_json text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  domain text NOT NULL,
  paper_title text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  owner_user_id text,
  org_id text,
  workspace_id text
);
CREATE TABLE app.remediation_proposals (
  id text PRIMARY KEY,
  diagnostic_id text NOT NULL,
  project_id text NOT NULL,
  change_type text NOT NULL,
  target_file text,
  original_value text,
  proposed_value text,
  changes_research_conditions boolean NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.remediation_reviews (
  id text PRIMARY KEY,
  proposal_id text NOT NULL,
  decision text NOT NULL,
  reviewer text NOT NULL,
  reviewer_user_id text,
  note text NOT NULL,
  modified_value text,
  original_preserved boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.repository_connections (
  id text PRIMARY KEY,
  org_id text,
  user_id text NOT NULL,
  provider text NOT NULL,
  account_label text NOT NULL,
  auth_type text NOT NULL,
  token_encrypted text,
  scopes_json text,
  status text NOT NULL,
  repo_allowlist_json text,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE app.reproduction_metrics (
  id integer PRIMARY KEY,
  metric_name text NOT NULL,
  metric_value text,
  unit text,
  source text NOT NULL,
  extraction_method text NOT NULL,
  experiment text,
  dataset text,
  run_id text NOT NULL,
  project_id text NOT NULL,
  confidence text NOT NULL,
  needs_manual_review boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.reproduction_plans (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  source text NOT NULL,
  ai_available boolean NOT NULL,
  prompt_version text,
  model text,
  feasibility_summary_json text,
  source_refs_json text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.reproduction_reports (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  version integer NOT NULL,
  sections_json text NOT NULL,
  html text,
  pdf_path text,
  scope_note text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.reproduction_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  plan_id text NOT NULL,
  task_ids_json text NOT NULL,
  status text NOT NULL,
  execution_enabled boolean NOT NULL,
  security_check_json text NOT NULL,
  environment_id text,
  requested_by text NOT NULL,
  requested_by_user_id text,
  workdir text,
  cancel_requested boolean NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms integer NOT NULL,
  cpu_seconds text,
  memory_mb text,
  error_message text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.api_call_logs (
  id text PRIMARY KEY,
  token_id text NOT NULL REFERENCES app.api_tokens (id),
  endpoint text NOT NULL,
  method text NOT NULL,
  status_code integer NOT NULL,
  duration_ms integer NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.audit_rule_versions (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES app.audit_rules (id),
  version integer NOT NULL,
  check_logic_json text NOT NULL,
  change_note text NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL,
  is_active boolean NOT NULL,
  UNIQUE (rule_id, version)
);
CREATE TABLE app.case_facts (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES app.benchmark_cases (id),
  field_key text NOT NULL,
  raw_field text NOT NULL,
  raw_value text NOT NULL,
  normalized_value text NOT NULL,
  unit text NOT NULL,
  source_type text NOT NULL,
  source_ref text NOT NULL,
  context text NOT NULL,
  applicable_experiment text NOT NULL,
  confidence text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.case_verifications (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES app.benchmark_cases (id),
  verifier_user_id text,
  verification_type text NOT NULL,
  conditions_json text,
  result text NOT NULL,
  notes text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.comments (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES app.projects (id),
  author_user_id text NOT NULL REFERENCES app.users (id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE app.evidences (
  id integer PRIMARY KEY,
  evidence_id text NOT NULL,
  finding_id integer NOT NULL REFERENCES app.audit_findings (id),
  project_id text NOT NULL,
  material_id text NOT NULL,
  chunk_id text NOT NULL,
  source_name text NOT NULL,
  locator_type text NOT NULL,
  page_number integer,
  line_number integer,
  original_text text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.materials (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES app.projects (id),
  source_name text NOT NULL,
  material_type text NOT NULL,
  raw_text text NOT NULL,
  created_at timestamptz NOT NULL,
  original_filename text,
  stored_path text,
  file_size_bytes integer NOT NULL,
  sha256 text,
  mime_type text,
  parse_status text NOT NULL,
  parser_version text,
  parse_error_code text,
  parse_error_message text,
  parse_duration_ms integer NOT NULL,
  page_count integer,
  needs_ocr boolean NOT NULL,
  parse_metadata_json text,
  warnings_json text
);
CREATE TABLE app.organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text NOT NULL,
  owner_user_id text REFERENCES app.users (id),
  created_at timestamptz NOT NULL
);
CREATE TABLE app.project_members (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES app.projects (id),
  user_id text NOT NULL REFERENCES app.users (id),
  role_key text NOT NULL,
  added_by text,
  added_at timestamptz NOT NULL,
  UNIQUE (project_id, user_id)
);
CREATE TABLE app.repository_snapshots (
  id text PRIMARY KEY,
  connection_id text NOT NULL REFERENCES app.repository_connections (id),
  project_id text,
  repo_full_name text NOT NULL,
  default_branch text NOT NULL,
  commit_sha text NOT NULL,
  tag text NOT NULL,
  branch text NOT NULL,
  version_diff_json text,
  fetched_at timestamptz NOT NULL
);
CREATE TABLE app.reproduction_tasks (
  id text PRIMARY KEY,
  plan_id text NOT NULL REFERENCES app.reproduction_plans (id),
  project_id text NOT NULL,
  task_key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  depends_on_json text NOT NULL,
  required_materials_json text NOT NULL,
  action text NOT NULL,
  expected_result text NOT NULL,
  acceptance_criteria text NOT NULL,
  evidence_refs_json text NOT NULL,
  risk text NOT NULL,
  feasibility text NOT NULL,
  feasibility_reason text NOT NULL,
  needs_human_confirm boolean NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (plan_id, task_key)
);
CREATE TABLE app.review_requests (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES app.projects (id),
  target_type text NOT NULL,
  target_id text NOT NULL,
  requested_by text NOT NULL REFERENCES app.users (id),
  reviewer_user_id text REFERENCES app.users (id),
  status text NOT NULL,
  decision_note text NOT NULL,
  created_at timestamptz NOT NULL,
  decided_at timestamptz
);
CREATE TABLE app.rule_evaluations (
  id text PRIMARY KEY,
  rule_id text NOT NULL REFERENCES app.audit_rules (id),
  version integer NOT NULL,
  dataset_ref text NOT NULL,
  metrics_json text NOT NULL,
  ran_by text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.extracted_facts (
  id integer PRIMARY KEY,
  run_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL REFERENCES app.materials (id),
  chunk_id text NOT NULL,
  field_key text NOT NULL,
  raw_value text NOT NULL,
  normalized_value text,
  unit text,
  confidence text NOT NULL,
  fact_id text,
  fact_type text NOT NULL,
  field_label text,
  assertion_type text NOT NULL,
  extraction_status text NOT NULL,
  parser_source text NOT NULL,
  extraction_run_id text,
  quote text,
  source_locator_json text,
  source_name text,
  revision_count integer NOT NULL,
  ai_original_json text,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.invitations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES app.organizations (id),
  email text NOT NULL,
  role_key text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  invited_by text,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz
);
CREATE TABLE app.notebook_cells (
  id text PRIMARY KEY,
  material_id text NOT NULL REFERENCES app.materials (id),
  cell_id text NOT NULL,
  cell_type text NOT NULL,
  source text NOT NULL,
  execution_count integer,
  outputs_json text,
  order_index integer NOT NULL
);
CREATE TABLE app.org_members (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES app.organizations (id),
  user_id text NOT NULL REFERENCES app.users (id),
  role_key text NOT NULL,
  joined_at timestamptz NOT NULL,
  UNIQUE (org_id, user_id)
);
CREATE TABLE app.rule_test_samples (
  id text PRIMARY KEY,
  rule_version_id text NOT NULL REFERENCES app.audit_rule_versions (id),
  input_json text NOT NULL,
  expected_json text NOT NULL,
  label text NOT NULL
);
CREATE TABLE app.source_chunks (
  id integer PRIMARY KEY,
  material_id text NOT NULL REFERENCES app.materials (id),
  chunk_id text NOT NULL,
  chunk_index integer NOT NULL,
  original_text text NOT NULL,
  locator_type text NOT NULL,
  page_number integer,
  line_number integer,
  created_at timestamptz NOT NULL,
  project_id text,
  material_type text,
  content_hash text,
  parser_version text,
  source_locator_json text,
  token_estimate integer NOT NULL,
  UNIQUE (material_id, chunk_id)
);
CREATE TABLE app.teams (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES app.organizations (id),
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.workspaces (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES app.organizations (id),
  name text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE app.team_members (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES app.teams (id),
  user_id text NOT NULL REFERENCES app.users (id),
  role_in_team text NOT NULL,
  joined_at timestamptz NOT NULL,
  UNIQUE (team_id, user_id)
);
