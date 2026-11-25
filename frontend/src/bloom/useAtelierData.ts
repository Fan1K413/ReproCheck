import { useMemo } from 'react'
import type { BloomUnit, BloomUnitId } from './types'
import {
  isCodeMaterial,
  isDataMaterial,
  useComparisons,
  useEvidenceGraph,
  useFactsSummary,
  useProjectMaterials,
  useProjectMembers,
  useReproEnvironments,
  useReproPlans,
  useReproQuality,
  useReproReports,
  useReproRuns,
  useVerdictSummary,
} from './unitDetailParts'

export type AtelierState = 'ready' | 'attention' | 'blocked' | 'empty'

export type AtelierModule = {
  id: BloomUnitId
  unit: BloomUnit
  state: AtelierState
  score: number | null
  note: string
  blockers: string[]
  metrics: { label: string; value: string }[]
  /** 模块在工坊里承担的职责，用于节点副标题。 */
  role: string
  /** 是否能与另一个模块产生真实业务关系。 */
  relation: string
}

export type QualityBar = {
  key: string
  label: string
  score: number
  basis: string
  missing: string[]
}

type AtelierData = {
  modules: Map<BloomUnitId, AtelierModule>
  quality: {
    overall: number | null
    formula: string
    note: string
    bars: QualityBar[]
  }
  summary: {
    ready: number
    attention: number
    blocked: number
    empty: number
    failedRuns: number
    completedRuns: number
    missingEnv: string[]
    factsWithEvidence: number
    factsTotal: number
    pendingTasks: number
    reports: number
  }
  isLoading: boolean
}

const ROLE: Record<BloomUnitId, string> = {
  materials: '论文、代码与配置的入口',
  dataset: '数据契约与字段口径',
  facts: '可复述的论文事实',
  evidence: '事实与原文位置',
  plan: '复现任务的依赖顺序',
  environment: '运行时与依赖锁',
  runs: '实验执行与失败证据',
  verification: '指标对照与结论',
  report: '可签署的审计报告',
  team: '角色与人工确认',
}

const RELATION: Record<BloomUnitId, string> = {
  materials: '抽取',
  dataset: '供数',
  facts: '落证',
  evidence: '支撑',
  plan: '编排',
  environment: '约束',
  runs: '执行',
  verification: '比对',
  report: '归档',
  team: '签认',
}

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return Math.max(0, Math.min(1, numerator / denominator))
}

/** 后端实际会返回 `parsed`，前端联合类型未收录，统一在此归一化。 */
function isParsedStatus(status: string): boolean {
  return status === 'completed' || status === 'partially_completed' || status === 'parsed'
}

export function useAtelierData(projectId: string, units: BloomUnit[]): AtelierData {
  const materialsQuery = useProjectMaterials(projectId)
  const factsQuery = useFactsSummary(projectId)
  const evidenceQuery = useEvidenceGraph(projectId)
  const plansQuery = useReproPlans(projectId)
  const envsQuery = useReproEnvironments(projectId)
  const runsQuery = useReproRuns(projectId)
  const comparisonsQuery = useComparisons(projectId)
  const reportsQuery = useReproReports(projectId)
  const qualityQuery = useReproQuality(projectId)
  const membersQuery = useProjectMembers(projectId)
  const verdictQuery = useVerdictSummary(projectId)

  const loading =
    materialsQuery.isPending ||
    factsQuery.isPending ||
    plansQuery.isPending ||
    envsQuery.isPending ||
    runsQuery.isPending ||
    qualityQuery.isPending

  return useMemo<AtelierData>(() => {
    const materials = materialsQuery.data?.items ?? []
    const parsed = materials.filter((material) => isParsedStatus(material.parse_status))
    const failedMaterials = materials.filter(
      (material) => material.parse_status === 'failed' || material.parse_status === 'unsupported',
    )
    const codeMaterials = materials.filter((material) => isCodeMaterial(material.material_type))
    const dataMaterials = materials.filter((material) => isDataMaterial(material.material_type))

    const facts = factsQuery.data
    const evidence = evidenceQuery.data
    const plans = plansQuery.data?.items ?? []
    const envs = envsQuery.data?.items ?? []
    const runs = runsQuery.data?.items ?? []
    const comparisons = comparisonsQuery.data?.items ?? []
    const reports = reportsQuery.data?.items ?? []
    const members = membersQuery.data?.items ?? []
    const quality = qualityQuery.data
    const verdicts = verdictQuery.data?.verdicts ?? {}

    const firstPlan = plans[0]
    const planReview = Number(firstPlan?.feasibility_summary?.needs_human_review ?? 0)
    const planBlocked = Number(firstPlan?.feasibility_summary?.blocked ?? 0)
    const firstEnv = envs[0]
    const failedRuns = runs.filter((run) => run.status === 'failed').length
    const completedRuns = runs.filter((run) => run.status === 'completed').length
    const comparable = comparisons.filter(
      (comparison) => comparison.verdict !== 'insufficient_data' && comparison.verdict !== 'not_comparable',
    ).length
    const reportFinals = reports.filter((report) => report.status === 'final').length

    const materialScore = percent(parsed.length, materials.length)
    const assetMaterials = materials.filter(
      (material) => isDataMaterial(material.material_type) || isCodeMaterial(material.material_type),
    )
    const parsedAssets = assetMaterials.filter((material) => isParsedStatus(material.parse_status))
    const dataScore = percent(parsedAssets.length, assetMaterials.length)
    const factScore = percent(facts?.with_evidence ?? 0, facts?.total ?? 0)
    const evidenceScore = percent(evidence?.counts.edges ?? 0, evidence?.counts.facts ?? 0)
    const environmentScore = firstEnv
      ? Math.max(0.18, 1 - firstEnv.missing.length * 0.14)
      : null
    const runScore = percent(completedRuns, runs.length)
    const verificationScore = percent(comparable, comparisons.length)
    const reportScore = reports.length ? (reportFinals ? 1 : 0.55) : null
    const teamScore = percent(members.length, 3)

    const unitById = new Map(units.map((unit) => [unit.id, unit]))
    const fallback = (id: BloomUnitId): BloomUnit =>
      unitById.get(id) ?? {
        id,
        order: 0,
        ring: 0,
        angle: 0,
        seed: id.length * 17,
        kicker: id,
        title: id,
        metric: '—',
        metricLabel: '',
        summary: '',
        status: '加载中',
        tone: 'neutral',
        related: [],
        links: [],
        loading: true,
        failed: false,
      }

    const module = (
      id: BloomUnitId,
      score: number | null,
      state: AtelierState,
      note: string,
      blockers: string[],
      metrics: { label: string; value: string }[],
    ): AtelierModule => {
      const unit = fallback(id)
      return {
        id,
        unit,
        state: !unit.failed ? state : 'blocked',
        score,
        note,
        blockers,
        metrics,
        role: ROLE[id],
        relation: RELATION[id],
      }
    }

    const modules = new Map<BloomUnitId, AtelierModule>([
      [
        'materials',
        module(
          'materials',
          materialScore,
          materials.length === 0
            ? 'empty'
            : failedMaterials.length
              ? 'attention'
              : materialScore === 1
                ? 'ready'
                : 'attention',
          `${parsed.length}/${materials.length} 份材料已解析，${codeMaterials.length} 份代码可执行材料`,
          failedMaterials.map((material) => `${material.filename} 解析失败`),
          [
            { label: '材料', value: String(materials.length) },
            { label: '代码', value: String(codeMaterials.length) },
          ],
        ),
      ],
      [
        'dataset',
        module(
          'dataset',
          dataScore,
          assetMaterials.length === 0 ? 'empty' : dataScore === 1 && dataMaterials.length > 0 ? 'ready' : 'attention',
          assetMaterials.length
            ? `${dataMaterials.length} 份数据 · ${codeMaterials.length} 份代码资产，口径来自真实材料`
            : '尚未上传数据或代码材料',
          dataMaterials.length ? [] : ['缺少数据材料'],
          [{ label: '资产', value: String(assetMaterials.length) }],
        ),
      ],
      [
        'facts',
        module(
          'facts',
          factScore,
          !facts?.total ? 'empty' : factScore === 1 ? 'ready' : 'attention',
          `${facts?.total ?? 0} 条事实中 ${facts?.with_evidence ?? 0} 条有证据定位`,
          (facts?.total ?? 0) - (facts?.with_evidence ?? 0) > 0
            ? [`${(facts?.total ?? 0) - (facts?.with_evidence ?? 0)} 条事实缺证据`]
            : [],
          [{ label: '事实', value: String(facts?.total ?? 0) }],
        ),
      ],
      [
        'evidence',
        module(
          'evidence',
          evidenceScore,
          !evidence?.counts.facts ? 'empty' : evidenceScore === 1 ? 'ready' : 'attention',
          `${evidence?.counts.facts ?? 0} 条事实 · ${evidence?.counts.evidence ?? 0} 条证据 · ${evidence?.counts.edges ?? 0} 条边`,
          evidence?.counts.facts && !evidence.counts.evidence ? ['事实尚未落到证据'] : [],
          [{ label: '图谱边', value: String(evidence?.counts.edges ?? 0) }],
        ),
      ],
      [
        'plan',
        module(
          'plan',
          firstPlan ? Math.max(0.2, percent(firstPlan.task_count - planReview - planBlocked, firstPlan.task_count) ?? 0) : null,
          !firstPlan ? 'empty' : planBlocked ? 'blocked' : planReview ? 'attention' : 'ready',
          firstPlan
            ? `${firstPlan.title} · ${firstPlan.task_count} 个任务，${planReview} 个待人工复核`
            : '尚未生成复现规划',
          planBlocked ? [`${planBlocked} 个任务被阻塞`] : planReview ? [`${planReview} 个任务待人工确认`] : [],
          [{ label: '任务', value: String(firstPlan?.task_count ?? 0) }],
        ),
      ],
      [
        'environment',
        module(
          'environment',
          environmentScore,
          !firstEnv ? 'empty' : firstEnv.missing.length ? 'attention' : 'ready',
          firstEnv
            ? `${firstEnv.python_version ?? 'Python 未声明'} · ${firstEnv.entrypoints.length} 个入口 · ${firstEnv.missing.length} 项缺失`
            : '尚未登记实验环境',
          firstEnv?.missing ?? ['缺少环境定义'],
          [{ label: '入口', value: String(firstEnv?.entrypoints.length ?? 0) }],
        ),
      ],
      [
        'runs',
        module(
          'runs',
          runScore,
          !runs.length ? 'empty' : failedRuns && !completedRuns ? 'blocked' : failedRuns ? 'attention' : 'ready',
          runs.length
            ? `${completedRuns} 次完成 · ${failedRuns} 次失败 · 最近运行 ${runs[0]?.status ?? '未知'}`
            : '尚未执行复现运行',
          failedRuns ? [`${failedRuns} 次失败运行待诊断`] : [],
          [{ label: '完成', value: `${completedRuns}/${runs.length}` }],
        ),
      ],
      [
        'verification',
        module(
          'verification',
          verificationScore,
          !comparisons.length ? 'empty' : comparable ? 'ready' : 'attention',
          `${comparable}/${comparisons.length} 项指标可对照，${Object.entries(verdicts)
            .filter(([, count]) => count > 0)
            .map(([key, count]) => `${key} ${count}`)
            .join(' · ')}`,
          comparisons.length && !comparable ? ['指标不可直接对比'] : [],
          [{ label: '可对照', value: `${comparable}/${comparisons.length}` }],
        ),
      ],
      [
        'report',
        module(
          'report',
          reportScore,
          !reports.length ? 'empty' : reportFinals ? 'ready' : 'attention',
          `${reports.length} 份报告，${reportFinals} 份已定稿`,
          reports.length && !reportFinals ? ['报告尚未定稿'] : [],
          [{ label: '定稿', value: String(reportFinals) }],
        ),
      ],
      [
        'team',
        module(
          'team',
          teamScore,
          !members.length ? 'empty' : members.length >= 2 ? 'ready' : 'attention',
          `${members.length} 位项目成员参与签认`,
          members.length < 2 ? ['缺少独立复核角色'] : [],
          [{ label: '成员', value: String(members.length) }],
        ),
      ],
    ])

    // 单元自身的摘要如果加载失败，则不要把底图数据伪装成健康状态。
    for (const item of modules.values()) {
      if (item.unit.failed && item.state === 'ready') item.state = 'blocked'
    }

    const counts = Array.from(modules.values()).reduce(
      (acc, item) => {
        acc[item.state] += 1
        return acc
      },
      { ready: 0, attention: 0, blocked: 0, empty: 0 } as Record<AtelierState, number>,
    )

    return {
      modules,
      quality: {
        overall: quality?.overall ?? null,
        formula: quality?.formula ?? '',
        note: quality?.scope_note ?? '评分不是学术质量判定，只反映当前项目的证据与可执行条件。',
        bars: (quality?.dimensions ?? []).map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          score: dimension.max ? dimension.score / dimension.max : dimension.score,
          basis: dimension.basis,
          missing: dimension.missing,
        })),
      },
      summary: {
        ...counts,
        failedRuns,
        completedRuns,
        missingEnv: firstEnv?.missing ?? [],
        factsWithEvidence: facts?.with_evidence ?? 0,
        factsTotal: facts?.total ?? 0,
        pendingTasks: planReview + planBlocked,
        reports: reports.length,
      },
      isLoading: loading,
    }
  }, [
    comparisonsQuery.data,
    envsQuery.data,
    evidenceQuery.data,
    factsQuery.data,
    loading,
    materialsQuery.data,
    membersQuery.data,
    plansQuery.data,
    qualityQuery.data,
    reportsQuery.data,
    runsQuery.data,
    units,
    verdictQuery.data,
  ])
}
