import { Inbox } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Icon } from './Icon'

type EmptyStateProps = {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({
  title,
  description,
  icon = Inbox,
  action,
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10' : 'py-16'}`}>
      <Icon as={icon} size="xl" tone="muted" />
      <p className="mt-4 text-base font-semibold" style={{ color: 'var(--rc-text)' }}>
        {title}
      </p>
      {description && (
        <p className="mt-2 max-w-sm text-xs leading-relaxed" style={{ color: 'var(--rc-text-muted)' }}>
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
