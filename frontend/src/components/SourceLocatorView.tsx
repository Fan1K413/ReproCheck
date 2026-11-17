import { MapPin } from 'lucide-react'
import { locatorKind } from '../features/stage2Meta'
import type {
  CodeSourceLocator,
  ConfigSourceLocator,
  DataSourceLocator,
  DocSourceLocator,
  PdfSourceLocator,
  SourceLocator,
} from '../types/api'
import { StatusBadge } from './StatusBadge'

type SourceLocatorViewProps = {
  locator: SourceLocator | null | undefined
  /** 卡片内紧凑展示 */
  compact?: boolean
}

/**
 * 按材料类型渲染证据定位徽标。定位结构来自后端，判定类型后安全断言，
 * 因为 locatorKind 已经验证了同一对象的字段集合。
 */
export function SourceLocatorView({ locator, compact = false }: SourceLocatorViewProps) {
  const kind = locatorKind(locator)
  const gap = compact ? 'gap-1.5' : 'gap-2'

  if (kind === 'unknown') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-subtle">
        <MapPin size={13} strokeWidth={1.8} />
        来源位置尚未确认
      </span>
    )
  }

  if (kind === 'pdf') {
    const loc = locator as PdfSourceLocator
    const printed = loc.printed_page_number != null ? ` · 印刷页 ${loc.printed_page_number}` : ''
    return (
      <div className={`flex flex-wrap items-center ${gap}`}>
        <StatusBadge tone="accent">PDF 第 {loc.viewer_page_number} 页{printed}</StatusBadge>
        {loc.section && <span className="text-xs text-ink-muted">章节：{loc.section}</span>}
        {loc.bbox && loc.bbox.length === 4 && (
          <StatusBadge tone="neutral" dot={false}>有坐标</StatusBadge>
        )}
      </div>
    )
  }

  if (kind === 'code') {
    const loc = locator as CodeSourceLocator
    return (
      <div className={`flex flex-wrap items-center ${gap}`}>
        <StatusBadge tone="success">代码行 {loc.start_line}–{loc.end_line}</StatusBadge>
        <span className="mono max-w-full break-all text-xs text-ink-muted">{loc.file_path}</span>
        {loc.symbol && <span className="text-xs text-ink-subtle">符号：{loc.symbol}</span>}
      </div>
    )
  }

  if (kind === 'config') {
    const loc = locator as ConfigSourceLocator
    return (
      <div className={`flex flex-wrap items-center ${gap}`}>
        <StatusBadge tone="warning">配置字段 {loc.field_path}</StatusBadge>
        <span className="mono text-xs text-ink-muted">原始键：{loc.original_key}</span>
        <span className="mono max-w-full break-all text-xs text-ink-subtle">{loc.file_path}</span>
      </div>
    )
  }

  if (kind === 'data') {
    const loc = locator as DataSourceLocator
    const parts = [
      loc.sheet_name ? `工作表：${loc.sheet_name}` : null,
      loc.column_name ? `列：${loc.column_name}` : null,
      loc.row_count != null ? `${loc.row_count} 行` : null,
    ].filter(Boolean) as string[]
    return (
      <div className={`flex flex-wrap items-center ${gap}`}>
        <StatusBadge tone="navy">表格数据</StatusBadge>
        {parts.length > 0 && <span className="text-xs text-ink-muted">{parts.join(' · ')}</span>}
      </div>
    )
  }

  // doc
  const loc = locator as DocSourceLocator
  const lines = loc.start_line != null && loc.end_line != null
    ? `第 ${loc.start_line}–${loc.end_line} 行`
    : loc.start_line != null
      ? `第 ${loc.start_line} 行`
      : ''
  return (
    <div className={`flex flex-wrap items-center ${gap}`}>
      <StatusBadge tone="accent">文档定位</StatusBadge>
      {loc.section && <span className="text-xs text-ink-muted">章节：{loc.section}</span>}
      {lines && <span className="text-xs text-ink-subtle">{lines}</span>}
    </div>
  )
}
