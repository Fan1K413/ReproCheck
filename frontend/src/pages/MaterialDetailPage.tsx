import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  Braces,
  CalendarClock,
  Clock,
  Database,
  FileSpreadsheet,
  FileText,
  Hash,
  Info,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { SourceLocatorView } from '../components/SourceLocatorView'
import { StatusBadge } from '../components/StatusBadge'
import { formatBytes, formatDateTime, formatDuration } from '../features/format'
import { materialTypeLabel, materialTypeTone, parseStatusLabel, parseStatusTone } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { SourceLocator } from '../types/api'

const CODE_TYPES = new Set(['python', 'notebook', 'requirements'])
const CONFIG_TYPES = new Set(['yaml', 'json', 'toml'])
const DATA_TYPES = new Set(['csv', 'xlsx'])

function friendlyMetaLabel(key: string): string {
  const labels: Record<string, string> = {
    page_count: '页数',
    pages: '页数',
    num_pages: '页数',
    file_count: '文件数',
    files_count: '文件数',
    chunk_count: '文本块数',
    duration_ms: '解析耗时',
    parse_duration_ms: '解析耗时',
    elapsed_ms: '解析耗时',
    row_count: '行数',
    column_count: '列数',
    sheet_names: '工作表',
    parser_version: '解析器版本',
    needs_ocr: '需要 OCR',
  }
  return labels[key] ?? key
}

function displayMetaValue(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.join('、')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-ink-subtle">{label}</p>
      <div className="mt-1 break-words text-sm text-ink">{children}</div>
    </div>
  )
}

export default function MaterialDetailPage() {
  const materialId = useParams().materialId ?? ''
  const detailQuery = useQuery({
    queryKey: ['material', materialId],
    queryFn: () => api.getMaterial(materialId),
    enabled: !!materialId,
  })

  const detail = detailQuery.data
  useTrackProject(detail?.project_id)

  if (detailQuery.isPending) {
    return <LoadingState message="正在读取材料详情…" hint="GET /materials/{id}" />
  }
  if (detailQuery.isError) {
    return (
      <ErrorState
        message={detailQuery.error instanceof Error ? detailQuery.error.message : '无法获取材料详情。'}
        code={detailQuery.error instanceof ApiError ? detailQuery.error.code : undefined}
        onRetry={() => void detailQuery.refetch()}
      />
    )
  }
  if (!detail) {
    return <EmptyState title="材料不存在" description="该材料可能已被删除。" />
  }

  const metadata = detail.metadata ?? {}
  const metaEntries = Object.entries(metadata).filter(([key]) => key !== 'source_locator')
  const rawLocator = metadata.source_locator
  const locator =
    rawLocator && typeof rawLocator === 'object' ? (rawLocator as SourceLocator) : null
  const durationValue =
    metadata.duration_ms ?? metadata.parse_duration_ms ?? metadata.elapsed_ms ?? null
  const durationMs = typeof durationValue === 'number' ? durationValue : null
  const lines = (detail.raw_preview ?? '').split('\n')

  const previewIcon = CODE_TYPES.has(detail.material_type)
    ? Braces
    : DATA_TYPES.has(detail.material_type)
      ? FileSpreadsheet
      : CONFIG_TYPES.has(detail.material_type)
        ? Database
        : FileText

  const PreviewIcon = previewIcon

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link
            to={`/projects/${detail.project_id}/materials`}
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent-dark"
          >
            <ArrowLeft size={13} />
            返回材料列表
          </Link>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">
            Material Detail
          </p>
          <h2 className="mt-1 break-all text-lg font-semibold" title={detail.filename}>
            {detail.filename}
          </h2>
          <p className="mt-1 text-sm text-ink-muted">材料详情、原文预览与解析告警均来自后端真实数据。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={materialTypeTone(detail.material_type)} dot={false}>
            {materialTypeLabel[detail.material_type]}
          </StatusBadge>
          <StatusBadge tone={parseStatusTone(detail.parse_status)}>
            {parseStatusLabel[detail.parse_status]}
          </StatusBadge>
        </div>
      </div>

      <section className="panel p-5">
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="文件大小"><span className="mono">{formatBytes(detail.size_bytes)}</span></Field>
          <Field label="上传时间"><span className="mono">{formatDateTime(detail.created_at)}</span></Field>
          <Field label="文本块数"><span className="mono">{detail.chunk_count}</span></Field>
          <Field label="事实数"><span className="mono">{detail.fact_count}</span></Field>
          <Field label="解析耗时"><span className="mono">{formatDuration(durationMs)}</span></Field>
          <Field label="文件指纹 SHA-256">
            <span className="mono break-all text-xs" title={detail.sha256}>
              {detail.sha256 || '—'}
            </span>
          </Field>
          <Field label="材料 ID"><span className="mono break-all text-xs">{detail.material_id}</span></Field>
          <Field label="所属项目"><span className="mono break-all text-xs">{detail.project_id}</span></Field>
        </div>
        {detail.error_message && (
          <p className="mt-5 flex items-start gap-2 rounded-md bg-danger-wash px-3 py-2 text-xs text-danger">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 break-words">解析失败原因：{detail.error_message}</span>
          </p>
        )}
      </section>

      {metaEntries.length > 0 && (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Info size={17} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">解析元信息</h3>
            </div>
            <span className="text-xs text-ink-subtle">来自 GET /materials/{'{id}'} 的 metadata</span>
          </div>
          <dl className="grid gap-x-8 gap-y-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
            {metaEntries.map(([key, value]) => (
              <div key={key} className="flex min-w-0 items-start justify-between gap-3 border-b border-line-soft py-1.5 last:border-b-0">
                <dt className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                  <Hash size={12} className="text-ink-subtle" />
                  {friendlyMetaLabel(key)}
                </dt>
                <dd className="min-w-0 break-all text-right text-xs text-ink">{displayMetaValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <PreviewIcon size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">原文预览</h3>
          </div>
          <StatusBadge tone={detail.can_preview ? 'success' : 'neutral'} dot={false}>
            {detail.can_preview ? '可预览' : '不支持文本预览'}
          </StatusBadge>
        </div>

        {!detail.can_preview ? (
          <EmptyState
            compact
            icon={PreviewIcon}
            title="该材料不支持文本预览"
            description="请下载原始文件查看；解析出的文本块与事实仍可正常使用。"
          />
        ) : DATA_TYPES.has(detail.material_type) ? (
          <div className="p-5">
            <p className="text-xs font-semibold text-ink-muted">表格元信息</p>
            {metaEntries.length > 0 ? (
              <div className="mt-2 overflow-x-auto">
                <table className="data-table">
                  <thead>
                    <tr><th>字段</th><th>值</th></tr>
                  </thead>
                  <tbody>
                    {metaEntries.map(([key, value]) => (
                      <tr key={key}>
                        <td className="whitespace-nowrap text-xs text-ink-muted">{friendlyMetaLabel(key)}</td>
                        <td className="break-all text-xs text-ink">{displayMetaValue(value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-subtle">后端未提供该表格的元信息。</p>
            )}
            {detail.raw_preview && (
              <pre className="mono mt-4 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas p-4 text-xs leading-6 text-ink">
                {detail.raw_preview}
              </pre>
            )}
          </div>
        ) : CODE_TYPES.has(detail.material_type) ? (
          <div className="p-5">
            <pre className="mono max-h-[520px] overflow-auto rounded-md bg-canvas p-4 text-xs leading-6 text-ink">
              {lines.map((line, index) => (
                <span key={index} className="block min-w-max">
                  <span className="mr-4 inline-block w-10 select-none text-right text-ink-subtle">
                    {index + 1}
                  </span>
                  <span>{line || ' '}</span>
                </span>
              ))}
            </pre>
          </div>
        ) : (
          <div className="p-5">
            <pre className="mono max-h-[520px] overflow-auto whitespace-pre-wrap break-words rounded-md bg-canvas p-4 text-xs leading-6 text-ink">
              {detail.raw_preview || '（后端未提供预览文本）'}
            </pre>
          </div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <CalendarClock size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">证据定位</h3>
          </div>
        </div>
        <div className="p-5">
          <SourceLocatorView locator={locator} />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Clock size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">解析告警</h3>
          </div>
          {detail.warnings.length > 0 && (
            <StatusBadge tone="warning">{detail.warnings.length} 条</StatusBadge>
          )}
        </div>
        {detail.warnings.length === 0 ? (
          <p className="px-5 py-6 text-center text-xs text-ink-subtle">本次解析未产生告警。</p>
        ) : (
          <ul className="divide-y divide-line-soft">
            {detail.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className="flex flex-wrap items-start gap-2 px-5 py-3">
                <StatusBadge tone="warning" dot={false}>{warning.code}</StatusBadge>
                <span className="min-w-0 flex-1 break-words text-sm text-ink">{warning.message}</span>
                {warning.page_index != null && (
                  <span className="mono text-xs text-ink-subtle">页索引 {warning.page_index}</span>
                )}
                {warning.line_number != null && (
                  <span className="mono text-xs text-ink-subtle">行号 {warning.line_number}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
