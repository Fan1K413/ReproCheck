import { useQuery } from '@tanstack/react-query'
import {
  BookOpen,
  Braces,
  Database,
  FileSpreadsheet,
  FileText,
  Info,
  MapPin,
  TriangleAlert,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { SourceLocatorView } from '../components/SourceLocatorView'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { formatBytes, formatConfidence, formatDateTime, formatDuration } from '../features/format'
import {
  assertionLabel,
  assertionTone,
  extractionLabel,
  extractionTone,
  materialTypeLabel,
  materialTypeTone,
  parseStatusLabel,
  parseStatusTone,
  verificationLabel,
  verificationTone,
} from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { MaterialDetail, ParseStatus, SourceLocator } from '../types/api'
import '../styles/wave-b-material.css'

const CODE_TYPES = new Set(['python', 'notebook', 'requirements'])
const CONFIG_TYPES = new Set(['yaml', 'json', 'toml'])
const DATA_TYPES = new Set(['csv', 'xlsx'])

/**
 * 后端 MaterialDetail 在 MaterialView 之外还会返回解析耗时 / OCR 标记等顶层字段，
 * 这里做局部类型扩展（不改共享 types 文件），缺项时按 metadata 回退。
 */
type MaterialDetailExtra = MaterialDetail & {
  page_count?: number | null
  needs_ocr?: boolean | null
  parse_duration_ms?: number | null
  parse_error_code?: string | null
}

const PARSE_STATUS_TEXT: Partial<Record<string, string>> = {
  ...parseStatusLabel,
  parsed: '已解析',
}

function statusText(status: string): string {
  return PARSE_STATUS_TEXT[status] ?? status
}

function statusTone(status: string): Tone {
  if (status in parseStatusLabel) return parseStatusTone(status as ParseStatus)
  return status === 'parsed' ? 'success' : 'neutral'
}

function friendlyMetaLabel(key: string): string {
  const labels: Record<string, string> = {
    page_count: '页数',
    pages: '页数',
    num_pages: '页数',
    file_count: '文件数',
    files_count: '文件数',
    chunk_count: '文本块数',
    chunks: '文本块数',
    duration_ms: '解析耗时',
    parse_duration_ms: '解析耗时',
    elapsed_ms: '解析耗时',
    row_count: '行数',
    column_count: '列数',
    sheet_names: '工作表',
    parser_version: '解析器版本',
    parser: '解析器',
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
    <div className="mb-dl__row">
      <dt className="mb-dl__key">{label}</dt>
      <dd className="mb-dl__val">{children}</dd>
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

  const detail = detailQuery.data as MaterialDetailExtra | undefined
  useTrackProject(detail?.project_id)

  /** 事实与证据关联：按 material_id 精确过滤，接口原生支持该过滤条件 */
  const factsQuery = useQuery({
    queryKey: ['facts', detail?.project_id ?? '', materialId],
    queryFn: () => api.listFacts(detail!.project_id, materialId),
    enabled: !!detail?.project_id && !!materialId,
  })

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
    metadata.duration_ms ??
    metadata.parse_duration_ms ??
    metadata.elapsed_ms ??
    detail.parse_duration_ms ??
    null
  const durationMs = typeof durationValue === 'number' ? durationValue : null

  const previewIcon: LucideIcon = CODE_TYPES.has(detail.material_type)
    ? Braces
    : DATA_TYPES.has(detail.material_type)
      ? FileSpreadsheet
      : CONFIG_TYPES.has(detail.material_type)
        ? Database
        : detail.material_type === 'pdf'
          ? BookOpen
          : FileText

  const lines = (detail.raw_preview ?? '').split('\n')
  const facts = factsQuery.data?.items ?? []
  const base = `/projects/${detail.project_id}`

  const previewBlock = !detail.can_preview ? (
    <EmptyState
      compact
      icon={previewIcon}
      title="该材料不支持文本预览"
      description="请下载原始文件查看；解析出的文本块与事实仍可正常使用。"
    />
  ) : DATA_TYPES.has(detail.material_type) ? (
    <div>
      {metaEntries.length > 0 ? (
        <div className="mb-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>字段</th>
                <th>值</th>
              </tr>
            </thead>
            <tbody>
              {metaEntries.map(([key, value]) => (
                <tr key={key}>
                  <td className="whitespace-nowrap text-xs" style={{ color: 'var(--rc-text-muted)' }}>
                    {friendlyMetaLabel(key)}
                  </td>
                  <td className="break-all text-xs" style={{ color: 'var(--rc-text)' }}>
                    {displayMetaValue(value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
          后端未提供该表格的元信息。
        </p>
      )}
      {detail.raw_preview && <pre className="mb-code mb-code--pre mt-4">{detail.raw_preview}</pre>}
    </div>
  ) : CODE_TYPES.has(detail.material_type) ? (
    <pre className="mb-code">
      {lines.map((line, index) => (
        <span key={index} className="mb-code__ln">
          <span className="mb-code__no">{index + 1}</span>
          <span>{line || ' '}</span>
        </span>
      ))}
    </pre>
  ) : (
    <pre className="mb-code mb-code--pre">{detail.raw_preview || '（后端未提供预览文本）'}</pre>
  )

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <Link to={`${base}/materials`} className="mb-back">
            <Icon name="arrowLeft" size="xs" />
            返回材料列表
          </Link>
          <p className="mb-head__eyebrow mt-3">材料详情 · 层叠档案</p>
          <h1 className="mb-head__title break-all">{detail.filename}</h1>
          <p className="mb-head__desc">
            材料详情、原文预览、解析告警与证据关联均来自后端真实字段；点击「解析概览」可查看聚合统计。
          </p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`${base}/overview`} className="btn-ghost">
            <Icon name="grid" size="sm" />
            解析概览
          </Link>
          <Link to={`${base}/tasks`} className="btn-ghost">
            <Icon name="listTree" size="sm" />
            解析任务
          </Link>
          <Link to={`${base}/evidence-graph`} className="btn-ghost">
            <Icon name="network" size="sm" />
            证据图谱
          </Link>
        </nav>
      </header>

      {/* 层叠基础态：封面卡 + 两层纸边 */}
      <div className="mb-cover-wrap">
        <span className="mb-cover__sheet" aria-hidden="true" />
        <span className="mb-cover__sheet mb-cover__sheet--2" aria-hidden="true" />
        <section className="mb-cover" aria-label="材料概览">
          <div className="mb-cover__top">
            <div className="flex min-w-0 items-start gap-4">
              <span
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg"
                style={{
                  backgroundColor: 'var(--rc-surface-3)',
                  border: 'var(--rc-stroke)',
                }}
              >
                <Icon as={previewIcon} size="lg" tone="accent" />
              </span>
              <div className="min-w-0">
                <p className="mb-label">Materials / Archive</p>
                <h2 className="mb-cover__name">{detail.filename}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={materialTypeTone(detail.material_type)} dot={false}>
                    {materialTypeLabel[detail.material_type]}
                  </StatusBadge>
                  <StatusBadge tone={statusTone(detail.parse_status)}>
                    {statusText(detail.parse_status)}
                  </StatusBadge>
                  <StatusBadge tone={detail.can_preview ? 'success' : 'neutral'} dot={false}>
                    {detail.can_preview ? '可预览' : '不支持文本预览'}
                  </StatusBadge>
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="mb-label">文件指纹 SHA-256</p>
              <p className="mb-mono mt-1 break-all text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                {detail.sha256 || '—'}
              </p>
            </div>
          </div>

          <dl className="mb-dl mt-6">
            <Field label="文件大小">
              <span className="mb-mono">{formatBytes(detail.size_bytes)}</span>
            </Field>
            <Field label="上传时间">
              <span className="mb-mono">{formatDateTime(detail.created_at)}</span>
            </Field>
            <Field label="文本块数">
              <span className="mb-mono">{detail.chunk_count}</span>
            </Field>
            <Field label="事实数">
              <span className="mb-mono">{detail.fact_count}</span>
            </Field>
            <Field label="解析耗时">
              <span className="mb-mono">{formatDuration(durationMs)}</span>
            </Field>
            <Field label="材料 ID">
              <span className="mb-mono">{detail.material_id}</span>
            </Field>
          </dl>

          {detail.error_message && (
            <p
              className="mt-5 flex items-start gap-2 rounded-md px-3 py-2 text-xs"
              style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
            >
              <Icon as={TriangleAlert} size="xs" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">解析失败原因：{detail.error_message}</span>
            </p>
          )}
        </section>
      </div>

      <div className="mb-split">
        {/* 左 8 列：原文预览 / 元信息 / 定位 / 告警 */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="mb-panel" aria-label="原文预览">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={previewIcon} size="sm" tone="accent" />
                原文预览
              </h3>
              <span className="mb-panel__hint">GET /materials/{'{id}'} · raw_preview</span>
            </div>
            <div className="mb-panel__body">{previewBlock}</div>
          </section>

          {metaEntries.length > 0 && (
            <section className="mb-panel" aria-label="解析元信息">
              <div className="mb-panel__head">
                <h3 className="mb-panel__title">
                  <Icon as={Info} size="sm" tone="accent" />
                  解析元信息
                </h3>
                <span className="mb-panel__hint">元数据</span>
              </div>
              <dl className="mb-dl mb-panel__body">
                {metaEntries.map(([key, value]) => (
                  <Field key={key} label={friendlyMetaLabel(key)}>
                    {displayMetaValue(value)}
                  </Field>
                ))}
              </dl>
            </section>
          )}

          <section className="mb-panel" aria-label="证据定位">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={MapPin} size="sm" tone="accent" />
                证据定位
              </h3>
            </div>
            <div className="mb-panel__body">
              <SourceLocatorView locator={locator} />
            </div>
          </section>

          <section className="mb-panel" aria-label="解析告警">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={TriangleAlert} size="sm" tone="warning" />
                解析告警
              </h3>
              {detail.warnings.length > 0 && (
                <StatusBadge tone="warning">{detail.warnings.length} 条</StatusBadge>
              )}
            </div>
            {detail.warnings.length === 0 ? (
              <p className="mb-panel__body text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                本次解析未产生告警。
              </p>
            ) : (
              <ul>
                {detail.warnings.map((warning, index) => (
                  <li
                    key={`${warning.code}-${index}`}
                    className="flex flex-wrap items-start gap-2 px-4 py-3"
                    style={{ borderTop: 'var(--rc-stroke-hair)' }}
                  >
                    <StatusBadge tone="warning" dot={false}>
                      {warning.code}
                    </StatusBadge>
                    <span className="min-w-0 flex-1 break-words text-sm" style={{ color: 'var(--rc-text)' }}>
                      {warning.message}
                    </span>
                    {warning.page_index != null && (
                      <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                        页索引 {warning.page_index}
                      </span>
                    )}
                    {warning.line_number != null && (
                      <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                        行号 {warning.line_number}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* 右 4 列：证据 / 事实关联 */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="mb-panel" aria-label="关联事实与证据">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon name="shield" size="sm" tone="accent" />
                关联事实与证据
              </h3>
              {factsQuery.data && (
                <StatusBadge tone="neutral">{factsQuery.data.total} 条事实</StatusBadge>
              )}
            </div>
            <div className="mb-panel__body">
              {factsQuery.isPending ? (
                <LoadingState compact message="正在读取关联事实…" />
              ) : factsQuery.isError ? (
                <ErrorState
                  compact
                  message={
                    factsQuery.error instanceof Error ? factsQuery.error.message : '无法获取关联事实。'
                  }
                  code={factsQuery.error instanceof ApiError ? factsQuery.error.code : undefined}
                  onRetry={() => void factsQuery.refetch()}
                />
              ) : facts.length === 0 ? (
                <EmptyState
                  compact
                  icon={FileText}
                  title="暂无关联事实"
                  description="该材料尚未抽取到科研事实，可先发起解析。"
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {facts.map((fact) => (
                    <li key={fact.fact_id} className="mb-evidence">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span
                          className="text-sm font-semibold"
                          style={{ color: 'var(--rc-text)' }}
                        >
                          {fact.field_label || fact.field_key}
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone={assertionTone(fact.assertion_type)} dot={false}>
                            {assertionLabel[fact.assertion_type] ?? fact.assertion_type}
                          </StatusBadge>
                          <StatusBadge tone={extractionTone(fact.extraction_status)} dot={false}>
                            {extractionLabel[fact.extraction_status] ?? fact.extraction_status}
                          </StatusBadge>
                        </span>
                      </div>
                      <p className="mb-mono mt-1 break-all text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                        {fact.field_key} · {fact.raw_value || '—'} · 置信度{' '}
                        {formatConfidence(fact.confidence)}
                      </p>
                      {fact.evidence.length > 0 && (
                        <div className="mt-2 flex flex-col gap-2">
                          {fact.evidence.map((evidence) => (
                            <div
                              key={evidence.evidence_id}
                              className="rounded-md px-3 py-2"
                              style={{ backgroundColor: 'var(--rc-surface-3)' }}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs" style={{ color: 'var(--rc-text-muted)' }}>
                                  {evidence.source_name}
                                </span>
                                <StatusBadge tone={verificationTone(evidence.verification_status)} dot={false}>
                                  {verificationLabel[evidence.verification_status] ??
                                    evidence.verification_status}
                                </StatusBadge>
                              </div>
                              <p className="mb-quote" style={{ maxHeight: 96 }}>
                                {evidence.quote || '—'}
                              </p>
                              <div className="mt-2">
                                <SourceLocatorView locator={evidence.source_locator} compact />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="mb-panel" aria-label="材料导航">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon name="network" size="sm" tone="accent" />
                继续探索
              </h3>
            </div>
            <div className="mb-panel__body flex flex-col gap-2">
              <Link to={`${base}/facts`} className="btn-ghost justify-start">
                <Icon name="clipboardCheck" size="sm" />
                查看全部科研事实
              </Link>
              <Link to={`${base}/evidence-graph`} className="btn-ghost justify-start">
                <Icon name="network" size="sm" />
                在证据图谱中定位本材料
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
