import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { ArrowUpRight, ChevronLeft, GitBranch, Link2, RefreshCw, Sprout, Workflow, X } from 'lucide-react'
import {
  coreRadius,
  linkControlPoint,
  orbitBaseRadius,
  panelEdgePoint,
  panelPolygonFor,
  polygonCss,
  type CardSpec,
  type Placement,
} from './geometry'
import { clamp, prefersReducedMotion } from './motion'
import { morphOf } from './morphs'
import type { BloomMode, BloomUnit, BloomUnitId, ComboInsight } from './types'
import { UNIT_ICONS } from './unitIcons'
import { BloomCard } from './BloomCard'
import { UnitDetail } from './unitDetails'
import { useBloomLayout } from './useBloomLayout'
import { useProjectMembers, useReproQuality } from './unitDetailParts'

const PICKER_PETALS = 16

const RIDGE: Array<{ id: BloomUnitId; label: string }> = [
  { id: 'materials', label: '材料' },
  { id: 'facts', label: '事实' },
  { id: 'evidence', label: '证据' },
  { id: 'plan', label: '规划' },
  { id: 'runs', label: '运行' },
  { id: 'verification', label: '验证' },
  { id: 'report', label: '报告' },
]

type BloomStageProps = {
  projectId: string
  projectName: string | null
  paperTitle: string | null
  units: BloomUnit[]
  mode: BloomMode
  activeId: BloomUnitId | null
  selectedIds: BloomUnitId[]
  combinedPair: [BloomUnitId, BloomUnitId] | null
  comboInsight: (a: BloomUnitId, b: BloomUnitId) => ComboInsight
  onOpen: (id: BloomUnitId) => void
  onClose: () => void
  onSelect: (id: BloomUnitId) => void
  onCombine: (pair: [BloomUnitId, BloomUnitId]) => void
  onCancelCombo: () => void
  onRefresh: () => void
}

function toCards(units: BloomUnit[]): CardSpec[] {
  return units.map((unit) => ({
    id: unit.id,
    order: unit.order,
    ring: unit.ring,
    angle: unit.angle,
    seed: unit.seed,
  }))
}

export function BloomStage({
  projectId,
  projectName,
  paperTitle,
  units,
  mode,
  activeId,
  selectedIds,
  combinedPair,
  comboInsight,
  onOpen,
  onClose,
  onSelect,
  onCombine,
  onCancelCombo,
  onRefresh,
}: BloomStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const orbitRef = useRef<HTMLDivElement | null>(null)
  const queryClient = useQueryClient()

  const [entered, setEntered] = useState(false)
  const [entering, setEntering] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [linksOn, setLinksOn] = useState(false)
  const [reduced] = useState(() => prefersReducedMotion())

  const membersQuery = useProjectMembers(projectId)
  const qualityQuery = useReproQuality(projectId)

  const cards = useMemo(() => toCards(units), [units])
  const activeIds = useMemo<BloomUnitId[]>(() => {
    if (mode === 'combined') return combinedPair ?? []
    if (mode === 'combining') return selectedIds
    return activeId ? [activeId] : []
  }, [mode, combinedPair, selectedIds, activeId])
  const relatedIds = useMemo<BloomUnitId[]>(() => {
    if (mode === 'combined' && combinedPair) {
      const pair = new Set(combinedPair)
      const first = units.find((unit) => unit.id === combinedPair[0])
      const second = units.find((unit) => unit.id === combinedPair[1])
      return Array.from(new Set([...(first?.related ?? []), ...(second?.related ?? [])])).filter(
        (id) => !pair.has(id),
      )
    }
    if (mode === 'open' && activeId) {
      return units.find((unit) => unit.id === activeId)?.related ?? []
    }
    if (mode === 'combining' && selectedIds.length === 1) {
      return units.find((unit) => unit.id === selectedIds[0])?.related ?? []
    }
    return []
  }, [mode, combinedPair, activeId, selectedIds, units])

  const activeUnit = useMemo(
    () => (activeId ? units.find((unit) => unit.id === activeId) ?? null : null),
    [activeId, units],
  )
  const panelMorph = activeUnit ? morphOf(activeUnit.id) : 'lattice'

  const layout = useBloomLayout({
    stageRef,
    cards,
    mode,
    activeIds,
    relatedIds,
    wide: true,
    panelMorph,
  })
  const { stage, mobile, measured, placements, panel, height } = layout

  // 入场：先测量，再双帧后从中心绽放。降低动效时立即到位。
  useEffect(() => {
    if (!measured) return
    if (reduced) {
      setEntered(true)
      setEntering(false)
      return
    }
    let second = 0
    let timer = 0
    setEntering(true)
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => {
        setEntered(true)
        timer = window.setTimeout(() => setEntering(false), 880)
      })
    })
    return () => {
      window.cancelAnimationFrame(first)
      if (second) window.cancelAnimationFrame(second)
      if (timer) window.clearTimeout(timer)
    }
  }, [measured, reduced])

  // 关联连线在展开后 320ms 生长，避免与主卡形变争夺注意力。
  useEffect(() => {
    if (mode !== 'open' || !activeId) {
      setLinksOn(false)
      return
    }
    setLinksOn(false)
    const timer = window.setTimeout(() => setLinksOn(true), reduced ? 0 : 320)
    return () => window.clearTimeout(timer)
  }, [mode, activeId, reduced])

  const lastTrigger = useRef<HTMLElement | null>(null)
  const openUnit = (id: BloomUnitId) => {
    lastTrigger.current = document.querySelector<HTMLElement>(
      `.bloom-card[data-unit="${id}"] .bloom-compact`,
    )
    onOpen(id)
  }

  useEffect(() => {
    if (mode === 'rest' && !activeId) {
      const trigger = lastTrigger.current
      if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true })
      return
    }
    if (mode !== 'open' || !activeId) return
    const timer = window.setTimeout(() => {
      document
        .querySelector<HTMLElement>('.bloom-card.is-open .bloom-detail__scroll')
        ?.focus({ preventScroll: true })
    }, reduced ? 0 : 260)
    return () => window.clearTimeout(timer)
  }, [mode, activeId, reduced])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (mode === 'combined' || mode === 'combining') {
        onCancelCombo()
        return
      }
      if (mode === 'open') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [mode, onClose, onCancelCombo])

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') return
    const target = event.target as HTMLElement
    if (target.closest('.bloom-compact') || target.closest('.bloom-detail')) return
    if (mode === 'combining' && selectedIds.length === 2) {
      event.preventDefault()
      onCombine([selectedIds[0], selectedIds[1]])
    }
  }

  // 鼠标视差 + 拖动旋转（仅收拢态），用 rAF 合并单帧写入。
  const drift = useRef({ x: 0, y: 0, r: 0 })
  const drag = useRef({ active: false, startX: 0, startR: 0, moved: false })
  const frame = useRef(0)
  const suppressClick = useRef(false)

  const applyDrift = () => {
    frame.current = 0
    const orbit = orbitRef.current
    if (!orbit) return
    orbit.style.transform = `translate3d(${drift.current.x.toFixed(2)}px, ${drift.current.y.toFixed(
      2,
    )}px, 0) rotate(${drift.current.r.toFixed(2)}deg)`
  }
  const scheduleDrift = () => {
    if (frame.current) return
    frame.current = window.requestAnimationFrame(applyDrift)
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (mobile || reduced || mode !== 'rest') return
    const target = event.target as HTMLElement
    if (target.closest('.bloom-card') || target.closest('.bloom-core')) return
    drag.current = { active: true, startX: event.clientX, startR: drift.current.r, moved: false }
    orbitRef.current?.classList.add('is-dragging')
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    if (mobile || reduced) return
    if (drag.current.active) {
      const delta = event.clientX - drag.current.startX
      if (Math.abs(delta) > 5) drag.current.moved = true
      drift.current.r = clamp(drag.current.startR + delta / 92, -7, 7)
      scheduleDrift()
      return
    }
    const element = stageRef.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (rect.width === 0) return
    const nx = (event.clientX - rect.left) / rect.width - 0.5
    const ny = (event.clientY - rect.top) / rect.height - 0.5
    drift.current.x = clamp(nx * 16, -9, 9)
    drift.current.y = clamp(ny * 12, -7, 7)
    scheduleDrift()
  }

  const endDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current.active) return
    drag.current.active = false
    orbitRef.current?.classList.remove('is-dragging')
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    suppressClick.current = drag.current.moved
  }

  const handleStageClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement
    if (
      target.closest('.bloom-card') ||
      target.closest('.bloom-core') ||
      target.closest('.bloom-combo') ||
      target.closest('.bloom-combo-panel') ||
      target.closest('.bloom-picker') ||
      target.closest('.bloom-foot')
    ) {
      return
    }
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (mode !== 'rest') onClose()
  }

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    onRefresh()
    void queryClient.invalidateQueries({ queryKey: ['repro-plan'] })
    window.setTimeout(() => setRefreshing(false), 760)
  }

  const links = useMemo(() => {
    if (mode !== 'open' || !activeId || !panel) return []
    const unit = units.find((item) => item.id === activeId)
    if (!unit) return []
    return unit.related
      .map((id) => {
        const placement = placements.get(id)
        if (!placement) return null
        const target = { x: placement.x, y: placement.y }
        const start = panelEdgePoint(panel, target)
        const control = linkControlPoint(start, target, 36)
        return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(
          1,
        )} ${control.y.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`
      })
      .filter((path): path is string => Boolean(path))
  }, [mode, activeId, panel, placements, units])

  const done = units.filter((unit) => unit.tone === 'success').length
  const core = coreRadius(stage, mobile)
  const coreSize = Math.round(core * 2)
  const members = membersQuery.data?.items ?? []
  const overall = qualityQuery.data?.overall

  const unitA = combinedPair ? units.find((unit) => unit.id === combinedPair[0]) : undefined
  const unitB = combinedPair ? units.find((unit) => unit.id === combinedPair[1]) : undefined
  const combo = combinedPair ? comboInsight(combinedPair[0], combinedPair[1]) : null

  const comboSource = selectedIds.length === 1
    ? units.find((unit) => unit.id === selectedIds[0]) ?? null
    : null
  const comboCandidates = comboSource
    ? units.filter((unit) => unit.id !== comboSource.id)
    : []
  const railRadii =
    stage.w > 0 ? [0.61, 0.89, 1.17].map((ratio) => orbitBaseRadius(stage) * ratio) : []

  return (
    <div className={`bloom-page${mobile ? ' bloom-page--mobile' : ''}${mobile && mode === 'combined' ? ' bloom-page--combined' : ''}`}>
      <div className="bloom-shell">
        <div className="bloom-shell__glow" aria-hidden="true" />

        <header className="bloom-topbar">
          <Link className="bloom-back" to={`/projects/${projectId}/overview`}>
            <Icon as={ChevronLeft} size={13} />
            项目概览
          </Link>

          <div className="bloom-project">
            <span className="bloom-project__mark" aria-hidden="true">
              <Icon as={Sprout} size={16} />
            </span>
            <div className="bloom-project__text">
              <p className="bloom-project__name">{projectName ?? '加载项目…'}</p>
              <p className="bloom-project__paper">{paperTitle ?? '复现审计工作台'}</p>
            </div>
          </div>

          <nav className="bloom-ridge" aria-label="复现阶段">
            {RIDGE.map((step, index) => {
              const unit = units.find((item) => item.id === step.id)
              return (
                <span key={step.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                  {index > 0 && <span className="bloom-ridge__link" aria-hidden="true" />}
                  <button
                    type="button"
                    className={`bloom-ridge__step${unit?.tone === 'success' ? ' is-on' : ''}`}
                    aria-current={activeId === step.id ? 'step' : undefined}
                    onClick={() => openUnit(step.id)}
                  >
                    <span className="bloom-ridge__dot" aria-hidden="true" />
                    {step.label}
                  </button>
                </span>
              )
            })}
          </nav>

          <div className="bloom-topbar__right">
            <nav className="bloom-stage__tabs" aria-label="工作台视图">
              <span className="is-active" aria-current="page">绽放</span>
              <Link to={`/projects/${projectId}/workbench?view=atelier`}>工坊</Link>
              <Link to={`/projects/${projectId}/workbench?view=loom`}>
                <Icon as={GitBranch} size={9} />
                织机
              </Link>
            </nav>
            <div className="bloom-avatars" aria-label="项目成员">
              {members.slice(0, 4).map((member) => (
                <span
                  key={member.user_id}
                  className="bloom-avatar"
                  title={`${member.display_name} · ${member.role_key}`}
                >
                  {(member.display_name || member.email || '?').slice(0, 1)}
                </span>
              ))}
            </div>
            <Link className="bloom-link-out" to={`/projects/${projectId}/overview`}>
              标准视图
              <Icon as={ArrowUpRight} size={13} />
            </Link>
          </div>
        </header>

        <section
          ref={stageRef}
          className={`bloom-stage${mobile ? ' bloom-stage--mobile' : ''}${entered && !reduced ? ' is-entered' : ''}`}
          style={mobile ? { height } : undefined}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClick={handleStageClick}
          onKeyDown={handleKeyDown}
        >
          {stage.w > 0 && (
            <>
              <div className="bloom-stage__hud" aria-hidden="true">
                <span className="bloom-stage__hud-item">FIELD 01 · REPRO LEDGER</span>
                <span className="bloom-stage__hud-item bloom-stage__hud-item--right">
                  10 UNITS / 3 ORBITS / LIVE API
                </span>
              </div>
              <div className="bloom-stage__rails" aria-hidden="true">
                <svg width={stage.w} height={stage.h} viewBox={`0 0 ${stage.w} ${stage.h}`}>
                  {mode === 'rest' &&
                    units.map((unit) => {
                      const point = placements.get(unit.id)
                      if (!point) return null
                      return (
                        <line
                          key={`ray-${unit.id}`}
                          x1={stage.w / 2}
                          y1={stage.h / 2}
                          x2={point.x}
                          y2={point.y}
                          stroke="var(--bloom-accent)"
                          strokeOpacity={0.16}
                          strokeWidth={0.8}
                          strokeDasharray="1 11"
                        />
                      )
                    })}
                  {railRadii.map((radius, index) => (
                    <ellipse
                      key={index}
                      cx={stage.w / 2}
                      cy={stage.h / 2}
                      rx={radius}
                      ry={radius * 0.6}
                      fill="none"
                      stroke="var(--rc-hi)"
                      strokeOpacity={0.065 - index * 0.012}
                      strokeDasharray={index === 2 ? '3 9' : undefined}
                    />
                  ))}
                </svg>
              </div>
            </>
          )}

          <div className="bloom-orbit" ref={orbitRef}>
            <div
              className="bloom-core"
              style={{ width: coreSize, height: coreSize }}
              aria-label="项目核心"
            >
              <span className="bloom-core__disc" aria-hidden="true" />
              <span className="bloom-core__ring" aria-hidden="true" />
              <span className="bloom-core__glyph" aria-hidden="true">
                R<span>/00</span>
              </span>
              <span className="bloom-core__ticks" aria-hidden="true">
                {units.map((unit, index) => (
                  <span
                    key={unit.id}
                    className="bloom-core__tick"
                    style={{
                      transform: `rotate(${-90 + index * 36}deg) translateY(-${core + 14}px)`,
                      background:
                        unit.tone === 'success' ? 'var(--bloom-pass)' : undefined,
                      opacity: unit.tone === 'success' ? 0.62 : undefined,
                    }}
                  />
                ))}
              </span>
              <span className="bloom-core__tag">Bloom Ledger</span>
              <span className="bloom-core__name">{projectName ?? 'ReproCheck'}</span>
              <span className="bloom-core__paper">{paperTitle ?? '复现审计'}</span>
              <span className="bloom-core__score">
                {overall == null ? '—' : overall.toFixed(3)}
                <small>覆盖分</small>
              </span>
              <Link
                className="bloom-core__atelier"
                to={`/projects/${projectId}/workbench?view=atelier`}
                onClick={(event) => event.stopPropagation()}
              >
                <Icon as={Workflow} size={12} />
                打开复现工坊
              </Link>
            </div>

            <svg
              className="bloom-links"
              width={stage.w}
              height={stage.h}
              aria-hidden="true"
            >
              {links.map((path, index) => (
                <path key={index} className={`bloom-link${linksOn ? ' is-on' : ''}`} d={path} />
              ))}
            </svg>

            {units.map((unit) => {
              const placement: Placement | undefined = placements.get(unit.id)
              if (!placement) return null
              return (
                <BloomCard
                  key={unit.id}
                  unit={unit}
                  projectId={projectId}
                  placement={placement}
                  center={{ x: stage.w / 2, y: stage.h / 2 }}
                  open={mode !== 'combined' && activeId === unit.id}
                  selected={selectedIds.includes(unit.id)}
                  combining={mode === 'combining'}
                  mobile={mobile}
                  entered={entered}
                  entering={entering}
                  dimmed={(mode === 'open' || mode === 'combined') && activeId !== unit.id}
                  onOpen={() => openUnit(unit.id)}
                  onSelect={() => onSelect(unit.id)}
                  onClose={onClose}
                />
              )
            })}
          </div>

          {mode === 'combining' && (
            <div className="bloom-combo">
              <span className="bloom-combo__label">
                {selectedIds.length === 2 ? '两片瓣已就位，确认铰接' : '选择第二片瓣'}
              </span>
              <div className="bloom-combo__pair">
                <span className={`bloom-combo__slot${selectedIds[0] ? ' is-filled' : ''}`}>
                  {selectedIds[0]
                    ? units.find((unit) => unit.id === selectedIds[0])?.title
                    : '空槽'}
                </span>
                <Icon as={Link2} size={11} />
                <span className={`bloom-combo__slot${selectedIds[1] ? ' is-filled' : ''}`}>
                  {selectedIds[1]
                    ? units.find((unit) => unit.id === selectedIds[1])?.title
                    : '待选择'}
                </span>
              </div>
              <button
                type="button"
                className="bloom-combo__cancel"
                onClick={onCancelCombo}
                aria-label="取消组合"
              >
                <Icon as={X} size={12} />
              </button>
            </div>
          )}

          {mode === 'combined' && unitA && unitB && panel && combo && (
            <div
              className="bloom-combo-panel"
              style={
                {
                  left: panel.x,
                  top: panel.y,
                  width: panel.w,
                  height: panel.h,
                  '--bloom-clip': polygonCss(panelPolygonFor('lattice', unitA.seed + unitB.seed)),
                } as CSSProperties
              }
              role="region"
              aria-label={`${unitA.title}与${unitB.title}组合工作区`}
            >
              <div className="bloom-combo-panel__head">
                <div className="bloom-detail__heading">
                  <p className="bloom-detail__kicker">Joint Ledger · 组合账本</p>
                  <h2 className="bloom-detail__title">
                    {unitA.title} × {unitB.title}
                  </h2>
                </div>
                <div className="bloom-detail__tools">
                  <button
                    type="button"
                    className="bloom-icon-btn"
                    onClick={onCancelCombo}
                    aria-label="拆开组合"
                    title="拆开组合"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              <div className="bloom-combo-panel__hinge">
                <Link2 size={12} aria-hidden="true" />
                <strong>{combo.title}</strong>
                <span>· 组合只并置证据，不合并业务对象，不改变权限</span>
              </div>

              <div className="bloom-combo-panel__cols">
                <div className="bloom-combo-col">
                  <p className="bloom-combo-col__title">{unitA.title}</p>
                  <UnitDetail unitId={unitA.id} projectId={projectId} />
                </div>
                <div className="bloom-combo-panel__divider" aria-hidden="true" />
                <div className="bloom-combo-col">
                  <p className="bloom-combo-col__title">{unitB.title}</p>
                  <UnitDetail unitId={unitB.id} projectId={projectId} />
                </div>
              </div>

              <div className="bloom-combo-panel__foot">
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 10 }}>
                  <Link
                    className="btn-ghost"
                    to={unitA.links[0]?.to ?? `/projects/${projectId}/overview`}
                  >
                    打开 {unitA.links[0]?.label ?? '标准视图'}
                  </Link>
                  <Link
                    className="btn-ghost"
                    to={unitB.links[0]?.to ?? `/projects/${projectId}/overview`}
                  >
                    打开 {unitB.links[0]?.label ?? '标准视图'}
                  </Link>
                </span>
              </div>
            </div>
          )}

          {mobile && mode === 'combining' && selectedIds.length === 1 && (
            <div className="bloom-picker" role="dialog" aria-modal="true" aria-label="选择第二片瓣">
              <div className="bloom-picker__petals" aria-hidden="true">
                {Array.from({ length: PICKER_PETALS }, (_, index) => (
                  <span
                    key={index}
                    className="bloom-picker__petal"
                    style={
                      { '--petal-angle': `${index * (360 / PICKER_PETALS)}deg` } as CSSProperties
                    }
                  />
                ))}
              </div>

              <div className="bloom-picker__disc">
                <div className="bloom-picker__ring" aria-hidden="true" />

                <div className="bloom-picker__center">
                  <span className="bloom-picker__eyebrow">RELEASE TO SELECT</span>
                  <strong className="bloom-picker__prompt">选择第二片瓣</strong>
                  <span className="bloom-picker__source">
                    来自「{comboSource?.title ?? '当前瓣'}」
                  </span>
                </div>

                {comboCandidates.map((unit, index) => {
                  const angle = -Math.PI / 2 + (index * Math.PI * 2) / comboCandidates.length
                  const UnitIcon = UNIT_ICONS[unit.id]
                  return (
                    <button
                      key={unit.id}
                      type="button"
                      className="bloom-picker__option"
                      style={
                        {
                          left: `${50 + Math.cos(angle) * 40}%`,
                          top: `${50 + Math.sin(angle) * 40}%`,
                          '--node-delay': `${index * 38}ms`,
                        } as CSSProperties
                      }
                      data-title={`${unit.title} · ${unit.metric}${unit.metricLabel}`}
                      aria-label={`选择${unit.title}`}
                      onClick={() => onSelect(unit.id)}
                    >
                      <Icon as={UnitIcon} size={19} />
                    </button>
                  )
                })}

                <button
                  type="button"
                  className="bloom-picker__cancel"
                  onClick={onCancelCombo}
                  aria-label="取消组合"
                >
                  <X size={13} aria-hidden="true" />
                  取消
                </button>
              </div>
            </div>
          )}

          <footer className="bloom-foot">
            <span className="bloom-foot__hint">
              <span className="bloom-foot__key">Esc</span>
              {mode === 'combined' ? '拆开组合' : mode === 'open' ? '收拢' : '返回'}
            </span>
            {mode === 'rest' && (
              <span className="bloom-foot__hint">
                <span className="bloom-foot__key">拖</span>
                旋转 ±7°
              </span>
            )}
            <span className="bloom-foot__hint">
              <span className="bloom-foot__key">＋</span>
              组合
            </span>
            <span className="bloom-foot__legend">
              <span className="bloom-foot__legend-line" aria-hidden="true" />
              关联证据
            </span>
            <Link className="bloom-foot__atelier" to={`/projects/${projectId}/workbench?view=atelier`}>
              <Workflow size={11} />
              复现工坊 · 5 单元联动
            </Link>
            <div className="bloom-foot__right">
              <span>
                {done}/10 单元完成 · {members.length} 位成员 · 实时接口
              </span>
              <button
                type="button"
                className="bloom-foot__refresh"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <Icon as={RefreshCw} size={11} />
                {refreshing ? '刷新中' : '刷新数据'}
              </button>
            </div>
          </footer>
        </section>
      </div>
    </div>
  )
}
