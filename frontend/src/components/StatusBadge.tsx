import type { ReactNode } from 'react'

export type Tone = 'accent' | 'success' | 'danger' | 'warning' | 'neutral' | 'navy'

const toneClass: Record<Tone, string> = {
  accent: 'bg-accent-wash text-accent-dark',
  success: 'bg-success-wash text-success',
  danger: 'bg-danger-wash text-danger',
  warning: 'bg-warning-wash text-warning',
  neutral: 'bg-neutral-wash text-neutral',
  navy: 'bg-navy-100 text-navy-800',
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
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium leading-5 ${toneClass[tone]} ${className}`}
    >
      {dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
      {children}
    </span>
  )
}
