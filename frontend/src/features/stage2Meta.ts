import type { Tone } from '../components/StatusBadge'
import type {
  AssertionType,
  ExtractionStatus,
  FactType,
  MaterialType,
  ParseStatus,
  SourceLocator,
  TaskStatus,
} from '../types/api'

export const materialTypeLabel: Record<MaterialType, string> = {
  pdf: 'PDF 文档',
  python: 'Python 代码',
  notebook: 'Jupyter 笔记本',
  zip: 'ZIP 压缩包',
  yaml: 'YAML 配置',
  json: 'JSON 配置',
  toml: 'TOML 配置',
  requirements: '依赖清单',
  readme: 'README 文档',
  text: '纯文本',
  csv: 'CSV 表格',
  xlsx: 'Excel 表格',
  unknown: '未知类型',
}

export function materialTypeTone(type: MaterialType): Tone {
  switch (type) {
    case 'pdf':
    case 'readme':
    case 'text':
      return 'accent'
    case 'python':
    case 'notebook':
    case 'requirements':
      return 'success'
    case 'yaml':
    case 'json':
    case 'toml':
      return 'warning'
    case 'csv':
    case 'xlsx':
      return 'navy'
    default:
      return 'neutral'
  }
}

export const parseStatusLabel: Record<ParseStatus, string> = {
  uploaded: '已上传',
  queued: '排队中',
  parsing: '解析中',
  extracting: '抽取中',
  completed: '已完成',
  partially_completed: '部分完成',
  failed: '失败',
  unsupported: '不支持',
}

export function parseStatusTone(status: ParseStatus): Tone {
  switch (status) {
    case 'completed':
      return 'success'
    case 'partially_completed':
      return 'warning'
    case 'failed':
    case 'unsupported':
      return 'danger'
    case 'parsing':
    case 'extracting':
      return 'accent'
    case 'queued':
    case 'uploaded':
      return 'neutral'
    default:
      return 'neutral'
  }
}

export const taskStatusLabel: Record<TaskStatus, string> = {
  uploaded: '已上传',
  queued: '排队中',
  running: '运行中',
  parsing: '解析中',
  extracting: '抽取中',
  completed: '已完成',
  partially_completed: '部分完成',
  failed: '失败',
  unsupported: '不支持',
  cancelled: '已取消',
  cancel_requested: '取消请求中',
}

export function taskStatusTone(status: TaskStatus): Tone {
  switch (status) {
    case 'completed':
      return 'success'
    case 'partially_completed':
      return 'warning'
    case 'failed':
    case 'unsupported':
      return 'danger'
    case 'cancelled':
    case 'cancel_requested':
      return 'neutral'
    case 'queued':
    case 'running':
    case 'parsing':
    case 'extracting':
    case 'uploaded':
      return 'accent'
    default:
      return 'neutral'
  }
}

/** 仅这些状态需要轮询后端，其余为终态。 */
export function isActiveTaskStatus(status: TaskStatus): boolean {
  return status === 'queued' || status === 'running' || status === 'parsing' || status === 'extracting'
}

export const assertionLabel: Record<AssertionType, string> = {
  explicit: '明确',
  inferred: '推断',
  ambiguous: '歧义',
  not_found: '未找到',
}

export function assertionTone(type: AssertionType): Tone {
  switch (type) {
    case 'explicit':
      return 'success'
    case 'inferred':
      return 'accent'
    case 'ambiguous':
      return 'warning'
    case 'not_found':
      return 'danger'
    default:
      return 'neutral'
  }
}

export const extractionLabel: Record<ExtractionStatus, string> = {
  supported: '有证据支持',
  unsupported: '无证据支持',
  needs_review: '待复核',
}

export function extractionTone(status: ExtractionStatus): Tone {
  switch (status) {
    case 'supported':
      return 'success'
    case 'needs_review':
      return 'warning'
    case 'unsupported':
      return 'danger'
    default:
      return 'neutral'
  }
}

export const factTypeLabel: Record<FactType, string> = {
  research_info: '研究信息',
  dataset: '数据集',
  model: '模型',
  training_parameter: '训练参数',
  metric: '评价指标',
  environment: '环境依赖',
  runtime: '运行方式',
  experiment_process: '实验过程',
  other: '其他',
}

/** 事实分组标签页顺序 */
export const FACT_TYPE_TABS: FactType[] = [
  'research_info',
  'dataset',
  'model',
  'training_parameter',
  'metric',
  'environment',
  'runtime',
  'experiment_process',
  'other',
]

export function verificationTone(status: string): Tone {
  switch (status) {
    case 'verified':
      return 'success'
    case 'mismatch':
    case 'unverified':
      return 'danger'
    case 'pending':
      return 'warning'
    default:
      return 'neutral'
  }
}

export const verificationLabel: Record<string, string> = {
  verified: '核对一致',
  unverified: '未核对',
  mismatch: '原文不一致',
  pending: '待核对',
}

export type LocatorKind = 'pdf' | 'code' | 'config' | 'doc' | 'data' | 'unknown'

/**
 * 依据字段判定定位类型（后端定位结构无显式 type 字段，按字段集合区分）。
 * 判定顺序很重要：PDF 与 DocLocator 都可能带 section，配置与代码都可能带 line。
 */
export function locatorKind(locator: SourceLocator | null | undefined): LocatorKind {
  if (!locator || typeof locator !== 'object') return 'unknown'
  if ('field_path' in locator) return 'config'
  if ('viewer_page_number' in locator || 'page_index' in locator) return 'pdf'
  if ('sheet_name' in locator || 'column_name' in locator || 'row_count' in locator) return 'data'
  if ('file_path' in locator) return 'code'
  if ('section' in locator || 'block_index' in locator || 'start_line' in locator || 'end_line' in locator) {
    return 'doc'
  }
  return 'unknown'
}
