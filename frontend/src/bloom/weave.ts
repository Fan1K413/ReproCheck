import { useMemo } from 'react'
import type { BloomUnitId } from './types'
import type { MaterialView, EvidenceGraph } from '../types/api'
import type { ReproRunView, EnvironmentView, ComparisonView, PlanView, ReportView } from '../types/reproduction'
import {
  useComparisons,
  useEvidenceGraph,
  useProjectMaterials,
  useReproEnvironments,
  useReproPlans,
  useReproReports,
  useReproRuns,
} from './unitDetailParts'

/**
 * 证据织机（Evidence Loom）—— 把项目里真实存在的外键关系派生成一张
 * 「模块依赖图」。没有任何硬编码的业务关系：一条边只有当后端数据里
 * 真的存在对应的 id 引用时才会出现，并携带产生它的具体记录。
 *
 * 这是三级「组合式工作空间」的核心：用户点选一个模块，就能沿真实链路
 * 高亮它的上下游，看到"这条边是因为哪几条真实记录才成立"。
 */

export type WeaveKind =
  | 'extract' // 材料 → 事实/证据（解析抽取）
  | 'support' // 事实 → 证据（逐条落证）
  | 'compose' // 材料/事实 → 规划（编排任务）
  | 'execute' // 规划 → 运行、环境 → 运行
  | 'verify' // 运行 → 验证（指标对照）
  | 'report' // 验证 → 报告
  | 'supply' // 数据集 → 环境/运行（供数）

export type WeaveEvidenceItem = {
  id: string
  label: string
}

export type WeaveEdge = {
  key: string
  from: BloomUnitId
  to: BloomUnitId
  kind: WeaveKind
  /** 关系的人类可读标签，例如「3 个运行的 environment_id 指向此环境」。 */
  label: string
  /** 产生这条边的真实记录数量 —— 决定边的粗细。 */
  count: number
  /** 具体的真实记录，点击边可下钻。 */
  evidence: WeaveEvidenceItem[]
}

export type WeaveGraph = {
  edges: WeaveEdge[]
  adjacency: Map<BloomUnitId, WeaveEdge[]>
  /** 每个模块参与的真实边数量。 */
  degree: Map<BloomUnitId, number>
  ready: boolean
}

export const WEAVE_KIND_LABEL: Record<WeaveKind, string> = {
  extract: '解析抽取',
  support: '逐条落证',
  compose: '任务编排',
  execute: '执行运行',
  verify: '指标对照',
  report: '结论归档',
  supply: '数据供给',
}

function edgeKey(from: BloomUnitId, to: BloomUnitId, kind: WeaveKind) {
  return `${from}>${to}:${kind}`
}

/**
 * 从真实数据派生整张依赖图。
 * 所有输入都来自后端接口，函数本身纯计算，不产生任何虚构关系。
 */
export function deriveWeave(params: {
  materials?: MaterialView[]
  evidence?: EvidenceGraph
  plans?: PlanView[]
  envs?: EnvironmentView[]
  runs?: ReproRunView[]
  comparisons?: ComparisonView[]
  reports?: ReportView[]
}): WeaveGraph {
  const { materials = [], evidence, plans = [], envs = [], runs = [], comparisons = [], reports = [] } = params
  const edges: WeaveEdge[] = []

  const push = (
    from: BloomUnitId,
    to: BloomUnitId,
    kind: WeaveKind,
    labelFor: (count: number) => string,
    evidenceItems: WeaveEvidenceItem[],
  ) => {
    if (evidenceItems.length === 0) return
    edges.push({
      key: edgeKey(from, to, kind),
      from,
      to,
      kind,
      label: labelFor(evidenceItems.length),
      count: evidenceItems.length,
      evidence: evidenceItems,
    })
  }

  // 1) 材料 → 事实 / 证据：来自证据图谱里 fact 节点携带的 material_id。
  const factNodes = (evidence?.nodes ?? []).filter((node) => node.type === 'fact' && node.material_id)
  const materialIds = new Set(materials.map((m) => m.material_id))
  const factsByMaterial = new Map<string, WeaveEvidenceItem[]>()
  factNodes.forEach((node) => {
    const mid = node.material_id as string
    if (!materialIds.has(mid)) return
    const list = factsByMaterial.get(mid) ?? []
    list.push({ id: node.fact_id ?? node.id, label: node.label || node.field_key || node.id })
    factsByMaterial.set(mid, list)
  })
  const factEvidence: WeaveEvidenceItem[] = []
  factsByMaterial.forEach((list, mid) => {
    const file = materials.find((m) => m.material_id === mid)
    factEvidence.push({
      id: mid,
      label: `${file?.filename ?? mid.slice(0, 10)} · ${list.length} 条事实`,
    })
  })
  push('materials', 'facts', 'extract', (n) => `${n} 份材料解析出可复述事实`, factEvidence)

  // 2) 事实 → 证据：来自 evidence.edges 中 supported_by。
  const supportedEdges = (evidence?.edges ?? []).filter((e) => e.type === 'supported_by')
  const factById = new Map<string, string>()
  ;(evidence?.nodes ?? []).forEach((node) => {
    if (node.type === 'fact' && node.fact_id) factById.set(`fact:${node.fact_id}`, node.label || node.field_key || node.fact_id)
  })
  const supportEvidence: WeaveEvidenceItem[] = supportedEdges.slice(0, 40).map((e, i) => ({
    id: `${e.source}-${e.target}-${i}`,
    label: `${factById.get(e.source) ?? e.source.slice(0, 14)} → 原文证据`,
  }))
  push('facts', 'evidence', 'support', (n) => `${n} 条事实绑定原文位置`, supportEvidence)

  // 3) 材料 → 规划：来自每个 plan 下 task 的 required_materials。
  const planTasks = (plans as Array<PlanView & { tasks?: { required_materials?: string[]; evidence_refs?: string[] }[] }>)
    .flatMap((plan) => plan.tasks ?? [])
  const tasksByMaterial = new Map<string, number>()
  planTasks.forEach((task) => {
    ;(task.required_materials ?? []).forEach((mid) => {
      if (!materialIds.has(mid)) return
      tasksByMaterial.set(mid, (tasksByMaterial.get(mid) ?? 0) + 1)
    })
  })
  const composeEvidence: WeaveEvidenceItem[] = []
  tasksByMaterial.forEach((count, mid) => {
    const file = materials.find((m) => m.material_id === mid)
    composeEvidence.push({ id: mid, label: `${file?.filename ?? mid.slice(0, 10)} · ${count} 个任务引用` })
  })
  push('materials', 'plan', 'compose', (n) => `${n} 份材料被任务直接引用`, composeEvidence)

  // 4) 数据集 → 规划：材料里的 data 类型同时被任务引用。
  const dataMaterials = materials.filter((m) => String(m.material_type).toLowerCase().includes('data'))
  const dataRefs = dataMaterials.filter((m) => tasksByMaterial.has(m.material_id))
  push('dataset', 'plan', 'supply', (n) => `${n} 个数据文件进入任务步骤`, dataRefs.map((m) => ({ id: m.material_id, label: m.filename })))

  // 5) 规划 → 运行：run.plan_id 指向真实 plan。
  const planIds = new Set(plans.map((p) => p.plan_id))
  const runsByPlan = runs.filter((r) => planIds.has(r.plan_id))
  push('plan', 'runs', 'execute', (n) => `${n} 个运行执行了该规划`, runsByPlan.map((r) => ({ id: r.run_id, label: `${r.run_id.slice(0, 14)} · ${r.status}` })))

  // 6) 环境 → 运行：run.environment_id 指向真实 env。
  const envIds = new Set(envs.map((e) => e.environment_id))
  const runsByEnv = runs.filter((r) => r.environment_id && envIds.has(r.environment_id))
  const envEvidence: WeaveEvidenceItem[] = runsByEnv.map((r) => {
    const env = envs.find((e) => e.environment_id === r.environment_id)
    return { id: r.run_id, label: `${r.run_id.slice(0, 12)} @ ${env?.python_version ?? '环境'}` }
  })
  push('environment', 'runs', 'execute', (n) => `${n} 个运行在锁定环境中执行`, envEvidence)

  // 7) 数据集 → 环境：env 若声明了 material_id 且该材料是数据。
  const envWithData = envs.filter((e) => {
    const mid = (e as EnvironmentView & { material_id?: string }).material_id
    return Boolean(mid && dataMaterials.some((m) => m.material_id === mid))
  })
  push('dataset', 'environment', 'supply', (n) => `${n} 个环境挂载了数据快照`, envWithData.map((e) => ({ id: e.environment_id, label: `${e.python_version ?? '环境'} · ${e.environment_id.slice(0, 10)}` })))

  // 8) 运行 → 验证：comparison.verdict 由复现指标产生，与 run 同项目。
  if (runs.length > 0 && comparisons.length > 0) {
    push('runs', 'verification', 'verify', (n) => `${n} 项指标完成对照判定`, comparisons.map((c) => ({
      id: c.comparison_id ?? c.metric_name,
      label: `${c.metric_name} · ${c.verdict}`,
    })))
  }

  // 9) 验证 → 报告：报告里含 section_count，表示已归档的结论章节。
  if (comparisons.length > 0 && reports.length > 0) {
    push('verification', 'report', 'report', (n) => `${n} 份报告归档了对照结论`, reports.map((r) => ({
      id: r.report_id,
      label: `${r.title ?? r.report_id.slice(0, 12)} · ${r.section_count ?? 0} 节`,
    })))
  }

  // 邻接表：无向看待，方便高亮"上下游"。
  const adjacency = new Map<BloomUnitId, WeaveEdge[]>()
  const degree = new Map<BloomUnitId, number>()
  edges.forEach((edge) => {
    const a = adjacency.get(edge.from) ?? []
    a.push(edge)
    adjacency.set(edge.from, a)
    const b = adjacency.get(edge.to) ?? []
    b.push(edge)
    adjacency.set(edge.to, b)
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1)
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1)
  })

  return { edges, adjacency, degree, ready: true }
}

/** 计算从某个模块出发、沿真实边可达的相关模块集合（BFS，默认 2 跳）。 */
export function reachableFrom(graph: WeaveGraph, start: BloomUnitId, hops = 2): Set<BloomUnitId> {
  const seen = new Set<BloomUnitId>([start])
  let frontier: BloomUnitId[] = [start]
  for (let step = 0; step < hops; step += 1) {
    const next: BloomUnitId[] = []
    frontier.forEach((id) => {
      ;(graph.adjacency.get(id) ?? []).forEach((edge) => {
        const other = edge.from === id ? edge.to : edge.from
        if (!seen.has(other)) {
          seen.add(other)
          next.push(other)
        }
      })
    })
    frontier = next
    if (frontier.length === 0) break
  }
  return seen
}

/**
 * 在 React 组件里构建织机图。复用现有 hooks 的缓存键，不会新增后端请求。
 */
export function useWeaveGraphFor(projectId: string): WeaveGraph {
  const materialsQuery = useProjectMaterials(projectId)
  const evidenceQuery = useEvidenceGraph(projectId)
  const plansQuery = useReproPlans(projectId)
  const envsQuery = useReproEnvironments(projectId)
  const runsQuery = useReproRuns(projectId)
  const comparisonsQuery = useComparisons(projectId)
  const reportsQuery = useReproReports(projectId)

  return useMemo(
    () => deriveWeave({
      materials: materialsQuery.data?.items,
      evidence: evidenceQuery.data,
      plans: plansQuery.data?.items,
      envs: envsQuery.data?.items,
      runs: runsQuery.data?.items,
      comparisons: comparisonsQuery.data?.items,
      reports: reportsQuery.data?.items,
    }),
    [materialsQuery.data, evidenceQuery.data, plansQuery.data, envsQuery.data, runsQuery.data, comparisonsQuery.data, reportsQuery.data],
  )
}
