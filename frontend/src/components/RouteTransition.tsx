import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useLocation, useNavigationType, type Location } from 'react-router-dom'
import { LoadingState } from './LoadingState'

type TransitionContextValue = {
  /** 当前展示中的路由（concurrent transition 期间保持旧页，避免 Suspense 白屏） */
  displayLocation: Location
  /** 正在并发拉取目标路由分片 */
  isPending: boolean
  /** 最近一次导航方向 */
  direction: 'push' | 'pop' | 'replace'
}

export const RouteTransitionContext = createContext<TransitionContextValue | null>(null)

export function useRouteTransition() {
  return useContext(RouteTransitionContext)
}

/**
 * 顶部 2px 路由光扫进度条：
 * - 并发切页 pending 时持续流动；
 * - 页面切换完成时优雅扫过收尾。
 */
export function RouteProgressBar({ loading = false }: { loading?: boolean }) {
  const ctx = useRouteTransition()
  const location = useLocation()
  const activeKey = ctx?.displayLocation.pathname ?? location.pathname
  const isFetching = loading || Boolean(ctx?.isPending)
  const [phase, setPhase] = useState<'idle' | 'run' | 'done'>(isFetching ? 'run' : 'idle')
  const firstRender = useRef(true)

  useEffect(() => {
    if (isFetching) {
      setPhase('run')
      return
    }
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setPhase('run')
    const finishTimer = window.setTimeout(() => setPhase('done'), 220)
    const clearTimer = window.setTimeout(() => setPhase('idle'), 480)
    return () => {
      window.clearTimeout(finishTimer)
      window.clearTimeout(clearTimer)
    }
  }, [activeKey, isFetching])

  if (phase === 'idle') return null

  return (
    <div
      className={`rc-route-progress rc-route-progress--${phase}${isFetching ? ' is-loading' : ''}`}
      aria-hidden="true"
    />
  )
}

/**
 * 真正的单页应用双层同步转场舞台：
 * 1. 切页前将旧页面的实时 DOM 克隆进只读残影层（不触发任何 React 副作用或重请求）；
 * 2. 新页面提交瞬间，旧页残影沿反方向平滑滑出淡出，新页同时滑入落位——零白屏、零空帧、无刷新感；
 * 3. `<Suspense>` 内置于本舞台，绝不卸载外层常驻导航与顶栏。
 */
export function RouteStage({
  scrollContainerRef,
  children,
}: {
  scrollContainerRef?: React.RefObject<HTMLElement | null>
  children: ReactNode
}) {
  const ctx = useRouteTransition()
  const routerLocation = useLocation()
  const navType = useNavigationType()

  const activePathname = ctx?.displayLocation.pathname ?? routerLocation.pathname
  const dir = ctx?.direction ?? (navType === 'POP' ? 'pop' : navType === 'REPLACE' ? 'replace' : 'push')

  const activeRef = useRef<HTMLDivElement>(null)
  const ghostHostRef = useRef<HTMLDivElement>(null)
  const pendingGhostRef = useRef<{ node: HTMLElement; scrollTop: number } | null>(null)
  const prevPathnameRef = useRef<string>(activePathname)
  const ghostTimerRef = useRef<number | null>(null)

  // 在目标路由发起切换（realLocation 改变、尚未提交）前捕获当前页面的实时视觉快照
  useEffect(() => {
    const captureGhost = () => {
      pendingGhostRef.current = null
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
      const activeEl = activeRef.current
      if (!activeEl || !activeEl.firstElementChild) return
      const scroller = scrollContainerRef?.current
      const scrollTop = scroller ? scroller.scrollTop : window.scrollY
      const clone = activeEl.cloneNode(true) as HTMLElement
      // 移除克隆体内的 id 与交互属性，避免无障碍或表单冲突
      clone.removeAttribute('id')
      clone.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'))
      clone.querySelectorAll('iframe, audio, video, object, embed').forEach((el) => el.remove())
      pendingGhostRef.current = { node: clone, scrollTop }
    }

    window.addEventListener('rc:capture-route-ghost', captureGhost)
    return () => window.removeEventListener('rc:capture-route-ghost', captureGhost)
  }, [scrollContainerRef])

  // 当新页面 pathname 实际提交到 DOM 时，同步播放「旧页滑出 + 新页滑入」双层交叉动画
  useLayoutEffect(() => {
    if (prevPathnameRef.current === activePathname) return
    prevPathnameRef.current = activePathname

    const scroller = scrollContainerRef?.current
    if (dir !== 'pop') {
      if (scroller) scroller.scrollTo({ top: 0, behavior: 'auto' })
      else window.scrollTo({ top: 0, behavior: 'auto' })
    }

    const ghostHost = ghostHostRef.current
    const captured = pendingGhostRef.current
    pendingGhostRef.current = null

    if (ghostHost && captured) {
      if (ghostTimerRef.current !== null) {
        window.clearTimeout(ghostTimerRef.current)
      }
      ghostHost.innerHTML = ''
      const wrapper = document.createElement('div')
      wrapper.className = 'rc-route-ghost-layer'
      wrapper.setAttribute('data-nav', dir)
      wrapper.setAttribute('aria-hidden', 'true')
      wrapper.inert = true
      if (dir !== 'pop' && captured.scrollTop > 0) {
        captured.node.style.marginTop = `${-captured.scrollTop}px`
      }
      captured.node.className = 'rc-route-ghost-inner'
      wrapper.appendChild(captured.node)
      ghostHost.appendChild(wrapper)

      ghostTimerRef.current = window.setTimeout(() => {
        ghostHost.innerHTML = ''
        ghostTimerRef.current = null
      }, 320)
    }
  }, [activePathname, dir, scrollContainerRef])

  useEffect(() => {
    return () => {
      if (ghostTimerRef.current !== null) {
        window.clearTimeout(ghostTimerRef.current)
      }
    }
  }, [])

  return (
    <div className="rc-route-viewport">
      <div ref={ghostHostRef} className="rc-route-ghost-host" aria-hidden="true" />
      <div
        ref={activeRef}
        key={activePathname}
        className="rc-route-stage"
        data-nav={dir}
      >
        <Suspense
          fallback={
            <div className="py-12">
              <LoadingState message="正在准备视图…" compact />
            </div>
          }
        >
          {children}
        </Suspense>
      </div>
    </div>
  )
}

/**
 * 全屏舞台级切页包装（登录页 / 一级罗盘工作台 / Bloom 沉浸台）。
 */
export function ScreenTransition({
  screenKey,
  children,
}: {
  screenKey: string
  children: ReactNode
}) {
  return (
    <div key={screenKey} className="rc-screen-transition">
      {children}
    </div>
  )
}
