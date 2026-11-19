import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowLeft,
  ChartNoAxesCombined,
  ClipboardCheck,
  Cpu,
  Play,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { JsonBlock } from '../components/JsonBlock'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { Tabs } from '../components/Tabs'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import { reproductionApi } from '../services/reproductionApi'
import type {
  BenchmarkPredictionInput,
  BenchmarkTruthInput,
  RecomputeResult,
} from '../types/reproduction'
import { toast } from '../stores/toastStore'

const VERDICTS: Array<{ key: string; label: string; tone: Tone }> = [
  { key: 'VERIFIED', label: '已验证', tone: 'success' },
  { key: 'PARTIALLY_VERIFIED', label: '部分验证', tone: 'accent' },
  { key: 'INSUFFICIENT_EVIDENCE', label: '证据不足', tone: 'warning' },
  { key: 'CONFLICTING', label: '存在冲突', tone: 'danger' },
  { key: 'UNVERIFIABLE', label: '无法验证', tone: 'neutral' },
]

const DIMENSION_LABELS: Record<string, string> = {
  material_available: '材料可获取',
  artifact_assessed: '工件已评估',
  results_validated: '结果已验证',
}

function errorInfo(error: unknown): { message: string; code?: string } {
  return {
    message: error instanceof Error ? error.message : '请求失败，请稍后重试。',
    code: error instanceof ApiError ? error.code : undefined,
  }
}

function verdictTone(verdict: string | undefined): Tone {
  switch (verdict) {
    case 'supported':
    case 'consistent':
    case 'VERIFIED':
      return 'success'
    case 'conflicting':
    case 'inconsistent':
    case 'CONFLICTING':
      return 'danger'
    case 'insufficient_data':
    case 'INSUFFICIENT_EVIDENCE':
      return 'warning'
    default:
      return 'neutral'
  }
}

function valueText(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function ratioText(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(1)}%`
    : '—'
}

function SectionCard({ title, description, children }: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header flex-wrap">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="mt-1 text-xs text-ink-muted">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function ProjectVerificationPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('verdict')
  const [formError, setFormError] = useState<string | null>(null)
  const [codeInput, setCodeInput] = useState('')
  const [metricInput, setMetricInput] = useState('f1')
  const [countsInput, setCountsInput] = useState('')
  const [reportedInput, setReportedInput] = useState('')
  const [truthsInput, setTruthsInput] = useState('')
  const [predictionsInput, setPredictionsInput] = useState('')
  const base = `/projects/${projectId}`

  const verdictQuery = useQuery({
    queryKey: ['verdict-summary', projectId],
    queryFn: () => api.getVerdictSummary(projectId),
    enabled: !!projectId,
  })

  const layersQuery = useQuery({
    queryKey: ['verification-layers'],
    queryFn: () => reproductionApi.getVerificationLayers(),
  })

  const productionQuery = useQuery({
    queryKey: ['production-check'],
    queryFn: () => api.getProductionCheck(),
  })

  const chartMutation = useMutation({
    mutationFn: () => api.runChartVerification(projectId),
    onSuccess: () => toast.success('图表反向验证已完成'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const staticMutation = useMutation({
    mutationFn: (code: string) => reproductionApi.runStaticAnalysis({ 'main.py': code }),
    onSuccess: () => toast.success('AST 静态分析完成（未执行代码）'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const recomputeMutation = useMutation({
    mutationFn: (vars: {
      metric: string
      counts: Record<string, unknown>
      reportedValue: number | null
    }) => reproductionApi.runRecompute(vars.metric, vars.counts, vars.reportedValue),
    onSuccess: () => toast.success('数值重算完成'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const recoverMutation = useMutation({
    mutationFn: () => api.recoverStale(projectId),
    onSuccess: async (data) => {
      toast.success(`已恢复 ${data.recovered} 个超时任务`)
      await queryClient.invalidateQueries({ queryKey: ['parse-tasks', projectId] })
    },
    onError: (error) => toast.error(errorInfo(error).message),
  })

  const benchmarkMutation = useMutation({
    mutationFn: (vars: {
      truths: BenchmarkTruthInput[]
      predictions: BenchmarkPredictionInput[]
    }) => reproductionApi.computeBenchmarkMetrics(vars.truths, vars.predictions),
    onSuccess: () => toast.success('基准指标已按提交的数据计算'),
    onError: (error) => toast.error(errorInfo(error).message),
  })

  function submitRecompute() {
    setFormError(null)
    const metric = metricInput.trim()
    if (!metric) {
      setFormError('请输入指标名（支持 f1 / precision / recall / accuracy）。')
      return
    }
    let counts: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(countsInput)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('计数必须是 JSON 对象。')
      }
      counts = parsed as Record<string, unknown>
    } catch (error) {
      setFormError(`计数 JSON 无效：${error instanceof Error ? error.message : '无法解析'}`)
      return
    }
    const reportedText = reportedInput.trim()
    let reportedValue: number | null = null
    if (reportedText) {
      reportedValue = Number(reportedText)
      if (!Number.isFinite(reportedValue)) {
        setFormError('报告值必须是数字。')
        return
      }
    }
    recomputeMutation.mutate({ metric, counts, reportedValue })
  }

  function submitBenchmark() {
    setFormError(null)
    try {
      const truths: unknown = JSON.parse(truthsInput)
      const predictions: unknown = JSON.parse(predictionsInput)
      if (!Array.isArray(truths) || !Array.isArray(predictions)) {
        throw new Error('真值与预测值都必须是 JSON 数组。')
      }
      benchmarkMutation.mutate({
        truths: truths as BenchmarkTruthInput[],
        predictions: predictions as BenchmarkPredictionInput[],
      })
    } catch (error) {
      setFormError(`基准数据 JSON 无效：${error instanceof Error ? error.message : '无法解析'}`)
    }
  }

  const verdict = verdictQuery.data
  const layers = layersQuery.data
  const chart = chartMutation.data
  const staticResult = staticMutation.data
  const recomputeResult = recomputeMutation.data
  const benchmarkResult = benchmarkMutation.data
  const production = productionQuery.data

  return (
    <div className="space-y-5">
      <PageHeader
        title="项目验证"
        description="集中查看可信结论、图表反向验证与确定性验证引擎；所有数据均来自真实后端调用。"
        actions={
          <nav className="flex flex-wrap items-center gap-2">
            <Link to={`${base}/tasks`} className="btn-ghost"><Activity size={15} />解析任务</Link>
            <Link to={`${base}/evidence-graph`} className="btn-ghost"><ChartNoAxesCombined size={15} />证据图谱</Link>
            <Link to={`${base}/handoff`} className="btn-primary">交接包</Link>
          </nav>
        }
      />

      <Tabs
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { key: 'verdict', label: '可信结论', icon: ShieldCheck },
          { key: 'chart', label: '图表反向验证', icon: ChartNoAxesCombined },
          { key: 'engine', label: '验证引擎', icon: Cpu },
          { key: 'ops', label: '自检与基准', icon: ClipboardCheck },
        ]}
      />

      {formError && (
        <p className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
          {formError}
        </p>
      )}

      {activeTab === 'verdict' && (
        <div className="space-y-5">
          <SectionCard
            title="统一可信结论"
            description="GET /projects/{id}/verdict-summary：五态分布、ACM 三维状态与证据定位完整率。"
          >
            {verdictQuery.isPending ? (
              <LoadingState compact message="正在读取可信结论…" />
            ) : verdictQuery.isError ? (
              <ErrorState
                compact
                message={errorInfo(verdictQuery.error).message}
                code={errorInfo(verdictQuery.error).code}
                onRetry={() => void verdictQuery.refetch()}
              />
            ) : !verdict ? (
              <EmptyState compact title="后端未返回结论数据" description="请确认项目 ID 正确且已导入材料。" />
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-2">
                  {VERDICTS.map((item) => (
                    <StatusBadge key={item.key} tone={item.tone}>
                      {item.label} {verdict.verdicts?.[item.key] ?? 0}
                    </StatusBadge>
                  ))}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">ACM 三维状态</h4>
                  {verdict.dimensions && Object.keys(verdict.dimensions).length > 0 ? (
                    <dl className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(verdict.dimensions).map(([key, raw]) => {
                        const dim = raw && typeof raw === 'object'
                          ? raw as Record<string, unknown>
                          : null
                        const status = typeof dim?.status === 'string' ? dim.status : undefined
                        return (
                          <div key={key} className="rounded-md border border-line bg-canvas px-3 py-2">
                            <dt className="text-xs text-ink-subtle">{DIMENSION_LABELS[key] ?? key}</dt>
                            <dd className="mt-1">
                              <StatusBadge tone={verdictTone(status)}>
                                {valueText(dim?.label ?? status ?? raw)}
                              </StatusBadge>
                              <p className="mono mt-2 break-all text-[11px] text-ink-muted">
                                子类型：{valueText(dim?.subtype)}
                              </p>
                              <p className="mt-1 break-all text-[11px] text-ink-muted">
                                依据：{valueText(dim?.basis)}
                              </p>
                              <p className="mono mt-1 text-[11px] text-ink-subtle">
                                证据数：{valueText(dim?.evidence_count)}
                              </p>
                            </dd>
                          </div>
                        )
                      })}
                    </dl>
                  ) : (
                    <p className="mt-2 text-xs text-ink-subtle">后端未提供维度数据。</p>
                  )}
                </div>

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">证据定位</h4>
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    <span>总数 <strong className="mono">{verdict.evidence_locator?.total ?? 0}</strong></span>
                    <span>有定位 <strong className="mono">{verdict.evidence_locator?.with_location ?? 0}</strong></span>
                    <span>完整率 <strong className="mono">{ratioText(verdict.evidence_locator?.ratio)}</strong></span>
                  </div>
                </div>

                {(verdict.scope_note || verdict.framework_note) && (
                  <div className="rounded-md border border-accent/20 bg-accent-wash px-3 py-2 text-xs leading-relaxed text-ink">
                    {verdict.scope_note && <p>{verdict.scope_note}</p>}
                    {verdict.framework_note && <p className="mt-1">{verdict.framework_note}</p>}
                  </div>
                )}

                {verdict.counts && Object.keys(verdict.counts).length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">底层计数</h4>
                    <div className="mt-2"><JsonBlock value={verdict.counts} /></div>
                  </div>
                )}

                {Array.isArray(verdict.notes) && verdict.notes.length > 0 && (
                  <div className="rounded bg-canvas px-3 py-2">
                    <h4 className="text-xs font-semibold text-ink">聚合备注</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                      {verdict.notes.map((note, index) => (
                        <li key={`${String(note)}-${index}`}>{valueText(note)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === 'chart' && (
        <div className="space-y-5">
          <SectionCard
            title="图表反向验证"
            description="POST /projects/{id}/chart-verification：从项目真实材料提取图注、表格数值与绘图调用，逐条做文本/数值层核对。"
          >
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-primary"
                disabled={!projectId || chartMutation.isPending}
                onClick={() => {
                  setFormError(null)
                  chartMutation.reset()
                  chartMutation.mutate()
                }}
              >
                {chartMutation.isPending
                  ? <RefreshCw size={15} className="animate-spin" />
                  : <Play size={15} />}
                {chartMutation.isPending ? '正在验证…' : '运行图表反向验证'}
              </button>
              <span className="text-xs text-ink-subtle">结果由后端程序化提取，不做图像级重绘。</span>
            </div>

            {chartMutation.isError && (
              <div className="mt-4">
                <ErrorState
                  compact
                  message={errorInfo(chartMutation.error).message}
                  code={errorInfo(chartMutation.error).code}
                  onRetry={() => {
                    chartMutation.reset()
                    chartMutation.mutate()
                  }}
                />
              </div>
            )}

            {!chartMutation.isPending && !chartMutation.isError && !chart && (
              <div className="mt-4">
                <EmptyState
                  compact
                  icon={ChartNoAxesCombined}
                  title="尚未运行图表验证"
                  description="点击上方按钮，对当前项目的真实材料执行反向验证。"
                />
              </div>
            )}

            {chart && (
              <div className="mt-5 space-y-5">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="neutral">声明 {chart.summary?.total_claims ?? 0}</StatusBadge>
                  <StatusBadge tone="success">支持 {chart.summary?.supported ?? 0}</StatusBadge>
                  <StatusBadge tone="danger">冲突 {chart.summary?.conflicting ?? 0}</StatusBadge>
                  <StatusBadge tone="warning">证据不足 {chart.summary?.insufficient_data ?? 0}</StatusBadge>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  {[
                    ['图注 captions', chart.captions],
                    ['表格声明 table_claims', chart.table_claims],
                    ['绘图调用 plot_logic', chart.plot_logic],
                    ['结果数值 result_files', chart.result_files],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <h4 className="mb-2 text-xs font-semibold text-ink">{String(label)}</h4>
                      {Array.isArray(value) && value.length > 0
                        ? <JsonBlock value={value} />
                        : <p className="text-xs text-ink-subtle">未提取到相关证据。</p>}
                    </div>
                  ))}
                </div>

                <div>
                  <h4 className="mb-2 text-xs font-semibold text-ink">逐条核对 verifications</h4>
                  {chart.verifications.length === 0 ? (
                    <p className="text-xs text-ink-subtle">无可核对的表格声明。</p>
                  ) : (
                    <ul className="space-y-3">
                      {chart.verifications.map((item, index) => (
                        <li key={`${item.claim_id ?? 'claim'}-${index}`} className="rounded-md border border-line bg-canvas px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={verdictTone(item.verdict)}>
                              {item.verdict ?? 'unknown'}
                            </StatusBadge>
                            <span className="text-xs text-ink-muted">{item.metric_name || '未命名指标'}</span>
                          </div>
                          {item.verdict === 'insufficient_data' && (
                            <p className="mt-2 rounded bg-warning-wash px-2 py-1 text-xs text-warning">
                              证据不足：未完成精确复核，仅记录已有文本声明与绘图调用证据。
                            </p>
                          )}
                          <div className="mt-2"><JsonBlock value={item} maxHeight="max-h-48" /></div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {chart.limitations.length > 0 && (
                  <div className="rounded-md border border-line bg-canvas px-3 py-2">
                    <h4 className="text-xs font-semibold text-ink">验证边界</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                      {chart.limitations.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      {activeTab === 'engine' && (
        <div className="space-y-5">
          <SectionCard title="验证分层" description="GET /verification/layers：五层职责、依据与默认执行状态。">
            {layersQuery.isPending ? (
              <LoadingState compact message="正在读取验证分层…" />
            ) : layersQuery.isError ? (
              <ErrorState
                compact
                message={errorInfo(layersQuery.error).message}
                code={errorInfo(layersQuery.error).code}
                onRetry={() => void layersQuery.refetch()}
              />
            ) : !layers || layers.layers.length === 0 ? (
              <EmptyState compact title="后端未返回分层定义" />
            ) : (
              <div className="space-y-4">
                <ul className="space-y-3">
                  {layers.layers.map((layer) => (
                    <li key={layer.layer} className="rounded-md border border-line bg-canvas px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="mono text-xs font-semibold text-accent-dark">L{layer.layer}</span>
                        <span className="text-sm font-semibold text-ink">{layer.name}</span>
                        <StatusBadge tone={layer.executed_by_default ? 'success' : 'warning'}>
                          {layer.executed_by_default ? '默认执行' : '未执行'}
                        </StatusBadge>
                        <span className="mono text-[11px] text-ink-subtle">{layer.method}</span>
                      </div>
                      <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                        <div><dt className="inline font-semibold text-ink-muted">依据：</dt><dd className="inline text-ink">{layer.basis}</dd></div>
                        <div><dt className="inline font-semibold text-ink-muted">边界：</dt><dd className="inline text-ink">{layer.boundary}</dd></div>
                        <div className="sm:col-span-2"><dt className="inline font-semibold text-ink-muted">说明：</dt><dd className="inline text-ink">{layer.note}</dd></div>
                      </dl>
                    </li>
                  ))}
                </ul>
                {layers.note && <p className="rounded bg-warning-wash px-3 py-2 text-xs text-warning">{layers.note}</p>}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="第 2 层 · 静态代码分析"
            description="POST /verification/static-analysis：仅用 AST 解析 Python 源码，绝不执行上传代码。"
          >
            <label className="block text-xs font-semibold text-ink-muted" htmlFor="source-code">
              Python 源码（以 main.py 提交）
            </label>
            <textarea
              id="source-code"
              className="mono mt-2 min-h-[140px] w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
              placeholder={'import torch\n\nclass Model(torch.nn.Module):\n    pass'}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={!codeInput.trim() || staticMutation.isPending}
              onClick={() => {
                setFormError(null)
                staticMutation.reset()
                staticMutation.mutate(codeInput)
              }}
            >
              {staticMutation.isPending
                ? <RefreshCw size={15} className="animate-spin" />
                : <Play size={15} />}
              {staticMutation.isPending ? '正在静态分析…' : '运行静态分析'}
            </button>

            {staticMutation.isError && (
              <div className="mt-4">
                <ErrorState
                  compact
                  message={errorInfo(staticMutation.error).message}
                  code={errorInfo(staticMutation.error).code}
                  onRetry={() => staticMutation.mutate(codeInput)}
                />
              </div>
            )}
            {!staticMutation.isPending && !staticMutation.isError && !staticResult && (
              <p className="mt-4 text-xs text-ink-subtle">输入源码并运行后，这里展示导入、模型类、随机种子与优化器等可复核观察。</p>
            )}
            {staticResult && (
              <div className="mt-4 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone="neutral">文件 {staticResult.files_analyzed}</StatusBadge>
                  <StatusBadge tone="success">解析成功 {staticResult.valid_files}</StatusBadge>
                  <StatusBadge tone="accent">观察 {staticResult.finding_count}</StatusBadge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ['imports', staticResult.combined.imports],
                    ['model_classes', staticResult.combined.model_classes],
                    ['function_defs', staticResult.combined.function_defs],
                    ['optimizer_and_lr', staticResult.combined.optimizer_and_lr],
                    ['train_test_split_calls', staticResult.combined.train_test_split_calls],
                    ['random_seed_settings', staticResult.combined.random_seed_settings],
                  ].map(([label, value]) => (
                    <div key={String(label)}>
                      <h4 className="mono mb-1 text-xs font-semibold text-ink">{String(label)}</h4>
                      {Array.isArray(value) && value.length > 0
                        ? <JsonBlock value={value} maxHeight="max-h-40" />
                        : <p className="text-xs text-ink-subtle">未观察到。</p>}
                    </div>
                  ))}
                </div>
                {staticResult.syntax_errors.length > 0 && (
                  <div className="rounded bg-danger-wash px-3 py-2 text-xs text-danger">
                    {staticResult.syntax_errors.map((item) => (
                      <p key={item.file} className="mono">{item.file}: {item.error}</p>
                    ))}
                  </div>
                )}
                {staticResult.warnings.length > 0 && (
                  <div className="rounded bg-warning-wash px-3 py-2 text-xs text-warning">
                    {staticResult.warnings.map((item) => <p key={item}>{item}</p>)}
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="第 4 层 · 数值重算"
            description="POST /verification/recompute：从 TP/FP/FN 或 correct/total 按公开公式重算，并与报告值按容差对比。"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-semibold text-ink-muted" htmlFor="metric-name">
                指标名
                <input
                  id="metric-name"
                  className="mono mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs font-normal text-ink"
                  value={metricInput}
                  onChange={(event) => setMetricInput(event.target.value)}
                />
              </label>
              <label className="block text-xs font-semibold text-ink-muted" htmlFor="reported-value">
                报告值（可选）
                <input
                  id="reported-value"
                  className="mono mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs font-normal text-ink"
                  inputMode="decimal"
                  placeholder="例如 0.82"
                  value={reportedInput}
                  onChange={(event) => setReportedInput(event.target.value)}
                />
              </label>
            </div>
            <label className="mt-3 block text-xs font-semibold text-ink-muted" htmlFor="recompute-counts">
              原始计数 JSON
            </label>
            <textarea
              id="recompute-counts"
              className="mono mt-1 min-h-[80px] w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
              placeholder={'{"tp": 10, "fp": 2, "fn": 1}'}
              value={countsInput}
              onChange={(event) => setCountsInput(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={!countsInput.trim() || recomputeMutation.isPending}
              onClick={() => {
                recomputeMutation.reset()
                submitRecompute()
              }}
            >
              {recomputeMutation.isPending
                ? <RefreshCw size={15} className="animate-spin" />
                : <Play size={15} />}
              {recomputeMutation.isPending ? '正在重算…' : '运行数值重算'}
            </button>

            {recomputeMutation.isError && (
              <div className="mt-4">
                <ErrorState
                  compact
                  message={errorInfo(recomputeMutation.error).message}
                  code={errorInfo(recomputeMutation.error).code}
                  onRetry={submitRecompute}
                />
              </div>
            )}
            {!recomputeMutation.isPending && !recomputeMutation.isError && !recomputeResult && (
              <p className="mt-4 text-xs text-ink-subtle">输入真实计数与报告值后，这里展示重算结果和一致性判定。</p>
            )}
            {recomputeResult && <RecomputeView result={recomputeResult} />}
          </SectionCard>
        </div>
      )}

      {activeTab === 'ops' && (
        <div className="space-y-5">
          <SectionCard title="生产配置自检" description="GET /diagnosis/production-check：只读检查当前部署配置，问题清单为空表示通过。">
            {productionQuery.isPending ? (
              <LoadingState compact message="正在读取生产自检结果…" />
            ) : productionQuery.isError ? (
              <ErrorState
                compact
                message={errorInfo(productionQuery.error).message}
                code={errorInfo(productionQuery.error).code}
                onRetry={() => void productionQuery.refetch()}
              />
            ) : !production ? (
              <EmptyState compact title="后端未返回自检结果" />
            ) : (
              <div className="space-y-3">
                <StatusBadge tone={production.passed ? 'success' : 'danger'}>
                  {production.passed ? '检查通过' : `发现 ${production.issues.length} 项问题`}
                </StatusBadge>
                {production.issues.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-danger">
                    {production.issues.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-subtle">问题清单为空。</p>
                )}
                <p className="text-xs text-ink-muted">{production.note}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard title="超时任务恢复" description="POST /parse-tasks/recover-stale：按当前项目范围恢复心跳过期任务。">
            <button
              type="button"
              className="btn-ghost"
              disabled={!projectId || recoverMutation.isPending}
              onClick={() => recoverMutation.mutate()}
            >
              {recoverMutation.isPending
                ? <RefreshCw size={15} className="animate-spin" />
                : <RefreshCw size={15} />}
              {recoverMutation.isPending ? '正在恢复…' : '恢复本项目超时任务'}
            </button>
            {recoverMutation.isError && (
              <p className="mt-3 rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
                恢复失败：{errorInfo(recoverMutation.error).message}
                （{errorInfo(recoverMutation.error).code ?? 'UNKNOWN_ERROR'}）
              </p>
            )}
            {recoverMutation.isSuccess && (
              <p className="mt-3 rounded-md bg-success-wash px-3 py-2 text-xs text-success">
                已恢复 {recoverMutation.data.recovered} 个任务；任务列表已刷新。
              </p>
            )}
          </SectionCard>

          <SectionCard title="基准指标计算" description="POST /benchmark/metrics/compute：提交标注真值与预测值，计算 P/R/F1、误报/漏报率与定位准确率。">
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="block text-xs font-semibold text-ink-muted" htmlFor="truth-json">
                真值 JSON 数组
              </label>
              <label className="block text-xs font-semibold text-ink-muted" htmlFor="prediction-json">
                预测 JSON 数组
              </label>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <textarea
                id="truth-json"
                className="mono min-h-[120px] w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
                placeholder={'[{"item_id": "c1", "category": "environment", "evidence_locator": "L10"}]'}
                value={truthsInput}
                onChange={(event) => setTruthsInput(event.target.value)}
              />
              <textarea
                id="prediction-json"
                className="mono min-h-[120px] w-full rounded-md border border-line bg-canvas px-3 py-2 text-xs text-ink"
                placeholder={'[{"item_id": "c1", "category": "environment", "evidence_locator": "L10", "confidence": 0.9}]'}
                value={predictionsInput}
                onChange={(event) => setPredictionsInput(event.target.value)}
              />
            </div>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={!truthsInput.trim() || !predictionsInput.trim() || benchmarkMutation.isPending}
              onClick={() => {
                benchmarkMutation.reset()
                submitBenchmark()
              }}
            >
              {benchmarkMutation.isPending
                ? <RefreshCw size={15} className="animate-spin" />
                : <Play size={15} />}
              {benchmarkMutation.isPending ? '正在计算…' : '计算基准指标'}
            </button>

            {benchmarkMutation.isError && (
              <div className="mt-4">
                <ErrorState
                  compact
                  message={errorInfo(benchmarkMutation.error).message}
                  code={errorInfo(benchmarkMutation.error).code}
                  onRetry={submitBenchmark}
                />
              </div>
            )}
            {!benchmarkMutation.isPending && !benchmarkMutation.isError && !benchmarkResult && (
              <p className="mt-4 text-xs text-ink-subtle">输入框仅作数据提交用途；未运行计算时不展示任何指标。</p>
            )}
            {benchmarkResult && (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {[
                    ['precision', benchmarkResult.precision],
                    ['recall', benchmarkResult.recall],
                    ['f1', benchmarkResult.f1],
                    ['false_positive_rate', benchmarkResult.false_positive_rate],
                    ['false_negative_rate', benchmarkResult.false_negative_rate],
                    ['evidence_location_accuracy', benchmarkResult.evidence_location_accuracy],
                    ['category_accuracy', benchmarkResult.category_accuracy ?? benchmarkResult.classification_accuracy],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border border-line bg-canvas px-3 py-2">
                      <p className="mono text-[11px] text-ink-subtle">{String(label)}</p>
                      <p className="mono mt-1 text-sm font-semibold text-ink">
                        {typeof value === 'number' ? value.toFixed(2) : value == null ? '—' : value}
                      </p>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-ink">counts</h4>
                  <JsonBlock value={benchmarkResult.counts} />
                </div>
                {benchmarkResult.formula_notes.length > 0 && (
                  <div className="rounded bg-canvas px-3 py-2">
                    <h4 className="text-xs font-semibold text-ink">公式说明</h4>
                    <ul className="mt-1 list-disc space-y-1 pl-5 text-xs text-ink-muted">
                      {benchmarkResult.formula_notes.map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        </div>
      )}

      <p className="flex items-center gap-1 text-xs text-ink-subtle">
        <ArrowLeft size={12} />
        <Link to={`${base}/materials`} className="hover:text-accent-dark">返回材料管理</Link>
      </p>
    </div>
  )
}

function RecomputeView({ result }: { result: RecomputeResult }) {
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={verdictTone(result.verdict)}>{result.verdict}</StatusBadge>
        <span className="mono text-xs text-ink-muted">
          重算 {result.recomputed ?? '—'} / 报告 {result.reported ?? '—'} / 差值 {result.abs_diff ?? '—'}
        </span>
        {result.metric && <StatusBadge tone="neutral">{result.metric}</StatusBadge>}
      </div>
      {result.note && <p className="text-xs text-ink-muted">{result.note}</p>}
      {result.denominator_zero === true && (
        <p className="rounded bg-warning-wash px-3 py-2 text-xs text-warning">
          分母为零或计数无效，后端已明确标记证据不足，未伪造一致性结论。
        </p>
      )}
      <JsonBlock value={result} maxHeight="max-h-48" />
    </div>
  )
}
