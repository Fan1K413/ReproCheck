import type { Tone } from '../components/StatusBadge'
import type { ComparisonStatus, ConnectionStatus } from '../types/api'

export const connectionMeta: Record<ConnectionStatus, { label: string; tone: Tone }> = {
  ok: { label: '已连接', tone: 'success' },
  error: { label: '连接异常', tone: 'danger' },
  unknown: { label: '未检测', tone: 'neutral' },
}

export const comparisonMeta: Record<ComparisonStatus, { label: string; tone: Tone }> = {
  conflict: { label: '冲突', tone: 'danger' },
  consistent: { label: '一致', tone: 'success' },
  missing: { label: '缺失', tone: 'neutral' },
}

export function severityTone(severity: string): Tone {
  const value = severity.toLowerCase()
  if (['critical', 'high', '严重', '高'].some((key) => value.includes(key))) return 'danger'
  if (['medium', 'moderate', '中'].some((key) => value.includes(key))) return 'warning'
  return 'neutral'
}
