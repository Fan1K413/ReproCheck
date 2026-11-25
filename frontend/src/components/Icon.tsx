/**
 * ReproCheck 统一图标入口（global-design-system.md §2）
 *
 * 设计约束：lucide-react 唯一图标库 / 24×24 网格 / 圆端圆连接 / currentColor / 无渐变无阴影。
 * 用法：
 *   <Icon name="search" />                       // 18px / 1.75 / 继承容器颜色
 *   <Icon name="check" tone="success" state="selected" />
 *   <Icon as={FlaskConical} size="xs" />         // 直接包装任意 lucide 图标
 *   <DeviationWave className="rc-glyph-icon" />  // 差异监控专用自定义 SVG（§3.2）
 *
 * 迁移策略：旧页面可继续写 <X size={18}/>，新代码/公共组件统一走本入口；
 * 页面 Wave 再逐步替换，props API 不强制一次性对齐。
 */
import type { CSSProperties, SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BadgeX,
  BookOpen,
  Boxes,
  Check,
  ChevronDown,
  ChevronUp,
  CircleUserRound,
  ClipboardCheck,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Filter,
  FlaskConical,
  Folder,
  FolderKanban,
  GitBranch,
  Globe2,
  Grid2X2,
  Inbox,
  KeyRound,
  ListTree,
  LoaderCircle,
  LogOut,
  Maximize2,
  Menu,
  Minimize2,
  Network,
  Pause,
  PenLine,
  Play,
  Plus,
  RotateCw,
  Save,
  ScrollText,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  Upload,
  UsersRound,
  X,
} from 'lucide-react'

/** 常用图标注册表：页面 Wave 直接使用 name，无需逐页 import lucide。 */
export const ICONS = {
  alert: AlertCircle,
  arrowLeft: ArrowLeft,
  badgeCheck: BadgeCheck,
  badgeX: BadgeX,
  book: BookOpen,
  boxes: Boxes,
  check: Check,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  clipboardCheck: ClipboardCheck,
  copy: Copy,
  database: Database,
  download: Download,
  externalLink: ExternalLink,
  file: FileText,
  filter: Filter,
  flask: FlaskConical,
  folder: Folder,
  folderKanban: FolderKanban,
  gitBranch: GitBranch,
  globe: Globe2,
  grid: Grid2X2,
  inbox: Inbox,
  key: KeyRound,
  listTree: ListTree,
  loader: LoaderCircle,
  logout: LogOut,
  maximize: Maximize2,
  menu: Menu,
  minimize: Minimize2,
  network: Network,
  pause: Pause,
  pen: PenLine,
  play: Play,
  plus: Plus,
  rotate: RotateCw,
  save: Save,
  scroll: ScrollText,
  search: Search,
  settings: Settings2,
  shield: ShieldCheck,
  sparkles: Sparkles,
  terminal: SquareTerminal,
  trash: Trash2,
  triangleAlert: TriangleAlert,
  upload: Upload,
  users: UsersRound,
  user: CircleUserRound,
  x: X,
} as const satisfies Record<string, LucideIcon>

export type IconName = keyof typeof ICONS
export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | number
export type IconTone =
  | 'current'
  | 'muted'
  | 'subtle'
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'inverse'
  | 'onAccent'
export type IconState = 'default' | 'hover' | 'active' | 'selected' | 'disabled'

const SIZE: Record<Exclude<IconSize, number>, { px: number; stroke: number }> = {
  xs: { px: 16, stroke: 2 },
  sm: { px: 18, stroke: 1.75 },
  md: { px: 20, stroke: 1.75 },
  lg: { px: 24, stroke: 1.75 },
  xl: { px: 32, stroke: 1.5 },
}

const TONE: Record<IconTone, string> = {
  current: 'currentColor',
  muted: 'var(--rc-text-muted)',
  subtle: 'var(--rc-text-subtle)',
  accent: 'var(--rc-violet)',
  success: 'var(--rc-success)',
  danger: 'var(--rc-danger)',
  warning: 'var(--rc-warning)',
  info: 'var(--rc-info)',
  inverse: 'var(--rc-hi)',
  onAccent: 'var(--rc-hi)',
}

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'name' | 'width' | 'height'> & {
  /** 注册表中的图标名；与 as 二选一，as 优先 */
  name?: IconName
  /** 直接传入 lucide 图标组件（用于尚未收录的图标） */
  as?: LucideIcon
  /** xs=16 / sm=18 / md=20 / lg=24 / xl=32，或自定义 px */
  size?: IconSize
  tone?: IconTone
  state?: IconState
  /** 覆盖尺寸对应的默认线宽；仅允许 1.5 / 1.75 / 2 */
  strokeWidth?: 1.5 | 1.75 | 2
  /** 提供无障碍名称；未提供时默认 aria-hidden */
  title?: string
}

export function Icon({
  name,
  as: asProp,
  size = 'md',
  tone = 'current',
  state = 'default',
  strokeWidth,
  title,
  className = '',
  style,
  ...rest
}: IconProps) {
  const Glyph = asProp ?? (name ? ICONS[name] : undefined)
  if (!Glyph) return null

  const preset = typeof size === 'number' ? null : SIZE[size]
  const px = typeof size === 'number' ? size : preset!.px
  const width = strokeWidth ?? preset?.stroke ?? (px <= 16 ? 2 : 1.75)

  const stateStyle: CSSProperties = {}
  if (state === 'disabled') {
    stateStyle.color = TONE.subtle
    stateStyle.opacity = 0.4
  } else if (tone !== 'current') {
    stateStyle.color = TONE[tone]
  }
  if (state === 'hover' || state === 'selected') {
    stateStyle.filter = 'drop-shadow(0 0 8px rgba(168, 85, 247, .35))'
  }
  if (state === 'active') {
    stateStyle.filter = 'drop-shadow(0 0 6px rgba(168, 85, 247, .28))'
  }
  if (state === 'selected') {
    stateStyle.outline = '1px solid var(--rc-magenta)'
    stateStyle.outlineOffset = '3px'
    stateStyle.borderRadius = 'var(--rc-radius-xs)'
  }

  return (
    <Glyph
      size={px}
      strokeWidth={width}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`rc-icon ${className}`.trim()}
      style={{
        display: 'inline-block',
        flexShrink: 0,
        verticalAlign: 'middle',
        transition:
          'color var(--rc-dur-base) var(--rc-ease-hover), transform var(--rc-dur-base) var(--rc-ease-hover), filter var(--rc-dur-base) var(--rc-ease-hover)',
        ...stateStyle,
        ...style,
      }}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      {...rest}
    />
  )
}

/**
 * 差异与监控 · 偏差波形（Phase 1 §3.2）
 * 参考轨迹 / 实测轨迹两条镜像曲线 + 中心菱形偏差标记；3 条路径、stroke-only。
 * 仅用于 EntryGlyph 的 diff 分支，禁止复用为音乐/心跳语义。
 */
export function DeviationWave({
  size = 22,
  strokeWidth = 1.75,
  className = '',
  ...rest
}: SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`rc-glyph-icon ${className}`.trim()}
      {...rest}
    >
      {/* 参考轨迹 */}
      <path d="M3 8.5c3.4 0 4.8-2.6 8-2.6 3.4 0 4.6 2.6 10 2.6" />
      {/* 实测轨迹（镜像偏离） */}
      <path d="M3 15.5c3.4 0 4.8 2.6 8 2.6 3.4 0 4.6-2.6 10-2.6" />
      {/* 偏差标记：菱形 */}
      <path d="M12 10.4 13.6 12 12 13.6 10.4 12Z" />
    </svg>
  )
}

export default Icon
