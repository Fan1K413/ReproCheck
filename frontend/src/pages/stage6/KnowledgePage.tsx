import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Globe,
  Info,
  Library,
  Lock,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { formatDateTime } from '../../features/format'
import { PROVENANCE_CLASSES, RAG_SOURCE_TYPES } from '../../features/stage6Meta'
import { api, ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type { KnowledgeDocument, RagHit } from '../../types/stage6'

const EXAMPLE_QUERIES = [
  'ResNet-50 复现 学习率 warmup',
  'FID 偏高 常见原因',
  '随机种子 缺失 处理',
  '混合精度 环境配置',
]

/** 与后端 PROVENANCE_MAP 对齐：入库时即可预览来源分级。 */
const PROVENANCE_PREVIEW: Record<string, string> = {
  verified_case: 'historical_case',
  normalized_fact: 'historical_case',
  failure_diagnosis: 'historical_case',
  audit_rule: 'external_knowledge',
  repro_method: 'external_knowledge',
  env_config: 'external_knowledge',
}

function errCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function provMeta(key: string): { label: string; tone: 'accent' | 'success' | 'danger' | 'warning' | 'neutral' | 'navy' } {
  return PROVENANCE_CLASSES[key] ?? { label: key, tone: 'neutral' }
}

function HitCard({ hit, rank, maxScore, expanded, onToggle }: {
  hit: RagHit; rank: number; maxScore: number; expanded: boolean; onToggle: () => void
}) {
  const doc = hit.document
  const prov = provMeta(hit.provenance_class)
  const width = Math.max(2, Math.round((hit.score / maxScore) * 100))
  const sourceRef = hit.source_ref || doc.source_ref
  const long = doc.content.length > 140
  return (
    <article className="panel p-4">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-wash text-[11px] font-semibold text-accent-dark">{rank}</span>
        <h4 className="min-w-0 flex-1 text-sm font-semibold text-ink">{doc.title}</h4>
        <StatusBadge tone="neutral" dot={false}>{RAG_SOURCE_TYPES[doc.source_type] ?? doc.source_type}</StatusBadge>
        <StatusBadge tone={prov.tone} dot={false}>{prov.label}</StatusBadge>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-wash">
          <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
        </div>
        <span className="mono shrink-0 text-[11px] text-ink-muted">score {hit.score.toFixed(4)}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="mono rounded bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">{sourceRef || '（无来源引用）'}</span>
        {sourceRef && <CopyButton text={sourceRef} label="复制来源" className="px-2 py-1 text-xs" />}
      </div>
      <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted ${expanded ? '' : 'line-clamp-3'}`}>
        {doc.content}
      </p>
      {long && (
        <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline" onClick={onToggle}>
          {expanded ? <ChevronDown size={16} strokeWidth={1.8} /> : <ChevronRight size={16} strokeWidth={1.8} />}
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </article>
  )
}

function DocCard({ doc, expanded, onToggle }: { doc: KnowledgeDocument; expanded: boolean; onToggle: () => void }) {
  const prov = provMeta(doc.provenance_class)
  const long = doc.content.length > 140
  return (
    <article className="rounded-lg border border-line-soft bg-surface p-3">
      <div className="flex flex-wrap items-start gap-2">
        <h4 className="min-w-0 flex-1 text-sm font-semibold text-ink">{doc.title}</h4>
        <StatusBadge tone="neutral" dot={false}>{RAG_SOURCE_TYPES[doc.source_type] ?? doc.source_type}</StatusBadge>
        <StatusBadge tone={prov.tone} dot={false}>{prov.label}</StatusBadge>
        <StatusBadge tone={doc.is_public ? 'success' : 'neutral'} dot={false}>
          {doc.is_public ? <Globe size={16} strokeWidth={1.8} /> : <Lock size={16} strokeWidth={1.8} />}
          {doc.is_public ? '公开' : '组织内'}
        </StatusBadge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
        <span className="mono rounded bg-canvas px-2 py-0.5 text-ink-muted">{doc.source_ref || '（无来源引用）'}</span>
        <span className="mono">入库 {formatDateTime(doc.created_at)}</span>
      </div>
      <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-ink-muted ${expanded ? '' : 'line-clamp-2'}`}>
        {doc.content}
      </p>
      {long && (
        <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline" onClick={onToggle}>
          {expanded ? <ChevronDown size={16} strokeWidth={1.8} /> : <ChevronRight size={16} strokeWidth={1.8} />}
          {expanded ? '收起' : '展开'}
        </button>
      )}
    </article>
  )
}

export default function KnowledgePage() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('search')
  const [queryText, setQueryText] = useState(EXAMPLE_QUERIES[0])
  const [projectId, setProjectId] = useState('')
  const [topK, setTopK] = useState('5')
  const [synthesize, setSynthesize] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<Parameters<typeof stage6Api.ragQuery>[0] | null>(null)
  const [hitExpanded, setHitExpanded] = useState<Record<string, boolean>>({})
  const [docExpanded, setDocExpanded] = useState<Record<string, boolean>>({})
  const [sourceFilter, setSourceFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [docForm, setDocForm] = useState({ source_type: 'repro_method', title: '', content: '', source_ref: '', is_public: false })
  const [docErrors, setDocErrors] = useState<Record<string, string>>({})

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const docsAllQuery = useQuery({ queryKey: ['stage6-rag-docs', 'all'], queryFn: () => stage6Api.listDocuments() })
  const docsQuery = useQuery({
    queryKey: ['stage6-rag-docs', sourceFilter || 'all'],
    queryFn: () => stage6Api.listDocuments(sourceFilter || undefined),
  })

  const ragMut = useMutation({
    mutationFn: (body: Parameters<typeof stage6Api.ragQuery>[0]) => stage6Api.ragQuery(body),
    onSuccess: (data) => toast.success(`检索完成：命中 ${data.hits.length} 条（候选 ${data.total_candidates} 篇）`),
    onError: (error) => toast.error(error.message),
  })
  const addMut = useMutation({
    mutationFn: (body: Parameters<typeof stage6Api.addDocument>[0]) => stage6Api.addDocument(body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-rag-docs'] })
      setAddOpen(false)
      toast.success(`文档已入库：${data.title}（${RAG_SOURCE_TYPES[data.source_type] ?? data.source_type}）`)
    },
    onError: (error) => toast.error(error.message),
  })

  const submitQuery = () => {
    if (!queryText.trim()) { setQueryError('请输入检索问题。'); return }
    const k = Number(topK)
    if (!Number.isInteger(k) || k < 1 || k > 20) { setQueryError('top_k 须为 1–20 的整数。'); return }
    setQueryError(null)
    const body = { query: queryText.trim(), project_id: projectId || null, top_k: k, synthesize }
    setLastRun(body)
    ragMut.mutate(body)
  }
  const openAdd = () => {
    setDocForm({ source_type: 'repro_method', title: '', content: '', source_ref: '', is_public: false })
    setDocErrors({})
    setAddOpen(true)
  }
  const submitAdd = () => {
    const errors: Record<string, string> = {}
    if (!docForm.title.trim()) errors.title = '请填写文档标题。'
    if (!docForm.content.trim()) errors.content = '请填写文档内容。'
    setDocErrors(errors)
    if (Object.keys(errors).length > 0) return
    addMut.mutate({
      source_type: docForm.source_type,
      title: docForm.title.trim(),
      content: docForm.content.trim(),
      source_ref: docForm.source_ref.trim(),
      is_public: docForm.is_public,
    })
  }

  const result = ragMut.data
  const hits = result?.hits ?? []
  const maxScore = hits.length > 0 ? Math.max(...hits.map((h) => h.score), 1e-9) : 1
  const docs = docsQuery.data?.items ?? []
  const previewProv = provMeta(PROVENANCE_PREVIEW[docForm.source_type] ?? 'external_knowledge')

  return (
    <div className="space-y-5">
      <PageHeader
        title="知识库与受控检索"
        description="确定性 TF-IDF 检索 + 来源分级治理：历史案例与外部知识只能补充参考，当前论文原始证据永远优先；模型推断显式标注、绝不冒充证据。"
      />

      <Tabs
        active={tab} onChange={setTab}
        tabs={[
          { key: 'search', label: '知识检索', icon: Search },
          { key: 'docs', label: '文档库', icon: Library, count: docsAllQuery.data?.total },
        ]}
      />

      {tab === 'search' && (
        <div className="space-y-4">
          <section className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <BookOpen size={16} strokeWidth={1.8} className="text-accent-dark" />知识库概览
              </h3>
              {docsAllQuery.data && <StatusBadge tone="neutral" dot={false}>{docsAllQuery.data.total} 篇可见文档</StatusBadge>}
            </div>
            {docsAllQuery.isPending ? (
              <LoadingState compact message="正在统计知识库…" />
            ) : docsAllQuery.isError ? (
              <ErrorState compact message={docsAllQuery.error.message} code={errCode(docsAllQuery.error)} onRetry={() => void docsAllQuery.refetch()} />
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {Object.entries(RAG_SOURCE_TYPES).map(([key, label]) => {
                  const count = (docsAllQuery.data?.items ?? []).filter((d) => d.source_type === key).length
                  return (
                    <span key={key} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1 text-[11px] text-ink-muted">
                      {label}<span className="mono font-semibold text-ink">{count}</span>
                    </span>
                  )
                })}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-subtle">检索范围为你可见的公共与本组织文档；命中均带来源引用（source_ref）与证据分级（provenance_class）。</p>
          </section>

          <section className="panel p-4 sm:p-5">
            <label className="field-label">检索问题 query *</label>
            <textarea
              className="field-input" rows={3}
              placeholder="描述你想检索的复现知识，如：ResNet-50 复现 学习率 warmup"
              value={queryText}
              onChange={(e) => { setQueryText(e.target.value); setQueryError(null) }}
            />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q} type="button"
                  className="rounded-full border border-line bg-canvas px-3 py-1 text-[11px] text-ink-muted transition hover:border-accent/50 hover:text-accent-dark"
                  onClick={() => { setQueryText(q); setQueryError(null) }}
                >
                  {q}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="field-label">限定项目（可选）</label>
                <select className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                  disabled={projectsQuery.isPending || projectsQuery.isError}>
                  <option value="">全部项目</option>
                  {projectsQuery.isPending && <option disabled>项目加载中…</option>}
                  {projectsQuery.isError && <option disabled>项目列表不可用</option>}
                  {(projectsQuery.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="field-label">返回条数 top_k（1–20）</label>
                <input type="number" min={1} max={20} className="field-input mono" value={topK}
                  onChange={(e) => { setTopK(e.target.value); setQueryError(null) }} />
              </div>
              <div className="flex flex-col justify-end">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" className="h-4 w-4 accent-accent" checked={synthesize}
                    onChange={(e) => setSynthesize(e.target.checked)} />
                  综合推断 synthesize
                </label>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-subtle">综合推断需后端配置 LLM；未配置时仅返回检索结果。</p>
              </div>
            </div>
            {queryError && <p className="mt-2 text-xs text-danger">{queryError}</p>}
            <div className="mt-3 flex justify-end">
              <button type="button" className="btn-primary" disabled={ragMut.isPending} onClick={submitQuery}>
                <Search size={16} strokeWidth={1.8} />{ragMut.isPending ? '检索中…' : '开始检索'}
              </button>
            </div>
          </section>

          {ragMut.isPending && <div className="panel"><LoadingState compact message="正在执行确定性检索…" hint="POST /rag/query" /></div>}
          {ragMut.isError && (
            <div className="panel">
              <ErrorState
                compact message={ragMut.error.message} code={errCode(ragMut.error)}
                onRetry={lastRun ? () => ragMut.mutate(lastRun) : undefined}
              />
            </div>
          )}

          {result && (
            <div className="space-y-4">
              <div className="rounded-panel border border-warning/40 bg-warning-wash p-4">
                <div className="flex items-start gap-3">
                  <ShieldAlert size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-warning" />
                  <div className="min-w-0 space-y-1.5">
                    <p className="text-sm font-semibold text-warning">来源分级与证据优先原则</p>
                    <p className="text-sm leading-relaxed text-ink">{result.provenance.note}</p>
                    <p className="text-xs leading-relaxed text-ink-muted">{result.provenance.current_evidence_priority}</p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {Object.entries(result.provenance.classes).map(([key, desc]) => {
                        const m = provMeta(key)
                        return (
                          <span key={key} title={desc}>
                            <StatusBadge tone={m.tone} dot={false}>{m.label}</StatusBadge>
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="neutral" dot={false}>候选文档 {result.total_candidates}</StatusBadge>
                <StatusBadge tone="accent" dot={false}>命中 {hits.length}</StatusBadge>
                <StatusBadge tone="neutral" dot={false}>top_k {result.top_k}</StatusBadge>
                <span className="mono rounded bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">query: {result.query}</span>
                {result.project_id && <span className="mono rounded bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">project: {result.project_id}</span>}
              </div>

              {result.synthesis ? (
                <div className="rounded-panel border border-warning/40 bg-warning-wash p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Sparkles size={18} strokeWidth={1.8} className="text-warning" />
                    <h4 className="text-sm font-semibold text-warning">模型推断（model_inference）· 非事实证据</h4>
                    <StatusBadge tone="navy" dot={false}>{result.synthesis.model}</StatusBadge>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{result.synthesis.answer}</p>
                  {result.synthesis.sources.length > 0 && (
                    <div className="mt-3 space-y-1 border-t border-line pt-2">
                      <p className="text-[11px] font-semibold text-ink-subtle">引用来源</p>
                      {result.synthesis.sources.map((s) => (
                        <p key={`${s.index}-${s.document_id}`} className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                          <span className="mono">[{s.index}]</span>
                          <span className="mono">{s.source_ref || s.document_id}</span>
                          <StatusBadge tone={provMeta(s.provenance_class).tone} dot={false}>{provMeta(s.provenance_class).label}</StatusBadge>
                        </p>
                      ))}
                    </div>
                  )}
                  <p className="mt-2 text-[11px] leading-relaxed text-warning">
                    以上内容由大模型基于检索命中合成，仅供参考，不构成审计证据；结论须以当前论文原始证据为准。
                  </p>
                </div>
              ) : lastRun?.synthesize ? (
                <div className="flex items-start gap-2 rounded-panel border border-accent/30 bg-accent-wash px-4 py-3">
                  <Info size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent-dark" />
                  <p className="text-xs leading-relaxed text-accent-dark">LLM 未配置或不可用，仅展示检索结果（确定性检索不受影响）。</p>
                </div>
              ) : null}

              {hits.length === 0 ? (
                <div className="panel">
                  <EmptyState
                    compact icon={Search} title="未命中任何文档"
                    description="尝试更换关键词（支持中文二元组匹配），或先在文档库中入库相关知识。"
                    action={<button type="button" className="btn-ghost" onClick={() => setTab('docs')}><Library size={16} strokeWidth={1.8} />去文档库</button>}
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  {hits.map((hit, index) => (
                    <HitCard
                      key={hit.document.id} hit={hit} rank={index + 1} maxScore={maxScore}
                      expanded={!!hitExpanded[hit.document.id]}
                      onToggle={() => setHitExpanded((s) => ({ ...s, [hit.document.id]: !s[hit.document.id] }))}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {!result && !ragMut.isPending && !ragMut.isError && (
            <div className="panel">
              <EmptyState
                icon={Search} title="输入问题开始受控检索"
                description="点击上方示例问题快速填入，检索结果将附带来源分级与证据优先提示。"
              />
            </div>
          )}
        </div>
      )}

      {tab === 'docs' && (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Library size={16} strokeWidth={1.8} className="text-accent-dark" />知识文档
              {docsQuery.data && <StatusBadge tone="neutral" dot={false}>{docsQuery.data.total} 篇</StatusBadge>}
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <select className="field-input w-auto py-1.5 text-xs" value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)} aria-label="按来源类型筛选">
                <option value="">全部来源</option>
                {Object.entries(RAG_SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={openAdd}>
                <Plus size={16} strokeWidth={1.8} />新增文档
              </button>
            </div>
          </div>
          {docsQuery.isPending ? (
            <LoadingState message="正在读取知识文档…" hint="GET /rag/documents" />
          ) : docsQuery.isError ? (
            <ErrorState message={docsQuery.error.message} code={errCode(docsQuery.error)} onRetry={() => void docsQuery.refetch()} />
          ) : docs.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={sourceFilter ? '该来源类型下暂无文档' : '知识库为空'}
              description="入库复现方法、环境配置、失败诊断等知识，供受控检索使用。"
              action={<button type="button" className="btn-primary" onClick={openAdd}><Plus size={16} strokeWidth={1.8} />新增文档</button>}
            />
          ) : (
            <div className="space-y-3 p-4">
              {docs.map((doc) => (
                <DocCard
                  key={doc.id} doc={doc} expanded={!!docExpanded[doc.id]}
                  onToggle={() => setDocExpanded((s) => ({ ...s, [doc.id]: !s[doc.id] }))}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* 新增文档 */}
      <Modal
        open={addOpen} onClose={() => setAddOpen(false)}
        title="新增知识文档"
        description="入库后按来源类型自动分级（provenance_class）；需要 rule.manage 或 case.manage 权限。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={addMut.isPending} onClick={submitAdd}>
              <Plus size={16} strokeWidth={1.8} />{addMut.isPending ? '入库中…' : '入库文档'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="field-label">来源类型 source_type *</label>
            <select className="field-input" value={docForm.source_type}
              onChange={(e) => setDocForm({ ...docForm, source_type: e.target.value })}>
              {Object.entries(RAG_SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}（{key}）</option>)}
            </select>
            <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-subtle">
              分级预览：<StatusBadge tone={previewProv.tone} dot={false}>{previewProv.label}</StatusBadge>
              知识库内容永远不是当前证据（current_evidence）。
            </p>
          </div>
          <div>
            <label className="field-label">标题 title *</label>
            <input className="field-input" placeholder="如：ResNet-50 复现学习率调度最佳实践" value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
            {docErrors.title && <p className="mt-1 text-xs text-danger">{docErrors.title}</p>}
          </div>
          <div>
            <label className="field-label">内容 content *</label>
            <textarea className="field-input" rows={6} placeholder="填写可检索的知识正文：方法步骤、环境要点、诊断结论等。" value={docForm.content}
              onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} />
            {docErrors.content && <p className="mt-1 text-xs text-danger">{docErrors.content}</p>}
          </div>
          <div>
            <label className="field-label">来源引用 source_ref（可选）</label>
            <input className="field-input mono" placeholder="如：doi:10.xxxx/xxxx 或内部文档编号" value={docForm.source_ref}
              onChange={(e) => setDocForm({ ...docForm, source_ref: e.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-accent" checked={docForm.is_public}
              onChange={(e) => setDocForm({ ...docForm, is_public: e.target.checked })} />
            <span>
              公开可见
              <span className="mt-0.5 block text-[11px] font-normal text-ink-subtle">勾选后组织外成员也可检索；默认仅本组织可见。</span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  )
}