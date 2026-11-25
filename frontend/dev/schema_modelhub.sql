-- 第十一阶段：Site 版模型中心 7 张表（托管 PostgreSQL / app schema）。
-- 部署方式：在 Qoder Sites 数据库迁移中按 app schema 执行；与 backend/app/models/modelhub.py 对齐。
CREATE TABLE IF NOT EXISTS app.model_providers (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, name text NOT NULL,
  protocol text NOT NULL, default_base_url text NOT NULL DEFAULT '',
  capabilities_json text NOT NULL DEFAULT '[]', default_models_json text NOT NULL DEFAULT '[]',
  docs_url text NOT NULL DEFAULT '', is_builtin boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT true, created_at timestamptz
);
CREATE TABLE IF NOT EXISTS app.model_credentials (
  id text PRIMARY KEY, owner_user_id text NOT NULL, org_id text,
  provider_key text NOT NULL, name text NOT NULL DEFAULT '',
  key_ciphertext text NOT NULL, key_hint text NOT NULL DEFAULT '',
  base_url text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active',
  last_error_code text, last_tested_at timestamptz,
  created_at timestamptz, updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_modelcred_owner ON app.model_credentials(owner_user_id);
CREATE INDEX IF NOT EXISTS ix_modelcred_provider ON app.model_credentials(provider_key);
CREATE TABLE IF NOT EXISTS app.model_profiles (
  id text PRIMARY KEY, owner_user_id text NOT NULL, org_id text,
  provider_key text NOT NULL, credential_id text, model_id text NOT NULL,
  display_name text NOT NULL DEFAULT '', params_json text NOT NULL DEFAULT '{}',
  timeout_s double precision NOT NULL DEFAULT 60, max_retries integer NOT NULL DEFAULT 1,
  max_tokens integer, enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false, is_fallback boolean NOT NULL DEFAULT false,
  created_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_modelprofile_owner ON app.model_profiles(owner_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_modelprofile ON app.model_profiles(owner_user_id, provider_key, model_id);
CREATE TABLE IF NOT EXISTS app.task_model_bindings (
  id text PRIMARY KEY, owner_user_id text NOT NULL, org_id text, project_id text,
  task_key text NOT NULL, primary_profile_id text, fallback_profile_id text,
  params_json text NOT NULL DEFAULT '{}', auto_route boolean NOT NULL DEFAULT false,
  cost_preference text NOT NULL DEFAULT 'balanced', enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz, updated_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_taskbind_owner_task ON app.task_model_bindings(owner_user_id, task_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_taskbind_scope ON app.task_model_bindings(owner_user_id, org_id, project_id, task_key);
CREATE TABLE IF NOT EXISTS app.model_call_logs (
  id text PRIMARY KEY, request_id text NOT NULL, owner_user_id text, org_id text,
  task_key text NOT NULL DEFAULT '', provider_key text NOT NULL DEFAULT '',
  model_id text NOT NULL DEFAULT '', success boolean NOT NULL DEFAULT false,
  error_code text, prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0, total_tokens integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0, fallback_reason text,
  cost_estimate text NOT NULL DEFAULT 'unavailable', created_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_modelcall_owner_time ON app.model_call_logs(owner_user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_modelcall_task ON app.model_call_logs(task_key);
CREATE TABLE IF NOT EXISTS app.model_health (
  id text PRIMARY KEY, provider_key text NOT NULL, model_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'unknown', last_error_code text,
  latency_ms integer, last_checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_modelhealth_target ON app.model_health(provider_key, model_id);
CREATE TABLE IF NOT EXISTS app.model_routes (
  id text PRIMARY KEY, owner_user_id text, task_key text NOT NULL,
  chosen_profile_id text, reason_json text NOT NULL DEFAULT '{}',
  auto_route boolean NOT NULL DEFAULT false, created_at timestamptz
);
CREATE INDEX IF NOT EXISTS ix_modelroute_owner_task ON app.model_routes(owner_user_id, task_key);
