import { startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react'
import { ArrowUpRight, Plus, Workflow, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  closedPolygonFor,
  panelPolygonFor,
  polygonCss,
  restPolygonFor,
  REST_H,
  REST_W,
} from './geometry'
import { prefersReducedMotion } from './motion'
import { MORPH_META, morphOf } from './morphs'
import type { BloomUnit } from './types'
import { UNIT_ICONS } from './unitIcons'
import { UnitDetail } from './unitDetails'
import type { Placement } from './geometry'

type BloomCardProps = {
  unit: BloomUnit
  projectId: string
  placement: Placement
  center: { x: number; y: number }
  open: boolean
  selected: boolean
  combining: boolean
  mobile: boolean
  entered: boolean
  entering: boolean
  dimmed: boolean
  onOpen: () => void
  onSelect: () => void
  onClose: () => void
}

function revealDelay(ms: number): CSSProperties {
  return { '--reveal-delay': `${ms}ms` } as CSSProperties
}

export function BloomCard({
  unit,
  projectId,
  placement,
  center,
  open,
  selected,
  combining,
  mobile,
  entered,
  entering,
  dimmed,
  onOpen,
  onSelect,
  onClose,
}: BloomCardProps) {
  const [hovered, setHovered] = useState(false)
  const [revealed, setRevealed] = useState(false)
  // 形变活动期标记：只在展开/收拢的过渡窗口内挂载 will-change 与关闭背景模糊，
  // 动画结束后自动摘除，避免常驻提升图层（性能复核 §任务 2）。
  const [morphing, setMorphing] = useState(false)
  const [scrollHint, setScrollHint] = useState({ overflowing: false, atEnd: true })
  const tiltRef = useRef<HTMLSpanElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) {
      setScrollHint({ overflowing: false, atEnd: true })
      return
    }
    const node = scrollRef.current
    if (!node) return
    let frame = 0
    const measure = () => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const overflowing = node.scrollHeight > node.clientHeight + 6
        const atEnd = node.scrollTop + node.clientHeight >= node.scrollHeight - 8
        setScrollHint((previous) =>
          previous.overflowing === overflowing && previous.atEnd === atEnd
            ? previous
            : { overflowing, atEnd },
        )
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    node.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
      node.removeEventListener('scroll', measure)
    }
  }, [open, unit.id])

  useEffect(() => {
    if (!open) {
      setRevealed(false)
      return
    }
    if (prefersReducedMotion()) {
      setRevealed(true)
      return
    }
    // V3 性能：厚重工作区在形变尾段再挂载；空闲调度 + React transition 让浏览器
    // 可以先完成主卡动画，再把较大的详情树拆成可中断的渲染工作。
    let idle = 0
    const mountDetail = () => startTransition(() => setRevealed(true))
    const timer = window.setTimeout(() => {
      if ('requestIdleCallback' in window) {
        idle = window.requestIdleCallback(mountDetail, { timeout: 240 })
      } else {
        mountDetail()
      }
    }, 780)
    return () => {
      window.clearTimeout(timer)
      if (idle) window.cancelIdleCallback(idle)
    }
  }, [open])

  const morph = morphOf(unit.id)
  const morphMeta = MORPH_META[morph]

  // 初次挂载时 open 尚未变化，不应进入形变期；只在 open 真正切换时开启计时。
  const prevOpen = useRef(open)
  useEffect(() => {
    if (prevOpen.current === open) return
    prevOpen.current = open
    setMorphing(true)
    const timer = window.setTimeout(() => setMorphing(false), morphMeta.duration + 120)
    return () => window.clearTimeout(timer)
  }, [open, morphMeta.duration])

  const restClip = useMemo(
    () => polygonCss(restPolygonFor(morph, unit.seed, hovered && !open ? 1.14 : 1)),
    [morph, unit.seed, hovered, open],
  )
  const openClip = useMemo(() => polygonCss(panelPolygonFor(morph, unit.seed)), [morph, unit.seed])
  const closedClip = useMemo(
    () => polygonCss(closedPolygonFor(morph, unit.seed)),
    [morph, unit.seed],
  )

  const clip = !entered ? closedClip : open ? openClip : restClip
  const UnitIcon = UNIT_ICONS[unit.id]

  const offsetX = placement.x - placement.w / 2
  const offsetY = placement.y - placement.h / 2
  const targetTransform = `translate3d(${offsetX}px, ${offsetY}px, 0) rotate(${placement.rotate}deg) scale(${placement.scale})`
  // 入口节奏由 ring 主导：内环先绽、外环后绽；同环内仅用 order 做小幅错位。
  const ringOffset = unit.ring === 0 ? 0 : unit.ring === 1 ? 110 : 220
  const entranceMs = 60 + ringOffset + (unit.order % 4) * 38
  const turnByMorph = morph === 'lattice' ? -10 : morph === 'instrument' ? 7 : -4
  const turnByRing = unit.ring === 0 ? 2 : unit.ring === 1 ? -4 : 6
  const startRotate = turnByMorph + turnByRing
  const startScale = 0.46 - unit.ring * 0.08
  const initialTransform = `translate3d(${center.x - REST_W / 2}px, ${center.y - REST_H / 2}px, 0) rotate(${startRotate}deg) scale(${startScale})`

  const style: CSSProperties = {
    width: entered ? placement.w : REST_W,
    height: entered ? placement.h : REST_H,
    transform: entered ? targetTransform : initialTransform,
    opacity: entered ? placement.opacity : 0,
    zIndex: open ? 44 : placement.z,
    '--bloom-delay': entering ? `${entranceMs}ms` : '0ms',
    // 呼吸动画的延迟必须恒定，不能随 entering 结束被清零，否则进度会跳变。
    '--bloom-breathe-delay': `${entranceMs}ms`,
    '--bloom-ring': String(unit.ring),
    '--bloom-dur': `${morphMeta.duration}ms`,
    '--bloom-clip': clip,
  } as CSSProperties

  const compactClick = () => {
    if (combining) onSelect()
    else onOpen()
  }

  const onCompactKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      compactClick()
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (open || mobile || !tiltRef.current) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width
    const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height
    tiltRef.current.style.transform = `perspective(760px) rotateX(${(-dy * 3.6).toFixed(2)}deg) rotateY(${(dx * 4.6).toFixed(2)}deg)`
  }

  const resetTilt = () => {
    if (tiltRef.current) tiltRef.current.style.transform = ''
    setHovered(false)
  }

  const cardClass = [
    'bloom-card',
    `bloom-morph--${morph}`,
    entered ? 'is-entered' : '',
    // 入场活动期：CSS 只在此时给卡片挂 will-change，动画结束后自动摘掉
    entering ? 'is-entering' : '',
    open ? 'is-open' : '',
    open && revealed ? 'is-revealed' : '',
    morphing ? 'is-morphing' : '',
    dimmed && !open ? 'is-dimmed' : '',
    selected ? 'is-selected' : '',
    !open && placement.w < 150 ? 'is-narrow' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const indexLabel = String(unit.order + 1).padStart(2, '0')
  const statusDot = <span className={`bloom-dot tone-${unit.tone}`} aria-hidden="true" />

  // 三种形态共用真实数据与工具按钮，但工作区的 DOM 组织完全不同。
  const renderHead = (headClass: string) => (
    <div className={`${headClass} bloom-detail__head bloom-reveal`} style={revealDelay(0)}>
      <div className="bloom-detail__heading">
        <p className="bloom-detail__kicker">
          {indexLabel} · {unit.kicker} · {morphMeta.label} / {morphMeta.cn}
        </p>
        <h2 className="bloom-detail__title">{unit.title}</h2>
        <p className="bloom-detail__sub">{unit.summary}</p>
      </div>
      <div className="bloom-detail__tools">
        <Link
          className="bloom-icon-btn bloom-icon-btn--atelier"
          to={`/projects/${projectId}/workbench?view=atelier&focus=${unit.id}`}
          title="在复现工坊中与其它单元组合"
          aria-label="在复现工坊中与其它单元组合"
        >
          <Icon as={Workflow} size={15} />
        </Link>
        <button
          type="button"
          className="bloom-icon-btn"
          title="与其他单元组合"
          aria-label="与其他单元组合"
          onClick={onSelect}
        >
          <Icon as={Plus} size={15} />
        </button>
        {unit.links[0] && (
          <Link
            to={unit.links[0].to}
            className="bloom-icon-btn"
            title={`在标准视图打开：${unit.links[0].label}`}
            aria-label={`在标准视图打开：${unit.links[0].label}`}
          >
            <Icon as={ArrowUpRight} size={15} />
          </Link>
        )}
        <button
          type="button"
          className="bloom-icon-btn"
          title="收拢"
          aria-label="收拢"
          onClick={onClose}
        >
          <Icon as={X} size={15} />
        </button>
      </div>
    </div>
  )

  const renderFoot = () => (
    <div className="bloom-detail__foot bloom-reveal" style={revealDelay(270)}>
      <Link
        className="btn-atelier"
        to={`/projects/${projectId}/workbench?view=atelier&focus=${unit.id}`}
      >
        <Icon as={Workflow} size={13} />
        装配进复现工坊
      </Link>
      {unit.links.map((link) => (
        <Link
          key={`${unit.id}-${link.label}`}
          to={link.to}
          className={link.label === '打开完整页面' ? 'btn-primary' : 'btn-ghost'}
        >
          {link.label}
          <Icon as={ArrowUpRight} size={13} />
        </Link>
      ))}
      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--bloom-paper-muted)' }}>
        数据来自 /api/v1 实时接口
      </span>
    </div>
  )

  const renderOpenFace = () => {
    const more =
      scrollHint.overflowing && !scrollHint.atEnd ? (
        <span className="bloom-detail__more" aria-hidden="true">
          ↓
        </span>
      ) : null

    // folio：中轴书脊 + 左元数据页 + 右主体页，像摊开的校样。
    if (morph === 'folio') {
      return (
        <div
          className="bloom-detail bloom-openface bloom-openface--folio"
          id={`bloom-panel-${unit.id}`}
          role="region"
          aria-label={`${unit.title}工作区`}
        >
          <div className="folio__spread">
            <aside className="folio__leaf folio__leaf--left" aria-label="档案侧栏">
              <div className="folio__imprint">
                <span>FOLIO</span>
                <span>{indexLabel}</span>
              </div>
              <div className="folio__meta-list">
                <div className="folio__meta-row">
                  <span>条目分类</span>
                  <b>{unit.kicker}</b>
                </div>
                <div className="folio__meta-row">
                  <span>核心读数</span>
                  <b>
                    {unit.metric} <small>{unit.metricLabel}</small>
                  </b>
                </div>
                <div className="folio__meta-row">
                  <span>当前状态</span>
                  <b className="folio__meta-status">
                    {statusDot}
                    {unit.status}
                  </b>
                </div>
                <div className="folio__meta-row">
                  <span>关联单元</span>
                  <b>{unit.related.length} 项</b>
                </div>
                <div className="folio__meta-row">
                  <span>展开形态</span>
                  <b>{morphMeta.cn}</b>
                </div>
                <div className="folio__meta-row">
                  <span>标准视图</span>
                  <b>{unit.links.length} 个入口</b>
                </div>
              </div>
              <div className="folio__binder" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => (
                  <i key={index} />
                ))}
              </div>
            </aside>
            <div className="folio__spine" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="folio__leaf folio__leaf--right">
              {renderHead('folio__head')}
              <div className="bloom-detail__body folio__body">
                <div
                  className="bloom-detail__scroll folio__scroll"
                  ref={scrollRef}
                  tabIndex={0}
                >
                  <UnitDetail unitId={unit.id} projectId={projectId} />
                </div>
                {more}
              </div>
            </div>
          </div>
          {renderFoot()}
        </div>
      )
    }

    // lattice：区块按对角顺序点亮，内容被编成一块可摆放的证据格架。
    if (morph === 'lattice') {
      return (
        <div
          className="bloom-detail bloom-openface bloom-openface--lattice"
          id={`bloom-panel-${unit.id}`}
          role="region"
          aria-label={`${unit.title}工作区`}
        >
          {renderHead('lattice__head')}
          <div className="lattice__board">
            <span className="lattice__axis lattice__axis--h" aria-hidden="true" />
            <span className="lattice__axis lattice__axis--v" aria-hidden="true" />
            <span className="lattice__origin" aria-hidden="true">
              <i />
            </span>
            <div className="bloom-detail__body lattice__body">
              <div
                className="bloom-detail__scroll lattice__scroll"
                ref={scrollRef}
                tabIndex={0}
              >
                <UnitDetail unitId={unit.id} projectId={projectId} />
              </div>
              {more}
            </div>
          </div>
          {renderFoot()}
        </div>
      )
    }

    // instrument：顶部读数条先行就位，控制台自下而上抬起，内容为分区读数面板。
    return (
      <div
        className="bloom-detail bloom-openface bloom-openface--instrument"
        id={`bloom-panel-${unit.id}`}
        role="region"
        aria-label={`${unit.title}工作区`}
      >
        <div className="instrument__rail">
          <span className="instrument__rail-id">
            INSTRUMENT · {indexLabel}
          </span>
          <div className="instrument__reading">
            <span className="instrument__reading-label">{unit.metricLabel}</span>
            <strong className="instrument__reading-value">{unit.metric}</strong>
          </div>
          <span className="instrument__rail-status">
            {statusDot}
            {unit.status}
          </span>
          <span className="instrument__rail-ticks" aria-hidden="true" />
        </div>
        <div className="instrument__console">
          {renderHead('instrument__head')}
          <div className="bloom-detail__body instrument__body">
            <div
              className="bloom-detail__scroll instrument__scroll"
              ref={scrollRef}
              tabIndex={0}
            >
              <UnitDetail unitId={unit.id} projectId={projectId} />
            </div>
            {more}
          </div>
        </div>
        {renderFoot()}
      </div>
    )
  }

  return (
    <article
      className={cardClass}
      style={style}
      data-unit={unit.id}
      aria-label={open ? undefined : `${unit.title}，${unit.metric} ${unit.metricLabel}`}
    >
      <span
        className="bloom-card__underlay bloom-card__underlay--back"
        style={{ clipPath: clip }}
        aria-hidden="true"
      />
      <span
        className="bloom-card__underlay bloom-card__underlay--mid"
        style={{ clipPath: clip }}
        aria-hidden="true"
      />
      <span className="bloom-card__surface" onPointerMove={onPointerMove} onPointerLeave={resetTilt}>
        <span className="bloom-card__tilt" ref={tiltRef}>
          <span className="bloom-card__body">
            <button
              type="button"
              className="bloom-compact"
              onClick={compactClick}
              onKeyDown={onCompactKey}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              aria-expanded={open}
              aria-controls={`bloom-panel-${unit.id}`}
            >
              <span className="bloom-compact__top">
                <span className="bloom-compact__indexline">
                  <span className="bloom-compact__index">{indexLabel}</span>
                  <span className="bloom-compact__morph">{morphMeta.label}</span>
                </span>
                <span className="bloom-compact__icon" aria-hidden="true">
                  <Icon as={UnitIcon} size={15} />
                </span>
              </span>
              <span className="bloom-compact__kicker">{unit.kicker}</span>
              <span className="bloom-compact__title">{unit.title}</span>
              <span className="bloom-compact__hint">
                <span>
                  <span className="bloom-compact__metric">{unit.metric}</span>
                  <span className="bloom-compact__metric-label">{unit.metricLabel}</span>
                </span>
                <span className="bloom-compact__status">
                  <span className={`bloom-dot tone-${unit.tone}`} aria-hidden="true" />
                  {unit.status}
                </span>
              </span>
              <span className="bloom-compact__scale" aria-hidden="true">
                {Array.from({ length: 7 }, (_, index) => (
                  <span key={index} />
                ))}
              </span>
              <span className="bloom-compact__peek" aria-hidden="true">
                {unit.summary}
              </span>
            </button>

            {open && revealed && renderOpenFace()}
          </span>
        </span>
      </span>
    </article>
  )
}
