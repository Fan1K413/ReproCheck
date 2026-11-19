import { useQueries, useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  ClipboardList,
  FileStack,
  GitCompare,
  LayoutDashboard,
  Network,
  Play,
  Server,
  Sparkles,
  Terminal,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
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
} from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type { ReproRunView } from '../../types/reproduction'

type StatCardProps = {
  label: string
  value: number
  hint: string
  icon: typeof ClipboardList
  tone?: 'accent' | 'success' | 'warning' | 'danger'
}

function StatCard({ label, value, hint, icon: Icon, tone = 'accent' }: StatCardProps) {
  const iconClass = {
    accent: 'bg-accent-wash text-accent-dark',
    success: 'bg-success-wash text-success',
    warning: 'bg-warning-wash text-warning',
    danger: 'bg-danger-wash text-danger',
  }[tone]
  return (
    <div className="panel p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-ink-muted">{label}</span>
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${iconClass}`}>
          <Icon size={15} strokeWidth={1.9} />
        </span>
      </div>
      <p className="mono mt-2 text-2xl font-semibold leading-none text-ink">{formatCount(value)}</p>
      <p className="mt-2 truncate text-[11px] text-ink-subtle">{hint}</p>
    </div>
  )
}

function Section({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string
  icon: typeof ClipboardList
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Icon size={17} className="text-accent-dark" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

const DISTRIBUTION_KEYS = ['pending', 'running', 'completed', 'failed', 'blocked'] as const

export default function ReproductionOverviewPage() {
  const pid = useParams().pid ?? ''
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

  if (plansQuery.isPending || runsQuery.isPending) {
    return <LoadingState message="正在读取复现总览…" hint="GET /reproductions/plans · /runs" />
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

  const plans = plansQuery.data?.items ?? []
  const runs = runsQuery.data?.items ?? []
  const tasks = planDetails.flatMap((result) => result.data?.tasks ?? [])
  const detailErrors = planDetails.filter((result) => result.isError).length

  const statusCounts: Record<string, number> = {}
  tasks.forEach((task) => {
    statusCounts[task.status] = (statusCounts[task.status] ?? 0) + 1
  })
  const humanPending = tasks.filter((task) => task.needs_human_confirm === true).length

  const feasibilityCounts: Record<string, number> = {}
  plans.forEach((plan) => {
    Object.entries(plan.feasibility_summary ?? {}).forEach(([key, count]) => {
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
    <nav className="flex flex-wrap items-center gap-2">
      <Link to={`/projects/${pid}/reproduction/environment`} className="btn-ghost"><Server size={15} />环境</Link>
      <Link to={`/projects/${pid}/reproduction/comparison`} className="btn-ghost"><GitCompare size={15} />结果对照</Link>
      <Link to={`/projects/${pid}/reproduction/diagnostics`} className="btn-ghost"><Sparkles size={15} />AI 诊断</Link>
      <Link to={`/projects/${pid}/reproduction/reports`} className="btn-ghost"><FileStack size={15} />报告</Link>
    </nav>
  )

  if (hasNoProject) {
    return (
      <div className="space-y-5">
        <PageHeading />
        <div className="panel p-5">
          <EmptyState
            icon={LayoutDashboard}
            title="尚未选择项目"
            description="请先在「项目」中选择一个项目，复现工作台会展示该项目的真实规划与运行数据。"
            action={<Link to="/projects" className="btn-primary">前往项目列表</Link>}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading />
        {quickNav}
      </div>

      {blockedRuns.length > 0 ? (
        <div className="panel flex flex-wrap items-start gap-3 border-danger/30 bg-danger-wash p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-danger">当前环境不支持安全代码执行，未运行任何代码</p>
            <p className="mt-1 text-xs text-ink-muted">
              后端已在 {formatCount(blockedRuns.length)} 个运行上禁用执行（execution_enabled=false 或 status=blocked_no_sandbox）。
              所有状态均来自后端，不显示伪造的成功结果。
            </p>
          </div>
        </div>
      ) : (
        <div className="panel flex flex-wrap items-start gap-3 bg-accent-wash p-4">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-accent-dark" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-accent-dark">代码执行能力说明</p>
            <p className="mt-1 text-xs text-ink-muted">
              当前无运行记录。后端在无安全沙箱时会禁用执行并阻塞运行，不会伪造任何执行进度或成功结果。
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="复现规划数" value={plans.length} hint="GET /reproductions/plans → total" icon={Network} />
        <StatCard label="复现运行数" value={runs.length} hint="GET /reproductions/runs → total" icon={Play} />
        <StatCard label="任务总数" value={tasks.length} hint={`来自 ${planDetails.length} 份规划详情`} icon={ClipboardList} />
        <StatCard label="待人工确认" value={humanPending} hint="needs_human_confirm=true" icon={Sparkles} tone="warning" />
      </div>

      {detailErrors > 0 && (
        <div className="panel bg-warning-wash p-3 text-xs text-warning">
          有 {detailErrors} 份规划详情读取失败，任务分布仅统计已成功返回的数据。
        </div>
      )}

      <Section title="任务状态分布" icon={ClipboardList}>
        {tasks.length === 0 ? (
          <EmptyState
            compact
            title="暂无任务数据"
            description="创建复现规划后，后端返回的任务状态会汇总显示在这里。"
          />
        ) : (
          <ul className="space-y-3">
            {DISTRIBUTION_KEYS.map((key) => {
              const count = statusCounts[key] ?? 0
              const width = Math.round((count / maxStatus) * 100)
              return (
                <li key={key} className="flex flex-wrap items-center gap-3">
                  <span className="w-20 shrink-0 text-xs text-ink-muted">{taskStatusLabel(key)}</span>
                  <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-neutral-wash">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                  </div>
                  <span className="mono w-10 text-right text-xs text-ink">{count}</span>
                  <span className="mono text-[11px] text-ink-subtle">{key}</span>
                </li>
              )
            })}
            <li className="flex flex-wrap items-center gap-3">
              <span className="w-20 shrink-0 text-xs text-ink-muted">待人工</span>
              <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-neutral-wash">
                <div className="h-full rounded-full bg-warning" style={{ width: `${Math.round((humanPending / maxStatus) * 100)}%` }} />
              </div>
              <span className="mono w-10 text-right text-xs text-ink">{humanPending}</span>
              <span className="mono text-[11px] text-ink-subtle">needs_human_confirm</span>
            </li>
          </ul>
        )}
      </Section>

      <Section title="规划可行性汇总" icon={Network}>
        {feasibilityEntries.length === 0 ? (
          <EmptyState compact title="暂无可行性汇总" description="规划列表返回 feasibility_summary 后会在此展示。" />
        ) : (
          <div className="flex flex-wrap gap-2">
            {feasibilityEntries.map(([key, count]) => (
              <StatusBadge key={key} tone={feasibilityTone(key)}>
                {feasibilityLabel(key)} · {formatCount(count)}
              </StatusBadge>
            ))}
          </div>
        )}
      </Section>

      <Section title="复现规划" icon={Network}>
        <DataTable
          columns={[
            {
              key: 'title',
              header: '规划',
              render: (plan) => (
                <div className="min-w-0">
                  <Link
                    to={`/reproductions/plans/${plan.plan_id}`}
                    className="font-medium text-accent-dark hover:underline"
                  >
                    {plan.title || '未命名规划'}
                  </Link>
                  <p className="mono text-[11px] text-ink-subtle">{plan.plan_id}</p>
                </div>
              ),
            },
            {
              key: 'status',
              header: '状态',
              render: (plan) => (
                <StatusBadge tone={planStatusTone(plan.status)}>{planStatusLabel(plan.status)}</StatusBadge>
              ),
            },
            {
              key: 'tasks',
              header: '任务数',
              align: 'right',
              render: (plan) => <span className="mono">{formatCount(plan.task_count)}</span>,
            },
            {
              key: 'created',
              header: '创建时间',
              render: (plan) => <span className="text-xs text-ink-muted">{formatDateTime(plan.created_at)}</span>,
            },
          ]}
          data={plans}
          rowKey={(plan) => plan.plan_id}
          empty={<EmptyState compact title="尚无复现规划" description="在规划页点击「新建规划」创建第一份复现规划。" />}
        />
      </Section>

      <Section title="复现运行" icon={Terminal}>
        <DataTable<ReproRunView>
          columns={[
            {
              key: 'run',
              header: '运行',
              render: (run) => (
                <div className="min-w-0">
                  <Link to={`/reproductions/runs/${run.run_id}`} className="font-medium text-accent-dark hover:underline">
                    控制台
                  </Link>
                  <p className="mono text-[11px] text-ink-subtle">{run.run_id}</p>
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
              render: (run) =>
                run.execution_enabled ? (
                  <StatusBadge tone="success">已启用</StatusBadge>
                ) : (
                  <StatusBadge tone="danger">已禁用</StatusBadge>
                ),
            },
            {
              key: 'created',
              header: '创建时间',
              render: (run) => <span className="text-xs text-ink-muted">{formatDateTime(run.created_at)}</span>,
            },
          ]}
          data={runs}
          rowKey={(run) => run.run_id}
          empty={<EmptyState compact title="尚无运行记录" description="创建复现运行后，这里会展示后端真实运行状态。" />}
        />
      </Section>
    </div>
  )
}

function PageHeading() {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Reproduction Overview</p>
      <h2 className="mt-1 text-lg font-semibold">复现工作台总览</h2>
      <p className="mt-1 text-sm text-ink-muted">
        所有统计来自后端 GET /reproductions/plans 与 /runs 及规划详情，无前端伪造数据。
      </p>
    </div>
  )
}
