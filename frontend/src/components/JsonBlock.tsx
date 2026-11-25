type JsonBlockProps = {
  value: unknown
  maxHeight?: string
  empty?: string
}

export function JsonBlock({ value, maxHeight = 'max-h-64', empty = '（空）' }: JsonBlockProps) {
  const isEmpty =
    value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)
  if (isEmpty) {
    return (
      <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
        {empty}
      </p>
    )
  }
  return (
    <pre
      className={`mono ${maxHeight} overflow-auto rounded-md border p-3 text-xs leading-relaxed`}
      style={{
        backgroundColor: 'var(--rc-surface-3)',
        borderColor: 'var(--rc-border-hair)',
        color: 'var(--rc-lilac)',
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}
