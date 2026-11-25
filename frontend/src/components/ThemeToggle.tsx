import { BookOpenText, Monitor, Terminal } from 'lucide-react'
import { useUIStore, type ThemePreference } from '../stores/uiStore'

type ThemeToggleProps = {
  compact?: boolean
  className?: string
}

const META: Record<
  ThemePreference,
  { label: string; nextLabel: string; icon: typeof Monitor }
> = {
  system: { label: '跟随系统', nextLabel: '类纸浅色', icon: Monitor },
  light: { label: '类纸浅色', nextLabel: '黑绿深色', icon: BookOpenText },
  dark: { label: '黑绿深色', nextLabel: '跟随系统', icon: Terminal },
}

/**
 * 全局外观模式三态循环切换：
 * 跟随系统（默认）→ 类纸浅色 → 黑绿深色 → 跟随系统
 */
export function ThemeToggle({ compact = false, className = '' }: ThemeToggleProps) {
  const preference = useUIStore((state) => state.themePreference)
  const resolvedTheme = useUIStore((state) => state.theme)
  const toggleTheme = useUIStore((state) => state.toggleTheme)

  const current = META[preference]
  const Glyph = current.icon
  const resolvedName = resolvedTheme === 'light' ? '类纸浅色' : '黑绿深色'
  const title =
    preference === 'system'
      ? `当前：跟随系统（${resolvedName}），点击切换到${current.nextLabel}`
      : `当前：${current.label}，点击切换到${current.nextLabel}`

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`rc-theme-toggle ${compact ? 'rc-theme-toggle--compact' : ''} ${className}`.trim()}
      aria-label={`当前外观：${current.label}，点击切换到${current.nextLabel}`}
      title={title}
    >
      <span className="rc-theme-toggle__swatch" aria-hidden="true" />
      <Glyph size={14} aria-hidden="true" />
      <span className={compact ? 'hidden sm:inline' : ''}>{current.label}</span>
    </button>
  )
}

export default ThemeToggle
