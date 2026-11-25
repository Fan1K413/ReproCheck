/**
 * 一级主工作台 · 入口图标注册表
 *
 * 全部图标来自同一套线性图标库（lucide-react 0.454，ISC License），
 * 统一 24×24 画布、1.6 描边、圆角端点；第二轮追加了逐图标的
 * 光学位移 dx / dy（单位 = 24 画布中的 1 个单位）。
 *
 * 测量方法：把每个 SVG 放大到 96px 画到 canvas，取 alpha>26 的墨迹包围盒，
 * 得到 bbox、墨量中心与 extent；再按「统一视觉外延 20.8 + 墨量 ±3% 补偿」
 * 重算 scale。原始数据在 .screenshots/workbench-round2/icon-ink.json。
 */

import {
  Cpu,
  FileText,
  FlaskConical,
  FolderOpen,
  GitCompare,
  ListChecks,
  PackageCheck,
  ScanSearch,
  Users,
  type LucideIcon,
} from 'lucide-react'

/** 设计画布与描边：所有入口共用，不允许逐图标覆盖。 */
export const ICON_CANVAS = 24
export const ICON_STROKE = 1.6

export type EntryIconSpec = {
  icon: LucideIcon
  /**
   * 光学缩放系数。按墨迹外延归一到 20.8 单位，再按墨量做 ±3% 以内的微调：
   * 外延偏大的图形收一点，墨量偏重的图形再收一点，避免 24px 下「有的胖、有的瘦」。
   */
  scale: number
  /** 墨迹中心的水平光学位移（24 画布单位，正值向右）。 */
  dx: number
  /** 墨迹中心的垂直光学位移（24 画布单位，正值向下）。 */
  dy: number
  /** 语义依据 + 实测依据，写入交付文档。 */
  rationale: string
}

export const ENTRY_ICONS: Record<string, EntryIconSpec> = {
  audit: {
    icon: ScanSearch,
    scale: 1.03,
    dx: 0,
    dy: 0,
    rationale: '文稿 + 扫描环对应「审计」；墨迹 20×20 单位、中心正中，墨量偏轻，放大 3% 补齐',
  },
  projects: {
    icon: FolderOpen,
    scale: 0.92,
    dx: 0,
    dy: 0.5,
    rationale: '打开的档案夹对应项目档案；宽 22 单位、墨迹中心偏上 0.5 单位，右移下压后收至 0.92',
  },
  materials: {
    icon: FileText,
    scale: 0.9,
    dx: 0,
    dy: 0,
    rationale: '单页文稿对应材料解析；高 22 单位且墨量最重，收 10% 防止压过相邻图标',
  },
  repro: {
    icon: FlaskConical,
    scale: 0.97,
    dx: 0.13,
    dy: 0,
    rationale: '锥形瓶对应实验复现；宽 16.25 单位、中心偏左 0.13，轻微右移并收 3%',
  },
  rules: {
    icon: ListChecks,
    scale: 1.04,
    dx: 0,
    dy: 0,
    rationale: '清单 + 勾选对应规则校验；横向 20.5、墨量最轻，放大 4% 补齐视觉重量',
  },
  delivery: {
    icon: PackageCheck,
    scale: 0.94,
    dx: -0.5,
    dy: 0,
    rationale: '封装 + 勾选对应验证交付；墨迹中心偏右 0.5，左移回正并收 6%',
  },
  diff: {
    icon: GitCompare,
    scale: 1.02,
    dx: 0,
    dy: 0,
    rationale: '双向对比节点对应差异监控；20.5×20.5 外延偏小，放大 2%',
  },
  collab: {
    icon: Users,
    scale: 0.94,
    dx: 0,
    dy: 0,
    rationale: '双人剪影对应协作集成；宽 22 单位，收 6% 与档案夹保持同宽',
  },
  models: {
    icon: Cpu,
    scale: 0.99,
    dx: 0,
    dy: 0,
    rationale: '芯片对应模型服务；20.5×20.5、墨量偏重，轻收 1%',
  },
}

export const FALLBACK_ICON: EntryIconSpec = {
  icon: ScanSearch,
  scale: 1,
  dx: 0,
  dy: 0,
  rationale: '未注册入口的兜底图标，保证渲染永不缺失',
}

export function iconSpecFor(id: string): EntryIconSpec {
  return ENTRY_ICONS[id] ?? FALLBACK_ICON
}
