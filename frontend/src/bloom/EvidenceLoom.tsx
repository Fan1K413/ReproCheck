import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  ArrowRight,
  ChevronLeft,
  CircleDot,
  Focus,
  GitBranch,
  Layers3,
  Link2,
  RefreshCw,
  X,
} from 'lucide-react'
import type { BloomUnitId, WorkbenchUnitData } from './types'
import { UNIT_ICONS } from './unitIcons'
import { UnitDetail } from './unitDetails'
import { useAtelierData } from './useAtelierData'
import type { AtelierState } from './useAtelierData'
import { useWeaveGraphFor, reachableFrom, WEAVE_KIND_LABEL } from './weave'
import type { WeaveEdge } from './weave'
import './loom.css'

type Stage = { key: string; label: string; ids: BloomUnitId[] }

/** 证据流动的六个阶段 —— 织机按这个方向排列，与绽放台的径向布局形成机制差异。 */
const STAGES: Stage[] = [
  { key: 'source', label: '材料源', ids: ['materials', 'dataset'] },
  { key: 'extract', label: '落证', ids: ['facts', 'evidence'] },
  { key: 'compose', label: '编排', ids: ['plan'] },
  { key: 'execute', label: '执行', ids: ['environment', 'runs'] },
  { key: 'verify', label: '验证', ids: ['verification'] },
  { key: 'archive', label: '归档', ids: ['report', 'team'] },
]

const STATE_LABEL: Record<AtelierState, string> = {
  ready: '就绪',
  attention: '待查',
  blocked: '阻塞',
  empty: '空',
}

const ALL_IDS: BloomUnitId[] = STAGES.flatMap((stage) => stage.ids)

const DEFAULT_ACTIVE: BloomUnitId[] = [
  'materials',
  'facts',
  'plan',
  'environment',
  'runs',
  'verification',
]

type Point = { x: number; y: number }
type NodePoint = Point & { rotate: number }

/** 固定逻辑画布：SVG viewBox 与便签定位共用这一套像素坐标，避免边与卡片错位。 */
const CANVAS_WIDTH = 1000
const CANVAS_HEIGHT = 620
const CARD_WIDTH = 158
const CARD_HEIGHT = 92

/** 预设的散落位置：保留证据流由左向右的大方向，但不用六列网格的规整排布。 */
const NODE_SPOTS: Record<BloomUnitId, NodePoint> = {
  materials: { x: 125, y: 155, rotate: -2.5 },
  dataset: { x: 120, y: 430, rotate: 3 },
  facts: { x: 325, y: 100, rotate: 3.5 },
  evidence: { x: 320, y: 330, rotate: -3 },
  plan: { x: 515, y: 205, rotate: 2 },
  environment: { x: 510, y: 500, rotate: -3.5 },
  runs: { x: 715, y: 330, rotate: 2.5 },
  verification: { x: 890, y: 155, rotate: -2 },
  report: { x: 890, y: 430, rotate: 3 },
  team: { x: 680, y: 530, rotate: -2.5 },
}

/** 兜底：未预设的 id（理论上不存在）由 hash 派生一个散落位置。 */
function hashId(id: string): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function layoutNodes(active: BloomUnitId[]): Map<BloomUnitId, NodePoint> {
  const map = new Map<BloomUnitId, NodePoint>()
  active.forEach((id) => {
    const spot = NODE_SPOTS[id]
    if (spot) {
      map.set(id, spot)
      return
    }
    const hash = hashId(id)
    map.set(id, {
      x: 115 + (hash % 760),
      y: 90 + (Math.floor(hash / 769) % 430),
      rotate: ((hash % 65) - 32) / 10,
    })
  })
  return map
}

/**
 * 求中心到中心的射线与（可能带旋转的）便签矩形边缘的交点。
 * 在便签局部坐标系里求矩形交点，再转回画布坐标，
 * 因此即使便签有 -4°~4° 旋转，边也精确落在旋转后的卡片边缘上。
 */
function edgeAnchor(center: NodePoint, toward: NodePoint, inset = 4): Point {
  const dx = toward.x - center.x
  const dy = toward.y - center.y
  if (dx === 0 && dy === 0) return { x: center.x, y: center.y }
  const angle = (center.rotate * Math.PI) / 180
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  const halfW = CARD_WIDTH / 2 + inset
  const halfH = CARD_HEIGHT / 2 + inset
  const scale = 1 / Math.max(Math.abs(lx) / halfW, Math.abs(ly) / halfH)
  const ax = lx * scale
  const ay = ly * scale
  const backCos = Math.cos(angle)
  const backSin = Math.sin(angle)
  return {
    x: center.x + ax * backCos - ay * backSin,
    y: center.y + ax * backSin + ay * backCos,
  }
}

function edgePath(a: NodePoint, b: NodePoint, key: string): string {
  const start = edgeAnchor(a, b)
  const end = edgeAnchor(b, a)
  const dx = end.x - start.x
  const dy = end.y - start.y
  const distance = Math.hypot(dx, dy)
  const hash = hashId(key)
  // 弯曲方向/幅度由边 key 稳定派生：即使两卡片几乎水平对齐，也有自然弧度。
  const bend = (hash % 2 === 0 ? 1 : -1) * (0.16 + ((hash >>> 4) % 12) / 100)
  const reach = 0.3 + ((hash >>> 8) % 12) / 100
  const lift = distance * bend * 0.45
  if (Math.abs(dx) >= Math.abs(dy)) {
    return `M ${start.x} ${start.y} C ${start.x + dx * reach} ${start.y + lift}, ${end.x - dx * reach} ${end.y + lift}, ${end.x} ${end.y}`
  }
  return `M ${start.x} ${start.y} C ${start.x + lift} ${start.y + dy * reach}, ${end.x + lift} ${end.y - dy * reach}, ${end.x} ${end.y}`
}

export function EvidenceLoom({ data }: { data: WorkbenchUnitData }) {
  const { projectId = '' } = useParams()
  const atelier = useAtelierData(projectId, data.units)
  const weave = useWeaveGraphFor(projectId)

  const [active, setActive] = useState<BloomUnitId[]>(() => {
    const fromUrl = new URLSearchParams(window.location.search)
      .get('modules')
      ?.split(',')
      .map((s) => s.trim())
      .filter((s): s is BloomUnitId => ALL_IDS.includes(s as BloomUnitId))
    return fromUrl && fromUrl.length >= 2 ? fromUrl.slice(0, 10) : DEFAULT_ACTIVE
  })
  // 默认聚焦复现运行：它处于证据链中心，入场即点亮完整上下游网络。
  const [selected, setSelected] = useState<BloomUnitId>(
    active.includes('runs') ? 'runs' : active[0],
  )
  const [inspectEdge, setInspectEdge] = useState<WeaveEdge | null>(null)
  const [focusChain, setFocusChain] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // 画布缩放：stage 层固定 1000×620 逻辑坐标，SVG 与便签共用这一坐标系，
  // 由外层实测尺寸算出统一 scale，保证边始终精确落在便签边缘。
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [canvasScale, setCanvasScale] = useState(1)
  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    const update = () => {
      const { width, height } = surface.getBoundingClientRect()
      if (width > 0 && height > 0) {
        setCanvasScale(Math.min(width / CANVAS_WIDTH, height / CANVAS_HEIGHT))
      }
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(surface)
    return () => observer.disconnect()
  }, [])

  const points = useMemo(() => layoutNodes(active), [active])
  const activeSet = useMemo(() => new Set(active), [active])

  const visibleEdges = useMemo(
    () => weave.edges.filter((e) => activeSet.has(e.from) && activeSet.has(e.to)),
    [weave.edges, activeSet],
  )

  const reachable = useMemo(
    () => reachableFrom(weave, selected, focusChain ? 1 : 2),
    [weave, selected, focusChain],
  )

  const edgeHighlighted = useCallback(
    (edge: WeaveEdge) => reachable.has(edge.from) && reachable.has(edge.to) && (edge.from === selected || edge.to === selected),
    [reachable, selected],
  )

  const selectedModule = atelier.modules.get(selected)
  const selectedUnit = selectedModule?.unit

  // 选中节点不在当前装配里时的兜底。
  useEffect(() => {
    if (!activeSet.has(selected) && active.length > 0) setSelected(active[0])
  }, [active, activeSet, selected])

  const syncUrl = useCallback((modules: BloomUnitId[], focus: BloomUnitId) => {
    const url = new URL(window.location.href)
    url.searchParams.set('view', 'loom')
    url.searchParams.set('modules', modules.join(','))
    url.searchParams.set('focus', focus)
    window.history.replaceState(window.history.state, '', url)
  }, [])

  const choose = (id: BloomUnitId) => {
    setSelected(id)
    setInspectEdge(null)
    syncUrl(active, id)
  }

  const toggle = (id: BloomUnitId) => {
    if (active.includes(id)) {
      if (active.length <= 2) return
      const next = active.filter((item) => item !== id)
      setActive(next)
      if (selected === id) setSelected(next[0])
      setInspectEdge(null)
      syncUrl(next, selected === id ? next[0] : selected)
      return
    }
    const next = [...active, id]
    setActive(next)
    setSelected(id)
    setInspectEdge(null)
    syncUrl(next, id)
  }

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    data.refresh()
    window.setTimeout(() => setRefreshing(false), 780)
  }

  const overall = atelier.quality.overall
  const chainNames = Array.from(reachable)
    .map((id) => atelier.modules.get(id)?.unit.title ?? id)
    .filter(Boolean)

  return (
    <div className="bloom-page bloom-page--loom">
      <div className="loom-shell">
        <header className="loom-topbar">
          <div className="loom-identity">
            <Link className="loom-back" to={`/projects/${projectId}/workbench`}>
              <Icon as={ChevronLeft} size={13} />
              绽放台
            </Link>
            <span className="loom-mark" aria-hidden="true"><Icon as={GitBranch} size={16} /></span>
            <div className="loom-project">
              <p>{data.project?.name ?? '复现项目'}</p>
              <span>{data.project?.paper_title ?? '证据织机 · 组合式工作空间'}</span>
            </div>
          </div>
          <nav className="loom-tabs" aria-label="工作台视图">
            <Link to={`/projects/${projectId}/workbench`}>绽放</Link>
            <Link to={`/projects/${projectId}/workbench?view=atelier`}>工坊</Link>
            <span className="is-active"><Icon as={CircleDot} size={9} /> 织机</span>
          </nav>
          <div className="loom-readout">
            <span>READINESS</span>
            <strong>{overall == null ? '—' : overall.toFixed(3)}</strong>
            <small>{weave.edges.length} 条真实关联</small>
          </div>
        </header>

        <div className="loom-body">
          <aside className="loom-library" aria-label="模块库">
            <div className="loom-library-head">
              <div>
                <p className="loom-eyebrow">MODULE BANK</p>
                <h2>可织入模块</h2>
              </div>
              <span className="loom-counter">{active.length}/10</span>
            </div>
            <p className="loom-library-intro">
              每条连线都来自真实外键引用，不是预设关系。选中节点即可点亮它的证据链路。
            </p>
            <div className="loom-library-list">
              {ALL_IDS.map((id) => {
                const module = atelier.modules.get(id)
                const unit = module?.unit ?? data.units.find((u) => u.id === id)
                if (!unit) return null
                const UnitIcon = UNIT_ICONS[id]
                const isActive = active.includes(id)
                const isSelected = selected === id
                const degree = weave.degree.get(id) ?? 0
                return (
                  <button
                    key={id}
                    type="button"
                    className={`loom-bank-row${isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
                    onClick={() => (isActive ? choose(id) : toggle(id))}
                    aria-pressed={isActive}
                  >
                    <span className="loom-bank-row__icon" aria-hidden="true"><Icon as={UnitIcon} size={13} /></span>
                    <span className="loom-bank-row__text">
                      <span className="loom-bank-row__title">{unit.title}</span>
                      <span className="loom-bank-row__meta">{degree} 条关联 · {STATE_LABEL[module?.state ?? 'empty']}</span>
                    </span>
                    <span className={`loom-bank-row__add${isActive ? ' is-on' : ''}`}>
                      {isActive ? '−' : '+'}
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>

          <section className="loom-canvas" aria-label="证据织机画布">
            <div className="loom-canvas-head">
              <div>
                <p className="loom-eyebrow">EVIDENCE LOOM · LIVE DEPENDENCY GRAPH</p>
                <h1>证据织机</h1>
              </div>
              <div className="loom-canvas-tools">
                <button
                  type="button"
                  className={`loom-tool${focusChain ? ' is-on' : ''}`}
                  onClick={() => setFocusChain((v) => !v)}
                  title="仅显示直接上下游"
                  aria-pressed={focusChain}
                >
                  <Icon as={Focus} size={13} />
                  {focusChain ? '仅直接链路' : '全链路'}
                </button>
                <button type="button" className="loom-tool" onClick={handleRefresh} disabled={refreshing}>
                  <Icon as={RefreshCw} size={13} />
                  {refreshing ? '同步中' : '刷新'}
                </button>
              </div>
            </div>

            <div className="loom-stages" aria-hidden="true">
              {STAGES.map((stage) => {
                const count = stage.ids.filter((id) => activeSet.has(id)).length
                return (
                  <span key={stage.key} className={count ? 'is-on' : ''}>
                    {stage.label}{count ? ` ${count}` : ''}
                  </span>
                )
              })}
              <Icon as={ArrowRight} size={12} />
            </div>

            <div className="loom-graph">
              <div className="loom-canvas-surface" ref={surfaceRef}>
              <div
                className="loom-stage"
                style={{
                  width: CANVAS_WIDTH,
                  height: CANVAS_HEIGHT,
                  transform: `scale(${canvasScale})`,
                }}
              >
              <svg
                className="loom-edges"
                viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {visibleEdges.map((edge) => {
                  const a = points.get(edge.from)
                  const b = points.get(edge.to)
                  if (!a || !b) return null
                  const hot = edgeHighlighted(edge)
                  const dim = !reachable.has(edge.from) || !reachable.has(edge.to)
                  const width = Math.min(2.8, 0.7 + edge.count * 0.24) * (hot ? 1.5 : 1)
                  const opacity = hot ? 0.95 : dim ? 0.12 : 0.4
                  return (
                    <path
                      key={edge.key}
                      d={edgePath(a, b, edge.key)}
                      className={`loom-edge loom-edge--${edge.kind}${hot ? ' is-hot' : ''}${dim ? ' is-dim' : ''}`}
                      style={{ strokeWidth: width, opacity }}
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
              </svg>

              {active.map((id) => {
                const module = atelier.modules.get(id)
                const unit = module?.unit ?? data.units.find((u) => u.id === id)
                const point = points.get(id)
                if (!unit || !point) return null
                const UnitIcon = UNIT_ICONS[id]
                const lit = reachable.has(id)
                const isSelected = selected === id
                const degree = weave.degree.get(id) ?? 0
                return (
                  <button
                    key={id}
                    type="button"
                    className={`loom-node${lit ? ' is-lit' : ' is-dim'}${isSelected ? ' is-selected' : ''} state-${module?.state ?? 'empty'}`}
                    style={{
                      left: point.x,
                      top: point.y,
                      width: CARD_WIDTH,
                      minHeight: CARD_HEIGHT,
                      '--degree': degree,
                      '--loom-rotate': `${point.rotate}deg`,
                    } as CSSProperties}
                    onClick={() => choose(id)}
                    aria-label={`聚焦 ${unit.title}`}
                  >
                    <span className="loom-node__pin" aria-hidden="true" />
                    <span className="loom-node__head">
                      <span className="loom-node__icon" aria-hidden="true"><Icon as={UnitIcon} size={14} /></span>
                      <span className="loom-node__state">{STATE_LABEL[module?.state ?? 'empty']}</span>
                    </span>
                    <span className="loom-node__title">{unit.title}</span>
                    <span className="loom-node__metric">{unit.metric} <small>{unit.metricLabel}</small></span>
                    {degree > 0 && <span className="loom-node__degree">{degree} 链</span>}
                  </button>
                )
              })}
              </div>
              </div>
            </div>

            <div className="loom-chainbar">
              <span className="loom-chainbar__label"><Icon as={Layers3} size={12} /> 当前链路</span>
              <div className="loom-chainbar__nodes">
                {chainNames.map((name, i) => (
                  <span key={`${name}-${i}`}>
                    {i > 0 && <Icon as={ArrowRight} size={11} />}
                    {name}
                  </span>
                ))}
              </div>
            </div>

            {inspectEdge && (
              <div className="loom-edge-drawer" role="region" aria-label="关联明细">
                <div className="loom-edge-drawer__head">
                  <div>
                    <span className="loom-eyebrow">{WEAVE_KIND_LABEL[inspectEdge.kind]} · {inspectEdge.count} 条真实记录</span>
                    <strong>{inspectEdge.label}</strong>
                  </div>
                  <button type="button" onClick={() => setInspectEdge(null)} aria-label="关闭明细"><Icon as={X} size={15} /></button>
                </div>
                <ul>
                  {inspectEdge.evidence.map((item) => (
                    <li key={item.id}>
                      <Icon as={Link2} size={11} />
                      <span>{item.label}</span>
                      <code>{item.id.slice(0, 18)}</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="loom-edge-index" aria-label="关联索引">
              {visibleEdges.length === 0 ? (
                <span className="loom-edge-empty">当前装配暂无真实关联，试试加入规划、运行或环境模块。</span>
              ) : (
                visibleEdges.map((edge) => {
                  const a = atelier.modules.get(edge.from)?.unit.title ?? edge.from
                  const b = atelier.modules.get(edge.to)?.unit.title ?? edge.to
                  const hot = edgeHighlighted(edge)
                  return (
                    <button
                      key={edge.key}
                      type="button"
                      className={`loom-edge-chip${hot ? ' is-hot' : ''}`}
                      onClick={() => setInspectEdge(edge)}
                      title={edge.label}
                    >
                      <span className={`loom-kind loom-kind--${edge.kind}`} />
                      {a} <Icon as={ArrowRight} size={10} /> {b}
                      <small>×{edge.count}</small>
                    </button>
                  )
                })
              )}
            </div>
          </section>

          <aside className="loom-detail" aria-label="模块详情">
            {selectedModule && selectedUnit ? (
              <>
                <div className="loom-detail-head">
                  <div>
                    <p className="loom-eyebrow">FOCUSED UNIT</p>
                    <h2>{selectedUnit.title}</h2>
                    <span className={`loom-detail-state state-${selectedModule.state}`}>
                      {STATE_LABEL[selectedModule.state]} · {selectedModule.note}
                    </span>
                  </div>
                  <Link
                    className="loom-detail-open"
                    to={selectedUnit.links[0]?.to ?? `/projects/${projectId}/overview`}
                    title="在标准视图打开"
                  >
                    <Icon as={ArrowRight} size={14} />
                  </Link>
                </div>
                <div className="loom-detail-scroll">
                  <UnitDetail unitId={selectedModule.id} projectId={projectId} />

                  <div className="loom-rel" aria-label="此模块的真实关联">
                    <div className="loom-rel__head"><Icon as={Link2} size={12} /> 此模块的链路</div>
                    {(weave.adjacency.get(selected) ?? []).length === 0 ? (
                      <p className="loom-rel__empty">该模块在当前项目中没有可派生的外键关联。</p>
                    ) : (
                      <ul>
                        {(weave.adjacency.get(selected) ?? []).map((edge) => {
                          const other = edge.from === selected ? edge.to : edge.from
                          const otherTitle = atelier.modules.get(other)?.unit.title ?? other
                          return (
                            <li key={edge.key}>
                              <button type="button" onClick={() => setInspectEdge(edge)}>
                                <span className={`loom-kind loom-kind--${edge.kind}`} />
                                <span className="loom-rel__dir">{edge.to === selected ? '←' : '→'}</span>
                                <span className="loom-rel__title">{otherTitle}</span>
                                <small>{WEAVE_KIND_LABEL[edge.kind]} ×{edge.count}</small>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="loom-detail-empty"><Icon as={GitBranch} size={22} /> 从左侧选择一个模块开始。</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
