import { ApiError } from './api'
import type { ApiResponse } from '../types/api'
import type {
  CancelRunResult,
  ComparisonView,
  ConfirmTaskResult,
  CreateDiagnosticRequest,
  CreatePlanRequest,
  CreatePlanResult,
  CreateReportRequest,
  CreateReportResult,
  CreateRunRequest,
  CreateTaskRequest,
  DiagnosticView,
  EnvironmentView,
  MetricView,
  PlanDetail,
  PlanView,
  QualityView,
  ReproList,
  ReproRunView,
  ReproTaskView,
  ReportView,
  ReviewRemediationRequest,
  ReviewRemediationResult,
  ArtifactEntry,
  LogEntry,
} from '../types/reproduction'

/**
 * 第四阶段接口封装。与 api.ts 使用完全相同的信封语义：
 * - base 取自 VITE_API_BASE_URL（默认 /api），v1 前缀集中维护；
 * - success=false / data 为空 / HTTP 非 2xx 统一抛出 ApiError（含后端 error.code）；
 * - 不读取、不缓存任何密钥，密钥仅由后端管理。
 */
const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api'
const V1 = `${API_BASE.replace(/\/$/, '')}/v1`

async function readError(response: Response): Promise<ApiError> {
  let payload: ApiResponse<unknown> | null = null
  try {
    payload = (await response.json()) as ApiResponse<unknown>
  } catch {
    // 响应体不是 JSON（例如网关的纯文本错误），使用默认错误码。
  }
  const error = payload?.error
  return new ApiError(
    error?.code ?? 'UNKNOWN_ERROR',
    error?.message ?? `请求失败（HTTP ${response.status}）。`,
    error?.details ?? null,
    payload?.request_id ?? 'frontend',
  )
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${V1}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', '无法连接到服务，请检查后端是否已启动。', null, 'frontend')
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

const qs = (params: Record<string, string | undefined>) =>
  Object.entries(params)
    .filter((entry): entry is [string, string] => entry[1] != null && entry[1] !== '')
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&')

export const reproductionApi = {
  /* ---------------- 规划 ---------------- */

  listPlans: (projectId: string) =>
    request<ReproList<PlanView>>(`/reproductions/plans?${qs({ project_id: projectId })}`),

  getPlan: (planId: string) =>
    request<PlanDetail>(`/reproductions/plans/${encodeURIComponent(planId)}`),

  createPlan: (body: CreatePlanRequest) =>
    request<CreatePlanResult>('/reproductions/plans', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  createTask: (planId: string, body: CreateTaskRequest) =>
    request<ReproTaskView>(`/reproductions/plans/${encodeURIComponent(planId)}/tasks`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getTask: (taskId: string) =>
    request<ReproTaskView>(`/reproductions/tasks/${encodeURIComponent(taskId)}`),

  confirmTask: (taskId: string) =>
    request<ConfirmTaskResult>(`/reproductions/tasks/${encodeURIComponent(taskId)}/confirm`, {
      method: 'POST',
    }),

  /* ---------------- 运行与执行 ---------------- */

  listRuns: (projectId: string) =>
    request<ReproList<ReproRunView>>(`/reproductions/runs?${qs({ project_id: projectId })}`),

  getRun: (runId: string) =>
    request<ReproRunView>(`/reproductions/runs/${encodeURIComponent(runId)}`),

  createRun: (body: CreateRunRequest) =>
    request<ReproRunView>('/reproductions/runs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  cancelRun: (runId: string) =>
    request<CancelRunResult>(`/reproductions/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
    }),

  getRunLogs: (runId: string) =>
    request<ReproList<LogEntry>>(`/reproductions/runs/${encodeURIComponent(runId)}/logs`),

  getRunArtifacts: (runId: string) =>
    request<ReproList<ArtifactEntry>>(`/reproductions/runs/${encodeURIComponent(runId)}/artifacts`),

  getRunMetrics: (runId: string) =>
    request<ReproList<MetricView>>(`/reproductions/runs/${encodeURIComponent(runId)}/metrics`),

  /* ---------------- 环境与指标 ---------------- */

  listEnvironments: (projectId: string) =>
    request<ReproList<EnvironmentView>>(
      `/reproductions/environments?${qs({ project_id: projectId })}`,
    ),

  listComparisons: (projectId: string) =>
    request<ReproList<ComparisonView>>(
      `/reproductions/metric-comparisons?${qs({ project_id: projectId })}`,
    ),

  getQuality: (projectId: string) =>
    request<QualityView>(`/reproductions/quality?${qs({ project_id: projectId })}`),

  /* ---------------- 诊断与修复 ---------------- */

  createDiagnostic: (body: CreateDiagnosticRequest) =>
    request<DiagnosticView>('/reproductions/diagnostics', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reviewRemediation: (proposalId: string, body: ReviewRemediationRequest) =>
    request<ReviewRemediationResult>(
      `/reproductions/remediations/${encodeURIComponent(proposalId)}/review`,
      { method: 'POST', body: JSON.stringify(body) },
    ),

  /* ---------------- 报告 ---------------- */

  listReports: (projectId: string) =>
    request<ReproList<ReportView>>(`/reproductions/reports?${qs({ project_id: projectId })}`),

  createReport: (body: CreateReportRequest) =>
    request<CreateReportResult>('/reproductions/reports', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getReport: (reportId: string) =>
    request<ReportView>(`/reproductions/reports/${encodeURIComponent(reportId)}`),

  /** HTML 导出：返回文本，由页面用 Blob URL 在新窗口打开；错误含后端 error.code。 */
  getReportHtmlText: async (reportId: string): Promise<string> => {
    let response: Response
    try {
      response = await fetch(
        `${V1}/reproductions/reports/${encodeURIComponent(reportId)}/html`,
        { headers: { Accept: 'text/html' } },
      )
    } catch {
      throw new ApiError('NETWORK_ERROR', '无法连接到服务，HTML 导出未开始。', null, 'frontend')
    }
    if (!response.ok) throw await readError(response)
    return response.text()
  },

  /** PDF 下载：二进制流；501 时抛出含 PDF_UNAVAILABLE 的 ApiError。 */
  downloadReportPdf: async (reportId: string, filename?: string): Promise<void> => {
    let response: Response
    try {
      response = await fetch(
        `${V1}/reproductions/reports/${encodeURIComponent(reportId)}/pdf`,
        { headers: { Accept: 'application/pdf' } },
      )
    } catch {
      throw new ApiError('NETWORK_ERROR', '无法连接到服务，PDF 下载未开始。', null, 'frontend')
    }
    if (!response.ok) throw await readError(response)

    const blob = await response.blob()
    const disposition = response.headers.get('Content-Disposition') ?? ''
    const match = /filename\*?=(?:UTF-8'')?([^;]+)/i.exec(disposition)
    const name = match
      ? decodeURIComponent(match[1].trim().replace(/^"|"$/g, ''))
      : filename || `report-${reportId}.pdf`
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name.endsWith('.pdf') ? name : `${name}.pdf`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },
}
