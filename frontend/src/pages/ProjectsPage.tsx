import { useQuery } from '@tanstack/react-query'
import { ArrowUpRight, FolderKanban, Plus } from 'lucide-react'
import { Link } from 'react-router-dom'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { StatusBadge } from '../components/StatusBadge'
import { formatDateTime } from '../features/format'
import { api } from '../services/api'
import type { Project } from '../types/api'

const columns: Column<Project>[] = [
  {
    key: 'name',
    header: '项目名称',
    render: (project) => (
      <div className="min-w-0">
        <p className="font-medium text-ink">{project.name}</p>
        <p className="mt-0.5 text-xs text-ink-muted">{project.description || '暂无描述'}</p>
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
      <span className="block max-w-[320px] truncate text-ink-muted" title={project.paper_title}>
        {project.paper_title}
      </span>
    ),
  },
  {
    key: 'created',
    header: '创建时间',
    render: (project) => (
      <span className="mono whitespace-nowrap text-xs text-ink-muted">
        {formatDateTime(project.created_at)}
      </span>
    ),
  },
  {
    key: 'actions',
    header: '材料解析',
    render: (project) => (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 whitespace-nowrap">
        <Link
          to={`/projects/${project.id}/materials`}
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline"
        >
          管理材料 <ArrowUpRight size={12} />
        </Link>
        <Link
          to={`/projects/${project.id}/overview`}
          className="text-xs text-ink-muted hover:text-accent-dark hover:underline"
        >
          解析概览
        </Link>
      </div>
    ),
  },
]

export default function ProjectsPage() {
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">项目</h2>
          <p className="mt-1 text-sm text-ink-muted">复现审计项目档案，数据来自 GET /projects。</p>
        </div>
        <Link to="/projects/new" className="btn-primary">
          <Plus size={16} />
          新建项目
        </Link>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <h3 className="text-sm font-semibold">全部项目</h3>
          {projectsQuery.data && (
            <StatusBadge tone="neutral">{projectsQuery.data.total} 项</StatusBadge>
          )}
        </div>
        {projectsQuery.isPending ? (
          <LoadingState compact message="正在读取项目列表…" />
        ) : projectsQuery.isError ? (
          <ErrorState
            compact
            message="无法获取项目列表，请确认后端服务已启动。"
            onRetry={() => void projectsQuery.refetch()}
          />
        ) : (
          <DataTable
            columns={columns}
            data={projectsQuery.data?.items ?? []}
            rowKey={(project) => project.id}
            empty={
              <EmptyState
                icon={FolderKanban}
                title="尚无项目"
                description="创建第一个复现审计项目档案后，项目会显示在这里。"
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
    </div>
  )
}
