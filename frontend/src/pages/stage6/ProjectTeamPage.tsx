import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import {
  Activity, ChevronDown, ClipboardCheck, Gavel, MessageSquareMore, Plus, Send, Trash2, UserMinus, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { JsonBlock } from '../../components/JsonBlock'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge, type Tone } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { formatDateTime } from '../../features/format'
import { COMMENT_TARGETS, PROJECT_ROLES, projectRoleMeta, REVIEW_STATUS, REVIEW_TARGETS, trailActionLabel } from '../../features/stage6Meta'
import { api, ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'
import { toast } from '../../stores/toastStore'
import { useUIStore } from '../../stores/uiStore'
import type { ActivityItem, Comment, ProjectMember, ReviewRequest } from '../../types/stage6'

const ACTIVITY_LIMIT = 20
const DANGER_BTN = 'inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:bg-danger/90 hover:brightness-90 disabled:opacity-50'
const ICON_DANGER = 'inline-flex items-center rounded-md border border-line bg-danger-wash p-1.5 text-danger transition hover:border-danger hover:bg-danger hover:text-white disabled:opacity-50'

function reviewStatus(key: string): { label: string; tone: Tone } {
  return REVIEW_STATUS[key] ?? { label: key, tone: 'neutral' }
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
    return <ErrorState compact message={state.error.message} code={state.error instanceof ApiError ? state.error.code : undefined} onRetry={() => void state.refetch()} />
  }
  if (state.data === undefined || isEmpty(state.data)) return <>{empty}</>
  return <>{children(state.data)}</>
}

function ConfirmModal({ open, title, description, warning, confirmLabel, icon: Icon, pending, onClose, onConfirm }: {
  open: boolean; title: string; description: string; warning: string; confirmLabel: string
  icon: LucideIcon; pending: boolean; onClose: () => void; onConfirm: () => void
}) {
  return (
    <Modal open={open} title={title} description={description} onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className={DANGER_BTN} disabled={pending} onClick={onConfirm}>
            <Icon size={16} strokeWidth={1.8} />{pending ? '处理中…' : confirmLabel}
          </button>
        </>
      }>
      <div className="rounded-md border border-line bg-danger-wash px-3 py-2.5 text-xs leading-relaxed text-danger">{warning}</div>
    </Modal>
  )
}

export default function ProjectTeamPage() {
  const { projectId } = useParams()
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [tab, setTab] = useState('members')
  const [commentFilter, setCommentFilter] = useState('')
  const [commentForm, setCommentForm] = useState({ target_type: 'finding', target_id: '', body: '' })
  const [commentError, setCommentError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Comment | null>(null)
  const [addMemberOpen, setAddMemberOpen] = useState(false)
  const [memberForm, setMemberForm] = useState({ user_id: '', role_key: 'researcher' })
  const [memberError, setMemberError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ProjectMember | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewForm, setReviewForm] = useState({ target_type: 'finding', target_id: '', reviewer_user_id: '' })
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [decideTarget, setDecideTarget] = useState<ReviewRequest | null>(null)
  const [decideForm, setDecideForm] = useState({ status: 'approved', decision_note: '' })
  const [offset, setOffset] = useState(0)
  const [expandedTrail, setExpandedTrail] = useState<string[]>([])
  const [trailState, setTrailState] = useState<{ pid: string; items: ActivityItem[]; total: number }>({ pid: '', items: [], total: 0 })

  useEffect(() => { if (projectId) useUIStore.getState().setLastProjectId(projectId) }, [projectId])
  useEffect(() => { setOffset(0); setExpandedTrail([]) }, [projectId])

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })
  const project = projectsQuery.data?.items.find((p) => p.id === projectId)
  const membersQuery = useQuery({ queryKey: ['project-members', projectId], queryFn: () => stage6Api.listProjectMembers(projectId ?? ''), enabled: Boolean(projectId) })
  const commentsQuery = useQuery({ queryKey: ['project-comments', projectId, commentFilter], queryFn: () => stage6Api.listComments(projectId ?? '', commentFilter || undefined), enabled: Boolean(projectId) })
  const reviewsQuery = useQuery({ queryKey: ['project-reviews', projectId], queryFn: () => stage6Api.listReviews(projectId ?? ''), enabled: Boolean(projectId) })
  const activityQuery = useQuery({ queryKey: ['project-activity', projectId, offset], queryFn: () => stage6Api.listActivity(projectId ?? '', ACTIVITY_LIMIT, offset), enabled: Boolean(projectId) && tab === 'activity' })
  const orgMembersQuery = useQuery({ queryKey: ['org-members', project?.org_id], queryFn: () => stage6Api.listOrgMembers(project?.org_id ?? ''), enabled: Boolean(project?.org_id) })

  /* 活动轨迹按页累积：以 pid 守卫避免项目切换时串数据，按 id 去重防止重复追加。 */
  const trail = trailState.pid === projectId ? trailState.items : []
  const trailTotal = trailState.pid === projectId ? trailState.total : 0
  useEffect(() => {
    const data = activityQuery.data
    if (!data || !projectId) return
    setTrailState((prev) => {
      const base = prev.pid === projectId ? prev.items : []
      const seen = new Set(base.map((i) => i.id))
      const items = [...base]
      for (const item of data.items) if (!seen.has(item.id)) items.push(item)
      return { pid: projectId, items, total: data.total }
    })
  }, [activityQuery.data, projectId])

  const members = membersQuery.data?.items ?? []
  const memberIds = new Set(members.map((m) => m.user_id))
  const memberById = new Map(members.map((m) => [m.user_id, m]))
  const addCandidates = (orgMembersQuery.data?.items ?? []).filter((m) => !memberIds.has(m.user_id))
  const renderActor = (userId: string | null) => {
    if (!userId) return <span className="text-ink-subtle">系统</span>
    const m = memberById.get(userId)
    if (m) return <span className="font-medium text-ink">{m.display_name || m.email}</span>
    return <span className="mono text-xs text-ink-muted">{userId}</span>
  }
  const invalidateActivity = () => queryClient.invalidateQueries({ queryKey: ['project-activity', projectId] })

  const addMemberMutation = useMutation({
    mutationFn: (body: { user_id: string; role_key: string }) => stage6Api.addProjectMember(projectId ?? '', body),
    onSuccess: async () => {
      toast.success('项目成员已添加')
      setAddMemberOpen(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-members', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const memberRoleMutation = useMutation({
    mutationFn: (v: { userId: string; roleKey: string }) => stage6Api.updateProjectMember(projectId ?? '', v.userId, v.roleKey),
    onSuccess: async () => {
      toast.success('项目角色已更新')
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-members', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => stage6Api.removeProjectMember(projectId ?? '', userId),
    onSuccess: async () => {
      toast.success('已移除项目成员')
      setRemoveTarget(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-members', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const createCommentMutation = useMutation({
    mutationFn: (body: { target_type: string; target_id: string; body: string }) => stage6Api.createComment(projectId ?? '', body),
    onSuccess: async () => {
      toast.success('评论已发表')
      setCommentForm((f) => ({ ...f, target_id: '', body: '' }))
      setCommentError(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-comments', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => stage6Api.deleteComment(commentId),
    onSuccess: async () => {
      toast.success('评论已删除')
      setDeleteTarget(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-comments', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const createReviewMutation = useMutation({
    mutationFn: (body: { target_type: string; target_id: string; reviewer_user_id: string | null }) => stage6Api.createReview(projectId ?? '', body),
    onSuccess: async () => {
      toast.success('复核申请已提交，等待裁定')
      setReviewOpen(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-reviews', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })
  const decideMutation = useMutation({
    mutationFn: (v: { reviewId: string; status: string; note: string }) => stage6Api.decideReview(v.reviewId, { status: v.status, decision_note: v.note }),
    onSuccess: async (_data, v) => {
      toast.success(`复核已裁定：${reviewStatus(v.status).label}`)
      setDecideTarget(null)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['project-reviews', projectId] }), invalidateActivity()])
    },
    onError: (e) => toast.error(e.message),
  })

  const submitComment = () => {
    if (!commentForm.target_id.trim()) { setCommentError('请输入目标对象 ID'); return }
    if (!commentForm.body.trim()) { setCommentError('请输入评论内容'); return }
    createCommentMutation.mutate({ target_type: commentForm.target_type, target_id: commentForm.target_id.trim(), body: commentForm.body.trim() })
  }
  const submitMember = () => {
    if (!memberForm.user_id.trim()) { setMemberError('请选择或输入用户 ID'); return }
    addMemberMutation.mutate({ user_id: memberForm.user_id.trim(), role_key: memberForm.role_key })
  }
  const submitReview = () => {
    if (!reviewForm.target_id.trim()) { setReviewError('请输入复核对象 ID'); return }
    createReviewMutation.mutate({ target_type: reviewForm.target_type, target_id: reviewForm.target_id.trim(), reviewer_user_id: reviewForm.reviewer_user_id || null })
  }

  const memberColumns: Column<ProjectMember>[] = [
    {
      key: 'member', header: '成员',
      render: (row) => (
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {row.display_name || '（未命名）'}
            {row.user_id === user?.id && <span className="ml-1.5 text-[11px] font-normal text-accent-dark">（我）</span>}
          </p>
          <p className="mono mt-0.5 text-xs text-ink-muted">{row.email}</p>
        </div>
      ),
    },
    {
      key: 'role', header: '项目角色',
      render: (row) => (
        <select className="field-input w-[150px] py-1.5 text-xs" value={row.role_key}
          disabled={memberRoleMutation.isPending && memberRoleMutation.variables?.userId === row.user_id}
          onChange={(e) => memberRoleMutation.mutate({ userId: row.user_id, roleKey: e.target.value })}
          aria-label={`修改 ${row.display_name || row.email} 的项目角色`}>
          {PROJECT_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      ),
    },
    { key: 'added', header: '加入时间', render: (row) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(row.added_at)}</span> },
    {
      key: 'actions', header: '操作', align: 'right',
      render: (row) => (
        <button type="button" className={ICON_DANGER} title="移除成员" aria-label={`移除成员 ${row.display_name || row.email}`} onClick={() => setRemoveTarget(row)}>
          <UserMinus size={16} strokeWidth={1.8} />
        </button>
      ),
    },
  ]

  if (!projectId) {
    return (
      <div className="space-y-5">
        <ErrorState message="路由缺少项目 ID，请从项目列表进入项目团队页。" code="MISSING_PROJECT_ID" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader title={project?.name ?? '项目协作'}
        description={project?.description || (project ? '暂无描述' : '成员、评论、复核与审计轨迹的项目级协作台。')}
        actions={<span className="mono rounded bg-neutral-wash px-2 py-1 text-[11px] text-neutral">{projectId}</span>} />

      <section className="panel overflow-hidden">
        <div className="px-2 pt-1">
          <Tabs active={tab} onChange={setTab}
            tabs={[
              { key: 'members', label: '成员', icon: Users, count: membersQuery.data?.total },
              { key: 'comments', label: '评论', icon: MessageSquareMore, count: commentsQuery.data?.total },
              { key: 'reviews', label: '复核', icon: ClipboardCheck, count: reviewsQuery.data?.total },
              { key: 'activity', label: '活动', icon: Activity, count: activityQuery.data?.total ?? trailTotal },
            ]} />
        </div>
        <div className="space-y-4 p-4 sm:p-5">
          {tab === 'members' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-subtle">项目角色决定材料、审计、评论与复核权限；成员管理需 project.manage 权限，由后端校验。</p>
                <button type="button" className="btn-primary" onClick={() => { setMemberForm({ user_id: '', role_key: 'researcher' }); setMemberError(null); setAddMemberOpen(true) }}>
                  <UserPlus size={16} strokeWidth={1.8} />添加成员
                </button>
              </div>
              <QueryGate state={membersQuery} isEmpty={(d) => d.items.length === 0}
                empty={<EmptyState compact icon={Users} title="暂无项目成员" description="从组织成员中分配角色，组建复现审计小组。" />}>
                {(data) => <DataTable columns={memberColumns} data={data.items} rowKey={(row) => row.user_id} />}
              </QueryGate>
            </>
          )}

          {tab === 'comments' && (
            <>
              <div className="rounded-md border border-line bg-canvas p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="field-label" htmlFor="cmt-type">目标类型 *</label>
                    <select id="cmt-type" className="field-input" value={commentForm.target_type} onChange={(e) => setCommentForm((f) => ({ ...f, target_type: e.target.value }))}>
                      {Object.entries(COMMENT_TARGETS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="cmt-target">目标 ID *</label>
                    <input id="cmt-target" className="field-input mono" value={commentForm.target_id} placeholder="例如 finding-xxxxxxxx"
                      onChange={(e) => { setCommentForm((f) => ({ ...f, target_id: e.target.value })); setCommentError(null) }} />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="field-label" htmlFor="cmt-body">评论内容 *</label>
                  <textarea id="cmt-body" className="field-input" rows={3} value={commentForm.body} placeholder="围绕该科研对象的质疑、补充证据或修正建议…"
                    onChange={(e) => { setCommentForm((f) => ({ ...f, body: e.target.value })); setCommentError(null) }} />
                </div>
                {commentError && <p className="mt-1.5 text-xs text-danger">{commentError}</p>}
                <div className="mt-3 flex justify-end">
                  <button type="button" className="btn-primary" disabled={createCommentMutation.isPending} onClick={submitComment}>
                    <Send size={16} strokeWidth={1.8} />{createCommentMutation.isPending ? '发表中…' : '发表评论'}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-subtle">删除仅限本人评论；项目管理者的代删权限由后端另行校验。</p>
                <select className="field-input w-[160px] py-1.5 text-xs" value={commentFilter} aria-label="按目标类型筛选评论" onChange={(e) => setCommentFilter(e.target.value)}>
                  <option value="">全部目标</option>
                  {Object.entries(COMMENT_TARGETS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <QueryGate state={commentsQuery} isEmpty={(d) => d.items.length === 0}
                empty={<EmptyState compact icon={MessageSquareMore} title="暂无评论" description={commentFilter ? '当前目标类型下没有评论，可切换「全部目标」。' : '围绕审计发现、证据或材料发起第一条讨论。'} />}>
                {(data) => (
                  <div className="space-y-3">
                    {data.items.map((c) => (
                      <div key={c.id} className="rounded-md border border-line p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-ink">{c.author_name || '（未知作者）'}</span>
                          <StatusBadge tone="accent" dot={false}>{COMMENT_TARGETS[c.target_type] ?? c.target_type}</StatusBadge>
                          <span className="mono text-[11px] text-ink-subtle">{c.target_id}</span>
                          <span className="mono ml-auto text-[11px] text-ink-subtle">{formatDateTime(c.created_at)}</span>
                          {c.author_user_id === user?.id && (
                            <button type="button" className={ICON_DANGER} title="删除我的评论" aria-label="删除我的评论" onClick={() => setDeleteTarget(c)}>
                              <Trash2 size={16} strokeWidth={1.8} />
                            </button>
                          )}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{c.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </QueryGate>
            </>
          )}

          {tab === 'reviews' && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-subtle">仅指定审核人或具备 review.decide 权限者可裁定；裁定结论与意见全程留痕。</p>
                <button type="button" className="btn-primary" onClick={() => { setReviewForm({ target_type: 'finding', target_id: '', reviewer_user_id: '' }); setReviewError(null); setReviewOpen(true) }}>
                  <Plus size={16} strokeWidth={1.8} />发起复核
                </button>
              </div>
              <QueryGate state={reviewsQuery} isEmpty={(d) => d.items.length === 0}
                empty={<EmptyState compact icon={ClipboardCheck} title="暂无复核申请" description="对审计发现或整改建议发起独立复核。" />}>
                {(data) => (
                  <div className="space-y-3">
                    {data.items.map((r) => {
                      const status = reviewStatus(r.status)
                      return (
                        <div key={r.id} className="rounded-md border border-line p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone="navy" dot={false}>{REVIEW_TARGETS[r.target_type] ?? r.target_type}</StatusBadge>
                            <span className="mono text-[11px] text-ink-subtle">{r.target_id}</span>
                            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                            <span className="mono ml-auto text-[11px] text-ink-subtle">{formatDateTime(r.created_at)}</span>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                            <span>申请人：{renderActor(r.requested_by)}</span>
                            <span>审核人：{r.reviewer_user_id ? renderActor(r.reviewer_user_id) : '未指定'}</span>
                            {r.decided_at && <span>裁定于 <span className="mono">{formatDateTime(r.decided_at)}</span></span>}
                          </div>
                          {r.decision_note && <p className="mt-2 rounded bg-canvas px-3 py-2 text-xs leading-relaxed text-ink-muted">裁定意见：{r.decision_note}</p>}
                          {r.status === 'pending' && (
                            <div className="mt-3">
                              <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={() => { setDecideForm({ status: 'approved', decision_note: '' }); setDecideTarget(r) }}>
                                <Gavel size={16} strokeWidth={1.8} />裁定
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </QueryGate>
            </>
          )}

          {tab === 'activity' && (
            <QueryGate state={activityQuery} isEmpty={(d) => d.items.length === 0 && trail.length === 0}
              empty={<EmptyState compact icon={Activity} title="暂无活动记录" description="成员、评论与复核操作会自动写入审计轨迹。" />}>
              {() => (
                <>
                  <ol className="relative ml-1.5 space-y-4 border-l border-line pl-6">
                    {trail.map((item) => {
                      const expanded = expandedTrail.includes(item.id)
                      return (
                        <li key={item.id} className="relative">
                          <span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" aria-hidden="true" />
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="text-sm font-semibold text-ink">{trailActionLabel(item.action)}</span>
                            {renderActor(item.actor_user_id)}
                            <span className="mono ml-auto text-[11px] text-ink-subtle">{formatDateTime(item.created_at)}</span>
                          </div>
                          {item.summary && <p className="mt-0.5 text-xs text-ink-muted">{item.summary}</p>}
                          {item.target_id && <p className="mono mt-0.5 text-[11px] text-ink-subtle">{item.target_type ?? '对象'} · {item.target_id}</p>}
                          {(item.before || item.after) && (
                            <>
                              <button type="button" className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent-dark hover:underline"
                                onClick={() => setExpandedTrail((prev) => prev.includes(item.id) ? prev.filter((x) => x !== item.id) : [...prev, item.id])}>
                                <ChevronDown size={16} strokeWidth={1.8} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                变更详情
                              </button>
                              {expanded && (
                                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                  <div>
                                    <p className="field-label">变更前</p>
                                    <JsonBlock value={item.before} maxHeight="max-h-48" empty="（无变更前快照）" />
                                  </div>
                                  <div>
                                    <p className="field-label">变更后</p>
                                    <JsonBlock value={item.after} maxHeight="max-h-48" empty="（无变更后快照）" />
                                  </div>
                                </div>
                              )}
                            </>
                          )}
                        </li>
                      )
                    })}
                  </ol>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-3">
                    <p className="text-xs text-ink-muted">已显示 <span className="mono font-semibold text-ink">{trail.length}</span> / <span className="mono">{trailTotal}</span> 条</p>
                    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" disabled={activityQuery.isPending || trail.length >= trailTotal} onClick={() => setOffset((o) => o + ACTIVITY_LIMIT)}>
                      {activityQuery.isPending ? '加载中…' : trail.length >= trailTotal ? '已加载全部' : '加载更多'}
                    </button>
                  </div>
                </>
              )}
            </QueryGate>
          )}
        </div>
      </section>

      <Modal open={addMemberOpen} title="添加项目成员" onClose={() => setAddMemberOpen(false)}
        description={project?.org_id ? '从项目所属组织的成员中选择，已加入者自动排除。' : '项目未归属组织，请手动输入用户 ID。'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setAddMemberOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={addMemberMutation.isPending} onClick={submitMember}>
              <UserPlus size={16} strokeWidth={1.8} />{addMemberMutation.isPending ? '添加中…' : '添加成员'}
            </button>
          </>
        }>
        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="pm-user">用户 *</label>
            {project?.org_id ? (
              orgMembersQuery.isPending ? <LoadingState compact message="正在读取组织成员…" />
              : orgMembersQuery.isError ? (
                <ErrorState compact message={orgMembersQuery.error.message} code={orgMembersQuery.error instanceof ApiError ? orgMembersQuery.error.code : undefined} onRetry={() => void orgMembersQuery.refetch()} />
              ) : (
                <>
                  <select id="pm-user" className="field-input" value={memberForm.user_id} onChange={(e) => { setMemberForm((f) => ({ ...f, user_id: e.target.value })); setMemberError(null) }}>
                    <option value="">从组织成员中选择…</option>
                    {addCandidates.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email}（{m.email}）</option>)}
                  </select>
                  {addCandidates.length === 0 && <p className="mt-1 text-[11px] text-ink-subtle">组织成员均已在项目中，无可添加对象。</p>}
                </>
              )
            ) : (
              <input id="pm-user" className="field-input mono" value={memberForm.user_id} placeholder="usr-xxxxxxxx"
                onChange={(e) => { setMemberForm((f) => ({ ...f, user_id: e.target.value })); setMemberError(null) }} />
            )}
            {memberError && <p className="mt-1 text-xs text-danger">{memberError}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="pm-role">项目角色 *</label>
            <select id="pm-role" className="field-input" value={memberForm.role_key} onChange={(e) => setMemberForm((f) => ({ ...f, role_key: e.target.value }))}>
              {PROJECT_ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}（{r.key}）</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <Modal open={reviewOpen} title="发起复核" onClose={() => setReviewOpen(false)}
        description="对审计发现或整改建议提交独立复核申请，提交后状态为待裁定。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setReviewOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={createReviewMutation.isPending} onClick={submitReview}>
              <ClipboardCheck size={16} strokeWidth={1.8} />{createReviewMutation.isPending ? '提交中…' : '提交申请'}
            </button>
          </>
        }>
        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="rv-type">复核对象类型 *</label>
            <select id="rv-type" className="field-input" value={reviewForm.target_type} onChange={(e) => setReviewForm((f) => ({ ...f, target_type: e.target.value }))}>
              {Object.entries(REVIEW_TARGETS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="rv-target">复核对象 ID *</label>
            <input id="rv-target" className="field-input mono" value={reviewForm.target_id} placeholder="例如 finding-xxxxxxxx"
              onChange={(e) => { setReviewForm((f) => ({ ...f, target_id: e.target.value })); setReviewError(null) }} />
            {reviewError && <p className="mt-1 text-xs text-danger">{reviewError}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="rv-reviewer">指定审核人（可选）</label>
            <select id="rv-reviewer" className="field-input" value={reviewForm.reviewer_user_id} onChange={(e) => setReviewForm((f) => ({ ...f, reviewer_user_id: e.target.value }))}>
              <option value="">不指定（具备审核权限者均可裁定）</option>
              {members.map((m) => <option key={m.user_id} value={m.user_id}>{m.display_name || m.email} · {projectRoleMeta(m.role_key).label}</option>)}
            </select>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(decideTarget)} title="裁定复核申请" onClose={() => setDecideTarget(null)}
        description={decideTarget ? `${REVIEW_TARGETS[decideTarget.target_type] ?? decideTarget.target_type} · ${decideTarget.target_id}` : ''}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setDecideTarget(null)}>取消</button>
            <button type="button" className="btn-primary" disabled={decideMutation.isPending}
              onClick={() => decideTarget && decideMutation.mutate({ reviewId: decideTarget.id, status: decideForm.status, note: decideForm.decision_note.trim() })}>
              <Gavel size={16} strokeWidth={1.8} />{decideMutation.isPending ? '裁定中…' : '确认裁定'}
            </button>
          </>
        }>
        <div className="space-y-4">
          <div>
            <label className="field-label" htmlFor="dc-status">裁定结论 *</label>
            <select id="dc-status" className="field-input" value={decideForm.status} onChange={(e) => setDecideForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="approved">通过</option>
              <option value="rejected">驳回</option>
              <option value="changes_requested">要求修改</option>
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="dc-note">裁定意见</label>
            <textarea id="dc-note" className="field-input" rows={3} value={decideForm.decision_note} placeholder="说明依据的证据、复现结果或需补充的整改项…"
              onChange={(e) => setDecideForm((f) => ({ ...f, decision_note: e.target.value }))} />
          </div>
        </div>
      </Modal>

      <ConfirmModal open={Boolean(removeTarget)} title="移除项目成员" icon={UserMinus} confirmLabel="确认移除"
        description={removeTarget ? `${removeTarget.display_name || '（未命名）'} · ${removeTarget.email} · ${projectRoleMeta(removeTarget.role_key).label}` : ''}
        warning="移除后该成员将立即失去对本项目的访问权限；其已发表的评论与复核记录会保留留痕。此操作不可恢复。"
        pending={removeMemberMutation.isPending} onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && removeMemberMutation.mutate(removeTarget.user_id)} />
      <ConfirmModal open={Boolean(deleteTarget)} title="删除评论" icon={Trash2} confirmLabel="确认删除"
        description={deleteTarget ? `${COMMENT_TARGETS[deleteTarget.target_type] ?? deleteTarget.target_type} · ${deleteTarget.target_id}` : ''}
        warning="删除后不可恢复，相关讨论上下文将缺失；仅可删除本人发表的评论。"
        pending={deleteCommentMutation.isPending} onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteCommentMutation.mutate(deleteTarget.id)} />
    </div>
  )
}