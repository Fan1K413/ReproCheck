import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FolderKanban,
  Gavel,
  MessageSquarePlus,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { JsonBlock } from '../../components/JsonBlock'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import { FEEDBACK_STATUS, FEEDBACK_TYPES } from '../../features/stage6Meta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { api, ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'
import { toast } from '../../stores/toastStore'
import { useUIStore } from '../../stores/uiStore'
import type { Feedback } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/** 分诊目标状态：open 为提交初始态，不参与分诊（与后端 TRIAGE_STATUSES 对齐）。 */
const TRIAGE_OPTIONS = [
  { key: 'triaged', label: '已分诊' },
  { key: 'resolved', label: '已解决' },
  { key: 'disputed', label: '有争议' },
]

/** 泳道顺序与后端 FEEDBACK_STATUS 一致，泳道内条目按创建时间倒序。 */
const LANE_ORDER = ['open', 'triaged', 'resolved', 'disputed'] as const

function errCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function contextText(context: Record<string, unknown>, key: string): string {
  const value = context[key]
  return typeof value === 'string' ? value : ''
}

function FeedbackCard({
  item, meId, meName, onTriage,
}: {
  item: Feedback
  meId: string | undefined
  meName: string | undefined
  onTriage: (item: Feedback) => void
}) {
  const typeMeta = FEEDBACK_TYPES[item.feedback_type] ?? { label: item.feedback_type, tone: 'neutral' as const }
  const statusMeta = FEEDBACK_STATUS[item.status] ?? { label: item.status, tone: 'neutral' as const }
  const resolution = contextText(item.context, 'resolution')
  const triageStatus = contextText(item.context, 'triage_status')
  const author = item.user_id === meId && meName ? `${meName}（我）` : (item.user_name ?? item.user_id)
  const hasContext = Object.keys(item.context).length > 0
  return (
    <article className="rcw-card rcw-card-tight">
      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
        <StatusBadge tone={typeMeta.tone} dot={false}>{typeMeta.label}</StatusBadge>
        <StatusBadge tone={statusMeta.tone}>{statusMeta.label}</StatusBadge>
        <span className="mono ml-auto whitespace-nowrap text-[11px] rcw-faint">{formatDateTime(item.created_at)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{item.note || '（未填写说明）'}</p>
      {(item.finding_id || item.evidence_ref || item.run_id) && (
        <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)' }}>
          {item.finding_id && <span className="rcw-chip">发现 {item.finding_id}</span>}
          {item.evidence_ref && <span className="rcw-chip">证据 {item.evidence_ref}</span>}
          {item.run_id && <span className="rcw-chip">运行 {item.run_id}</span>}
        </div>
      )}
      {item.status === 'disputed' && (
        <p className="rcw-row mt-3" style={{ gap: 'var(--rc-space-2)', color: 'var(--rc-danger)' }}>
          <Icon as={ShieldAlert} size="xs" />
          <span className="text-xs font-medium">争议中：已转人工复核队列，等待审核人员裁定，系统不自行判定真伪。</span>
        </p>
      )}
      {(resolution || item.resolved_at) && (
        <div className="mt-3 rounded-md px-3 py-2" style={{ backgroundColor: 'var(--rc-surface-2)' }}>
          <p className="text-[11px] font-semibold rcw-faint">
            分诊结论{triageStatus ? `（${FEEDBACK_STATUS[triageStatus]?.label ?? triageStatus}）` : ''}
          </p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs rcw-muted">{resolution || '（未填写结论）'}</p>
          {item.resolved_at && (
            <p className="mono mt-1 text-[11px] rcw-faint">处理人 {item.resolved_by_name ?? item.resolved_by ?? '—'} · {formatDateTime(item.resolved_at)}</p>
          )}
        </div>
      )}
      {hasContext && !resolution && (
        <div className="mt-3">
          <p className="field-label">上下文 context</p>
          <JsonBlock value={item.context} maxHeight="max-h-32" />
        </div>
      )}
      <div className="rcw-row-between" style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
        <p className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
          <Icon as={ShieldCheck} size="xs" tone="accent" />
          <span className="text-[11px] rcw-faint">提交人 <span className="mono">{author}</span></span>
        </p>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onTriage(item)}>
          <Icon as={Gavel} size="xs" />分诊
        </button>
      </div>
    </article>
  )
}

export default function FeedbackPage() {
  const queryClient = useQueryClient()
  const me = useAuthStore((state) => state.user)
  const [projectId, setProjectId] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [fbForm, setFbForm] = useState({ feedback_type: 'confirm', finding_id: '', note: '', evidence_ref: '', context_json: '' })
  const [fbErrors, setFbErrors] = useState<Record<string, string>>({})
  const [triageTarget, setTriageTarget] = useState<Feedback | null>(null)
  const [triageStatus, setTriageStatus] = useState('triaged')
  const [triageResolution, setTriageResolution] = useState('')

  useTrackProject(projectId || null)

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: api.getProjects })

  useEffect(() => {
    const items = projectsQuery.data?.items ?? []
    if (items.length === 0) return
    setProjectId((cur) => {
      if (cur && items.some((p) => p.id === cur)) return cur
      const last = useUIStore.getState().lastProjectId
      return last && items.some((p) => p.id === last) ? last : items[0].id
    })
  }, [projectsQuery.data])

  const projects = projectsQuery.data?.items ?? []
  const project = projects.find((p) => p.id === projectId)

  const allQuery = useQuery({
    queryKey: ['stage6-feedback', projectId, 'all'],
    queryFn: () => stage6Api.listFeedback(projectId),
    enabled: !!projectId,
  })
  const listQuery = useQuery({
    queryKey: ['stage6-feedback', projectId, statusFilter || 'all'],
    queryFn: () => stage6Api.listFeedback(projectId, statusFilter || undefined),
    enabled: !!projectId,
  })

  const invalidateFeedback = () => {
    void queryClient.invalidateQueries({ queryKey: ['stage6-feedback', projectId] })
  }

  const createMut = useMutation({
    mutationFn: (body: Parameters<typeof stage6Api.createFeedback>[0]) => stage6Api.createFeedback(body),
    onSuccess: () => {
      invalidateFeedback()
      setCreateOpen(false)
      toast.success('反馈已提交，进入人工分诊队列（不会自动修改规则）')
    },
    onError: (error) => toast.error(error.message),
  })
  const triageMut = useMutation({
    mutationFn: (vars: { id: string; status: string; resolution: string }) =>
      stage6Api.triageFeedback(vars.id, { status: vars.status, resolution: vars.resolution }),
    onSuccess: (_data, vars) => {
      invalidateFeedback()
      setTriageTarget(null)
      if (vars.status === 'disputed') {
        toast.success('已标记为有争议，复核请求已生成（已转人工复核）')
      } else {
        toast.success(`分诊完成：${FEEDBACK_STATUS[vars.status]?.label ?? vars.status}`)
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const openCreate = () => {
    setFbForm({ feedback_type: 'confirm', finding_id: '', note: '', evidence_ref: '', context_json: '' })
    setFbErrors({})
    setCreateOpen(true)
  }
  const submitCreate = () => {
    const errors: Record<string, string> = {}
    if (!fbForm.note.trim()) errors.note = '请填写反馈说明。'
    let context: Record<string, unknown> | null = null
    const ctxText = fbForm.context_json.trim()
    if (ctxText) {
      try {
        const parsed: unknown = JSON.parse(ctxText)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          errors.context_json = 'context_json 须为 JSON 对象（如 {"metric": "top1_acc"}）。'
        } else {
          context = parsed as Record<string, unknown>
        }
      } catch {
        errors.context_json = 'JSON 解析失败：请检查引号、逗号与括号是否配对。'
      }
    }
    setFbErrors(errors)
    if (Object.keys(errors).length > 0 || !projectId) return
    createMut.mutate({
      project_id: projectId,
      feedback_type: fbForm.feedback_type,
      note: fbForm.note.trim(),
      evidence_ref: fbForm.evidence_ref.trim(),
      finding_id: fbForm.finding_id.trim() || null,
      context_json: context,
    })
  }
  const openTriage = (item: Feedback) => {
    setTriageTarget(item)
    setTriageStatus(item.status === 'open' ? 'triaged' : item.status)
    setTriageResolution(contextText(item.context, 'resolution'))
  }
  const submitTriage = () => {
    if (!triageTarget) return
    triageMut.mutate({ id: triageTarget.id, status: triageStatus, resolution: triageResolution.trim() })
  }

  const allItems = allQuery.data?.items ?? []
  const statusCounts: Record<string, number> = {}
  for (const item of allItems) statusCounts[item.status] = (statusCounts[item.status] ?? 0) + 1
  const visibleItems = (listQuery.data?.items ?? []).filter((f) => !typeFilter || f.feedback_type === typeFilter)
  const listError = listQuery.isError ? listQuery.error : allQuery.isError ? allQuery.error : null
  /* 泳道数据来自「全部反馈」接口的真实 status 分布；类型筛选在泳道内生效。 */
  const laneItems = allItems.filter((f) => !typeFilter || f.feedback_type === typeFilter)
  const typeCounts: Record<string, number> = {}
  for (const item of allItems) typeCounts[item.feedback_type] = (typeCounts[item.feedback_type] ?? 0) + 1

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="审计反馈治理"
          description="审计发现反馈与分诊队列"
          actions={
            <button type="button" className="btn-primary" disabled={!projectId} onClick={openCreate}>
              <Icon as={MessageSquarePlus} size="xs" />提交反馈
            </button>
          }
        />

        {/* ---------- 项目选择 ---------- */}
        <section className="rcw-card rcw-card-tight">
          {projectsQuery.isPending ? (
            <LoadingState compact message="正在读取项目列表…" />
          ) : projectsQuery.isError ? (
            <ErrorState compact message={projectsQuery.error.message} code={errCode(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />
          ) : projects.length === 0 ? (
            <EmptyState compact icon={FolderKanban} title="尚无项目" description="创建复现审计项目后，即可在项目内提交与分诊反馈。" />
          ) : (
            <div className="rcw-row" style={{ gap: 'var(--rc-space-4)', alignItems: 'flex-end' }}>
              <div className="min-w-[260px] flex-1">
                <label className="field-label" htmlFor="fb-project">项目</label>
                <select
                  id="fb-project"
                  className="field-input"
                  value={projectId}
                  onChange={(e) => { setProjectId(e.target.value); setStatusFilter(''); setTypeFilter('') }}
                >
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {project && (
                <div className="min-w-0 flex-1 text-xs rcw-muted">
                  <p className="truncate">论文：{project.paper_title || '—'}</p>
                  <p className="mono mt-0.5 truncate text-[11px] rcw-faint">{project.id} · {project.domain || '未设置领域'}</p>
                </div>
              )}
            </div>
          )}
        </section>

        {projectId && (
          <>
            {allQuery.isPending || listQuery.isPending ? (
              <section className="rcw-card"><LoadingState message="正在读取反馈队列…" /></section>
            ) : listError ? (
              <section className="rcw-card">
                <ErrorState
                  message={listError.message}
                  code={errCode(listError)}
                  onRetry={() => { void allQuery.refetch(); void listQuery.refetch() }}
                />
              </section>
            ) : (
              <>
                {/* ---------- 分诊泳道（特色交互） ---------- */}
                <section className="rcw-card rcw-card-tight">
                  <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                    <div>
                      <h3 className="text-sm font-semibold">分诊泳道</h3>
                      <p className="mt-0.5 text-[11px] rcw-faint">
                        点击泳道标题可按状态筛选。
                      </p>
                    </div>
                    <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                      <select className="field-input w-auto py-1.5 text-xs" value={typeFilter}
                        onChange={(e) => setTypeFilter(e.target.value)} aria-label="按反馈类型筛选">
                        <option value="">全部类型</option>
                        {Object.entries(FEEDBACK_TYPES).map(([key, meta]) => (
                          <option key={key} value={key}>{meta.label}（{typeCounts[key] ?? 0}）</option>
                        ))}
                      </select>
                      {statusFilter && (
                        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setStatusFilter('')}>
                          清除状态筛选
                        </button>
                      )}
                    </div>
                  </div>

                  {allItems.length === 0 ? (
                    <EmptyState
                      compact
                      icon={MessageSquarePlus}
                      title="该项目暂无反馈"
                      description="对审计发现提交确认、误报或证据不足等反馈，进入人工分诊队列。"
                      action={
                        <button type="button" className="btn-primary" onClick={openCreate}>
                          <Icon as={MessageSquarePlus} size="xs" />提交反馈
                        </button>
                      }
                    />
                  ) : (
                    <div className="rcw-lanes">
                      {LANE_ORDER.map((laneKey) => {
                        const meta = FEEDBACK_STATUS[laneKey]
                        const items = laneItems.filter((item) => item.status === laneKey)
                        const active = statusFilter === laneKey
                        const dimmed = statusFilter !== '' && !active
                        return (
                          <div key={laneKey} className="rcw-lane" data-active={active ? 'true' : 'false'}
                            style={{ opacity: dimmed ? 0.55 : 1, transition: 'opacity var(--rc-dur-base) var(--rc-ease-hover)' }}>
                            <button
                              type="button"
                              className="rcw-lane-head w-full"
                              style={{ cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
                              aria-pressed={active}
                              onClick={() => setStatusFilter(active ? '' : laneKey)}
                            >
                              <span className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                <span className="rcw-dot" data-tone={laneKey === 'resolved' ? 'success' : laneKey === 'disputed' ? 'danger' : laneKey === 'open' ? 'warning' : 'accent'} aria-hidden="true" />
                                <span className="text-xs font-semibold">{meta.label}</span>
                              </span>
                              <span className="mono text-[11px] rcw-faint">{items.length}</span>
                            </button>
                            {items.length === 0 ? (
                              <p className="py-4 text-center text-[11px] rcw-faint">此状态暂无条目</p>
                            ) : (
                              <div className="rcw-stack-tight">
                                {items.map((item) => (
                                  <FeedbackCard
                                    key={item.id}
                                    item={item}
                                    meId={me?.id}
                                    meName={me?.display_name}
                                    onTriage={openTriage}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>

                {/* ---------- 当前筛选结果列表 ---------- */}
                {(statusFilter || typeFilter) && (
                  <section className="rcw-card">
                    <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                      <h3 className="text-sm font-semibold">当前筛选结果</h3>
                      <StatusBadge tone="neutral">{visibleItems.length} 条</StatusBadge>
                    </div>
                    {visibleItems.length === 0 ? (
                      <EmptyState compact icon={MessageSquarePlus} title="当前筛选下没有反馈" description="尝试切换状态或类型筛选。" />
                    ) : (
                      <div className="rcw-grid rcw-grid-2">
                        {visibleItems.map((item) => (
                          <FeedbackCard key={item.id} item={item} meId={me?.id} meName={me?.display_name} onTriage={openTriage} />
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* 提交反馈 */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="提交审计反馈"
        description={project ? `项目：${project.name} · 提交后初始状态为「待处理」，进入人工分诊队列。` : '提交后进入人工分诊队列。'}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setCreateOpen(false)}>取消</button>
            <button type="button" className="btn-primary" disabled={createMut.isPending} onClick={submitCreate}>
              <Icon as={MessageSquarePlus} size="xs" />{createMut.isPending ? '提交中…' : '提交反馈'}
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="field-label">反馈类型 feedback_type</label>
            <select className="field-input" value={fbForm.feedback_type}
              onChange={(e) => setFbForm({ ...fbForm, feedback_type: e.target.value })}>
              {Object.entries(FEEDBACK_TYPES).map(([key, meta]) => <option key={key} value={key}>{meta.label}（{key}）</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">关联审计发现 finding_id（可选）</label>
            <input className="field-input mono" placeholder="如：f_001" value={fbForm.finding_id}
              onChange={(e) => setFbForm({ ...fbForm, finding_id: e.target.value })} />
          </div>
          <div>
            <label className="field-label">反馈说明 note *</label>
            <textarea className="field-input" rows={4} placeholder="描述你对该审计发现的判断与依据，例如：论文附录 B 已给出该超参数，判定为误报。"
              value={fbForm.note} onChange={(e) => setFbForm({ ...fbForm, note: e.target.value })} />
            {fbErrors.note && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{fbErrors.note}</p>}
          </div>
          <div>
            <label className="field-label">证据引用 evidence_ref（可选）</label>
            <input className="field-input mono" placeholder="如：chunk_p_012 / 论文第 5 页" value={fbForm.evidence_ref}
              onChange={(e) => setFbForm({ ...fbForm, evidence_ref: e.target.value })} />
          </div>
          <div>
            <label className="field-label">上下文 context_json（可选，JSON 对象）</label>
            <textarea className="field-input mono text-xs" rows={3} placeholder={'{\n  "metric": "top1_acc",\n  "paper_value": 76.1,\n  "repro_value": 75.9\n}'}
              value={fbForm.context_json} onChange={(e) => setFbForm({ ...fbForm, context_json: e.target.value })} />
            {fbErrors.context_json && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{fbErrors.context_json}</p>}
          </div>
          <p className="rcw-note">
            治理约束：单条反馈不是绝对真理，绝不会自动改写任何生产规则或规则版本；规则变更只能走显式版本流程（rule.manage + 离线测试）。
          </p>
        </div>
      </Modal>

      {/* 分诊 */}
      <Modal
        open={!!triageTarget}
        onClose={() => setTriageTarget(null)}
        title="反馈分诊"
        description="需要 finding.review 权限（审核人员及以上）；分诊结论会合并进反馈上下文并留痕。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setTriageTarget(null)}>取消</button>
            <button type="button" className="btn-primary" disabled={triageMut.isPending} onClick={submitTriage}>
              <Icon as={Gavel} size="xs" />{triageMut.isPending ? '提交中…' : '确认分诊'}
            </button>
          </>
        }
      >
        {triageTarget && (
          <div className="space-y-3">
            <div className="rounded-md px-3 py-2" style={{ backgroundColor: 'var(--rc-surface-2)' }}>
              <p className="text-[11px] font-semibold rcw-faint">
                {FEEDBACK_TYPES[triageTarget.feedback_type]?.label ?? triageTarget.feedback_type} · 当前状态 {FEEDBACK_STATUS[triageTarget.status]?.label ?? triageTarget.status}
              </p>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs rcw-muted">{triageTarget.note || '（未填写说明）'}</p>
            </div>
            <div>
              <label className="field-label">分诊状态 status</label>
              <select className="field-input" value={triageStatus} onChange={(e) => setTriageStatus(e.target.value)}>
                {TRIAGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}（{o.key}）</option>)}
              </select>
            </div>
            {triageStatus === 'disputed' && (
              <p className="rcw-note rcw-note--warn">
                <span className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                  <Icon as={ShieldAlert} size="xs" style={{ marginTop: 3 }} />
                  <span>标记为有争议后，将自动生成人工复核请求（ReviewRequest）；系统与 AI 均不自行裁定真伪，也不会修改任何规则。</span>
                </span>
              </p>
            )}
            <div>
              <label className="field-label">分诊结论 resolution</label>
              <textarea className="field-input" rows={4} placeholder="记录分诊依据与后续动作，例如：证据充分，确认误报；建议规则维护者评估容差版本。"
                value={triageResolution} onChange={(e) => setTriageResolution(e.target.value)} />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
