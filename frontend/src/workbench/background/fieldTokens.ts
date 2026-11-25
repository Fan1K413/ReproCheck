/**
 * ReproCheck 一级工作台背景 · 双主题配色与光斑配置
 *
 * - dark（石墨金珀深色）：纯净中性石墨底 + 哑光炭丝与克制香槟金珀光折
 * - light（仿 Anthropic 类纸）：暖米色棉纸底 + 柔和沙暖/陶土淡纹
 */
import type { ThemeMode } from '../../stores/uiStore'

export const TOKEN_HEX = {
  ink: '#111113',
  deep: '#18181b',
  dark: '#222120',
  bronze: '#8a662b',
  champagne: '#d4a359',
  gold: '#e5be7e',
  soft: '#f3e3c3',
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
  anchor: [number, number]
  radius: number
  color: string
  driftX: number
  driftY: number
  phase: number
  speed: number
  breath: number
  breathSpeed: number
  weight: number
}

export interface FieldThemePalette {
  background: RGB01
  silkDeep: RGB01
  silkLight: RGB01
  ambientLow: RGB01
  ambientHigh: RGB01
  fiberColor: RGB01
  ridgeColor: RGB01
  vignetteColor: RGB01
  isLight: number
  lobeColors: RGB01[]
}

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
    color: TOKEN_HEX.bronze,
    driftX: 0.04,
    driftY: 0.032,
    phase: 3.9,
    speed: 0.12,
    breath: 0.05,
    breathSpeed: 0.07,
    weight: 0.22,
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
    weight: 0.26,
  },
  {
    anchor: [0.56, 0.5],
    radius: 0.26,
    color: TOKEN_HEX.soft,
    driftX: 0.025,
    driftY: 0.02,
    phase: 1.3,
    speed: 0.07,
    breath: 0.03,
    breathSpeed: 0.04,
    weight: 0.035,
  },
]

export const FIELD_THEMES: Record<ThemeMode, FieldThemePalette> = {
  dark: {
    background: hexToRgb01('#111113'),
    silkDeep: hexToRgb01('#18181c'),
    silkLight: hexToRgb01('#6b532c'),
    ambientLow: hexToRgb01('#0b0b0d'),
    ambientHigh: hexToRgb01('#1c1c20'),
    fiberColor: hexToRgb01('#c89c54'),
    ridgeColor: hexToRgb01('#e5be7e'),
    vignetteColor: hexToRgb01('#08080a'),
    isLight: 0.0,
    lobeColors: [
      hexToRgb01('#211f1d'),
      hexToRgb01('#16161a'),
      hexToRgb01('#8a662b'),
      hexToRgb01('#25221e'),
      hexToRgb01('#e5c792'),
    ],
  },
  light: {
    background: hexToRgb01('#f4f1ea'),
    silkDeep: hexToRgb01('#e4dccd'),
    silkLight: hexToRgb01('#d8a98d'),
    ambientLow: hexToRgb01('#ede7db'),
    ambientHigh: hexToRgb01('#fbf9f4'),
    fiberColor: hexToRgb01('#c97754'),
    ridgeColor: hexToRgb01('#ffffff'),
    vignetteColor: hexToRgb01('#e7dfd1'),
    isLight: 1.0,
    lobeColors: [
      hexToRgb01('#e3d9c8'),
      hexToRgb01('#ebe4d6'),
      hexToRgb01('#d7997a'),
      hexToRgb01('#e8dfd0'),
      hexToRgb01('#f9f7f2'),
    ],
  },
}

/** 渲染与性能预算。 */
export const FIELD_PERF = {
  fps: 30,
  maxPixelSide: 384,
  maxDpr: 1.5,
  maxFrameDelta: 0.05,
} as const
