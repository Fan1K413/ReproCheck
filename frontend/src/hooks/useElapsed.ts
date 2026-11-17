import { useEffect, useState } from 'react'

/** 在 active 为 true 期间返回真实经过的秒数；用于加载中的进度提示，不伪造阶段状态。 */
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
