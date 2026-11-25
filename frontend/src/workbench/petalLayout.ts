/**
 * 二级「空间花瓣」布局求解 —— 纯函数，不依赖 React / DOM。
 *
 * 坐标系 = 视口坐标系（px），原点左上。一级工作台是 fixed 全屏，
 * 因此花瓣的圆心与圆盘圆心严格共用 (W/2, H/2)。
 *
 * 三种模式：
 * - arc-3 / arc-4 / arc-2：单段弧，面板沿同半径等角展开；
 * - arc-6：两段 3 面板的「双瓣弧」，中央留出 1 个步长的空隙，
 *   锚点入口正好落在空隙里，避免面板压住刚点击的图标；
 * - stack：≤860px 改为盘下纵向花瓣栈，面板逐片收窄、左右错位，
 *   6 项时仍保持单向排列，不越界、不重叠。
 *
 * 所有半径都先按「面板半高 + 视口边距」求出上限，再保证不小于
 * 「盘半径 + 面板半高 + 14px」，从几何上消除越界与压盘。
 */

export type PetalMode = 'arc' | 'stack'

export type PetalPlacement = {
  index: number
  /** 面板中心角度：0° = 12 点，顺时针 */
  angle: number
  /** 面板中心坐标（px） */
  x: number
  y: number
  width: number
  height: number
  /** 从锚点向外生长的次序：0 = 最靠近锚点，用于 55ms 级联延迟 */
  bloomRank: number
  /** 入场起点：从锚点方向朝外 20px，用位移表达「先近后落位」 */
  fromX: number
  fromY: number
}

export type PetalRail = {
  /** SVG path 的 d（已带绝对坐标） */
  d: string
  /** 该段弧覆盖的角度，用于文档与调试 */
  startAngle: number
  endAngle: number
}

export type PetalGeometry = {
  mode: PetalMode
  panels: PetalPlacement[]
  rails: PetalRail[]
  centerX: number
  centerY: number
  radius: number
  stageWidth: number
  stageHeight: number
  /** stack 模式下的列数；桌面弧恒为 1 */
  columns: number
}

type Input = {
  count: number
  /** 锚点入口角度（0=12 点，顺时针） */
  anchorAngle: number
  stageWidth: number
  stageHeight: number
  /** 一级透镜直径（px），只用于保证花瓣不压住盘面 */
  discSize: number
}

const DEG = Math.PI / 180

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** 屏幕坐标：0° = 12 点，顺时针。 */
export function polarPoint(centerX: number, centerY: number, radius: number, angleDeg: number) {
  const radians = angleDeg * DEG
  return {
    x: centerX + radius * Math.sin(radians),
    y: centerY - radius * Math.cos(radians),
  }
}

/** 生成 SVG 圆弧（顺时针，角度递增）。 */
function arcPath(
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = polarPoint(centerX, centerY, radius, startAngle)
  const end = polarPoint(centerX, centerY, radius, endAngle)
  const largeArc = Math.abs(endAngle - startAngle) > 180 ? 1 : 0
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius.toFixed(2)} ${radius.toFixed(
    2,
  )} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`
}

/** 桌面单段弧的等角步长：由「面板宽 + 8px 间隙」的弦长反推，保证不重叠。 */
function arcStep(width: number, radius: number): number {
  const chord = Math.min(width + 8, radius * 1.9)
  return (2 * Math.asin(chord / (2 * radius))) / DEG
}

/** 6 项的双瓣偏移：两段各 3 片，中央留出 1.4 个步长，锚点光柱不会被面板压住。 */
const SIX_OFFSETS = [-2.8, -1.8, -0.7, 0.7, 1.8, 2.8]

/** 按「离锚点的角距离」排序，得到从中心向外的绽放次序（同级先左后右）。 */
function bloomRanks(offsets: number[]): number[] {
  const ranks = new Array<number>(offsets.length).fill(0)
  offsets
    .map((offset, index) => ({ offset, index }))
    .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.offset - b.offset)
    .forEach((item, rank) => {
      ranks[item.index] = rank
    })
  return ranks
}

function buildArc(input: Input): PetalGeometry {
  const { count, anchorAngle, stageWidth, stageHeight, discSize } = input
  const panelWidth =
    count >= 6
      ? stageWidth <= 1100
        ? 178
        : clamp(184, stageWidth * 0.143, 204)
      : count === 4
        ? 212
        : 204
  const panelHeight = count >= 6 ? 72 : 74

  // 半径 = 三个上限取最小；顶部预留 76px 避让固定工具栏，再抬到「不压住盘面」的下限。
  const byHeight = stageHeight / 2 - panelHeight / 2 - 76
  const byWidth = stageWidth / 2 - panelWidth / 2 - 40
  const radius = Math.max(
    Math.min(byHeight, byWidth, 488),
    discSize / 2 + panelHeight / 2 + 14,
  )

  const step = Math.max(
    arcStep(panelWidth, radius),
    count === 3 ? 38 : count === 2 ? 30 : 0,
  )
  const offsets =
    count === 6
      ? SIX_OFFSETS
      : Array.from({ length: count }, (_, index) => index - (count - 1) / 2)
  const ranks = bloomRanks(offsets)

  const panels: PetalPlacement[] = offsets.map((offset, index) => {
    const angle = anchorAngle + offset * step
    const radians = angle * DEG
    const point = polarPoint(stageWidth / 2, stageHeight / 2, radius, angle)
    return {
      index,
      angle: Number(angle.toFixed(3)),
      x: point.x,
      y: point.y,
      width: panelWidth,
      height: panelHeight,
      bloomRank: ranks[index],
      // 起点向圆心方向偏 20px：看起来是从锚点方向被「推」出来。
      fromX: -20 * Math.sin(radians),
      fromY: 20 * Math.cos(radians),
    }
  })

  const rails: PetalRail[] =
    count === 6
      ? [
          {
            startAngle: anchorAngle + (SIX_OFFSETS[0] - 0.5) * step,
            endAngle: anchorAngle + (SIX_OFFSETS[2] + 0.5) * step,
            d: arcPath(
              stageWidth / 2,
              stageHeight / 2,
              radius,
              anchorAngle + (SIX_OFFSETS[0] - 0.5) * step,
              anchorAngle + (SIX_OFFSETS[2] + 0.5) * step,
            ),
          },
          {
            startAngle: anchorAngle + (SIX_OFFSETS[3] - 0.5) * step,
            endAngle: anchorAngle + (SIX_OFFSETS[5] + 0.5) * step,
            d: arcPath(
              stageWidth / 2,
              stageHeight / 2,
              radius,
              anchorAngle + (SIX_OFFSETS[3] - 0.5) * step,
              anchorAngle + (SIX_OFFSETS[5] + 0.5) * step,
            ),
          },
        ]
      : [
          {
            startAngle: anchorAngle - (count / 2) * step,
            endAngle: anchorAngle + (count / 2) * step,
            d: arcPath(
              stageWidth / 2,
              stageHeight / 2,
              radius,
              anchorAngle - (count / 2) * step,
              anchorAngle + (count / 2) * step,
            ),
          },
        ]

  return {
    mode: 'arc',
    panels,
    rails,
    centerX: stageWidth / 2,
    centerY: stageHeight / 2,
    radius: Number(radius.toFixed(2)),
    stageWidth,
    stageHeight,
    columns: 1,
  }
}

/** 窄屏纵向花瓣栈：每片比上一片窄 5px、左右交替错位，形成一条向下的曲线。 */
function buildStack(input: Input): PetalGeometry {
  const { count, stageWidth, stageHeight } = input
  const gap = 8
  // 高度不足以纵向排下 6 片时改 2 列 3 行；仍不越界，也不把面板压成细条。
  const columns = stageHeight < 600 ? 2 : 1
  const rows = Math.ceil(count / columns)
  const baseWidth = Math.min(stageWidth >= 600 ? 360 : 312, stageWidth - 48)
  const panelWidth = columns === 2 ? Math.min(380, (stageWidth - 48 - gap) / 2) : baseWidth

  // 与 CSS 中 [data-fan] 的透镜缩放保持一致，避免面板压住盘面。
  const discScale = stageHeight < 620 ? 0.6 : 0.7
  const discLift = stageHeight < 620 ? 100 : stageHeight < 760 ? 140 : 150
  const lensBottom = stageHeight / 2 - discLift + (input.discSize * discScale) / 2

  // 可用高度决定面板高度：极矮屏自动压到 40px，绝不允许越过视口下沿。
  const available = Math.max(120, stageHeight - 20 - (lensBottom + 14))
  const targetHeight = columns === 2 ? 52 : stageHeight < 760 ? 48 : 56
  const panelHeight = clamp(
    Math.floor((available - (rows - 1) * gap) / rows),
    Math.min(38, targetHeight),
    targetHeight,
  )
  const stackHeight = rows * panelHeight + (rows - 1) * gap
  const startY =
    lensBottom + 14 + Math.max(0, Math.min(available - stackHeight, 80) / 2)

  const panels: PetalPlacement[] = Array.from({ length: count }, (_, index) => {
    const row = columns === 2 ? Math.floor(index / 2) : index
    const column = columns === 2 ? index % 2 : 0
    const width = columns === 2 ? panelWidth : panelWidth - Math.min(index * 5, 24)
    const x =
      columns === 2
        ? stageWidth / 2 + (column === 0 ? -1 : 1) * (panelWidth / 2 + gap / 2)
        : stageWidth / 2 + (index % 2 === 0 ? -9 : 9)
    const y = startY + panelHeight / 2 + row * (panelHeight + gap)
    return {
      index,
      angle: 180,
      x,
      y,
      width,
      height: panelHeight,
      bloomRank: index,
      fromX: 0,
      fromY: -14,
    }
  })

  // 纵向轨道：贴着栈左缘的一条极淡 S 弧，只在面板外侧走，不穿字。
  const leftEdge = stageWidth / 2 - panelWidth / 2 - 10
  const top = startY - 6
  const bottom = startY + stackHeight + 6
  const rail: PetalRail = {
    startAngle: 180,
    endAngle: 180,
    d: `M ${(leftEdge + 10).toFixed(2)} ${top.toFixed(2)} C ${(leftEdge - 22).toFixed(2)} ${(
      top +
      (bottom - top) * 0.33
    ).toFixed(2)}, ${(leftEdge + 18).toFixed(2)} ${(
      top +
      (bottom - top) * 0.66
    ).toFixed(2)}, ${(leftEdge + 6).toFixed(2)} ${bottom.toFixed(2)}`,
  }

  return {
    mode: 'stack',
    panels,
    rails: [rail],
    centerX: stageWidth / 2,
    centerY: stageHeight / 2,
    radius: 0,
    stageWidth,
    stageHeight,
    columns,
  }
}

export function buildPetalGeometry(input: Input): PetalGeometry {
  if (input.count <= 0) {
    return {
      mode: 'arc',
      panels: [],
      rails: [],
      centerX: input.stageWidth / 2,
      centerY: input.stageHeight / 2,
      radius: 0,
      stageWidth: input.stageWidth,
      stageHeight: input.stageHeight,
      columns: 1,
    }
  }
  return input.stageWidth <= 860 ? buildStack(input) : buildArc(input)
}
