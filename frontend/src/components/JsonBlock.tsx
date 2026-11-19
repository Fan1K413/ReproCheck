type JsonBlockProps = {
  value: unknown
  maxHeight?: string
  empty?: string
}

export function JsonBlock({ value, maxHeight = 'max-h-64', empty = '（空）' }: JsonBlockProps) {
  const isEmpty =
    value == null || (typeof value === 'object' && Object.keys(value as object).length === 0)
  if (isEmpty) {
    return <p className="text-xs text-ink-subtle">{empty}</p>
  }
  return (
    <pre
      className={`mono ${maxHeight} overflow-auto rounded-md border border-line bg-canvas px-3 py-2 text-[11px] leading-relaxed text-ink-muted`}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  )
}