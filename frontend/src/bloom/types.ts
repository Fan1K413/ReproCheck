import type { Tone } from '../components/StatusBadge'
import type { Project } from '../types/api'

export type BloomUnitId =
  | 'materials'
  | 'dataset'
  | 'facts'
  | 'evidence'
  | 'plan'
  | 'environment'
  | 'runs'
  | 'verification'
  | 'report'
  | 'team'

export type BloomMode = 'rest' | 'open' | 'combining' | 'combined'

/** 二级形变家族：同一张卡不会都展开成同一种"档案页"。 */
export type BloomMorph = 'folio' | 'lattice' | 'instrument'

export type BloomUnit = {
  id: BloomUnitId
  order: number
  ring: 0 | 1 | 2
  angle: number
  seed: number
  kicker: string
  title: string
  metric: string
  metricLabel: string
  summary: string
  status: string
  tone: Tone
  related: BloomUnitId[]
  links: { label: string; to: string }[]
  loading: boolean
  failed: boolean
}

export type ComboInsight = {
  title: string
  text: string
  tone: Tone
}

export type WorkbenchUnitData = {
  project: Project | null
  units: BloomUnit[]
  comboInsight: (a: BloomUnitId, b: BloomUnitId) => ComboInsight
  stageReady: boolean
  refresh: () => void
}
