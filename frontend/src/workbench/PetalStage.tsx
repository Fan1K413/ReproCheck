import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { ArrowUpRight } from 'lucide-react'
import type { Entry, Feature } from './EntryLauncher'
import { buildPetalGeometry, type PetalPlacement } from './petalLayout'

type Props = {
  entry: Entry
  onClose: () => void
  onLaunch: (feature: Feature) => void
}

type PanelStyle = CSSProperties & {
  '--rc-petal-from-x': string
  '--rc-petal-from-y': string
  '--rc-petal-delay': string
}

function useViewport() {
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  return viewport
}

/**
 * 二级「空间花瓣」。
 *
 * 交互合同：
 * - 锚点入口先脉冲，面板按索引以 55ms 级联淡入并向外落位；
 * - 面板不重叠、不越界，6 项时分成 3+3 两段，锚点落在中央空隙；
 * - 点击另一入口由 RadialWorkbench 直接切换（组件以 entry.id 为 key 重挂载）；
 * - 点击空白 / Esc / 右上「收起」关闭；面板支持方向键轮转与 Enter 进入；
 * - 路由仍由父级调用 onLaunch(feature)，这里是纯展示层。
 */
export default function PetalStage({ entry, onClose, onLaunch }: Props) {
  const viewport = useViewport()
  const panelRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [discSize, setDiscSize] = useState(0)

  useEffect(() => {
    const shell = document.querySelector('.rc-disc-shell')
    if (!shell) return
    setDiscSize(shell.getBoundingClientRect().width)
  }, [viewport.width, viewport.height])

  const geometry = useMemo(
    () =>
      buildPetalGeometry({
        count: entry.features.length,
        anchorAngle: entry.angle,
        stageWidth: viewport.width,
        stageHeight: viewport.height,
        discSize,
      }),
    [discSize, entry.angle, entry.features.length, viewport.height, viewport.width],
  )

  // 打开后把焦点交给第一片花瓣；鼠标打开时 :focus-visible 不会亮，键盘打开会亮。
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      panelRefs.current[0]?.focus({ preventScroll: true })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [entry.id])

  const focusPanel = (index: number) => {
    const total = geometry.panels.length
    if (total === 0) return
    const next = (index + total) % total
    panelRefs.current[next]?.focus({ preventScroll: true })
  }

  const onPanelKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusPanel(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusPanel(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusPanel(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusPanel(geometry.panels.length - 1)
    }
  }

  const panelStyle = (panel: PetalPlacement): PanelStyle => ({
    left: `${panel.x}px`,
    top: `${panel.y}px`,
    width: `${panel.width}px`,
    height: `${panel.height}px`,
    '--rc-petal-from-x': `${panel.fromX.toFixed(2)}px`,
    '--rc-petal-from-y': `${panel.fromY.toFixed(2)}px`,
    '--rc-petal-delay': `${110 + panel.bloomRank * 55}ms`,
  })

  return (
    <>
      {/* 遮罩在圆盘之下、背景之上：盘外点击关闭，盘内入口仍可直接切换。 */}
      <div className="rc-petal-scrim" onClick={onClose} aria-hidden="true" />

      <div
        className="rc-petal-stage"
        data-mode={geometry.mode}
        data-columns={geometry.columns}
        role="group"
        aria-label={`${entry.name}的 ${entry.features.length} 个功能`}
      >
        <div className="rc-petal-heading" aria-hidden="true">
        <span className="rc-petal-heading__name">{entry.name}</span>
        <span className="rc-petal-heading__rule" />
        <span className="rc-petal-heading__count">
          {String(entry.features.length).padStart(2, '0')} 项
        </span>
      </div>

      <svg
        className="rc-petal-rail"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        aria-hidden="true"
      >
        {geometry.rails.map((rail, index) => (
          <g key={`rail-${index}`}>
            <path className="rc-petal-rail__glow" d={rail.d} />
            <path className="rc-petal-rail__line" d={rail.d} />
          </g>
        ))}
      </svg>

      {geometry.panels.map((panel, index) => {
        const feature = entry.features[index]
        return (
          <button
            key={`${feature.route}-${index}`}
            ref={(node) => {
              panelRefs.current[index] = node
            }}
            type="button"
            className="rc-petal"
            style={panelStyle(panel)}
            aria-label={`${entry.name}：${feature.label}`}
            onClick={() => onLaunch(feature)}
            onKeyDown={(event) => onPanelKeyDown(event, index)}
          >
            <span className="rc-petal__index" aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <span className="rc-petal__copy">
              <span className="rc-petal__label">{feature.label}</span>
              {feature.hint && <span className="rc-petal__hint">{feature.hint}</span>}
            </span>
            <span className="rc-petal__go" aria-hidden="true">
              <ArrowUpRight size={14} strokeWidth={1.7} />
            </span>
          </button>
        )
      })}

      <button type="button" className="rc-petal-close" onClick={onClose}>
        收起
        <span className="rc-petal-close__esc" aria-hidden="true">
          ESC
        </span>
      </button>
      </div>
    </>
  )
}
