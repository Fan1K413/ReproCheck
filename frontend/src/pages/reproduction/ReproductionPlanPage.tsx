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
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import { formatDateTime } from '../../features/format'
import {
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
  DagEdge,
  DagNode,
  ReproTaskView,
  ReproductionDag,
} from '../../types/reproduction'
import { useUIStore } from '../../stores/uiStore'
import '../../styles/wave-a-repro.css'

const NODE_W = 158
const NODE_H = 64
const GAP_X = 72
const GAP_Y = 28
const PAD = 28

type PositionedNode = DagNode & { x: number; y: number }

type DagLayout = {
  nodes: PositionedNode[]
  edges: DagEdge[]
  byId: Map<string, PositionedNode>
  width: number
  height: number
}

/** 可行性 → token 颜色（不复用旧 hex 映射，保持 --rc-* 唯一色源）。 */
const FEASIBILITY_TOKEN: Record<string, string> = {
  ready: 'var(--rc-success)',
  feasible: 'var(--rc-success)',
  missing_material: 'var(--rc-warning)',
  missing_dependency: 'var(--rc-warning)',
  missing_configuration: 'var(--rc-warning)',
  needs_human_review: 'var(--rc-warning)',
  blocked_security: 'var(--rc-danger)',
  unverifiable: 'var(--rc-neutral)',
}

/** 任务状态 → token 颜色（DAG 节点状态条）。 */
const TASK_STATUS_TOKEN: Record<string, string> = {
  pending: 'var(--rc-neutral)',
  blocked: 'var(--rc-danger)',
  confirmed: 'var(--rc-violet)',
  running: 'var(--rc-violet)',
  completed: 'var(--rc-success)',
  failed: 'var(--rc-danger)',
  cancelled: 'var(--rc-neutral)',
}

const feasibilityToken = (value: string): string =>
  FEASIBILITY_TOKEN[value] ?? 'var(--rc-neutral)'

const taskStatusToken = (value: string): string =>
  TASK_STATUS_TOKEN[value] ?? 'var(--rc-neutral)'

/** 后端实际返回的 feasibility 取值补充中文（共享 meta 未收录的键值就地翻译，不改共享文件）。 */
const FEASIBILITY_ZH: Record<string, string> = {
  feasible: '可行',
  ready: '就绪',
  missing_material: '缺少材料',
  missing_dependency: '缺少依赖',
  missing_configuration: '缺少配置',
  needs_human_review: '待人工确认',
  blocked_security: '安全阻塞',
  unverifiable: '无法验证',
}

const feasLabel = (value: string): string => FEASIBILITY_ZH[value] ?? feasibilityLabel(value)

/** 规划状态补充中文（后端可能返回 confirmed 等共享表未收录的值）。 */
const PLAN_STATUS_ZH: Record<string, string> = {
  confirmed: '已确认',
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
  blocked: '已阻塞',
}

const planStatusZh = (value: string): string => PLAN_STATUS_ZH[value] ?? value

/**
 * 后端 dag.nodes 的 id 与 dag.edges 的端点可能分别使用 task_key / task_id，
 * 这里只做「同一实体的 id 别名归一」，不新增、不推断任何依赖关系：
 * 归一后仍严格按后端返回的 edges 绘制。
 */
function buildAliasIndex(tasks: ReproTaskView[], nodes: DagNode[]): Map<string, string> {
  const alias = new Map<string, string>()
  tasks.forEach((task) => {
    alias.set(task.task_id, task.task_key)
    alias.set(task.task_key, task.task_key)
  })
  nodes.forEach((node) => alias.set(node.id, node.id))
  return alias
}

/** 仅做布局，不做依赖推断：节点集合与边集合完全来自后端 dag.nodes / dag.edges。 */
function layoutDag(dag: ReproductionDag, alias: Map<string, string>): DagLayout {
  const nodes = dag.nodes ?? []
  const nodeIds = new Set(nodes.map((node) => node.id))
  const resolve = (raw: string) => {
    const mapped = alias.get(raw)
    return mapped && nodeIds.has(mapped) ? mapped : raw
  }
  const edges = (dag.edges ?? [])
    .map((edge) => ({ from: resolve(edge.from), to: resolve(edge.to) }))
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))
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
    edges,
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
    <div className="rc-wa-panel" style={{ borderColor: 'var(--rc-danger)' }}>
      <div
        className="rc-wa-panel__body"
        style={{ backgroundColor: 'var(--rc-danger-wash)', display: 'flex', gap: 'var(--rc-space-2)' }}
      >
        <Icon as={AlertTriangle} size="sm" tone="danger" />
        <div style={{ minWidth: 0 }}>
          <p className="rc-wa-sub" style={{ color: 'var(--rc-danger)' }}>
            操作未成功
          </p>
          <p style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
            {message}
          </p>
          <p className="rc-wa-pick__id" style={{ color: 'var(--rc-danger)' }}>
            错误码：{code}
          </p>
        </div>
      </div>
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
    () => (planQuery.data ? layoutDag(planQuery.data.dag, buildAliasIndex(planQuery.data.tasks ?? [], planQuery.data.dag?.nodes ?? [])) : null),
    [planQuery.data],
  )

  /* 步骤顺序 = 后端 dag.nodes 的拓扑层序（仅布局，不推断依赖） */
  const stepOrder = useMemo(() => {
    if (!layout) return [] as PositionedNode[]
    return [...layout.nodes].sort((a, b) => (a.x - b.x) || (a.y - b.y))
  }, [layout])

  /** 任务（task_id / task_key）↔ DAG 节点 id 的映射，保证步骤树与时间轴选中态一致。 */
  const nodeIdByTask = useMemo(() => {
    const map = new Map<string, string>()
    const source = planQuery.data
    if (!source || !layout) return map
    layout.nodes.forEach((node) => map.set(node.id, node.id))
    source.tasks.forEach((task) => {
      const node = layout.nodes.find((item) => item.id === task.task_key || item.id === task.task_id)
      if (!node) return
      map.set(task.task_id, node.id)
      map.set(task.task_key, node.id)
    })
    return map
  }, [planQuery.data, layout])

  if (planQuery.isPending) {
    return <LoadingState message="正在读取复现规划…" hint="正在读取后端规划详情" />
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

  const selectedTask = selectedNodeId ? findTask(plan.tasks, selectedNodeId) : undefined
  const selectedNode = selectedNodeId ? layout.byId.get(selectedNodeId) : undefined
  const runningNodeId = stepOrder.find((node) => node.status === 'running')?.id ?? null

  const setTextField = (key: TextFieldKey, value: string) =>
    setTaskForm((prev) => ({ ...prev, [key]: value }))
  const setListField = (key: ListFieldKey, value: string) => {
    setListInputs((prev) => ({ ...prev, [key]: value }))
    setTaskForm((prev) => ({ ...prev, [key]: splitList(value) }))
  }

  /* 只读配置区：全部取自后端返回字段，无则显式写「未提供脚本」 */
  const scriptLines: string[] = selectedTask
    ? [
        `# ${selectedTask.task_key} · ${selectedTask.title}`,
        `# status=${selectedTask.status} feasibility=${selectedTask.feasibility}`,
        `# created_at=${selectedTask.created_at}`,
        `action = "${selectedTask.action || '未提供脚本'}"`,
        `expected_result = "${selectedTask.expected_result || '未提供脚本'}"`,
        `acceptance_criteria = "${selectedTask.acceptance_criteria || '未提供脚本'}"`,
        `depends_on = [${selectedTask.depends_on.join(', ')}]`,
        `required_materials = [${selectedTask.required_materials.join(', ')}]`,
        `evidence_refs = [${selectedTask.evidence_refs.join(', ')}]`,
        `risk = "${selectedTask.risk || '未提供脚本'}"`,
        `feasibility_reason = "${selectedTask.feasibility_reason || '未提供脚本'}"`,
        `needs_human_confirm = ${selectedTask.needs_human_confirm ? 'true' : 'false'}`,
      ]
    : [
        `# plan_id = ${plan.plan_id}`,
        `# 未选择步骤：请在左侧步骤树或上方时间轴中选择一个节点`,
        `# 节点与边完全来自后端 dag.nodes / dag.edges，前端仅做布局`,
      ]

  return (
    <div className="rc-wa-page" style={{ paddingBottom: 'var(--rc-space-8)' }}>
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">复现规划 DAG</p>
          <h1 className="rc-wa-title">{plan.title || '未命名规划'}</h1>
          <p className="rc-wa-lede">
            节点与边均由后端返回，前端仅做布局，不推断依赖。
          </p>
        </div>
        <div className="rc-wa-head__actions">
          <Link to={`/projects/${plan.project_id}/reproduction`} className="btn-ghost">
            <Icon as={ArrowLeft} size="sm" />
            返回总览
          </Link>
          <button type="button" className="btn-ghost" onClick={() => setShowPlanForm((v) => !v)}>
            <Icon as={Plus} size="sm" />
            新建规划
          </button>
          <button type="button" className="btn-primary" onClick={() => setShowTaskForm((v) => !v)}>
            <Icon as={ListPlus} size="sm" />
            新增任务
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--rc-space-2)' }}>
        <StatusBadge tone="accent">任务 {plan.task_count}</StatusBadge>
        <StatusBadge tone="neutral">
          规划 ID <span className="mono">{plan.plan_id}</span>
        </StatusBadge>
        <StatusBadge tone="neutral">来源 {plan.source ?? '—'}</StatusBadge>
        <StatusBadge tone={plan.ai_available ? 'success' : 'warning'}>
          AI {plan.ai_available ? '可用' : '不可用'}
        </StatusBadge>
        <span style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
          创建时间 {formatDateTime(plan.created_at)}
        </span>
      </div>

      {showPlanForm && (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <h2 className="rc-wa-panel__title">新建复现规划</h2>
            <p className="rc-wa-lede" style={{ fontSize: 'var(--rc-fs-caption)', marginTop: 'var(--rc-space-2)' }}>
              使用后端规划接口。无模型密钥时后端会明确返回不可用状态，不会生成假规划。
            </p>
            <div style={{ marginTop: 'var(--rc-space-4)', maxWidth: 420 }}>
              <label className="field-label" htmlFor="plan-title">
                规划标题（可选）
              </label>
              <input
                id="plan-title"
                className="field-input"
                value={planTitle}
                onChange={(event) => setPlanTitle(event.target.value)}
                placeholder="留空则由后端生成"
              />
            </div>
            <div style={{ marginTop: 'var(--rc-space-4)' }}>
              <MutationError error={createPlanMutation.error} />
            </div>
            <div style={{ marginTop: 'var(--rc-space-4)', display: 'flex', gap: 'var(--rc-space-2)' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={createPlanMutation.isPending}
                onClick={() => createPlanMutation.mutate()}
              >
                {createPlanMutation.isPending ? '创建中…' : '提交创建'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowPlanForm(false)}>
                取消
              </button>
            </div>
          </div>
        </section>
      )}

      {showTaskForm && (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <h2 className="rc-wa-panel__title">新增任务（程序化，不调用 AI）</h2>
            <p className="rc-wa-lede" style={{ fontSize: 'var(--rc-fs-caption)', marginTop: 'var(--rc-space-2)' }}>
              后端规划任务接口
            </p>
            <div className="rc-wa-persp__meta" style={{ marginTop: 'var(--rc-space-4)' }}>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label" htmlFor="task-title">
                  任务标题 *
                </label>
                <input id="task-title" className="field-input" value={taskForm.title} onChange={(e) => setTextField('title', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label" htmlFor="task-desc">
                  任务说明
                </label>
                <textarea id="task-desc" className="field-input" rows={2} value={taskForm.description} onChange={(e) => setTextField('description', e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-action">
                  执行动作
                </label>
                <input id="task-action" className="field-input" value={taskForm.action} onChange={(e) => setTextField('action', e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-expected">
                  预期结果
                </label>
                <input id="task-expected" className="field-input" value={taskForm.expected_result} onChange={(e) => setTextField('expected_result', e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / -1' }}>
                <label className="field-label" htmlFor="task-accept">
                  验收标准
                </label>
                <textarea id="task-accept" className="field-input" rows={2} value={taskForm.acceptance_criteria} onChange={(e) => setTextField('acceptance_criteria', e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-depends">
                  前置任务（逗号分隔，task_key）
                </label>
                <input id="task-depends" className="field-input" value={listInputs.depends_on} onChange={(e) => setListField('depends_on', e.target.value)} placeholder="T00,T01" />
              </div>
              <div>
                <label className="field-label" htmlFor="task-materials">
                  所需材料（逗号分隔）
                </label>
                <input id="task-materials" className="field-input" value={listInputs.required_materials} onChange={(e) => setListField('required_materials', e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-evidence">
                  证据引用（逗号分隔）
                </label>
                <input id="task-evidence" className="field-input" value={listInputs.evidence_refs} onChange={(e) => setListField('evidence_refs', e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="task-risk">
                  风险
                </label>
                <input id="task-risk" className="field-input" value={taskForm.risk} onChange={(e) => setTextField('risk', e.target.value)} />
              </div>
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--rc-space-2)',
                marginTop: 'var(--rc-space-3)',
                fontSize: 'var(--rc-fs-caption)',
                color: 'var(--rc-text-muted)',
              }}
            >
              <input
                type="checkbox"
                checked={taskForm.needs_human_confirm}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, needs_human_confirm: e.target.checked }))}
              />
              需要人工确认（needs_human_confirm）
            </label>
            <div style={{ marginTop: 'var(--rc-space-4)' }}>
              <MutationError error={createTaskMutation.error} />
            </div>
            <div style={{ marginTop: 'var(--rc-space-4)', display: 'flex', gap: 'var(--rc-space-2)' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={createTaskMutation.isPending || !taskForm.title.trim()}
                onClick={() => createTaskMutation.mutate()}
              >
                {createTaskMutation.isPending ? '提交中…' : '提交任务'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowTaskForm(false)}>
                取消
              </button>
            </div>
          </div>
        </section>
      )}

      {showRunForm && (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <h2 className="rc-wa-panel__title">从该规划发起复现运行</h2>
            <p className="rc-wa-lede" style={{ fontSize: 'var(--rc-fs-caption)', marginTop: 'var(--rc-space-2)' }}>
              运行接口。如无安全沙箱，后端会明确返回不可执行状态，不会伪造运行。
            </p>
            <div style={{ marginTop: 'var(--rc-space-4)', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 'var(--rc-space-3)' }}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <label className="field-label" htmlFor="requested-by">
                  发起人 requested_by
                </label>
                <input id="requested-by" className="field-input" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
              </div>
              <button
                type="button"
                className="btn-primary"
                disabled={createRunMutation.isPending}
                onClick={() => createRunMutation.mutate()}
              >
                <Icon as={Play} size="sm" />
                {createRunMutation.isPending ? '创建中…' : '发起运行'}
              </button>
              <button type="button" className="btn-ghost" onClick={() => setShowRunForm(false)}>
                取消
              </button>
            </div>
            <div style={{ marginTop: 'var(--rc-space-4)' }}>
              <MutationError error={createRunMutation.error} />
            </div>
          </div>
        </section>
      )}

      {/* ========== 特色交互 1：版本 / 步骤时间轴（横向滚动 + 步骤树双向联动） ========== */}
      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={GitBranch} size="sm" tone="accent" />
            版本 / 步骤时间轴
          </div>
          <span className="rc-wa-source">
            版本 prompt_version={plan.prompt_version ?? '—'} · 节点 {plan.dag?.nodes?.length ?? 0} · 边 {plan.dag?.edges?.length ?? 0}
          </span>
        </div>
        <div className="rc-wa-rail" role="group" aria-label="复现步骤时间轴">
          {stepOrder.length === 0 ? (
            <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)', padding: 'var(--rc-space-2)' }}>
              后端未返回任何任务节点。
            </p>
          ) : (
            stepOrder.map((node, index) => {
              const isCurrent = node.id === selectedNodeId
              const isRunning = node.id === runningNodeId
              return (
                <button
                  key={node.id}
                  type="button"
                  className={`rc-wa-rail__item${isRunning ? ' is-running' : ''}`}
                  aria-current={isCurrent ? 'step' : undefined}
                  onClick={() => setSelectedNodeId(node.id)}
                >
                  <span className="rc-wa-rail__idx">
                    {String(index + 1).padStart(2, '0')} · {node.id}
                  </span>
                  <span className="rc-wa-rail__name">{node.label}</span>
                  <span className="rc-wa-rail__state">
                    {taskStatusLabel(node.status)} · {feasLabel(node.feasibility)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </section>

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
            gridTemplateColumns: 'minmax(0, 220px) minmax(0, 1fr)',
            alignItems: 'start',
          }}
        >
          {/* 左：步骤树 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">步骤树</div>
              <span className="rc-wa-source">{plan.tasks.length} 步</span>
            </div>
            <div className="rc-wa-tree" role="tree" aria-label="复现步骤树">
              {plan.tasks.length === 0 ? (
                <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                  后端未返回任务列表。
                </p>
              ) : (
                plan.tasks.map((task) => {
                  const nodeId = nodeIdByTask.get(task.task_id) ?? task.task_id
                  return (
                    <button
                      key={task.task_id}
                      type="button"
                      role="treeitem"
                      className="rc-wa-tree__item"
                      aria-current={selectedNodeId === nodeId ? 'step' : undefined}
                      onClick={() => setSelectedNodeId(nodeId)}
                    >
                      <span className="rc-wa-tree__name">{task.title}</span>
                      <span className="rc-wa-tree__state">
                        {task.task_key} · {taskStatusLabel(task.status)}
                      </span>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          {/* 右：上 40% 只读区 + 下 60% DAG */}
          <div style={{ display: 'grid', gap: 'var(--rc-grid-gutter)', minWidth: 0 }}>
            <section className="rc-wa-panel">
              <div className="rc-wa-panel__head">
                <div className="rc-wa-panel__title">
                  <Icon as={ShieldCheck} size="sm" tone="accent" />
                  步骤脚本 / 配置（只读）
                </div>
                <span className="rc-wa-source">
                  {selectedTask ? `tasks[] · ${selectedTask.task_key}` : 'tasks[]'}
                </span>
              </div>
              <div className="rc-wa-panel__body rc-wa-panel__body--tight">
                <div className="rc-wa-code" role="region" aria-label="步骤脚本只读区">
                  {scriptLines.map((line, index) => (
                    <div className="rc-wa-code__line" key={`${index}-${line.slice(0, 12)}`}>
                      <span className="rc-wa-code__ln">{String(index + 1).padStart(2, '0')}</span>
                      <span className={line.startsWith('#') ? 'rc-wa-code__txt rc-wa-code__txt--muted' : 'rc-wa-code__txt'}>
                        {line}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="rc-wa-panel">
              <div className="rc-wa-panel__head">
                <div className="rc-wa-panel__title">
                  <Icon as={GitBranch} size="sm" tone="accent" />
                  任务依赖图
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-3)' }}>
                  <LegendSwatch token="var(--rc-success)" label="就绪" />
                  <LegendSwatch token="var(--rc-warning)" label="缺失 / 待人工" />
                  <LegendSwatch token="var(--rc-danger)" label="阻塞" />
                  <LegendSwatch token="var(--rc-neutral)" label="无法验证" />
                </div>
              </div>
              <div className="rc-wa-dag">
                {layout.nodes.length === 0 ? (
                  <div style={{ padding: 'var(--rc-space-5)' }}>
                    <EmptyState compact icon={GitBranch} title="暂无复现步骤" description="后端未返回任何任务节点。" />
                  </div>
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
                        <path d="M0,0 L10,4 L0,8 Z" style={{ fill: 'var(--rc-text-subtle)' }} />
                      </marker>
                    </defs>
                    {layout.edges.map((edge, index) => {
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
                          style={{ stroke: 'var(--rc-border-strong)' }}
                          strokeWidth={1}
                          markerEnd="url(#repro-arrow)"
                        />
                      )
                    })}
                    {layout.nodes.map((node) => {
                      const color = feasibilityToken(node.feasibility)
                      const selected = node.id === selectedNodeId
                      const label = node.label.length > 18 ? `${node.label.slice(0, 17)}…` : node.label
                      const isRunning = node.id === runningNodeId
                      return (
                        <g
                          key={node.id}
                          role="button"
                          tabIndex={0}
                          className={`rc-wa-dag__node${isRunning ? ' is-running' : ''}`}
                          onClick={() => setSelectedNodeId(node.id)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') setSelectedNodeId(node.id)
                          }}
                        >
                          <title>{`${node.label} · ${feasLabel(node.feasibility)} · ${taskStatusLabel(node.status)}`}</title>
                          <rect
                            className="node-body"
                            x={node.x}
                            y={node.y}
                            width={NODE_W}
                            height={NODE_H}
                            rx={8}
                            style={{
                              fill: 'var(--rc-surface-3)',
                              stroke: selected ? 'var(--rc-magenta)' : 'var(--rc-border)',
                              strokeWidth: 1,
                            }}
                          />
                          <rect x={node.x} y={node.y} width={4} height={NODE_H} rx={2} style={{ fill: color }} />
                          <text x={node.x + 14} y={node.y + 27} fontSize={12.5} fontWeight={600} style={{ fill: 'var(--rc-text)' }}>
                            {label}
                          </text>
                          <text x={node.x + 14} y={node.y + 47} fontSize={10.5} style={{ fill: taskStatusToken(node.status) }}>
                            {feasLabel(node.feasibility)} · {taskStatusLabel(node.status)}
                          </text>
                        </g>
                      )
                    })}
                  </svg>
                )}
              </div>

              {/* 读屏等价的步骤列表 */}
              <details style={{ borderTop: 'var(--rc-stroke-hair)' }}>
                <summary
                  style={{
                    padding: 'var(--rc-space-3) var(--rc-space-5)',
                    cursor: 'pointer',
                    fontSize: 'var(--rc-fs-caption)',
                    color: 'var(--rc-text-muted)',
                  }}
                >
                  以列表形式查看 {layout.nodes.length} 个步骤（无障碍等价视图）
                </summary>
                <ol style={{ padding: '0 var(--rc-space-6) var(--rc-space-4)', margin: 0 }}>
                  {layout.nodes.map((node) => (
                    <li
                      key={node.id}
                      style={{
                        padding: 'var(--rc-space-2) 0',
                        borderBottom: 'var(--rc-stroke-hair)',
                        fontSize: 'var(--rc-fs-caption)',
                        color: 'var(--rc-text-muted)',
                      }}
                    >
                      {node.label} → {taskStatusLabel(node.status)} · {feasLabel(node.feasibility)}
                    </li>
                  ))}
                </ol>
              </details>
            </section>
          </div>
        </div>
      </div>

      {/* 节点详情 + 操作 */}
      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={ShieldCheck} size="sm" tone="accent" />
            节点详情
          </div>
          {selectedNode && (
            <span className="rc-wa-source">{selectedNode.id}</span>
          )}
        </div>
        <div className="rc-wa-panel__body">
          {!selectedNode ? (
            <EmptyState
              compact
              icon={GitBranch}
              title="点击节点查看任务详情"
              description="详情来自后端规划详情返回的任务列表。"
            />
          ) : (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
                <StatusBadge tone={feasibilityTone(selectedNode.feasibility)}>
                  {feasLabel(selectedNode.feasibility)}
                </StatusBadge>
                <StatusBadge tone={taskStatusTone(selectedNode.status)}>
                  {taskStatusLabel(selectedNode.status)}
                </StatusBadge>
              </div>
              {!selectedTask ? (
                <p style={{ marginTop: 'var(--rc-space-3)', fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                  后端未返回与该节点匹配的任务详情。
                </p>
              ) : (
                <dl
                  className="rc-wa-persp__meta"
                  style={{ marginTop: 'var(--rc-space-4)' }}
                >
                  <DetailItem label="任务标题" value={selectedTask.title} />
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
                <div style={{ marginTop: 'var(--rc-space-4)' }}>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={confirmTaskMutation.isPending}
                    onClick={() => confirmTaskMutation.mutate(selectedTask.task_id)}
                  >
                    <Icon as={UserCheck} size="sm" />
                    {confirmTaskMutation.isPending ? '确认中…' : '人工确认该任务'}
                  </button>
                  <div style={{ marginTop: 'var(--rc-space-3)' }}>
                    <MutationError error={confirmTaskMutation.error} />
                  </div>
                  {confirmTaskMutation.isSuccess && (
                    <p
                      style={{
                        marginTop: 'var(--rc-space-2)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--rc-space-2)',
                        fontSize: 'var(--rc-fs-caption)',
                        color: 'var(--rc-success)',
                      }}
                    >
                      <Icon as={CheckCircle2} size="xs" tone="success" />
                      已确认，状态：{taskStatusLabel(confirmTaskMutation.data.status)}
                    </p>
                  )}
                </div>
              )}
              <div style={{ marginTop: 'var(--rc-space-4)' }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={createRunMutation.isPending}
                  onClick={() => setShowRunForm(true)}
                >
                  <Icon as={Play} size="sm" />
                  从该规划发起运行
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* 底部固定状态条 */}
      <div className="rc-wa-statusbar">
        <span className="rc-wa-statusbar__item">
          <Icon as={GitBranch} size="xs" tone="muted" />
          规划 {plan.plan_id}
        </span>
        <span className="rc-wa-statusbar__item">
          状态 {planStatusZh(plan.status)}
        </span>
        <span className="rc-wa-statusbar__item">
          节点 {layout.nodes.length} / 边 {layout.edges.length}
        </span>
        <span className="rc-wa-statusbar__item">
          当前步骤 {selectedNode ? selectedNode.label : '未选择'}
        </span>
        <span className="rc-wa-statusbar__spacer" />
        <button type="button" className="btn-ghost" onClick={() => setShowRunForm(true)}>
          <Icon as={Play} size="sm" />
          发起运行
        </button>
      </div>
    </div>
  )
}
function LegendSwatch({ token, label }: { token: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-muted)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 'var(--rc-radius-disc)', backgroundColor: token }} aria-hidden="true" />
      {label}
    </span>
  )
}

function DetailItem({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="rc-wa-meta__k">{label}</dt>
      <dd
        className="rc-wa-meta__v"
        style={mono ? { fontFamily: 'var(--rc-font-mono)' } : { fontFamily: 'var(--rc-font-body)' }}
      >
        {value || '—'}
      </dd>
    </div>
  )
}
