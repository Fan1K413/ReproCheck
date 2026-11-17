type LoadingStateProps = {
  message?: string
  hint?: string
  compact?: boolean
}

export function LoadingState({
  message = '正在加载…',
  hint,
  compact = false,
}: LoadingStateProps) {
  return (
    <div
      className={`flex items-center justify-center gap-3 text-ink-muted ${compact ? 'py-8' : 'py-20'}`}
      role="status"
      aria-live="polite"
    >
      <span className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-line border-t-accent" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{message}</p>
        {hint && <p className="mt-0.5 text-xs text-ink-subtle">{hint}</p>}
      </div>
    </div>
  )
}
