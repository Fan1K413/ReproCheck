import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Ban, Cpu, Hash, Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { formatCount, formatDateTime, formatDuration } from '../features/format'
import { isActiveTaskStatus, taskStatusLabel, taskStatusTone } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { ParseTaskView, TaskStatus } from '../types/api'
import '../styles/wave-b-material.css'

const POLL_MS = 1500

/** 后端阶段取值序列（真实 stage 字段与之一致时才高亮对应步进） */
const STAGE_STEPS: { key: string; label: string }[] = [
  { key: 'uploaded', label: '已上传' },
  { key: 'queued', label: '排队' },
  { key: 'parsing', label: '解析' },
  { key: 'extracting', label: '抽取' },
  { key: 'completed', label: '完成' },
]

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
  const [actionNotice, setActionNotice] = useState<string | null>(null)

  /** 后端 pause 会把 status 写成 paused；本地状态联合尚未收录该值，按字符串兼容展示。 */
  const isPaused = (status: TaskStatus) => (status as string) === 'paused'
  const statusLabel = (status: TaskStatus) =>
    isPaused(status) ? '已暂停' : taskStatusLabel[status] ?? status
  const statusTone = (status: TaskStatus): Tone =>
    isPaused(status) ? 'warning' : taskStatusTone(status)

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

  const tasks = useMemo(() => tasksQuery.data?.items ?? [], [tasksQuery.data])
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

  const pauseMutation = useMutation({
    mutationFn: (taskId: string) => api.pauseTask(taskId),
    onSuccess: async (task) => {
      setActionError(null)
      setActionNotice(`任务 ${task.task_id.slice(0, 8)} 已暂停`)
      await invalidateRelated()
    },
  })

  const resumeMutation = useMutation({
    mutationFn: (taskId: string) => api.resumeTask(taskId),
    onSuccess: async (task) => {
      setActionError(null)
      setActionNotice(`任务 ${task.task_id.slice(0, 8)} 已恢复，等待重新执行`)
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

  /** 真实状态计数（后端返回的任务集合聚合，不额外请求） */
  const tally = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of tasks) {
      const key = task.status as string
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [tasks])

  /** 阶段流水轨：按真实开始时间排序的任务序列 */
  const railTasks = useMemo(
    () =>
      [...tasks].sort(
        (a, b) =>
          new Date(a.started_at ?? a.completed_at ?? 0).getTime() -
          new Date(b.started_at ?? b.completed_at ?? 0).getTime(),
      ),
    [tasks],
  )

  function renderActions(task: ParseTaskView): ReactNode {
    const actionClass =
      'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-ink-muted transition-colors hover:bg-accent-wash hover:text-accent-soft disabled:cursor-not-allowed disabled:opacity-50'
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
            className={actionClass}
            disabled={retryMutation.isPending}
            onClick={() => {
              setActionError(null)
              retryMutation.mutate(task.task_id)
            }}
          >
            <Icon name="rotate" size="xs" />
            重试
          </button>
        )}
        {task.status === 'queued' && (
          <button
            type="button"
            className={`${actionClass} hover:bg-danger-wash hover:text-danger`}
            disabled={cancelMutation.isPending}
            onClick={() => {
              setActionError(null)
              setActionNotice(null)
              cancelMutation.mutate(task.task_id)
            }}
          >
            <Icon as={Ban} size="xs" />
            取消
          </button>
        )}
        {isActiveTaskStatus(task.status) && (
          <button
            type="button"
            className={`${actionClass} hover:bg-accent-wash hover:text-warning`}
            disabled={pauseMutation.isPending || resumeMutation.isPending}
            onClick={() => {
              setActionError(null)
              setActionNotice(null)
              pauseMutation.mutate(task.task_id)
            }}
          >
            {pauseMutation.isPending ? (
              <Icon name="rotate" size="xs" className="animate-spin" />
            ) : (
              <Icon as={Pause} size="xs" />
            )}
            暂停
          </button>
        )}
        {isPaused(task.status) && (
          <button
            type="button"
            className={actionClass}
            disabled={pauseMutation.isPending || resumeMutation.isPending}
            onClick={() => {
              setActionError(null)
              setActionNotice(null)
              resumeMutation.mutate(task.task_id)
            }}
          >
            {resumeMutation.isPending ? (
              <Icon name="rotate" size="xs" className="animate-spin" />
            ) : (
              <Icon as={Play} size="xs" />
            )}
            继续
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
          className="mb-task-link mb-mono text-xs font-medium text-accent-soft hover:underline"
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
          <p className="truncate" title={materialName(task)}>
            {materialName(task)}
          </p>
          <Link to={`/materials/${task.material_id}`} className="text-xs text-accent-soft hover:underline">
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
          <span className="mb-mono text-xs">{task.stage || '—'}</span>
          {task.stage_message && (
            <p className="truncate text-xs" style={{ color: 'var(--rc-text-subtle)' }} title={task.stage_message}>
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
        <StatusBadge tone={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge>
      ),
    },
    {
      key: 'time',
      header: '开始 / 完成',
      render: (task) => (
        <div className="whitespace-nowrap text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          <p className="mb-mono">{formatDateTime(task.started_at)}</p>
          <p className="mb-mono" style={{ color: 'var(--rc-text-subtle)' }}>
            {formatDateTime(task.completed_at)}
          </p>
        </div>
      ),
    },
    {
      key: 'model',
      header: '模型',
      render: (task) => (
        <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          {task.model || '—'}
        </span>
      ),
    },
    {
      key: 'calls',
      header: '调用',
      align: 'right',
      render: (task) => (
        <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          {formatCount(task.model_calls)}
        </span>
      ),
    },
    {
      key: 'tokens',
      header: 'Token',
      align: 'right',
      render: (task) => (
        <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          {formatCount(task.total_tokens)}
        </span>
      ),
    },
    {
      key: 'duration',
      header: '耗时',
      align: 'right',
      render: (task) => (
        <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          {formatDuration(task.duration_ms)}
        </span>
      ),
    },
    {
      key: 'error',
      header: '错误码',
      render: (task) =>
        task.error_code ? (
          <span className="mb-mono text-xs" style={{ color: 'var(--rc-danger)' }} title={task.error_message ?? ''}>
            {task.error_code}
          </span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
            —
          </span>
        ),
    },
    {
      key: 'actions',
      header: '操作',
      render: (task) => renderActions(task),
    },
  ]

  const selectedStageIndex = selectedTask
    ? STAGE_STEPS.findIndex((step) => step.key === selectedTask.stage)
    : -1

  return (
    <div className="mb-page">
      <header className="mb-head">
        <div className="min-w-0">
          <Link to={`${base}/materials`} className="mb-back">
            <Icon name="arrowLeft" size="xs" />
            返回材料列表
          </Link>
          <p className="mb-head__eyebrow mt-3">自动处理 · 任务流水轨</p>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="mb-head__title">自动处理任务</h1>
            {hasActive && (
              <StatusBadge tone="accent" dot={false}>
                <span className="rc-live-dot" aria-hidden="true" />
                自动刷新
              </StatusBadge>
            )}
          </div>
          <p className="mb-head__desc">解析队列与执行状态</p>
        </div>
        <nav className="mb-head__actions">
          <Link to={`${base}/facts`} className="btn-ghost">
            <Icon name="clipboardCheck" size="sm" />
            科研事实
          </Link>
          <Link to={`${base}/overview`} className="btn-ghost">
            <Icon name="grid" size="sm" />
            解析概览
          </Link>
        </nav>
      </header>

      {actionNotice && (
        <p
          className="rounded-md px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--rc-success-wash)', color: 'var(--rc-success)' }}
          role="status"
        >
          {actionNotice}
        </p>
      )}
      {actionError && (
        <p
          className="rounded-md px-3 py-2 text-xs"
          style={{ backgroundColor: 'var(--rc-danger-wash)', color: 'var(--rc-danger)' }}
          role="alert"
        >
          操作失败：{actionError}
        </p>
      )}
      {retryMutation.isError && (
        <p className="text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
          重试失败：{errorMessage(retryMutation.error, '请重试')}
        </p>
      )}
      {cancelMutation.isError && (
        <p className="text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
          取消失败：{errorMessage(cancelMutation.error, '请重试')}
        </p>
      )}
      {pauseMutation.isError && (
        <p className="text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
          暂停失败：{errorMessage(pauseMutation.error, '请重试')}
        </p>
      )}
      {resumeMutation.isError && (
        <p className="text-xs" style={{ color: 'var(--rc-danger)' }} role="alert">
          恢复失败：{errorMessage(resumeMutation.error, '请重试')}
        </p>
      )}

      {tasksQuery.isPending ? (
        <section className="mb-panel" aria-label="任务加载中">
          <LoadingState compact message="正在读取解析任务…" />
        </section>
      ) : tasksQuery.isError ? (
        <section className="mb-panel" aria-label="任务加载失败">
          <ErrorState
            compact
            message={errorMessage(tasksQuery.error, '无法获取解析任务，请确认后端服务已启动。')}
            code={errorCode(tasksQuery.error)}
            onRetry={() => void tasksQuery.refetch()}
          />
        </section>
      ) : tasks.length === 0 ? (
        <section className="mb-panel" aria-label="解析任务为空">
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
        </section>
      ) : (
        <>
          {/* 状态计数（真实任务集合聚合） */}
          <div className="mb-tally" role="group" aria-label="任务状态计数">
            {tally.map(([status, count]) => (
              <span key={status} className="mb-tally__item">
                <StatusBadge tone={statusTone(status as TaskStatus)} dot={false}>
                  {statusLabel(status as TaskStatus)}
                </StatusBadge>
                <span className="mb-tally__n">{count}</span>
              </span>
            ))}
            <span className="mb-tally__item">
              <Icon name="listTree" size="xs" tone="muted" />
              合计
              <span className="mb-tally__n">{tasks.length}</span>
            </span>
          </div>

          {/* 特色交互：阶段流水轨 —— 点击节点查看该任务详情 */}
          <section className="mb-panel" aria-label="任务阶段流水轨">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon as={Activity} size="sm" tone="accent" />
                阶段流水轨
              </h3>
              <span className="mb-panel__hint">点击节点查看详情</span>
            </div>
            <div className="mb-rail" role="tablist" aria-label="解析任务列表">
              {railTasks.map((task) => {
                const active = selectedTaskId === task.task_id
                const running = isActiveTaskStatus(task.status)
                return (
                  <button
                    key={task.task_id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`mb-rail__node ${active ? 'mb-rail__node--on' : ''}`}
                    onClick={() => {
                      setSelectedTaskId(task.task_id)
                      setActionError(null)
                    }}
                  >
                    <span className="mb-rail__id">{task.task_id.slice(0, 8)}</span>
                    <span className="mb-rail__name">{materialName(task)}</span>
                    <span className="mb-rail__stage">
                      阶段 {task.stage || '—'}
                      {task.stage_message ? ` · ${task.stage_message}` : ''}
                    </span>
                    <span className="mb-rail__foot">
                      {running ? <span className="mb-rail__pulse" aria-hidden="true" /> : <span />}
                      <StatusBadge tone={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge>
                    </span>
                    <span className="mb-rail__foot">
                      <span>{formatDateTime(task.started_at)}</span>
                      <span>{formatDuration(task.duration_ms)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 任务详情（L3 展开） */}
          {selectedTaskId && (
            <section className="mb-panel" aria-label="任务详情">
              <div className="mb-panel__head">
                <h3 className="mb-panel__title">
                  <Icon name="file" size="sm" tone="accent" />
                  任务详情
                </h3>
                <div className="flex items-center gap-2">
                  <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                    {selectedTaskId.slice(0, 12)}
                  </span>
                  <button
                    type="button"
                    className="mb-iconbtn"
                    aria-label="关闭任务详情"
                    onClick={() => setSelectedTaskId(null)}
                  >
                    <Icon name="x" size="sm" />
                  </button>
                </div>
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
                <div className="mb-panel__body">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={statusTone(selectedTask.status)}>
                      {statusLabel(selectedTask.status)}
                    </StatusBadge>
                    <span className="mb-mono text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                      阶段：{selectedTask.stage || '—'}
                    </span>
                  </div>

                  {/* 阶段步进：仅当后端 stage 命中已知阶段序列时高亮 */}
                  {selectedStageIndex >= 0 && (
                    <div className="mt-5">
                      <p className="mb-label mb-2">流水线阶段</p>
                      <div className="mb-steps">
                        {STAGE_STEPS.map((step, index) => {
                          const isOn = index === selectedStageIndex && selectedTask.status !== 'completed'
                          const isDone =
                            selectedStageIndex >= 0 &&
                            (index < selectedStageIndex ||
                              (selectedTask.status === 'completed' && index <= selectedStageIndex))
                          return (
                            <div
                              key={step.key}
                              className={`mb-steps__item ${isOn ? 'mb-steps__item--on' : ''} ${
                                isDone ? 'mb-steps__item--done' : ''
                              }`}
                            >
                              <span className="mb-steps__dot" />
                              <span className="mb-steps__t">{step.label}</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  <p
                    className="mt-5 rounded-md px-3 py-2 text-sm"
                    style={{ backgroundColor: 'var(--rc-surface-2)', color: 'var(--rc-text)' }}
                  >
                    <span className="font-semibold">阶段消息：</span>
                    {selectedTask.stage_message || '—'}
                  </p>

                  <dl className="mb-dl mt-5">
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
                      <div key={label} className="mb-dl__row">
                        <dt className="mb-dl__key">{label}</dt>
                        <dd className="mb-dl__val">{value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    {renderActions(selectedTask)}
                  </div>
                </div>
              ) : null}
            </section>
          )}

          {/* 完整任务表 */}
          <section className="mb-panel" aria-label="任务列表">
            <div className="mb-panel__head">
              <h3 className="mb-panel__title">
                <Icon name="listTree" size="sm" tone="accent" />
                任务列表
              </h3>
              <div className="flex items-center gap-3">
                {hasActive && (
                  <StatusBadge tone="accent" dot={false}>
                    <span className="rc-live-dot" aria-hidden="true" />
                    自动刷新
                  </StatusBadge>
                )}
                {tasksQuery.data && <StatusBadge tone="neutral">{tasksQuery.data.total} 项</StatusBadge>}
              </div>
            </div>

            <div className="hidden lg:block">
              <DataTable columns={columns} data={tasks} rowKey={(task) => task.task_id} />
            </div>
            <ul className="lg:hidden">
              {tasks.map((task) => (
                <li
                  key={task.task_id}
                  className="px-4 py-3"
                  style={{ borderTop: 'var(--rc-stroke-hair)' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button
                        type="button"
                        className="mb-task-link mb-mono text-xs font-medium text-accent-soft hover:underline"
                        onClick={() => setSelectedTaskId(task.task_id)}
                      >
                        {task.task_id.slice(0, 12)}
                      </button>
                      <p className="mt-1 break-all text-sm">{materialName(task)}</p>
                    </div>
                    <StatusBadge tone={statusTone(task.status)}>{statusLabel(task.status)}</StatusBadge>
                  </div>
                  <div
                    className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs"
                    style={{ color: 'var(--rc-text-muted)' }}
                  >
                    <span className="mb-mono">阶段 {task.stage || '—'}</span>
                    <span className="mb-mono">
                      <Icon as={Cpu} size="xs" className="mr-1 inline" />
                      {task.model || '—'}
                    </span>
                    <span className="mb-mono">
                      {formatCount(task.model_calls)} 次 / {formatCount(task.total_tokens)} Token
                    </span>
                    <span className="mb-mono">{formatDuration(task.duration_ms)}</span>
                    <span className="mb-mono">{formatDateTime(task.started_at)}</span>
                  </div>
                  {task.error_code && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--rc-danger)' }}>
                      {task.error_code} {task.error_message ?? ''}
                    </p>
                  )}
                  <div className="mt-3">{renderActions(task)}</div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
