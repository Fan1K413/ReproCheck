/** 第十一阶段新功能 API：实验差异分析 + 项目变化监控。 */
import { request } from './api'
import type { ChangeAnalysis, DiffReport, RunOption } from '../types/research'

export const researchApi = {
  runs: (projectId: string) => request<RunOption[]>(
    `/experiments/runs?project_id=${encodeURIComponent(projectId)}`),
  diff: (projectId: string, runIds: string[]) => request<DiffReport>(
    '/experiments/diff', { method: 'POST', body: JSON.stringify({ project_id: projectId, run_ids: runIds }) }),
  changeMonitor: (projectId: string) => request<ChangeAnalysis>(
    `/change-monitor/analyze?project_id=${encodeURIComponent(projectId)}`),
  createReviewPlan: (projectId: string, snapshotId: string, title?: string) => request<{
    plan_id: string; title: string; status: string; next: string
  }>('/change-monitor/create-review-plan', {
    method: 'POST',
    body: JSON.stringify({ project_id: projectId, snapshot_id: snapshotId, confirmed: true, title }),
  }),
}
