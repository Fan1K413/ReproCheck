/**
 * Wave E · 报告中心（/projects/:pid/reproduction/reports）
 * --------------------------------------------------------------------------
 * 设计：图 2「浅色档案室」+ 交互规范 §2.8 章节空间导航
 *   左 2 列 章节目录树（sticky，role="tree"）
 *   中 7 列 报告正文（最大 72ch，段落无卡，靠留白 + 1px 分隔线）
 *   右 3 列 证据卡栈（sticky，mono 11 证据 ID + ScrollText 16px）
 * 三栏联动：目录点击 → 正文定位；正文证据 chip → 右栏证据卡定位 + 1px 紫环高亮 400ms；
 *          正文滚动 → 目录高亮同步（120ms）。
 * 业务不动：报告生成、列表、HTML / PDF 导出、错误码提示全部保留；
 *          章节与证据全部来自后端报告详情，不手写章节。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  FileBarChart,
  FileText,
  Quote,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import { toast } from '../../stores/toastStore'
import '../../styles/report-accordion.css'
import '../../styles/wave-e-model.css'
import type {
  ReportConclusion,
  ReportSection,
  ReportSource,
  ReportView,
} from '../../types/reproduction'

/* -------------------------------------------------------------------------- */
/* 工具                                                                        */
/* -------------------------------------------------------------------------- */

function sourceLabel(source: ReportSource | string): string {
  if (typeof source === 'string') return source
  return (
    source.label ||
    source.title ||
    source.source_name ||
    source.evidence_id ||
    source.source_id ||
    '证据引用'
  )
}

function sourceQuote(source: ReportSource | string): string {
  if (typeof source === 'string') return ''
  return source.quote ? String(source.quote) : ''
}

function sourceId(source: ReportSource | string, index: number): string {
  if (typeof source === 'string') return `SRC-${String(index + 1).padStart(2, '0')}`
  const raw = source.evidence_id ?? source.source_id ?? source.label ?? source.title
  return raw ? String(raw) : `SRC-${String(index + 1).padStart(2, '0')}`
}

function sectionConclusions(reportSection: ReportSection): ReportConclusion[] {
  const direct = reportSection.conclusions ?? reportSection.key_conclusions ?? []
  if (direct.length > 0) return direct
  // 后端报告章节以 content 作为关键结论文本，sources 为字符串形式的证据引用。
  const text = String(reportSection.summary || reportSection.content || '').trim()
  const sources = reportSection.sources ?? []
  if (!text && sources.length === 0) return []
  return [{ text, sources }]
}

function sectionKey(section: ReportSection, index: number): string {
  return section.section_id ?? section.key ?? `section-${index}`
}

function sectionTitle(section: ReportSection): string {
  return section.title || section.chapter || '未命名章节'
}

type EvidenceItem = {
  id: string
  label: string
  quote: string
  sectionKey: string
}

/** 汇总所有章节的证据引用（结论级 + 章节级），按 id 去重。 */
function collectEvidence(sections: ReportSection[]): EvidenceItem[] {
  const seen = new Set<string>()
  const items: EvidenceItem[] = []
  const push = (source: ReportSource | string, sectionId: string, index: number) => {
    const id = sourceId(source, index)
    if (seen.has(id)) return
    seen.add(id)
    items.push({ id, label: sourceLabel(source), quote: sourceQuote(source), sectionKey: sectionId })
  }
  sections.forEach((section, sectionIndex) => {
    const key = sectionKey(section, sectionIndex)
    sectionConclusions(section).forEach((conclusion) => {
      ;(conclusion.sources ?? []).forEach((source, index) => push(source, key, index))
    })
    ;(section.sources ?? []).forEach((source, index) => push(source, key, index))
  })
  return items
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/* -------------------------------------------------------------------------- */
/* 证据行内 chip                                                               */
/* -------------------------------------------------------------------------- */

function EvidenceChips({
  sources,
  onLocate,
}: {
  sources: Array<ReportSource | string>
  onLocate: (id: string, label: string, quote: string) => void
}) {
  if (sources.length === 0) return null
  return (
    <div className="rc-we-report__chips">
      {sources.map((source, index) => {
        const label = sourceLabel(source)
        const quote = sourceQuote(source)
        const id = sourceId(source, index)
        return (
          <button
            key={`${id}-${index}`}
            type="button"
            className="rc-we-report__chip"
            title={quote || label}
            aria-label={`证据 ${label}，跳到证据栏`}
            onClick={() => onLocate(id, label, quote)}
          >
            <Icon as={Quote} size="xs" />
            <span className="truncate">{label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* 页面                                                                        */
/* -------------------------------------------------------------------------- */

export default function ReproductionReportsPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)
  const queryClient = useQueryClient()

  const reportsQuery = useQuery({
    queryKey: ['repro-reports', pid],
    queryFn: () => reproductionApi.listReports(pid),
    enabled: !!pid,
  })
  const runsQuery = useQuery({
    queryKey: ['repro-runs', pid],
    queryFn: () => reproductionApi.listRuns(pid),
    enabled: !!pid,
  })
  const plansQuery = useQuery({
    queryKey: ['repro-plans', pid],
    queryFn: () => reproductionApi.listPlans(pid),
    enabled: !!pid,
  })

  const [selectedReportId, setSelectedReportId] = useState<string | null>(null)
  const [selectedPlanId, setSelectedPlanId] = useState('')
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [exportError, setExportError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [locatedEvidence, setLocatedEvidence] = useState<string | null>(null)
  const [drawerEvidence, setDrawerEvidence] = useState<{ id: string; label: string; quote: string } | null>(null)

  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const evidenceRefs = useRef<Record<string, HTMLElement | null>>({})
  const wide = useMediaQuery('(min-width: 1024px)')

  const selectReport = (reportId: string) => {
    setSelectedReportId(reportId)
    setExportError(null)
    setActiveSection(null)
    setLocatedEvidence(null)
  }

  const reportQuery = useQuery({
    queryKey: ['repro-report', selectedReportId ?? 'none'],
    queryFn: () => reproductionApi.getReport(selectedReportId!),
    enabled: !!selectedReportId,
  })

  const createReportMutation = useMutation({
    mutationFn: () =>
      reproductionApi.createReport({
        project_id: pid,
        plan_id: selectedPlanId || undefined,
        run_ids: selectedRunIds.length > 0 ? selectedRunIds : undefined,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['repro-reports'] })
      selectReport(created.report_id)
    },
  })

  const exportMutation = useMutation({
    mutationFn: ({ report, format }: { report: ReportView; format: 'HTML' | 'PDF' }) => {
      const filename = report.title || `report-${report.report_id}`
      return format === 'HTML'
        ? reproductionApi.downloadReportHtml(report.report_id, `${filename}.html`)
        : reproductionApi.downloadReportPdf(report.report_id, `${filename}.pdf`)
    },
    onMutate: () => { setExportError(null) },
    onSuccess: (_data, { format }) => toast.success(`已开始下载 ${format} 报告`),
    onError: (error, { format }) => {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
      setExportError(`${format} 下载失败（${code}）：${error.message}`)
    },
  })

  const report = reportQuery.data
  const sections = useMemo(() => report?.sections ?? [], [report])
  const evidenceList = useMemo(() => collectEvidence(sections), [sections])

  /* 目录 ↔ 正文滚动联动：窗口滚动时用 rAF 合并，选出最靠近顶部的章节 */
  useEffect(() => {
    if (sections.length === 0) return
    let frame = 0
    const compute = () => {
      frame = 0
      const anchor = 140
      let current = sectionKey(sections[0], 0)
      for (let index = 0; index < sections.length; index += 1) {
        const element = sectionRefs.current[sectionKey(sections[index], index)]
        if (!element) continue
        if (element.getBoundingClientRect().top - anchor <= 0) {
          current = sectionKey(sections[index], index)
        } else {
          break
        }
      }
      setActiveSection((prev) => (prev === current ? prev : current))
    }
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(compute)
    }
    compute()
    const scroller = document.querySelector<HTMLElement>('.rc-spa-scroll')
    const target = scroller ?? window
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [sections])

  const gotoSection = (key: string) => {
    setActiveSection(key)
    const element = sectionRefs.current[key]
    if (!element) return
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
    element.focus({ preventScroll: true })
  }

  const locateEvidence = (id: string, label: string, quote: string) => {
    setLocatedEvidence(id)
    if (!wide) {
      setDrawerEvidence({ id, label, quote })
      return
    }
    const element = evidenceRefs.current[id]
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    element.focus({ preventScroll: true })
  }

  if (reportsQuery.isPending) {
    return <LoadingState message="正在读取报告列表…" hint="正在读取后端报告列表" />
  }
  if (reportsQuery.isError) {
    return (
      <ErrorState
        message={reportsQuery.error instanceof Error ? reportsQuery.error.message : '无法获取报告列表。'}
        code={reportsQuery.error instanceof ApiError ? reportsQuery.error.code : undefined}
        onRetry={() => void reportsQuery.refetch()}
      />
    )
  }

  const reports = reportsQuery.data?.items ?? []
  const runs = runsQuery.data?.items ?? []
  const plans = plansQuery.data?.items ?? []

  const toggleRun = (runId: string) =>
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId],
    )

  return (
    <div className="rc-we-page rc-we-page--bleed">
      <header className="rc-we-head">
        <div className="rc-we-head__text">
          <p className="rc-we-eyebrow">复现报告 · 审计报告</p>
          <h1 className="rc-we-title">审计报告</h1>
          <p className="rc-we-lead">报告生成、阅读与导出</p>
        </div>
        <div className="rc-we-actions">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">
            <Icon name="arrowLeft" size="sm" />
            返回总览
          </Link>
        </div>
      </header>

      <section className="rc-we-card">
        <div className="rc-we-card__head">
          <h2 className="rc-we-card__title">
            <Icon as={FileBarChart} size="md" tone="accent" />
            生成报告
          </h2>
        </div>
        <div className="rc-we-card__body">
          <div className="rc-we-grid rc-we-grid--2">
            <div>
              <label className="field-label" htmlFor="report-plan">关联规划（可选）</label>
              <select
                id="report-plan"
                className="field-input"
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
              >
                <option value="">不指定</option>
                {plans.map((plan) => (
                  <option key={plan.plan_id} value={plan.plan_id}>{plan.title || plan.plan_id}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="field-label">关联运行（可选，多选）</p>
              <div
                className="rc-we-report__runlist"
                style={{ maxHeight: 112, overflowY: 'auto', border: 'var(--rc-stroke)', borderRadius: 'var(--rc-radius-md)', padding: 'var(--rc-space-2)' }}
              >
                {runs.length === 0 ? (
                  <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>暂无运行记录</p>
                ) : (
                  runs.map((run) => (
                    <label key={run.run_id} className="rc-we-report__runrow">
                      <input
                        type="checkbox"
                        checked={selectedRunIds.includes(run.run_id)}
                        onChange={() => toggleRun(run.run_id)}
                      />
                      <span className="rc-we-mono truncate">{run.run_id}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="rc-we-row" style={{ marginTop: 'var(--rc-space-4)' }}>
            <button
              type="button"
              className="btn-primary"
              disabled={createReportMutation.isPending}
              onClick={() => createReportMutation.mutate()}
            >
              <Icon name="rotate" size="sm" className={createReportMutation.isPending ? 'animate-spin' : ''} />
              {createReportMutation.isPending ? '生成中…' : '生成报告'}
            </button>
            {createReportMutation.isSuccess && (
              <StatusBadge tone="success">
                已生成：{createReportMutation.data.report_id} · {createReportMutation.data.section_count} 章
              </StatusBadge>
            )}
          </div>
          {createReportMutation.isError && (
            <div className="rc-we-note rc-we-note--danger" style={{ marginTop: 'var(--rc-space-4)' }}>
              <Icon name="triangleAlert" size="md" className="rc-we-note__icon" />
              <div>
                <p className="rc-we-note__title" style={{ color: 'var(--rc-danger)' }}>报告生成未成功</p>
                <p>
                  {createReportMutation.error instanceof Error ? createReportMutation.error.message : '请求失败。'}
                </p>
                <p className="rc-we-mono" style={{ marginTop: 4, color: 'var(--rc-danger)' }}>
                  错误码：{createReportMutation.error instanceof ApiError ? createReportMutation.error.code : 'UNKNOWN_ERROR'}
                </p>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="rc-we-card">
        <div className="rc-we-card__head">
          <h2 className="rc-we-card__title">
            <Icon name="file" size="md" tone="accent" />
            报告列表
          </h2>
          <StatusBadge tone="neutral" dot={false}>共 {reportsQuery.data?.total ?? 0} 份</StatusBadge>
        </div>
        <div className="rc-we-card__body rc-we-card__body--tight">
          <DataTable<ReportView>
            columns={[
              {
                key: 'title',
                header: '报告',
                render: (item) => (
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="rc-we-report__linkbtn"
                      onClick={() => selectReport(item.report_id)}
                    >
                      {item.title || '未命名报告'}
                    </button>
                    <p className="rc-we-mono" style={{ fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-subtle)' }}>
                      {item.report_id}
                    </p>
                  </div>
                ),
              },
              { key: 'status', header: '状态', render: (item) => <StatusBadge tone="neutral">{item.status}</StatusBadge> },
              { key: 'version', header: '版本', align: 'right', render: (item) => <span className="rc-we-mono">{item.version}</span> },
              {
                key: 'sections',
                header: '章节数',
                align: 'right',
                render: (item) => <span className="rc-we-mono">{item.section_count}</span>,
              },
              {
                key: 'exports',
                header: '导出',
                render: (item) => (
                  <div className="rc-we-row" style={{ gap: 'var(--rc-space-1)' }}>
                    <StatusBadge tone={item.html_available ? 'success' : 'neutral'} dot={false}>HTML</StatusBadge>
                    <StatusBadge tone={item.pdf_available ? 'success' : 'neutral'} dot={false}>PDF</StatusBadge>
                  </div>
                ),
              },
              {
                key: 'created',
                header: '创建时间',
                render: (item) => <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>{formatDateTime(item.created_at)}</span>,
              },
            ]}
            data={reports}
            rowKey={(item) => item.report_id}
            empty={<EmptyState compact icon={FileText} title="尚无报告" description="点击「生成报告」创建第一份复现报告。" />}
          />
        </div>
      </section>

      {selectedReportId && (
        <section className="rc-we-card">
          <div className="rc-we-card__head">
            <h2 className="rc-we-card__title">
              <Icon name="file" size="md" tone="accent" />
              报告详情
            </h2>
            <div className="rc-we-row" style={{ gap: 'var(--rc-space-2)' }}>
              <button
                type="button"
                className="btn-ghost"
                disabled={!report?.html_available || exportMutation.isPending}
                onClick={() => report && exportMutation.mutate({ report, format: 'HTML' })}
              >
                <Icon name="download" size="sm" />HTML 导出
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={!report?.pdf_available || exportMutation.isPending}
                onClick={() => report && exportMutation.mutate({ report, format: 'PDF' })}
              >
                <Icon name="download" size="sm" />PDF 下载
              </button>
            </div>
          </div>

          <div className="rc-we-card__body">
            {exportError && (
              <div className="rc-we-note rc-we-note--warn" role="alert" style={{ marginBottom: 'var(--rc-space-4)' }}>
                <Icon as={AlertTriangle} size="md" className="rc-we-note__icon" />
                <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{exportError}</p>
              </div>
            )}

            {reportQuery.isPending ? (
              <LoadingState compact message="正在读取报告详情…" />
            ) : reportQuery.isError ? (
              <ErrorState
                compact
                message={reportQuery.error instanceof Error ? reportQuery.error.message : '无法获取报告详情。'}
                code={reportQuery.error instanceof ApiError ? reportQuery.error.code : undefined}
                onRetry={() => void reportQuery.refetch()}
              />
            ) : !report ? (
              <EmptyState compact title="报告不存在" description="后端未返回该报告详情。" />
            ) : sections.length === 0 ? (
              <EmptyState compact icon={FileText} title="报告无章节内容" description="后端未返回报告章节。" />
            ) : (
              <>
                <div className="rc-we-report__meta">
                  <h3 className="rc-we-report__metatitle">{report.title}</h3>
                  <div className="rc-we-row" style={{ gap: 'var(--rc-space-2)' }}>
                    <StatusBadge tone="neutral">{report.status}</StatusBadge>
                    <StatusBadge tone="accent">版本 {report.version}</StatusBadge>
                    <StatusBadge tone="neutral">{sections.length} 章</StatusBadge>
                  </div>
                </div>

                {report.scope_note && (
                  <div className="rc-we-report__scope">{report.scope_note}</div>
                )}
                {report.pdf_error && (
                  <div className="rc-we-note rc-we-note--warn" style={{ marginTop: 'var(--rc-space-3)' }}>
                    <Icon name="triangleAlert" size="md" className="rc-we-note__icon" />
                    <p>PDF 后端状态：{report.pdf_error}</p>
                  </div>
                )}

                {/* ---------- 三栏：目录 ↔ 正文 ↔ 证据 ---------- */}
                <div className="rc-we-report__layout">
                  {/* 左：章节目录树 */}
                  <nav className="rc-we-report__toc" role="tree" aria-label="报告章节目录">
                    <p className="rc-we-report__tochead">
                      <Icon name="listTree" size="xs" />
                      章节
                    </p>
                    {sections.map((section, index) => {
                      const key = sectionKey(section, index)
                      const number = String(section.index ?? index + 1).padStart(2, '0')
                      const current = activeSection === key
                      return (
                        <button
                          key={key}
                          type="button"
                          role="treeitem"
                          aria-current={current ? 'location' : undefined}
                          aria-selected={current}
                          className={`rc-we-report__tocitem${current ? ' is-current' : ''}`}
                          onClick={() => gotoSection(key)}
                        >
                          <span className="rc-we-report__tocnum rc-we-mono">{number}</span>
                          <span className="rc-we-report__toctitle">{sectionTitle(section)}</span>
                        </button>
                      )
                    })}
                  </nav>

                  {/* 中：报告正文 */}
                  <article className="rc-we-report__body">
                    {sections.map((section, index) => {
                      const key = sectionKey(section, index)
                      const number = String(section.index ?? index + 1).padStart(2, '0')
                      const conclusions = sectionConclusions(section)
                      return (
                        <section
                          key={key}
                          id={`rc-report-section-${key}`}
                          tabIndex={-1}
                          ref={(element) => {
                            sectionRefs.current[key] = element
                          }}
                          className="rc-we-report__section"
                          aria-labelledby={`rc-report-section-${key}-title`}
                        >
                          <p className="rc-we-report__kicker rc-we-mono">
                            {number} / {sections.length}
                          </p>
                          <h4 id={`rc-report-section-${key}-title`} className="rc-we-report__h">
                            {sectionTitle(section)}
                          </h4>
                          {section.origin && <p className="rc-we-report__origin">{section.origin}</p>}

                          <div className="rc-we-report__content">
                            {conclusions.length === 0 ? (
                              <p style={{ color: 'var(--rc-text-subtle)', fontSize: 'var(--rc-fs-caption)' }}>
                                后端未提供该章节的关键结论。
                              </p>
                            ) : (
                              conclusions.map((conclusion, conclusionIndex) => (
                                <div key={conclusionIndex} className="rc-we-report__conclusion">
                                  {(conclusion.text || conclusion.statement) && (
                                    <p className="rc-we-report__ctext">
                                      {conclusion.text || conclusion.statement}
                                    </p>
                                  )}
                                  <EvidenceChips
                                    sources={conclusion.sources ?? []}
                                    onLocate={locateEvidence}
                                  />
                                </div>
                              ))
                            )}
                            {(section.sources ?? []).length > 0 && (
                              <EvidenceChips sources={section.sources ?? []} onLocate={locateEvidence} />
                            )}
                          </div>
                        </section>
                      )
                    })}
                  </article>

                  {/* 右：证据卡栈 */}
                  <aside className="rc-we-report__evidence" aria-label="证据链">
                    <p className="rc-we-report__evhead">
                      <Icon name="scroll" size="xs" />
                      证据链
                      <span className="rc-we-mono" style={{ marginLeft: 'auto' }}>{evidenceList.length}</span>
                    </p>
                    {evidenceList.length === 0 ? (
                      <p className="rc-we-report__evempty">后端未在该报告中提供证据引用。</p>
                    ) : (
                      evidenceList.map((item) => (
                        <div
                          key={item.id}
                          tabIndex={-1}
                          ref={(element) => {
                            evidenceRefs.current[item.id] = element
                          }}
                          className={`rc-we-report__evcard${locatedEvidence === item.id ? ' is-located' : ''}`}
                        >
                          <p className="rc-we-report__evid rc-we-mono">{item.id}</p>
                          <div className="rc-we-report__evrow">
                            <Icon name="scroll" size="sm" tone="accent" />
                            <span className="rc-we-report__evlabel">{item.label}</span>
                          </div>
                          {item.quote && <p className="rc-we-report__evquote">{item.quote}</p>}
                        </div>
                      ))
                    )}
                  </aside>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {/* 窄屏：证据原文底部抽屉（交互规范 §2.8 响应式） */}
      {drawerEvidence && (
        <div
          className="rc-we-report__drawer"
          role="dialog"
          aria-modal="true"
          aria-label="证据原文"
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDrawerEvidence(null)
          }}
        >
          <button
            type="button"
            className="rc-we-report__drawerbackdrop"
            aria-label="关闭证据原文"
            onClick={() => setDrawerEvidence(null)}
          />
          <div className="rc-we-report__drawerpanel">
            <div className="rc-we-report__drawerhead">
              <p className="rc-we-report__evid rc-we-mono">{drawerEvidence.id}</p>
              <button type="button" className="btn-ghost" onClick={() => setDrawerEvidence(null)}>
                关闭
              </button>
            </div>
            <p className="rc-we-report__evlabel">{drawerEvidence.label}</p>
            {drawerEvidence.quote ? (
              <p className="rc-we-report__evquote" style={{ marginTop: 'var(--rc-space-3)' }}>{drawerEvidence.quote}</p>
            ) : (
              <p style={{ marginTop: 'var(--rc-space-3)', color: 'var(--rc-text-subtle)' }}>
                后端未提供该证据的原文片段。
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
