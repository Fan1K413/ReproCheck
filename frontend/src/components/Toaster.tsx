import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type ToastTone } from '../stores/toastStore'

const toneStyle: Record<ToastTone, { ring: string; icon: typeof Info; iconClass: string }> = {
  success: { ring: 'border-success/30', icon: CheckCircle2, iconClass: 'text-success' },
  error: { ring: 'border-danger/30', icon: AlertCircle, iconClass: 'text-danger' },
  info: { ring: 'border-accent/30', icon: Info, iconClass: 'text-accent-dark' },
}

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((t) => {
        const style = toneStyle[t.tone]
        const Icon = style.icon
        return (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto flex items-start gap-2.5 rounded-md border ${style.ring} bg-surface px-3.5 py-3 shadow-pop`}
          >
            <Icon size={16} className={`mt-0.5 shrink-0 ${style.iconClass}`} />
            <p className="min-w-0 flex-1 text-[13px] leading-snug text-ink">{t.message}</p>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-ink-subtle hover:text-ink"
              onClick={() => dismiss(t.id)}
              aria-label="关闭提示"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}