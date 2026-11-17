import { AlertCircle, RotateCw } from 'lucide-react'

type ErrorStateProps = {
  message: string
  code?: string
  onRetry?: () => void
  compact?: boolean
}

export function ErrorState({ message, code, onRetry, compact = false }: ErrorStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${compact ? 'py-10' : 'py-16'}`}
      role="alert"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-wash text-danger">
        <AlertCircle size={22} strokeWidth={1.8} />
      </div>
      <p className="mt-3 text-sm font-semibold text-ink">请求未成功</p>
      <p className="mt-1 max-w-md text-sm text-ink-muted">{message}</p>
      {code && (
        <p className="mono mt-2 rounded bg-neutral-wash px-2 py-0.5 text-[11px] text-neutral">
          {code}
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn-ghost mt-4" onClick={onRetry}>
          <RotateCw size={15} />
          重试
        </button>
      )}
    </div>
  )
}
