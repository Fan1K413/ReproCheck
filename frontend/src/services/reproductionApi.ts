import { ApiError, downloadFilename, invalidateExpiredSession, request } from './api'
import { useAuthStore } from '../stores/authStore'
import type { ApiResponse } from '../types/api'
import type {
  BenchmarkMetricsResult,
  BenchmarkPredictionInput,
  BenchmarkTruthInput,
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
  DeterministicDiagnosis,
  DiagnosticView,
  EnvironmentView,
  FailureCategory,
  LogEntry,
  MetricView,
  PlanDetail,
  PlanView,
  QualityView,
  RecomputeResult,
  ReproList,
  ReproRunView,
  ReproTaskView,
  ReportView,
  ReviewRemediationRequest,
  ReviewRemediationResult,
  ArtifactEntry,
  ClassifyLogRequest,
  StaticAnalysisResult,
  VerificationLayersData,
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
    const token = useAuthStore.getState().token
    try {
      response = await fetch(
        `${V1}/reproductions/reports/${encodeURIComponent(reportId)}/html`,
        { headers: { Accept: 'text/html', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      )
    } catch {
      throw new ApiError('NETWORK_ERROR', '无法连接到服务，HTML 导出未开始。', null, 'frontend')
    }
    invalidateExpiredSession(response, token)
    if (!response.ok) throw await readError(response)
    return response.text()
  },

  /** PDF 下载：二进制流；501 时抛出含 PDF_UNAVAILABLE 的 ApiError。 */
  downloadReportPdf: async (reportId: string, filename?: string): Promise<void> => {
    let response: Response
    const token = useAuthStore.getState().token
    try {
      response = await fetch(
        `${V1}/reproductions/reports/${encodeURIComponent(reportId)}/pdf`,
        { headers: { Accept: 'application/pdf', ...(token ? { Authorization: `Bearer ${token}` } : {}) } },
      )
    } catch {
      throw new ApiError('NETWORK_ERROR', '无法连接到服务，PDF 下载未开始。', null, 'frontend')
    }
    invalidateExpiredSession(response, token)
    if (!response.ok) throw await readError(response)

    const blob = await response.blob()
    const name = downloadFilename(response, filename || `report-${reportId}.pdf`)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name.endsWith('.pdf') ? name : `${name}.pdf`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  },

  /* ---------------- 确定性诊断（无需大模型密钥）---------------- */

  listFailureCategories: () =>
    request<{ items: FailureCategory[]; total: number; note: string }>('/diagnosis/categories'),

  classifyLog: (body: ClassifyLogRequest) =>
    request<DeterministicDiagnosis>('/diagnosis/classify', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /* ---------------- 第九阶段：独立验证引擎 / 基准指标 ---------------- */

  getVerificationLayers: () =>
    request<VerificationLayersData>('/verification/layers'),

  /** 多文件源码 AST 静态分析；只解析，不执行任何上传代码。 */
  runStaticAnalysis: (sources: Record<string, string>) =>
    request<StaticAnalysisResult>('/verification/static-analysis', {
      method: 'POST',
      body: JSON.stringify({ sources }),
    }),

  runRecompute: (
    metric: string,
    counts: Record<string, unknown>,
    reportedValue: number | null,
  ) =>
    request<RecomputeResult>('/verification/recompute', {
      method: 'POST',
      body: JSON.stringify({ metric, counts, reported_value: reportedValue }),
    }),

  computeBenchmarkMetrics: (
    truths: BenchmarkTruthInput[],
    predictions: BenchmarkPredictionInput[],
  ) =>
    request<BenchmarkMetricsResult>('/benchmark/metrics/compute', {
      method: 'POST',
      body: JSON.stringify({ truths, predictions }),
    }),
}
