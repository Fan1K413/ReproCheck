import { AlertCircle, RotateCw } from 'lucide-react'
import { Icon } from './Icon'

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
      <Icon as={AlertCircle} size="xl" tone="danger" />
      <p className="mt-3 text-base font-semibold" style={{ color: 'var(--rc-text)' }}>
        请求未成功
      </p>
      <p className="mt-2 max-w-md text-xs leading-relaxed" style={{ color: 'var(--rc-text-muted)' }}>
        {message}
      </p>
      {code && (
        <code
          className="mono mt-3 rounded-md px-2 py-1 text-[11px]"
          style={{ backgroundColor: 'var(--rc-surface-3)', color: 'var(--rc-text-subtle)' }}
        >
          {code}
        </code>
      )}
      {onRetry && (
        <button type="button" className="btn-ghost mt-5" onClick={onRetry}>
          <Icon as={RotateCw} size="sm" />
          重试
        </button>
      )}
    </div>
  )
}
