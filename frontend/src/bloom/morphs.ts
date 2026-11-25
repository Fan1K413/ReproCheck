import type { BloomMorph, BloomUnitId } from './types'

type MorphMeta = {
  label: string
  cn: string
  hint: string
  duration: number
}

export const UNIT_MORPH: Record<BloomUnitId, BloomMorph> = {
  materials: 'folio',
  facts: 'folio',
  report: 'folio',
  dataset: 'instrument',
  environment: 'instrument',
  runs: 'instrument',
  verification: 'instrument',
  evidence: 'lattice',
  plan: 'lattice',
  team: 'lattice',
}

export const MORPH_META: Record<BloomMorph, MorphMeta> = {
  folio: {
    label: 'FOLIO',
    cn: '折页',
    hint: '纸页沿折痕摊开，左侧书脊保留装订线',
    duration: 760,
  },
  lattice: {
    label: 'LATTICE',
    cn: '格架',
    hint: '节点从中心向外点亮，边界落成一组切角晶格',
    duration: 700,
  },
  instrument: {
    label: 'INSTRUMENT',
    cn: '仪器',
    hint: '控制台自下而上抬起，顶部仪表条先行就位',
    duration: 620,
  },
}

export function morphOf(id: BloomUnitId): BloomMorph {
  return UNIT_MORPH[id]
}
