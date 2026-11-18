import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  GitBranch,
  ListPlus,
  Play,
  Plus,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import {
  feasibilityColor,
  feasibilityLabel,
  feasibilityTone,
  taskStatusLabel,
  taskStatusTone,
} from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type {
  CreateTaskRequest,
  DagNode,
  ReproTaskView,
  ReproductionDag,
} from '../../types/reproduction'
import { useUIStore } from '../../stores/uiStore'

const NODE_W = 158
const NODE_H = 64
const GAP_X = 72
const GAP_Y = 28
const PAD = 28

type PositionedNode = DagNode & { x: number; y: number }

type DagLayout = {
  nodes: PositionedNode[]
  byId: Map<string, PositionedNode>
  width: number
  height: number
}

/** 仅做布局，不做依赖推断：节点集合与边集合完全来自后端 dag.nodes / dag.edges。 */
function layoutDag(dag: ReproductionDag): DagLayout {
  const nodes = dag.nodes ?? []
  const edges = dag.edges ?? []
  const indegree = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  edges.forEach((edge) => {
    if (indegree.has(edge.to)) indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
  })

  const layer = new Map<string, number>(nodes.map((node) => [node.id, 0]))
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  const visited = new Set(queue)
  let head = 0
  while (head < queue.length) {
    const id = queue[head++]
    const current = layer.get(id) ?? 0
    edges
      .filter((edge) => edge.from === id)
      .forEach((edge) => {
        layer.set(edge.to, Math.max(layer.get(edge.to) ?? 0, current + 1))
        const next = (indegree.get(edge.to) ?? 0) - 1
        indegree.set(edge.to, next)
        if (next === 0 && !visited.has(edge.to)) {
          visited.add(edge.to)
          queue.push(edge.to)
        }
      })
  }
  // 极端情况下后端返回成环数据：兜底放到末层，仍按后端边绘制。
  nodes.forEach((node, index) => {
    if (!visited.has(node.id)) layer.set(node.id, nodes.length + index)
  })

  const groups = new Map<number, DagNode[]>()
  nodes.forEach((node) => {
    const key = layer.get(node.id) ?? 0
    groups.set(key, [...(groups.get(key) ?? []), node])
  })
  let maxRows = 0
  const positioned: PositionedNode[] = []
  groups.forEach((group, layerIndex) => {
    maxRows = Math.max(maxRows, group.length)
    group.forEach((node, row) => {
      positioned.push({
        ...node,
        x: PAD + layerIndex * (NODE_W + GAP_X),
        y: PAD + row * (NODE_H + GAP_Y),
      })
    })
  })

  return {
    nodes: positioned,
    byId: new Map(positioned.map((node) => [node.id, node])),
    width: Math.max(480, groups.size * (NODE_W + GAP_X) - GAP_X + PAD * 2),
    height: Math.max(220, maxRows * (NODE_H + GAP_Y) - GAP_Y + PAD * 2),
  }
}

function findTask(tasks: ReproTaskView[], nodeId: string): ReproTaskView | undefined {
  return (
    tasks.find((task) => task.task_id === nodeId) ??
    tasks.find((task) => task.task_key === nodeId) ??
    tasks.find((task) => task.task_key === nodeId.split(':').pop())
  )
}

function MutationError({ error }: { error: unknown }) {
  if (!error) return null
  const code = error instanceof ApiError ? error.code : 'UNKNOWN_ERROR'
  const message = error instanceof Error ? error.message : '操作失败，请稍后重试。'
  return (
    <div className="rounded-md border border-danger/30 bg-danger-wash p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-danger">
        <AlertTriangle size={15} /> 操作未成功
      </p>
      <p className="mt-1 text-ink-muted">{message}</p>
      <p className="mono mt-1 text-[11px] text-danger">错误码：{code}</p>
    </div>
  )
}

const emptyTaskForm: CreateTaskRequest = {
  title: '',
  description: '',
  depends_on: [],
  required_materials: [],
  action: '',
  expected_result: '',
  acceptance_criteria: '',
  risk: '',
  needs_human_confirm: false,
  evidence_refs: [],
}

type TextFieldKey = 'title' | 'description' | 'action' | 'expected_result' | 'acceptance_criteria' | 'risk'
type ListFieldKey = 'depends_on' | 'required_materials' | 'evidence_refs'

const splitList = (value: string): string[] =>
  value
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter(Boolean)

export default function ReproductionPlanPage() {
  const planId = useParams().planId ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setLastPlanId = useUIStore((state) => state.setLastPlanId)

  useEffect(() => {
    setLastPlanId(planId || null)
  }, [planId, setLastPlanId])

  const planQuery = useQuery({
    queryKey: ['repro-plan', planId],
    queryFn: () => reproductionApi.getPlan(planId),
    enabled: !!planId,
  })
  useTrackProject(planQuery.data?.project_id)

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [showPlanForm, setShowPlanForm] = useState(false)
  const [showTaskForm, setShowTaskForm] = useState(false)
  const [showRunForm, setShowRunForm] = useState(false)
  const [planTitle, setPlanTitle] = useState('')
  const [requestedBy, setRequestedBy] = useState('本地用户')
  const [taskForm, setTaskForm] = useState(emptyTaskForm)
  const [listInputs, setListInputs] = useState<Record<ListFieldKey, string>>({
    depends_on: '',
    required_materials: '',
    evidence_refs: '',
  })

  const invalidatePlan = () => {
    void queryClient.invalidateQueries({ queryKey: ['repro-plan', planId] })
    void queryClient.invalidateQueries({ queryKey: ['repro-plans'] })
  }

  const createPlanMutation = useMutation({
    mutationFn: () =>
      reproductionApi.createPlan({
        project_id: planQuery.data?.project_id ?? '',
        title: planTitle.trim() || undefined,
      }),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['repro-plans'] })
      navigate(`/reproductions/plans/${created.plan_id}`)
    },
  })

  const createTaskMutation = useMutation({
    mutationFn: () => reproductionApi.createTask(planId, taskForm),
    onSuccess: () => {
      invalidatePlan()
      setTaskForm(emptyTaskForm)
      setListInputs({ depends_on: '', required_materials: '', evidence_refs: '' })
      setShowTaskForm(false)
    },
  })

  const confirmTaskMutation = useMutation({
    mutationFn: (taskId: string) => reproductionApi.confirmTask(taskId),
    onSuccess: invalidatePlan,
  })

  const createRunMutation = useMutation({
    mutationFn: () =>
      reproductionApi.createRun({
        plan_id: planId,
        requested_by: requestedBy.trim() || '本地用户',
      }),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ['repro-runs'] })
      navigate(`/reproductions/runs/${run.run_id}`)
    },
  })

  const layout = useMemo(
    () => (planQuery.data ? layoutDag(planQuery.data.dag) : null),
    [planQuery.data],
  )

  if (planQuery.isPending) {
    return <LoadingState message="正在读取复现规划…" hint="GET /reproductions/plans/{plan_id}" />
  }
  if (planQuery.isError) {
    return (
      <ErrorState
        message={planQuery.error instanceof Error ? planQuery.error.message : '无法获取复现规划。'}
        code={planQuery.error instanceof ApiError ? planQuery.error.code : undefined}
        onRetry={() => void planQuery.refetch()}
      />
    )
  }
  const plan = planQuery.data
  if (!plan || !layout) {
    return <EmptyState title="规划不存在" description="后端未返回该规划的详情。" />
  }

  const selectedTask = selectedNodeId
    ? findTask(plan.tasks, selectedNodeId)
    : undefined
  const selectedNode = selectedNodeId ? layout.byId.get(selectedNodeId) : undefined

  const setTextField = (key: TextFieldKey, value: string) =>
    setTaskForm((prev) => ({ ...prev, [key]: value }))
  const setListField = (key: ListFieldKey, value: string) => {
    setListInputs((prev) => ({ ...prev, [key]: value }))
    setTaskForm((prev) => ({ ...prev, [key]: splitList(value) }))
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Reproduction Plan DAG</p>
          <h2 className="mt-1 text-lg font-semibold">{plan.title || '未命名规划'}</h2>
          <p className="mt-1 text-sm text-ink-muted">
            节点与边均由后端 <span className="mono">dag.nodes / dag.edges</span> 返回，前端仅做布局，不推断依赖。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${plan.project_id}/reproduction`} className="btn-ghost">
            <ArrowLeft size={15} />返回总览
          </Link>
          <button type="button" className="btn-ghost" onClick={() => setShowPlanForm((v) => !v)}>
            <Plus size={15} />新建规划
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowTaskForm((v) => !v)}>
            <ListPlus size={15} />新增任务
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone="accent">任务 {plan.task_count}</StatusBadge>
        <StatusBadge tone="neutral">规划 ID <span className="mono">{plan.plan_id}</span></StatusBadge>
        <StatusBadge tone="neutral">来源 {plan.source ?? '—'}</StatusBadge>
        <StatusBadge tone={plan.ai_available ? 'success' : 'warning'}>
          AI {plan.ai_available ? '可用' : '不可用'}
        </StatusBadge>
        <span className="text-xs text-ink-subtle">创建时间 {formatDateTime(plan.created_at)}</span>
      </div>

      {showPlanForm && (
        <section className="panel p-5">
          <h3 className="text-sm font-semibold">新建复现规划</h3>
          <p className="mt-1 text-xs text-ink-muted">
            使用后端 POST /reproductions/plans。无模型密钥时后端返回 ai_available=false 与 LLM_KEY_NOT_CONFIGURED，不会生成假规划。
          </p>
          <div className="mt-4">
            <label className="field-label" htmlFor="plan-title">规划标题（可选）</label>
            <input
              id="plan-title"
              className="field-input"
              value={planTitle}
              onChange={(event) => setPlanTitle(event.target.value)}
              placeholder="留空则由后端生成"
            />
          </div>
          <MutationError error={createPlanMutation.error} />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={createPlanMutation.isPending}
              onClick={() => createPlanMutation.mutate()}
            >
              {createPlanMutation.isPending ? '创建中…' : '提交创建'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowPlanForm(false)}>取消</button>
          </div>
        </section>
      )}

      {showTaskForm && (
        <section className="panel p-5">
          <h3 className="text-sm font-semibold">新增任务（程序化，不调用 AI）</h3>
          <p className="mt-1 text-xs text-ink-muted">POST /reproductions/plans/{'{plan_id}'}/tasks</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="task-title">任务标题 *</label>
              <input id="task-title" className="field-input" value={taskForm.title} onChange={(e) => setTextField('title', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="task-desc">任务说明</label>
              <textarea id="task-desc" className="field-input" rows={2} value={taskForm.description} onChange={(e) => setTextField('description', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="task-action">执行动作</label>
              <input id="task-action" className="field-input" value={taskForm.action} onChange={(e) => setTextField('action', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="task-expected">预期结果</label>
              <input id="task-expected" className="field-input" value={taskForm.expected_result} onChange={(e) => setTextField('expected_result', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor="task-accept">验收标准</label>
              <textarea id="task-accept" className="field-input" rows={2} value={taskForm.acceptance_criteria} onChange={(e) => setTextField('acceptance_criteria', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="task-depends">前置任务（逗号分隔，task_key）</label>
              <input id="task-depends" className="field-input" value={listInputs.depends_on} onChange={(e) => setListField('depends_on', e.target.value)} placeholder="T00,T01" />
            </div>
            <div>
              <label className="field-label" htmlFor="task-materials">所需材料（逗号分隔）</label>
              <input id="task-materials" className="field-input" value={listInputs.required_materials} onChange={(e) => setListField('required_materials', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="task-evidence">证据引用（逗号分隔）</label>
              <input id="task-evidence" className="field-input" value={listInputs.evidence_refs} onChange={(e) => setListField('evidence_refs', e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="task-risk">风险</label>
              <input id="task-risk" className="field-input" value={taskForm.risk} onChange={(e) => setTextField('risk', e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-sm text-ink-muted sm:col-span-2">
              <input
                type="checkbox"
                checked={taskForm.needs_human_confirm}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, needs_human_confirm: e.target.checked }))}
              />
              需要人工确认（needs_human_confirm）
            </label>
          </div>
          <MutationError error={createTaskMutation.error} />
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={createTaskMutation.isPending || !taskForm.title.trim()}
              onClick={() => createTaskMutation.mutate()}
            >
              {createTaskMutation.isPending ? '提交中…' : '提交任务'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowTaskForm(false)}>取消</button>
          </div>
        </section>
      )}

      {showRunForm && (
        <section className="panel p-5">
          <h3 className="text-sm font-semibold">从该规划发起复现运行</h3>
          <p className="mt-1 text-xs text-ink-muted">
            POST /reproductions/runs。如无安全沙箱，后端返回 execution_enabled=false 与 blocked_no_sandbox，不会伪造运行。
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-[220px] flex-1">
              <label className="field-label" htmlFor="requested-by">发起人 requested_by</label>
              <input id="requested-by" className="field-input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
            </div>
            <button
              type="button"
              className="btn-primary"
              disabled={createRunMutation.isPending}
              onClick={() => createRunMutation.mutate()}
            >
              <Play size={15} />{createRunMutation.isPending ? '创建中…' : '发起运行'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setShowRunForm(false)}>取消</button>
          </div>
          <MutationError error={createRunMutation.error} />
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <GitBranch size={17} className="text-accent" />
              <h3 className="text-sm font-semibold">任务依赖图</h3>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-ink-muted">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#1a7f52' }} />就绪</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#c58a00' }} />缺失</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#c0392b' }} />阻塞</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#d97706' }} />待人工</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: '#76879b' }} />无法验证</span>
            </div>
          </div>
          <div className="overflow-auto p-3">
            {layout.nodes.length === 0 ? (
              <EmptyState compact icon={GitBranch} title="DAG 为空" description="后端未返回任何任务节点。" />
            ) : (
              <svg
                role="img"
                aria-label="复现任务依赖有向无环图"
                width={layout.width}
                height={layout.height}
                viewBox={`0 0 ${layout.width} ${layout.height}`}
                className="block"
              >
                <defs>
                  <marker id="repro-arrow" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto">
                    <path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8" />
                  </marker>
                </defs>
                {plan.dag.edges.map((edge, index) => {
                  const from = layout.byId.get(edge.from)
                  const to = layout.byId.get(edge.to)
                  if (!from || !to) return null
                  const x1 = from.x + NODE_W
                  const y1 = from.y + NODE_H / 2
                  const x2 = to.x
                  const y2 = to.y + NODE_H / 2
                  return (
                    <path
                      key={`${edge.from}-${edge.to}-${index}`}
                      d={`M ${x1} ${y1} C ${x1 + 30} ${y1}, ${x2 - 30} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="#94a3b8"
                      strokeWidth={1.5}
                      markerEnd="url(#repro-arrow)"
                    />
                  )
                })}
                {layout.nodes.map((node) => {
                  const color = feasibilityColor(node.feasibility)
                  const selected = node.id === selectedNodeId
                  const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label
                  return (
                    <g
                      key={node.id}
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer"
                      onClick={() => setSelectedNodeId(node.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') setSelectedNodeId(node.id)
                      }}
                    >
                      <title>{`${node.label} · ${feasibilityLabel(node.feasibility)} · ${taskStatusLabel(node.status)}`}</title>
                      <rect
                        x={node.x}
                        y={node.y}
                        width={NODE_W}
                        height={NODE_H}
                        rx={8}
                        fill="#ffffff"
                        stroke={selected ? '#2e6bff' : color}
                        strokeWidth={selected ? 2.5 : 1.5}
                      />
                      <rect x={node.x} y={node.y} width={5} height={NODE_H} rx={2} fill={color} />
                      <text x={node.x + 14} y={node.y + 27} fontSize={12.5} fontWeight={600} fill="#0e1b2a">
                        {label}
                      </text>
                      <text x={node.x + 14} y={node.y + 47} fontSize={10.5} fill="#4a5b6e">
                        {feasibilityLabel(node.feasibility)} · {taskStatusLabel(node.status)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </section>

        <section className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <ShieldCheck size={17} className="text-accent" />
              <h3 className="text-sm font-semibold">节点详情</h3>
            </div>
          </div>
          <div className="space-y-3 p-5">
            {!selectedNode ? (
              <EmptyState
                compact
                icon={GitBranch}
                title="点击节点查看任务详情"
                description="详情来自 GET /reproductions/plans/{plan_id} 返回的 tasks 数组。"
              />
            ) : (
              <>
                <div>
                  <p className="text-sm font-semibold">{selectedNode.label}</p>
                  <p className="mono mt-0.5 break-all text-[11px] text-ink-subtle">{selectedNode.id}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={feasibilityTone(selectedNode.feasibility)}>
                    {feasibilityLabel(selectedNode.feasibility)}
                  </StatusBadge>
                  <StatusBadge tone={taskStatusTone(selectedNode.status)}>
                    {taskStatusLabel(selectedNode.status)}
                  </StatusBadge>
                </div>
                {!selectedTask ? (
                  <p className="text-xs text-ink-muted">后端未返回与该节点匹配的任务详情。</p>
                ) : (
                  <dl className="space-y-3 text-xs">
                    <DetailItem label="任务编号" value={selectedTask.task_key} mono />
                    <DetailItem label="任务说明" value={selectedTask.description} />
                    <DetailItem label="执行动作" value={selectedTask.action} />
                    <DetailItem label="预期结果" value={selectedTask.expected_result} />
                    <DetailItem label="验收标准" value={selectedTask.acceptance_criteria} />
                    <DetailItem label="前置条件" value={selectedTask.depends_on.join('、') || '无'} />
                    <DetailItem label="所需材料" value={selectedTask.required_materials.join('、') || '无'} />
                    <DetailItem label="证据引用" value={selectedTask.evidence_refs.join('、') || '无'} />
                    <DetailItem label="可行性原因" value={selectedTask.feasibility_reason} />
                    <DetailItem label="风险" value={selectedTask.risk} />
                    <DetailItem label="需人工确认" value={selectedTask.needs_human_confirm ? '是' : '否'} />
                  </dl>
                )}
                {selectedTask && (selectedTask.status === 'pending' || selectedTask.status === 'blocked') && (
                  <div className="border-t border-line pt-3">
                    <button
                      type="button"
                      className="btn-ghost w-full"
                      disabled={confirmTaskMutation.isPending}
                      onClick={() => confirmTaskMutation.mutate(selectedTask.task_id)}
                    >
                      <UserCheck size={15} />
                      {confirmTaskMutation.isPending ? '确认中…' : '人工确认该任务'}
                    </button>
                    <MutationError error={confirmTaskMutation.error} />
                    {confirmTaskMutation.isSuccess && (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-success">
                        <CheckCircle2 size={14} /> 已确认，状态：{taskStatusLabel(confirmTaskMutation.data.status)}
                      </p>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-primary w-full"
                  disabled={createRunMutation.isPending}
                  onClick={() => setShowRunForm(true)}
                >
                  <Play size={15} />从该规划发起运行
                </button>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-semibold text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 whitespace-pre-wrap break-words text-ink ${mono ? 'mono' : ''}`}>
        {value || '—'}
      </dd>
    </div>
  )
}
