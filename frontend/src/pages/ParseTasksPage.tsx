import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  ArrowLeft,
  Ban,
  ClipboardList,
  Cpu,
  Hash,
  ListChecks,
  RefreshCw,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatCount, formatDateTime, formatDuration } from '../features/format'
import { isActiveTaskStatus, taskStatusLabel, taskStatusTone } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { ParseTaskView } from '../types/api'

const POLL_MS = 1500

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export default function ParseTasksPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)
  const queryClient = useQueryClient()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const tasksQuery = useQuery({
    queryKey: ['parse-tasks', projectId],
    queryFn: () => api.listTasks(projectId),
    enabled: !!projectId,
  })

  const materialsQuery = useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
    enabled: !!projectId,
  })

  const detailQuery = useQuery({
    queryKey: ['parse-task', selectedTaskId],
    queryFn: () => api.getTask(selectedTaskId ?? ''),
    enabled: !!selectedTaskId,
  })

  const tasks = tasksQuery.data?.items ?? []
  const hasActive = tasks.some((task) => isActiveTaskStatus(task.status))

  // 仅当存在 queued/parsing/extracting 等未终态任务时轮询；全部终态后停止。
  useEffect(() => {
    if (!hasActive) return
    const timer = window.setInterval(() => {
      void tasksQuery.refetch()
      if (selectedTaskId) void queryClient.invalidateQueries({ queryKey: ['parse-task', selectedTaskId] })
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [hasActive, tasksQuery.refetch, selectedTaskId, queryClient])

  const invalidateRelated = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['parse-tasks', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['materials', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['facts', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['facts-summary', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['parse-overview', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['parse-task', selectedTaskId] }),
    ])
  }

  const retryMutation = useMutation({
    mutationFn: (taskId: string) => api.retryTask(taskId),
    onSuccess: async () => {
      setActionError(null)
      await invalidateRelated()
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (taskId: string) => api.cancelTask(taskId),
    onSuccess: async () => {
      setActionError(null)
      await invalidateRelated()
    },
  })

  const materialNames = new Map(
    (materialsQuery.data?.items ?? []).map((material) => [material.material_id, material.filename]),
  )
  const materialName = (task: ParseTaskView) =>
    materialNames.get(task.material_id) ?? task.material_id.slice(0, 12)
  const base = `/projects/${projectId}`
  const selectedTask = detailQuery.data

  function renderActions(task: ParseTaskView): ReactNode {
    const actionClass =
      'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-canvas hover:text-ink disabled:cursor-not-allowed disabled:opacity-50'
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={actionClass}
          onClick={() => {
            setSelectedTaskId(task.task_id)
            setActionError(null)
          }}
        >
          详情
        </button>
        {task.status === 'failed' && (
          <button
            type="button"
            className={`${actionClass} hover:text-accent-dark`}
            disabled={retryMutation.isPending}
            onClick={() => {
              setActionError(null)
              retryMutation.mutate(task.task_id)
            }}
          >
            <RefreshCw size={13} />
            重试
          </button>
        )}
        {task.status === 'queued' && (
          <button
            type="button"
            className={`${actionClass} hover:text-danger`}
            disabled={cancelMutation.isPending}
            onClick={() => {
              setActionError(null)
              cancelMutation.mutate(task.task_id)
            }}
          >
            <Ban size={13} />
            取消
          </button>
        )}
      </div>
    )
  }

  const columns: Column<ParseTaskView>[] = [
    {
      key: 'task_id',
      header: '任务 ID',
      render: (task) => (
        <button
          type="button"
          className="mono text-xs font-medium text-accent-dark hover:underline"
          title={task.task_id}
          onClick={() => {
            setSelectedTaskId(task.task_id)
            setActionError(null)
          }}
        >
          {task.task_id.slice(0, 8)}
        </button>
      ),
    },
    {
      key: 'material',
      header: '材料名',
      render: (task) => (
        <div className="min-w-0 max-w-[200px]">
          <p className="truncate text-ink" title={materialName(task)}>{materialName(task)}</p>
          <Link
            to={`/materials/${task.material_id}`}
            className="text-xs text-accent-dark hover:underline"
          >
            查看材料
          </Link>
        </div>
      ),
    },
    {
      key: 'stage',
      header: '当前阶段',
      render: (task) => (
        <div className="min-w-0 max-w-[180px]">
          <span className="mono text-xs text-ink">{task.stage || '—'}</span>
          {task.stage_message && (
            <p className="truncate text-xs text-ink-subtle" title={task.stage_message}>
              {task.stage_message}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      render: (task) => (
        <StatusBadge tone={taskStatusTone(task.status)}>{taskStatusLabel[task.status] ?? task.status}</StatusBadge>
      ),
    },
    {
      key: 'time',
      header: '开始 / 完成',
      render: (task) => (
        <div className="whitespace-nowrap text-xs text-ink-muted">
          <p className="mono">{formatDateTime(task.started_at)}</p>
          <p className="mono text-ink-subtle">{formatDateTime(task.completed_at)}</p>
        </div>
      ),
    },
    {
      key: 'model',
      header: '模型',
      render: (task) => <span className="mono text-xs text-ink-muted">{task.model || '—'}</span>,
    },
    {
      key: 'calls',
      header: '调用',
      align: 'right',
      render: (task) => <span className="mono text-xs text-ink-muted">{formatCount(task.model_calls)}</span>,
    },
    {
      key: 'tokens',
      header: 'Token',
      align: 'right',
      render: (task) => <span className="mono text-xs text-ink-muted">{formatCount(task.total_tokens)}</span>,
    },
    {
      key: 'duration',
      header: '耗时',
      align: 'right',
      render: (task) => <span className="mono text-xs text-ink-muted">{formatDuration(task.duration_ms)}</span>,
    },
    {
      key: 'error',
      header: '错误码',
      render: (task) =>
        task.error_code ? (
          <span className="mono text-xs text-danger" title={task.error_message ?? ''}>
            {task.error_code}
          </span>
        ) : (
          <span className="text-xs text-ink-subtle">—</span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (task) => renderActions(task),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to={`${base}/materials`} className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-accent-dark">
            <ArrowLeft size={13} />
            返回材料列表
          </Link>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Parse Tasks</p>
          <h2 className="mt-1 text-lg font-semibold">解析任务</h2>
          <p className="mt-1 text-sm text-ink-muted">
            任务状态轮询自 GET /parse-tasks；
            {hasActive ? '存在未完成任务，每 1.5 秒刷新一次。' : '当前全部为终态，已停止轮询。'}
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          <Link to={`${base}/facts`} className="btn-ghost"><ClipboardList size={15} />科研事实</Link>
          <Link to={`${base}/overview`} className="btn-ghost">解析概览</Link>
        </nav>
      </div>

      {actionError && (
        <p className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
          操作失败：{actionError}
        </p>
      )}
      {retryMutation.isError && (
        <p className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
          重试失败：{errorMessage(retryMutation.error, '请重试')}
        </p>
      )}
      {cancelMutation.isError && (
        <p className="rounded-md bg-danger-wash px-3 py-2 text-xs text-danger" role="alert">
          取消失败：{errorMessage(cancelMutation.error, '请重试')}
        </p>
      )}

      {selectedTaskId && (
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <Activity size={17} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">任务详情</h3>
              <span className="mono text-xs text-ink-subtle">{selectedTaskId.slice(0, 12)}</span>
            </div>
            <button
              type="button"
              className="rounded p-1 text-ink-subtle hover:bg-canvas hover:text-ink"
              aria-label="关闭任务详情"
              onClick={() => setSelectedTaskId(null)}
            >
              <X size={16} />
            </button>
          </div>
          {detailQuery.isPending ? (
            <LoadingState compact message="正在读取任务详情…" />
          ) : detailQuery.isError ? (
            <ErrorState
              compact
              message={errorMessage(detailQuery.error, '无法获取任务详情。')}
              code={errorCode(detailQuery.error)}
              onRetry={() => void detailQuery.refetch()}
            />
          ) : selectedTask ? (
            <div className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={taskStatusTone(selectedTask.status)}>
                  {taskStatusLabel[selectedTask.status] ?? selectedTask.status}
                </StatusBadge>
                <span className="mono text-xs text-ink-subtle">阶段：{selectedTask.stage || '—'}</span>
              </div>
              <p className="mt-4 rounded-md bg-canvas px-3 py-2 text-sm text-ink">
                <span className="font-semibold">阶段消息：</span>
                {selectedTask.stage_message || '（后端未提供阶段消息）'}
              </p>
              <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {[
                  ['提示词版本', selectedTask.prompt_version || '—'],
                  ['模型', selectedTask.model || '—'],
                  ['模型调用次数', formatCount(selectedTask.model_calls)],
                  ['总 Token', formatCount(selectedTask.total_tokens)],
                  ['Prompt Token', formatCount(selectedTask.prompt_tokens)],
                  ['Completion Token', formatCount(selectedTask.completion_tokens)],
                  ['耗时', formatDuration(selectedTask.duration_ms)],
                  ['事实数', formatCount(selectedTask.facts_count)],
                  ['开始时间', formatDateTime(selectedTask.started_at)],
                  ['完成时间', formatDateTime(selectedTask.completed_at)],
                  ['错误码', selectedTask.error_code ?? '—'],
                  ['错误信息', selectedTask.error_message ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 border-b border-line-soft py-1.5 last:border-b-0">
                    <dt className="text-xs text-ink-subtle">{label}</dt>
                    <dd className="mono mt-0.5 break-all text-xs text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <ListChecks size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">任务列表</h3>
          </div>
          <div className="flex items-center gap-3">
            {hasActive && (
              <StatusBadge tone="accent"><RefreshCw size={12} />轮询中</StatusBadge>
            )}
            {tasksQuery.data && <StatusBadge tone="neutral">{tasksQuery.data.total} 项</StatusBadge>}
          </div>
        </div>

        {tasksQuery.isPending ? (
          <LoadingState compact message="正在读取解析任务…" />
        ) : tasksQuery.isError ? (
          <ErrorState
            compact
            message={errorMessage(tasksQuery.error, '无法获取解析任务，请确认后端服务已启动。')}
            code={errorCode(tasksQuery.error)}
            onRetry={() => void tasksQuery.refetch()}
          />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Hash}
            title="尚无解析任务"
            description="在材料管理中点击「解析」后，任务会出现在这里。"
            action={
              <Link to={`${base}/materials`} className="btn-primary">
                前往材料管理
              </Link>
            }
          />
        ) : (
          <>
            <div className="hidden lg:block">
              <DataTable columns={columns} data={tasks} rowKey={(task) => task.task_id} />
            </div>
            <ul className="divide-y divide-line-soft lg:hidden">
              {tasks.map((task) => (
                <li key={task.task_id} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="mono text-xs font-medium text-accent-dark hover:underline"
                        onClick={() => setSelectedTaskId(task.task_id)}
                      >
                        {task.task_id.slice(0, 12)}
                      </button>
                      <p className="mt-1 break-all text-sm text-ink">{materialName(task)}</p>
                    </div>
                    <StatusBadge tone={taskStatusTone(task.status)}>
                      {taskStatusLabel[task.status] ?? task.status}
                    </StatusBadge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
                    <span className="mono">阶段 {task.stage || '—'}</span>
                    <span className="mono"><Cpu size={11} className="mr-1 inline" />{task.model || '—'}</span>
                    <span className="mono">{formatCount(task.model_calls)} 次 / {formatCount(task.total_tokens)} Token</span>
                    <span className="mono">{formatDuration(task.duration_ms)}</span>
                    <span className="mono">{formatDateTime(task.started_at)}</span>
                  </div>
                  {task.error_code && <p className="mt-2 text-xs text-danger">{task.error_code} {task.error_message ?? ''}</p>}
                  <div className="mt-3">{renderActions(task)}</div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
