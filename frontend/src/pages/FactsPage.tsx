import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  ExternalLink,
  History,
  Pencil,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
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
import type { FactType, FactViewV2 } from '../types/api'

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
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
    <article className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold text-ink">
            {fact.field_label || fact.field_key}
          </p>
          <p className="mono mt-0.5 break-all text-xs text-ink-subtle">{fact.field_key}</p>
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
              <ShieldCheck size={12} />
              人工确认/修订
            </StatusBadge>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-canvas px-3 py-2.5">
        <span className="text-xs text-ink-subtle">原始值</span>
        <span className="mono min-w-0 break-all text-sm text-ink-muted">
          {fact.raw_value || '—'}
        </span>
        <span className="text-accent">→</span>
        <span className="text-xs text-ink-subtle">归一值</span>
        <span className="mono min-w-0 break-all text-sm font-medium text-ink">
          {displayValue(fact.normalized_value, fact.unit)}
        </span>
      </div>

      {humanRevised && (
        <p className="mt-3 text-xs text-accent-dark">
          该值已经人工修订（{fact.revision_count} 次），非 AI 原始输出。
        </p>
      )}

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          <span className="font-semibold text-ink-subtle">来源材料</span>
          <Link to={`/materials/${fact.material_id}`} className="text-accent hover:underline">
            {materialName}
          </Link>
          <span className="mono text-ink-subtle">{fact.material_id.slice(0, 10)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="shrink-0 text-xs font-semibold text-ink-subtle">证据位置</span>
          <SourceLocatorView locator={firstEvidence?.source_locator} compact />
        </div>
        <p className="text-xs text-ink-subtle" title="该数值为辅助置信度，非校准概率">
          辅助置信度 {formatConfidence(fact.confidence)}（非校准概率，仅供排序参考）·
          抽取来源 {fact.parser_source} ·{' '}
          <span className="mono">{formatDateTime(fact.created_at)}</span>
        </p>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line-soft pt-4">
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowEvidence((value) => !value)}
        >
          {showEvidence ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          证据（{fact.evidence.length}）
        </button>
        <button
          type="button"
          className="btn-ghost"
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
          <Pencil size={14} />
          人工修订
        </button>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setShowHistory((value) => !value)}
        >
          <History size={14} />
          查看修订历史（{fact.revision_count}）
        </button>
      </div>

      {notice && <p className="mt-3 text-xs text-success" role="status">{notice}</p>}
      {revisionMutation.isError && (
        <p className="mt-3 text-xs text-danger" role="alert">
          修订失败：{errorMessage(revisionMutation.error, '请重试')}
        </p>
      )}

      {showEvidence && (
        <div className="mt-4 space-y-3 border-t border-line-soft pt-4">
          {fact.evidence.length === 0 ? (
            <p className="text-xs text-ink-subtle">
              该事实没有关联证据，当前抽取状态为「{extractionLabel[fact.extraction_status] ?? fact.extraction_status}」。
            </p>
          ) : (
            fact.evidence.map((evidence) => (
              <div key={evidence.evidence_id} className="rounded-md bg-canvas p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-muted">
                    {evidence.source_name} · <span className="mono">{evidence.evidence_id}</span>
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
                    <p className="text-[11px] font-semibold text-ink-subtle">模型引用 quote</p>
                    <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-2 text-xs text-ink">
                      {evidence.quote || '—'}
                    </pre>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-ink-subtle">后端材料原文 original_text</p>
                    <pre className="mono mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-surface p-2 text-xs text-ink">
                      {evidence.original_text || '—'}
                    </pre>
                  </div>
                </div>
                <Link
                  to={`/materials/${fact.material_id}`}
                  className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                >
                  打开原始材料 <ExternalLink size={12} />
                </Link>
              </div>
            ))
          )}
        </div>
      )}

      {showRevisionForm && (
        <form
          className="mt-4 space-y-3 border-t border-line-soft pt-4"
          onSubmit={(event) => {
            event.preventDefault()
            setNotice(null)
            revisionMutation.mutate()
          }}
        >
          <p className="text-xs text-ink-muted">
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
                onChange={(event) => setForm((prev) => ({ ...prev, normalized_value: event.target.value }))}
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
              <Pencil size={14} />
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
        <div className="mt-4 border-t border-line-soft pt-4">
          <p className="text-xs font-semibold text-ink-muted">修订历史</p>
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
            <p className="py-4 text-xs text-ink-subtle">尚无人工修订记录。</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-soft">
              {revisionsQuery.data?.items.map((revision) => (
                <li key={revision.revision_id} className="py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="mono text-ink-subtle">{revision.revision_id}</span>
                    <span className="text-ink-muted">
                      {revision.revision_source} · {formatDateTime(revision.created_at)}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-xs text-ink">
                    <span className="mono text-ink-muted">{displayValue(revision.old_value)}</span>
                    <span className="mx-2 text-accent">→</span>
                    <span className="mono font-medium">{displayValue(revision.new_value)}</span>
                  </p>
                  <p className="mono mt-0.5 text-[11px] text-ink-subtle">{revision.field_key}</p>
                  {revision.note && (
                    <p className="mt-1 break-words text-xs text-ink-muted">说明：{revision.note}</p>
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

  const facts = factsQuery.data?.items ?? []
  const summary = summaryQuery.data
  const materialNames = new Map(
    (materialsQuery.data?.items ?? []).map((material) => [material.material_id, material.filename]),
  )
  const effectiveType =
    activeType ?? FACT_TYPE_TABS.find((type) => facts.some((fact) => fact.fact_type === type)) ?? 'research_info'
  const visibleFacts = facts.filter((fact) => fact.fact_type === effectiveType)

  function countFor(type: FactType): number {
    const fromList = facts.filter((fact) => fact.fact_type === type).length
    return summary?.by_type?.[type] ?? fromList
  }

  const statItems = [
    { label: '事实总数', value: summary?.total },
    { label: '有证据', value: summary?.with_evidence },
    { label: '待复核', value: summary?.by_status?.needs_review },
    { label: '人工修订', value: summary?.human_confirmed },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`/projects/${projectId}/materials`} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent">
            <ArrowLeft size={13} />
            返回材料列表
          </Link>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Facts</p>
          <h2 className="mt-1 text-lg font-semibold">科研事实</h2>
          <p className="mt-1 text-sm text-ink-muted">
            事实、证据与人工修订均来自后端接口；置信度仅为辅助信息，非校准概率。
          </p>
        </div>
        <Link to={`/projects/${projectId}/overview`} className="btn-ghost">解析概览</Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statItems.map((item) => (
          <div key={item.label} className="panel p-4">
            <p className="text-xs text-ink-muted">{item.label}</p>
            <p className="mono mt-1 text-2xl font-semibold leading-none text-ink">
              {summaryQuery.isPending ? '…' : summaryQuery.isError ? '—' : formatCount(item.value)}
            </p>
          </div>
        ))}
      </div>
      {summaryQuery.isError && (
        <p className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
          事实汇总加载失败：{errorMessage(summaryQuery.error, '请重试')}
        </p>
      )}

      <div className="panel overflow-hidden">
        <div className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2" role="tablist">
          {FACT_TYPE_TABS.map((type) => (
            <button
              key={type}
              type="button"
              role="tab"
              aria-selected={effectiveType === type}
              onClick={() => setActiveType(type)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                effectiveType === type
                  ? 'bg-accent text-white'
                  : 'text-ink-muted hover:bg-canvas hover:text-ink'
              }`}
            >
              {factTypeLabel[type]}
              <span className={`mono rounded px-1.5 text-[11px] ${effectiveType === type ? 'bg-white/20' : 'bg-neutral-wash'}`}>
                {countFor(type)}
              </span>
            </button>
          ))}
        </div>

        <div className="p-4 sm:p-5">
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
              icon={ClipboardList}
              title={`「${factTypeLabel[effectiveType]}」分组暂无事实`}
              description="可在其他分组查看，或先到材料管理中发起解析与抽取。"
              action={
                <Link to={`/projects/${projectId}/materials`} className="btn-ghost">
                  前往材料管理
                </Link>
              }
            />
          ) : (
            <div className="space-y-4">
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
      </div>
    </div>
  )
}
