/**
 * 一级主工作台 · 统一圆形几何系统
 *
 * 唯一坐标原点 = 圆盘几何中心。所有入口位置都由「数量 + 起始角 + 轨道比例」推导，
 * 不允许在任何组件里为单个入口写死 left / top / 角度 / 半径。
 *
 * 角度约定：0° = 12 点方向，顺时针递增（与键盘方向键、拖动方向一致）。
 */

import type { CSSProperties } from 'react'

/** 轨道比例：全部相对圆盘直径，任何断点下同比例缩放，圆盘不会被压成椭圆。 */
export const ORBIT = {
  /**
   * 入口图标轨道半径 / 圆盘半径。
   * 第二轮把入口从 0.657 外推到 0.78：图标离开中央信息区，
   * 落在透镜靠外的亮部，盘面中部留给品牌与标题。
   */
  entry: 0.78,
  /** 中央透镜直径 / 圆盘直径；0.34 让中心不再是第二张大圆盘。 */
  core: 0.34,
  /** 最外侧的极淡空间轨道（仅视觉，不承载交互） */
  guide: 0.94,
} as const

/** 轨道同心环尺寸（相对圆盘直径的百分比）。 */
export const RING_PERCENT = {
  entry: ORBIT.entry * 100,
  guide: ORBIT.guide * 100,
} as const

export type RadialSlot = {
  index: number
  /** 0 = 12 点，顺时针 */
  angle: number
  /** 单位向量（屏幕坐标，y 向下为正） */
  ux: number
  uy: number
  /** 相对圆盘容器的百分比坐标（用于 left / top） */
  left: number
  top: number
}

/** 按入口数量等角分配：n 个入口 → 相邻夹角 360/n，不留人工差值。 */
export function distributeAngles(count: number, startAngle = 0): number[] {
  if (count <= 0) return []
  const step = 360 / count
  return Array.from({ length: count }, (_, index) => {
    const angle = (startAngle + index * step) % 360
    // 消除浮点尾差，保证 0° 起点严格为 0
    return Math.abs(angle) < 1e-9 ? 0 : angle
  })
}

export function buildSlots(
  count: number,
  radiusRatio: number = ORBIT.entry,
  startAngle = 0,
): RadialSlot[] {
  return distributeAngles(count, startAngle).map((angle, index) => {
    const radians = (angle * Math.PI) / 180
    const ux = Math.sin(radians)
    const uy = -Math.cos(radians)
    // 半径比例 × 50% = 相对圆盘容器的百分比偏移
    return {
      index,
      angle,
      ux,
      uy,
      left: 50 + ux * radiusRatio * 50,
      top: 50 + uy * radiusRatio * 50,
    }
  })
}

/**
 * 单个入口的定位样式：只写百分比坐标 + 沿径向的单位向量。
 * `--rc-out-x / --rc-out-y` 供 CSS 在 hover / 拖动时做「沿轨道法线抬起」，
 * 不参与布局计算，因此不会造成 layout。
 */
export function slotStyle(slot: RadialSlot): CSSProperties {
  return {
    left: `${slot.left}%`,
    top: `${slot.top}%`,
    '--rc-out-x': String(Number(slot.ux.toFixed(4))),
    '--rc-out-y': String(Number(slot.uy.toFixed(4))),
  } as CSSProperties
}

/** 拖动方向 → 最近入口。夹角按环形最短距离计算，跨 0°/360° 不会选错。 */
export function nearestIndex(thetaDeg: number, count: number, startAngle = 0): number {
  const angles = distributeAngles(count, startAngle)
  let nearest = 0
  let nearestGap = Number.POSITIVE_INFINITY
  angles.forEach((angle, index) => {
    const gap = Math.abs(((thetaDeg - angle + 540) % 360) - 180)
    if (gap < nearestGap) {
      nearestGap = gap
      nearest = index
    }
  })
  return nearest
}

/** 屏幕坐标 (x, y) → 以 12 点为 0° 的顺时针角度。 */
export function angleFromVector(dx: number, dy: number): number {
  return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360
}
