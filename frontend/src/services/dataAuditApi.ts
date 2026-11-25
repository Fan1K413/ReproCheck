import { request } from './api'
import type {
  DataAuditReport,
  DataAuditRule,
  DataAuditRunRequest,
  DataAuditRunSummary,
} from '../types/dataAudit'

/**
 * 数据质量与数据完整性审计端点。
 * 审计在后端本地只读执行：不上传数据、不调用外部模型，前端只提交参数与展示报告。
 */
export const dataAuditApi = {
  run: (projectId: string, body: DataAuditRunRequest = {}) =>
    request<DataAuditReport>(`/projects/${projectId}/data-audits`, {
      method: 'POST',
      body: JSON.stringify({ include_code_scan: true, ...body }),
    }),

  list: (projectId: string) =>
    request<{ items: DataAuditRunSummary[]; total: number }>(
      `/projects/${projectId}/data-audits`,
    ),

  get: (projectId: string, auditId: string) =>
    request<DataAuditReport>(`/projects/${projectId}/data-audits/${auditId}`),

  rules: () =>
    request<{ items: DataAuditRule[]; total: number }>('/data-audits/rules'),
}
