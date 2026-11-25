import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ENTRIES, FEATURE_COUNT, useLaunchEntry } from './EntryLauncher'

type Props = {
  open: boolean
  onClose: () => void
  /** 当前入口排在最前，其余入口仍完整列出（共 37 条真实路由） */
  preferredEntryId?: string
}

export default function AllFeaturesPopover({ open, onClose, preferredEntryId }: Props) {
  const launch = useLaunchEntry()
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const ordered = preferredEntryId
    ? [...ENTRIES].sort((a, b) => Number(b.id === preferredEntryId) - Number(a.id === preferredEntryId))
    : ENTRIES

  return createPortal(
    <>
      <div className="rc-feature-backdrop" onClick={onClose} aria-hidden="true" />
      <section
        className="rc-feature-popover"
        role="dialog"
        aria-modal="false"
        aria-label="全部功能"
      >
        <header className="rc-feature-popover__head">
          <div>
            <p className="rc-feature-popover__eyebrow">ReproCheck / 全部功能</p>
            <h2 className="rc-feature-popover__title">全部功能</h2>
            <p className="rc-feature-popover__sub">
              共 {FEATURE_COUNT} 条真实功能路由，点击即可切换；Esc 关闭
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="rc-feature-popover__close"
            onClick={onClose}
            aria-label="关闭全部功能"
          >
            <X size={18} />
          </button>
        </header>
        <div className="rc-feature-popover__body">
          {ordered.map((entry) => (
            <section
              key={entry.id}
              className={`rc-feature-group${entry.id === preferredEntryId ? ' rc-feature-group--current' : ''}`}
            >
              <h3 className="rc-feature-group__title">
                <span className="rc-feature-group__dot" aria-hidden="true" />
                {entry.name}
                <span className="rc-feature-group__count">{entry.features.length}</span>
              </h3>
              <div className="rc-feature-group__items">
                {entry.features.map((feature) => (
                  <button
                    key={feature.route}
                    type="button"
                    className="rc-feature-item"
                    onClick={() => {
                      launch(feature)
                      onClose()
                    }}
                  >
                    <span className="rc-feature-item__label">{feature.label}</span>
                    <span className="rc-feature-item__route">{feature.route}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>
    </>,
    document.body,
  )
}
