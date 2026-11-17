export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatCount(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function displayValue(value: string | number | null, unit?: string | null): string {
  if (value == null) return '—'
  const base = String(value)
  return unit ? `${base} ${unit}` : base
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`
}

/** confidence 为后端给出的辅助置信度（0-1），仅作展示，不代表校准概率。 */
export function formatConfidence(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(0)}%`
}
