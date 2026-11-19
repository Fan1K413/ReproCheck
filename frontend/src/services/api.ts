import type {
  ApiResponse,
  AuditResult,
  CancelTaskResult,
  CreateProjectRequest,
  DemoAuditRequest,
  DeleteMaterialResult,
  FactRevisionsData,
  FactViewV2,
  FactsData,
  FactsSummary,
  EvidenceGraph,
  HealthData,
  LlmStatusData,
  LlmTestData,
  MaterialDetail,
  MaterialsData,
  ParseOverview,
  ParseTaskView,
  ParseTasksData,
  PatchFactBody,
  Project,
  ProjectsData,
  StartParseResult,
  UploadMaterialResult,
} from '../types/api'

/**
 * 统一请求封装：
 * - base 取自 VITE_API_BASE_URL（默认 /api），v1 前缀集中在此处维护；
 * - 后端信封 success=false 或 data 为空时，统一抛出 ApiError；
 * - 不读取、不缓存任何密钥，密钥仅由后端管理。
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api'
const V1 = `${API_BASE.replace(/\/$/, '')}/v1`

export class ApiError extends Error {
  readonly code: string
  readonly details: unknown
  readonly requestId: string

  constructor(code: string, message: string, details: unknown, requestId: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.details = details
    this.requestId = requestId
  }
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  // multipart 上传不能手工设置 Content-Type，否则浏览器无法自动补全 boundary。
  const isFormData = typeof FormData !== 'undefined' && init?.body instanceof FormData
  // 第六阶段：注入登录令牌（仅读取本地会话，密钥仍由后端管理）。
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('rc_token') : null
  try {
    response = await fetch(`${V1}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.body && !isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      '无法连接到服务，请检查后端是否已启动。',
      null,
      'frontend',
    )
  }

  let payload: ApiResponse<T>
  try {
    payload = (await response.json()) as ApiResponse<T>
  } catch {
    throw new ApiError(
      'INVALID_FORMAT',
      `服务返回了无法解析的响应（HTTP ${response.status}）。`,
      null,
      'frontend',
    )
  }

  if (!response.ok || !payload || payload.success !== true || payload.data == null) {
    const error = payload?.error
    throw new ApiError(
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? `请求失败（HTTP ${response.status}）。`,
      error?.details ?? null,
      payload?.request_id ?? 'frontend',
    )
  }

  return payload.data
}

export const api = {
  getHealth: () => request<HealthData>('/health'),

  getLlmStatus: () => request<LlmStatusData>('/llm/status'),

  testLlm: () =>
    request<LlmTestData>('/llm/test', {
      method: 'POST',
    }),

  demoAudit: (body: DemoAuditRequest) =>
    request<AuditResult>('/demo/audit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getAuditRun: (runId: string) =>
    request<AuditResult>(`/audit-runs/${encodeURIComponent(runId)}`),

  getProjects: () => request<ProjectsData>('/projects'),

  createProject: (body: CreateProjectRequest) =>
    request<Project>('/projects', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ---------------- 第二阶段：材料管理 ---------------- */

  /** multipart 上传；请求体由调用方构造（project_id + file）。 */
  uploadMaterial: (formData: FormData) =>
    request<UploadMaterialResult>('/materials/upload', {
      method: 'POST',
      body: formData,
    }),

  listMaterials: (projectId: string) =>
    request<MaterialsData>(`/materials?project_id=${encodeURIComponent(projectId)}`),

  getMaterial: (materialId: string) =>
    request<MaterialDetail>(`/materials/${encodeURIComponent(materialId)}`),

  /**
   * 下载原始文件。该端点返回二进制流而非统一信封，无法复用 request<T>()；
   * 这里沿用同样的 ApiError 语义与错误码风格，并在浏览器侧触发下载。
   */
  downloadMaterial: async (materialId: string): Promise<void> => {
    let response: Response
    // 二进制下载端点同样需要 Bearer；否则登录后会 401。
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('rc_token') : null
    try {
      response = await fetch(`${V1}/materials/${encodeURIComponent(materialId)}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
    } catch {
      throw new ApiError('NETWORK_ERROR', '无法连接到服务，下载未开始。', null, 'frontend')
    }
    if (!response.ok) {
      throw new ApiError(
        'DOWNLOAD_FAILED',
        `下载失败（HTTP ${response.status}）。`,
        null,
        'frontend',
      )
    }
    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?([^;]+)/i.exec(disposition)
    const filename = match
      ? decodeURIComponent(match[1].trim().replace(/^"|"$/g, ''))
      : `material-${materialId}`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },

  deleteMaterial: (materialId: string) =>
    request<DeleteMaterialResult>(`/materials/${encodeURIComponent(materialId)}`, {
      method: 'DELETE',
    }),

  /* ---------------- 第二阶段：解析任务 ---------------- */

  startParse: (materialId: string) =>
    request<StartParseResult>(`/materials/${encodeURIComponent(materialId)}/parse`, {
      method: 'POST',
    }),

  getTask: (taskId: string) =>
    request<ParseTaskView>(`/parse-tasks/${encodeURIComponent(taskId)}`),

  listTasks: (projectId: string) =>
    request<ParseTasksData>(`/parse-tasks?project_id=${encodeURIComponent(projectId)}`),

  retryTask: (taskId: string) =>
    request<ParseTaskView>(`/parse-tasks/${encodeURIComponent(taskId)}/retry`, {
      method: 'POST',
    }),

  cancelTask: (taskId: string) =>
    request<CancelTaskResult>(`/parse-tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
    }),

  /* ---------------- 第二阶段：事实与证据 ---------------- */

  listFacts: (projectId: string, materialId?: string) => {
    const query = `project_id=${encodeURIComponent(projectId)}${
      materialId ? `&material_id=${encodeURIComponent(materialId)}` : ''
    }`
    return request<FactsData>(`/facts?${query}`)
  },

  patchFact: (factId: string, body: PatchFactBody) =>
    request<FactViewV2>(`/facts/${encodeURIComponent(factId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  getRevisions: (factId: string) =>
    request<FactRevisionsData>(`/facts/${encodeURIComponent(factId)}/revisions`),

  getFactsSummary: (projectId: string) =>
    request<FactsSummary>(`/facts/summary?project_id=${encodeURIComponent(projectId)}`),

  getEvidenceGraph: (projectId: string) =>
    request<EvidenceGraph>(`/projects/${encodeURIComponent(projectId)}/evidence-graph`),

  /* ---------------- 第二阶段：解析概览 ---------------- */

  getParseOverview: (projectId: string) =>
    request<ParseOverview>(
      `/projects/${encodeURIComponent(projectId)}/parse-overview`,
    ),
}
