import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { BookOpen, Grid2X2, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'
import AllFeaturesPopover from './AllFeaturesPopover'
import ReproFieldBackground from './background/ReproFieldBackground'
import EntryGlyph from './EntryGlyph'
import { ENTRIES, setRouteNotice, useLaunchEntry } from './EntryLauncher'
import type { Feature } from './EntryLauncher'
import PetalStage from './PetalStage'
import { buildSlots, RING_PERCENT, slotStyle } from './radialLayout'
import { useRadialInteraction } from './useRadialInteraction'
import PageHelpButton from '../ux/PageHelpDrawer'

const HINT_KEY = 'rc:workbench-hint'

/** 唯一几何源：入口数量 → 角度 → 百分比坐标。组件内不再出现任何入口坐标。 */
const SLOTS = buildSlots(ENTRIES.length)

function shortId(id: string) {
  return id.length > 10 ? `${id.slice(0, 8)}…` : id
}

export default function RadialWorkbench({ onReopenGuide }: { onReopenGuide?: () => void }) {
  const discRef = useRef<HTMLDivElement>(null)
  const entryRefs = useRef<Array<HTMLButtonElement | null>>([])
  const navigateTimer = useRef<number | undefined>(undefined)
  const hintTimer = useRef<number | undefined>(undefined)

  const [leaving, setLeaving] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const [allOpen, setAllOpen] = useState(false)
  const [fanIndex, setFanIndex] = useState<number | null>(null)
  const [ripple, setRipple] = useState<{ index: number; key: number } | null>(null)

  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const lastPlanId = useUIStore((state) => state.lastPlanId)
  const lastRunId = useUIStore((state) => state.lastRunId)
  const launch = useLaunchEntry()

  const showHint = (force = false) => {
    let seen = false
    try {
      seen = window.sessionStorage.getItem(HINT_KEY) === '1'
      window.sessionStorage.setItem(HINT_KEY, '1')
    } catch {
      /* 隐私模式下每次都显示 */
    }
    if (seen && !force) return
    setHintVisible(true)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHintVisible(false), 3600)
  }

  useEffect(() => {
    showHint()
    return () => {
      window.clearTimeout(navigateTimer.current)
      window.clearTimeout(hintTimer.current)
    }
  }, [])

  /** 一级入口不再直接跳页：先在同一空间里展开该入口的真实功能卡组。 */
  const openFan = (index: number) => {
    if (leaving) return
    setRouteNotice(undefined)
    setFanIndex(index)
  }

  const launchFromFan = (feature: Feature) => {
    if (leaving) return
    setLeaving(true)
    setFanIndex(null)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    navigateTimer.current = window.setTimeout(
      () => {
        launch(feature)
      },
      reduced ? 120 : 280,
    )
  }

  const interaction = useRadialInteraction({
    discRef,
    entryRefs,
    onCommit: openFan,
    onHint: () => showHint(),
  })
  const { phase, activeIndex, focusIndex, dimOpacity } = interaction
  const activeEntry = activeIndex === null ? null : ENTRIES[activeIndex]

  /** 关闭卡组时一并清掉入口的选中/悬停态，避免气泡与高亮残留。 */
  const closeFan = () => {
    const index = fanIndex
    setFanIndex(null)
    interaction.reset()
    // 键盘用户关闭后回到刚展开的入口，焦点不落在页面空白。
    window.requestAnimationFrame(() => {
      if (index !== null) entryRefs.current[index]?.focus({ preventScroll: true })
    })
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (fanIndex !== null) closeFan()
      else if (!allOpen) interaction.reset()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [allOpen, fanIndex, interaction])

  const contextParts: string[] = []
  if (lastProjectId) contextParts.push(`项目 ${shortId(lastProjectId)}`)
  if (lastPlanId) contextParts.push(`规划 ${shortId(lastPlanId)}`)
  if (lastRunId) contextParts.push(`运行 ${shortId(lastRunId)}`)

  const clearContext = () => {
    const state = useUIStore.getState()
    state.setLastProjectId(null)
    state.setLastPlanId(null)
    state.setLastRunId(null)
  }

  return (
    <div className="rc-stage">
      <ReproFieldBackground />
      <div className="rc-stage__veil" aria-hidden="true" />

      <header className="rc-utility-bar">
        <div className="rc-utility-bar__brand">
          <span className="rc-utility-bar__dot" aria-hidden="true" />
          <span><strong>ReproCheck</strong><small>科研复现审计</small></span>
        </div>
        <div className="rc-utility-bar__actions">
          {onReopenGuide && (
            <button type="button" className="rc-utility-btn" onClick={onReopenGuide}>
              <Sparkles size={16} /><span>我想做什么</span>
            </button>
          )}
          <Link to="/manual" className="rc-utility-btn">
            <BookOpen size={16} /><span>中文手册</span>
          </Link>
          <PageHelpButton compact />
        </div>
      </header>

      <div
        ref={discRef}
        className="rc-disc-shell"
        data-phase={phase}
        data-leaving={leaving ? 'true' : 'false'}
        data-fan={fanIndex !== null ? 'true' : 'false'}
        role="menu"
        aria-label="主功能入口"
        onClick={(event) => {
          if (fanIndex !== null && event.target === event.currentTarget) closeFan()
        }}
      >
        <div className="rc-disc-halo" aria-hidden="true" />
        <div className="rc-disc" aria-hidden="true" />
        <div
          className="rc-track rc-track--entry"
          style={{ width: `${RING_PERCENT.entry}%`, height: `${RING_PERCENT.entry}%` }}
          aria-hidden="true"
        />

        {ENTRIES.map((entry, index) => {
          const slot = SLOTS[index]
          const isActive = activeIndex === index
          return (
            <button
              key={entry.id}
              ref={(node) => {
                entryRefs.current[index] = node
              }}
              type="button"
              role="menuitem"
              aria-label={entry.ariaLabel}
              aria-describedby={`rc-tip-${entry.id}`}
              aria-current={isActive ? 'true' : undefined}
              aria-haspopup="true"
              aria-expanded={fanIndex === index}
              tabIndex={focusIndex === index ? 0 : -1}
              className="rc-entry"
              data-index={index}
              data-angle={slot.angle}
              data-dir={slot.uy < 0 ? 'up' : 'down'}
              data-active={isActive ? 'true' : 'false'}
              data-dimmed={activeIndex !== null && !isActive ? 'true' : 'false'}
              style={{
                ...slotStyle(slot),
                opacity:
                  fanIndex !== null && !isActive ? 0.22 : isActive ? 1 : dimOpacity,
              }}
              onPointerEnter={() => {
                if (fanIndex === null) interaction.onEntryEnter(index)
              }}
              onPointerLeave={() => {
                if (fanIndex === null) interaction.onEntryLeave(index)
              }}
              onFocus={() => {
                if (fanIndex === null) interaction.onEntryFocus(index)
              }}
              onBlur={() => {
                if (fanIndex === null) interaction.onEntryBlur(index)
              }}
              onKeyDown={(event) => interaction.onEntryKeyDown(event, index)}
              onClick={() => {
                // 已展开的入口再点一次 = 收起；否则直接切换到该入口的花瓣组。
                if (fanIndex === index) {
                  closeFan()
                  return
                }
                setRipple({ index, key: Date.now() })
                interaction.commit(index)
              }}
            >
              <span className="rc-entry__bead">
                <EntryGlyph entryId={entry.id} />
              </span>
              <span id={`rc-tip-${entry.id}`} className="rc-tooltip" role="tooltip">
                {entry.name}
                <span className="rc-tooltip__count" aria-hidden="true">
                  {String(entry.features.length).padStart(2, '0')}
                </span>
              </span>
            </button>
          )
        })}

        {ripple && (
          <span
            key={ripple.key}
            className="rc-ripple"
            style={slotStyle(SLOTS[ripple.index]) as CSSProperties}
            aria-hidden="true"
          />
        )}

        <div
          className="rc-core"
          role="group"
          tabIndex={0}
          aria-label="中央操作区，按 Enter 查看操作提示"
          data-state={activeEntry ? 'active' : 'idle'}
          onPointerDown={interaction.onCorePointerDown}
          onPointerMove={interaction.onCorePointerMove}
          onPointerUp={interaction.onCorePointerUp}
          onPointerCancel={interaction.onCorePointerCancel}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              showHint(true)
            }
          }}
        >
          <span className="rc-core__brand" aria-hidden="true">
            <span className="rc-core__wordmark">ReproCheck</span>
            <span className="rc-core__brand-rule" />
          </span>

          <div className="rc-core__live" aria-live="polite">
            {activeEntry ? (
              <>
                <span className="rc-core__title">{activeEntry.title}</span>
                <span className="rc-core__desc">{activeEntry.desc}</span>
                {phase === 'S3' && <span className="rc-core__drag">松手展开</span>}
              </>
            ) : (
              <>
                <span className="rc-core__name">科研复现审计工作台</span>
                <span className="rc-core__hint">选择或拖动功能入口</span>
              </>
            )}
          </div>

          {!activeEntry && contextParts.length > 0 && (
            <div className="rc-core__context">
              <span className="rc-core__context-text">上次：{contextParts.join(' · ')}</span>
              <button type="button" className="rc-core__clear" onClick={clearContext}>
                清除
              </button>
            </div>
          )}

          <button
            type="button"
            className="rc-compact-trigger"
            onClick={() => setAllOpen(true)}
            aria-label="展开全部功能"
          >
            <Grid2X2 size={18} />
            展开全部
          </button>
        </div>

        {hintVisible && (
          <div className="rc-hint" role="status">
            <span className="rc-hint__dot" aria-hidden="true" />
            点击图标，或按住中心向方向拖动
          </div>
        )}
      </div>

      {fanIndex !== null && (
        <PetalStage
          key={ENTRIES[fanIndex].id}
          entry={ENTRIES[fanIndex]}
          onClose={closeFan}
          onLaunch={launchFromFan}
        />
      )}

      <AllFeaturesPopover open={allOpen} onClose={() => setAllOpen(false)} />
    </div>
  )
}
