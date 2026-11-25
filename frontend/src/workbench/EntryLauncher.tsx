import type { LucideIcon } from 'lucide-react'
import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'
import { iconSpecFor } from './entryIcons'
import { distributeAngles } from './radialLayout'

/** 二级功能：label 为浮层名称，route 使用 App.tsx 中真实的路由模板。 */
export type Feature = {
  label: string
  route: string
  hint?: string
}

/** 入口的静态定义：只有内容，没有坐标。 */
export type EntrySeed = {
  id: string
  name: string
  ariaLabel: string
  /** hover / focus / 拖动选中时内圈两行文案（均 ≤12 汉字） */
  title: string
  desc: string
  features: Feature[]
}

export type Entry = EntrySeed & {
  /**
   * 12 点方向为 0°，顺时针递增。
   * 由入口数量自动等角分配（distributeAngles），任何组件都不得手写此值。
   */
  angle: number
  /** 统一图标体系中的图形，供需要直接渲染图标的场景使用 */
  icon: LucideIcon
  /** 光学缩放系数，抵消图形墨量差 */
  iconScale: number
}

/**
 * 9 个入口的真实功能清单。顺序决定顺时针排布顺序，增删入口后角度会自动重算。
 */
const SEEDS: EntrySeed[] = [
  {
    id: 'audit',
    name: '论文核验',
    ariaLabel: '论文核验，打开审计演示',
    title: '论文核验',
    desc: '证据与诊断',
    features: [
      { label: '审计演示', route: '/demo/audit' },
      { label: 'AI 诊断', route: '/projects/:pid/reproduction/diagnostics' },
      { label: '知识检索', route: '/knowledge' },
    ],
  },
  {
    id: 'projects',
    name: '项目档案',
    ariaLabel: '项目档案，打开项目列表',
    title: '项目档案',
    desc: '管理与总览',
    features: [
      { label: '项目列表', route: '/projects' },
      { label: '新建项目', route: '/projects/new' },
      { label: '项目总览图', route: '/projects/:id/workbench' },
    ],
  },
  {
    id: 'materials',
    name: '论文与材料',
    ariaLabel: '论文与材料，打开材料管理',
    title: '论文与材料',
    desc: '上传与解析',
    features: [
      { label: '论文与材料', route: '/projects/:id/materials' },
      { label: '材料详情', route: '/materials/:materialId' },
      { label: '自动处理任务', route: '/projects/:id/tasks' },
      { label: '科研事实', route: '/projects/:id/facts' },
      { label: '证据关系图', route: '/projects/:id/evidence-graph' },
      { label: '解析概览', route: '/projects/:id/overview' },
    ],
  },
  {
    id: 'repro',
    name: '复现实验',
    ariaLabel: '复现实验，打开复现总览',
    title: '复现实验',
    desc: '规划与运行',
    features: [
      { label: '复现总览', route: '/projects/:pid/reproduction' },
      { label: '复现步骤清单', route: '/reproductions/plans/:planId' },
      { label: '实验环境', route: '/projects/:pid/reproduction/environment' },
      { label: '执行控制台', route: '/reproductions/runs/:runId' },
      { label: '结果对照', route: '/projects/:pid/reproduction/comparison' },
      { label: '审计报告', route: '/projects/:pid/reproduction/reports' },
    ],
  },
  {
    id: 'rules',
    name: '审计标准',
    ariaLabel: '审计标准，打开事实字段目录',
    title: '审计标准',
    desc: '字段与规则',
    features: [
      { label: '事实字段目录', route: '/fact-schema' },
      { label: '审计规则', route: '/rules' },
      { label: '反馈治理', route: '/feedback' },
    ],
  },
  {
    id: 'delivery',
    name: '验证交付',
    ariaLabel: '验证交付，打开项目验证',
    title: '验证交付',
    desc: '核验与交接',
    features: [
      { label: '项目验证', route: '/projects/:id/verification' },
      { label: '交接包', route: '/projects/:id/handoff' },
      { label: '基准案例库', route: '/benchmark' },
      { label: '案例详情', route: '/benchmark/:caseId' },
    ],
  },
  {
    id: 'diff',
    name: '差异审计',
    ariaLabel: '差异审计，打开实验差异分析',
    title: '差异审计',
    desc: '监控与统计',
    features: [
      { label: '实验差异', route: '/projects/:id/experiments/diff' },
      { label: '变化监控', route: '/projects/:id/change-monitor' },
      { label: '数据质量审计', route: '/projects/:id/data-audit' },
      { label: '统计审计', route: '/stats-audit' },
    ],
  },
  {
    id: 'collab',
    name: '团队连接',
    ariaLabel: '团队连接，打开组织与成员',
    title: '团队连接',
    desc: '组织与集成',
    features: [
      { label: '组织与成员', route: '/orgs' },
      { label: '角色权限', route: '/roles' },
      { label: '项目团队', route: '/projects/:id/team' },
      { label: '外部集成', route: '/integrations' },
      { label: 'API 令牌', route: '/api-tokens' },
      { label: '数据治理', route: '/governance' },
    ],
  },
  {
    id: 'models',
    name: 'AI 助手',
    ariaLabel: 'AI 助手，打开模型配置向导',
    title: 'AI 助手',
    desc: '模型与连通',
    features: [
      { label: '连接 AI 助手', route: '/settings/models' },
      { label: '系统 AI 状态', route: '/settings/llm' },
    ],
  },
]

/** 角度由入口数量推导，顺时针等角；增删入口无需改动任何坐标。 */
export const ENTRY_ANGLES = distributeAngles(SEEDS.length)

export const ENTRIES: Entry[] = SEEDS.map((seed, index) => {
  const spec = iconSpecFor(seed.id)
  return {
    ...seed,
    angle: ENTRY_ANGLES[index],
    icon: spec.icon,
    iconScale: spec.scale,
  }
})

export const FEATURE_COUNT = ENTRIES.reduce((sum, entry) => sum + entry.features.length, 0)

type Context = { projectId: string | null; lastPlanId: string | null; lastRunId: string | null }

export type RouteResolution = { path: string; notice?: string }

/** 把路由模板中的参数替换为 uiStore 的上下文；缺上下文时降级到真实存在的列表页。 */
export function resolveFeatureRoute(feature: Feature, ctx: Context): RouteResolution {
  const route = feature.route
  const reproductionHome = ctx.projectId
    ? `/projects/${ctx.projectId}/reproduction`
    : '/projects'
  const materialsHome = ctx.projectId ? `/projects/${ctx.projectId}/materials` : '/projects'

  if (route.includes(':planId')) {
    if (!ctx.lastPlanId || !ctx.projectId) {
      return { path: reproductionHome, notice: '请先从总览选择规划 / 运行' }
    }
    return { path: route.replace(':planId', ctx.lastPlanId) }
  }
  if (route.includes(':runId')) {
    if (!ctx.lastRunId || !ctx.projectId) {
      return { path: reproductionHome, notice: '请先从总览选择规划 / 运行' }
    }
    return { path: route.replace(':runId', ctx.lastRunId) }
  }
  if (route.includes(':materialId')) {
    return { path: materialsHome, notice: '请先从材料管理中选择一份材料' }
  }
  if (route.includes(':caseId')) {
    return { path: '/benchmark', notice: '请先从基准案例库中选择一个案例' }
  }
  if (route.includes(':pid') || route.includes(':id')) {
    if (!ctx.projectId) {
      return { path: '/projects', notice: '请先选择一个项目' }
    }
    return { path: route.replace(/:pid|:id/g, ctx.projectId) }
  }
  return { path: route }
}

const NOTICE_KEY = 'rc:route-notice'

export function setRouteNotice(notice?: string) {
  try {
    if (notice) window.sessionStorage.setItem(NOTICE_KEY, notice)
    else window.sessionStorage.removeItem(NOTICE_KEY)
  } catch {
    /* 隐私模式下不可用则静默降级 */
  }
}

export function consumeRouteNotice(): string | null {
  try {
    const notice = window.sessionStorage.getItem(NOTICE_KEY)
    window.sessionStorage.removeItem(NOTICE_KEY)
    return notice
  } catch {
    return null
  }
}

/** 9 入口与「全部功能」共用的唯一跳转函数；点击、拖动释放、键盘选中都走这里。 */
export function useLaunchEntry() {
  const navigate = useNavigate()
  return useCallback(
    (feature: Feature) => {
      const state = useUIStore.getState()
      const { path, notice } = resolveFeatureRoute(feature, {
        projectId: state.lastProjectId,
        lastPlanId: state.lastPlanId,
        lastRunId: state.lastRunId,
      })
      setRouteNotice(notice)
      navigate(path)
    },
    [navigate],
  )
}

/** 入口主路由：取该入口 features 的第一项。 */
export function primaryFeature(entry: Entry): Feature {
  return entry.features[0]
}
