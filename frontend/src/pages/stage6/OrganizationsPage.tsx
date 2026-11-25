import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  Ban,
  Briefcase,
  Building2,
  Mail,
  Network,
  UserMinus,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useState, type ReactNode } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge, type Tone } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { formatDateTime } from '../../features/format'
import { INVITATION_STATUS, ORG_ROLES } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type { Invitation, InvitationCreated, OrgMember, Team } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/** 后端 org_service.update_member_role / create_invitation 仅允许这两个组织角色键。 */
const ORG_ROLE_KEYS = ['org_admin', 'member']

function orgRole(key: string): { label: string; tone: Tone } {
  return ORG_ROLES[key] ?? { label: key, tone: 'neutral' }
}
function inviteStatus(key: string): { label: string; tone: Tone } {
  return INVITATION_STATUS[key] ?? { label: key, tone: 'neutral' }
}

function initialOf(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name || email || '?').trim()
  return source.slice(0, 1).toUpperCase()
}

/** 统一查询渲染门禁：加载 / 错误（含 FORBIDDEN 后端原文）/ 空态 / 数据。 */
function QueryGate<T>({ state, isEmpty, empty, children }: {
  state: UseQueryResult<T, Error>
  isEmpty: (data: T) => boolean
  empty: ReactNode
  children: (data: T) => ReactNode
}) {
  if (state.isPending) return <LoadingState compact message="正在加载…" />
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

/** 名称 + 描述创建弹窗（组织 / 团队 / 工作空间共用），内置必填校验。 */
function NameDescModal({ open, title, description, nameLabel, pending, onClose, onSubmit }: {
  open: boolean; title: string; description: string; nameLabel: string; pending: boolean
  onClose: () => void; onSubmit: (name: string, desc: string) => void
}) {
  const uid = useId()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setName(''); setDesc(''); setError(null) } }, [open])
  const submit = () => {
    if (!name.trim()) { setError(`请输入${nameLabel}`); return }
    onSubmit(name.trim(), desc.trim())
  }
  return (
    <Modal open={open} title={title} description={description} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" disabled={pending} onClick={submit}>
            <Icon name="plus" size="xs" />{pending ? '创建中…' : '创建'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div>
          <label className="field-label" htmlFor={`${uid}-name`}>{nameLabel} *</label>
          <input id={`${uid}-name`} className="field-input" value={name} placeholder={`请输入${nameLabel}`}
            onChange={(e) => { setName(e.target.value); setError(null) }} />
          {error && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{error}</p>}
        </div>
        <div>
          <label className="field-label" htmlFor={`${uid}-desc`}>描述</label>
          <textarea id={`${uid}-desc`} className="field-input" rows={3} value={desc} placeholder="研究方向、职责范围等补充说明（可选）" onChange={(e) => setDesc(e.target.value)} />
        </div>
      </div>
    </Modal>
  )
}

function ConfirmModal({ open, title, description, warning, confirmLabel, icon: IconGlyph, pending, onClose, onConfirm }: {
  open: boolean; title: string; description: string; warning: string; confirmLabel: string
  icon: LucideIcon; pending: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="rcw-danger" disabled={pending} onClick={onConfirm}>
            <Icon as={IconGlyph} size="xs" />{pending ? '处理中…' : confirmLabel}
          </button>
        </>
      }>
      <div className="rcw-note rcw-note--danger">{warning}</div>
    </Modal>
  )
}

/** 成员卡：组织成员矩阵中的一格（角色就地变更 + 移除入口）。 */
function MemberCard({ member, pending, onRole, onRemove }: {
  member: OrgMember
  pending: boolean
  onRole: (roleKey: string) => void
  onRemove: () => void
}) {
  const meta = orgRole(member.role_key)
  return (
    <article className="rcw-card rcw-card-tight rcw-card-hover">
      <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
        <span className="rcw-avatar" aria-hidden="true">{initialOf(member.display_name, member.email)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{member.display_name || '（未命名）'}</p>
          <p className="mono mt-0.5 truncate text-[11px] rcw-faint">{member.email}</p>
        </div>
        <button
          type="button"
          className="rcw-icon-btn"
          title="移除成员"
          aria-label={`移除成员 ${member.display_name || member.email}`}
          onClick={onRemove}
        >
          <Icon as={UserMinus} size="xs" />
        </button>
      </div>
      <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
        <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        <span className="mono text-[11px] rcw-faint">{formatDateTime(member.joined_at)}</span>
      </div>
      <label className="rcw-overline" htmlFor={`org-role-${member.user_id}`} style={{ display: 'block', marginTop: 'var(--rc-space-3)' }}>
        组织角色
      </label>
      <select
        id={`org-role-${member.user_id}`}
        className="rcw-mini-select mt-1 w-full"
        value={member.role_key}
        disabled={pending}
        onChange={(e) => onRole(e.target.value)}
        aria-label={`修改 ${member.display_name || member.email} 的组织角色`}
      >
        {ORG_ROLE_KEYS.map((key) => <option key={key} value={key}>{ORG_ROLES[key].label}</option>)}
      </select>
    </article>
  )
}

/** 团队卡片：展开后加载团队成员，并支持从组织成员中增补（排除已加入者）。 */
function TeamCard({ team, orgId, orgMembers }: { team: Team; orgId: string; orgMembers: OrgMember[] }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [userId, setUserId] = useState('')
  const [roleInTeam, setRoleInTeam] = useState('member')
  const [error, setError] = useState<string | null>(null)
  const membersQuery = useQuery({ queryKey: ['team-members', team.id], queryFn: () => stage6Api.listTeamMembers(team.id), enabled: expanded })
  const addMutation = useMutation({
    mutationFn: () => stage6Api.addTeamMember(team.id, { user_id: userId, role_in_team: roleInTeam.trim() || 'member' }),
    onSuccess: async () => {
      toast.success('团队成员已添加')
      setUserId('')
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['team-members', team.id] }),
        queryClient.invalidateQueries({ queryKey: ['org-teams', orgId] }),
      ])
    },
    onError: (e) => toast.error(e.message),
  })
  const existing = new Set((membersQuery.data?.items ?? []).map((m) => m.user_id))
  const candidates = orgMembers.filter((m) => !existing.has(m.user_id))
  return (
    <article className="rcw-card rcw-card-tight">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        className="rcw-row w-full text-left"
        style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start', cursor: 'pointer' }}
      >
        <span className="rcw-kpi-icon" aria-hidden="true">
          <Icon as={Network} size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
            <span className="truncate text-sm font-semibold">{team.name}</span>
            <StatusBadge tone="neutral">{team.member_count} 人</StatusBadge>
          </span>
          <span className="mt-0.5 block truncate text-xs rcw-muted">{team.description || '暂无描述'}</span>
        </span>
        <Icon name="chevronDown" size="xs" tone="subtle" style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform var(--rc-dur-base) var(--rc-ease-out)' }} />
      </button>
      {expanded && (
        <div className="rcw-stack-tight" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
          <QueryGate state={membersQuery} isEmpty={(d) => d.items.length === 0}
            empty={<EmptyState compact icon={Users} title="团队暂无成员" description="从组织成员中选择用户加入团队。" />}>
            {(data) => (
              <ul className="rcw-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {data.items.map((m) => (
                  <li key={m.user_id} className="rcw-row-between" style={{ padding: 'var(--rc-space-2) 0', borderBottom: 'var(--rc-stroke-hair)' }}>
                    <span className="mono truncate text-xs rcw-muted">{m.email || m.user_id}</span>
                    <StatusBadge tone="accent" dot={false}>{m.role_in_team}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </QueryGate>
          <div className="rcw-card rcw-card-flat rcw-card-tight">
            <p className="field-label" style={{ marginBottom: 'var(--rc-space-2)' }}>添加团队成员</p>
            <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-end' }}>
              <select className="field-input min-w-[180px] flex-1 py-2 text-xs" value={userId} aria-label="选择组织成员"
                onChange={(e) => { setUserId(e.target.value); setError(null) }}>
                <option value="">选择组织成员…</option>
                {candidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}（{m.email}）</option>)}
              </select>
              <input className="field-input w-[120px] py-2 text-xs" value={roleInTeam} placeholder="member" aria-label="团队内角色" onChange={(e) => setRoleInTeam(e.target.value)} />
              <button type="button" className="btn-primary px-3 py-2 text-xs" disabled={addMutation.isPending}
                onClick={() => { if (!userId) { setError('请选择要加入的成员'); return } addMutation.mutate() }}>
                <Icon as={UserPlus} size="xs" />添加
              </button>
            </div>
            {candidates.length === 0 && <p className="mt-1.5 text-[11px] rcw-faint">所有组织成员均已加入该团队。</p>}
            {error && <p className="mt-1.5 text-xs" style={{ color: 'var(--rc-danger)' }}>{error}</p>}
          </div>
        </div>
      )}
    </article>
  )
}

export default function OrganizationsPage() {
  const queryClient = useQueryClient()
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [tab, setTab] = useState('members')
  const [orgModalOpen, setOrgModalOpen] = useState(false)
  const [teamModalOpen, setTeamModalOpen] = useState(false)
  const [wsModalOpen, setWsModalOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<Invitation | null>(null)
  const [lastInvite, setLastInvite] = useState<InvitationCreated | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviteError, setInviteError] = useState<string | null>(null)

  const orgsQuery = useQuery({ queryKey: ['orgs'], queryFn: stage6Api.listOrgs })
  const orgId = selectedOrgId ?? orgsQuery.data?.items[0]?.id ?? null
  const orgQuery = useQuery({ queryKey: ['org', orgId], queryFn: () => stage6Api.getOrg(orgId ?? ''), enabled: Boolean(orgId) })
  const membersQuery = useQuery({ queryKey: ['org-members', orgId], queryFn: () => stage6Api.listOrgMembers(orgId ?? ''), enabled: Boolean(orgId) })
  const invitationsQuery = useQuery({ queryKey: ['org-invitations', orgId], queryFn: () => stage6Api.listInvitations(orgId ?? ''), enabled: Boolean(orgId) })
  const teamsQuery = useQuery({ queryKey: ['org-teams', orgId], queryFn: () => stage6Api.listTeams(orgId ?? ''), enabled: Boolean(orgId) })
  const workspacesQuery = useQuery({ queryKey: ['org-workspaces', orgId], queryFn: () => stage6Api.listWorkspaces(orgId ?? ''), enabled: Boolean(orgId) })

  useEffect(() => { setLastInvite(null); setTab('members') }, [orgId])

  const createOrgMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) => stage6Api.createOrg(body),
    onSuccess: async (org) => {
      toast.success(`组织「${org.name}」已创建`)
      setOrgModalOpen(false)
      setSelectedOrgId(org.id)
      await queryClient.invalidateQueries({ queryKey: ['orgs'] })
    },
    onError: (e) => toast.error(e.message),
  })
  const roleMutation = useMutation({
    mutationFn: (v: { userId: string; roleKey: string }) => stage6Api.updateOrgMember(orgId ?? '', v.userId, v.roleKey),
    onSuccess: async () => {
      toast.success('组织角色已更新')
      await queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })
  const removeMutation = useMutation({
    mutationFn: (userId: string) => stage6Api.removeOrgMember(orgId ?? '', userId),
    onSuccess: async (data, userId) => {
      const name = membersQuery.data?.items.find((m) => m.user_id === userId)?.display_name
      toast.success(`已移除成员${name ? `「${name}」` : ''}，同步撤销其项目权限（涉及本组织 ${data.revoked_projects} 个项目）`)
      setRemoveTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['org-members', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })
  const inviteMutation = useMutation({
    mutationFn: (body: { email: string; role_key: string }) => stage6Api.createInvitation(orgId ?? '', body),
    onSuccess: async (data) => {
      toast.success('邀请已创建，请复制令牌并发送给受邀者')
      setLastInvite(data)
      setInviteEmail('')
      setInviteError(null)
      await queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })
  const revokeMutation = useMutation({
    mutationFn: (invId: string) => stage6Api.revokeInvitation(invId),
    onSuccess: async () => {
      toast.success('邀请已撤销，令牌立即失效')
      setRevokeTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['org-invitations', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })
  const teamMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) => stage6Api.createTeam(orgId ?? '', body),
    onSuccess: async (team) => {
      toast.success(`团队「${team.name}」已创建`)
      setTeamModalOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['org-teams', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })
  const wsMutation = useMutation({
    mutationFn: (body: { name: string; description: string }) => stage6Api.createWorkspace(orgId ?? '', body),
    onSuccess: async (ws) => {
      toast.success(`工作空间「${ws.name}」已创建`)
      setWsModalOpen(false)
      await queryClient.invalidateQueries({ queryKey: ['org-workspaces', orgId] })
    },
    onError: (e) => toast.error(e.message),
  })

  const submitInvite = () => {
    const email = inviteEmail.trim()
    if (!email) { setInviteError('请输入受邀邮箱'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setInviteError('邮箱格式不正确'); return }
    inviteMutation.mutate({ email, role_key: inviteRole })
  }

  const orgMembers = membersQuery.data?.items ?? []
  const pendingInvites = (invitationsQuery.data?.items ?? []).filter((inv) => inv.status === 'pending').length
  const kpis = [
    { label: '我的组织', value: orgsQuery.data?.total ?? 0, icon: 'folder' as const },
    { label: '组织成员', value: membersQuery.data?.total ?? 0, icon: 'users' as const },
    { label: '待接受邀请', value: pendingInvites, icon: 'inbox' as const },
    { label: '团队 / 工作空间', value: `${teamsQuery.data?.total ?? 0} / ${workspacesQuery.data?.total ?? 0}`, icon: 'network' as const },
  ]

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="组织与成员"
          description="组织、成员与工作空间"
          actions={
            <button type="button" className="btn-primary" onClick={() => setOrgModalOpen(true)}>
              <Icon name="plus" size="xs" />新建组织
            </button>
          }
        />

        <div className="rcw-grid rcw-grid-4 rc-stagger">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rcw-kpi">
              <span className="rcw-kpi-icon"><Icon name={kpi.icon} size="sm" /></span>
              <div className="min-w-0">
                <p className="rcw-kpi-value">{kpi.value}</p>
                <p className="rcw-kpi-label">{kpi.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rcw-split rcw-split-wide">
          {/* ---------- 组织档案轨 ---------- */}
          <section className="rcw-rail">
            <div className="rcw-rail-head">
              <h3 className="text-sm font-semibold">我的组织</h3>
              {orgsQuery.data && <StatusBadge tone="neutral">{orgsQuery.data.total} 个</StatusBadge>}
            </div>
            <div className="rcw-rail-body rcw-rail-scroll">
              <QueryGate
                state={orgsQuery}
                isEmpty={(d) => d.items.length === 0}
                empty={
                  <EmptyState
                    compact
                    icon={Building2}
                    title="尚未加入任何组织"
                    description="创建一个科研组织，开始邀请成员协作。"
                    action={
                      <button type="button" className="btn-primary" onClick={() => setOrgModalOpen(true)}>
                        <Icon name="plus" size="xs" />新建组织
                      </button>
                    }
                  />
                }
              >
                {(data) => data.items.map((org) => {
                  const active = org.id === orgId
                  return (
                    <button
                      key={org.id}
                      type="button"
                      onClick={() => setSelectedOrgId(org.id)}
                      aria-pressed={active}
                      className="rcw-rail-item"
                    >
                      <span className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                        <span className="truncate text-sm font-semibold">{org.name}</span>
                        {org.role_key && (
                          <StatusBadge tone={orgRole(org.role_key).tone} dot={false}>{orgRole(org.role_key).label}</StatusBadge>
                        )}
                      </span>
                      <span className="mono mt-1 block truncate text-[11px] rcw-faint">{org.slug}</span>
                      <span className="mt-1 line-clamp-2 block text-xs rcw-muted">{org.description || '暂无描述'}</span>
                      <span className="mt-1.5 block text-[11px] rcw-faint">创建于 {formatDateTime(org.created_at)}</span>
                    </button>
                  )
                })}
              </QueryGate>
            </div>
          </section>

          {/* ---------- 组织档案主体 ---------- */}
          <div className="rcw-stack">
            {!orgId ? (
              <section className="rcw-card">
                <EmptyState icon={Building2} title="尚未选择组织" description="从左侧选择一个组织，或创建新的科研组织。" />
              </section>
            ) : (
              <>
                <QueryGate state={orgQuery} isEmpty={() => false} empty={null}>
                  {(org) => (
                    <section className="rcw-card rcw-card-glass">
                      <div className="rcw-row-between" style={{ alignItems: 'flex-start' }}>
                        <div className="min-w-0">
                          <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                            <span className="rcw-kpi-icon"><Icon as={Building2} size="sm" /></span>
                            <h3 className="text-base font-semibold">{org.name}</h3>
                            {org.role_key && <StatusBadge tone={orgRole(org.role_key).tone}>{orgRole(org.role_key).label}</StatusBadge>}
                          </div>
                          <p className="mono mt-2 text-[11px] rcw-faint">{org.slug} · {org.id}</p>
                          <p className="mt-1.5 max-w-2xl text-sm rcw-muted">{org.description || '暂无描述'}</p>
                        </div>
                        <div className="text-right text-xs rcw-faint">
                          <p>创建于</p>
                          <p className="mono mt-0.5">{formatDateTime(org.created_at)}</p>
                        </div>
                      </div>
                    </section>
                  )}
                </QueryGate>

                <section className="rcw-card">
                  <div style={{ padding: '0 var(--rc-space-2) var(--rc-space-1)' }}>
                    <Tabs
                      active={tab}
                      onChange={setTab}
                      tabs={[
                        { key: 'members', label: '成员', icon: Users, count: membersQuery.data?.total },
                        { key: 'invitations', label: '邀请', icon: Mail, count: invitationsQuery.data?.total },
                        { key: 'teams', label: '团队', icon: Network, count: teamsQuery.data?.total },
                        { key: 'workspaces', label: '工作空间', icon: Briefcase, count: workspacesQuery.data?.total },
                      ]}
                    />
                  </div>

                  <div className="rcw-stack" style={{ marginTop: 'var(--rc-space-4)' }}>
                    {tab === 'members' && (
                      <>
                        <p className="text-xs rcw-faint">
                          角色变更与成员移除需组织管理员权限；移除成员将同步撤销其在本组织全部项目中的成员身份。
                        </p>
                        <QueryGate
                          state={membersQuery}
                          isEmpty={(d) => d.items.length === 0}
                          empty={<EmptyState compact icon={Users} title="暂无组织成员" description="通过「邀请」页签发送邀请令牌吸纳成员。" />}
                        >
                          {(data) => (
                            <div className="rcw-grid rcw-grid-3">
                              {data.items.map((member) => (
                                <MemberCard
                                  key={member.user_id}
                                  member={member}
                                  pending={roleMutation.isPending && roleMutation.variables?.userId === member.user_id}
                                  onRole={(roleKey) => roleMutation.mutate({ userId: member.user_id, roleKey })}
                                  onRemove={() => setRemoveTarget(member)}
                                />
                              ))}
                            </div>
                          )}
                        </QueryGate>
                      </>
                    )}

                    {tab === 'invitations' && (
                      <>
                        <div className="rcw-card rcw-card-flat rcw-card-tight">
                          <p className="field-label" style={{ marginBottom: 'var(--rc-space-3)' }}>创建邀请</p>
                          <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-end' }}>
                            <input
                              className="field-input min-w-[220px] flex-1"
                              type="email"
                              value={inviteEmail}
                              aria-label="受邀邮箱"
                              placeholder="受邀者邮箱，例如 researcher@lab.edu"
                              onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null) }}
                            />
                            <select className="field-input w-[150px]" value={inviteRole} aria-label="邀请组织角色" onChange={(e) => setInviteRole(e.target.value)}>
                              {ORG_ROLE_KEYS.map((key) => <option key={key} value={key}>{ORG_ROLES[key].label}</option>)}
                            </select>
                            <button type="button" className="btn-primary" disabled={inviteMutation.isPending} onClick={submitInvite}>
                              <Icon as={Mail} size="xs" />{inviteMutation.isPending ? '创建中…' : '发送邀请'}
                            </button>
                          </div>
                          {inviteError && <p className="mt-1.5 text-xs" style={{ color: 'var(--rc-danger)' }}>{inviteError}</p>}
                        </div>

                        {lastInvite && (
                          <div className="rcw-note">
                            <div className="rcw-row-between">
                              <p className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                <Icon name="key" size="xs" />
                                <span className="text-xs font-semibold">邀请令牌（仅显示一次）</span>
                              </p>
                              <button
                                type="button"
                                className="rcw-icon-btn"
                                style={{ color: 'var(--rc-text-muted)' }}
                                title="我已保存，关闭提示"
                                aria-label="关闭令牌提示"
                                onClick={() => setLastInvite(null)}
                              >
                                <Icon name="x" size="xs" />
                              </button>
                            </div>
                            <p className="mono mt-2 break-all rounded-md px-3 py-2 text-sm font-semibold"
                              style={{ backgroundColor: 'var(--rc-surface)', border: 'var(--rc-stroke-hair)' }}>
                              {lastInvite.token}
                            </p>
                            <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-2)' }}>
                              <p className="text-xs leading-relaxed rcw-muted">
                                令牌仅显示一次，关闭后无法再次查看，请先复制保存。
                              </p>
                              <CopyButton text={lastInvite.token} label="复制令牌" />
                            </div>
                          </div>
                        )}

                        <QueryGate
                          state={invitationsQuery}
                          isEmpty={(d) => d.items.length === 0}
                          empty={<EmptyState compact icon={Mail} title="暂无邀请记录" description="创建邀请后，令牌与状态会显示在这里。" />}
                        >
                          {(data) => (
                            <div className="rcw-grid rcw-grid-2">
                              {data.items.map((inv) => (
                                <article key={inv.id} className="rcw-card rcw-card-tight">
                                  <div className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                                    <span className="mono truncate text-xs font-semibold">{inv.email}</span>
                                    <StatusBadge tone={inviteStatus(inv.status).tone}>{inviteStatus(inv.status).label}</StatusBadge>
                                  </div>
                                  <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginTop: 'var(--rc-space-3)' }}>
                                    <StatusBadge tone={orgRole(inv.role_key).tone}>{orgRole(inv.role_key).label}</StatusBadge>
                                    <span className="mono text-[11px] rcw-faint">过期 {formatDateTime(inv.expires_at)}</span>
                                  </div>
                                  <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                                    <span className="mono text-[11px] rcw-faint">创建 {formatDateTime(inv.created_at)}</span>
                                    {inv.status === 'pending' ? (
                                      <button
                                        type="button"
                                        className="rcw-icon-btn"
                                        title="撤销邀请"
                                        aria-label={`撤销对 ${inv.email} 的邀请`}
                                        onClick={() => setRevokeTarget(inv)}
                                      >
                                        <Icon as={Ban} size="xs" />
                                      </button>
                                    ) : (
                                      <span className="text-xs rcw-faint">—</span>
                                    )}
                                  </div>
                                </article>
                              ))}
                            </div>
                          )}
                        </QueryGate>
                      </>
                    )}

                    {tab === 'teams' && (
                      <>
                        <div className="rcw-row-between">
                          <p className="text-xs rcw-faint">点击团队卡片展开成员管理；新建团队与增补成员需组织管理员权限。</p>
                          <button type="button" className="btn-primary" onClick={() => setTeamModalOpen(true)}>
                            <Icon name="plus" size="xs" />新建团队
                          </button>
                        </div>
                        <QueryGate
                          state={teamsQuery}
                          isEmpty={(d) => d.items.length === 0}
                          empty={
                            <EmptyState
                              compact
                              icon={Network}
                              title="暂无团队"
                              description="按研究方向或任务组建团队，便于分工协作。"
                              action={
                                <button type="button" className="btn-primary" onClick={() => setTeamModalOpen(true)}>
                                  <Icon name="plus" size="xs" />新建团队
                                </button>
                              }
                            />
                          }
                        >
                          {(data) => (
                            <div className="rcw-grid rcw-grid-2">
                              {data.items.map((team) => <TeamCard key={team.id} team={team} orgId={orgId} orgMembers={orgMembers} />)}
                            </div>
                          )}
                        </QueryGate>
                      </>
                    )}

                    {tab === 'workspaces' && (
                      <>
                        <div className="rcw-row-between">
                          <p className="text-xs rcw-faint">工作空间用于按投稿或课题归组项目档案。</p>
                          <button type="button" className="btn-primary" onClick={() => setWsModalOpen(true)}>
                            <Icon name="plus" size="xs" />新建工作空间
                          </button>
                        </div>
                        <QueryGate
                          state={workspacesQuery}
                          isEmpty={(d) => d.items.length === 0}
                          empty={
                            <EmptyState
                              compact
                              icon={Briefcase}
                              title="暂无工作空间"
                              description="例如为「CVPR 2026 投稿」建立独立工作空间。"
                              action={
                                <button type="button" className="btn-primary" onClick={() => setWsModalOpen(true)}>
                                  <Icon name="plus" size="xs" />新建工作空间
                                </button>
                              }
                            />
                          }
                        >
                          {(data) => (
                            <div className="rcw-grid rcw-grid-3">
                              {data.items.map((ws) => (
                                <article key={ws.id} className="rcw-card rcw-card-tight rcw-card-hover">
                                  <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                    <span className="rcw-kpi-icon" style={{ width: 32, height: 32 }}>
                                      <Icon as={Briefcase} size="xs" />
                                    </span>
                                    <p className="truncate text-sm font-semibold">{ws.name}</p>
                                  </div>
                                  <p className="mt-2 line-clamp-2 text-xs rcw-muted">{ws.description || '暂无描述'}</p>
                                  <p className="mono mt-2 truncate text-[11px] rcw-faint">{ws.id}</p>
                                </article>
                              ))}
                            </div>
                          )}
                        </QueryGate>
                      </>
                    )}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>

      <NameDescModal
        open={orgModalOpen}
        title="新建组织"
        nameLabel="组织名称"
        pending={createOrgMutation.isPending}
        description="创建者自动成为组织管理员；组织 slug 由后端生成。"
        onClose={() => setOrgModalOpen(false)}
        onSubmit={(name, description) => createOrgMutation.mutate({ name, description })}
      />
      <NameDescModal
        open={teamModalOpen}
        title="新建团队"
        nameLabel="团队名称"
        pending={teamMutation.isPending}
        description="团队隶属于当前组织，可后续增补组织成员。"
        onClose={() => setTeamModalOpen(false)}
        onSubmit={(name, description) => teamMutation.mutate({ name, description })}
      />
      <NameDescModal
        open={wsModalOpen}
        title="新建工作空间"
        nameLabel="工作空间名称"
        pending={wsMutation.isPending}
        description="工作空间用于归组同一投稿或课题下的项目。"
        onClose={() => setWsModalOpen(false)}
        onSubmit={(name, description) => wsMutation.mutate({ name, description })}
      />
      <ConfirmModal
        open={Boolean(removeTarget)}
        title="移除组织成员"
        icon={UserMinus}
        confirmLabel="确认移除"
        description={removeTarget ? `${removeTarget.display_name || '（未命名）'} · ${removeTarget.email}` : ''}
        warning="移除后将同时撤销其在本组织所有项目中的成员身份，团队与历史记录保留。此操作不可恢复，请确认已完成交接。"
        pending={removeMutation.isPending}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget.user_id)}
      />
      <ConfirmModal
        open={Boolean(revokeTarget)}
        title="撤销邀请"
        icon={Ban}
        confirmLabel="确认撤销"
        description={revokeTarget ? `受邀邮箱：${revokeTarget.email}` : ''}
        warning="撤销后该邀请令牌立即失效，受邀者将无法再凭此令牌加入组织；如需重新邀请请再次创建。"
        pending={revokeMutation.isPending}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
      />
    </div>
  )
}
