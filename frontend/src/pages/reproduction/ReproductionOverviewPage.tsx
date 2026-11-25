import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  ClipboardList,
  GitBranch,
  GitCompare,
  LayoutDashboard,
  Network,
  Orbit,
  Play,
  Plus,
  Server,
  Sparkles,
  SquareTerminal,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatCount, formatDateTime } from '../../features/format'
import {
  feasibilityLabel,
  feasibilityTone,
  planStatusLabel,
  planStatusTone,
  runStatusLabel,
  runStatusTone,
  taskStatusLabel,
  taskStatusTone,
} from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type { PlanView, ReproRunView, ReproTaskView } from '../../types/reproduction'
import '../../styles/wave-a-repro.css'

/* 复现执行系 · Wave A 页面样式（唯一色源 --rc-*） */
const DISTRIBUTION_KEYS = ['pending', 'running', 'completed', 'failed', 'blocked'] as const

/** 后端实际返回值的中文补充（共享 meta 未收录的键值就地翻译，不改共享文件）。 */
const FEASIBILITY_ZH: Record<string, string> = {
  feasible: '可行',
  ready: '就绪',
  missing_material: '缺少材料',
  missing_dependency: '缺少依赖',
  missing_configuration: '缺少配置',
  needs_human_review: '待人工确认',
  blocked_security: '安全阻塞',
  unverifiable: '无法验证',
}

const PLAN_STATUS_ZH: Record<string, string> = {
  confirmed: '已确认',
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
  blocked: '已阻塞',
}

const feasZh = (value: string): string => FEASIBILITY_ZH[value] ?? feasibilityLabel(value)
const planStatusZh = (value: string): string => PLAN_STATUS_ZH[value] ?? planStatusLabel(value)

/** 耗时按小时 / 分钟 / 秒自适应显示（与执行控制台一致）。 */
function formatRunDuration(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const seconds = ms / 1000
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(2)} h`
  if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`
  return `${seconds.toFixed(2)} s`
}

type StackMode = 'plan' | 'run'

function MetaCell({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <p className="rc-wa-meta__k">{k}</p>
      <p className="rc-wa-meta__v">{v}</p>
    </div>
  )
}

export default function ReproductionOverviewPage() {
  const pid = useParams().pid ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  useTrackProject(pid)

  const plansQuery = useQuery({
    queryKey: ['repro-plans', pid],
    queryFn: () => reproductionApi.listPlans(pid),
    enabled: !!pid,
  })
  const runsQuery = useQuery({
    queryKey: ['repro-runs', pid],
    queryFn: () => reproductionApi.listRuns(pid),
    enabled: !!pid,
  })

  const planDetails = useQueries({
    queries: (plansQuery.data?.items ?? []).map((plan) => ({
      queryKey: ['repro-plan', plan.plan_id],
      queryFn: () => reproductionApi.getPlan(plan.plan_id),
      enabled: !!plan.plan_id,
    })),
  })

  /* ---------------- 透视卡片状态 ---------------- */
  const [mode, setMode] = useState<StackMode>('plan')
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  const plans = useMemo(() => plansQuery.data?.items ?? [], [plansQuery.data])
  const runs = useMemo(() => runsQuery.data?.items ?? [], [runsQuery.data])

  // 默认聚焦第一份规划 / 第一次运行（真实列表首项）
  useEffect(() => {
    if (!activePlanId && plans.length > 0) setActivePlanId(plans[0].plan_id)
  }, [plans, activePlanId])

  useEffect(() => {
    if (!activeRunId && runs.length > 0) setActiveRunId(runs[0].run_id)
  }, [runs, activeRunId])

  const createPlanMutation = useMutation({
    mutationFn: () => reproductionApi.createPlan({ project_id: pid, mode: 'manual' }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['repro-plans'] })
      navigate(`/reproductions/plans/${created.plan_id}`)
    },
  })

  // 切换焦点时启动 400ms 位移过渡；过渡结束后移除 will-change（交互规范 §3.3 规则 2）
  useEffect(() => {
    setMoving(true)
    const timer = window.setTimeout(() => setMoving(false), 420)
    return () => window.clearTimeout(timer)
  }, [activePlanId, activeRunId, mode])

  if (plansQuery.isPending || runsQuery.isPending) {
    return <LoadingState message="正在读取复现总览…" hint="正在读取后端规划与运行数据" />
  }
  if (plansQuery.isError) {
    return (
      <ErrorState
        message={
          plansQuery.error instanceof Error ? plansQuery.error.message : '无法获取复现规划。'
        }
        code={plansQuery.error instanceof ApiError ? plansQuery.error.code : undefined}
        onRetry={() => void plansQuery.refetch()}
      />
    )
  }
  if (runsQuery.isError) {
    return (
      <ErrorState
        message={runsQuery.error instanceof Error ? runsQuery.error.message : '无法获取复现运行。'}
        code={runsQuery.error instanceof ApiError ? runsQuery.error.code : undefined}
        onRetry={() => void runsQuery.refetch()}
      />
    )
  }

  const tasks = planDetails.flatMap((result) => result.data?.tasks ?? [])
  const detailErrors = planDetails.filter((result) => result.isError).length

  const taskByPlan = new Map<string, ReproTaskView[]>()
  planDetails.forEach((result, index) => {
    const plan = plans[index]
    if (plan && result.data) taskByPlan.set(plan.plan_id, result.data.tasks)
  })

  const statusCounts: Record<string, number> = {}
  tasks.forEach((task) => {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1
  })
  const humanPending = tasks.filter((task) => task.needs_human_confirm === true).length

  const feasibilityCounts: Record<string, number> = {}
  plans.forEach((plan) => {
    Object.entries(plan.feasibility_summary ?? {}).forEach(([key, count]) => {
      if (typeof count !== 'number') return
      feasibilityCounts[key] = (feasibilityCounts[key] ?? 0) + count
    })
  })
  const feasibilityEntries = Object.entries(feasibilityCounts).sort((a, b) => b[1] - a[1])
  const maxStatus = Math.max(
    1,
    ...DISTRIBUTION_KEYS.map((key) => statusCounts[key] ?? 0),
    humanPending,
  )

  const blockedRuns = runs.filter(
    (run) => run.execution_enabled === false || run.status === 'blocked_no_sandbox',
  )
  const hasNoProject = !pid

  const quickNav = (
    <>
      <button
        type="button"
        className="btn-primary"
        disabled={createPlanMutation.isPending}
        title="不调用 AI，创建空规划后可逐条新增真实任务"
        onClick={() => createPlanMutation.mutate()}
      >
        <Icon as={Plus} size="sm" />
        {createPlanMutation.isPending ? '创建中…' : '手动新建规划'}
      </button>
      <Link to={`/projects/${pid}/workbench`} className="btn-ghost">
        <Icon as={Orbit} size="sm" />
        Bloom 账本
      </Link>
      <Link to={`/projects/${pid}/reproduction/environment`} className="btn-ghost">
        <Icon as={Boxes} size="sm" />
        环境
      </Link>
      <Link to={`/projects/${pid}/reproduction/comparison`} className="btn-ghost">
        <Icon as={GitCompare} size="sm" />
        结果对照
      </Link>
      <Link to={`/projects/${pid}/reproduction/diagnostics`} className="btn-ghost">
        <Icon as={Sparkles} size="sm" />
        AI 诊断
      </Link>
    </>
  )

  if (hasNoProject) {
    return (
      <div className="rc-wa-page">
        <header className="rc-wa-head">
          <div className="rc-wa-head__text">
            <p className="rc-wa-eyebrow">复现总览</p>
            <h1 className="rc-wa-title">复现总览</h1>
          </div>
        </header>
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <EmptyState
              icon={LayoutDashboard}
              title="尚未选择项目"
              description="请先在「项目」中选择一个项目，复现工作台会展示该项目的真实规划与运行数据。"
              action={
                <Link to="/projects" className="btn-primary">
                  前往项目列表
                </Link>
              }
            />
          </div>
        </section>
      </div>
    )
  }

  /* ---------------- 透视堆叠：排序 + 深度 ---------------- */
  const orderedPlans = [...plans].sort((a, b) =>
    a.plan_id === activePlanId ? -1 : b.plan_id === activePlanId ? 1 : 0,
  )
  const orderedRuns = [...runs].sort((a, b) =>
    a.run_id === activeRunId ? -1 : b.run_id === activeRunId ? 1 : 0,
  )

  return (
    <div className="rc-wa-page">
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">Reproduction Overview</p>
          <h1 className="rc-wa-title">复现总览</h1>
          <p className="rc-wa-lede">
            所有统计来自后端规划、运行与规划详情，无前端伪造数据。
            切换规划或运行时，透视卡片沿透视轴 400ms 滑入滑出。
          </p>
        </div>
        <div className="rc-wa-head__actions">{quickNav}</div>
      </header>

      {createPlanMutation.isError && (
        <p role="alert" style={{ color: 'var(--rc-danger)', marginBottom: 'var(--rc-space-4)' }}>
          创建规划失败：{createPlanMutation.error instanceof Error ? createPlanMutation.error.message : '请稍后重试。'}
        </p>
      )}

      {blockedRuns.length > 0 ? (
        <section className="rc-wa-panel" style={{ borderColor: 'var(--rc-danger)' }}>
          <div
            className="rc-wa-panel__body"
            style={{ backgroundColor: 'var(--rc-danger-wash)', display: 'flex', gap: 'var(--rc-space-3)' }}
          >
            <Icon as={AlertTriangle} size="md" tone="danger" />
            <div style={{ minWidth: 0 }}>
              <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
                当前环境不支持安全代码执行，未运行任何代码
              </p>
              <p className="rc-wa-lede" style={{ marginTop: 'var(--rc-space-2)', fontSize: 'var(--rc-fs-caption)' }}>
                后端已在 {formatCount(blockedRuns.length)} 个运行上禁用执行（execution_enabled=false 或
                status=blocked_no_sandbox）。所有状态均来自后端，不显示伪造的成功结果。
              </p>
            </div>
          </div>
        </section>
      ) : (
        <section className="rc-wa-panel">
          <div
            className="rc-wa-panel__body"
            style={{ backgroundColor: 'var(--rc-accent-wash)', display: 'flex', gap: 'var(--rc-space-3)' }}
          >
            <Icon as={AlertTriangle} size="md" tone="accent" />
            <div style={{ minWidth: 0 }}>
              <p className="rc-wa-sub" style={{ color: 'var(--rc-violet)' }}>
                代码执行能力说明
              </p>
              <p className="rc-wa-lede" style={{ marginTop: 'var(--rc-space-2)', fontSize: 'var(--rc-fs-caption)' }}>
                当前无运行记录。后端在无安全沙箱时会禁用执行并阻塞运行，不会伪造任何执行进度或成功结果。
              </p>
            </div>
          </div>
        </section>
      )}

      <section className="rc-wa-kpis">
        <Kpi label="复现规划数" value={formatCount(plans.length)} hint="后端真实计数" tone="accent" icon={Network} />
        <Kpi label="复现运行数" value={formatCount(runs.length)} hint="后端真实计数" tone="info" icon={Play} />
        <Kpi label="任务总数" value={formatCount(tasks.length)} hint={`来自 ${planDetails.length} 份规划详情`} tone="success" icon={ClipboardList} />
        <Kpi label="待人工确认" value={formatCount(humanPending)} hint="needs_human_confirm=true" tone="warning" icon={Sparkles} />
      </section>

      {detailErrors > 0 && (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body" style={{ backgroundColor: 'var(--rc-warning-wash)' }}>
            <p className="rc-wa-sub" style={{ color: 'var(--rc-warning)' }}>
              有 {detailErrors} 份规划详情读取失败，任务分布仅统计已成功返回的数据。
            </p>
          </div>
        </section>
      )}

      {/* ========== 特色交互 1：动态透视卡片（多规划 / 多运行切换） ========== */}
      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={GitBranch} size="sm" tone="accent" />
            规划 / 运行透视台
          </div>
          <div className="rc-wa-seg" role="tablist" aria-label="透视对象">
            <button
              type="button"
              role="tab"
              className="rc-wa-seg__btn"
              aria-selected={mode === 'plan'}
              onClick={() => setMode('plan')}
            >
              <Icon as={Network} size="xs" />
              规划 {plans.length}
            </button>
            <button
              type="button"
              role="tab"
              className="rc-wa-seg__btn"
              aria-selected={mode === 'run'}
              onClick={() => setMode('run')}
            >
              <Icon as={SquareTerminal} size="xs" />
              运行 {runs.length}
            </button>
          </div>
        </div>

        <div className="rc-wa-panel__body">
          {mode === 'plan' ? (
            plans.length === 0 ? (
              <EmptyState
                compact
                icon={Network}
                title="尚无复现规划"
                description="创建复现规划后，规划会按透视轴堆叠显示在这里。"
              />
            ) : (
              <div className="rc-wa-persp">
                <div className="rc-wa-picklist" role="group" aria-label="规划列表">
                  {plans.map((plan) => (
                    <button
                      key={plan.plan_id}
                      type="button"
                      className="rc-wa-pick"
                      aria-pressed={plan.plan_id === activePlanId}
                      onClick={() => setActivePlanId(plan.plan_id)}
                    >
                      <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                        {plan.title || '未命名规划'}
                      </span>
                      <span className="rc-wa-pick__id">{plan.plan_id}</span>
                      <span style={{ marginTop: 4 }}>
                        <StatusBadge tone={planStatusTone(plan.status)}>{planStatusZh(plan.status)}</StatusBadge>
                      </span>
                    </button>
                  ))}
                </div>

                <div className="rc-wa-persp__stage">
                  {orderedPlans.map((plan, index) => (
                    <PlanCard
                      key={plan.plan_id}
                      plan={plan}
                      depth={index}
                      moving={moving}
                      tasks={taskByPlan.get(plan.plan_id) ?? []}
                    />
                  ))}
                </div>
              </div>
            )
          ) : runs.length === 0 ? (
            <EmptyState
              compact
              icon={SquareTerminal}
              title="尚无运行记录"
              description="创建复现运行后，运行会按透视轴堆叠显示在这里。"
            />
          ) : (
            <div className="rc-wa-persp">
              <div className="rc-wa-picklist" role="group" aria-label="运行列表">
                {runs.map((run) => (
                  <button
                    key={run.run_id}
                    type="button"
                    className="rc-wa-pick"
                    aria-pressed={run.run_id === activeRunId}
                    onClick={() => setActiveRunId(run.run_id)}
                  >
                    <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                      {run.run_id}
                    </span>
                    <span className="rc-wa-pick__id">
                      {formatDateTime(run.created_at)} · {runStatusLabel(run.status)}
                    </span>
                    <span style={{ marginTop: 4 }}>
                      <StatusBadge tone={runStatusTone(run.status)}>
                        {run.execution_enabled ? '执行已启用' : '执行已禁用'}
                      </StatusBadge>
                    </span>
                  </button>
                ))}
              </div>

              <div className="rc-wa-persp__stage">
                {orderedRuns.map((run, index) => (
                  <RunCard key={run.run_id} run={run} depth={index} moving={moving} />
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={ClipboardList} size="sm" tone="accent" />
            任务状态分布
          </div>
          <span className="rc-wa-source">来源：后端规划任务的真实状态</span>
        </div>
        <div className="rc-wa-panel__body">
          {tasks.length === 0 ? (
            <EmptyState
              compact
              title="暂无任务数据"
              description="创建复现规划后，后端返回的任务状态会汇总显示在这里。"
            />
          ) : (
            <div className="rc-wa-bars">
              {DISTRIBUTION_KEYS.map((key) => {
                const count = statusCounts[key] ?? 0
                return (
                  <div className="rc-wa-bar" key={key}>
                    <span className="rc-wa-bar__label">{taskStatusLabel(key)}</span>
                    <div className="rc-wa-bar__track">
                      <div
                        className="rc-wa-bar__fill"
                        data-tone={taskStatusTone(key)}
                        style={{ transform: `scaleX(${count / maxStatus})` }}
                      />
                    </div>
                    <span className="rc-wa-bar__count">{count}</span>
                  </div>
                )
              })}
              <div className="rc-wa-bar">
                <span className="rc-wa-bar__label">待人工</span>
                <div className="rc-wa-bar__track">
                  <div
                    className="rc-wa-bar__fill"
                    data-tone="warning"
                    style={{ transform: `scaleX(${humanPending / maxStatus})` }}
                  />
                </div>
                <span className="rc-wa-bar__count">{humanPending}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={Network} size="sm" tone="accent" />
            规划可行性汇总
          </div>
          <span className="rc-wa-source">来源：plans[].feasibility_summary</span>
        </div>
        <div className="rc-wa-panel__body">
          {feasibilityEntries.length === 0 ? (
            <EmptyState compact title="暂无可行性汇总" description="规划列表返回 feasibility_summary 后会在此展示。" />
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
              {feasibilityEntries.map(([key, count]) => (
                <StatusBadge key={key} tone={feasibilityTone(key)}>
                  {feasZh(key)} · {formatCount(count)}
                </StatusBadge>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={Network} size="sm" tone="accent" />
            复现规划
          </div>
          <span className="rc-wa-source">来源：后端规划聚合</span>
        </div>
        <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
          <DataTable<PlanView>
            columns={[
              {
                key: 'title',
                header: '规划',
                render: (plan) => (
                  <div style={{ minWidth: 0 }}>
                    <Link
                      to={`/reproductions/plans/${plan.plan_id}`}
                      style={{ fontWeight: 'var(--rc-fw-sb)', color: 'var(--rc-violet)' }}
                    >
                      {plan.title || '未命名规划'}
                    </Link>
                    <p className="rc-wa-pick__id">{plan.plan_id}</p>
                  </div>
                ),
              },
              {
                key: 'status',
                header: '状态',
                render: (plan) => (
                  <StatusBadge tone={planStatusTone(plan.status)}>{planStatusZh(plan.status)}</StatusBadge>
                ),
              },
              {
                key: 'tasks',
                header: '任务数',
                align: 'right',
                render: (plan) => <span className="mono">{formatCount(plan.task_count)}</span>,
              },
              {
                key: 'source',
                header: '来源',
                render: (plan) => <span style={{ fontSize: 'var(--rc-fs-caption)' }}>{plan.source ?? '—'}</span>,
              },
              {
                key: 'created',
                header: '创建时间',
                render: (plan) => (
                  <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                    {formatDateTime(plan.created_at)}
                  </span>
                ),
              },
            ]}
            data={plans}
            rowKey={(plan) => plan.plan_id}
            empty={
              <div style={{ padding: 'var(--rc-space-5)' }}>
                <EmptyState compact title="尚无复现规划" description="点击右上角「手动新建规划」创建第一份空规划，再逐条新增真实任务；不会伪造 AI 结果。" />
              </div>
            }
          />
        </div>
      </section>

      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={SquareTerminal} size="sm" tone="accent" />
            复现运行
          </div>
          <span className="rc-wa-source">来源：后端运行聚合</span>
        </div>
        <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
          <DataTable<ReproRunView>
            columns={[
              {
                key: 'run',
                header: '运行',
                render: (run) => (
                  <div style={{ minWidth: 0 }}>
                    <Link
                      to={`/reproductions/runs/${run.run_id}`}
                      style={{ fontWeight: 'var(--rc-fw-sb)', color: 'var(--rc-violet)' }}
                    >
                      控制台
                    </Link>
                    <p className="rc-wa-pick__id">{run.run_id}</p>
                  </div>
                ),
              },
              {
                key: 'status',
                header: '状态',
                render: (run) => (
                  <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
                ),
              },
              {
                key: 'execution',
                header: '代码执行',
                render: (run) => (
                  <StatusBadge tone={run.execution_enabled ? 'success' : 'danger'}>
                    {run.execution_enabled ? '已启用' : '已禁用'}
                  </StatusBadge>
                ),
              },
              {
                key: 'duration',
                header: '耗时',
                align: 'right',
                render: (run) => <span className="mono">{formatRunDuration(run.duration_ms)}</span>,
              },
              {
                key: 'created',
                header: '创建时间',
                render: (run) => (
                  <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                    {formatDateTime(run.created_at)}
                  </span>
                ),
              },
            ]}
            data={runs}
            rowKey={(run) => run.run_id}
            empty={
              <div style={{ padding: 'var(--rc-space-5)' }}>
                <EmptyState compact title="尚无运行记录" description="创建复现运行后，这里会展示后端真实运行状态。" />
              </div>
            }
          />
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function Kpi({
  label,
  value,
  hint,
  tone,
  icon: Glyph,
}: {
  label: string
  value: string
  hint: string
  tone: 'accent' | 'success' | 'warning' | 'danger' | 'info'
  icon: typeof Network
}) {
  return (
    <article className="rc-wa-kpi" data-tone={tone}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--rc-space-2)' }}>
        <span className="rc-wa-kpi__label">{label}</span>
        <Icon as={Glyph} size="sm" tone="muted" />
      </div>
      <p className="rc-wa-kpi__value">{value}</p>
      <p className="rc-wa-kpi__hint">{hint}</p>
    </article>
  )
}

function PlanCard({
  plan,
  depth,
  moving,
  tasks,
}: {
  plan: PlanView
  depth: number
  moving: boolean
  tasks: ReproTaskView[]
}) {
  const completed = tasks.filter((task) => task.status === 'completed').length
  const total = tasks.length || plan.task_count
  const ratio = total > 0 ? completed / total : 0

  return (
    <article
      className={`rc-wa-persp__card${moving ? ' is-moving' : ''}`}
      data-depth={depth}
      aria-hidden={depth > 0}
    >
      <div className="rc-wa-persp__cardbody">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--rc-space-3)' }}>
          <div style={{ minWidth: 0 }}>
            <p className="rc-wa-sub">{plan.plan_id}</p>
            <h2 className="rc-wa-persp__cardtitle">{plan.title || '未命名规划'}</h2>
          </div>
          <StatusBadge tone={planStatusTone(plan.status)}>{planStatusZh(plan.status)}</StatusBadge>
        </div>

        <div className="rc-wa-persp__meta">
          <MetaCell k="任务数" v={String(plan.task_count)} />
          <MetaCell k="已完成" v={`${completed} / ${total}`} />
          <MetaCell k="来源" v={plan.source ?? '—'} />
          <MetaCell k="AI" v={plan.ai_available ? '可用' : '不可用'} />
          <MetaCell k="Prompt" v={plan.prompt_version ?? '—'} />
          <MetaCell k="创建时间" v={formatDateTime(plan.created_at)} />
        </div>

        {total > 0 && (
          <div>
            <div className="rc-wa-meter">
              <div
                className="rc-wa-meter__fill"
                data-tone={ratio >= 1 ? 'accent' : 'warning'}
                style={{ transform: `scaleX(${ratio})` }}
              />
            </div>
            <p className="rc-wa-kpi__hint" style={{ marginTop: 'var(--rc-space-2)' }}>
              完成度来自该规划 tasks[].status 的真实计数（{completed}/{total}）
            </p>
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
          <Link to={`/reproductions/plans/${plan.plan_id}`} className="btn-primary">
            <Icon as={GitBranch} size="sm" />
            打开规划 DAG
          </Link>
          <Link to={`/projects/${plan.project_id}/reproduction/environment`} className="btn-ghost">
            <Icon as={Server} size="sm" />
            查看环境
          </Link>
        </div>
      </div>
    </article>
  )
}

function RunCard({
  run,
  depth,
  moving,
}: {
  run: ReproRunView
  depth: number
  moving: boolean
}) {
  return (
    <article
      className={`rc-wa-persp__card${moving ? ' is-moving' : ''}`}
      data-depth={depth}
      aria-hidden={depth > 0}
    >
      <div className="rc-wa-persp__cardbody">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--rc-space-3)' }}>
          <div style={{ minWidth: 0 }}>
            <p className="rc-wa-sub">{run.run_id}</p>
            <h2 className="rc-wa-persp__cardtitle">
              {run.status === 'running' ? '执行中' : runStatusLabel(run.status)}
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--rc-space-2)' }}>
            {run.status === 'running' && <span className="rc-wa-pulse-dot" aria-hidden="true" />}
            <StatusBadge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</StatusBadge>
          </div>
        </div>

        <div className="rc-wa-persp__meta">
          <MetaCell k="plan_id" v={run.plan_id} />
          <MetaCell k="代码执行" v={run.execution_enabled ? '已启用' : '已禁用'} />
          <MetaCell k="环境" v={run.environment_id ?? '—'} />
          <MetaCell k="耗时" v={formatRunDuration(run.duration_ms)} />
          <MetaCell k="开始" v={formatDateTime(run.started_at)} />
          <MetaCell k="结束" v={formatDateTime(run.finished_at)} />
        </div>

        {run.error_message && (
          <p
            className="rc-wa-kpi__hint"
            style={{
              color: 'var(--rc-danger)',
              backgroundColor: 'var(--rc-danger-wash)',
              padding: 'var(--rc-space-3)',
              borderRadius: 'var(--rc-radius-sm)',
            }}
          >
            后端报告的错误：{run.error_message}
          </p>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
          <Link to={`/reproductions/runs/${run.run_id}`} className="btn-primary">
            <Icon as={SquareTerminal} size="sm" />
            打开执行控制台
          </Link>
          <Link to={`/reproductions/plans/${run.plan_id}`} className="btn-ghost">
            <Icon as={GitBranch} size="sm" />
            查看规划
          </Link>
        </div>
      </div>
    </article>
  )
}
