/**
 * Bloom UI 几何内核：花瓣 / 档案页轮廓与轨道布局。
 *
 * 所有轮廓都用同一组 48 个归一化控制点（0–100%）表达，
 * 因此 clip-path 的 polygon 可以在任意两个状态之间平滑插值，
 * 卡片形状的变化是真实的结构形变，而不是 scale 缩放。
 */

export type Pt = { x: number; y: number }
export type Ring = 0 | 1 | 2
export type StageBox = { w: number; h: number }
import type { BloomMorph } from './types'

export type CardSpec = {
  id: string
  order: number
  ring: Ring
  angle: number
  seed: number
}

export type Placement = {
  x: number
  y: number
  w: number
  h: number
  rotate: number
  scale: number
  opacity: number
  z: number
}

export type PanelBox = { x: number; y: number; w: number; h: number }

export const CONTOUR_POINTS = 48
export const REST_W = 172
export const REST_H = 126
export const MOBILE_CARD_H = 104
export const MOBILE_TOP = 32

const TAU = Math.PI * 2

/** 确定性伪随机：同一个 seed 在任何设备上生成同一片瓣。 */
function lcg(seed: number): () => number {
  let s = (seed || 1) >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function wrapAngle(value: number): number {
  let angle = value
  while (angle > Math.PI) angle -= TAU
  while (angle < -Math.PI) angle += TAU
  return angle
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * 收拢态的基础母形：接近有厚度的标本板，而不是把内容挤到尖端的椭圆。
 * 六个低频谐波只用于让边缘略微"长出来"；椭圆指数保证四角有足够面积承载标题与指标。
 */
export function petalPolygon(
  seed: number,
  count = CONTOUR_POINTS,
  spread = 1,
): Pt[] {
  const rand = lcg(seed)
  const a1 = (0.006 + rand() * 0.006) * spread
  const p1 = rand() * TAU
  const a2 = (0.003 + rand() * 0.004) * spread
  const p2 = rand() * TAU
  const stretch = 1 + (rand() - 0.5) * 0.05
  const points: Pt[] = []
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * TAU
    const base = superellipseRadius(theta, 5.4)
    const radius = base * (1 + a1 * Math.cos(2 * theta + p1) + a2 * Math.cos(5 * theta + p2))
    const rx = 47 * radius * stretch
    const ry = 47 * radius
    points.push({
      x: 50 + rx * Math.cos(theta),
      y: 50 + ry * Math.sin(theta),
    })
  }
  return points
}

/**
 * 展开态的"档案页"：超椭圆（圆角矩形感的非矩形）+ 一处缺口 + 一处斜切。
 * 缺口与斜切的位置由 seed 决定，保证每张工作区轮廓不完全相同。
 */
export function archivePolygon(
  seed: number,
  count = CONTOUR_POINTS,
): Pt[] {
  const rand = lcg(seed + 977)
  const notchTheta = (0.3 + rand() * 0.4) * TAU
  const slashTheta = notchTheta + Math.PI * (0.55 + rand() * 0.35)
  const notchDepth = 0.035 + rand() * 0.025
  const notchWidth = 0.14 + rand() * 0.08
  const slashDepth = 0.015 + rand() * 0.015
  const exponent = 8.5 + rand() * 2.5
  const points: Pt[] = []
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * TAU
    const cos = Math.abs(Math.cos(theta))
    const sin = Math.abs(Math.sin(theta))
    const superRadius = Math.pow(
      Math.pow(cos, exponent) + Math.pow(sin, exponent),
      -1 / exponent,
    )
    const notch =
      1 -
      notchDepth *
        Math.exp(-Math.pow(wrapAngle(theta - notchTheta), 2) / (2 * notchWidth * notchWidth))
    const slash =
      1 -
      slashDepth *
        Math.exp(
          -Math.pow(wrapAngle(theta - slashTheta), 2) / (2 * 0.055 * 0.055),
        )
    const radius = superRadius * notch * slash
    points.push({
      x: 50 + 46 * radius * Math.cos(theta),
      y: 50 + 46 * radius * Math.sin(theta),
    })
  }
  return points
}

/** CSS polygon 字符串；保留两位小数，减少 inline style 体积。 */
export function polygonCss(points: Pt[]): string {
  return `polygon(${points
    .map((point) => `${round(point.x)}% ${round(point.y)}%`)
    .join(', ')})`
}

/**
 * 二级形变的三种"母形"。三者都用 48 点采样，保证收拢 ↔ 展开时
 * clip-path 可以真实插值，而不是换一个静态图片。
 */
function superellipseRadius(theta: number, exponent: number): number {
  const cos = Math.abs(Math.cos(theta))
  const sin = Math.abs(Math.sin(theta))
  return Math.pow(Math.pow(cos, exponent) + Math.pow(sin, exponent), -1 / exponent)
}

/** 格架卡：低指数超椭圆 + 六向微切面，像一个有棱的晶格。 */
export function facetPolygon(seed: number, count = CONTOUR_POINTS, spread = 1): Pt[] {
  const rand = lcg(seed + 313)
  const phase = rand() * TAU
  const stretch = 1 + (rand() - 0.5) * 0.08
  const points: Pt[] = []
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * TAU
    const base = superellipseRadius(theta, 2.9)
    const facet = (0.006 + rand() * 0.004) * spread * Math.cos(6 * theta + phase)
    const radius = base + facet
    points.push({
      x: 50 + 46 * radius * stretch * Math.cos(theta),
      y: 50 + 46 * radius * Math.sin(theta),
    })
  }
  return points
}

/** 仪器卡：更接近胶囊的超椭圆，长轴略向右侧生长。 */
export function capsulePolygon(seed: number, count = CONTOUR_POINTS, spread = 1): Pt[] {
  const rand = lcg(seed + 727)
  const stretch = 1.035 + rand() * 0.045
  const phase = rand() * TAU
  const points: Pt[] = []
  for (let i = 0; i < count; i += 1) {
    const theta = (i / count) * TAU
    const base = superellipseRadius(theta, 3.8)
    const breathe = 0.006 * spread * Math.cos(4 * theta + phase)
    const radius = base + breathe
    points.push({
      x: 50 + 46 * radius * stretch * Math.cos(theta),
      y: 50 + 46 * radius * Math.sin(theta),
    })
  }
  return points
}

/** 一级入口的形态家族：折页 / 格架 / 仪器。 */
export function restPolygonFor(morph: BloomMorph, seed: number, spread = 1): Pt[] {
  if (morph === 'lattice') return facetPolygon(seed, CONTOUR_POINTS, spread)
  if (morph === 'instrument') return capsulePolygon(seed, CONTOUR_POINTS, spread)
  return petalPolygon(seed, CONTOUR_POINTS, spread)
}

/** 二级展开的三种母形：折页档案 / 晶格台面 / 仪器长台。 */
export function panelPolygonFor(morph: BloomMorph, seed: number): Pt[] {
  const rand = lcg(seed + 1409)
  const exponent =
    morph === 'folio' ? 6.5 + rand() * 0.8 : morph === 'lattice' ? 8.4 + rand() * 1 : 11 + rand() * 1.2
  const notchTheta =
    morph === 'folio'
      ? Math.PI * (0.88 + rand() * 0.08)
      : morph === 'instrument'
        ? Math.PI * (0.3 + rand() * 0.12)
        : Math.PI * (0.18 + rand() * 0.08)
  const notchDepth = morph === 'lattice' ? 0.07 : 0.055 + rand() * 0.015
  const notchWidth = morph === 'lattice' ? 0.045 : 0.085
  const slashTheta = morph === 'folio' ? Math.PI * 0.16 : morph === 'instrument' ? Math.PI * 1.96 : Math.PI * 1.36
  const slashDepth = morph === 'lattice' ? 0.035 : 0.045
  const points: Pt[] = []
  for (let i = 0; i < CONTOUR_POINTS; i += 1) {
    const theta = (i / CONTOUR_POINTS) * TAU
    const cos = Math.cos(theta)
    const sin = Math.sin(theta)
    // 标准超椭圆参数化：指数越高，四边越平、圆角越小，内容不会被弧线切掉。
    const rx = 47 * Math.sign(cos) * Math.pow(Math.abs(cos), 2 / exponent)
    const ry = 47 * Math.sign(sin) * Math.pow(Math.abs(sin), 2 / exponent)
    const notch =
      1 -
      notchDepth *
        Math.exp(-Math.pow(wrapAngle(theta - notchTheta), 2) / (2 * notchWidth * notchWidth))
    const slash =
      1 -
      slashDepth *
        Math.exp(-Math.pow(wrapAngle(theta - slashTheta), 2) / (2 * 0.035 * 0.035))
    const radius = notch * slash
    points.push({
      x: 50 + rx * radius * (morph === 'instrument' ? 1.005 : 1),
      y: 50 + ry * radius,
    })
  }
  return points
}

/** 供入场动画使用：从中心闭合的小瓣展开到完整瓣形。 */
export function closedPolygonFor(morph: BloomMorph, seed: number): Pt[] {
  const points = restPolygonFor(morph, seed, 0.2)
  return points.map((point) => ({
    x: 50 + (point.x - 50) * 0.18,
    y: 50 + (point.y - 50) * 0.18,
  }))
}

/** 默认倾角：-7° ~ +9°，由 seed 固定。 */
export function cardTilt(spec: CardSpec): number {
  const rand = lcg(spec.seed + 41)
  return -7 + rand() * 16
}

/** 中心核半径，桌面 112px，移动端 88px。 */
export function coreRadius(stage: StageBox, mobile: boolean): number {
  return mobile ? 82 : Math.min(118, stage.w * 0.085, stage.h * 0.16)
}

/** 桌面轨道半径的基准值：同时受宽度与高度约束，保证卡片不越界。 */
export function orbitBaseRadius(stage: StageBox): number {
  const byWidth = stage.w / 2 - (REST_W / 2 + 34)
  const byHeight = (stage.h / 2 - (REST_H / 2 + 42)) * 1.55
  return Math.max(190, Math.min(byWidth, byHeight))
}

export function restPlacement(
  stage: StageBox,
  spec: CardSpec,
  mobile: boolean,
  mobileCount: number,
): Placement {
  if (mobile) {
    const w = Math.min(560, stage.w - 28)
    const h = MOBILE_CARD_H
    const step = h + 10
    const total = mobileCount * step
    const start = MOBILE_TOP + Math.max(0, (stage.h - MOBILE_TOP - 64 - total) / 2)
    return {
      x: stage.w / 2,
      y: start + spec.order * step + h / 2,
      w,
      h,
      rotate: 0,
      scale: 1,
      opacity: 1,
      z: 10 + spec.order,
    }
  }
  const base = orbitBaseRadius(stage)
  const radii = [0.61, 0.89, 1.17]
  const radius = radii[spec.ring] * base
  const theta = (spec.angle * Math.PI) / 180
  const x = stage.w / 2 + radius * Math.cos(theta)
  const y = stage.h / 2 + radius * 0.6 * Math.sin(theta)
  const halfW = REST_W / 2 + 10
  const topH = REST_H / 2 + 10
  const bottomH = REST_H / 2 + 54
  return {
    x: Math.min(stage.w - halfW, Math.max(halfW, x)),
    y: Math.min(stage.h - bottomH, Math.max(topH, y)),
    w: REST_W,
    h: REST_H,
    rotate: cardTilt(spec),
    scale: spec.ring === 0 ? 1 : spec.ring === 1 ? 0.96 : 0.92,
    opacity: 1,
    z: spec.ring === 0 ? 16 : spec.ring === 1 ? 13 : 11 + spec.order,
  }
}

/** 展开工作区矩形：三种 morph 使用不同的台面比例，不再共用一张"大档案页"。 */
export function panelBox(stage: StageBox, morph: BloomMorph): PanelBox {
  const horizontalRoom = stage.w < 900 ? 24 : 155
  const verticalRoom = stage.w < 900 ? 96 : 150
  const specs: Record<BloomMorph, { w: number; h: number }> = {
    folio: { w: 1120, h: 650 },
    lattice: { w: 1060, h: 660 },
    instrument: { w: 1180, h: 610 },
  }
  const spec = specs[morph]
  const w = Math.min(spec.w, stage.w - horizontalRoom)
  const h = Math.min(spec.h, stage.h - verticalRoom)
  return {
    x: (stage.w - w) / 2,
    y: (stage.h - h) / 2 + (morph === 'instrument' ? 10 : -6),
    w,
    h,
  }
}

function distribute(count: number, stage: StageBox, cardH: number): number[] {
  if (count <= 0) return []
  const top = 86 + cardH / 2
  const bottom = stage.h - 58 - cardH / 2
  if (count === 1) return [(top + bottom) / 2]
  const span = Math.max(1, bottom - top)
  const step = Math.min(cardH + 16, span / (count - 1))
  const block = step * (count - 1)
  const start = (stage.h - block) / 2
  return Array.from({ length: count }, (_, index) => start + index * step)
}

/**
 * 展开 / 组合时的完整布局。
 * 主卡占据中心工作区；其余卡片被推成左右两列；
 * 与主卡有真实数据关系的卡片留在工作区下方，保持高亮并用连线相连。
 */
export function bloomPlacements(params: {
  stage: StageBox
  cards: CardSpec[]
  activeIds: string[]
  relatedIds: string[]
  panel: PanelBox
  wide: boolean
  combined: boolean
  mobile: boolean
}): Map<string, Placement> {
  const { stage, cards, activeIds, relatedIds, panel, wide, combined, mobile } = params
  const result = new Map<string, Placement>()
  const restMap = new Map<string, Placement>()

  const activeSet = new Set(activeIds)
  const relatedSet = new Set(relatedIds.filter((id) => !activeSet.has(id)))

  for (const spec of cards) {
    restMap.set(spec.id, restPlacement(stage, spec, false, cards.length))
  }

  if (mobile) {
    for (const spec of cards) {
      const base = restPlacement(stage, spec, true, cards.length)
      if (activeSet.has(spec.id)) {
        if (combined) {
          result.set(spec.id, { ...base, opacity: 0, scale: 0.9, z: 8 })
        } else {
          result.set(spec.id, {
            x: panel.x + panel.w / 2,
            y: panel.y + panel.h / 2,
            w: panel.w,
            h: panel.h,
            rotate: 0,
            scale: 1,
            opacity: 1,
            z: 50,
          })
        }
      } else {
        result.set(spec.id, { ...base, opacity: 0, scale: 0.94, z: 8 })
      }
    }
    return result
  }

  const compactScale = wide ? 0.64 : 0.68
  const compactW = REST_W * compactScale
  const compactH = REST_H * compactScale

  for (const spec of cards) {
    if (activeSet.has(spec.id)) {
      if (combined) {
        const index = activeIds.indexOf(spec.id)
        result.set(spec.id, {
          x: panel.x + panel.w * (index === 0 ? 0.22 : 0.78),
          y: panel.y + panel.h * 0.46,
          w: REST_W,
          h: REST_H,
          rotate: index === 0 ? -8 : 8,
          scale: 0.86,
          opacity: 0.35,
          z: 30,
        })
      } else if (activeIds.length > 1) {
        // 组合准备阶段：两片瓣向工作区中线靠拢，准备铰接。
        const index = activeIds.indexOf(spec.id)
        result.set(spec.id, {
          x: panel.x + panel.w * (index === 0 ? 0.24 : 0.76),
          y: panel.y + panel.h * 0.48,
          w: REST_W,
          h: REST_H,
          rotate: index === 0 ? -7 : 7,
          scale: 0.9,
          opacity: 0.9,
          z: 40,
        })
      } else {
        result.set(spec.id, {
          x: panel.x + panel.w / 2,
          y: panel.y + panel.h / 2,
          w: panel.w,
          h: panel.h,
          rotate: 0,
          scale: 1,
          opacity: 1,
          z: 42,
        })
      }
    }
  }

  if (combined || activeIds.length > 1) {
    // 组合态：工作区几乎占满舞台，其余卡片退到幕后保留轮廓，不做无意义堆叠。
    for (const spec of cards) {
      if (activeSet.has(spec.id)) continue
      const rest = restMap.get(spec.id)
      if (rest) result.set(spec.id, { ...rest, scale: 0.9, opacity: 0, z: 6 })
    }
    return result
  }

  const sideCards = cards.filter((spec) => !activeSet.has(spec.id) && !relatedSet.has(spec.id))
  const left = sideCards.filter((_, index) => index % 2 === 0)
  const right = sideCards.filter((_, index) => index % 2 === 1)
  const ysLeft = distribute(left.length, stage, compactH)
  const ysRight = distribute(right.length, stage, compactH)

  left.forEach((spec, index) => {
    result.set(spec.id, {
      x: 20 + compactW / 2,
      y: ysLeft[index],
      w: compactW,
      h: compactH,
      rotate: -6 + ((spec.seed % 5) * 1.6),
      scale: 1,
      opacity: 0.4,
      z: 16 + index,
    })
  })
  right.forEach((spec, index) => {
    result.set(spec.id, {
      x: stage.w - 20 - compactW / 2,
      y: ysRight[index],
      w: compactW,
      h: compactH,
      rotate: 5 - ((spec.seed % 5) * 1.5),
      scale: 1,
      opacity: 0.4,
      z: 16 + index,
    })
  })

  const related = cards.filter((spec) => relatedSet.has(spec.id))
  const bottomRoom = stage.h - (panel.y + panel.h)
  const placeBelow = bottomRoom >= compactH + 34
  const rowY = placeBelow
    ? Math.min(stage.h - 22 - compactH / 2, panel.y + panel.h + 16 + compactH / 2)
    : Math.max(22 + compactH / 2, panel.y - 16 - compactH / 2)
  related.forEach((spec, index) => {
    result.set(spec.id, {
      x: panel.x + (panel.w * (index + 1)) / (related.length + 1),
      y: rowY,
      w: compactW,
      h: compactH,
      rotate: (index - (related.length - 1) / 2) * 3,
      scale: 1,
      opacity: 0.92,
      z: 32 + index,
    })
  })

  return result
}

/** 从矩形面板中心朝目标点方向求边界的交点，用于绘制真实关系连线。 */
export function panelEdgePoint(panel: PanelBox, toward: Pt): Pt {
  const cx = panel.x + panel.w / 2
  const cy = panel.y + panel.h / 2
  const dx = toward.x - cx
  const dy = toward.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : (panel.w / 2) / Math.abs(dx)
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : (panel.h / 2) / Math.abs(dy)
  const t = Math.min(tx, ty)
  return { x: cx + dx * t, y: cy + dy * t }
}

/** 二次贝塞尔控制点：让连线像被拉开的纤维，而不是直线。 */
export function linkControlPoint(from: Pt, to: Pt, bend = 44): Pt {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.hypot(dx, dy) || 1
  return {
    x: mx - (dy / length) * bend,
    y: my + (dx / length) * bend,
  }
}

/** 移动端舞台高度：由卡片数量决定，可自然滚动。 */
export function mobileStageHeight(count: number): number {
  return MOBILE_TOP + count * (MOBILE_CARD_H + 10) + 72
}
