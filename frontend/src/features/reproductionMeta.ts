import type { Tone } from '../components/StatusBadge'

/** 把后端返回值安全转成可展示文本。 */
export function safeText(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(safeText).join('、')
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** 后端文本列表字段可能是数组或分隔文本，统一成字符串数组。 */
export function safeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(safeText)
  if (typeof value === 'string' && value.trim() !== '') {
    return value
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return []
}

/* ---------------- 任务可行性 ---------------- */

const FEASIBILITY_LABEL: Record<string, string> = {
  ready: '就绪',
  missing_material: '缺少材料',
  missing_dependency: '缺少依赖',
  missing_configuration: '缺少配置',
  needs_human_review: '待人工确认',
  blocked_security: '安全阻塞',
  unverifiable: '无法验证',
}

const FEASIBILITY_TONE: Record<string, Tone> = {
  ready: 'success',
  missing_material: 'warning',
  missing_dependency: 'warning',
  missing_configuration: 'warning',
  needs_human_review: 'warning',
  blocked_security: 'danger',
  unverifiable: 'neutral',
}

/** SVG 节点配色：ready 绿 / 缺失黄 / blocked 红 / needs_human 橙 / unverifiable 灰。 */
const FEASIBILITY_COLOR: Record<string, string> = {
  ready: '#1a7f52',
  missing_material: '#c58a00',
  missing_dependency: '#c58a00',
  missing_configuration: '#c58a00',
  needs_human_review: '#d97706',
  blocked_security: '#c0392b',
  unverifiable: '#76879b',
}

export const feasibilityLabel = (value: string): string =>
  FEASIBILITY_LABEL[value] ?? value

export const feasibilityTone = (value: string): Tone =>
  FEASIBILITY_TONE[value] ?? 'neutral'

export const feasibilityColor = (value: string): string =>
  FEASIBILITY_COLOR[value] ?? '#76879b'

/* ---------------- 任务状态 ---------------- */

const TASK_STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  blocked: '已阻塞',
  confirmed: '已人工确认',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

const TASK_STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  blocked: 'danger',
  confirmed: 'accent',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
}

export const taskStatusLabel = (value: string): string =>
  TASK_STATUS_LABEL[value] ?? value

export const taskStatusTone = (value: string): Tone =>
  TASK_STATUS_TONE[value] ?? 'neutral'

/* ---------------- 规划状态 ---------------- */

const PLAN_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  completed: '已完成',
  archived: '已归档',
  blocked: '已阻塞',
}

const PLAN_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  active: 'accent',
  completed: 'success',
  archived: 'neutral',
  blocked: 'danger',
}

export const planStatusLabel = (value: string): string =>
  PLAN_STATUS_LABEL[value] ?? value

export const planStatusTone = (value: string): Tone =>
  PLAN_STATUS_TONE[value] ?? 'neutral'

/* ---------------- 运行状态 ---------------- */

const RUN_STATUS_LABEL: Record<string, string> = {
  pending: '待开始',
  queued: '排队中',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
  cancel_requested: '取消请求中',
  blocked_no_sandbox: '阻塞：无安全沙箱',
  blocked_security: '阻塞：安全拦截',
}

const RUN_STATUS_TONE: Record<string, Tone> = {
  pending: 'neutral',
  queued: 'neutral',
  running: 'accent',
  completed: 'success',
  failed: 'danger',
  cancelled: 'neutral',
  cancel_requested: 'warning',
  blocked_no_sandbox: 'danger',
  blocked_security: 'danger',
}

export const runStatusLabel = (value: string): string =>
  RUN_STATUS_LABEL[value] ?? value

export const runStatusTone = (value: string): Tone =>
  RUN_STATUS_TONE[value] ?? 'neutral'

/* ---------------- 对照判定 ---------------- */

const VERDICT_LABEL: Record<string, string> = {
  exact_match: '完全一致',
  within_tolerance: '容差内',
  significant_deviation: '显著偏差',
  insufficient_data: '数据不足',
  not_comparable: '不可比',
  needs_manual_review: '需人工复核',
}

const VERDICT_TONE: Record<string, Tone> = {
  exact_match: 'success',
  within_tolerance: 'accent',
  significant_deviation: 'danger',
  insufficient_data: 'neutral',
  not_comparable: 'neutral',
  needs_manual_review: 'warning',
}

export const verdictLabel = (value: string): string =>
  VERDICT_LABEL[value] ?? value

export const verdictTone = (value: string): Tone =>
  VERDICT_TONE[value] ?? 'neutral'

/* ---------------- 条件检查项 ---------------- */

export const CONDITION_KEYS = [
  'same_dataset',
  'same_split',
  'same_metric',
  'same_preprocessing',
  'same_hyperparams',
  'same_seed',
  'environment_diff',
] as const

const CONDITION_LABEL: Record<string, string> = {
  same_dataset: '同一数据集',
  same_split: '同一划分',
  same_metric: '同一指标定义',
  same_preprocessing: '同一预处理',
  same_hyperparams: '同一超参数',
  same_seed: '同一随机种子',
  environment_diff: '环境差异已记录',
}

export const conditionLabel = (key: string): string =>
  CONDITION_LABEL[key] ?? key

/** 优先按契约顺序展示六项条件与环境差异项，再补充后端新增项。 */
export function orderedConditionKeys(keys: string[]): string[] {
  const known = CONDITION_KEYS.filter((key) => keys.includes(key)) as string[]
  const extra = keys.filter((key) => !CONDITION_KEYS.includes(key as (typeof CONDITION_KEYS)[number]))
  return [...known, ...extra]
}

export const DECISION_LABEL: Record<string, string> = {
  approve: '批准',
  reject: '拒绝',
  modify: '修改后批准',
}
