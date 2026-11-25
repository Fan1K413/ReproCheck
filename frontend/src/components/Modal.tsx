import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'

type ModalProps = {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}

export function Modal({ open, title, description, onClose, children, footer, wide = false }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previouslyFocused?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="关闭弹窗"
        className="absolute inset-0"
        style={{
          backgroundColor: 'var(--rc-scrim)',
          backdropFilter: 'var(--rc-blur-scrim)',
          WebkitBackdropFilter: 'var(--rc-blur-scrim)',
        }}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`rc-modal-panel relative flex max-h-[88vh] w-full flex-col overflow-hidden ${
          wide ? 'max-w-[880px]' : 'max-w-[640px]'
        }`}
        style={{
          borderRadius: 'var(--rc-radius-lg)',
          border: 'var(--rc-stroke)',
          backgroundColor: 'var(--rc-surface)',
          boxShadow: 'var(--rc-shadow-pop)',
          color: 'var(--rc-text)',
          animation: 'rc-modal-in var(--rc-dur-base) var(--rc-ease-out) both',
        }}
      >
        <div
          className="flex shrink-0 items-start justify-between gap-4 px-6 pb-4 pt-5"
          style={{ borderBottom: 'var(--rc-stroke-hair)' }}
        >
          <div className="min-w-0">
            <h3
              className="text-xl font-semibold"
              style={{ color: 'var(--rc-text)', fontFamily: 'var(--rc-font-display)' }}
            >
              {title}
            </h3>
            {description && (
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--rc-text-muted)' }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ border: 'var(--rc-stroke)', color: 'var(--rc-text-muted)' }}
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon as={X} size="xs" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer && (
          <div
            className="flex shrink-0 justify-end gap-2 px-6 py-4"
            style={{ borderTop: 'var(--rc-stroke-hair)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
