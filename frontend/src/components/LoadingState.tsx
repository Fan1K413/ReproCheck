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
      className={`flex items-center justify-center gap-3 ${compact ? 'py-8' : 'py-20'}`}
      style={{ color: 'var(--rc-text-muted)' }}
      role="status"
      aria-live="polite"
    >
      {/* 单色旋转：--rc-violet，800ms（交互规范 §3.1 C 类）；失败必须由页面切 ErrorState */}
      <span
        className="h-5 w-5 shrink-0 animate-spin rounded-full border-2"
        style={{
          borderColor: 'var(--rc-border-strong)',
          borderTopColor: 'var(--rc-violet)',
          animationDuration: '800ms',
          animationTimingFunction: 'var(--rc-ease-linear)',
        }}
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--rc-text)' }}>
          {message}
        </p>
        {hint && (
          <p className="mt-1 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
            {hint}
          </p>
        )}
      </div>
    </div>
  )
}
