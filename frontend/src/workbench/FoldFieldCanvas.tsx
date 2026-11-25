import { useEffect, useRef } from 'react'

/**
 * @deprecated 已被 src/workbench/background/ReproFieldBackground.tsx 取代。
 * 本文件仅作为旧版放射褶皱背景的留档，工作台不再引用；新背景改造请勿复用本组件。
 *
 * 紫黑立体褶皱背景（V3 性能版）。
 *
 * 视觉上是 18 条带圆头端帽的充气褶皱从右下消失点向左上方展开；实现上把慢速“流动”
 * 从每帧 Canvas 重绘改为一次低分辨率离屏绘制 + CSS transform 环境漂移。
 * - Canvas 只按 0.55 渲染比例绘制一次，CSS 放大负责柔和质感；
 * - 不引入图片、截图或视频；
 * - prefers-reduced-motion 下取消 CSS 漂移；
 * - 连续动画只动 transform，不让 JS 每帧抢占主线程。
 */

type Point = { x: number; y: number }
type Ribbon = {
  angle: number
  phase: number
  phase2: number
  phase3: number
  tone: number
  scale: number
  swirl: number
  start: number
  shade: number
}

const RIBBON_COUNT = 18
const SAMPLES = 44
const RENDER_SCALE = 0.55
const GRADIENT_STOPS: Array<[number, string]> = [
  [0, '#4C1179'],
  [0.06, '#7A2AC6'],
  [0.18, '#B86BF5'],
  [0.3, '#D8B4FE'],
  [0.43, '#F2E5FF'],
  [0.56, '#E2C8FF'],
  [0.7, '#C084FC'],
  [0.83, '#8A34D0'],
  [0.93, '#5E158F'],
  [1, '#390A5D'],
]

const RIBBONS: Ribbon[] = Array.from({ length: RIBBON_COUNT }, (_, i) => ({
  angle: 158 + (i * 134) / (RIBBON_COUNT - 1) + (((i * 13) % 7) - 3) * 0.55,
  phase: i * 0.78 + (i % 2) * 2.0,
  phase2: i * 1.37 + (i % 3) * 0.8,
  phase3: i * 0.41,
  tone: i % 5 === 0 ? 0.92 : 1,
  scale: 0.8 + ((i * 7) % 9) * 0.043,
  swirl: (((i * 17) % 13) - 6) * 0.55,
  start: 0.62 + ((i * 13) % 5) * 0.065,
  shade: i % 4 === 0 ? 0.34 : i % 4 === 1 ? 0.15 : 0,
}))

/** 单一路径：上长边 → 外侧半圆帽 → 下长边 → 内侧半圆帽。 */
function tracePetal(
  ctx: CanvasRenderingContext2D,
  centers: Point[],
  upper: Point[],
  lower: Point[],
) {
  const n = centers.length - 1

  const capArc = (center: Point, from: Point, direction: Point) => {
    const radius = Math.hypot(from.x - center.x, from.y - center.y)
    const ux = (from.x - center.x) / radius
    const uy = (from.y - center.y) / radius
    const vlen = Math.hypot(direction.x, direction.y) || 1
    const vx = direction.x / vlen
    const vy = direction.y / vlen
    const steps = 8
    for (let k = 1; k <= steps; k += 1) {
      const theta = (Math.PI * k) / steps
      ctx.lineTo(
        center.x + ux * radius * Math.cos(theta) + vx * radius * Math.sin(theta),
        center.y + uy * radius * Math.cos(theta) + vy * radius * Math.sin(theta),
      )
    }
  }

  ctx.beginPath()
  ctx.moveTo(upper[n].x, upper[n].y)
  for (let i = n - 1; i >= 0; i -= 1) ctx.lineTo(upper[i].x, upper[i].y)

  capArc(
    centers[0],
    upper[0],
    { x: centers[0].x - centers[1].x, y: centers[0].y - centers[1].y },
  )

  for (let i = 1; i <= n; i += 1) ctx.lineTo(lower[i].x, lower[i].y)

  capArc(
    centers[n],
    lower[n],
    { x: centers[n].x - centers[n - 1].x, y: centers[n].y - centers[n - 1].y },
  )

  ctx.closePath()
}

function fillPetal(
  ctx: CanvasRenderingContext2D,
  centers: Point[],
  upper: Point[],
  lower: Point[],
  alpha: number,
  shade: number,
) {
  const mid = Math.floor(centers.length / 2)
  const midCenter = centers[mid]
  const midUpper = upper[mid]
  const midLower = lower[mid]
  const nx = midUpper.x - midLower.x
  const ny = midUpper.y - midLower.y
  const normalLen = Math.hypot(nx, ny) || 1
  const nnx = nx / normalLen
  const nny = ny / normalLen

  let maxProj = Number.NEGATIVE_INFINITY
  let minProj = Number.POSITIVE_INFINITY
  for (const p of [...upper, ...lower]) {
    const proj = (p.x - midCenter.x) * nnx + (p.y - midCenter.y) * nny
    if (proj > maxProj) maxProj = proj
    if (proj < minProj) minProj = proj
  }

  const gx0 = midCenter.x + nnx * maxProj
  const gy0 = midCenter.y + nny * maxProj
  const gx1 = midCenter.x + nnx * minProj
  const gy1 = midCenter.y + nny * minProj

  const body = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
  for (const [offset, color] of GRADIENT_STOPS) body.addColorStop(offset, color)

  tracePetal(ctx, centers, upper, lower)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = 'rgba(124,47,207,.9)'
  ctx.fill()
  ctx.fillStyle = body
  ctx.globalAlpha = alpha * 0.92
  ctx.fill()
  ctx.restore()

  if (shade > 0) {
    ctx.save()
    ctx.globalAlpha = shade
    ctx.fillStyle = 'rgba(30, 3, 48, 0.9)'
    ctx.fill()
    ctx.restore()
  }

  const shine = ctx.createLinearGradient(gx0, gy0, gx1, gy1)
  shine.addColorStop(0, 'rgba(255,255,255,0)')
  shine.addColorStop(0.18, 'rgba(255,255,255,0.06)')
  shine.addColorStop(0.34, 'rgba(255,255,255,0.3)')
  shine.addColorStop(0.48, 'rgba(255,255,255,0.1)')
  shine.addColorStop(0.68, 'rgba(255,255,255,0)')
  shine.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.save()
  ctx.globalCompositeOperation = 'screen'
  ctx.globalAlpha = alpha * 0.65
  ctx.fillStyle = shine
  ctx.fill()
  ctx.restore()

  // 参考图的褶皱不是扁平色带：亮侧只有一条薄边，另一侧沉进紫黑沟槽。
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.globalAlpha = alpha * 0.66
  ctx.strokeStyle = 'rgba(241,222,255,.72)'
  ctx.lineWidth = 1.15
  ctx.beginPath()
  ctx.moveTo(upper[0].x, upper[0].y)
  for (let i = 1; i < upper.length; i += 1) ctx.lineTo(upper[i].x, upper[i].y)
  ctx.stroke()
  ctx.globalAlpha = alpha * 0.74
  ctx.strokeStyle = 'rgba(22,3,39,.9)'
  ctx.lineWidth = 2.1
  ctx.beginPath()
  ctx.moveTo(lower[0].x, lower[0].y)
  for (let i = 1; i < lower.length; i += 1) ctx.lineTo(lower[i].x, lower[i].y)
  ctx.stroke()
  ctx.restore()
}

export default function FoldFieldCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    let width = 1
    let height = 1
    let dpr = 1
    let disposed = false

    const draw = () => {
      if (disposed) return
      const vpX = width * 0.985
      const vpY = height * 1.025
      const diagonal = Math.hypot(width, height)
      const minSide = Math.min(width, height)

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#08040F'
      ctx.fillRect(0, 0, width, height)

      const baseGlow = ctx.createRadialGradient(
        width * 0.46,
        height * 0.42,
        0,
        width * 0.46,
        height * 0.42,
        diagonal * 0.58,
      )
      baseGlow.addColorStop(0, 'rgba(124,47,207,.18)')
      baseGlow.addColorStop(0.34, 'rgba(76,29,130,.1)')
      baseGlow.addColorStop(0.72, 'rgba(28,11,50,.04)')
      baseGlow.addColorStop(1, 'rgba(8,4,15,0)')
      ctx.fillStyle = baseGlow
      ctx.fillRect(0, 0, width, height)

      for (const layer of [0, 1] as const) {
        for (const ribbon of RIBBONS) {
        const baseAngle = (ribbon.angle + (layer === 0 ? 3.9 : 0)) * (Math.PI / 180)
        const phase = ribbon.phase
        const dx = Math.cos(baseAngle)
        const dy = Math.sin(baseAngle)
        const boundaries = [
          dx < 0 ? -vpX / dx : dx > 0 ? (width - vpX) / dx : Number.POSITIVE_INFINITY,
          dy < 0 ? -vpY / dy : dy > 0 ? (height - vpY) / dy : Number.POSITIVE_INFINITY,
        ].filter((distance) => Number.isFinite(distance) && distance > 0)
        const rayLength = Math.min(...boundaries)
        const r0 = Math.max(2, minSide * 0.004)
        const reach = Math.min(1.18, ribbon.start + 0.12 + (ribbon.scale - 0.8) * 0.5)
        const r1 = rayLength * reach * (layer === 0 ? 1.08 : 1)
        const centers: Point[] = []
        const upper: Point[] = []
        const lower: Point[] = []

        for (let j = 0; j <= SAMPLES; j += 1) {
          const t = j / SAMPLES
          const angle = baseAngle + ribbon.swirl * Math.pow(t, 1.15) * (Math.PI / 180)
          const r = r0 + (r1 - r0) * t
          const envelope = Math.sin(Math.PI * t) * (0.35 + 0.65 * t)
          const wave =
            Math.sin(t * 3.9 + phase) +
            0.32 * Math.sin(t * 7.2 + ribbon.phase2) +
            0.18 * Math.sin(t * 2.1 + ribbon.phase3)
          const lateral = 0.018 * minSide * envelope * wave
          centers.push({
            x: vpX + Math.cos(angle) * r - Math.sin(angle) * lateral,
            y: vpY + Math.sin(angle) * r + Math.cos(angle) * lateral,
          })
        }

        for (let j = 0; j <= SAMPLES; j += 1) {
          const t = j / SAMPLES
          const prev = centers[Math.max(0, j - 1)]
          const next = centers[Math.min(SAMPLES, j + 1)]
          const tx = next.x - prev.x
          const ty = next.y - prev.y
          const tangent = Math.hypot(tx, ty) || 1
          const nx = -ty / tangent
          const ny = tx / tangent
          const taper = 0.84 + 0.16 * Math.sin(t * 3.1 + phase * 0.55)
          const widthScale = (0.78 + (ribbon.scale - 0.8) * 0.72) * (layer === 0 ? 0.38 : 1)
          const halfWidth = minSide * (0.005 + 0.122 * Math.pow(t, 0.78)) * widthScale * taper
          upper.push({ x: centers[j].x + nx * halfWidth, y: centers[j].y + ny * halfWidth })
          lower.push({ x: centers[j].x - nx * halfWidth, y: centers[j].y - ny * halfWidth })
        }

        fillPetal(
          ctx,
          centers,
          upper,
          lower,
          ribbon.tone * (layer === 0 ? 0.66 : 1),
          layer === 0 ? Math.max(0.3, ribbon.shade) : ribbon.shade,
        )
        }
      }

      const discSheen = ctx.createRadialGradient(
        width * 0.5,
        height * 0.48,
        minSide * 0.08,
        width * 0.5,
        height * 0.48,
        minSide * 0.4,
      )
      discSheen.addColorStop(0, 'rgba(233,213,255,.14)')
      discSheen.addColorStop(0.46, 'rgba(168,85,247,.08)')
      discSheen.addColorStop(1, 'rgba(8,4,15,0)')
      ctx.fillStyle = discSheen
      ctx.fillRect(0, 0, width, height)

      const vignette = ctx.createRadialGradient(
        width * 0.5,
        height * 0.48,
        diagonal * 0.3,
        width * 0.5,
        height * 0.48,
        diagonal * 0.86,
      )
      vignette.addColorStop(0, 'rgba(8,4,15,0)')
      vignette.addColorStop(1, 'rgba(8,4,15,.48)')
      ctx.fillStyle = vignette
      ctx.fillRect(0, 0, width, height)
    }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      dpr = Math.min(window.devicePixelRatio || 1, 1.5) * RENDER_SCALE
      canvas.width = Math.max(1, Math.round(width * dpr))
      canvas.height = Math.max(1, Math.round(height * dpr))
      draw()
    }

    const syncMotion = () => {
      canvas.classList.toggle('rc-foldfield--ambient', !motionQuery.matches)
    }

    resize()
    syncMotion()
    window.addEventListener('resize', resize)
    motionQuery.addEventListener('change', syncMotion)

    return () => {
      disposed = true
      canvas.classList.remove('rc-foldfield--ambient')
      window.removeEventListener('resize', resize)
      motionQuery.removeEventListener('change', syncMotion)
    }
  }, [])

  return <canvas ref={canvasRef} className="rc-foldfield" aria-hidden="true" />
}
