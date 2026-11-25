/**
 * ReproCheck 一级工作台背景 · 配色与布局配置
 *
 * 颜色全部取自 src/styles/tokens.css 的品牌紫阶，不引入新主色。
 * 这里只做 hex → 0..1 RGB 的换算与光斑（lobe）布局参数，不写渲染逻辑。
 */

export const TOKEN_HEX = {
  ink: '#08040f',
  deep: '#1e0a35',
  dark: '#3b1066',
  purple: '#7c2fd0',
  violet: '#a855f7',
  magenta: '#c084fc',
  lilac: '#e9d5ff',
} as const

export type RGB01 = [number, number, number]

/** 将 #rrggbb 换算为 WebGL 用的 0..1 三元组。 */
export function hexToRgb01(hex: string): RGB01 {
  const normalized = hex.replace('#', '')
  const value = Number.parseInt(normalized, 16)
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ]
}

export interface FieldLobeConfig {
  /** 锚点位置（UV 0..1，y 向下）。 */
  anchor: [number, number]
  /** 光斑半径，以画面长边为单位。 */
  radius: number
  /** 品牌紫阶颜色（hex）。 */
  color: string
  /** 水平漂移幅度（UV）。 */
  driftX: number
  /** 垂直漂移幅度（UV）。 */
  driftY: number
  /** 相位偏移，避免所有光斑同步呼吸。 */
  phase: number
  /** 漂移角速度（弧度/秒），数值越小越慢。 */
  speed: number
  /** 半径呼吸幅度（0..1）。 */
  breath: number
  /** 呼吸角速度（弧度/秒）。 */
  breathSpeed: number
  /** 初始权重（相对叠加强度）。 */
  weight: number
}

/**
 * 五个环境光锚点，不再承担「上色」职责：
 * 着色器只读取它们的位置、半径与权重来决定丝绸褶皱的明暗，
 * 因此允许颜色更深、更收敛，不会在画面上形成一整片紫光。
 *
 * 布局意图：
 * - 右上与左下两条大范围的冷暖差，建立斜向的空间进深；
 * - 右下与左上各一枚小范围紫光，作为远景边缘的呼吸；
 * - 中心只保留极弱的一枚淡紫，避免盘面区域被光斑顶亮。
 */
export const FIELD_LOBES: FieldLobeConfig[] = [
  {
    anchor: [0.7, 0.18],
    radius: 0.54,
    color: TOKEN_HEX.dark,
    driftX: 0.055,
    driftY: 0.042,
    phase: 0.6,
    speed: 0.11,
    breath: 0.05,
    breathSpeed: 0.06,
    weight: 0.58,
  },
  {
    anchor: [0.17, 0.64],
    radius: 0.48,
    color: TOKEN_HEX.deep,
    driftX: 0.05,
    driftY: 0.04,
    phase: 2.4,
    speed: 0.1,
    breath: 0.045,
    breathSpeed: 0.05,
    weight: 0.72,
  },
  {
    anchor: [0.88, 0.8],
    radius: 0.28,
    color: TOKEN_HEX.purple,
    driftX: 0.04,
    driftY: 0.032,
    phase: 3.9,
    speed: 0.12,
    breath: 0.05,
    breathSpeed: 0.07,
    weight: 0.18,
  },
  {
    anchor: [0.3, 0.06],
    radius: 0.3,
    color: TOKEN_HEX.dark,
    driftX: 0.04,
    driftY: 0.03,
    phase: 5.1,
    speed: 0.09,
    breath: 0.04,
    breathSpeed: 0.05,
    weight: 0.24,
  },
  {
    anchor: [0.56, 0.5],
    radius: 0.26,
    color: TOKEN_HEX.lilac,
    driftX: 0.025,
    driftY: 0.02,
    phase: 1.3,
    speed: 0.07,
    breath: 0.03,
    breathSpeed: 0.04,
    weight: 0.025,
  },
]

/** 渲染与性能预算。 */
export const FIELD_PERF = {
  /** 动画帧率上限：背景是慢节奏光影，30fps 足够且省一半能耗。 */
  fps: 30,
  /** 离屏渲染最长边像素上限：光斑本身是模糊的，放大由浏览器完成。 */
  maxPixelSide: 384,
  /** 设备像素比上限，避免高分屏过度渲染。 */
  maxDpr: 1.5,
  /** 单帧时间步长上限（秒）：后台标签页恢复时不把整段空闲时间积分进相位。 */
  maxFrameDelta: 0.05,
} as const
