import { useEffect, useState } from 'react'

/** active 为 true 时返回经过秒数。 */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!active) {
      setElapsed(0)
      return
    }
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      setElapsed((Date.now() - startedAt) / 1000)
    }, 100)
    return () => window.clearInterval(timer)
  }, [active])

  return elapsed
}
