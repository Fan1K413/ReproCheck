import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  ExternalLink,
  History,
  Pencil,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { SourceLocatorView } from '../components/SourceLocatorView'
import { StatusBadge } from '../components/StatusBadge'
import { displayValue, formatConfidence, formatCount, formatDateTime } from '../features/format'
import {
  assertionLabel,
  assertionTone,
  extractionLabel,
  extractionTone,
  FACT_TYPE_TABS,
  factTypeLabel,
  verificationLabel,
  verificationTone,
} from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { AssertionType, ExtractionStatus, FactType, FactViewV2 } from '../types/api'
import '../styles/wave-b-material.css'

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

/** 读取聚合字典计数；键不存在时返回 undefined。 */
function pickCount(map: Record<string, number> | undefined, key: string): number | undefined {
  if (!map) return undefined
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined
}

/** 断言类型顺序固定，与后端 by_assertion 键一致 */
const ASSERTION_ORDER: AssertionType[] = ['explicit', 'inferred', 'ambiguous', 'not_found']
/** 抽取状态顺序固定，与后端 by_status 键一致 */
const EXTRACTION_ORDER: ExtractionStatus[] = ['supported', 'unsupported', 'needs_review']

/** 透视条分段色调：仅用语义 token，不引入新的色相 */
const RIBBON_TONE: Record<string, string> = {
  explicit: 'mb-ribbon__seg--success',
  ambiguous: 'mb-ribbon__seg--warning',
  not_found: 'mb-ribbon__seg--danger',
  supported: 'mb-ribbon__seg--success',
  unsupported: 'mb-ribbon__seg--danger',
  needs_review: 'mb-ribbon__seg--warning',
}

type FactCardProps = {
  fact: FactViewV2
  materialName: string
  projectId: string
}

function FactCard({ fact, materialName, projectId }: FactCardProps) {
  const queryClient = useQueryClient()
  const [showEvidence, setShowEvidence] = useState(false)
  const [showRevisionForm, setShowRevisionForm] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    field_label: fact.field_label,
    raw_value: fact.raw_value,
    normalized_value: fact.normalized_value == null ? '' : String(fact.normalized_value),
    note: '',
  })

  const humanRevised = fact.parser_source === 'human' || fact.revision_count > 0

  const revisionMutation = useMutation({
    mutationFn: () =>
      api.patchFact(fact.fact_id, {
        field_label: form.field_label,
        raw_value: form.raw_value,
        normalized_value: form.normalized_value === '' ? null : form.normalized_value,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      }),
    onSuccess: async () => {
      setNotice('修订已保存，该事实已标记为人工修订。')
      setShowRevisionForm(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['facts', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['facts-summary', projectId] }),
        queryClient.invalidateQueries({ queryKey: ['fact-revisions', fact.fact_id] }),
        queryClient.invalidateQueries({ queryKey: ['parse-overview', projectId] }),
      ])
    },
  })

  const revisionsQuery = useQuery({
    queryKey: ['fact-revisions', fact.fact_id],
    queryFn: () => api.getRevisions(fact.fact_id),
    enabled: showHistory,
  })

  const firstEvidence = fact.evidence[0]

  return (
    <article className="mb-fact">
      <div className="mb-fact__head">
        <div className="min-w-0">
          <p className="mb-fact__label">{fact.field_label || fact.field_key}</p>
          <p className="mb-fact__key">{fact.field_key}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge tone={assertionTone(fact.assertion_type)}>
            {assertionLabel[fact.assertion_type] ?? fact.assertion_type}
          </StatusBadge>
          <StatusBadge tone={extractionTone(fact.extraction_status)}>
            {extractionLabel[fact.extraction_status] ?? fact.extraction_status}
          </StatusBadge>
          {humanRevised && (
            <StatusBadge tone="accent" dot={false}>
              <Icon as={ShieldCheck} size="xs" />
              人工确认/修订
            </StatusBadge>
          )}
        </div>
      </div>

      <div className="mb-fact__values">
        <div className="min-w-0">
          <p className="mb-label">原始值</p>
          <p className="mb-fact__value mb-fact__value--muted">{fact.raw_value || '—'}</p>
        </div>
        <span className="mb-fact__arrow" aria-hidden="true">
          →
        </span>
        <div className="min-w-0">
          <p className="mb-label">归一值</p>
          <p className="mb-fact__value">
            {displayValue(fact.normalized_value, fact.unit)}
          </p>
        </div>
      </div>

      {humanRevised && (
        <p className="mt-3 text-xs" style={{ color: 'var(--rc-violet)' }}>
          该值已经人工修订（{fact.revision_count} 次），非 AI 原始输出。
        </p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          <span className="mb-label">来源材料</span>
          <Link to={`/materials/${fact.material_id}`} style={{ color: 'var(--rc-violet)' }} className="mb-source-link hover:underline">
            {materialName}
          </Link>
          <span className="mb-mono" style={{ color: 'var(--rc-text-subtle)' }}>
            {fact.material_id.slice(0, 10)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="mb-label shrink-0">证据位置</span>
          <SourceLocatorView locator={firstEvidence?.source_locator} compact />
        </div>
        <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }} title="该数值为辅助置信度，非校准概率">
          辅助置信度 {formatConfidence(fact.confidence)}（非校准概率，仅供排序参考）· 抽取来源{' '}
          {fact.parser_source} · <span className="mb-mono">{formatDateTime(fact.created_at)}</span>
        </p>
      </div>

      <div className="mb-fact__actions">
        <button
          type="button"
          className="mb-chip"
          aria-expanded={showEvidence}
          onClick={() => setShowEvidence((value) => !value)}
        >
          {showEvidence ? (
            <Icon name="chevronDown" size="xs" />
          ) : (
            <Icon as={ChevronRight} size="xs" />
          )}
          证据（{fact.evidence.length}）
        </button>
        <button
          type="button"
          className="mb-chip"
          aria-expanded={showRevisionForm}
          onClick={() => {
            setShowRevisionForm((value) => !value)
            setForm({
              field_label: fact.field_label,
              raw_value: fact.raw_value,
              normalized_value: fact.normalized_value == null ? '' : String(fact.normalized_value),
              note: '',
            })
            setNotice(null)
          }}
        >
          <Icon as={Pencil} size="xs" />
          人工修订
        </button>
        <button
          type="button"
          className="mb-chip"
          aria-expanded={showHistory}
          onClick={() => setShowHistory((value) => !value)}
        >
          <Icon as={History} size="xs" />
          查看修订历史（{fact.revision_count}）
        </button>
      </div>

      {notice && (
        <p className="mt-3 text-xs" style={{ color: 'var(--rc-success)' }} role="status">
          {notice}
        </p>
      )}
      {revisionMutation.isError && (
        <p className="mt-3 text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
          修订失败：{errorMessage(revisionMutation.error, '请重试')}
        </p>
      )}

      {showEvidence && (
        <div className="mb-fact__section">
          {fact.evidence.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
              该事实没有关联证据，当前抽取状态为「{extractionLabel[fact.extraction_status] ?? fact.extraction_status}」。
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {fact.evidence.map((evidence) => (
                <div key={evidence.evidence_id} className="mb-evidence">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs" style={{ color: 'var(--rc-text-muted)' }}>
                      {evidence.source_name} · <span className="mb-mono">{evidence.evidence_id}</span>
                    </span>
                    <StatusBadge tone={verificationTone(evidence.verification_status)} dot={false}>
                      {verificationLabel[evidence.verification_status] ?? evidence.verification_status}
                    </StatusBadge>
                  </div>
                  <div className="mt-2">
                    <SourceLocatorView locator={evidence.source_locator} compact />
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="min-w-0">
                      <p className="mb-label">模型引用 quote</p>
                      <pre className="mb-quote">{evidence.quote || '—'}</pre>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-label">后端材料原文 original_text</p>
                      <pre className="mb-quote">{evidence.original_text || '—'}</pre>
                    </div>
                  </div>
                  <Link
                    to={`/materials/${fact.material_id}`}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium"
                    style={{ color: 'var(--rc-violet)' }}
                  >
                    打开原始材料 <Icon as={ExternalLink} size="xs" />
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showRevisionForm && (
        <form
          className="mb-fact__section flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            setNotice(null)
            revisionMutation.mutate()
          }}
        >
          <p className="text-xs" style={{ color: 'var(--rc-text-muted)' }}>
            修订将留痕，提交后本条事实标记为人工确认/修订，不再冒充 AI 原始输出。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="field-label">字段标签</span>
              <input
                className="field-input"
                value={form.field_label}
                onChange={(event) => setForm((prev) => ({ ...prev, field_label: event.target.value }))}
              />
            </label>
            <label className="block">
              <span className="field-label">归一值（留空表示 null）</span>
              <input
                className="field-input"
                value={form.normalized_value}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, normalized_value: event.target.value }))
                }
              />
            </label>
          </div>
          <label className="block">
            <span className="field-label">原始值</span>
            <input
              className="field-input"
              value={form.raw_value}
              onChange={(event) => setForm((prev) => ({ ...prev, raw_value: event.target.value }))}
            />
          </label>
          <label className="block">
            <span className="field-label">修订说明 note</span>
            <textarea
              className="field-input min-h-[72px] resize-y"
              value={form.note}
              placeholder="说明修订依据，例如对照论文 Table 3"
              onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn-primary" disabled={revisionMutation.isPending}>
              <Icon as={Pencil} size="sm" />
              {revisionMutation.isPending ? '提交中…' : '提交修订'}
            </button>
            <button
              type="button"
              className="btn-ghost"
              disabled={revisionMutation.isPending}
              onClick={() => setShowRevisionForm(false)}
            >
              取消
            </button>
          </div>
        </form>
      )}

      {showHistory && (
        <div className="mb-fact__section">
          <p className="mb-label">修订历史</p>
          {revisionsQuery.isPending ? (
            <LoadingState compact message="正在读取修订历史…" />
          ) : revisionsQuery.isError ? (
            <ErrorState
              compact
              message={errorMessage(revisionsQuery.error, '无法获取修订历史。')}
              code={errorCode(revisionsQuery.error)}
              onRetry={() => void revisionsQuery.refetch()}
            />
          ) : (revisionsQuery.data?.items.length ?? 0) === 0 ? (
            <p className="py-4 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
              尚无人工修订记录。
            </p>
          ) : (
            <ul className="mt-2">
              {revisionsQuery.data?.items.map((revision) => (
                <li
                  key={revision.revision_id}
                  className="py-2.5"
                  style={{ borderTop: 'var(--rc-stroke-hair)' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="mb-mono" style={{ color: 'var(--rc-text-subtle)' }}>
                      {revision.revision_id}
                    </span>
                    <span style={{ color: 'var(--rc-text-muted)' }}>
                      {revision.revision_source} · {formatDateTime(revision.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs">
                    <span className="mb-mono" style={{ color: 'var(--rc-text-muted)' }}>
                      {displayValue(revision.old_value)}
                    </span>
                    <span className="mx-2" style={{ color: 'var(--rc-violet)' }}>
                      →
                    </span>
                    <span className="mb-mono font-medium">{displayValue(revision.new_value)}</span>
                  </p>
                  <p className="mb-mono mt-0.5 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                    {revision.field_key}
                  </p>
                  {revision.note && (
                    <p className="mt-1 break-words text-xs" style={{ color: 'var(--rc-text-muted)' }}>
                      说明：{revision.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  )
}

export default function FactsPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const [activeType, setActiveType] = useState<FactType | null>(null)

  const factsQuery = useQuery({
    queryKey: ['facts', projectId],
    queryFn: () => api.listFacts(projectId),
    enabled: !!projectId,
  })

  const summaryQuery = useQuery({
    queryKey: ['facts-summary', projectId],
    queryFn: () => api.getFactsSummary(projectId),
    enabled: !!projectId,
  })

  const materialsQuery = useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
    enabled: !!projectId,
  })

  const facts = useMemo(() => factsQuery.data?.items ?? [], [factsQuery.data])
  const summary = summaryQuery.data
  const materialNames = new Map(
    (materialsQuery.data?.items ?? []).map((material) => [material.material_id, material.filename]),
  )

  /** 真实类型分布：优先用后端 summary.by_type，缺失时由列表聚合 */
  const typeTally = useMemo(() => {
    const counts = new Map<string, number>()
    for (const fact of facts) counts.set(fact.fact_type, (counts.get(fact.fact_type) ?? 0) + 1)
    const fromSummary = summary?.by_type ?? {}
    const keys = new Set<string>([...Object.keys(fromSummary), ...counts.keys()])
    return [...keys.entries()]
      .map(([type]) => ({ type, count: pickCount(fromSummary, type) ?? counts.get(type) ?? 0 }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count)
  }, [facts, summary])

  const totalFacts = typeTally.reduce((sum, item) => sum + item.count, 0)

  const effectiveType: FactType =
    activeType ?? (typeTally[0]?.type as FactType | undefined) ?? 'research_info'

  const visibleFacts = facts.filter((fact) => fact.fact_type === effectiveType)

  /** 当前分组内按断言类型 / 抽取状态的真实占比条 */
  const groupTally = useMemo(() => {
    const assertion = new Map<AssertionType, number>()
    const extraction = new Map<ExtractionStatus, number>()
    for (const fact of visibleFacts) {
      assertion.set(fact.assertion_type, (assertion.get(fact.assertion_type) ?? 0) + 1)
      extraction.set(fact.extraction_status, (extraction.get(fact.extraction_status) ?? 0) + 1)
    }
    return { assertion, extraction, total: visibleFacts.length }
  }, [visibleFacts])

  const statItems = [
    { label: '事实总数', value: summary?.total },
    { label: '有证据', value: summary?.with_evidence },
    { label: '待复核', value: summary?.by_status?.needs_review },
    { label: '人工修订', value: summary?.human_confirmed },
  ]

  const assertionRows = ASSERTION_ORDER.map((key) => ({
    key,
    label: assertionLabel[key],
    count: groupTally.assertion.get(key) ?? 0,
  })).filter((row) => row.count > 0)

  const extractionRows = EXTRACTION_ORDER.map((key) => ({
    key,
    label: extractionLabel[key],
    count: groupTally.extraction.get(key) ?? 0,
  })).filter((row) => row.count > 0)

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <Link to={`/projects/${projectId}/materials`} className="mb-back">
            <Icon name="arrowLeft" size="xs" />
            返回材料列表
          </Link>
          <p className="mb-head__eyebrow mt-3">Facts · 结构透视</p>
          <h1 className="mb-head__title">科研事实</h1>
          <p className="mb-head__desc">
            事实、证据与人工修订均来自后端接口；置信度仅为辅助信息，非校准概率。
            下方结构透视条的宽度严格等于各类型的真实占比，点击即筛选。
          </p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`/projects/${projectId}/evidence-graph`} className="btn-primary">
            <Icon name="network" size="sm" />
            查看证据图谱
          </Link>
          <Link to={`/projects/${projectId}/overview`} className="btn-ghost">
            <Icon name="grid" size="sm" />
            解析概览
          </Link>
        </nav>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statItems.map((item) => (
          <div key={item.label} className="mb-stat">
            <p className="mb-stat__label">{item.label}</p>
            <p className="mb-stat__value">
              {summaryQuery.isPending ? '…' : summaryQuery.isError ? '—' : formatCount(item.value)}
            </p>
          </div>
        ))}
      </div>
      {summaryQuery.isError && (
        <p
          className="rounded-md px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
          role="alert"
        >
          事实汇总加载失败：{errorMessage(summaryQuery.error, '请重试')}
        </p>
      )}

      {/* 特色交互：结构透视条 —— 段宽 ∝ 真实占比，点击切换事实类型筛选 */}
      <section className="mb-panel" aria-label="事实类型结构透视">
        <div className="mb-panel__head">
          <h3 className="mb-panel__title">
            <Icon name="filter" size="sm" tone="accent" />
            事实类型结构透视
          </h3>
          <span className="mb-panel__hint">
            宽度 ∝ 真实占比 · 当前：{factTypeLabel[effectiveType]}
          </span>
        </div>
        <div className="mb-panel__body">
          {factsQuery.isPending ? (
            <LoadingState compact message="正在读取科研事实…" />
          ) : typeTally.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldCheck}
              title="暂无事实分布"
              description="上传材料并发起解析后，这里会按真实类型生成结构透视条。"
            />
          ) : (
            <>
              <div className="mb-ribbon" role="group" aria-label="按事实类型筛选">
                {typeTally.map((item) => {
                  const percent = totalFacts > 0 ? (item.count / totalFacts) * 100 : 0
                  const on = item.type === effectiveType
                  return (
                    <button
                      key={item.type}
                      type="button"
                      aria-pressed={on}
                      className={`mb-ribbon__seg ${on ? 'mb-ribbon__seg--on' : ''}`}
                      style={{ width: `${percent}%` }}
                      onClick={() => setActiveType(item.type as FactType)}
                    >
                      <span className="mb-ribbon__seg__n">{item.count}</span>
                      <span className="mb-ribbon__seg__t">
                        {factTypeLabel[item.type as FactType] ?? item.type}
                      </span>
                      <span className="mb-ribbon__tip" role="tooltip">
                        {factTypeLabel[item.type as FactType] ?? item.type} · {item.count} 条 · 占比{' '}
                        {percent.toFixed(1)}%
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* 完整类型筛选（9 类，含 0 条类型），保证所有分组可达 */}
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="全部事实类型">
                {FACT_TYPE_TABS.map((type) => {
                  const count = typeTally.find((item) => item.type === type)?.count ?? 0
                  const on = type === effectiveType
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={on}
                      className={`mb-chip ${on ? 'mb-chip--on' : ''}`}
                      onClick={() => setActiveType(type)}
                    >
                      {factTypeLabel[type]}
                      <span className="mb-chip__count">{count}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </section>

      {/* 当前分组的断言 / 抽取结构（同样按真实占比） */}
      {visibleFacts.length > 0 && (
        <section className="mb-panel" aria-label="当前分组结构分布">
          <div className="mb-panel__head">
            <h3 className="mb-panel__title">
              <Icon name="grid" size="sm" tone="accent" />
              {factTypeLabel[effectiveType]} · 结构分布
            </h3>
            <span className="mb-panel__hint">{groupTally.total} 条事实</span>
          </div>
          <div className="mb-panel__body grid gap-6 lg:grid-cols-2">
            {[
              { title: '断言类型 assertion', rows: assertionRows },
              { title: '抽取状态 extraction', rows: extractionRows },
            ].map((group) => (
              <div key={group.title}>
                <p className="mb-label mb-2">{group.title}</p>
                {group.rows.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                    暂无统计
                  </p>
                ) : (
                  <div className="mb-ribbon">
                    {group.rows.map((row) => {
                      const percent =
                        groupTally.total > 0 ? (row.count / groupTally.total) * 100 : 0
                      return (
                        <span
                          key={row.key}
                          className={`mb-ribbon__seg ${RIBBON_TONE[row.key] ?? ''}`}
                          style={{ width: `${percent}%` }}
                          tabIndex={0}
                          aria-describedby={`tip-${group.title}-${row.key}`}
                        >
                          <span className="mb-ribbon__seg__n">{row.count}</span>
                          <span className="mb-ribbon__seg__t">{row.label}</span>
                          <span
                            className="mb-ribbon__tip"
                            id={`tip-${group.title}-${row.key}`}
                            role="tooltip"
                          >
                            {row.label} · {row.count} 条 · 占比 {percent.toFixed(1)}%
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 事实卡片清单 */}
      <section className="mb-panel" aria-label="事实清单">
        <div className="mb-panel__head">
          <h3 className="mb-panel__title">
            <Icon name="clipboardCheck" size="sm" tone="accent" />
            {factTypeLabel[effectiveType]} 事实清单
          </h3>
          <span className="mb-panel__hint">{visibleFacts.length} 条</span>
        </div>
        <div className="mb-panel__body">
          {factsQuery.isPending ? (
            <LoadingState compact message="正在读取科研事实…" />
          ) : factsQuery.isError ? (
            <ErrorState
              compact
              message={errorMessage(factsQuery.error, '无法获取科研事实，请确认后端服务已启动。')}
              code={errorCode(factsQuery.error)}
              onRetry={() => void factsQuery.refetch()}
            />
          ) : visibleFacts.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldCheck}
              title={`「${factTypeLabel[effectiveType]}」分组暂无事实`}
              description="可在其他分组查看，或先到材料管理中发起解析与抽取。"
              action={
                <Link to={`/projects/${projectId}/materials`} className="btn-ghost">
                  前往材料管理
                </Link>
              }
            />
          ) : (
            <div className="flex flex-col gap-4">
              {visibleFacts.map((fact) => (
                <FactCard
                  key={fact.fact_id}
                  fact={fact}
                  materialName={materialNames.get(fact.material_id) ?? fact.material_id.slice(0, 12)}
                  projectId={projectId}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
