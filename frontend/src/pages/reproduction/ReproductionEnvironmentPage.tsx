import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle,
  Boxes,
  Cpu,
  ListChecks,
  Package,
  Server,
  Terminal,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DataTable } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { safeList, safeText } from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type { DependencyView, EnvironmentView } from '../../types/reproduction'
import '../../styles/wave-a-repro.css'

type DepState = 'resolved' | 'missing' | 'warning'

function normalizeDependencies(raw: unknown): DependencyView[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    if (typeof item === 'string') {
      const match = item.match(/^([A-Za-z0-9_.\-[\]]+)\s*(?:==|>=|<=|~=|!=|>|<)?\s*(.*)$/)
      return { name: match?.[1] ?? item, declared_version: match?.[2] || null, source: 'requirements' }
    }
    if (item && typeof item === 'object') {
      const dep = item as Record<string, unknown>
      return {
        name: String(dep.name ?? dep.package ?? ''),
        declared_version:
          dep.declared_version != null
            ? String(dep.declared_version)
            : dep.version != null
              ? String(dep.version)
              : null,
        source: typeof dep.source === 'string' ? dep.source : '',
      }
    }
    return { name: String(item), declared_version: null, source: '' }
  })
}

/**
 * 依赖状态必须由后端真实字段判定：
 *   missing[] / warnings[] 中出现该依赖名 → 缺失 / 告警；否则视为已解析。
 * 后端未提供依赖边字段，因此不绘制任何依赖箭头（交互规范 §2.5）。
 */
function resolveDepState(name: string, missing: string[], warnings: string[]): DepState {
  const key = name.trim().toLowerCase()
  if (!key) return 'resolved'
  const hit = (list: string[]) =>
    list.some((item) => {
      const value = item.trim().toLowerCase()
      if (!value) return false
      return value.includes(key) || key.includes(value)
    })
  if (hit(missing)) return 'missing'
  if (hit(warnings)) return 'warning'
  return 'resolved'
}

export default function ReproductionEnvironmentPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)

  const envQuery = useQuery({
    queryKey: ['repro-environments', pid],
    queryFn: () => reproductionApi.listEnvironments(pid),
    enabled: !!pid,
  })

  const [activeEnvId, setActiveEnvId] = useState<string | null>(null)
  const [focusedDep, setFocusedDep] = useState<string | null>(null)

  const environments = useMemo(() => envQuery.data?.items ?? [], [envQuery.data])

  useEffect(() => {
    if (!activeEnvId && environments.length > 0) setActiveEnvId(environments[0].environment_id)
  }, [environments, activeEnvId])

  if (envQuery.isPending) {
    return <LoadingState message="正在读取复现环境…" hint="正在读取后端环境数据" />
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

  if (environments.length === 0) {
    return (
      <div className="rc-wa-page">
        <header className="rc-wa-head">
          <div className="rc-wa-head__text">
            <p className="rc-wa-eyebrow">复现环境</p>
            <h1 className="rc-wa-title">复现环境</h1>
            <p className="rc-wa-lede">
              全部字段来自后端环境数据，由后端依据材料解析与静态分析生成。
            </p>
          </div>
          <div className="rc-wa-head__actions">
            <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">
              返回总览
            </Link>
          </div>
        </header>
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <EmptyState
              icon={Server}
              title="暂无环境信息"
              description="后端未返回该项目的执行环境。完成材料解析后，环境信息会由后端生成。"
            />
          </div>
        </section>
      </div>
    )
  }

  const env =
    environments.find((item) => item.environment_id === activeEnvId) ?? environments[0]

  return (
    <div className="rc-wa-page">
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">Reproduction Environment</p>
          <h1 className="rc-wa-title">复现环境</h1>
          <p className="rc-wa-lede">
            全部字段来自后端环境数据，由后端依据材料解析与静态分析生成，每个区块标注来源字段。
            悬停或聚焦任一依赖可高亮该项并淡化其余依赖（200ms）。
          </p>
        </div>
        <div className="rc-wa-head__actions">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">
            返回总览
          </Link>
          <Link to={`/projects/${pid}/reproduction/comparison`} className="btn-ghost">
            结果对照
          </Link>
        </div>
      </header>

      {environments.length > 1 && (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__head">
            <div className="rc-wa-panel__title">
              <Icon as={Server} size="sm" tone="accent" />
              环境实例
            </div>
            <span className="rc-wa-source">environments[].environment_id</span>
          </div>
          <div className="rc-wa-panel__body">
            <div className="rc-wa-picklist" role="group" aria-label="环境实例列表">
              {environments.map((item) => (
                <button
                  key={item.environment_id}
                  type="button"
                  className="rc-wa-pick"
                  aria-pressed={item.environment_id === env.environment_id}
                  onClick={() => {
                    setActiveEnvId(item.environment_id)
                    setFocusedDep(null)
                  }}
                >
                  <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                    {item.environment_id}
                  </span>
                  <span className="rc-wa-pick__id">
                    Python {item.python_version ?? '未识别'} · {formatDateTime(item.created_at)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

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
            gridTemplateColumns: 'minmax(0, 300px) minmax(0, 1fr)',
            alignItems: 'start',
          }}
        >
          {/* 左 3 列：环境摘要 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Server} size="sm" tone="accent" />
                环境摘要
              </div>
              <span className="rc-wa-source">{env.environment_id}</span>
            </div>
            <div className="rc-wa-panel__body" style={{ display: 'grid', gap: 'var(--rc-space-4)' }}>
              <SummaryBlock icon={Cpu} label="Python 版本" source="python_version">
                <StatusBadge tone={env.python_version ? 'success' : 'warning'}>
                  {env.python_version ?? '未识别'}
                </StatusBadge>
              </SummaryBlock>

              <SummaryBlock icon={Package} label="依赖来源" source="dependencies[].source">
                {(() => {
                  const deps = normalizeDependencies(env.dependencies)
                  const sources = [...new Set(deps.map((dep) => dep.source || '未声明'))]
                  if (deps.length === 0) {
                    return <span className="rc-wa-kpi__hint">后端未返回依赖清单。</span>
                  }
                  return (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
                      {sources.map((source) => (
                        <StatusBadge key={source} tone="neutral" dot={false}>
                          {source} · {deps.filter((dep) => (dep.source || '未声明') === source).length}
                        </StatusBadge>
                      ))}
                    </div>
                  )
                })()}
              </SummaryBlock>

              <SummaryBlock icon={Boxes} label="框架版本" source="frameworks">
                {Object.keys(env.frameworks ?? {}).length === 0 ? (
                  <span className="rc-wa-kpi__hint">后端未返回框架版本。</span>
                ) : (
                  <ul style={{ display: 'grid', gap: 'var(--rc-space-2)' }}>
                    {Object.entries(env.frameworks).map(([name, version]) => (
                      <li
                        key={name}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 'var(--rc-space-3)',
                          fontSize: 'var(--rc-fs-caption)',
                        }}
                      >
                        <span style={{ color: 'var(--rc-text-muted)' }}>{name}</span>
                        <span className="mono" style={{ color: 'var(--rc-text)' }}>
                          {safeText(version)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </SummaryBlock>

              <SummaryBlock icon={Cpu} label="硬件要求" source="hardware_requirements">
                <HardwareView value={env.hardware_requirements} />
              </SummaryBlock>

              <SummaryBlock icon={Terminal} label="运行入口" source="entrypoints">
                {safeList(env.entrypoints).length === 0 ? (
                  <span className="rc-wa-kpi__hint">后端未返回运行入口。</span>
                ) : (
                  <ul style={{ display: 'grid', gap: 'var(--rc-space-2)' }}>
                    {safeList(env.entrypoints).map((item, index) => (
                      <li key={`${item}-${index}`} className="mono" style={{ fontSize: 'var(--rc-fs-mono)' }}>
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </SummaryBlock>
            </div>
          </section>

          {/* 右 9 列：依赖聚焦图 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Package} size="sm" tone="accent" />
                依赖聚焦图
              </div>
              <span className="rc-wa-source">dependencies[] / missing[] / warnings[]</span>
            </div>
            <div className="rc-wa-panel__body">
              <DependencyGraph env={env} focusedDep={focusedDep} onFocus={setFocusedDep} />
            </div>
          </section>
        </div>
      </div>

      {/* 底部：版本偏差表 */}
      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={ListChecks} size="sm" tone="accent" />
            版本偏差表
          </div>
          <span className="rc-wa-source">
            missing[] / warnings[] / changed_from_original[]
          </span>
        </div>
        <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
          <DeviationTable env={env} />
        </div>
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */

function SummaryBlock({
  icon: Glyph,
  label,
  source,
  children,
}: {
  icon: typeof Server
  label: string
  source: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--rc-space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--rc-space-2)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--rc-space-2)', fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)', color: 'var(--rc-text)' }}>
          <Icon as={Glyph} size="xs" tone="accent" />
          {label}
        </span>
        <span className="rc-wa-source">{source}</span>
      </div>
      {children}
    </div>
  )
}

function HardwareView({ value }: { value: unknown }) {
  const entries =
    value != null && typeof value === 'object' && !Array.isArray(value)
      ? Object.entries(value as Record<string, unknown>)
      : []
  if (entries.length === 0) {
    return (
      <p className="rc-wa-kpi__hint" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {safeText(value)}
      </p>
    )
  }
  return (
    <ul style={{ display: 'grid', gap: 'var(--rc-space-2)' }}>
      {entries.map(([key, item]) => (
        <li
          key={key}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--rc-space-3)',
            fontSize: 'var(--rc-fs-caption)',
          }}
        >
          <span style={{ color: 'var(--rc-text-muted)' }}>{key}</span>
          <span className="mono" style={{ color: 'var(--rc-text)' }}>
            {safeText(item)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function DependencyGraph({
  env,
  focusedDep,
  onFocus,
}: {
  env: EnvironmentView
  focusedDep: string | null
  onFocus: (value: string | null) => void
}) {
  const deps = normalizeDependencies(env.dependencies)
  const missing = safeList(env.missing)
  const warnings = safeList(env.warnings)

  const groups = useMemo(() => {
    const map = new Map<string, DependencyView[]>()
    deps.forEach((dep) => {
      const key = dep.source || '未声明来源'
      map.set(key, [...(map.get(key) ?? []), dep])
    })
    return [...map.entries()]
  }, [deps])

  if (deps.length === 0 && missing.length === 0 && warnings.length === 0) {
    return (
      <EmptyState
        compact
        icon={Package}
        title="未识别到依赖"
        description="后端未返回该环境的依赖清单、缺失项或告警。"
      />
    )
  }

  return (
    <div
      className="rc-wa-depgraph"
      data-focused={focusedDep ? 'true' : 'false'}
      onMouseLeave={() => onFocus(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onFocus(null)
      }}
      style={{ display: 'grid', gap: 'var(--rc-space-5)' }}
    >
      {groups.map(([source, items]) => (
        <div className="rc-wa-depgroup" key={source}>
          <div className="rc-wa-depgroup__head">
            <span className="rc-wa-sub">来源 {source}</span>
            <StatusBadge tone="neutral" dot={false}>
              {items.length} 项
            </StatusBadge>
          </div>
          <div className="rc-wa-deps">
            {items.map((dep) => {
              const state = resolveDepState(dep.name, missing, warnings)
              const key = `${source}::${dep.name}`
              return (
                <button
                  key={key}
                  type="button"
                  className={`rc-wa-dep${focusedDep === key ? ' is-focus' : ''}`}
                  data-state={state}
                  aria-label={`包名 ${dep.name}，版本 ${dep.declared_version ?? '未声明'}，来源 ${source}，状态 ${state}`}
                  onMouseEnter={() => onFocus(key)}
                  onFocus={() => onFocus(key)}
                  onBlur={() => onFocus(null)}
                  onClick={() => onFocus(focusedDep === key ? null : key)}
                >
                  <span className="rc-wa-dep__dot" aria-hidden="true" />
                  <span>{dep.name}</span>
                  <span className="rc-wa-dep__ver">{dep.declared_version ?? '未声明'}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {missing.length > 0 && (
        <div className="rc-wa-depgroup">
          <div className="rc-wa-depgroup__head">
            <span className="rc-wa-sub">缺失项 missing[]</span>
            <StatusBadge tone="danger" dot={false}>
              {missing.length} 项
            </StatusBadge>
          </div>
          <div className="rc-wa-deps">
            {missing.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="rc-wa-dep"
                data-state="missing"
                style={{ cursor: 'default' }}
              >
                <Icon as={TriangleAlert} size="xs" tone="danger" />
                <span>{item}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {warnings.length > 0 && (
        <div className="rc-wa-depgroup">
          <div className="rc-wa-depgroup__head">
            <span className="rc-wa-sub">告警 warnings[]</span>
            <StatusBadge tone="warning" dot={false}>
              {warnings.length} 项
            </StatusBadge>
          </div>
          <div className="rc-wa-deps">
            {warnings.map((item, index) => (
              <span
                key={`${item}-${index}`}
                className="rc-wa-dep"
                data-state="warning"
                style={{ cursor: 'default', maxWidth: '100%', whiteSpace: 'normal' }}
              >
                <Icon as={AlertTriangle} size="xs" tone="warning" />
                <span>{item}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DeviationTable({ env }: { env: EnvironmentView }) {
  type Row = { kind: string; item: string; source: string; tone: 'danger' | 'warning' | 'neutral' }
  const rows: Row[] = [
    ...safeList(env.missing).map((item) => ({
      kind: '缺失',
      item,
      source: 'missing[]',
      tone: 'danger' as const,
    })),
    ...safeList(env.warnings).map((item) => ({
      kind: '告警',
      item,
      source: 'warnings[]',
      tone: 'warning' as const,
    })),
    ...safeList(env.changed_from_original).map((item) => ({
      kind: '变更',
      item,
      source: 'changed_from_original[]',
      tone: 'neutral' as const,
    })),
  ]

  return (
    <DataTable<Row>
      columns={[
        {
          key: 'kind',
          header: '类型',
          render: (row) => (
            <StatusBadge tone={row.tone} dot={false}>
              {row.kind}
            </StatusBadge>
          ),
        },
        {
          key: 'item',
          header: '条目',
          render: (row) => <span style={{ overflowWrap: 'anywhere' }}>{row.item}</span>,
        },
        {
          key: 'source',
          header: '来源字段',
          render: (row) => <span className="mono rc-wa-pick__id">{row.source}</span>,
        },
      ]}
      data={rows}
      rowKey={(row) => `${row.source}-${row.item}`}
      empty={
        <div style={{ padding: 'var(--rc-space-5)' }}>
          <EmptyState
            compact
            icon={ListChecks}
            title="无版本偏差"
            description="后端未报告缺失项、告警或相对原始环境的变更。"
          />
        </div>
      }
    />
  )
}
