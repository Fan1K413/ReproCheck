import type { LucideIcon } from 'lucide-react'

export type TabItem = { key: string; label: string; icon?: LucideIcon; count?: number }

type TabsProps = {
  tabs: TabItem[]
  active: string
  onChange: (key: string) => void
}

export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-line" role="tablist">
      {tabs.map((tab) => {
        const Icon = tab.icon
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={`relative -mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm transition-colors ${
              isActive
                ? 'border-accent font-semibold text-accent-dark'
                : 'border-transparent text-ink-muted hover:border-line hover:text-ink'
            }`}
          >
            {Icon && <Icon size={15} strokeWidth={1.9} />}
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={`mono rounded px-1.5 text-[10px] leading-4 ${
                  isActive ? 'bg-accent-wash text-accent-dark' : 'bg-canvas text-ink-subtle'
                }`}
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