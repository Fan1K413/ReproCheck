/**
 * Bloom UI 运动语言。
 * 不引入第三方动画库：统一由 CSS transition 驱动，
 * 视差与拖动由 rAF 合并，保证动画期间不产生布局抖动。
 */

export const EASE_BLOOM = 'cubic-bezier(0.16, 1, 0.3, 1)'
export const EASE_CLOSE = 'cubic-bezier(0.7, 0, 0.84, 0)'
export const DURATION_BLOOM = 680
export const DURATION_CLOSE = 520
export const STAGGER_CARD = 70
export const STAGGER_CONTENT = 90

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** 把频繁的 pointermove 合并到每帧一次，避免 React 重渲染。 */
export function onFrame(callback: () => void): () => void {
  let frame = 0
  const run = () => {
    frame = 0
    callback()
  }
  const schedule = () => {
    if (frame === 0) frame = window.requestAnimationFrame(run)
  }
  schedule()
  return () => {
    if (frame !== 0) window.cancelAnimationFrame(frame)
  }
}

/** 入场延迟：越靠外的轨道越晚出现，形成逐层绽放。 */
export function entranceDelay(order: number): number {
  return 90 + order * STAGGER_CARD
}
