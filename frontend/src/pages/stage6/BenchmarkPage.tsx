import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FileText,
  Globe,
  Info,
  List,
  Lock,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
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

function CaseCard({ item, onOpen }: { item: BenchmarkCase; onOpen: (id: string) => void }) {
  const quality = qualityMeta(item.quality_level)
  return (
    <article
      className="panel group cursor-pointer p-4 transition hover:border-accent/50 hover:shadow-pop"
      onClick={() => onOpen(item.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
        <StatusBadge tone={item.is_public ? 'success' : 'neutral'} dot={false}>
          {item.is_public ? <Globe size={12} /> : <Lock size={12} />}
          {item.is_public ? '公开' : '组织内'}
        </StatusBadge>
      </div>
      <Link
        to={`/benchmark/${item.id}`}
        onClick={(event) => event.stopPropagation()}
        className="mt-2 block text-sm font-semibold leading-snug text-ink group-hover:text-accent-dark line-clamp-2"
      >
        {item.title}
      </Link>
      <div className="mt-2 flex flex-wrap gap-1">
        {item.domain && <StatusBadge tone="navy" dot={false}>{item.domain}</StatusBadge>}
        {item.research_task && <StatusBadge tone="accent" dot={false}>{item.research_task}</StatusBadge>}
        {item.dataset_name && <StatusBadge tone="neutral" dot={false}>{item.dataset_name}</StatusBadge>}
      </div>
      {item.summary && <p className="mt-2 text-xs leading-relaxed text-ink-muted line-clamp-2">{item.summary}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line-soft pt-2.5 text-[11px] text-ink-subtle">
        <span className="inline-flex items-center gap-1">
          <FileText size={13} /> {item.fact_count ?? 0} 条事实
        </span>
        <span className="max-w-[40%] truncate">{item.created_by_name ?? <span className="mono">{item.created_by}</span>}</span>
        <span className="mono">{formatDateTime(item.updated_at)}</span>
      </div>
    </article>
  )
}

function SearchHitCard({ hit, rank, maxScore }: { hit: CaseSearchHit; rank: number; maxScore: number }) {
  const item = hit.case
  const quality = qualityMeta(item.quality_level)
  const provenance = PROVENANCE_CLASSES[hit.provenance_class] ?? { label: hit.provenance_class, tone: 'neutral' as const }
  const sourceRef = item.doi || item.source_url
  const width = Math.max(4, Math.round((hit.score / maxScore) * 100))
  return (
    <article className="panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span className="mono mt-0.5 shrink-0 rounded bg-navy-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">#{rank}</span>
          <Link to={`/benchmark/${item.id}`} className="text-sm font-semibold leading-snug text-ink hover:text-accent-dark hover:underline">
            {item.title}
          </Link>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusBadge tone={provenance.tone}>{provenance.label}</StatusBadge>
          <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-canvas">
          <div className="h-full rounded-full bg-gradient-to-r from-accent-dark via-accent to-accent-soft" style={{ width: `${width}%` }} />
        </div>
        <span className="mono text-xs font-semibold text-accent-dark">{hit.score.toFixed(3)}</span>
        <span className="mono hidden text-[10px] text-ink-subtle sm:inline">文本相似度 {hit.text_similarity.toFixed(3)}</span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1">
        {hit.match_basis.map((basis, index) => (
          <span key={`${basis}-${index}`} className="rounded bg-accent-wash px-1.5 py-0.5 text-[10px] leading-4 text-accent-dark">
            {basis}
          </span>
        ))}
      </div>
      {item.summary && <p className="mt-2 text-xs leading-relaxed text-ink-muted line-clamp-2">{item.summary}</p>}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-2.5">
        <span className="mono max-w-[55%] truncate text-[10px] text-ink-subtle" title={sourceRef}>
          {sourceRef || '无来源指针'}
        </span>
        <span className="text-[10px] text-warning">{hit.usage_note}</span>
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
    <div className="space-y-5">
      <PageHeader
        title="基准案例库"
        description="历史复现案例与质量分级；案例证据仅供方法参考，不替代当前论文事实。"
        actions={
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={1.8} /> 新建案例
          </button>
        }
      />

      <div className="flex flex-wrap gap-2">
        <button type="button" className={mode === 'list' ? 'btn-primary' : 'btn-ghost'} onClick={() => setMode('list')}>
          <List size={16} strokeWidth={1.8} /> 列表浏览
        </button>
        <button type="button" className={mode === 'search' ? 'btn-primary' : 'btn-ghost'} onClick={() => setMode('search')}>
          <Sparkles size={16} strokeWidth={1.8} /> 语义检索
        </button>
      </div>

      {mode === 'list' && (
        <>
          <section className="panel p-4">
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
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={filters.publicOnly}
                  onChange={(event) => setFilters((prev) => ({ ...prev, publicOnly: event.target.checked, offset: 0 }))}
                />
                仅显示公开案例
              </label>
              <div className="flex gap-2">
                <button type="button" className="btn-ghost" onClick={resetList}><RotateCcw size={15} strokeWidth={1.8} /> 重置</button>
                <button type="button" className="btn-primary" onClick={applyList}><Search size={15} strokeWidth={1.8} /> 查询</button>
              </div>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <h3 className="text-sm font-semibold">案例列表</h3>
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
                    <Plus size={15} strokeWidth={1.8} /> 新建案例
                  </button>
                }
              />
            ) : (
              <>
                <div className={`grid gap-4 p-4 transition-opacity sm:grid-cols-2 xl:grid-cols-3 ${listQuery.isFetching ? 'opacity-60' : ''}`}>
                  {listQuery.data.items.map((item) => (
                    <CaseCard key={item.id} item={item} onOpen={(id) => navigate(`/benchmark/${id}`)} />
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line-soft px-4 py-3">
                  <span className="text-xs text-ink-muted">第 {rangeStart}–{rangeEnd} 条 · 共 {total} 条</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={filters.offset === 0}
                      onClick={() => setFilters((prev) => ({ ...prev, offset: Math.max(0, prev.offset - PAGE_SIZE) }))}
                    >
                      <ArrowLeft size={15} strokeWidth={1.8} /> 上一页
                    </button>
                    <button
                      type="button"
                      className="btn-ghost"
                      disabled={filters.offset + PAGE_SIZE >= total}
                      onClick={() => setFilters((prev) => ({ ...prev, offset: prev.offset + PAGE_SIZE }))}
                    >
                      下一页 <ArrowRight size={15} strokeWidth={1.8} />
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
          <div className="rounded-panel border border-warning/40 bg-warning-wash p-4 text-warning">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={17} strokeWidth={1.8} className="mt-0.5 shrink-0" />
              <div className="text-xs leading-relaxed">
                <p className="text-sm font-semibold">历史案例参考 · 非当前论文证据</p>
                <p className="mt-1">检索结果均为历史案例（historical_case），仅供方法参考，绝不构成当前论文的证据；当前论文事实优先。</p>
                {searchQuery.data?.disclaimer && <p className="mt-1 opacity-80">{searchQuery.data.disclaimer}</p>}
              </div>
            </div>
          </div>

          <section className="panel p-4">
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
            {searchError && <p className="mt-1 text-xs text-danger">{searchError}</p>}
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex items-end gap-3">
                <div className="w-28">
                  <label className="field-label" htmlFor="case-topk">返回条数 top_k</label>
                  <input
                    id="case-topk"
                    type="number"
                    min={1}
                    max={20}
                    className="field-input"
                    value={topK}
                    onChange={(event) => setTopK(Number(event.target.value))}
                  />
                </div>
                <p className="pb-2 text-[11px] text-ink-subtle">范围 1–20 · Ctrl+Enter 快捷检索 · 加权 TF-IDF 余弦 + 结构化命中</p>
              </div>
              <button type="button" className="btn-primary" disabled={searchQuery.isFetching} onClick={runSearch}>
                <Search size={16} strokeWidth={1.8} /> 检索
              </button>
            </div>
          </section>

          {appliedSearch === null ? (
            <section className="panel">
              <EmptyState
                compact
                icon={Search}
                title="输入问题开始语义检索"
                description="检索仅覆盖可见的历史基准案例，结果附带命中依据与相似度分数。"
              />
            </section>
          ) : searchQuery.isPending ? (
            <section className="panel"><LoadingState compact message="正在检索历史案例…" /></section>
          ) : searchQuery.isError ? (
            <section className="panel">
              <ErrorState
                compact
                message={searchQuery.error.message}
                code={searchQuery.error instanceof ApiError ? searchQuery.error.code : undefined}
                onRetry={() => void searchQuery.refetch()}
              />
            </section>
          ) : hits.length === 0 ? (
            <section className="panel">
              <EmptyState
                compact
                icon={BookOpen}
                title="未命中历史案例"
                description="尝试更换关键词、放宽结构化条件，或减少停用词后重新检索。"
              />
            </section>
          ) : (
            <>
              <div className="space-y-3">
                {hits.map((hit, index) => <SearchHitCard key={hit.case.id} hit={hit} rank={index + 1} maxScore={maxScore} />)}
              </div>
              <div className="panel p-4 text-[11px] text-ink-muted">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span>命中 <b className="mono text-ink">{searchQuery.data.total}</b> 条 · top_k={searchQuery.data.top_k}</span>
                  <span className="mono">{searchQuery.data.algorithm}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {Object.entries(searchQuery.data.score_weights).map(([key, weight]) => (
                    <span key={key} className="rounded bg-canvas px-1.5 py-0.5 ring-1 ring-line">
                      {WEIGHT_LABELS[key] ?? key} <span className="mono">{weight}</span>
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

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
              <Plus size={15} strokeWidth={1.8} /> 创建案例
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-wash p-3 text-xs leading-relaxed text-accent-dark">
            <Info size={15} strokeWidth={1.8} className="mt-0.5 shrink-0" />
            <span>质量等级由验证记录自动计算，不可手工指定；新案例初始为「未验证」，提交执行/复核验证后按阶梯升级。</span>
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
              {formError && <p className="mt-1 text-xs text-danger">{formError}</p>}
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
            <label className="flex cursor-pointer items-start gap-2 text-xs text-ink-muted sm:col-span-2">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-accent"
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