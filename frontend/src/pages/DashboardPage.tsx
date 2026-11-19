import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import { ArrowUpRight, Cpu, FolderKanban, Plus, ScanSearch, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatCount, formatDateTime } from '../features/format'
import { connectionMeta, severityTone } from '../features/llm'
import { api } from '../services/api'
import { useAuditStore } from '../stores/auditStore'
import type { Project } from '../types/api'

type StatCardProps = {
  label: string
  value: ReactNode
  hint: ReactNode
  icon: LucideIcon
  badge?: ReactNode
}

function StatCard({ label, value, hint, icon: Icon, badge }: StatCardProps) {
  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
          <Icon size={17} strokeWidth={1.9} />
        </span>
      </div>
      <div className="mt-3 flex min-h-[38px] flex-wrap items-center gap-x-3 gap-y-1">
        <span className="mono text-[28px] font-semibold leading-none text-ink">{value}</span>
        {badge}
      </div>
      <div className="mt-2 truncate text-xs text-ink-subtle">{hint}</div>
    </div>
  )
}

const projectColumns: Column<Project>[] = [
  {
    key: 'name',
    header: '项目名称',
    render: (project) => (
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">{project.name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-subtle">{project.description || '暂无描述'}</p>
      </div>
    ),
  },
  {
    key: 'domain',
    header: '研究领域',
    render: (project) => <span className="text-ink-muted">{project.domain}</span>,
  },
  {
    key: 'paper',
    header: '论文标题',
    render: (project) => (
      <span className="block max-w-[260px] truncate text-ink-muted" title={project.paper_title}>
        {project.paper_title}
      </span>
    ),
  },
  {
    key: 'created',
    header: '创建时间',
    render: (project) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(project.created_at)}</span>,
  },
  {
    key: 'stage2',
    header: '材料解析',
    render: (project) => (
      <Link
        to={`/projects/${project.id}/materials`}
        className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline"
        title="上传材料并发起解析"
      >
        管理材料 <ArrowUpRight size={12} />
      </Link>
    ),
  },
]

export default function DashboardPage() {
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const llmQuery = useQuery({ queryKey: ['llm-status'], queryFn: api.getLlmStatus })
  const lastResult = useAuditStore((state) => state.lastResult)
  const recentFindings = lastResult?.findings.slice(0, 5) ?? []

  const projectValue = projectsQuery.isPending
    ? '…'
    : projectsQuery.isError
      ? '—'
      : formatCount(projectsQuery.data?.total)

  const llmStatus = llmQuery.data
  const llmValue = llmQuery.isPending
    ? '…'
    : !llmStatus
      ? '—'
      : connectionMeta[llmStatus.connection_status].label

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Overview</p>
          <h2 className="mt-1 text-lg font-semibold">复现审计工作台</h2>
          <p className="mt-1 text-sm text-ink-muted">项目、模型服务与最近审计动态均取自后端实时接口。</p>
        </div>
        <Link to="/projects/new" className="btn-primary">
          <Plus size={16} />
          新建项目
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          label="项目总数"
          value={projectValue}
          icon={FolderKanban}
          hint={projectsQuery.isError ? '项目数据加载失败，请重试' : 'GET /projects 实时数据'}
        />
        <StatCard
          label="审计运行"
          value="—"
          icon={ScanSearch}
          badge={
            <Link to="/demo/audit" className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline">
              前往演示 <ArrowUpRight size={13} />
            </Link>
          }
          hint="后端暂无运行列表接口，不显示推测数字"
        />
        <StatCard
          label="AI 模型连接"
          value={llmValue}
          icon={Cpu}
          badge={
            llmStatus && (
              <StatusBadge tone={llmStatus.api_key_configured ? 'success' : 'neutral'}>
                {llmStatus.api_key_configured ? '密钥已配置' : '密钥未配置'}
              </StatusBadge>
            )
          }
          hint={
            llmQuery.isError
              ? '模型服务状态获取失败'
              : llmStatus
                ? `${llmStatus.provider} · ${llmStatus.model}`
                : 'GET /llm/status 实时数据'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="panel overflow-hidden lg:col-span-2">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <FolderKanban size={17} className="text-accent-dark" />
              <h2 className="text-sm font-semibold">最近项目</h2>
            </div>
            <Link to="/projects" className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline">
              查看全部 <ArrowUpRight size={13} />
            </Link>
          </div>
          {projectsQuery.isPending ? (
            <LoadingState compact message="正在读取项目列表…" />
          ) : projectsQuery.isError ? (
            <ErrorState
              compact
              message="无法获取项目列表。"
              onRetry={() => void projectsQuery.refetch()}
            />
          ) : (
            <DataTable
              columns={projectColumns}
              data={projectsQuery.data?.items.slice(0, 5) ?? []}
              rowKey={(project) => project.id}
              empty={
                <EmptyState
                  compact
                  icon={FolderKanban}
                  title="尚无项目"
                  description="创建第一个复现审计项目档案后，会显示在这里。"
                  action={
                    <Link to="/projects/new" className="btn-primary">
                      <Plus size={15} />
                      去创建一个
                    </Link>
                  }
                />
              }
            />
          )}
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <ShieldAlert size={17} className="text-accent-dark" />
              <h2 className="text-sm font-semibold">最近发现问题</h2>
            </div>
            <Link to="/demo/audit" className="text-xs font-medium text-accent-dark hover:underline">
              审计演示
            </Link>
          </div>
          {recentFindings.length === 0 ? (
            <EmptyState
              compact
              icon={ShieldAlert}
              title="尚无审计发现"
              description="运行一次演示审计后，发现的参数冲突会显示在这里。"
              action={
                <Link to="/demo/audit" className="btn-ghost">
                  前往审计演示
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line-soft">
              {recentFindings.map((finding) => (
                <li key={finding.finding_id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug text-ink">{finding.title}</p>
                    <StatusBadge tone={severityTone(finding.severity)}>{finding.severity}</StatusBadge>
                  </div>
                  <p className="mono mt-1 text-[11px] text-ink-subtle">{finding.field_key}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
