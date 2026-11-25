CREATE TABLE IF NOT EXISTS app.data_audit_runs (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  finding_count integer NOT NULL DEFAULT 0,
  blocking_count integer NOT NULL DEFAULT 0,
  duration_ms integer NOT NULL DEFAULT 0,
  report_json text NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_data_audit_project_time ON app.data_audit_runs(project_id, created_at DESC);
