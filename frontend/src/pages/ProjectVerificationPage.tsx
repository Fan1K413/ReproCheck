/**
 * 项目验证（图4 精密线框 + 验证状态）
 *
 * 业务未变：4 个标签页的全部真实查询与 mutation 均保留（verdict / chart / engine / ops）。
 * 特色交互：**判定刻度尺（Verdict Rail）** —— 以真实 verdict.verdicts 五态计数画出比例刻度，
 * 点击某一态即聚焦该态对应的 ACM 维度；无匹配维度时如实说明，不补造结论。
 *
 * 真实数据绑定：
 *   - GET /projects/{id}/verdict-summary → verdicts / dimensions / evidence_locator / counts / notes
 *   - GET /verification/layers
 *   - GET /diagnosis/production-check
 *   - POST /projects/{id}/chart-verification · /verification/static-analysis · /verification/recompute
 *   - POST /parse-tasks/recover-stale · /benchmark/metrics/compute
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChartNoAxesCombined, ClipboardCheck, Cpu, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
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
import '../styles/wave-c-verify.css'

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

/** 维度状态 → 五态判定键；后端返回的 supported/consistent 等别名统一归一。 */
function normalizeVerdict(status: string | undefined): string | null {
  if (!status) return null
  const upper = status.toUpperCase()
  if (VERDICTS.some((item) => item.key === upper)) return upper
  if (upper === 'SUPPORTED' || upper === 'CONSISTENT') return 'VERIFIED'
  if (upper === 'CONFLICTING' || upper === 'INCONSISTENT') return 'CONFLICTING'
  if (upper === 'INSUFFICIENT_DATA') return 'INSUFFICIENT_EVIDENCE'
  if (upper === 'PARTIAL' || upper === 'PARTIALLY_VERIFIED') return 'PARTIALLY_VERIFIED'
  return null
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
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}

function Rc4Panel({
  title,
  icon,
  hint,
  actions,
  children,
}: {
  title: string
  icon?: ReactNode
  hint?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="rc4-panel">
      <div className="rc4-panel__head">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h3 className="rc4-panel__title">
            {icon}
            {title}
          </h3>
          {hint && <span className="rc4-panel__hint">{hint}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <div className="rc4-panel__body">{children}</div>
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
  const [focusVerdict, setFocusVerdict] = useState<string | null>(null)
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

  /* 五态计数与比例（真实字段）。 */
  const verdictStats = useMemo(() => {
    const counts = verdict?.verdicts ?? {}
    const values = VERDICTS.map((item) => ({ ...item, count: counts[item.key] ?? 0 }))
    const total = values.reduce((sum, item) => sum + item.count, 0)
    return { values, total }
  }, [verdict])

  /* 聚焦态：只保留归一到该五态的 ACM 维度。 */
  const focusedDimensions = useMemo(() => {
    if (!verdict?.dimensions) return []
    const entries = Object.entries(verdict.dimensions).map(([key, raw]) => {
      const dim = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
      const status = typeof dim?.status === 'string' ? dim.status : undefined
      return { key, dim, status, normalized: normalizeVerdict(status) }
    })
    if (!focusVerdict) return entries
    return entries.filter((entry) => entry.normalized === focusVerdict)
  }, [verdict, focusVerdict])

  return (
    <div className="rc4-page">
      <PageHeader
        title="项目验证"
        description="集中查看可信结论、图表反向验证与确定性验证引擎；所有数据均来自真实后端调用。"
        actions={
          <nav className="flex flex-wrap items-center gap-2">
            <Link to={`${base}/tasks`} className="btn-ghost">
              <Icon name="clipboardCheck" size="sm" />
              解析任务
            </Link>
            <Link to={`${base}/evidence-graph`} className="btn-ghost">
              <Icon name="network" size="sm" />
              证据图谱
            </Link>
            <Link to={`${base}/handoff`} className="btn-primary">
              交接包
            </Link>
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
        <p
          className="rounded-md px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
          role="alert"
        >
          {formError}
        </p>
      )}

      {activeTab === 'verdict' && (
        <Rc4Panel
          title="统一可信结论"
          icon={<Icon name="shield" size="sm" tone="accent" />}
          hint="GET /projects/{id}/verdict-summary"
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
            <div className="flex flex-col gap-5">
              {/* 判定刻度尺：比例来自真实五态计数 */}
              <div className="rc4-kpis">
                {verdictStats.values.map((item) => (
                  <div key={item.key} className="rc4-kpi">
                    <p className="rc4-kpi__label">{item.label}</p>
                    <p className="rc4-kpi__value">{item.count}</p>
                    <div className="rc4-meter mt-2">
                      <span
                        className={`rc4-meter__fill rc4-meter__fill--${
                          item.tone === 'accent'
                            ? 'success'
                            : item.tone === 'success'
                              ? 'success'
                              : item.tone === 'warning'
                                ? 'warning'
                                : item.tone === 'danger'
                                  ? 'danger'
                                  : 'neutral'
                        }`}
                        style={{
                          transform: `scaleX(${
                            verdictStats.total > 0 ? item.count / verdictStats.total : 0
                          })`,
                        }}
                        aria-hidden="true"
                      />
                    </div>
                    <p className="rc4-kpi__foot">
                      {verdictStats.total > 0
                        ? `${((item.count / verdictStats.total) * 100).toFixed(1)}%`
                        : '—'}
                    </p>
                  </div>
                ))}
                <div className="rc4-kpi">
                  <p className="rc4-kpi__label">证据定位完整率</p>
                  <p className="rc4-kpi__value">{ratioText(verdict.evidence_locator?.ratio)}</p>
                  <div className="rc4-meter mt-2">
                    <span
                      className="rc4-meter__fill"
                      style={{
                        transform: `scaleX(${
                          typeof verdict.evidence_locator?.ratio === 'number'
                            ? Math.min(1, Math.max(0, verdict.evidence_locator.ratio))
                            : 0
                        })`,
                      }}
                      aria-hidden="true"
                    />
                  </div>
                  <p className="rc4-kpi__foot">
                    有定位 {verdict.evidence_locator?.with_location ?? 0} / 总数{' '}
                    {verdict.evidence_locator?.total ?? 0}
                  </p>
                </div>
              </div>

              {/* 判定聚焦：点击刻度条切换维度视图 */}
              <div>
                <p className="rcw-overline mb-2">判定聚焦</p>
                <div className="rc4-rail" role="group" aria-label="按可信结论聚焦">
                  <button
                    type="button"
                    className="rc4-rail__item"
                    aria-pressed={focusVerdict === null}
                    onClick={() => setFocusVerdict(null)}
                  >
                    <Icon name="grid" size="xs" />
                    全部维度
                    <span className="rc4-rail__count">{focusedDimensions.length}</span>
                  </button>
                  {VERDICTS.map((item) => {
                    const count = verdict.verdicts?.[item.key] ?? 0
                    return (
                      <button
                        key={item.key}
                        type="button"
                        className="rc4-rail__item"
                        aria-pressed={focusVerdict === item.key}
                        onClick={() => setFocusVerdict(focusVerdict === item.key ? null : item.key)}
                      >
                        {item.label}
                        <span className="rc4-rail__count">{count}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-2 text-xs" style={{ color: 'var(--rc-text-subtle)' }} aria-live="polite">
                  {focusVerdict
                    ? `当前聚焦「${VERDICTS.find((item) => item.key === focusVerdict)?.label ?? focusVerdict}」，匹配 ${focusedDimensions.length} 个维度。`
                    : `显示全部 ${focusedDimensions.length} 个 ACM 维度。`}
                </p>
              </div>

              {/* ACM 三维状态 */}
              <div>
                <p className="rcw-overline mb-2">ACM 三维状态</p>
                {verdict.dimensions && Object.keys(verdict.dimensions).length > 0 ? (
                  focusedDimensions.length === 0 ? (
                    <p className="rc4-list__meta">该判定下暂无维度条目。</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {focusedDimensions.map((entry) => (
                        <div key={entry.key} className="rc4-kpi">
                          <p className="rc4-kpi__label">
                            {DIMENSION_LABELS[entry.key] ?? entry.key}
                          </p>
                          <div className="mt-2">
                            <StatusBadge tone={verdictTone(entry.status)}>
                              {valueText(entry.dim?.label ?? entry.status ?? entry.dim)}
                            </StatusBadge>
                          </div>
                          <p className="rc4-kpi__foot mt-2 break-all">
                            子类型：{valueText(entry.dim?.subtype)}
                          </p>
                          <p className="rc4-kpi__foot break-all">依据：{valueText(entry.dim?.basis)}</p>
                          <p className="rc4-kpi__foot">
                            证据数：{valueText(entry.dim?.evidence_count)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <p className="rc4-list__meta">后端未提供维度数据。</p>
                )}
              </div>

              {(verdict.scope_note || verdict.framework_note) && (
                <div className="rcw-note">
                  <Icon name="file" size="sm" tone="accent" />
                  <div>
                    {verdict.scope_note && <p>{verdict.scope_note}</p>}
                    {verdict.framework_note && <p className="mt-1">{verdict.framework_note}</p>}
                  </div>
                </div>
              )}

              {verdict.counts && Object.keys(verdict.counts).length > 0 && (
                <div>
                  <p className="rcw-overline mb-2">底层计数</p>
                  <JsonBlock value={verdict.counts} />
                </div>
              )}

              {Array.isArray(verdict.notes) && verdict.notes.length > 0 && (
                <div className="rc4-list">
                  <p className="rcw-overline mb-2">聚合备注</p>
                  {verdict.notes.map((note, index) => (
                    <p key={`${String(note)}-${index}`} className="rc4-list__meta">
                      {valueText(note)}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}
        </Rc4Panel>
      )}

      {activeTab === 'chart' && (
        <Rc4Panel
          title="图表反向验证"
          icon={<Icon name="file" size="sm" tone="accent" />}
          hint="POST /projects/{id}/chart-verification"
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
              {chartMutation.isPending ? (
                <Icon name="rotate" size="sm" className="animate-spin" />
              ) : (
                <Icon name="play" size="sm" />
              )}
              {chartMutation.isPending ? '正在验证…' : '运行图表反向验证'}
            </button>
            <span className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
              结果由后端程序化提取，不做图像级重绘。
            </span>
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
                title="尚未运行图表验证"
                description="点击上方按钮，对当前项目的真实材料执行反向验证。"
              />
            </div>
          )}

          {chart && (
            <div className="mt-5 flex flex-col gap-5">
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
                    <p className="rcw-overline mb-2">{String(label)}</p>
                    {Array.isArray(value) && value.length > 0 ? (
                      <JsonBlock value={value} />
                    ) : (
                      <p className="rc4-list__meta">未提取到相关证据。</p>
                    )}
                  </div>
                ))}
              </div>

              <div>
                <p className="rcw-overline mb-2">逐条核对 verifications</p>
                {chart.verifications.length === 0 ? (
                  <p className="rc4-list__meta">无可核对的表格声明。</p>
                ) : (
                  <div className="rc4-list">
                    {chart.verifications.map((item, index) => (
                      <div key={`${item.claim_id ?? 'claim'}-${index}`} className="rc4-list__row">
                        <div className="rc4-list__main">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={verdictTone(item.verdict)}>{item.verdict ?? 'unknown'}</StatusBadge>
                            <span className="rc4-list__title">{item.metric_name || '未命名指标'}</span>
                          </div>
                          {item.verdict === 'insufficient_data' && (
                            <p
                              className="mt-2 rounded px-2 py-1 text-xs"
                              style={{
                                backgroundColor: 'var(--rc-warning-wash)',
                                color: 'var(--rc-warning)',
                              }}
                            >
                              证据不足：未完成精确复核，仅记录已有文本声明与绘图调用证据。
                            </p>
                          )}
                          <div className="mt-2">
                            <JsonBlock value={item} maxHeight="max-h-48" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {chart.limitations.length > 0 && (
                <div className="rcw-note rcw-note--warn">
                  <Icon name="triangleAlert" size="sm" tone="warning" />
                  <ul className="list-disc space-y-1 pl-5">
                    {chart.limitations.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Rc4Panel>
      )}

      {activeTab === 'engine' && (
        <div className="flex flex-col gap-4">
          <Rc4Panel title="验证分层" hint="GET /verification/layers">
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
              <div className="flex flex-col gap-3">
                <div className="rc4-list">
                  {layers.layers.map((layer) => (
                    <div key={layer.layer} className="rc4-list__row">
                      <div className="rc4-list__main">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rcw-chip">L{layer.layer}</span>
                          <span className="rc4-list__title">{layer.name}</span>
                          <StatusBadge tone={layer.executed_by_default ? 'success' : 'warning'}>
                            {layer.executed_by_default ? '默认执行' : '未执行'}
                          </StatusBadge>
                          <span className="rc4-list__meta">{layer.method}</span>
                        </div>
                        <p className="rc4-list__meta">依据：{layer.basis}</p>
                        <p className="rc4-list__meta">边界：{layer.boundary}</p>
                        <p className="rc4-list__meta">说明：{layer.note}</p>
                      </div>
                    </div>
                  ))}
                </div>
                {layers.note && (
                  <p
                    className="rounded px-3 py-2 text-xs"
                    style={{ backgroundColor: 'var(--rc-warning-wash)', color: 'var(--rc-warning)' }}
                  >
                    {layers.note}
                  </p>
                )}
              </div>
            )}
          </Rc4Panel>

          <Rc4Panel title="第 2 层 · 静态代码分析" hint="POST /verification/static-analysis">
            <label className="field-label" htmlFor="source-code">
              Python 源码（以 main.py 提交）
            </label>
            <textarea
              id="source-code"
              className="field-input mono"
              style={{ height: 'auto', minHeight: 140 }}
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
              {staticMutation.isPending ? (
                <Icon name="rotate" size="sm" className="animate-spin" />
              ) : (
                <Icon name="play" size="sm" />
              )}
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
              <p className="mt-4 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                输入源码并运行后，这里展示导入、模型类、随机种子与优化器等可复核观察。
              </p>
            )}
            {staticResult && (
              <div className="mt-4 flex flex-col gap-3">
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
                      <p className="rcw-overline mb-1">{String(label)}</p>
                      {Array.isArray(value) && value.length > 0 ? (
                        <JsonBlock value={value} maxHeight="max-h-40" />
                      ) : (
                        <p className="rc4-list__meta">未观察到。</p>
                      )}
                    </div>
                  ))}
                </div>
                {staticResult.syntax_errors.length > 0 && (
                  <p
                    className="rounded px-3 py-2 text-xs"
                    style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
                  >
                    {staticResult.syntax_errors.map((item) => (
                      <span key={item.file} className="mono block">
                        {item.file}: {item.error}
                      </span>
                    ))}
                  </p>
                )}
                {staticResult.warnings.length > 0 && (
                  <p
                    className="rounded px-3 py-2 text-xs"
                    style={{ backgroundColor: 'var(--rc-warning-wash)', color: 'var(--rc-warning)' }}
                  >
                    {staticResult.warnings.map((item) => (
                      <span key={item} className="block">
                        {item}
                      </span>
                    ))}
                  </p>
                )}
              </div>
            )}
          </Rc4Panel>

          <Rc4Panel title="第 4 层 · 数值重算" hint="POST /verification/recompute">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="field-label" htmlFor="metric-name">
                指标名
                <input
                  id="metric-name"
                  className="field-input mono mt-1"
                  value={metricInput}
                  onChange={(event) => setMetricInput(event.target.value)}
                />
              </label>
              <label className="field-label" htmlFor="reported-value">
                报告值（可选）
                <input
                  id="reported-value"
                  className="field-input mono mt-1"
                  inputMode="decimal"
                  placeholder="例如 0.82"
                  value={reportedInput}
                  onChange={(event) => setReportedInput(event.target.value)}
                />
              </label>
            </div>
            <label className="field-label mt-3" htmlFor="recompute-counts">
              原始计数 JSON
            </label>
            <textarea
              id="recompute-counts"
              className="field-input mono"
              style={{ height: 'auto', minHeight: 80 }}
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
              {recomputeMutation.isPending ? (
                <Icon name="rotate" size="sm" className="animate-spin" />
              ) : (
                <Icon name="play" size="sm" />
              )}
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
              <p className="mt-4 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                输入真实计数与报告值后，这里展示重算结果和一致性判定。
              </p>
            )}
            {recomputeResult && <RecomputeView result={recomputeResult} />}
          </Rc4Panel>
        </div>
      )}

      {activeTab === 'ops' && (
        <div className="flex flex-col gap-4">
          <Rc4Panel title="生产配置自检" hint="GET /diagnosis/production-check">
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
              <div className="flex flex-col gap-3">
                <StatusBadge tone={production.passed ? 'success' : 'danger'}>
                  {production.passed ? '检查通过' : `发现 ${production.issues.length} 项问题`}
                </StatusBadge>
                {production.issues.length > 0 ? (
                  <ul
                    className="list-disc space-y-1 pl-5 text-xs"
                    style={{ color: 'var(--rc-danger)' }}
                  >
                    {production.issues.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="rc4-list__meta">问题清单为空。</p>
                )}
                <p className="rc4-list__meta">{production.note}</p>
              </div>
            )}
          </Rc4Panel>

          <Rc4Panel title="超时任务恢复" hint="POST /parse-tasks/recover-stale">
            <button
              type="button"
              className="btn-ghost"
              disabled={!projectId || recoverMutation.isPending}
              onClick={() => recoverMutation.mutate()}
            >
              <Icon name="rotate" size="sm" className={recoverMutation.isPending ? 'animate-spin' : ''} />
              {recoverMutation.isPending ? '正在恢复…' : '恢复本项目超时任务'}
            </button>
            {recoverMutation.isError && (
              <p
                className="mt-3 rounded-md px-3 py-2 text-xs"
                style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
                role="alert"
              >
                恢复失败：{errorInfo(recoverMutation.error).message}
                （{errorInfo(recoverMutation.error).code ?? 'UNKNOWN_ERROR'}）
              </p>
            )}
            {recoverMutation.isSuccess && (
              <p
                className="mt-3 rounded-md px-3 py-2 text-xs"
                style={{ backgroundColor: 'var(--rc-success-wash)', color: 'var(--rc-success)' }}
              >
                已恢复 {recoverMutation.data.recovered} 个任务；任务列表已刷新。
              </p>
            )}
          </Rc4Panel>

          <Rc4Panel title="基准指标计算" hint="POST /benchmark/metrics/compute">
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="field-label" htmlFor="truth-json">
                真值 JSON 数组
              </label>
              <label className="field-label" htmlFor="prediction-json">
                预测 JSON 数组
              </label>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <textarea
                id="truth-json"
                className="field-input mono"
                style={{ height: 'auto', minHeight: 120 }}
                placeholder={'[{"item_id": "c1", "category": "environment", "evidence_locator": "L10"}]'}
                value={truthsInput}
                onChange={(event) => setTruthsInput(event.target.value)}
              />
              <textarea
                id="prediction-json"
                className="field-input mono"
                style={{ height: 'auto', minHeight: 120 }}
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
              {benchmarkMutation.isPending ? (
                <Icon name="rotate" size="sm" className="animate-spin" />
              ) : (
                <Icon name="play" size="sm" />
              )}
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
              <p className="mt-4 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                输入框仅作数据提交用途；未运行计算时不展示任何指标。
              </p>
            )}
            {benchmarkResult && (
              <div className="mt-4 flex flex-col gap-3">
                <div className="rc4-kpis">
                  {[
                    ['precision', benchmarkResult.precision],
                    ['recall', benchmarkResult.recall],
                    ['f1', benchmarkResult.f1],
                    ['false_positive_rate', benchmarkResult.false_positive_rate],
                    ['false_negative_rate', benchmarkResult.false_negative_rate],
                    ['evidence_location_accuracy', benchmarkResult.evidence_location_accuracy],
                    [
                      'category_accuracy',
                      benchmarkResult.category_accuracy ?? benchmarkResult.classification_accuracy,
                    ],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rc4-kpi">
                      <p className="rc4-kpi__label">{String(label)}</p>
                      <p className="rc4-kpi__value">
                        {typeof value === 'number' ? value.toFixed(2) : value == null ? '—' : value}
                      </p>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="rcw-overline mb-1">counts</p>
                  <JsonBlock value={benchmarkResult.counts} />
                </div>
                {benchmarkResult.formula_notes.length > 0 && (
                  <div>
                    <p className="rcw-overline mb-1">公式说明</p>
                    <ul className="list-disc space-y-1 pl-5 text-xs" style={{ color: 'var(--rc-text-muted)' }}>
                      {benchmarkResult.formula_notes.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </Rc4Panel>
        </div>
      )}

      <p className="flex items-center gap-1 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
        <Icon name="arrowLeft" size="xs" />
        <Link to={`${base}/materials`} className="mb-back" style={{ color: 'var(--rc-text-muted)' }}>
          返回材料管理
        </Link>
      </p>
    </div>
  )
}

function RecomputeView({ result }: { result: RecomputeResult }) {
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={verdictTone(result.verdict)}>{result.verdict}</StatusBadge>
        <span className="rc4-list__meta">
          重算 {result.recomputed ?? '—'} / 报告 {result.reported ?? '—'} / 差值 {result.abs_diff ?? '—'}
        </span>
        {result.metric && <StatusBadge tone="neutral">{result.metric}</StatusBadge>}
      </div>
      {result.note && <p className="rc4-list__meta">{result.note}</p>}
      {result.denominator_zero === true && (
        <p
          className="rounded px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--rc-warning-wash)', color: 'var(--rc-warning)' }}
        >
          分母为零或计数无效，后端已明确标记证据不足，未伪造一致性结论。
        </p>
      )}
      <JsonBlock value={result} maxHeight="max-h-48" />
    </div>
  )
}
