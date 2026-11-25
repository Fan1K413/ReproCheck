import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Globe,
  Info,
  List,
  Lock,
  Search,
  Sparkles,
} from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { PROVENANCE_CLASSES, QUALITY_LEVELS, qualityMeta } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type { BenchmarkCase, CaseSearchHit } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

const PAGE_SIZE = 10

const SORT_OPTIONS = [
  { key: 'recent', label: '最近创建' },
  { key: 'updated', label: '最近更新' },
  { key: 'quality', label: '质量等级' },
  { key: 'title', label: '标题' },
]

const WEIGHT_LABELS: Record<string, string> = {
  text_cosine: '文本余弦',
  research_task: '研究任务',
  dataset: '数据集',
  domain: '研究领域',
  model_architecture: '模型架构',
  title_phrase: '标题短语',
}

type ListFilters = { q: string; domain: string; quality: string; sort: string; publicOnly: boolean; offset: number }
const EMPTY_FILTERS: ListFilters = { q: '', domain: '', quality: '', sort: 'recent', publicOnly: false, offset: 0 }

type CaseForm = {
  title: string; doi: string; source_url: string; domain: string; research_task: string
  model_architecture: string; dataset_name: string; code_repo_url: string; code_commit: string
  license: string; summary: string; is_public: boolean
}
type TextKey = Exclude<keyof CaseForm, 'is_public'>
const EMPTY_FORM: CaseForm = {
  title: '', doi: '', source_url: '', domain: '', research_task: '', model_architecture: '',
  dataset_name: '', code_repo_url: '', code_commit: '', license: '', summary: '', is_public: false,
}

const FORM_FIELDS: { key: TextKey; label: string; placeholder: string; maxLength?: number }[] = [
  { key: 'doi', label: 'DOI', placeholder: '10.1109/CVPR.2016.90', maxLength: 200 },
  { key: 'source_url', label: '来源链接', placeholder: 'https://arxiv.org/abs/…', maxLength: 500 },
  { key: 'domain', label: '研究领域', placeholder: 'computer_vision（自动归一为 snake_case）', maxLength: 120 },
  { key: 'research_task', label: '研究任务', placeholder: 'image_classification', maxLength: 200 },
  { key: 'model_architecture', label: '模型架构', placeholder: 'ResNet-50', maxLength: 200 },
  { key: 'dataset_name', label: '数据集名称', placeholder: 'ImageNet（自动归一到规范写法）' },
  { key: 'code_repo_url', label: '代码仓库', placeholder: 'https://github.com/…', maxLength: 500 },
  { key: 'code_commit', label: '代码提交号', placeholder: 'commit SHA / tag', maxLength: 80 },
  { key: 'license', label: '许可证', placeholder: 'Apache-2.0 / MIT …', maxLength: 120 },
]

/** 档案层叠卡：斜轴错位的案例档案，卡片自带露出的「纸边」。 */
function CaseCard({ item, index, onOpen }: { item: BenchmarkCase; index: number; onOpen: (id: string) => void }) {
  const quality = qualityMeta(item.quality_level)
  return (
    <article className="rcw-deck-card">
      <div className="rcw-row-between" style={{ alignItems: 'flex-start' }}>
        <span className="rcw-overline">{String(index + 1).padStart(2, '0')}</span>
        <StatusBadge tone={item.is_public ? 'success' : 'neutral'} dot={false}>
          {item.is_public ? <Icon as={Globe} size="xs" /> : <Icon as={Lock} size="xs" />}
          {item.is_public ? '公开' : '组织内'}
        </StatusBadge>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
        {item.domain && <StatusBadge tone="navy" dot={false}>{item.domain}</StatusBadge>}
        {item.research_task && <StatusBadge tone="accent" dot={false}>{item.research_task}</StatusBadge>}
      </div>
      <Link
        to={`/benchmark/${item.id}`}
        onClick={(event) => event.stopPropagation()}
        className="mt-3 block text-sm font-semibold leading-snug line-clamp-2 transition-colors hover:text-[var(--rcw-ink)]"
      >
        {item.title}
      </Link>
      {item.summary && <p className="mt-2 line-clamp-2 text-xs leading-relaxed rcw-muted">{item.summary}</p>}
      <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
        <span className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
          <Icon name="file" size="xs" tone="subtle" />
          <span className="mono text-[11px] rcw-faint">{item.fact_count ?? 0} 条事实</span>
        </span>
        <span className="mono max-w-[42%] truncate text-[11px] rcw-faint">
          {item.created_by_name ?? item.created_by}
        </span>
        <span className="mono text-[11px] rcw-faint">{formatDateTime(item.updated_at)}</span>
        <button
          type="button"
          className="text-[11px] font-medium rcw-ink"
          onClick={() => onOpen(item.id)}
          aria-label={`打开案例 ${item.title}`}
        >
          查看 →
        </button>
      </div>
    </article>
  )
}

function SearchHitCard({ hit, rank, maxScore }: { hit: CaseSearchHit; rank: number; maxScore: number }) {
  const item = hit.case
  const quality = qualityMeta(item.quality_level)
  const provenance = PROVENANCE_CLASSES[hit.provenance_class] ?? { label: hit.provenance_class, tone: 'neutral' as const }
  const sourceRef = item.doi || item.source_url
  const ratio = maxScore > 0 ? Math.max(0.02, Math.min(1, hit.score / maxScore)) : 0
  return (
    <article className="rcw-card rcw-card-tight">
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
        <span className="mono grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold rcw-ink"
          style={{ backgroundColor: 'var(--rcw-tint)' }}>
          {rank}
        </span>
        <Link to={`/benchmark/${item.id}`} className="min-w-0 flex-1 text-sm font-semibold leading-snug hover:underline">
          {item.title}
        </Link>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone={provenance.tone}>{provenance.label}</StatusBadge>
          <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
        </div>
      </div>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', marginTop: 'var(--rc-space-3)' }}>
        <div className="rcw-bar flex-1" role="img" aria-label={`相似度 ${(ratio * 100).toFixed(0)}%`}>
          <span style={{ '--rcw-bar': ratio } as CSSProperties} />
        </div>
        <span className="mono text-xs font-semibold rcw-ink">{hit.score.toFixed(3)}</span>
        <span className="mono hidden text-[10px] rcw-faint sm:inline">文本相似度 {hit.text_similarity.toFixed(3)}</span>
      </div>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-2)' }}>
        {hit.match_basis.map((basis, index) => (
          <span key={`${basis}-${index}`} className="rcw-chip rcw-chip-accent">{basis}</span>
        ))}
      </div>
      {item.summary && <p className="mt-2 line-clamp-2 text-xs leading-relaxed rcw-muted">{item.summary}</p>}
      <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
        <span className="mono max-w-[58%] truncate text-[10px] rcw-faint" title={sourceRef}>{sourceRef || '无来源指针'}</span>
        <span className="text-[10px]" style={{ color: 'var(--rc-warning)' }}>{hit.usage_note}</span>
      </div>
    </article>
  )
}

export default function BenchmarkPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mode, setMode] = useState<'list' | 'search'>('list')
  const [qInput, setQInput] = useState('')
  const [domainInput, setDomainInput] = useState('')
  const [filters, setFilters] = useState<ListFilters>(EMPTY_FILTERS)
  const [createOpen, setCreateOpen] = useState(false)
  const [form, setForm] = useState<CaseForm>(EMPTY_FORM)
  const [formError, setFormError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [topK, setTopK] = useState(5)
  const [searchError, setSearchError] = useState('')
  const [appliedSearch, setAppliedSearch] = useState<{ query: string; topK: number } | null>(null)

  const listQuery = useQuery({
    queryKey: ['stage6', 'cases', filters],
    queryFn: () =>
      stage6Api.listCases({
        q: filters.q || undefined,
        domain: filters.domain || undefined,
        quality_level: filters.quality || undefined,
        sort: filters.sort,
        is_public: filters.publicOnly ? true : undefined,
        limit: PAGE_SIZE,
        offset: filters.offset,
      }),
    enabled: mode === 'list',
  })

  const searchQuery = useQuery({
    queryKey: ['stage6', 'case-search', appliedSearch],
    queryFn: () => stage6Api.searchCases({ query: appliedSearch?.query ?? '', top_k: appliedSearch?.topK ?? 5 }),
    enabled: appliedSearch !== null,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      stage6Api.createCase({
        title: form.title.trim(),
        doi: form.doi.trim(),
        source_url: form.source_url.trim(),
        domain: form.domain.trim(),
        research_task: form.research_task.trim(),
        model_architecture: form.model_architecture.trim(),
        dataset_name: form.dataset_name.trim(),
        code_repo_url: form.code_repo_url.trim(),
        code_commit: form.code_commit.trim(),
        license: form.license.trim(),
        summary: form.summary.trim(),
        is_public: form.is_public,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'cases'] })
      toast.success('案例已创建，初始质量等级为「未验证」')
      setCreateOpen(false)
      setForm(EMPTY_FORM)
      setFormError('')
      navigate(`/benchmark/${created.id}`)
    },
    onError: (error) => toast.error(error.message),
  })

  const updateForm = (key: TextKey, value: string) => setForm((prev) => ({ ...prev, [key]: value }))
  const applyList = () => setFilters((prev) => ({ ...prev, q: qInput.trim(), domain: domainInput.trim(), offset: 0 }))
  const resetList = () => {
    setQInput('')
    setDomainInput('')
    setFilters(EMPTY_FILTERS)
  }
  const submitCreate = () => {
    if (!form.title.trim()) {
      setFormError('案例标题不能为空')
      return
    }
    setFormError('')
    createMutation.mutate()
  }
  const runSearch = () => {
    const query = searchText.trim()
    if (!query) {
      setSearchError('请输入检索问题，例如「ImageNet 上 ResNet-50 的训练环境与 top-1 准确率」')
      return
    }
    setSearchError('')
    const k = Math.min(20, Math.max(1, Math.round(topK) || 5))
    setTopK(k)
    setAppliedSearch({ query, topK: k })
  }

  const total = listQuery.data?.total ?? 0
  const rangeStart = total === 0 ? 0 : filters.offset + 1
  const rangeEnd = Math.min(filters.offset + PAGE_SIZE, total)
  const hits = searchQuery.data?.items ?? []
  const maxScore = hits.reduce((max, hit) => Math.max(max, hit.score), 0) || 1

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="基准案例库"
          description="历史复现案例与质量分级；案例证据仅供方法参考，不替代当前论文事实。"
          actions={
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size="xs" />新建案例
            </button>
          }
        />

        {/* ---------- 模式切换 ---------- */}
        <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
          <button type="button" className="rcw-chip rcw-chip-btn" aria-pressed={mode === 'list'} onClick={() => setMode('list')}>
            <Icon as={List} size="xs" />列表浏览
          </button>
          <button type="button" className="rcw-chip rcw-chip-btn" aria-pressed={mode === 'search'} onClick={() => setMode('search')}>
            <Icon as={Sparkles} size="xs" />语义检索
          </button>
        </div>

        {mode === 'list' && (
          <>
            {/* ---------- 检索条件 ---------- */}
            <section className="rcw-card rcw-card-tight">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label className="field-label" htmlFor="case-q">关键词</label>
                  <input
                    id="case-q"
                    className="field-input"
                    placeholder="标题 / 摘要 / 任务 / 数据集…"
                    value={qInput}
                    onChange={(event) => setQInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') applyList() }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="case-domain">研究领域</label>
                  <input
                    id="case-domain"
                    className="field-input"
                    placeholder="如 computer_vision"
                    value={domainInput}
                    onChange={(event) => setDomainInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') applyList() }}
                  />
                </div>
                <div>
                  <label className="field-label" htmlFor="case-quality">质量等级</label>
                  <select
                    id="case-quality"
                    className="field-input"
                    value={filters.quality}
                    onChange={(event) => setFilters((prev) => ({ ...prev, quality: event.target.value, offset: 0 }))}
                  >
                    <option value="">全部等级</option>
                    {QUALITY_LEVELS.map((level) => <option key={level.key} value={level.key}>{level.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label" htmlFor="case-sort">排序</label>
                  <select
                    id="case-sort"
                    className="field-input"
                    value={filters.sort}
                    onChange={(event) => setFilters((prev) => ({ ...prev, sort: event.target.value, offset: 0 }))}
                  >
                    {SORT_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)' }}>
                <label className="inline-flex cursor-pointer items-center gap-2 text-xs rcw-muted">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    style={{ accentColor: 'var(--rc-accent)' }}
                    checked={filters.publicOnly}
                    onChange={(event) => setFilters((prev) => ({ ...prev, publicOnly: event.target.checked, offset: 0 }))}
                  />
                  仅显示公开案例
                </label>
                <div className="rcw-row-end">
                  <button type="button" className="btn-ghost" onClick={resetList}>
                    <Icon name="rotate" size="xs" />重置
                  </button>
                  <button type="button" className="btn-primary" onClick={applyList}>
                    <Icon name="search" size="xs" />查询
                  </button>
                </div>
              </div>
            </section>

            {/* ---------- 层叠案例档案 ---------- */}
            <section className="rcw-card">
              <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-4)' }}>
                <h3 className="text-sm font-semibold">案例档案</h3>
                <StatusBadge tone="neutral">{total} 个案例</StatusBadge>
              </div>
              {listQuery.isPending ? (
                <LoadingState compact message="正在读取基准案例…" />
              ) : listQuery.isError ? (
                <ErrorState
                  compact
                  message={listQuery.error.message}
                  code={listQuery.error instanceof ApiError ? listQuery.error.code : undefined}
                  onRetry={() => void listQuery.refetch()}
                />
              ) : listQuery.data.items.length === 0 ? (
                <EmptyState
                  icon={BookOpen}
                  title="没有匹配的案例"
                  description="调整筛选条件，或新建一个基准案例沉淀复现经验。"
                  action={
                    <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
                      <Icon name="plus" size="xs" />新建案例
                    </button>
                  }
                />
              ) : (
                <>
                  <div className="rcw-deck" style={{ opacity: listQuery.isFetching ? 0.6 : 1, transition: 'opacity var(--rc-dur-base) var(--rc-ease-hover)' }}>
                    {listQuery.data.items.map((item, index) => (
                      <CaseCard key={item.id} item={item} index={filters.offset + index} onOpen={(id) => navigate(`/benchmark/${id}`)} />
                    ))}
                  </div>
                  <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-4)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                    <span className="text-xs rcw-muted">第 {rangeStart}–{rangeEnd} 条 · 共 {total} 条</span>
                    <div className="rcw-row-end">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={filters.offset === 0}
                        onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, prev.offset - PAGE_SIZE) }))}
                      >
                        <Icon as={ArrowLeft} size="xs" />上一页
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={filters.offset + PAGE_SIZE >= total}
                        onClick={() => setFilters((prev) => ({ ...prev, offset: prev.offset + PAGE_SIZE }))}
                      >
                        下一页<Icon as={ArrowRight} size="xs" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </section>
          </>
        )}

        {mode === 'search' && (
          <>
            <div className="rcw-note rcw-note--warn">
              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                <Icon as={AlertTriangle} size="sm" style={{ marginTop: 2 }} />
                <div>
                  <p className="text-sm font-semibold">历史案例参考 · 非当前论文证据</p>
                  <p className="mt-1">检索结果均为历史案例（historical_case），仅供方法参考，绝不构成当前论文的证据；当前论文事实优先。</p>
                  {searchQuery.data?.disclaimer && <p className="mt-1 opacity-80">{searchQuery.data.disclaimer}</p>}
                </div>
              </div>
            </div>

            <section className="rcw-card rcw-card-tight">
              <label className="field-label" htmlFor="case-search-query">检索问题</label>
              <textarea
                id="case-search-query"
                className="field-input resize-y"
                rows={3}
                placeholder="例如：ViT 在 ImageNet 上的训练轮数、学习率与运行环境；支持中英文混合查询"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runSearch() }}
              />
              {searchError && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{searchError}</p>}
              <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', alignItems: 'flex-end' }}>
                <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-end' }}>
                  <div className="w-28">
                    <label className="field-label" htmlFor="case-topk">返回条数 top_k</label>
                    <input
                      id="case-topk"
                      type="number"
                      min={1}
                      max={20}
                      className="field-input mono"
                      value={topK}
                      onChange={(event) => setTopK(Number(event.target.value))}
                    />
                  </div>
                  <p className="pb-2 text-[11px] rcw-faint">范围 1–20 · Ctrl+Enter 快捷检索 · 加权 TF-IDF 余弦 + 结构化命中</p>
                </div>
                <button type="button" className="btn-primary" disabled={searchQuery.isFetching} onClick={runSearch}>
                  <Icon name="search" size="xs" />检索
                </button>
              </div>
            </section>

            {appliedSearch === null ? (
              <section className="rcw-card">
                <EmptyState
                  compact
                  icon={Search}
                  title="输入问题开始语义检索"
                  description="检索仅覆盖可见的历史基准案例，结果附带命中依据与相似度分数。"
                />
              </section>
            ) : searchQuery.isPending ? (
              <section className="rcw-card"><LoadingState compact message="正在检索历史案例…" /></section>
            ) : searchQuery.isError ? (
              <section className="rcw-card">
                <ErrorState
                  compact
                  message={searchQuery.error.message}
                  code={searchQuery.error instanceof ApiError ? searchQuery.error.code : undefined}
                  onRetry={() => void searchQuery.refetch()}
                />
              </section>
            ) : hits.length === 0 ? (
              <section className="rcw-card">
                <EmptyState
                  compact
                  icon={BookOpen}
                  title="未命中历史案例"
                  description="尝试更换关键词、放宽结构化条件，或减少停用词后重新检索。"
                />
              </section>
            ) : (
              <>
                <div className="rcw-stack">
                  {hits.map((hit, index) => <SearchHitCard key={hit.case.id} hit={hit} rank={index + 1} maxScore={maxScore} />)}
                </div>
                <section className="rcw-card rcw-card-tight">
                  <div className="rcw-row" style={{ gap: 'var(--rc-space-4)' }}>
                    <span>命中 <b className="mono">{searchQuery.data.total}</b> 条 · top_k={searchQuery.data.top_k}</span>
                    <span className="mono rcw-faint">{searchQuery.data.algorithm}</span>
                  </div>
                  <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-2)' }}>
                    {Object.entries(searchQuery.data.score_weights).map(([key, weight]) => (
                      <span key={key} className="rcw-chip">
                        {WEIGHT_LABELS[key] ?? key} <span className="mono">{weight}</span>
                      </span>
                    ))}
                  </div>
                </section>
              </>
            )}
          </>
        )}
      </div>

      <Modal
        open={createOpen}
        wide
        title="新建基准案例"
        description="沉淀历史复现经验：元数据 + 事实 + 指针，不存论文/代码/数据集本体。"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={createMutation.isPending} onClick={submitCreate}>
              <Icon name="plus" size="xs" />创建案例
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
            <Icon as={Info} size="sm" style={{ marginTop: 2 }} />
            <span className="text-xs leading-relaxed">
              质量等级由验证记录自动计算，不可手工指定；新案例初始为「未验证」，提交执行/复核验证后按阶梯升级。
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="new-case-title">案例标题 *</label>
              <input
                id="new-case-title"
                className="field-input"
                maxLength={300}
                placeholder="如：ResNet-50 在 ImageNet 上的复现（top-1 76.1%）"
                value={form.title}
                onChange={(event) => updateForm('title', event.target.value)}
              />
              {formError && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{formError}</p>}
            </div>
            {FORM_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="field-label">{field.label}</label>
                <input
                  className="field-input"
                  maxLength={field.maxLength}
                  placeholder={field.placeholder}
                  value={form[field.key]}
                  onChange={(event) => updateForm(field.key, event.target.value)}
                />
              </div>
            ))}
            <div className="sm:col-span-2">
              <label className="field-label">摘要</label>
              <textarea
                className="field-input resize-y"
                rows={3}
                placeholder="复现结论、关键指标、与原文差异、失败原因等"
                value={form.summary}
                onChange={(event) => updateForm('summary', event.target.value)}
              />
            </div>
            <label className="flex cursor-pointer items-start gap-2 text-xs rcw-muted sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                style={{ accentColor: 'var(--rc-accent)' }}
                checked={form.is_public}
                onChange={(event) => setForm((prev) => ({ ...prev, is_public: event.target.checked }))}
              />
              <span>公开案例（全平台可见）。发布公共案例需要组织管理员权限；默认仅组织内可见。</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  )
}
