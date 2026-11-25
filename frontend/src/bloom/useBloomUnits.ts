import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../services/api'
import type { MaterialView, Project } from '../types/api'
import type { BloomUnit, BloomUnitId, ComboInsight, WorkbenchUnitData } from './types'
import {
  isCodeMaterial,
  isConfigMaterial,
  isDataMaterial,
  planStatus,
  runStatus,
  useComparisons,
  useDataAudits,
  useEvidenceGraph,
  useFactsSummary,
  useParseOverview,
  useProjectMaterials,
  useProjectMembers,
  useProjectTasks,
  useReproEnvironments,
  useReproPlans,
  useReproQuality,
  useReproReports,
  useReproRuns,
  useVerdictSummary,
} from './unitDetailParts'

function useProjectsQuery() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    staleTime: 30_000,
  })
}

/** 加载 / 失败时不显示推测数字。 */
function valueOr(value: number | null | undefined, loading: boolean, failed: boolean): string {
  if (failed) return '—'
  if (loading || value == null) return '…'
  return new Intl.NumberFormat('zh-CN').format(value)
}

function score(value: number | null | undefined, loading: boolean, failed: boolean): string {
  if (failed) return '—'
  if (loading || value == null) return '…'
  return value.toFixed(3)
}

function materialAssets(materials: MaterialView[] | undefined) {
  const list = materials ?? []
  return {
    data: list.filter((material) => isDataMaterial(material.material_type)).length,
    code: list.filter((material) => isCodeMaterial(material.material_type)).length,
    config: list.filter((material) => isConfigMaterial(material.material_type)).length,
    docs: list.filter(
      (material) =>
        !isDataMaterial(material.material_type) &&
        !isCodeMaterial(material.material_type) &&
        !isConfigMaterial(material.material_type),
    ).length,
  }
}

function frameworkLine(frameworks: Record<string, unknown> | undefined): string {
  const entries = Object.entries(frameworks ?? {})
  if (entries.length === 0) return '未声明框架'
  return entries.map(([name, version]) => `${name} ${String(version)}`).join(' · ')
}

export function useBloomUnits(projectId: string): WorkbenchUnitData {
  const queryClient = useQueryClient()

  const projectsQuery = useProjectsQuery()
  const materialsQuery = useProjectMaterials(projectId)
  const tasksQuery = useProjectTasks(projectId)
  const factsQuery = useFactsSummary(projectId)
  const evidenceQuery = useEvidenceGraph(projectId)
  const plansQuery = useReproPlans(projectId)
  const envQuery = useReproEnvironments(projectId)
  const runsQuery = useReproRuns(projectId)
  const qualityQuery = useReproQuality(projectId)
  const verdictQuery = useVerdictSummary(projectId)
  const comparisonsQuery = useComparisons(projectId)
  const reportsQuery = useReproReports(projectId)
  const membersQuery = useProjectMembers(projectId)
  const auditsQuery = useDataAudits(projectId)

  const project: Project | null =
    projectsQuery.data?.items.find((item) => item.id === projectId) ?? null

  const materials = materialsQuery.data?.items
  const assets = materialAssets(materials)

  const tasks = tasksQuery.data?.items ?? []
  const completedTasks = tasks.filter(
    (task) => task.status === 'completed' || task.status === 'partially_completed',
  ).length
  const facts = factsQuery.data
  const evidence = evidenceQuery.data?.counts
  const plans = plansQuery.data?.items ?? []
  const plan = plans[0]
  const planTasks = plan?.task_count ?? 0
  const planFeasibility = plan?.feasibility_summary ?? {}
  const env = envQuery.data?.items[0]
  const runs = runsQuery.data?.items ?? []
  const completedRuns = runs.filter((run) => run.status === 'completed').length
  const failedRuns = runs.filter((run) => run.status === 'failed').length
  const quality = qualityQuery.data
  const verdict = verdictQuery.data
  const comparisons = comparisonsQuery.data?.items ?? []
  const reports = reportsQuery.data?.items ?? []
  const members = membersQuery.data?.items ?? []
  const audits = auditsQuery.data?.items ?? []

  const verdictVerified = verdict?.verdicts?.VERIFIED ?? 0
  const verdictInsufficient = verdict?.verdicts?.INSUFFICIENT_EVIDENCE ?? 0
  const verdictUnverifiable = verdict?.verdicts?.UNVERIFIABLE ?? 0
  const verdictTotal = verdict
    ? Object.values(verdict.verdicts ?? {}).reduce((sum, count) => sum + count, 0)
    : null

  const units: BloomUnit[] = [
    {
      id: 'materials',
      order: 0,
      ring: 0,
      angle: -45,
      seed: 1013,
      kicker: 'Evidence Source',
      title: '论文与材料',
      metric: valueOr(materials?.length, materialsQuery.isPending, materialsQuery.isError),
      metricLabel: '份材料',
      summary: materialsQuery.isError
        ? '材料列表读取失败'
        : `代码/Notebook ${assets.code} · 文档 ${assets.docs} · 抽取事实 ${facts?.total ?? '—'}`,
      status: tasksQuery.isPending ? '读取中' : `${completedTasks}/${tasks.length} 解析完成`,
      tone: tasks.length > 0 && completedTasks === tasks.length ? 'success' : 'accent',
      related: ['facts', 'evidence', 'dataset'],
      links: [
        { label: '材料管理', to: `/projects/${projectId}/materials` },
        { label: '解析概览', to: `/projects/${projectId}/overview` },
      ],
      loading: materialsQuery.isPending,
      failed: materialsQuery.isError,
    },
    {
      id: 'dataset',
      order: 1,
      ring: 0,
      angle: 45,
      seed: 2029,
      kicker: 'Data & Code',
      title: '数据集与代码',
      metric: valueOr(assets.code + assets.data, materialsQuery.isPending, materialsQuery.isError),
      metricLabel: '份资产',
      summary: `数据文件 ${assets.data} · 代码 ${assets.code} · 配置 ${assets.config}`,
      status: auditsQuery.isPending ? '读取中' : audits.length > 0 ? `${audits.length} 次审计` : '尚未审计',
      tone: audits.length > 0 ? 'success' : 'neutral',
      related: ['materials', 'facts'],
      links: [
        { label: '数据质量审计', to: `/projects/${projectId}/data-audit` },
        { label: '材料管理', to: `/projects/${projectId}/materials` },
      ],
      loading: materialsQuery.isPending,
      failed: materialsQuery.isError,
    },
    {
      id: 'facts',
      order: 2,
      ring: 0,
      angle: 135,
      seed: 3041,
      kicker: 'Extracted Facts',
      title: '科研事实',
      metric: valueOr(facts?.total, factsQuery.isPending, factsQuery.isError),
      metricLabel: '条事实',
      summary: `有证据 ${facts?.with_evidence ?? '—'} · 待复核 ${facts?.by_status.needs_review ?? '—'} · 人工修订 ${facts?.human_confirmed ?? '—'}`,
      status: facts ? `${facts.with_evidence} 条有证据` : factsQuery.isError ? '读取失败' : '读取中',
      tone: facts && facts.by_status.needs_review > 0 ? 'warning' : 'success',
      related: ['materials', 'evidence'],
      links: [
        { label: '科研事实', to: `/projects/${projectId}/facts` },
        { label: '证据图谱', to: `/projects/${projectId}/evidence-graph` },
      ],
      loading: factsQuery.isPending,
      failed: factsQuery.isError,
    },
    {
      id: 'evidence',
      order: 3,
      ring: 0,
      angle: 225,
      seed: 4057,
      kicker: 'Evidence Graph',
      title: '证据图谱',
      metric: valueOr(evidence?.evidence, evidenceQuery.isPending, evidenceQuery.isError),
      metricLabel: '条证据',
      summary: `事实节点 ${evidence?.facts ?? '—'} · 原文块 ${evidence?.source_chunks ?? '—'} · 关系边 ${evidence?.edges ?? '—'}`,
      status: evidence ? `${evidence.edges} 条关系` : evidenceQuery.isError ? '读取失败' : '读取中',
      tone: evidence && evidence.evidence > 0 ? 'success' : 'neutral',
      related: ['facts', 'materials'],
      links: [
        { label: '证据图谱', to: `/projects/${projectId}/evidence-graph` },
        { label: '科研事实', to: `/projects/${projectId}/facts` },
      ],
      loading: evidenceQuery.isPending,
      failed: evidenceQuery.isError,
    },
    {
      id: 'plan',
      order: 4,
      ring: 1,
      angle: 10,
      seed: 5077,
      kicker: 'Reproduction Plan',
      title: '复现规划',
      metric: valueOr(planTasks, plansQuery.isPending, plansQuery.isError),
      metricLabel: '个任务',
      summary: plan
        ? `${plan.title} · 可行 ${planFeasibility.feasible ?? 0} · 待人工 ${planFeasibility.needs_human_review ?? 0}`
        : '尚无复现规划',
      status: plan ? planStatus(plan.status).label : plansQuery.isError ? '读取失败' : '尚无规划',
      tone: plan ? (planStatus(plan.status).tone as BloomUnit['tone']) : 'neutral',
      related: ['runs', 'environment'],
      links: [
        ...(plan ? [{ label: '规划 DAG', to: `/reproductions/plans/${plan.plan_id}` }] : []),
        { label: '复现总览', to: `/projects/${projectId}/reproduction` },
      ],
      loading: plansQuery.isPending,
      failed: plansQuery.isError,
    },
    {
      id: 'environment',
      order: 5,
      ring: 1,
      angle: 180,
      seed: 6091,
      kicker: 'Runtime Env',
      title: '实验环境',
      metric: env?.python_version ?? (envQuery.isPending ? '…' : '—'),
      metricLabel: 'Python',
      summary: env
        ? `${frameworkLine(env.frameworks)} · 缺失 ${env.missing.length} 项`
        : '尚未检测运行环境',
      status: env
        ? env.missing.length > 0
          ? `${env.missing.length} 项缺失`
          : '声明完整'
        : envQuery.isError
          ? '读取失败'
          : '尚未检测',
      tone: env ? (env.missing.length > 0 ? 'warning' : 'success') : 'neutral',
      related: ['plan', 'runs'],
      links: [{ label: '复现环境', to: `/projects/${projectId}/reproduction/environment` }],
      loading: envQuery.isPending,
      failed: envQuery.isError,
    },
    {
      id: 'runs',
      order: 6,
      ring: 1,
      angle: 270,
      seed: 7103,
      kicker: 'Execution Runs',
      title: '复现运行',
      metric: valueOr(runs.length, runsQuery.isPending, runsQuery.isError),
      metricLabel: '次运行',
      summary: `已完成 ${completedRuns} · 失败 ${failedRuns}${runs[0]?.error_message ? ` · ${runs[0].error_message.slice(0, 46)}` : ''}`,
      status: runs.length > 0 ? runStatus(runs[0].status).label : runsQuery.isError ? '读取失败' : '尚无运行',
      tone: failedRuns > 0 ? 'danger' : completedRuns > 0 ? 'success' : 'neutral',
      related: ['plan', 'verification', 'environment'],
      links: [
        ...(runs[0]
          ? [{ label: '执行控制台', to: `/reproductions/runs/${runs[0].run_id}` }]
          : []),
        { label: '复现总览', to: `/projects/${projectId}/reproduction` },
      ],
      loading: runsQuery.isPending,
      failed: runsQuery.isError,
    },
    {
      id: 'verification',
      order: 7,
      ring: 2,
      angle: 90,
      seed: 8117,
      kicker: 'Verification',
      title: '结果验证',
      metric: score(quality?.overall, qualityQuery.isPending, qualityQuery.isError),
      metricLabel: '覆盖分',
      summary: `已验证 ${verdictVerified} · 证据不足 ${verdictInsufficient} · 无法验证 ${verdictUnverifiable} · 对照 ${comparisons.length}`,
      status: verdictTotal == null ? '读取中' : `${verdictTotal} 条结论`,
      tone:
        quality && quality.overall != null
          ? quality.overall >= 0.5
            ? 'success'
            : quality.overall >= 0.3
              ? 'warning'
              : 'danger'
          : 'neutral',
      related: ['runs', 'report'],
      links: [
        { label: '项目验证', to: `/projects/${projectId}/verification` },
        { label: 'AI 诊断', to: `/projects/${projectId}/reproduction/diagnostics` },
      ],
      loading: qualityQuery.isPending,
      failed: qualityQuery.isError,
    },
    {
      id: 'report',
      order: 8,
      ring: 2,
      angle: 220,
      seed: 9137,
      kicker: 'Audit Report',
      title: '审计报告',
      metric: valueOr(reports.length, reportsQuery.isPending, reportsQuery.isError),
      metricLabel: '份报告',
      summary: reports[0]
        ? `${reports[0].title} · ${reports[0].section_count ?? reports[0].sections?.length ?? 0} 章`
        : '尚无审计报告',
      status: reports.length > 0 ? reports[0].status : reportsQuery.isError ? '读取失败' : '尚无报告',
      tone: reports.length > 0 ? 'success' : 'neutral',
      related: ['verification', 'team'],
      links: [{ label: '审计报告', to: `/projects/${projectId}/reproduction/reports` }],
      loading: reportsQuery.isPending,
      failed: reportsQuery.isError,
    },
    {
      id: 'team',
      order: 9,
      ring: 2,
      angle: 330,
      seed: 10151,
      kicker: 'Collaboration',
      title: '协作与任务',
      metric: valueOr(members.length, membersQuery.isPending, membersQuery.isError),
      metricLabel: '位成员',
      summary: `负责人 ${members.filter((member) => member.role_key === 'project_lead').length} · 研究员 ${members.filter((member) => member.role_key === 'researcher').length} · 复核 ${members.filter((member) => member.role_key === 'reviewer').length}`,
      status: members.length > 0 ? '角色已配置' : membersQuery.isError ? '读取失败' : '读取中',
      tone: 'success',
      related: ['report'],
      links: [{ label: '项目团队', to: `/projects/${projectId}/team` }],
      loading: membersQuery.isPending,
      failed: membersQuery.isError,
    },
  ]

  const comboInsight = (aId: BloomUnitId, bId: BloomUnitId): ComboInsight => {
    const pair = new Set([aId, bId])
    const has = (x: BloomUnitId) => pair.has(x)
    if (has('materials') && has('facts')) {
      return {
        title: '材料 × 事实：证据链',
        text: `${materials?.length ?? 0} 份材料抽取了 ${facts?.total ?? 0} 条事实，其中 ${facts?.with_evidence ?? 0} 条具备逐字证据；人工修订 ${facts?.human_confirmed ?? 0} 条。`,
        tone: 'success',
      }
    }
    if (has('plan') && has('runs')) {
      return {
        title: '规划 × 运行：执行映射',
        text: `${planTasks} 个规划任务对应 ${runs.length} 次运行，${completedRuns} 次完成、${failedRuns} 次失败；执行能力 ${runs[0]?.execution_enabled ? '已启用' : '由后端策略决定'}。`,
        tone: failedRuns > 0 ? 'warning' : 'success',
      }
    }
    if (has('runs') && has('verification')) {
      return {
        title: '运行 × 验证：结果可信度',
        text: `${runs.length} 次运行产生 ${comparisons.length} 条指标对照，覆盖分 ${
          quality?.overall == null ? '—' : quality.overall.toFixed(3)
        }；已验证结论 ${verdictVerified} 条。`,
        tone: 'success',
      }
    }
    if (has('environment') && has('runs')) {
      return {
        title: '环境 × 运行：约束条件',
        text: `Python ${env?.python_version ?? '—'} · ${env ? frameworkLine(env.frameworks) : '未检测框架'}；${env?.missing.length ?? 0} 项声明缺失，${runs.length} 次运行。`,
        tone: env && env.missing.length > 0 ? 'warning' : 'success',
      }
    }
    if (has('report') && has('verification')) {
      return {
        title: '报告 × 验证：结论归档',
        text: `${reports.length} 份报告共 ${reports.reduce(
          (sum, item) => sum + (item.section_count ?? item.sections?.length ?? 0),
          0,
        )} 章；五态结论覆盖 ${verdictTotal ?? 0} 条。`,
        tone: 'success',
      }
    }
    if (has('dataset') && has('materials')) {
      return {
        title: '数据集 × 材料：资产结构',
        text: `${materials?.length ?? 0} 份材料中，数据文件 ${assets.data}、代码 ${assets.code}、配置 ${assets.config}、文档 ${assets.docs}。`,
        tone: 'neutral',
      }
    }
    const unitA = units.find((unit) => unit.id === aId)
    const unitB = units.find((unit) => unit.id === bId)
    return {
      title: `${unitA?.title ?? aId} × ${unitB?.title ?? bId}`,
      text: '两侧数据均来自后端实时接口；组合只并置证据，不改变任何业务对象或权限。',
      tone: 'neutral',
    }
  }

  const refresh = () => {
    const keys = [
      'materials',
      'parse-tasks',
      'parse-overview',
      'facts-summary',
      'evidence-graph',
      'repro-plans',
      'repro-envs',
      'repro-runs',
      'repro-quality',
      'verdict-summary',
      'repro-comparisons',
      'repro-reports',
      'project-members',
      'data-audits',
      'projects',
    ]
    keys.forEach((key) => {
      void queryClient.invalidateQueries({ queryKey: [key, projectId] })
    })
    void queryClient.invalidateQueries({ queryKey: ['projects'] })
  }

  return {
    project,
    units,
    comboInsight,
    stageReady: !projectsQuery.isPending,
    refresh,
  }
}

/** parse-overview 仅用于舞台状态条里的全局覆盖，不进入主卡片摘要。 */
export function useBloomStageFacts(projectId: string) {
  const overview = useParseOverview(projectId)
  return { overview: overview.data, loading: overview.isPending }
}
