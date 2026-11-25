import type { LucideIcon } from 'lucide-react'
import { Icon } from './Icon'

export type TabItem = { key: string; label: string; icon?: LucideIcon; count?: number }

type TabsProps = {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b"
      style={{ borderColor: 'var(--rc-border-hair)' }}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`relative -mb-px inline-flex items-center gap-2 px-3.5 py-2.5 text-sm transition-colors duration-150 ${
              isActive
                ? 'font-semibold text-[var(--rc-violet)]'
                : 'font-medium text-[var(--rc-text-muted)] hover:text-[var(--rc-text)]'
            }`}
            style={{
              borderBottom: `2px solid ${isActive ? 'var(--rc-violet)' : 'transparent'}`,
            }}
          >
            {tab.icon && <Icon as={tab.icon} size="xs" />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className="mono rounded px-1.5 text-[10px] leading-4"
                style={{
                  backgroundColor: isActive ? 'var(--rc-accent-wash)' : 'var(--rc-surface-2)',
                  color: isActive ? 'var(--rc-violet)' : 'var(--rc-text-subtle)',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
