/** 第十一阶段：模型管理中心 DTO。密钥只以 key_hint 形式出现，前端永不持有明文。 */
export type ModelProvider = {
  key: string
  name: string
  protocol: string
  default_base_url: string
  capabilities: string[]
  default_models: string[]
  docs_url: string
  notes: string
  requires_custom_url: boolean
  builtin: boolean
  real_api_tested: boolean
}

export type ModelCredential = {
  id: string
  provider_key: string
  name: string
  key_hint: string
  base_url: string
  status: 'active' | 'revoked' | 'disabled'
  last_error_code: string | null
  last_tested_at: string | null
  created_at: string | null
  has_key: boolean
}

export type ModelProfile = {
  id: string
  provider_key: string
  credential_id: string | null
  model_id: string
  display_name: string
  params: Record<string, unknown>
  timeout_s: number
  max_retries: number
  max_tokens: number | null
  enabled: boolean
  is_default: boolean
  is_fallback: boolean
}

export type TaskBinding = {
  id: string
  task_key: string
  project_id: string | null
  primary_profile_id: string | null
  fallback_profile_id: string | null
  params: Record<string, unknown>
  auto_route: boolean
  cost_preference: string
  enabled: boolean
}

export type CallLog = {
  id: string
  request_id: string
  task_key: string
  provider_key: string
  model_id: string
  success: boolean
  error_code: string | null
  prompt_tokens: number
  completion_tokens: number
  duration_ms: number
  fallback_reason: string | null
  cost_estimate: string
  created_at: string | null
}

export type GroupStat = {
  calls: number
  success: number
  prompt_tokens: number
  completion_tokens: number
}

export type ModelStats = {
  total_calls: number
  success_calls: number
  failed_calls: number
  prompt_tokens: number
  completion_tokens: number
  avg_duration_ms: number
  p95_duration_ms: number
  by_provider: Record<string, GroupStat>
  by_model: Record<string, GroupStat>
  by_task: Record<string, GroupStat>
  cost_note: string
}

export type TestResult = {
  status: 'success' | 'auth_failed' | 'rate_limited' | 'timeout' | 'network_error' |
    'incompatible_format' | 'model_not_found' | 'capability_unsupported' |
    'ssrf_blocked' | 'provider_error'
  provider?: string
  model?: string
  latency_ms?: number
  prompt_tokens?: number
  completion_tokens?: number
  reply_preview?: string
  error_code?: string
  error_message?: string
  checked_at?: string
}

export type RemoteModel = { id: string; owned_by: string }

export type CapabilityInfo = {
  capabilities: { key: string; label: string }[]
  task_keys: string[]
  note: string
}
