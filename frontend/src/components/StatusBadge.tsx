import type { CSSProperties, ReactNode } from 'react'

/** 保留原有六档 Tone，不改任何调用方 API。 */
export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral' | 'navy'

const toneStyle: Record<Tone, CSSProperties> = {
  accent: { color: 'var(--rc-violet)', backgroundColor: 'var(--rc-accent-wash)' },
  success: { color: 'var(--rc-success)', backgroundColor: 'var(--rc-success-wash)' },
  danger: { color: 'var(--rc-danger)', backgroundColor: 'var(--rc-danger-wash)' },
  warning: { color: 'var(--rc-warning)', backgroundColor: 'var(--rc-warning-wash)' },
  neutral: { color: 'var(--rc-neutral)', backgroundColor: 'var(--rc-neutral-wash)' },
  navy: { color: 'var(--rc-text)', backgroundColor: 'var(--rc-surface-3)' },
}

type StatusBadgeProps = {
  tone?: Tone
  children: ReactNode
  dot?: boolean
  className?: string
}

export function StatusBadge({ tone = 'neutral', children, dot = true, className = '' }: StatusBadgeProps) {
  return (
    <span
      style={{
        border: '1px solid color-mix(in srgb, currentColor 22%, transparent)',
        ...toneStyle[tone],
      }}
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium leading-5 ${
        dot ? 'gap-1' : ''
      } ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
