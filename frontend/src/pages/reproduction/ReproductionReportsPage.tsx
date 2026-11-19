import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Download,
  ExternalLink,
  FileBarChart,
  FileText,
  Quote,
  RefreshCw,
} from 'lucide-react'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type {
  ReportConclusion,
  ReportSource,
  ReportView,
} from '../../types/reproduction'

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

function SourceList({ sources }: { sources: Array<ReportSource | string> }) {
  if (sources.length === 0) return null
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {sources.map((source, index) => {
        const label = sourceLabel(source)
        const quote = typeof source === 'string' ? '' : source.quote ? String(source.quote) : ''
        return (
          <span
            key={`${label}-${index}`}
            title={quote || label}
            className="inline-flex max-w-full items-center gap-1 rounded bg-accent-wash px-2 py-0.5 text-[11px] text-accent-dark"
          >
            <Quote size={11} className="shrink-0" />
            <span className="truncate">{label}</span>
          </span>
        )
      })}
    </div>
  )
}

function sectionConclusions(reportSection: ReportView['sections'][number]): ReportConclusion[] {
  const direct = reportSection.conclusions ?? reportSection.key_conclusions ?? []
  if (direct.length > 0) return direct
  // 后端报告章节以 content 作为关键结论文本，sources 为字符串形式的证据引用。
  const text = String(reportSection.summary || reportSection.content || '').trim()
  const sources = reportSection.sources ?? []
  if (!text && sources.length === 0) return []
  return [{ text, sources }]
}

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
      setSelectedReportId(created.report_id)
    },
  })

  const openHtml = async (reportId: string) => {
    setExportError(null)
    try {
      const html = await reproductionApi.getReportHtmlText(reportId)
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const opened = window.open(url, '_blank', 'noopener,noreferrer')
      if (!opened) setExportError('浏览器拦截了新窗口，请允许弹出窗口后重试。')
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
      setExportError(`HTML 导出失败（${code}）：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  const downloadPdf = async (report: ReportView) => {
    setExportError(null)
    try {
      await reproductionApi.downloadReportPdf(report.report_id, `${report.title || 'report'}.pdf`)
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
      if (code === 'PDF_UNAVAILABLE') {
        setExportError(`PDF 不可用（后端 ${code}）：当前环境未提供 PDF 生成能力。`)
      } else {
        setExportError(`PDF 下载失败（${code}）：${error instanceof Error ? error.message : '未知错误'}`)
      }
    }
  }

  if (reportsQuery.isPending) {
    return <LoadingState message="正在读取报告列表…" hint="GET /reproductions/reports" />
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
  const report = reportQuery.data
  const runs = runsQuery.data?.items ?? []
  const plans = plansQuery.data?.items ?? []

  const toggleRun = (runId: string) =>
    setSelectedRunIds((prev) =>
      prev.includes(runId) ? prev.filter((id) => id !== runId) : [...prev, runId],
    )

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Reproduction Reports</p>
          <h2 className="mt-1 text-lg font-semibold">报告中心</h2>
          <p className="mt-1 text-sm text-ink-muted">
            章节与证据引用均来自后端报告详情；HTML 用新窗口打开，PDF 不可用时明确提示后端错误码。
          </p>
        </div>
        <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">返回总览</Link>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <FileBarChart size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">生成报告</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}>POST /reproductions/reports</StatusBadge>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="max-h-28 space-y-1 overflow-auto rounded-md border border-line-soft p-2">
                {runs.length === 0 ? (
                  <p className="text-xs text-ink-subtle">暂无运行记录</p>
                ) : (
                  runs.map((run) => (
                    <label key={run.run_id} className="flex items-center gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={selectedRunIds.includes(run.run_id)}
                        onChange={() => toggleRun(run.run_id)}
                      />
                      <span className="mono truncate">{run.run_id}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="btn-primary"
              disabled={createReportMutation.isPending}
              onClick={() => createReportMutation.mutate()}
            >
              <RefreshCw size={15} className={createReportMutation.isPending ? 'animate-spin' : ''} />
              {createReportMutation.isPending ? '生成中…' : '生成报告'}
            </button>
            {createReportMutation.isSuccess && (
              <StatusBadge tone="success">
                已生成：{createReportMutation.data.report_id} · {createReportMutation.data.section_count} 章
              </StatusBadge>
            )}
          </div>
          {createReportMutation.isError && (
            <div className="rounded-md border border-danger/30 bg-danger-wash p-3 text-xs">
              <p className="font-semibold text-danger">报告生成未成功</p>
              <p className="mt-1 text-ink-muted">
                {createReportMutation.error instanceof Error ? createReportMutation.error.message : '请求失败。'}
              </p>
              <p className="mono mt-1 text-danger">
                错误码：{createReportMutation.error instanceof ApiError ? createReportMutation.error.code : 'UNKNOWN_ERROR'}
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <FileText size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">报告列表</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}>共 {reportsQuery.data?.total ?? 0} 份</StatusBadge>
        </div>
        <div className="p-4">
          <DataTable<ReportView>
            columns={[
              {
                key: 'title',
                header: '报告',
                render: (item) => (
                  <div className="min-w-0">
                    <button
                      type="button"
                      className="text-left font-medium text-accent-dark hover:underline"
                      onClick={() => setSelectedReportId(item.report_id)}
                    >
                      {item.title || '未命名报告'}
                    </button>
                    <p className="mono text-[11px] text-ink-subtle">{item.report_id}</p>
                  </div>
                ),
              },
              { key: 'status', header: '状态', render: (item) => <StatusBadge tone="neutral">{item.status}</StatusBadge> },
              { key: 'version', header: '版本', align: 'right', render: (item) => <span className="mono">{item.version}</span> },
              {
                key: 'sections',
                header: '章节数',
                align: 'right',
                render: (item) => <span className="mono">{item.section_count}</span>,
              },
              {
                key: 'exports',
                header: '导出',
                render: (item) => (
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge tone={item.html_available ? 'success' : 'neutral'} dot={false}>HTML</StatusBadge>
                    <StatusBadge tone={item.pdf_available ? 'success' : 'neutral'} dot={false}>PDF</StatusBadge>
                  </div>
                ),
              },
              {
                key: 'created',
                header: '创建时间',
                render: (item) => <span className="text-xs text-ink-muted">{formatDateTime(item.created_at)}</span>,
              },
            ]}
            data={reports}
            rowKey={(item) => item.report_id}
            empty={<EmptyState compact icon={FileText} title="尚无报告" description="点击「生成报告」创建第一份复现报告。" />}
          />
        </div>
      </section>

      {selectedReportId && (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <FileText size={17} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">报告详情</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost"
                onClick={() => void openHtml(selectedReportId)}
              >
                <ExternalLink size={15} />HTML 导出
              </button>
              <button
                type="button"
                className="btn-ghost"
                disabled={report?.pdf_available === false}
                onClick={() => report && void downloadPdf(report)}
              >
                <Download size={15} />PDF 下载
              </button>
            </div>
          </div>
          <div className="p-5">
            {exportError && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning-wash p-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
                <p className="whitespace-pre-wrap break-words text-xs text-ink-muted">{exportError}</p>
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
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="text-base font-semibold">{report.title}</h4>
                  <StatusBadge tone="neutral">{report.status}</StatusBadge>
                  <StatusBadge tone="accent">版本 {report.version}</StatusBadge>
                  <StatusBadge tone="neutral">按后端返回 {report.sections?.length ?? 0} 章渲染</StatusBadge>
                </div>

                <div className="rounded-md border border-accent/30 bg-accent-wash p-3 text-xs leading-relaxed text-ink-muted">
                  {report.scope_note || '后端未提供报告范围说明。'}
                </div>
                {report.pdf_error && (
                  <div className="rounded-md border border-warning/30 bg-warning-wash p-3 text-xs text-warning">
                    PDF 后端状态：{report.pdf_error}
                  </div>
                )}

                {(report.sections ?? []).length === 0 ? (
                  <EmptyState compact icon={FileText} title="报告无章节内容" description="后端未返回报告章节。" />
                ) : (
                  <ol className="space-y-3">
                    {report.sections.map((section, index) => {
                      const conclusions = sectionConclusions(section)
                      return (
                        <li key={section.section_id ?? section.key ?? index} className="rounded-lg border border-line-soft">
                          <div className="flex items-center gap-2 border-b border-line-soft bg-canvas/60 px-4 py-2.5">
                            <span className="mono text-[11px] text-ink-subtle">
                              {String(section.index ?? index + 1).padStart(2, '0')}
                            </span>
                            <h5 className="text-sm font-semibold">
                              {section.title || section.chapter || '未命名章节'}
                            </h5>
                            {section.origin && (
                              <StatusBadge tone="neutral" dot={false}>{section.origin}</StatusBadge>
                            )}
                          </div>
                          <div className="space-y-3 px-4 py-3">
                            {conclusions.length === 0 ? (
                              <p className="text-xs text-ink-subtle">后端未提供该章节的关键结论。</p>
                            ) : (
                              <ul className="space-y-2">
                                {conclusions.map((conclusion, cIndex) => (
                                  <li key={cIndex} className="rounded-md border border-line-soft p-3">
                                    {(conclusion.text || conclusion.statement) && (
                                      <p className="whitespace-pre-wrap break-words text-xs text-ink">
                                        {conclusion.text || conclusion.statement}
                                      </p>
                                    )}
                                    <SourceList sources={conclusion.sources ?? []} />
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
