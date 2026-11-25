import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Ban,
  Box,
  Clock3,
  Gauge,
  Pause,
  Play,
  ShieldAlert,
  Terminal,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatBytes, formatConfidence, formatDateTime } from '../../features/format'
import { runStatusLabel, runStatusTone, safeText } from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type {
  ArtifactEntry,
  ComparisonView,
  LogEntry,
  MetricView,
  ReproRunView,
} from '../../types/reproduction'
import { useUIStore } from '../../stores/uiStore'
import '../../styles/wave-a-repro.css'

const POLL_MS = 3000

/** 波形序列名 → 展示名（顺序即图例顺序）。 */
const SERIES_LABEL: Record<string, string> = {
  top1: 'top1 准确率',
  top5: 'top5 准确率',
  loss: '训练损失 loss',
}

const SERIES_TONE: Record<string, string> = {
  top1: 'var(--rc-violet)',
  top5: 'var(--rc-info)',
  loss: 'var(--rc-warning)',
}

/** 波形序列名 → 对照表中的 metric_name（用于取论文基准与容差）。 */
const SERIES_METRIC: Record<string, string> = {
  top1: 'top1_accuracy',
  top5: 'top5_accuracy',
  loss: 'training_loss',
}

type WavePoint = {
  epoch: number
  total: number
  values: Record<string, number>
  logId: string
  createdAt: string
}

/**
 * 从后端真实日志行解析 epoch 序列（GET /reproductions/runs/{run_id}/logs）。
 * 只解析日志里真实出现的 epoch / top1 / top5 / loss 数字，不生成任何数值。
 */
function parseWavePoints(logs: LogEntry[]): WavePoint[] {
  const points: WavePoint[] = []
  logs.forEach((log) => {
    const content = log.content ?? ''
    const epochMatch = /epoch\s+(\d+)\/(\d+)/i.exec(content)
    if (!epochMatch) return
    const values: Record<string, number> = {}
    const top1 = /top1=([\d.eE+-]+)/.exec(content)
    if (top1) values.top1 = Number(top1[1])
    const top5 = /top5=([\d.eE+-]+)/.exec(content)
    if (top5) values.top5 = Number(top5[1])
    const loss = /loss=([\d.eE+-]+)/.exec(content)
    if (loss) values.loss = Number(loss[1])
    if (Object.keys(values).length === 0) return
    points.push({
      epoch: Number(epochMatch[1]),
      total: Number(epochMatch[2]),
      values,
      logId: log.log_id,
      createdAt: log.created_at,
    })
  })
  return points.sort((a, b) => a.epoch - b.epoch)
}

/** 论文基准单位与序列单位对齐：ratio（≤1.5）→ 百分数（×100），仅在量级可判定时换算。 */
function alignToSeries(value: number, unit: string | null, seriesMax: number): number | null {
  if (!Number.isFinite(value)) return null
  const seriesIsPercent = seriesMax > 1.5
  const valueIsRatio = Math.abs(value) <= 1.5
  if (seriesIsPercent && valueIsRatio) {
    // 后端 unit 明确为 ratio 时才允许换算成百分数，避免任何猜测性放大。
    return unit === 'ratio' ? value * 100 : null
  }
  if (seriesIsPercent === valueIsRatio) return value
  return null
}

function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const seconds = ms / 1000
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(2)} h`
  if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`
  return `${seconds.toFixed(2)} s`
}

function InlineError({
  error,
  onRetry,
  label,
}: {
  error: unknown
  onRetry: () => void
  label: string
}) {
  return (
    <ErrorState
      compact
      message={`${label}：${error instanceof Error ? error.message : '读取失败。'}`}
      code={error instanceof ApiError ? error.code : undefined}
      onRetry={onRetry}
    />
  )
}

export default function ReproductionConsolePage() {
  const runId = useParams().runId ?? ''
  const queryClient = useQueryClient()
  const setLastRunId = useUIStore((state) => state.setLastRunId)

  useEffect(() => {
    setLastRunId(runId || null)
  }, [runId, setLastRunId])

  const [polling, setPolling] = useState(true)
  const [activePoint, setActivePoint] = useState<number | null>(null)
  const [activeLogId, setActiveLogId] = useState<string | null>(null)

  const runQuery = useQuery({
    queryKey: ['repro-run', runId],
    queryFn: () => reproductionApi.getRun(runId),
    enabled: !!runId,
    refetchInterval: (query) =>
      polling && (query.state.data as ReproRunView | undefined)?.status === 'running'
        ? POLL_MS
        : false,
  })
  const logsQuery = useQuery({
    queryKey: ['repro-run-logs', runId],
    queryFn: () => reproductionApi.getRunLogs(runId),
    enabled: !!runId,
    refetchInterval:
      polling && (runQuery.data?.status === 'running' || runQuery.data?.status === 'queued')
        ? POLL_MS
        : false,
  })
  const artifactsQuery = useQuery({
    queryKey: ['repro-run-artifacts', runId],
    queryFn: () => reproductionApi.getRunArtifacts(runId),
    enabled: !!runId,
  })
  const metricsQuery = useQuery({
    queryKey: ['repro-run-metrics', runId],
    queryFn: () => reproductionApi.getRunMetrics(runId),
    enabled: !!runId,
    refetchInterval:
      polling && (runQuery.data?.status === 'running' || runQuery.data?.status === 'queued')
        ? POLL_MS
        : false,
  })
  const planQuery = useQuery({
    queryKey: ['repro-plan', runQuery.data?.plan_id ?? 'none'],
    queryFn: () => reproductionApi.getPlan(runQuery.data!.plan_id),
    enabled: !!runQuery.data?.plan_id,
    retry: false,
  })
  useTrackProject(planQuery.data?.project_id)

  // 论文基准：用于波形参考线与偏差判定（真实字段，量级不可对齐时不绘制）
  const projectId = planQuery.data?.project_id
  const comparisonsQuery = useQuery({
    queryKey: ['repro-comparisons', projectId],
    queryFn: () => reproductionApi.listComparisons(projectId as string),
    enabled: !!projectId,
    retry: false,
  })

  const cancelMutation = useMutation({
    mutationFn: () => reproductionApi.cancelRun(runId),
    onSuccess: () => {
      ;['repro-run', 'repro-run-logs', 'repro-runs'].forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: [key] })
      })
    },
  })

  const refreshAll = () => {
    void runQuery.refetch()
    void logsQuery.refetch()
    void metricsQuery.refetch()
    void artifactsQuery.refetch()
  }

  const logs = useMemo(() => logsQuery.data?.items ?? [], [logsQuery.data])
  const points = useMemo(() => parseWavePoints(logs), [logs])

  const seriesKeys = useMemo(() => {
    const seen: string[] = []
    points.forEach((point) => {
      Object.keys(point.values).forEach((key) => {
        if (!seen.includes(key)) seen.push(key)
      })
    })
    return seen.filter((key) => key in SERIES_LABEL)
  }, [points])

  const seriesMax = useMemo(() => {
    let max = 0
    points.forEach((point) => {
      Object.values(point.values).forEach((value) => {
        if (Number.isFinite(value)) max = Math.max(max, value)
      })
    })
    return max
  }, [points])

  /* 论文基准（唯一匹配才采用；不可比 / 缺基准一律不画参考线） */
  const baselines = useMemo(() => {
    const map = new Map<string, { value: number; tolerance: number | null; unit: string | null; verdict: string }>()
    const items: ComparisonView[] = comparisonsQuery.data?.items ?? []
    seriesKeys.forEach((key) => {
      const metricName = SERIES_METRIC[key]
      if (!metricName) return
      const candidates = items.filter(
        (item) => item.metric_name === metricName && item.paper_value != null && item.verdict !== 'not_comparable',
      )
      if (candidates.length !== 1) return
      const candidate = candidates[0]
      const aligned = alignToSeries(candidate.paper_value as number, candidate.unit, seriesMax)
      if (aligned == null) return
      const tolMatch = /(\d*\.?\d+)/.exec(candidate.rule ?? '')
      // 容差与基准同单位换算，避免 ratio 容差与百分数序列直接比较。
      const rawTolerance = tolMatch ? Number(tolMatch[1]) : null
      const tolerance =
        rawTolerance == null ? null : alignToSeries(rawTolerance, candidate.unit, seriesMax)
      map.set(key, { value: aligned, tolerance, unit: candidate.unit, verdict: candidate.verdict })
    })
    return map
  }, [comparisonsQuery.data, seriesKeys, seriesMax])

  if (runQuery.isPending) {
    return <LoadingState message="正在读取运行状态…" hint="正在读取后端运行状态" />
  }
  if (runQuery.isError) {
    return (
      <ErrorState
        message={runQuery.error instanceof Error ? runQuery.error.message : '无法获取运行状态。'}
        code={runQuery.error instanceof ApiError ? runQuery.error.code : undefined}
        onRetry={() => void runQuery.refetch()}
      />
    )
  }
  const run = runQuery.data
  if (!run) return <EmptyState title="运行不存在" description="后端未返回该运行的详情。" />

  const isRunning = run.status === 'running'
  const findings = run.security_check?.findings ?? []
  const planLink = run.plan_id ? `/reproductions/plans/${run.plan_id}` : '#'
  const canCancel = ['pending', 'queued', 'running'].includes(run.status)

  /* 完成度：run.task_ids ∩ plan.tasks[].status（真实字段） */
  const runTaskIds = (run as unknown as { task_ids?: string[] }).task_ids ?? []
  const planTasks = planQuery.data?.tasks ?? []
  const scopedTasks = runTaskIds.length
    ? planTasks.filter((task) => runTaskIds.includes(task.task_id))
    : planTasks
  const doneTasks = scopedTasks.filter((task) => task.status === 'completed').length
  const completion = scopedTasks.length > 0 ? doneTasks / scopedTasks.length : null

  /* 偏差：本次运行指标在对照表中的最大相对偏差（真实 diff_relative） */
  const runMetricNames = new Set((metricsQuery.data?.items ?? []).map((m) => m.metric_name))
  const deviations = (comparisonsQuery.data?.items ?? [])
    .filter((item) => runMetricNames.has(item.metric_name) && item.diff_relative != null)
    .map((item) => Math.abs(item.diff_relative as number))
  const maxDeviation = deviations.length > 0 ? Math.max(...deviations) : null

  const activePointData = activePoint != null ? points[activePoint] : undefined

  return (
    <div className="rc-wa-page">
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">执行控制台</p>
          <h1 className="rc-wa-title">执行控制台</h1>
          <p className="rc-wa-lede">实时日志、指标波形与产物</p>
        </div>
        <div className="rc-wa-head__actions">
          <Link to={planLink} className="btn-ghost">
            查看规划 DAG
          </Link>
          {planQuery.data?.project_id && (
            <Link to={`/projects/${planQuery.data.project_id}/reproduction`} className="btn-ghost">
              返回总览
            </Link>
          )}
        </div>
      </header>

      {/* 顶部 56px 控制条 */}
      <div className="rc-wa-consolebar">
        {isRunning && <span className="rc-wa-pulse-dot" aria-hidden="true" />}
        <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
        <StatusBadge tone={run.execution_enabled ? 'success' : 'danger'}>
          {run.execution_enabled ? '代码执行已启用' : '代码执行已禁用'}
        </StatusBadge>
        <span className="rc-wa-consolebar__id">run_id: {run.run_id}</span>
        <span className="rc-wa-consolebar__id">plan_id: {run.plan_id}</span>

        <span className="rc-wa-consolebar__spacer" />

        <button
          type="button"
          className="btn-ghost"
          aria-pressed={polling}
          onClick={() => setPolling((value) => !value)}
          title={isRunning ? '运行中每 3 秒自动拉取一次后端数据' : '当前运行未处于 running，轮询不会触发'}
        >
          <Icon as={polling ? Pause : Play} size="sm" />
          {polling ? '暂停轮询' : '继续轮询'}
        </button>
        <button type="button" className="btn-ghost" onClick={refreshAll}>
          <Icon name="rotate" size="sm" />
          刷新数据
        </button>
        {canCancel && (
          <button
            type="button"
            className="btn-ghost"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            <Icon as={Ban} size="sm" />
            {cancelMutation.isPending ? '取消中…' : '请求取消运行'}
          </button>
        )}
      </div>

      <div aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        运行状态：{runStatusLabel(run.status)}
      </div>

      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={Clock3} size="sm" tone="accent" />
            运行元信息
          </div>
        </div>
        <div className="rc-wa-panel__body">
          <div className="rc-wa-persp__meta">
            <MetaCell k="开始时间" v={formatDateTime(run.started_at)} />
            <MetaCell k="结束时间" v={formatDateTime(run.finished_at)} />
            <MetaCell k="耗时" v={formatRunDuration(run.duration_ms)} />
            <MetaCell
              k="资源用量"
              v={`${safeText(run.resource_usage?.cpu_seconds ?? '—')}s / ${safeText(run.resource_usage?.memory_mb ?? '—')}MB`}
            />
            <MetaCell k="安全预检" v={run.security_check?.passed ? '通过' : '未通过'} />
            <MetaCell k="环境" v={run.environment_id ?? '—'} />
          </div>

          {run.error_message && (
            <div
              style={{
                marginTop: 'var(--rc-space-4)',
                display: 'flex',
                gap: 'var(--rc-space-3)',
                padding: 'var(--rc-space-3)',
                borderRadius: 'var(--rc-radius-sm)',
                backgroundColor: 'var(--rc-danger-wash)',
              }}
            >
              <Icon as={ShieldAlert} size="sm" tone="danger" />
              <div style={{ minWidth: 0 }}>
                <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
                  后端报告的错误
                </p>
                <p
                  style={{
                    marginTop: 4,
                    fontSize: 'var(--rc-fs-caption)',
                    color: 'var(--rc-text)',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {run.error_message}
                </p>
              </div>
            </div>
          )}

          {cancelMutation.isError && (
            <div
              style={{
                marginTop: 'var(--rc-space-4)',
                padding: 'var(--rc-space-3)',
                borderRadius: 'var(--rc-radius-sm)',
                backgroundColor: 'var(--rc-danger-wash)',
              }}
            >
              <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
                取消请求未成功
              </p>
              <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                {cancelMutation.error instanceof Error ? cancelMutation.error.message : '请求失败。'}
              </p>
              <p className="rc-wa-pick__id" style={{ color: 'var(--rc-danger)' }}>
                错误码：{cancelMutation.error instanceof ApiError ? cancelMutation.error.code : 'UNKNOWN_ERROR'}
              </p>
            </div>
          )}

          {!run.execution_enabled && (
            <div
              style={{
                marginTop: 'var(--rc-space-4)',
                display: 'flex',
                gap: 'var(--rc-space-3)',
                padding: 'var(--rc-space-3)',
                borderRadius: 'var(--rc-radius-sm)',
                backgroundColor: 'var(--rc-danger-wash)',
              }}
            >
              <Icon as={AlertTriangle} size="sm" tone="danger" />
              <div style={{ minWidth: 0 }}>
                <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
                  当前环境不支持安全代码执行，未运行任何代码
                </p>
                <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                  状态：{run.status}
                  {run.security_reason || run.security_check?.reason
                    ? ` · 原因：${run.security_reason || run.security_check?.reason}`
                    : ''}
                </p>
                {findings.length > 0 && (
                  <div style={{ marginTop: 'var(--rc-space-3)', display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
                    {findings.map((finding, index) => (
                      <StatusBadge key={index} tone="warning">
                        {findingText(finding)}
                      </StatusBadge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 中部：左 8 列波形画布 + 右 4 列实时日志 */}
      <div
        className="rc-wa-layout"
        style={{
          display: 'grid',
          gap: 'var(--rc-grid-gutter)',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)',
          alignItems: 'start',
        }}
      >
        <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Gauge} size="sm" tone="accent" />
                指标波形
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--rc-space-3)' }}>
                {seriesKeys.map((key) => (
                  <span
                    key={key}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 'var(--rc-fs-micro)',
                      color: 'var(--rc-text-muted)',
                    }}
                  >
                    <span
                      style={{ width: 10, height: 2, borderRadius: 2, backgroundColor: SERIES_TONE[key] }}
                      aria-hidden="true"
                    />
                    {SERIES_LABEL[key]}
                  </span>
                ))}
                <span className="rc-wa-source">{points.length} 个点</span>
              </div>
            </div>

          {logsQuery.isPending ? (
            <div className="rc-wa-panel__body">
              <LoadingState compact message="正在读取运行日志…" />
            </div>
          ) : logsQuery.isError ? (
            <div className="rc-wa-panel__body">
              <InlineError
                label="日志读取失败"
                error={logsQuery.error}
                onRetry={() => void logsQuery.refetch()}
              />
            </div>
          ) : points.length === 0 ? (
            <div className="rc-wa-panel__body">
              <EmptyState
                compact
                icon={Gauge}
                title="暂无运行数据"
                description="日志中暂无可绘制的指标序列。"
              />
            </div>
          ) : (
            <>
              <div className="rc-wa-wave__scroll">
                <WaveChart
                  points={points}
                  seriesKeys={seriesKeys}
                  baselines={baselines}
                  activePoint={activePoint}
                  onHover={(index) => {
                    setActivePoint(index)
                    setActiveLogId(index != null ? points[index].logId : null)
                  }}
                  onPick={(index) => {
                    setActivePoint(index)
                    setActiveLogId(points[index].logId)
                  }}
                />
              </div>
              <div className="rc-wa-wave__readout">
                <span>
                  当前点 <b>{activePointData ? `epoch ${activePointData.epoch}/${activePointData.total}` : '未选中'}</b>
                </span>
                {activePointData &&
                  seriesKeys.map((key) => (
                    <span key={key}>
                      {SERIES_LABEL[key]} <b>{activePointData.values[key] ?? '—'}</b>
                    </span>
                  ))}
                <span>
                  越界点 <b>{countOutOfRange(points, baselines, seriesKeys)}</b>
                </span>
                <span>
                  数据点 <b>{points.length}</b>
                </span>
              </div>
            </>
          )}
        </section>

        <section className="rc-wa-panel">
          <div className="rc-wa-panel__head">
            <div className="rc-wa-panel__title">
              <Icon as={Terminal} size="sm" tone="accent" />
              实时日志
            </div>
            <span className="rc-wa-source">{logsQuery.data?.total ?? 0} 条</span>
          </div>
          <div className="rc-wa-panel__body rc-wa-panel__body--tight">
            {logsQuery.isPending ? (
              <LoadingState compact message="正在读取日志…" />
            ) : logsQuery.isError ? (
              <InlineError
                label="日志读取失败"
                error={logsQuery.error}
                onRetry={() => void logsQuery.refetch()}
              />
            ) : logs.length === 0 ? (
              <EmptyState compact title="暂无日志" description="后端未返回该运行的日志记录。" />
            ) : (
              <div className="rc-wa-log" role="log" aria-live="polite" aria-label="运行日志">
                {logs.map((log: LogEntry) => {
                  const pointIndex = points.findIndex((point) => point.logId === log.log_id)
                  const linked = activeLogId === log.log_id
                  return (
                    <div
                      key={log.log_id}
                      className={`rc-wa-log__row${linked ? ' is-linked' : ''}`}
                      onMouseEnter={() => {
                        setActiveLogId(log.log_id)
                        if (pointIndex >= 0) setActivePoint(pointIndex)
                      }}
                      onMouseLeave={() => {
                        setActiveLogId(null)
                        setActivePoint(null)
                      }}
                    >
                      <span className="rc-wa-log__time">{log.created_at.slice(11, 19)}</span>
                      <span
                        className={`rc-wa-log__stream${log.stream === 'stderr' ? ' rc-wa-log__stream--stderr' : ''}`}
                      >
                        {log.stream}
                      </span>
                      <span className="rc-wa-log__text">{log.content}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* 底部 3 张指标卡 */}
      <section className="rc-wa-gauges">
        <article className="rc-wa-gauge">
          <span className="rc-wa-kpi__label">耗时</span>
          <span className="rc-wa-gauge__value">{formatRunDuration(run.duration_ms)}</span>
          <span className="rc-wa-gauge__hint">
            开始 {formatDateTime(run.started_at)} · 结束 {formatDateTime(run.finished_at)}
          </span>
        </article>

        <article className="rc-wa-gauge">
          <span className="rc-wa-kpi__label">完成度</span>
          <span className="rc-wa-gauge__value">
            {completion == null ? '数据不足' : `${Math.round(completion * 100)}%`}
          </span>
          <div className="rc-wa-meter">
            <div
              className="rc-wa-meter__fill"
              data-tone={completion == null ? 'accent' : completion >= 1 ? 'accent' : 'warning'}
              style={{ transform: `scaleX(${completion ?? 0})` }}
            />
          </div>
          <span className="rc-wa-gauge__hint">
            {scopedTasks.length > 0
              ? `已完成 ${doneTasks} / ${scopedTasks.length} 项任务`
              : '暂无关联任务'}
          </span>
        </article>

        <article className="rc-wa-gauge">
          <span className="rc-wa-kpi__label">最大相对偏差</span>
          <span className="rc-wa-gauge__value">
            {maxDeviation == null ? '数据不足' : `${(maxDeviation * 100).toFixed(2)}%`}
          </span>
          <span className="rc-wa-gauge__hint">
            {maxDeviation == null
              ? '暂无匹配指标偏差'
              : '匹配指标的最大相对偏差'}
          </span>
        </article>
      </section>

      {/* 指标明细 + 产物 */}
      <div
        style={{
          display: 'grid',
          gap: 'var(--rc-grid-gutter)',
          gridTemplateColumns: 'minmax(0, 1fr)',
        }}
      >
        <div
          className="rc-wa-layout"
          style={{
            display: 'grid',
            gap: 'var(--rc-grid-gutter)',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            alignItems: 'start',
          }}
        >
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Gauge} size="sm" tone="accent" />
                运行指标
              </div>
              <span className="rc-wa-source">{metricsQuery.data?.total ?? 0} 项</span>
            </div>
            <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
              {metricsQuery.isPending ? (
                <div className="rc-wa-panel__body">
                  <LoadingState compact message="正在读取指标…" />
                </div>
              ) : metricsQuery.isError ? (
                <div className="rc-wa-panel__body">
                  <InlineError
                    label="指标读取失败"
                    error={metricsQuery.error}
                    onRetry={() => void metricsQuery.refetch()}
                  />
                </div>
              ) : (
                <DataTable<MetricView>
                  columns={[
                    {
                      key: 'name',
                      header: '指标',
                      render: (m) => <span style={{ fontWeight: 'var(--rc-fw-sb)' }}>{m.metric_name}</span>,
                    },
                    {
                      key: 'value',
                      header: '数值',
                      render: (m) => (
                        <span className="mono">
                          {safeText(m.metric_value)}
                          {m.unit ? ` ${m.unit}` : ''}
                        </span>
                      ),
                    },
                    {
                      key: 'source',
                      header: '来源',
                      render: (m) => (
                        <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                          {m.source || '—'}
                        </span>
                      ),
                    },
                    {
                      key: 'confidence',
                      header: '置信度',
                      render: (m) => <span className="mono">{formatConfidence(m.confidence)}</span>,
                    },
                    {
                      key: 'review',
                      header: '复核',
                      render: (m) =>
                        m.needs_manual_review ? (
                          <StatusBadge tone="warning">需人工</StatusBadge>
                        ) : (
                          <span className="rc-wa-pick__id">—</span>
                        ),
                    },
                  ]}
                  data={metricsQuery.data?.items ?? []}
                  rowKey={(m) => `${m.metric_name}-${m.created_at ?? ''}`}
                  empty={
                    <div style={{ padding: 'var(--rc-space-5)' }}>
                      <EmptyState compact title="暂无指标" description="后端未返回该运行的指标。" />
                    </div>
                  }
                />
              )}
            </div>
          </section>

          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Box} size="sm" tone="accent" />
                运行产物
              </div>
              <span className="rc-wa-source">{artifactsQuery.data?.total ?? 0} 项</span>
            </div>
            <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
              {artifactsQuery.isPending ? (
                <div className="rc-wa-panel__body">
                  <LoadingState compact message="正在读取产物…" />
                </div>
              ) : artifactsQuery.isError ? (
                <div className="rc-wa-panel__body">
                  <InlineError
                    label="产物读取失败"
                    error={artifactsQuery.error}
                    onRetry={() => void artifactsQuery.refetch()}
                  />
                </div>
              ) : (
                <DataTable<ArtifactEntry>
                  columns={[
                    {
                      key: 'name',
                      header: '名称',
                      render: (a) => <span style={{ fontWeight: 'var(--rc-fw-sb)' }}>{a.name}</span>,
                    },
                    {
                      key: 'path',
                      header: '路径',
                      render: (a) => (
                        <span className="mono rc-wa-pick__id" style={{ overflowWrap: 'anywhere' }}>
                          {a.path ?? '—'}
                        </span>
                      ),
                    },
                    {
                      key: 'size',
                      header: '大小',
                      align: 'right',
                      render: (a) => <span className="mono">{formatBytes(a.size_bytes)}</span>,
                    },
                    {
                      key: 'hash',
                      header: '哈希',
                      render: (a) => (
                        <span className="mono rc-wa-pick__id" style={{ overflowWrap: 'anywhere' }}>
                          {a.hash ?? '—'}
                        </span>
                      ),
                    },
                  ]}
                  data={artifactsQuery.data?.items ?? []}
                  rowKey={(a) => a.artifact_id}
                  empty={
                    <div style={{ padding: 'var(--rc-space-5)' }}>
                      <EmptyState compact title="暂无产物" description="后端未返回该运行的产物清单。" />
                    </div>
                  }
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function MetaCell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="rc-wa-meta__k">{k}</p>
      <p className="rc-wa-meta__v">{v}</p>
    </div>
  )
}

function findingText(finding: Record<string, unknown>): string {
  const severity = finding.severity ? `[${safeText(finding.severity)}] ` : ''
  const detail = finding.message ?? finding.description ?? finding.reason ?? finding
  return `${severity}${safeText(detail)}`
}

function countOutOfRange(
  points: WavePoint[],
  baselines: Map<string, { value: number; tolerance: number | null }>,
  seriesKeys: string[],
): number {
  let count = 0
  points.forEach((point) => {
    seriesKeys.forEach((key) => {
      const baseline = baselines.get(key)
      const value = point.values[key]
      if (!baseline || baseline.tolerance == null || value == null) return
      if (Math.abs(value - baseline.value) > baseline.tolerance) count += 1
    })
  })
  return count
}

/**
 * 波形图：细网格 + 十字准星 + 时间戳刻度。
 * 曲线只由真实日志解析出的点序列绘制；参考线只在论文基准可与序列量级对齐时绘制。
 */
function WaveChart({
  points,
  seriesKeys,
  baselines,
  activePoint,
  onHover,
  onPick,
}: {
  points: WavePoint[]
  seriesKeys: string[]
  baselines: Map<string, { value: number; tolerance: number | null; unit: string | null; verdict: string }>
  activePoint: number | null
  onHover: (index: number | null) => void
  onPick: (index: number) => void
}) {
  const W = 640
  const H = 260
  const PAD_L = 48
  const PAD_R = 20
  const PAD_T = 18
  const PAD_B = 34

  const svgRef = useRef<SVGSVGElement | null>(null)

  const epochs = points.map((p) => p.epoch)
  const maxEpoch = Math.max(...epochs, 1)
  const totalEpoch = points[0]?.total || maxEpoch

  const values = points.flatMap((p) => seriesKeys.map((k) => p.values[k]).filter((v): v is number => v != null))
  let minValue = values.length ? Math.min(...values) : 0
  let maxValue = values.length ? Math.max(...values) : 1
  const baselineValues = [...baselines.values()].map((b) => b.value)
  if (baselineValues.length) {
    minValue = Math.min(minValue, ...baselineValues)
    maxValue = Math.max(maxValue, ...baselineValues)
  }
  if (maxValue - minValue < 1e-6) {
    maxValue = minValue + 1
  }
  const pad = (maxValue - minValue) * 0.12
  minValue -= pad
  maxValue += pad

  const xOf = (epoch: number) => PAD_L + (epoch / Math.max(1, totalEpoch)) * (W - PAD_L - PAD_R)
  const yOf = (value: number) =>
    PAD_T + (1 - (value - minValue) / (maxValue - minValue)) * (H - PAD_T - PAD_B)

  const gridLines = 4
  const gridValues = Array.from({ length: gridLines + 1 }, (_, i) => minValue + ((maxValue - minValue) * i) / gridLines)
  const xTicks = points.filter((_, index) => index % Math.ceil(points.length / 6 || 1) === 0)

  const handleMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    if (rect.width === 0) return
    const ratio = W / rect.width
    const x = (event.clientX - rect.left) * ratio
    let nearest = -1
    let best = Infinity
    points.forEach((point, index) => {
      const distance = Math.abs(xOf(point.epoch) - x)
      if (distance < best) {
        best = distance
        nearest = index
      }
    })
    if (nearest >= 0) onHover(nearest)
  }

  return (
    <svg
      ref={svgRef}
      className="rc-wa-wave"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={
        points.length
          ? `指标波形：${points.length} 个真实数据点，来自运行日志中的 epoch 记录`
          : '指标波形：暂无数据'
      }
      onMouseMove={handleMove}
      onMouseLeave={() => onHover(null)}
    >
      {gridValues.map((value, index) => (
        <g key={`g-${index}`}>
          <line
            className="rc-wa-wave__grid"
            x1={PAD_L}
            x2={W - PAD_R}
            y1={yOf(value)}
            y2={yOf(value)}
          />
          <text className="rc-wa-wave__tick" x={PAD_L - 6} y={yOf(value) + 3} textAnchor="end">
            {value.toFixed(2)}
          </text>
        </g>
      ))}

      {xTicks.map((point) => (
        <text
          key={`x-${point.epoch}`}
          className="rc-wa-wave__tick"
          x={xOf(point.epoch)}
          y={H - PAD_B + 16}
          textAnchor="middle"
        >
          e{point.epoch}
        </text>
      ))}

      <line className="rc-wa-wave__axis" x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} />
      <line className="rc-wa-wave__axis" x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} />

      {/* 论文基准参考线（仅在量级可对齐时绘制） */}
      {seriesKeys.map((key) => {
        const baseline = baselines.get(key)
        if (!baseline) return null
        return (
          <g key={`ref-${key}`}>
            <line
              className="rc-wa-wave__ref"
              x1={PAD_L}
              x2={W - PAD_R}
              y1={yOf(baseline.value)}
              y2={yOf(baseline.value)}
            />
            <text
              className="rc-wa-wave__tick"
              x={W - PAD_R}
              y={yOf(baseline.value) - 4}
              textAnchor="end"
            >
              论文基准 {baseline.value.toFixed(2)}
              {baseline.unit === 'ratio' ? '（×100 换算）' : ''}
            </text>
          </g>
        )
      })}

      {/* 曲线段：越界段（|值 − 基准| > 容差）用 --rc-danger */}
      {seriesKeys.map((key) => {
        const baseline = baselines.get(key)
        const segments: React.ReactElement[] = []
        for (let i = 1; i < points.length; i += 1) {
          const previous = points[i - 1]
          const current = points[i]
          const from = previous.values[key]
          const to = current.values[key]
          if (from == null || to == null) continue
          const out =
            baseline && baseline.tolerance != null
              ? Math.abs(to - baseline.value) > baseline.tolerance
              : false
          segments.push(
            <line
              key={`${key}-seg-${i}`}
              x1={xOf(previous.epoch)}
              y1={yOf(from)}
              x2={xOf(current.epoch)}
              y2={yOf(to)}
              style={{
                stroke: out ? 'var(--rc-danger)' : SERIES_TONE[key],
                strokeWidth: 1.75,
                strokeLinecap: 'round',
              }}
            />,
          )
        }
        return segments
      })}

      {seriesKeys.map((key, seriesIndex) =>
        points.map((point, index) => {
          const value = point.values[key]
          if (value == null) return null
          const baseline = baselines.get(key)
          const out =
            baseline && baseline.tolerance != null
              ? Math.abs(value - baseline.value) > baseline.tolerance
              : false
          const isActive = activePoint === index
          return (
            <circle
              key={`${key}-${point.epoch}-${index}`}
              className={[
                'rc-wa-wave__pt',
                seriesIndex > 0 ? 'rc-wa-wave__pt--alt' : '',
                isActive ? 'is-active' : '',
                index === points.length - 1 ? 'is-new' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              cx={xOf(point.epoch)}
              cy={yOf(value)}
              r={isActive ? 5 : 3.5}
              style={out ? { fill: 'var(--rc-danger)' } : undefined}
              onMouseEnter={() => onHover(index)}
              onClick={() => onPick(index)}
            >
              <title>{`epoch ${point.epoch}/${point.total} · ${SERIES_LABEL[key]} = ${value}`}</title>
            </circle>
          )
        }),
      )}

      {activePoint != null && points[activePoint] && (
        <g>
          <line
            className="rc-wa-wave__cross"
            x1={xOf(points[activePoint].epoch)}
            x2={xOf(points[activePoint].epoch)}
            y1={PAD_T}
            y2={H - PAD_B}
          />
          <text
            className="rc-wa-wave__tick"
            x={xOf(points[activePoint].epoch)}
            y={PAD_T - 4}
            textAnchor="middle"
          >
            {points[activePoint].createdAt.slice(11, 19)}
          </text>
        </g>
      )}
    </svg>
  )
}
