/** 第十一阶段：模型管理中心 API。与本地 FastAPI / Site Edge Function 共用同一契约。 */
import { request } from './api'
import type {
  CallLog, CapabilityInfo, ModelCredential, ModelProfile, ModelProvider,
  ModelStats, RemoteModel, TaskBinding, TestResult,
} from '../types/model'

const qs = (params: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export const modelApi = {
  providers: () => request<ModelProvider[]>('/model-providers'),
  capabilities: () => request<CapabilityInfo>('/model-capabilities'),

  credentials: () => request<ModelCredential[]>('/model-credentials'),
  /** 向导：真实调用但不保存；密钥只存在于本次请求。 */
  testDraft: (body: {
    provider_key: string; api_key: string; model_id: string; base_url?: string
  }) => request<TestResult>('/model-credentials/test-draft', {
    method: 'POST', body: JSON.stringify(body),
  }),
  /** 向导：原子保存凭据 + 模型配置。 */
  createGuidedSetup: (body: {
    provider_key: string; api_key: string; model_id: string;
    display_name?: string; name?: string; base_url?: string;
    timeout_s?: number; max_tokens?: number | null; temperature?: number | null;
    is_default?: boolean;
  }) => request<{ credential: ModelCredential; profile: ModelProfile; note: string }>('/model-setup', {
    method: 'POST', body: JSON.stringify(body),
  }),
  createCredential: (body: {
    provider_key: string; api_key: string; name?: string; base_url?: string
  }) => request<ModelCredential>('/model-credentials', { method: 'POST', body: JSON.stringify(body) }),
  updateCredential: (id: string, body: {
    name?: string; api_key?: string; base_url?: string; status?: string
  }) => request<ModelCredential>(`/model-credentials/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify(body),
  }),
  revokeCredential: (id: string) => request<{ revoked: boolean }>(
    `/model-credentials/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  purgeCredential: (id: string) => request<{ deleted: boolean }>(
    `/model-credentials/${encodeURIComponent(id)}/purge`, { method: 'DELETE' }),
  testCredential: (id: string, modelId?: string) => request<TestResult>(
    `/model-credentials/${encodeURIComponent(id)}/test${qs({ model_id: modelId })}`,
    { method: 'POST' }),
  fetchModels: (id: string) => request<{ models: RemoteModel[]; count: number }>(
    `/model-credentials/${encodeURIComponent(id)}/models`, { method: 'POST' }),

  profiles: () => request<ModelProfile[]>('/model-profiles'),
  createProfile: (body: {
    provider_key: string; model_id: string; credential_id?: string; display_name?: string
    params?: Record<string, unknown>; timeout_s?: number; max_retries?: number
    max_tokens?: number | null; enabled?: boolean; is_default?: boolean; is_fallback?: boolean
  }) => request<ModelProfile>('/model-profiles', { method: 'POST', body: JSON.stringify(body) }),
  updateProfile: (id: string, body: Partial<ModelProfile>) => request<ModelProfile>(
    `/model-profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProfile: (id: string) => request<{ deleted: boolean }>(
    `/model-profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testProfile: (id: string) => request<TestResult>(
    `/model-profiles/${encodeURIComponent(id)}/test`, { method: 'POST' }),

  bindings: (projectId?: string) => request<TaskBinding[]>(`/task-model-bindings${qs({ project_id: projectId })}`),
  upsertBinding: (body: {
    task_key: string; primary_profile_id?: string | null; fallback_profile_id?: string | null
    params?: Record<string, unknown>; auto_route?: boolean; cost_preference?: string
    enabled?: boolean; project_id?: string | null
  }) => request<TaskBinding>('/task-model-bindings', { method: 'PUT', body: JSON.stringify(body) }),
  deleteBinding: (id: string) => request<{ deleted: boolean }>(
    `/task-model-bindings/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  callLogs: (limit = 50, taskKey?: string) => request<CallLog[]>(
    `/model-call-logs${qs({ limit, task_key: taskKey })}`),
  stats: () => request<ModelStats>('/model-stats'),
  health: () => request<Array<{
    provider_key: string; model_id: string; status: string
    last_error_code: string | null; latency_ms: number | null; last_checked_at: string | null
  }>>('/model-health'),
  routes: () => request<Array<{
    id: string; task_key: string; chosen_profile_id: string | null
    reason: Record<string, unknown>; auto_route: boolean; created_at: string | null
  }>>('/model-routes'),
}
