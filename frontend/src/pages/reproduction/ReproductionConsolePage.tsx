import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Ban,
  Box,
  Clock3,
  FileCode2,
  Gauge,
  ShieldAlert,
  Terminal,
} from 'lucide-react'
import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import {
  formatBytes,
  formatConfidence,
  formatDateTime,
  formatDuration,
} from '../../features/format'
import { runStatusLabel, runStatusTone, safeText } from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type {
  ArtifactEntry,
  LogEntry,
  MetricView,
  ReproRunView,
} from '../../types/reproduction'
import { useUIStore } from '../../stores/uiStore'

const POLL_MS = 3000

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

function MiniStat({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Clock3 }) {
  return (
    <div className="rounded-lg border border-line-soft bg-canvas/60 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
        <Icon size={13} className="text-accent-dark" />
        {label}
      </div>
      <p className="mono mt-1.5 text-sm font-semibold text-ink">{value}</p>
    </div>
  )
}

function findingText(finding: Record<string, unknown>): string {
  const severity = finding.severity ? `[${safeText(finding.severity)}] ` : ''
  const detail = finding.message ?? finding.description ?? finding.reason ?? finding
  return `${severity}${safeText(detail)}`
}

export default function ReproductionConsolePage() {
  const runId = useParams().runId ?? ''
  const queryClient = useQueryClient()
  const setLastRunId = useUIStore((state) => state.setLastRunId)

  useEffect(() => {
    setLastRunId(runId || null)
  }, [runId, setLastRunId])

  const runQuery = useQuery({
    queryKey: ['repro-run', runId],
    queryFn: () => reproductionApi.getRun(runId),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data as ReproRunView | undefined)?.status === 'running' ? POLL_MS : false,
  })
  const logsQuery = useQuery({
    queryKey: ['repro-run-logs', runId],
    queryFn: () => reproductionApi.getRunLogs(runId),
    enabled: !!runId,
    refetchInterval: runQuery.data?.status === 'running' ? POLL_MS : false,
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
  })
  const planQuery = useQuery({
    queryKey: ['repro-plan', runQuery.data?.plan_id ?? 'none'],
    queryFn: () => reproductionApi.getPlan(runQuery.data!.plan_id),
    enabled: !!runQuery.data?.plan_id,
    retry: false,
  })
  useTrackProject(planQuery.data?.project_id)

  const cancelMutation = useMutation({
    mutationFn: () => reproductionApi.cancelRun(runId),
    onSuccess: () => {
      ;['repro-run', 'repro-run-logs', 'repro-runs'].forEach((key) => {
        void queryClient.invalidateQueries({ queryKey: [key] })
      })
    },
  })

  if (runQuery.isPending) {
    return <LoadingState message="正在读取运行状态…" hint="GET /reproductions/runs/{run_id}" />
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Execution Console</p>
          <h2 className="mt-1 text-lg font-semibold">执行控制台</h2>
          <p className="mt-1 text-sm text-ink-muted">
            日志、产物、指标与状态全部来自后端真实接口；{isRunning ? '运行中执行真实轮询。' : '当前不推进任何前端伪造进度。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={planLink} className="btn-ghost">查看规划 DAG</Link>
          {planQuery.data?.project_id && (
            <Link to={`/projects/${planQuery.data.project_id}/reproduction`} className="btn-ghost">返回总览</Link>
          )}
          {canCancel && (
            <button
              type="button"
              className="btn-ghost"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
            >
              <Ban size={15} />{cancelMutation.isPending ? '取消中…' : '请求取消运行'}
            </button>
          )}
        </div>
      </div>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
          <StatusBadge tone={run.execution_enabled ? 'success' : 'danger'}>
            {run.execution_enabled ? '代码执行已启用' : '代码执行已禁用'}
          </StatusBadge>
          <StatusBadge tone="neutral" dot={false}>安全预检 {run.security_check?.passed ? '通过' : '未通过'}</StatusBadge>
          <span className="mono text-[11px] text-ink-subtle">run_id: {run.run_id}</span>
          <span className="mono text-[11px] text-ink-subtle">plan_id: {run.plan_id}</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniStat label="开始时间" value={formatDateTime(run.started_at)} icon={Clock3} />
          <MiniStat label="结束时间" value={formatDateTime(run.finished_at)} icon={Clock3} />
          <MiniStat label="耗时" value={formatDuration(run.duration_ms)} icon={Gauge} />
          <MiniStat
            label="资源用量"
            value={`${safeText(run.resource_usage?.cpu_seconds ?? '—')}s / ${safeText(run.resource_usage?.memory_mb ?? '—')}MB`}
            icon={Gauge}
          />
        </div>

        {run.error_message && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-danger/30 bg-danger-wash p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-danger">后端报告的错误</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink">{run.error_message}</p>
            </div>
          </div>
        )}

        {cancelMutation.isError && (
          <div className="mt-4 rounded-md border border-danger/30 bg-danger-wash p-3 text-sm">
            <p className="font-semibold text-danger">取消请求未成功</p>
            <p className="mt-1 text-ink-muted">
              {cancelMutation.error instanceof Error ? cancelMutation.error.message : '请求失败。'}
            </p>
            <p className="mono mt-1 text-[11px] text-danger">
              错误码：{cancelMutation.error instanceof ApiError ? cancelMutation.error.code : 'UNKNOWN_ERROR'}
            </p>
          </div>
        )}
      </section>

      {!run.execution_enabled && (
        <div className="panel border-danger/30 bg-danger-wash p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-danger">
                当前环境不支持安全代码执行，未运行任何代码
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                execution_enabled=false。状态 {run.status} 由后端返回，不是伪造的成功结果。
                {run.security_reason || run.security_check?.reason
                  ? ` 原因：${run.security_reason || run.security_check?.reason}`
                  : ''}
              </p>
              {findings.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {findings.map((finding, index) => (
                    <StatusBadge key={index} tone="warning">{findingText(finding)}</StatusBadge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Terminal size={17} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">执行日志</h3>
            </div>
            <StatusBadge tone="neutral" dot={false}>
              GET .../logs · {logsQuery.data?.total ?? 0}
            </StatusBadge>
          </div>
          <div className="p-4">
            {logsQuery.isPending ? (
              <LoadingState compact message="正在读取日志…" />
            ) : logsQuery.isError ? (
              <InlineError
                label="日志读取失败"
                error={logsQuery.error}
                onRetry={() => void logsQuery.refetch()}
              />
            ) : (logsQuery.data?.items ?? []).length === 0 ? (
              <EmptyState compact title="暂无日志" description="后端未返回该运行的日志记录。" />
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-auto rounded-md border border-line bg-navy-950 p-3">
                {(logsQuery.data?.items ?? []).map((log: LogEntry) => (
                  <div key={log.log_id} className="flex gap-2 font-mono text-[11px] leading-relaxed">
                    <span
                      className={`shrink-0 rounded px-1 ${
                        log.stream === 'stderr' ? 'bg-danger/20 text-danger' : 'bg-success/20 text-success'
                      }`}
                    >
                      {log.stream}
                    </span>
                    <span className={`whitespace-pre-wrap break-all ${log.stream === 'stderr' ? 'text-red-300' : 'text-slate-200'}`}>
                      {log.content}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <FileCode2 size={17} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">运行指标</h3>
            </div>
            <StatusBadge tone="neutral" dot={false}>
              GET .../metrics · {metricsQuery.data?.total ?? 0}
            </StatusBadge>
          </div>
          <div className="p-4">
            {metricsQuery.isPending ? (
              <LoadingState compact message="正在读取指标…" />
            ) : metricsQuery.isError ? (
              <InlineError
                label="指标读取失败"
                error={metricsQuery.error}
                onRetry={() => void metricsQuery.refetch()}
              />
            ) : (
              <DataTable<MetricView>
                columns={[
                  { key: 'name', header: '指标', render: (m) => <span className="font-medium">{m.metric_name}</span> },
                  {
                    key: 'value',
                    header: '数值',
                    render: (m) => <span className="mono text-xs">{safeText(m.metric_value)}{m.unit ? ` ${m.unit}` : ''}</span>,
                  },
                  { key: 'source', header: '来源', render: (m) => <span className="text-xs text-ink-muted">{m.source || '—'}</span> },
                  {
                    key: 'confidence',
                    header: '置信度',
                    render: (m) => <span className="mono text-xs">{formatConfidence(m.confidence)}</span>,
                  },
                  {
                    key: 'review',
                    header: '复核',
                    render: (m) =>
                      m.needs_manual_review ? <StatusBadge tone="warning">需人工</StatusBadge> : <span className="text-xs text-ink-subtle">—</span>,
                  },
                ]}
                data={metricsQuery.data?.items ?? []}
                rowKey={(m) => `${m.metric_name}-${m.created_at ?? ''}`}
                empty={<EmptyState compact title="暂无指标" description="后端未返回该运行的指标。" />}
              />
            )}
          </div>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Box size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">运行产物</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}>
            GET .../artifacts · {artifactsQuery.data?.total ?? 0}
          </StatusBadge>
        </div>
        <div className="p-4">
          {artifactsQuery.isPending ? (
            <LoadingState compact message="正在读取产物…" />
          ) : artifactsQuery.isError ? (
            <InlineError
              label="产物读取失败"
              error={artifactsQuery.error}
              onRetry={() => void artifactsQuery.refetch()}
            />
          ) : (
            <DataTable<ArtifactEntry>
              columns={[
                { key: 'name', header: '名称', render: (a) => <span className="font-medium">{a.name}</span> },
                { key: 'path', header: '路径', render: (a) => <span className="mono break-all text-[11px] text-ink-muted">{a.path ?? '—'}</span> },
                { key: 'size', header: '大小', align: 'right', render: (a) => <span className="mono text-xs">{formatBytes(a.size_bytes)}</span> },
                { key: 'hash', header: '哈希', render: (a) => <span className="mono text-[11px] text-ink-subtle">{a.hash ?? '—'}</span> },
                { key: 'created', header: '创建时间', render: (a) => <span className="text-xs text-ink-muted">{formatDateTime(a.created_at)}</span> },
              ]}
              data={artifactsQuery.data?.items ?? []}
              rowKey={(a) => a.artifact_id}
              empty={<EmptyState compact title="暂无产物" description="后端未返回该运行的产物清单。" />}
            />
          )}
        </div>
      </section>
    </div>
  )
}
