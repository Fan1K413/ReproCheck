import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen,
  ChevronRight,
  FileText,
  Globe,
  Info,
  Library,
  Lock,
  Search,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
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
import '../../styles/wave-d-stage6.css'

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

/** 来源分级 → 语义色（与 PROVENANCE_CLASSES 的 tone 保持一致）。 */
const PROVENANCE_COLOR: Record<string, string> = {
  current_evidence: 'var(--rc-success)',
  historical_case: 'var(--rc-warning)',
  external_knowledge: 'var(--rc-accent)',
  model_inference: 'var(--rc-magenta)',
}

function errCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function provMeta(key: string): { label: string; tone: 'accent' | 'success' | 'danger' | 'warning' | 'neutral' | 'navy' } {
  return PROVENANCE_CLASSES[key] ?? { label: key, tone: 'neutral' }
}

/* --------------------------------------------------------------------------
 * 扇形分区：知识库来源类型占比（角度 ∝ 真实文档数）
 * ------------------------------------------------------------------------ */
const RING_SIZE = 260
const RING_CENTER = RING_SIZE / 2
const RING_OUTER = 104
const RING_INNER = 58

function ringPolar(radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: RING_CENTER + radius * Math.cos(rad), y: RING_CENTER + radius * Math.sin(rad) }
}

function buildRing(counts: { key: string; count: number }[]) {
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  if (total === 0) return []
  let cursor = 0
  return counts.map((item, index) => {
    const ratio = item.count / total
    const start = cursor
    const end = cursor + ratio * 360
    cursor = end
    const outerStart = ringPolar(RING_OUTER, start)
    const outerEnd = ringPolar(RING_OUTER, end)
    const innerStart = ringPolar(RING_INNER, start)
    const innerEnd = ringPolar(RING_INNER, end)
    const largeArc = ratio > 0.5 ? 1 : 0
    const path = [
      `M ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      `L ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${RING_OUTER} ${RING_OUTER} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
      `A ${RING_INNER} ${RING_INNER} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      'Z',
    ].join(' ')
    const mid = ringPolar((RING_OUTER + RING_INNER) / 2 + 10, (start + end) / 2)
    return { key: item.key, count: item.count, ratio, path, labelPos: mid, index }
  })
}

/* --------------------------------------------------------------------------
 * 知识网络：中心为查询问题，外围节点为命中文档，连线粗细 ∝ 真实 score
 * ------------------------------------------------------------------------ */
const NET_W = 660
const NET_CX = NET_W / 2

function networkPoints(count: number) {
  const radiusX = count <= 4 ? 120 : count <= 8 ? 180 : 230
  const radiusY = count <= 4 ? 80 : count <= 8 ? 120 : 145
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / Math.max(1, count)) * Math.PI * 2 - Math.PI / 2
    return {
      x: NET_CX + radiusX * Math.cos(angle),
      y: 0,
      dy: radiusY * Math.sin(angle),
    }
  })
}

function KnowledgeNetwork({ hits, maxScore, selectedId, onSelect }: {
  hits: RagHit[]
  maxScore: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const points = networkPoints(hits.length)
  /* 命中少时压缩画布高度，避免大片留白 */
  const netH = hits.length <= 2 ? 250 : hits.length <= 5 ? 320 : 380
  const netCY = netH / 2
  return (
    <svg className="rcw-net" viewBox={`0 0 ${NET_W} ${netH}`} role="group" aria-label="知识命中网络">
      {hits.map((hit, index) => {
        const point = points[index]
        const ratio = maxScore > 0 ? Math.max(0.05, Math.min(1, hit.score / maxScore)) : 0.05
        const color = PROVENANCE_COLOR[hit.provenance_class] ?? 'var(--rc-accent)'
        const selected = selectedId === hit.document.id
        return (
          <g key={hit.document.id}>
            <line
              className="rcw-net-edge"
              x1={NET_CX}
              y1={netCY}
              x2={point.x}
              y2={netCY + point.dy}
              strokeWidth={1 + ratio * 4}
              stroke={color}
              opacity={selected ? 0.95 : 0.42}
            />
            <g
              className="rcw-net-node"
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`命中文档 ${hit.document.title}，分数 ${hit.score.toFixed(4)}，来源分级 ${provMeta(hit.provenance_class).label}`}
              onClick={() => onSelect(hit.document.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(hit.document.id)
                }
              }}
            >
              <circle cx={point.x} cy={netCY + point.dy} r={6 + ratio * 8} fill={color} fillOpacity={selected ? 0.95 : 0.65} stroke="var(--rc-bg)" strokeWidth={1.5} />
              <text className="rcw-net-label" x={point.x} y={netCY + point.dy + 20} textAnchor="middle">
                {hit.document.title.slice(0, 12)}{hit.document.title.length > 12 ? '…' : ''}
              </text>
            </g>
          </g>
        )
      })}
      {/* 中心节点：查询问题 */}
      <circle cx={NET_CX} cy={netCY} r={30} fill="var(--rc-surface-3)" stroke="var(--rc-magenta)" strokeWidth={1.5} />
      <text
        x={NET_CX}
        y={netCY + 4}
        textAnchor="middle"
        style={{ fontFamily: 'var(--rc-font-mono)', fontSize: 11, letterSpacing: 'var(--rc-ls-mono)', fill: 'var(--rc-text)' }}
      >
        QUERY
      </text>
      <text
        x={NET_CX}
        y={netCY + 50}
        textAnchor="middle"
        style={{ fontSize: 12, fill: 'var(--rc-text-muted)' }}
      >
        命中 {hits.length} 篇 · 连线粗细 ∝ 相似度
      </text>
    </svg>
  )
}

function HitCard({ hit, rank, maxScore, expanded, onToggle, selected }: {
  hit: RagHit; rank: number; maxScore: number; expanded: boolean; onToggle: () => void; selected: boolean
}) {
  const doc = hit.document
  const prov = provMeta(hit.provenance_class)
  const ratio = maxScore > 0 ? Math.max(0.02, Math.min(1, hit.score / maxScore)) : 0
  const sourceRef = hit.source_ref || doc.source_ref
  const long = doc.content.length > 140
  return (
    <article className="rcw-card rcw-card-tight" style={selected ? { borderColor: 'var(--rc-accent)' } : undefined}>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
        <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold rcw-ink"
          style={{ backgroundColor: 'var(--rcw-tint)' }}>
          {rank}
        </span>
        <h4 className="min-w-0 flex-1 text-sm font-semibold">{doc.title}</h4>
        <StatusBadge tone="neutral" dot={false}>{RAG_SOURCE_TYPES[doc.source_type] ?? doc.source_type}</StatusBadge>
        <StatusBadge tone={prov.tone} dot={false}>{prov.label}</StatusBadge>
      </div>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', marginTop: 'var(--rc-space-3)' }}>
        <div className="rcw-bar flex-1" role="img" aria-label={`相似度 ${(ratio * 100).toFixed(0)}%`}>
          <span style={{ '--rcw-bar': ratio } as CSSProperties} />
        </div>
        <span className="mono shrink-0 text-[11px] rcw-muted">score {hit.score.toFixed(4)}</span>
      </div>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginTop: 'var(--rc-space-2)' }}>
        <span className="rcw-chip">{sourceRef || '（无来源引用）'}</span>
        {sourceRef && <CopyButton text={sourceRef} label="复制来源" className="px-2 py-1 text-xs" />}
      </div>
      <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed rcw-muted ${expanded ? '' : 'line-clamp-3'}`}>
        {doc.content}
      </p>
      {long && (
        <button type="button" className="rcw-row mt-1 text-xs font-medium rcw-ink" style={{ gap: 'var(--rc-space-1)' }} onClick={onToggle}>
          {expanded ? <Icon name="chevronDown" size="xs" /> : <Icon as={ChevronRight} size="xs" />}
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
    <article className="rcw-card rcw-card-tight rcw-card-hover">
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
        <h4 className="min-w-0 flex-1 text-sm font-semibold">{doc.title}</h4>
        <StatusBadge tone="neutral" dot={false}>{RAG_SOURCE_TYPES[doc.source_type] ?? doc.source_type}</StatusBadge>
        <StatusBadge tone={prov.tone} dot={false}>{prov.label}</StatusBadge>
        <StatusBadge tone={doc.is_public ? 'success' : 'neutral'} dot={false}>
          {doc.is_public ? <Icon as={Globe} size="xs" /> : <Icon as={Lock} size="xs" />}
          {doc.is_public ? '公开' : '组织内'}
        </StatusBadge>
      </div>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginTop: 'var(--rc-space-2)' }}>
        <span className="rcw-chip">{doc.source_ref || '（无来源引用）'}</span>
        <span className="mono text-[11px] rcw-faint">入库 {formatDateTime(doc.created_at)}</span>
      </div>
      <p className={`mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed rcw-muted ${expanded ? '' : 'line-clamp-2'}`}>
        {doc.content}
      </p>
      {long && (
        <button type="button" className="rcw-row mt-1 text-xs font-medium rcw-ink" style={{ gap: 'var(--rc-space-1)' }} onClick={onToggle}>
          {expanded ? <Icon name="chevronDown" size="xs" /> : <Icon as={ChevronRight} size="xs" />}
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
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
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
    setSelectedDocId(null)
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
  const sourceCounts = Object.entries(RAG_SOURCE_TYPES).map(([key, label]) => ({
    key,
    label,
    count: (docsAllQuery.data?.items ?? []).filter((d) => d.source_type === key).length,
  }))
  const ring = buildRing(sourceCounts)
  const selectedHit = hits.find((hit) => hit.document.id === selectedDocId) ?? null

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="知识库与受控检索"
          description="确定性 TF-IDF 检索 + 来源分级治理：历史案例与外部知识只能补充参考，当前论文原始证据永远优先；模型推断显式标注、绝不冒充证据。"
        />

        <Tabs
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'search', label: '知识检索', icon: Search },
            { key: 'docs', label: '文档库', icon: Library, count: docsAllQuery.data?.total },
          ]}
        />

        {tab === 'search' && (
          <div className="rcw-stack">
            {/* ---------- 知识库扇形概览 ---------- */}
            <section className="rcw-card rcw-card-tight">
              <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                  <Icon as={BookOpen} size="sm" tone="accent" />知识库扇区
                </h3>
                {docsAllQuery.data && <StatusBadge tone="neutral" dot={false}>{docsAllQuery.data.total} 篇可见文档</StatusBadge>}
              </div>
              {docsAllQuery.isPending ? (
                <LoadingState compact message="正在统计知识库…" />
              ) : docsAllQuery.isError ? (
                <ErrorState compact message={docsAllQuery.error.message} code={errCode(docsAllQuery.error)} onRetry={() => void docsAllQuery.refetch()} />
              ) : (
                <div className="rcw-split" style={{ gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)' }}>
                  <svg className="rcw-wheel" style={{ maxHeight: 260 }} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} role="group" aria-label="知识来源类型扇形分布">
                    <circle cx={RING_CENTER} cy={RING_CENTER} r={RING_INNER - 5} fill="var(--rc-surface-2)" stroke="var(--rc-border-hair)" />
                    {ring.map((sector) => (
                      <g key={sector.key}>
                        <path
                          className="rcw-wheel-sector"
                          d={sector.path}
                          role="button"
                          tabIndex={0}
                          aria-label={`${RAG_SOURCE_TYPES[sector.key] ?? sector.key}，${sector.count} 篇，占比 ${(sector.ratio * 100).toFixed(1)}%`}
                          fill="var(--rc-accent)"
                          fillOpacity={sourceFilter === sector.key ? 0.78 : 0.24 + (sector.index % 4) * 0.08}
                          stroke={sourceFilter === sector.key ? 'var(--rc-magenta)' : 'var(--rc-border)'}
                          strokeWidth={sourceFilter === sector.key ? 1.5 : 1}
                          onClick={() => setSourceFilter(sourceFilter === sector.key ? '' : sector.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setSourceFilter(sourceFilter === sector.key ? '' : sector.key)
                            }
                          }}
                        />
                        {sector.ratio >= 0.08 && (
                          <text className="rcw-wheel-label" x={sector.labelPos.x} y={sector.labelPos.y} textAnchor="middle" dominantBaseline="middle" style={{ pointerEvents: 'none' }}>
                            {RAG_SOURCE_TYPES[sector.key] ?? sector.key}
                          </text>
                        )}
                      </g>
                    ))}
                    <text className="rcw-wheel-hub-label" x={RING_CENTER} y={RING_CENTER - 6} textAnchor="middle">docs</text>
                    <text
                      x={RING_CENTER}
                      y={RING_CENTER + 14}
                      textAnchor="middle"
                      style={{ fontFamily: 'var(--rc-font-mono)', fontSize: 13, fontWeight: 600, fill: 'var(--rc-text)' }}
                    >
                      {docsAllQuery.data?.total ?? 0}
                    </text>
                  </svg>
                  <ul className="rcw-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0, alignSelf: 'center' }}>
                    {sourceCounts.map((item) => (
                      <li key={item.key}>
                        <button
                          type="button"
                          className="rcw-row-between w-full"
                          style={{ gap: 'var(--rc-space-2)', padding: 'var(--rc-space-1) 0', cursor: 'pointer' }}
                          aria-pressed={sourceFilter === item.key}
                          onClick={() => setSourceFilter(sourceFilter === item.key ? '' : item.key)}
                        >
                          <span className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                            <span className="rcw-dot" data-tone={sourceFilter === item.key ? 'accent' : 'muted'} aria-hidden="true" />
                            <span className="text-xs">{item.label}</span>
                          </span>
                          <span className="mono text-[11px] rcw-faint">
                            {item.count} 篇 · {docsAllQuery.data && docsAllQuery.data.total > 0
                              ? ((item.count / docsAllQuery.data.total) * 100).toFixed(1)
                              : '0.0'}%
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="mt-3 text-[11px] rcw-faint">检索范围为你可见的公共与本组织文档；命中均带来源引用（source_ref）与证据分级（provenance_class）。</p>
            </section>

            {/* ---------- 检索控制台 ---------- */}
            <section className="rcw-card rcw-card-tight">
              <label className="field-label" htmlFor="rag-query">检索问题 query *</label>
              <textarea
                id="rag-query"
                className="field-input"
                rows={3}
                placeholder="描述你想检索的复现知识，如：ResNet-50 复现 学习率 warmup"
                value={queryText}
                onChange={(e) => { setQueryText(e.target.value); setQueryError(null) }}
              />
              <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-2)' }}>
                {EXAMPLE_QUERIES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="rcw-chip rcw-chip-btn"
                    onClick={() => { setQueryText(q); setQueryError(null) }}
                  >
                    {q}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="field-label" htmlFor="rag-project">限定项目（可选）</label>
                  <select id="rag-project" className="field-input" value={projectId} onChange={(e) => setProjectId(e.target.value)}
                    disabled={projectsQuery.isPending || projectsQuery.isError}>
                    <option value="">全部项目</option>
                    {projectsQuery.isPending && <option disabled>项目加载中…</option>}
                    {projectsQuery.isError && <option disabled>项目列表不可用</option>}
                    {(projectsQuery.data?.items ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="rag-topk">返回条数 top_k（1–20）</label>
                  <input id="rag-topk" type="number" min={1} max={20} className="field-input mono" value={topK}
                    onChange={(e) => { setTopK(e.target.value); setQueryError(null) }} />
                </div>
                <div className="flex flex-col justify-end">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="h-4 w-4" style={{ accentColor: 'var(--rc-accent)' }} checked={synthesize}
                      onChange={(e) => setSynthesize(e.target.checked)} />
                    综合推断 synthesize
                  </label>
                  <p className="mt-1 text-[11px] leading-relaxed rcw-faint">综合推断需后端配置 LLM；未配置时仅返回检索结果。</p>
                </div>
              </div>
              {queryError && <p className="mt-2 text-xs" style={{ color: 'var(--rc-danger)' }}>{queryError}</p>}
              <div className="mt-3 flex justify-end">
                <button type="button" className="btn-primary" disabled={ragMut.isPending} onClick={submitQuery}>
                  <Icon name="search" size="xs" />{ragMut.isPending ? '检索中…' : '开始检索'}
                </button>
              </div>
            </section>

            {ragMut.isPending && <section className="rcw-card"><LoadingState compact message="正在执行确定性检索…" hint="POST /rag/query" /></section>}
            {ragMut.isError && (
              <section className="rcw-card">
                <ErrorState
                  compact
                  message={ragMut.error.message}
                  code={errCode(ragMut.error)}
                  onRetry={lastRun ? () => ragMut.mutate(lastRun) : undefined}
                />
              </section>
            )}

            {result && (
              <div className="rcw-stack">
                {/* 来源分级原则 */}
                <div className="rcw-note rcw-note--warn">
                  <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
                    <Icon as={ShieldAlert} size="sm" style={{ marginTop: 2 }} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold">来源分级与证据优先原则</p>
                      <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--rc-text)' }}>{result.provenance.note}</p>
                      <p className="mt-1 text-xs leading-relaxed rcw-muted">{result.provenance.current_evidence_priority}</p>
                      <div className="rcw-row pt-1" style={{ gap: 'var(--rc-space-1)' }}>
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

                <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                  <StatusBadge tone="neutral" dot={false}>候选文档 {result.total_candidates}</StatusBadge>
                  <StatusBadge tone="accent" dot={false}>命中 {hits.length}</StatusBadge>
                  <StatusBadge tone="neutral" dot={false}>top_k {result.top_k}</StatusBadge>
                  <span className="rcw-chip">query: {result.query}</span>
                  {result.project_id && <span className="rcw-chip">project: {result.project_id}</span>}
                </div>

                {result.synthesis ? (
                  <div className="rcw-note rcw-note--warn">
                    <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                      <Icon as={Sparkles} size="sm" />
                      <h4 className="text-sm font-semibold">模型推断（model_inference）· 非事实证据</h4>
                      <span className="rcw-chip">{result.synthesis.model}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed" style={{ color: 'var(--rc-text)' }}>
                      {result.synthesis.answer}
                    </p>
                    {result.synthesis.sources.length > 0 && (
                      <div className="rcw-stack-tight mt-3" style={{ paddingTop: 'var(--rc-space-2)', borderTop: 'var(--rc-stroke-hair)' }}>
                        <p className="text-[11px] font-semibold rcw-faint">引用来源</p>
                        {result.synthesis.sources.map((s) => (
                          <p key={`${s.index}-${s.document_id}`} className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                            <span className="mono text-[11px]">[{s.index}]</span>
                            <span className="mono text-[11px]">{s.source_ref || s.document_id}</span>
                            <StatusBadge tone={provMeta(s.provenance_class).tone} dot={false}>{provMeta(s.provenance_class).label}</StatusBadge>
                          </p>
                        ))}
                      </div>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed">
                      以上内容由大模型基于检索命中合成，仅供参考，不构成审计证据；结论须以当前论文原始证据为准。
                    </p>
                  </div>
                ) : lastRun?.synthesize ? (
                  <div className="rcw-note">
                    <p className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                      <Icon as={Info} size="xs" style={{ marginTop: 3 }} />
                      <span className="text-xs leading-relaxed">LLM 未配置或不可用，仅展示检索结果（确定性检索不受影响）。</span>
                    </p>
                  </div>
                ) : null}

                {hits.length === 0 ? (
                  <section className="rcw-card">
                    <EmptyState
                      compact
                      icon={Search}
                      title="未命中任何文档"
                      description="尝试更换关键词（支持中文二元组匹配），或先在文档库中入库相关知识。"
                      action={<button type="button" className="btn-ghost" onClick={() => setTab('docs')}><Icon as={Library} size="xs" />去文档库</button>}
                    />
                  </section>
                ) : (
                  <>
                    {/* 知识网络 */}
                    <section className="rcw-card rcw-card-tight">
                      <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                        <h3 className="text-sm font-semibold">知识网络</h3>
                        <span className="text-[11px] rcw-faint">点击外围节点可在下方定位对应命中</span>
                      </div>
                      <KnowledgeNetwork
                        hits={hits}
                        maxScore={maxScore}
                        selectedId={selectedDocId}
                        onSelect={(id) => setSelectedDocId((cur) => (cur === id ? null : id))}
                      />
                      {selectedHit && (
                        <div className="mt-3" style={{ paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                          <p className="rcw-overline">已选节点</p>
                          <p className="mt-1 text-sm font-semibold">{selectedHit.document.title}</p>
                          <p className="mt-0.5 mono text-[11px] rcw-faint">
                            score {selectedHit.score.toFixed(4)} · {provMeta(selectedHit.provenance_class).label} · {selectedHit.source_ref || selectedHit.document.source_ref || '无来源引用'}
                          </p>
                        </div>
                      )}
                    </section>

                    <section className="rcw-card">
                      <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                        <h3 className="text-sm font-semibold">命中明细</h3>
                        <StatusBadge tone="accent">{hits.length} 条</StatusBadge>
                      </div>
                      <div className="rcw-stack">
                        {hits.map((hit, index) => (
                          <HitCard
                            key={hit.document.id}
                            hit={hit}
                            rank={index + 1}
                            maxScore={maxScore}
                            selected={selectedDocId === hit.document.id}
                            expanded={!!hitExpanded[hit.document.id]}
                            onToggle={() => setHitExpanded((s) => ({ ...s, [hit.document.id]: !s[hit.document.id] }))}
                          />
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </div>
            )}

            {!result && !ragMut.isPending && !ragMut.isError && (
              <section className="rcw-card">
                <EmptyState
                  icon={Search}
                  title="输入问题开始受控检索"
                  description="点击上方示例问题快速填入，检索结果将附带来源分级与证据优先提示。"
                />
              </section>
            )}
          </div>
        )}

        {tab === 'docs' && (
          <section className="rcw-card">
            <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
              <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                <Icon as={Library} size="sm" tone="accent" />知识文档
                {docsQuery.data && <StatusBadge tone="neutral" dot={false}>{docsQuery.data.total} 篇</StatusBadge>}
              </h3>
              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                <select className="field-input w-auto py-1.5 text-xs" value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)} aria-label="按来源类型筛选">
                  <option value="">全部来源</option>
                  {Object.entries(RAG_SOURCE_TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={openAdd}>
                  <Icon name="plus" size="xs" />新增文档
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
                action={<button type="button" className="btn-primary" onClick={openAdd}><Icon name="plus" size="xs" />新增文档</button>}
              />
            ) : (
              <div className="rcw-grid rcw-grid-2">
                {docs.map((doc) => (
                  <DocCard
                    key={doc.id}
                    doc={doc}
                    expanded={!!docExpanded[doc.id]}
                    onToggle={() => setDocExpanded((s) => ({ ...s, [doc.id]: !s[doc.id] }))}
                  />
                ))}
              </div>
            )}
          </section>
        )}
      </div>

      {/* 新增文档 */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="新增知识文档"
        description="入库后按来源类型自动分级（provenance_class）；需要 rule.manage 或 case.manage 权限。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={addMut.isPending} onClick={submitAdd}>
              <Icon name="plus" size="xs" />{addMut.isPending ? '入库中…' : '入库文档'}
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
            <p className="rcw-row mt-1.5" style={{ gap: 'var(--rc-space-2)' }}>
              <span className="text-[11px] rcw-faint">分级预览：</span>
              <StatusBadge tone={previewProv.tone} dot={false}>{previewProv.label}</StatusBadge>
              <span className="text-[11px] rcw-faint">知识库内容永远不是当前证据（current_evidence）。</span>
            </p>
          </div>
          <div>
            <label className="field-label">标题 title *</label>
            <input className="field-input" placeholder="如：ResNet-50 复现学习率调度最佳实践" value={docForm.title}
              onChange={(e) => setDocForm({ ...docForm, title: e.target.value })} />
            {docErrors.title && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{docErrors.title}</p>}
          </div>
          <div>
            <label className="field-label">内容 content *</label>
            <textarea className="field-input" rows={6} placeholder="填写可检索的知识正文：方法步骤、环境要点、诊断结论等。" value={docForm.content}
              onChange={(e) => setDocForm({ ...docForm, content: e.target.value })} />
            {docErrors.content && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{docErrors.content}</p>}
          </div>
          <div>
            <label className="field-label">来源引用 source_ref（可选）</label>
            <input className="field-input mono" placeholder="如：doi:10.xxxx/xxxx 或内部文档编号" value={docForm.source_ref}
              onChange={(e) => setDocForm({ ...docForm, source_ref: e.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4" style={{ accentColor: 'var(--rc-accent)' }} checked={docForm.is_public}
              onChange={(e) => setDocForm({ ...docForm, is_public: e.target.checked })} />
            <span>
              公开可见
              <span className="mt-0.5 block text-[11px] font-normal rcw-faint">勾选后组织外成员也可检索；默认仅本组织可见。</span>
            </span>
          </label>
        </div>
      </Modal>
    </div>
  )
}
