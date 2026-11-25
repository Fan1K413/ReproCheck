import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { ChevronRight, Eye, Minus, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import type { Permission, Role, RolePermissions } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/**
 * 权限作用域映射：后端 GET /permissions 视图仅含 key/description，
 * 此处按 app/core/rbac.py PERMISSIONS 种子目录还原 org / project 作用域。
 * 注意 project.create 属 org 级、data.export 属 project 级，不能按键前缀推断。
 */
const ORG_SCOPE_KEYS = new Set([
  'org.manage', 'member.manage', 'project.create', 'rule.manage',
  'integration.manage', 'api.manage', 'data.manage',
])

function permScope(key: string): 'org' | 'project' {
  return ORG_SCOPE_KEYS.has(key) ? 'org' : 'project'
}

type Catalog = { roles: Role[]; perms: Permission[]; matrices: RolePermissions[] }

function QueryGate<T>({ state, isEmpty, empty, children }: {
  state: UseQueryResult<T, Error>
  isEmpty: (data: T) => boolean
  empty: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.isPending) return <LoadingState compact message="正在读取 RBAC 目录…" hint="角色、权限与授权矩阵来自后端种子数据" />
  if (state.isError) {
    return (
      <ErrorState
        compact
        message={state.error.message}
        code={state.error instanceof ApiError ? state.error.code : undefined}
        onRetry={() => void state.refetch()}
      />
    )
  }
  if (state.data === undefined || isEmpty(state.data)) return <>{empty}</>
  return <>{children(state.data)}</>
}

const PRIORITY_CHAIN = ['平台管理员', '项目所属组织管理员', '项目成员角色', '组织成员角色']

const SCOPE_FILTERS = [
  { key: 'all', label: '全部作用域' },
  { key: 'org', label: 'org 级' },
  { key: 'project', label: 'project 级' },
] as const

export default function RolesPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [scopeFilter, setScopeFilter] = useState<'all' | 'org' | 'project'>('all')

  const catalogQuery = useQuery({
    queryKey: ['rbac-catalog'],
    queryFn: async (): Promise<Catalog> => {
      const roles = await stage6Api.listRoles()
      const perms = await stage6Api.listPermissions()
      const matrices = await Promise.all(roles.items.map((r) => stage6Api.rolePermissions(r.key)))
      return { roles: roles.items, perms: perms.items, matrices }
    },
  })

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="角色权限"
          description="角色、权限与授权矩阵"
        />

        {/* ---------- 权限判定优先级链 ---------- */}
        <section className="rcw-card rcw-card-tight">
          <div className="rcw-row" style={{ alignItems: 'flex-start', gap: 'var(--rc-space-3)' }}>
            <span className="rcw-kpi-icon">
              <Icon name="shield" size="sm" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">权限判定优先级</p>
              <ol className="mt-2 flex flex-wrap items-center gap-1.5">
                {PRIORITY_CHAIN.map((label, index) => (
                  <li key={label} className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                    {index > 0 && <Icon as={ChevronRight} size="xs" tone="subtle" />}
                    <span
                      className="rcw-chip"
                      style={
                        index === 0
                          ? { backgroundColor: 'var(--rc-accent)', color: 'var(--rc-hi)', borderColor: 'var(--rc-accent)' }
                          : undefined
                      }
                    >
                      {label}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        <QueryGate
          state={catalogQuery}
          isEmpty={(d) => d.roles.length === 0}
          empty={<EmptyState icon={ShieldCheck} title="RBAC 目录为空" description="后端尚未初始化角色种子，请联系平台管理员。" />}
        >
          {(catalog) => {
            const { roles, perms, matrices } = catalog
            const activeKey = selectedKey ?? roles[0]?.key ?? null
            const activeRole = roles.find((r) => r.key === activeKey)
            const activeMatrix = matrices.find((m) => m.role_key === activeKey)
            const grants = new Map(matrices.map((m) => [m.role_key, new Set(m.permissions.map((p) => p.key))]))
            const orgCount = perms.filter((p) => permScope(p.key) === 'org').length
            const visiblePerms =
              scopeFilter === 'all' ? perms : perms.filter((p) => permScope(p.key) === scopeFilter)
            const stats = [
              { label: '角色数', value: roles.length, icon: 'shield' as const },
              { label: '权限数', value: perms.length, icon: 'key' as const },
              { label: 'org 级权限', value: orgCount, icon: 'users' as const },
              { label: 'project 级权限', value: perms.length - orgCount, icon: 'folderKanban' as const },
            ]
            return (
              <>
                {/* ---------- KPI 磁贴 ---------- */}
                <div className="rcw-grid rcw-grid-4 rc-stagger">
                  {stats.map((stat) => (
                    <div key={stat.label} className="rcw-kpi">
                      <span className="rcw-kpi-icon">
                        <Icon name={stat.icon} size="sm" />
                      </span>
                      <div className="min-w-0">
                        <p className="rcw-kpi-value">{stat.value}</p>
                        <p className="rcw-kpi-label">{stat.label}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ---------- 角色清单 + 权限档案 ---------- */}
                <div className="rcw-split rcw-split-wide">
                  <section className="rcw-rail">
                    <div className="rcw-rail-head">
                      <h3 className="text-sm font-semibold">角色档案</h3>
                      <StatusBadge tone="neutral">{roles.length} 个</StatusBadge>
                    </div>
                    <div className="rcw-rail-body">
                      {roles.map((role) => {
                        const active = role.key === activeKey
                        const count = grants.get(role.key)?.size ?? 0
                        return (
                          <button
                            key={role.key}
                            type="button"
                            onClick={() => setSelectedKey(role.key)}
                            aria-pressed={active}
                            className="rcw-rail-item"
                          >
                            <span className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                              <span className="truncate text-sm font-semibold">{role.name}</span>
                              <StatusBadge tone={role.scope === 'org' ? 'navy' : 'accent'} dot={false}>
                                {role.scope === 'org' ? '组织级' : '项目级'}
                              </StatusBadge>
                            </span>
                            <span className="mono mt-1 block truncate text-[11px] rcw-faint">{role.key}</span>
                            <span className="mt-2 flex items-center gap-1.5 text-xs rcw-ink">
                              <Icon name="key" size="xs" />
                              {count} 项权限
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </section>

                  <div className="rcw-stack">
                    {/* 选中角色的权限清单 */}
                    {activeRole && (
                      <section className="rcw-card">
                        <div className="rcw-row-between" style={{ borderBottom: 'var(--rc-stroke-hair)', paddingBottom: 'var(--rc-space-3)' }}>
                          <h3 className="text-sm font-semibold">
                            {activeRole.name} · 权限清单
                            <span className="mono ml-2 text-[11px] font-normal rcw-faint">{activeRole.key}</span>
                          </h3>
                          <StatusBadge tone="accent">{activeMatrix?.permissions.length ?? 0} 项</StatusBadge>
                        </div>
                        {activeMatrix && activeMatrix.permissions.length > 0 ? (
                          <ul className="rcw-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 'var(--rc-space-4) 0 0' }}>
                            {activeMatrix.permissions.map((perm) => (
                              <li
                                key={perm.key}
                                className="rcw-row-between"
                                style={{ borderBottom: 'var(--rc-stroke-hair)', padding: 'var(--rc-space-2) 0' }}
                              >
                                <span className="mono text-xs font-semibold rcw-ink">{perm.key}</span>
                                <span className="min-w-0 flex-1 text-xs rcw-muted">{perm.description}</span>
                                <StatusBadge tone={permScope(perm.key) === 'org' ? 'navy' : 'accent'} dot={false}>
                                  {permScope(perm.key) === 'org' ? 'org 级' : 'project 级'}
                                </StatusBadge>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <EmptyState
                            compact
                            icon={Eye}
                            title="只读角色，无任何授权"
                            description="viewer 仅可查看项目、报告与历史；所有变更操作由后端拒绝并返回 FORBIDDEN。"
                          />
                        )}
                      </section>
                    )}

                    {/* 角色 × 权限矩阵 */}
                    <section className="rcw-card rcw-card-tight">
                      <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                        <h3 className="text-sm font-semibold">角色 × 权限矩阵</h3>
                        <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                          {SCOPE_FILTERS.map((filter) => (
                            <button
                              key={filter.key}
                              type="button"
                              className="rcw-chip rcw-chip-btn"
                              aria-pressed={scopeFilter === filter.key}
                              onClick={() => setScopeFilter(filter.key)}
                            >
                              {filter.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="rcw-row" style={{ gap: 'var(--rc-space-4)', paddingBottom: 'var(--rc-space-3)' }}>
                        <span className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                          <Icon name="check" size="xs" tone="success" />
                          <span className="text-xs rcw-muted">已授权</span>
                        </span>
                        <span className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                          <Icon as={Minus} size="xs" tone="subtle" />
                          <span className="text-xs rcw-muted">未授权</span>
                        </span>
                        <span className="text-[11px] rcw-faint">
                          共 {roles.length} 个角色 · {perms.length} 项权限（org 级 {orgCount} / project 级 {perms.length - orgCount}）
                        </span>
                      </div>
                      <div className="rcw-matrix-wrap">
                        <table className="rcw-matrix" style={{ minWidth: '900px' }}>
                          <thead>
                            <tr>
                              <th scope="col">权限</th>
                              {roles.map((role) => (
                                <th
                                  key={role.key}
                                  scope="col"
                                  className="text-center"
                                  style={role.key === activeKey ? { color: 'var(--rcw-ink)' } : undefined}
                                >
                                  {role.name}
                                  <span className="mono mt-0.5 block text-[10px] font-normal normal-case tracking-normal rcw-faint">
                                    {role.key}
                                  </span>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {visiblePerms.map((perm) => {
                              const scope = permScope(perm.key)
                              return (
                                <tr key={perm.key}>
                                  <td>
                                    <p className="mono text-xs font-semibold">{perm.key}</p>
                                    <p className="mt-0.5 text-[11px] rcw-muted">{perm.description}</p>
                                    <StatusBadge className="mt-1" tone={scope === 'org' ? 'navy' : 'accent'} dot={false}>
                                      {scope === 'org' ? 'org 级' : 'project 级'}
                                    </StatusBadge>
                                  </td>
                                  {roles.map((role) => {
                                    const granted = grants.get(role.key)?.has(perm.key) ?? false
                                    return (
                                      <td
                                        key={role.key}
                                        className="text-center"
                                        style={role.key === activeKey ? { backgroundColor: 'var(--rcw-tint)' } : undefined}
                                      >
                                        {granted ? (
                                          <Icon name="check" size="xs" tone="success" title={`${role.name} 已授权`} />
                                        ) : (
                                          <Icon as={Minus} size="xs" tone="subtle" title={`${role.name} 未授权`} />
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>
                </div>
              </>
            )
          }}
        </QueryGate>
      </div>
    </div>
  )
}
