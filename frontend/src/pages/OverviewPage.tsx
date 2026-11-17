import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ClipboardList,
  Cpu,
  FileText,
  FolderKanban,
  Hash,
  ListChecks,
  ShieldCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatCount } from '../features/format'
import { materialTypeLabel } from '../features/stage2Meta'
import { useTrackProject } from '../hooks/useTrackProject'
import { ApiError, api } from '../services/api'
import type { MaterialType } from '../types/api'

type StatCardProps = {
  label: string
  value: number | null | undefined
  hint: string
  icon: typeof Hash
  tone?: 'accent' | 'success' | 'warning'
}

function StatCard({ label, value, hint, icon: Icon, tone = 'accent' }: StatCardProps) {
  const iconClass =
    tone === 'success'
      ? 'bg-success-wash text-success'
      : tone === 'warning'
        ? 'bg-warning-wash text-warning'
        : 'bg-accent-wash text-accent'
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

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Hash; children: ReactNode }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Icon size={17} className="text-accent" />
          <h3 className="text-sm font-semibold">{title}</h3>
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  )
}

export default function OverviewPage() {
  const projectId = useParams().projectId ?? ''
  useTrackProject(projectId)

  const overviewQuery = useQuery({
    queryKey: ['parse-overview', projectId],
    queryFn: () => api.getParseOverview(projectId),
    enabled: !!projectId,
  })

  const overview = overviewQuery.data
  const base = `/projects/${projectId}`

  if (overviewQuery.isPending) {
    return <LoadingState message="正在读取解析概览…" hint="GET /projects/{id}/parse-overview" />
  }
  if (overviewQuery.isError) {
    return (
      <ErrorState
        message={overviewQuery.error instanceof Error ? overviewQuery.error.message : '无法获取解析概览。'}
        code={overviewQuery.error instanceof ApiError ? overviewQuery.error.code : undefined}
        onRetry={() => void overviewQuery.refetch()}
      />
    )
  }
  if (!overview) {
    return <EmptyState title="暂无概览数据" description="后端未返回该项目的解析概览。" />
  }

  const typeEntries = Object.entries(overview.by_type ?? {}).sort((a, b) => b[1] - a[1])
  const maxTypeCount = typeEntries.reduce((max, [, count]) => Math.max(max, count), 0)
  const noMaterials = (overview.materials?.total ?? 0) === 0

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Parse Overview</p>
          <h2 className="mt-1 text-lg font-semibold">解析概览</h2>
          <p className="mt-1 text-sm text-ink-muted">
            所有统计均来自 GET /projects/{'{id}'}/parse-overview 的数据库聚合，无前端推算。
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          <Link to={`${base}/materials`} className="btn-ghost"><FileText size={15} />材料管理</Link>
          <Link to={`${base}/tasks`} className="btn-ghost"><ListChecks size={15} />解析任务</Link>
          <Link to={`${base}/facts`} className="btn-ghost"><ClipboardList size={15} />科研事实</Link>
        </nav>
      </div>

      {noMaterials && (
        <div className="panel p-5">
          <EmptyState
            compact
            icon={FolderKanban}
            title="该项目尚无材料"
            description="上传材料并发起解析后，这里的统计与分布会由后端实时生成。"
            action={
              <Link to={`${base}/materials`} className="btn-primary">
                去上传材料
              </Link>
            }
          />
        </div>
      )}

      <Section title="材料解析状态" icon={FileText}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="材料总数" value={overview.materials?.total} hint="materials.total" icon={FolderKanban} />
          <StatCard label="解析成功" value={overview.materials?.completed} hint="materials.completed" icon={ShieldCheck} tone="success" />
          <StatCard label="部分完成" value={overview.materials?.partially_completed} hint="materials.partially_completed" icon={Activity} tone="warning" />
          <StatCard label="解析失败" value={overview.materials?.failed} hint="materials.failed" icon={Activity} />
          <StatCard label="待处理" value={overview.materials?.pending} hint="materials.pending" icon={Hash} />
        </div>
      </Section>

      <Section title="事实与证据" icon={ClipboardList}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="事实总数" value={overview.facts?.total} hint="facts.total" icon={ClipboardList} />
          <StatCard label="有证据" value={overview.facts?.with_evidence} hint="facts.with_evidence" icon={ShieldCheck} tone="success" />
          <StatCard label="待复核" value={overview.facts?.needs_review} hint="facts.needs_review" icon={Activity} tone="warning" />
          <StatCard label="人工修订" value={overview.facts?.human_revised} hint="facts.human_revised" icon={Cpu} />
        </div>
      </Section>

      <Section title="模型调用" icon={Cpu}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatCard label="LLM 调用次数" value={overview.llm?.total_calls} hint="llm.total_calls" icon={Cpu} />
          <StatCard label="LLM Token 总数" value={overview.llm?.total_tokens} hint="llm.total_tokens" icon={Hash} />
        </div>
      </Section>

      <Section title="材料类型分布" icon={Hash}>
        {typeEntries.length === 0 ? (
          <EmptyState
            compact
            icon={FolderKanban}
            title="暂无类型分布数据"
            description="上传材料后，按材料类型统计的分布会显示在这里。"
          />
        ) : (
          <ul className="space-y-3">
            {typeEntries.map(([type, count]) => {
              const label =
                materialTypeLabel[type as MaterialType] ?? type
              const width = maxTypeCount > 0 ? Math.round((count / maxTypeCount) * 100) : 0
              return (
                <li key={type} className="flex flex-wrap items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs text-ink-muted" title={type}>{label}</span>
                  <div className="h-2 min-w-[120px] flex-1 overflow-hidden rounded-full bg-neutral-wash">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                  </div>
                  <span className="mono w-10 shrink-0 text-right text-xs text-ink">{count}</span>
                  <StatusBadge tone="neutral" dot={false}>
                    <span className="mono">{type}</span>
                  </StatusBadge>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </div>
  )
}
