import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  Cpu,
  ListChecks,
  Package,
  Server,
  Terminal,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { safeList, safeText } from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type { DependencyView, EnvironmentView } from '../../types/reproduction'

function FieldBlock({
  title,
  source,
  icon: Icon,
  children,
}: {
  title: string
  source: string
  icon: typeof Server
  children: ReactNode
}) {
  return (
    <div className="rounded-lg border border-line-soft bg-canvas/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={15} className="text-accent" />
          <h4 className="text-sm font-semibold">{title}</h4>
        </div>
        <span className="mono rounded bg-surface px-2 py-0.5 text-[10px] text-ink-subtle ring-1 ring-line">
          来源：{source}
        </span>
      </div>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function StringList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <p className="text-xs text-ink-subtle">{emptyText}</p>
  return (
    <ul className="space-y-1.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex items-start gap-2 text-xs text-ink">
          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          <span className="break-all">{item}</span>
        </li>
      ))}
    </ul>
  )
}

function EnvironmentCard({ env }: { env: EnvironmentView }) {
  const frameworkEntries = Object.entries(env.frameworks ?? {})
  const hardwareEntries =
    env.hardware_requirements != null && typeof env.hardware_requirements === 'object'
      ? Object.entries(env.hardware_requirements as Record<string, unknown>)
      : []
  const hardwareText =
    hardwareEntries.length === 0 ? safeText(env.hardware_requirements) : ''

  return (
    <section className="panel overflow-hidden">
      <div className="panel-header">
        <div className="flex min-w-0 items-center gap-2">
          <Server size={17} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold">环境 {env.environment_id}</h3>
            <p className="mono truncate text-[11px] text-ink-subtle">project_id: {env.project_id}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={env.python_version ? 'success' : 'warning'}>
            Python {env.python_version ?? '未识别'}
          </StatusBadge>
          <StatusBadge tone="neutral">创建于 {formatDateTime(env.created_at)}</StatusBadge>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-2">
        <FieldBlock title="框架版本" source="frameworks" icon={Boxes}>
          {frameworkEntries.length === 0 ? (
            <p className="text-xs text-ink-subtle">后端未返回框架版本。</p>
          ) : (
            <DataTable
              columns={[
                { key: 'name', header: '框架', render: ([name]) => <span className="font-medium">{name}</span> },
                { key: 'version', header: '版本', render: ([, version]) => <span className="mono text-xs">{safeText(version)}</span> },
              ]}
              data={frameworkEntries}
              rowKey={([name]) => name}
            />
          )}
        </FieldBlock>

        <FieldBlock title="依赖清单" source="dependencies" icon={Package}>
          <DataTable<DependencyView>
            columns={[
              { key: 'name', header: '依赖', render: (dep) => <span className="font-medium">{dep.name}</span> },
              { key: 'version', header: '声明版本', render: (dep) => <span className="mono text-xs">{dep.declared_version ?? '未声明'}</span> },
              {
                key: 'source',
                header: '来源',
                render: (dep) => <span className="text-xs text-ink-muted">{dep.source || '—'}</span>,
              },
            ]}
            data={env.dependencies ?? []}
            rowKey={(dep) => `${dep.name}-${dep.declared_version ?? ''}`}
            empty={<p className="text-xs text-ink-subtle">后端未返回依赖清单。</p>}
          />
        </FieldBlock>

        <FieldBlock title="硬件要求" source="hardware_requirements" icon={Cpu}>
          {hardwareEntries.length > 0 ? (
            <DataTable
              columns={[
                { key: 'key', header: '项', render: ([key]) => <span>{key}</span> },
                { key: 'value', header: '要求', render: ([, value]) => <span className="mono text-xs">{safeText(value)}</span> },
              ]}
              data={hardwareEntries}
              rowKey={([key]) => key}
            />
          ) : (
            <p className="whitespace-pre-wrap break-all text-xs text-ink">{hardwareText}</p>
          )}
        </FieldBlock>

        <FieldBlock title="运行入口" source="entrypoints" icon={Terminal}>
          <StringList items={safeList(env.entrypoints)} emptyText="后端未返回运行入口。" />
        </FieldBlock>

        <FieldBlock title="缺失项" source="missing" icon={AlertTriangle}>
          {safeList(env.missing).length === 0 ? (
            <p className="text-xs text-success">后端未报告缺失项。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {safeList(env.missing).map((item, index) => (
                <StatusBadge key={`${item}-${index}`} tone="danger">{item}</StatusBadge>
              ))}
            </div>
          )}
        </FieldBlock>

        <FieldBlock title="告警" source="warnings" icon={ListChecks}>
          {safeList(env.warnings).length === 0 ? (
            <p className="text-xs text-success">后端未报告告警。</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {safeList(env.warnings).map((item, index) => (
                <StatusBadge key={`${item}-${index}`} tone="warning">{item}</StatusBadge>
              ))}
            </div>
          )}
        </FieldBlock>

        {env.changed_from_original && env.changed_from_original.length > 0 && (
          <div className="lg:col-span-2">
            <FieldBlock title="相对原始环境的变更" source="changed_from_original" icon={AlertTriangle}>
              <StringList items={safeList(env.changed_from_original)} emptyText="无变更记录。" />
            </FieldBlock>
          </div>
        )}
      </div>
    </section>
  )
}

export default function ReproductionEnvironmentPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)

  const envQuery = useQuery({
    queryKey: ['repro-environments', pid],
    queryFn: () => reproductionApi.listEnvironments(pid),
    enabled: !!pid,
  })

  if (envQuery.isPending) {
    return <LoadingState message="正在读取复现环境…" hint="GET /reproductions/environments" />
  }
  if (envQuery.isError) {
    return (
      <ErrorState
        message={envQuery.error instanceof Error ? envQuery.error.message : '无法获取复现环境。'}
        code={envQuery.error instanceof ApiError ? envQuery.error.code : undefined}
        onRetry={() => void envQuery.refetch()}
      />
    )
  }

  const environments = envQuery.data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Reproduction Environment</p>
          <h2 className="mt-1 text-lg font-semibold">复现环境</h2>
          <p className="mt-1 text-sm text-ink-muted">
            全部字段来自 GET /reproductions/environments，由后端依据材料解析与静态分析生成，每个区块标注来源字段。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">返回总览</Link>
          <Link to={`/projects/${pid}/reproduction/comparison`} className="btn-ghost">结果对照</Link>
        </div>
      </div>

      {environments.length === 0 ? (
        <div className="panel p-5">
          <EmptyState
            icon={Server}
            title="暂无环境信息"
            description="后端未返回该项目的执行环境。完成材料解析后，环境信息会由后端生成。"
          />
        </div>
      ) : (
        <div className="space-y-5">
          {environments.map((env) => (
            <EnvironmentCard key={env.environment_id} env={env} />
          ))}
        </div>
      )}
    </div>
  )
}
