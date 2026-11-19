import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { Check, ChevronRight, Eye, KeyRound, Minus, ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import type { Permission, Role, RolePermissions } from '../../types/stage6'

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

export default function RolesPage() {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

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
    <div className="space-y-5">
      <PageHeader
        title="角色权限"
        description="平台 RBAC 目录：6 个角色与 18 项权限的授权矩阵，只读展示，数据来自 GET /roles、GET /permissions 与各角色授权清单。"
      />

      <section className="panel flex flex-wrap items-center gap-x-4 gap-y-3 p-4">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
          <ShieldCheck size={18} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-ink">权限判定优先级</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {PRIORITY_CHAIN.map((label, index) => (
              <span key={label} className="flex items-center gap-1.5">
                {index > 0 && <ChevronRight size={16} strokeWidth={1.8} className="text-ink-subtle" />}
                <span className={`rounded px-2 py-1 font-medium ${index === 0 ? 'bg-navy-100 text-navy-800' : 'bg-accent-wash text-accent-dark'}`}>
                  {label}
                </span>
              </span>
            ))}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-subtle">
            所有判定在后端执行，前端隐藏按钮不构成权限；越权请求将收到 FORBIDDEN 错误并留痕。
          </p>
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
          const stats = [
            { label: '角色数', value: roles.length },
            { label: '权限数', value: perms.length },
            { label: 'org 级权限', value: orgCount },
            { label: 'project 级权限', value: perms.length - orgCount },
          ]
          return (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {stats.map((stat) => (
                  <div key={stat.label} className="panel px-4 py-3">
                    <p className="text-xs text-ink-muted">{stat.label}</p>
                    <p className="mono mt-1 text-xl font-semibold text-ink">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {roles.map((role) => {
                  const active = role.key === activeKey
                  const count = grants.get(role.key)?.size ?? 0
                  return (
                    <button
                      key={role.key}
                      type="button"
                      onClick={() => setSelectedKey(role.key)}
                      aria-pressed={active}
                      className={`panel p-4 text-left transition ${
                        active ? 'border-accent ring-2 ring-accent' : 'hover:border-accent hover:shadow-pop'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-ink">{role.name}</span>
                        <StatusBadge tone={role.scope === 'org' ? 'navy' : 'accent'} dot={false}>
                          {role.scope === 'org' ? '组织级' : '项目级'}
                        </StatusBadge>
                      </span>
                      <span className="mono mt-1 block text-[11px] text-ink-subtle">{role.key}</span>
                      <span className="mt-2 line-clamp-2 block text-xs leading-relaxed text-ink-muted">{role.description}</span>
                      <span className="mt-3 flex items-center gap-1.5 text-xs font-medium text-accent-dark">
                        <KeyRound size={16} strokeWidth={1.8} />
                        {count} 项权限
                      </span>
                    </button>
                  )
                })}
              </div>

              {activeRole && (
                <section className="panel overflow-hidden">
                  <div className="panel-header">
                    <h3 className="text-sm font-semibold">
                      {activeRole.name} · 权限清单
                      <span className="mono ml-2 text-[11px] font-normal text-ink-subtle">{activeRole.key}</span>
                    </h3>
                    <StatusBadge tone="accent">{activeMatrix?.permissions.length ?? 0} 项</StatusBadge>
                  </div>
                  {activeMatrix && activeMatrix.permissions.length > 0 ? (
                    <ul className="divide-y divide-line-soft">
                      {activeMatrix.permissions.map((perm) => (
                        <li key={perm.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5">
                          <span className="mono text-xs font-semibold text-accent-dark">{perm.key}</span>
                          <span className="text-xs text-ink-muted">{perm.description}</span>
                          <StatusBadge className="ml-auto" tone={permScope(perm.key) === 'org' ? 'navy' : 'accent'} dot={false}>
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

              <section className="panel overflow-hidden">
                <div className="panel-header">
                  <h3 className="text-sm font-semibold">角色 × 权限矩阵</h3>
                  <div className="flex items-center gap-4 text-xs text-ink-muted">
                    <span className="flex items-center gap-1.5">
                      <Check size={16} strokeWidth={1.8} className="text-success" />
                      已授权
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Minus size={16} strokeWidth={1.8} className="text-ink-subtle" />
                      未授权
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="data-table min-w-[900px]">
                    <thead>
                      <tr>
                        <th className="sticky left-0 z-10 border-r border-line bg-canvas">权限</th>
                        {roles.map((role) => (
                          <th key={role.key} className="text-center">
                            {role.name}
                            <span className="mono mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-ink-subtle">
                              {role.key}
                            </span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perms.map((perm) => {
                        const scope = permScope(perm.key)
                        return (
                          <tr key={perm.key}>
                            <td className="sticky left-0 z-10 min-w-[260px] border-r border-line bg-surface">
                              <p className="mono text-xs font-semibold text-ink">{perm.key}</p>
                              <p className="mt-0.5 text-[11px] text-ink-muted">{perm.description}</p>
                              <StatusBadge className="mt-1" tone={scope === 'org' ? 'navy' : 'accent'} dot={false}>
                                {scope === 'org' ? 'org 级' : 'project 级'}
                              </StatusBadge>
                            </td>
                            {roles.map((role) => (
                              <td key={role.key} className="text-center align-middle">
                                {grants.get(role.key)?.has(perm.key) ? (
                                  <Check size={16} strokeWidth={1.8} className="mx-auto text-success" aria-label={`${role.name} 已授权`} />
                                ) : (
                                  <Minus size={16} strokeWidth={1.8} className="mx-auto text-ink-subtle" aria-label={`${role.name} 未授权`} />
                                )}
                              </td>
                            ))}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-line-soft px-5 py-3 text-[11px] text-ink-subtle">
                  共 {roles.length} 个角色 · {perms.length} 项权限（org 级 {orgCount} / project 级 {perms.length - orgCount}）；
                  矩阵与后端 app/core/rbac.py 种子一致，组织管理员默认拥有全部权限。
                </div>
              </section>
            </>
          )
        }}
      </QueryGate>
    </div>
  )
}