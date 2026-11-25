import { request } from './api'
import type {
  StatsCatalog,
  StatsComputeRequest,
  StatsComputeResult,
  StatsReport,
  StatsRunRequest,
} from '../types/stats'

/**
 * 统计审计端点：复用统一 request<T>()，自动拼接 /api/v1 并注入 Bearer token。
 * 所有计算在后端完成，前端只负责提交 JSON 与展示可复算结果。
 */
export const statsApi = {
  run: (experimentStatistics: Record<string, unknown>) => {
    const body: StatsRunRequest = { experiment_statistics: experimentStatistics }
    return request<StatsReport>('/stats-audit/run', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  compute: (operation: string, kwargs: Record<string, unknown>) => {
    const body: StatsComputeRequest = { operation, kwargs }
    return request<StatsComputeResult>('/stats-audit/compute', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  catalog: () => request<StatsCatalog>('/stats-audit/catalog'),
}
