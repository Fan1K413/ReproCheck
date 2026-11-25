import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../components/Icon'
import {
  ArrowUpRight,
  ChevronLeft,
  CircleDot,
  Maximize2,
  Minus,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Workflow,
  X,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import type { BloomUnitId, WorkbenchUnitData } from './types'
import { MORPH_META, morphOf } from './morphs'
import { UNIT_ICONS } from './unitIcons'
import { UnitDetail } from './unitDetails'
import { useAtelierData } from './useAtelierData'
import type { AtelierModule, AtelierState } from './useAtelierData'
import './atelier.css'

const ALL_IDS: BloomUnitId[] = [
  'materials',
  'dataset',
  'facts',
  'evidence',
  'plan',
  'environment',
  'runs',
  'verification',
  'report',
  'team',
]

const DEFAULT_MODULES: BloomUnitId[] = [
  'materials',
  'dataset',
  'environment',
  'runs',
  'verification',
]

const STATE_LABEL: Record<AtelierState, string> = {
  ready: 'READY',
  attention: 'CHECK',
  blocked: 'BLOCKED',
  empty: 'EMPTY',
}

const PAIR_RELATIONS: Array<[BloomUnitId, BloomUnitId, string]> = [
  ['materials', 'dataset', '抽取数据契约'],
  ['dataset', 'environment', '挂载运行'],
  ['environment', 'runs', '启动实验'],
  ['runs', 'verification', '产出指标'],
  ['verification', 'report', '写入结论'],
  ['materials', 'plan', '生成任务'],
  ['plan', 'runs', '执行顺序'],
  ['facts', 'evidence', '逐条落证'],
  ['report', 'team', '人工签认'],
]

type Point = { x: number; y: number }

type Edge = {
  key: string
  from: BloomUnitId
  to: BloomUnitId
  d: string
  label: string
  labelPoint: Point
}

function isUnitId(value: string | null | undefined): value is BloomUnitId {
  return Boolean(value) && ALL_IDS.includes(value as BloomUnitId)
}

function radialPoints(ids: BloomUnitId[]): Map<BloomUnitId, Point> {
  const map = new Map<BloomUnitId, Point>()
  if (ids.length === 2) {
    map.set(ids[0], { x: 27, y: 50 })
    map.set(ids[1], { x: 73, y: 50 })
    return map
  }
  const start = -90
  ids.forEach((id, index) => {
    const angle = (start + (360 / ids.length) * index) * (Math.PI / 180)
    map.set(id, { x: 50 + Math.cos(angle) * 34, y: 50 + Math.sin(angle) * 32 })
  })
  return map
}

function curveBetween(
  from: BloomUnitId,
  to: BloomUnitId,
  points: Map<BloomUnitId, Point>,
  label: string,
): Edge | null {
  const a = points.get(from)
  const b = points.get(to)
  if (!a || !b) return null
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  let nx = -dy / length
  let ny = dx / length
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  if ((mid.x - 50) * nx + (mid.y - 50) * ny < 0) {
    nx = -nx
    ny = -ny
  }
  const bend = 11
  const c1 = { x: a.x + dx * 0.32 + nx * bend, y: a.y + dy * 0.32 + ny * bend }
  const c2 = { x: b.x - dx * 0.32 + nx * bend, y: b.y - dy * 0.32 + ny * bend }
  return {
    key: `${from}-${to}`,
    from,
    to,
    d: `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} C ${c1.x.toFixed(2)} ${c1.y.toFixed(
      2,
    )}, ${c2.x.toFixed(2)} ${c2.y.toFixed(2)}, ${b.x.toFixed(2)} ${b.y.toFixed(2)}`,
    label,
    labelPoint: { x: mid.x + nx * (bend / 2), y: mid.y + ny * (bend / 2) },
  }
}

function syncUrl(modules: BloomUnitId[], selected: BloomUnitId | null) {
  const url = new URL(window.location.href)
  url.searchParams.set('view', 'atelier')
  url.searchParams.set('modules', modules.join(','))
  if (selected) url.searchParams.set('focus', selected)
  else url.searchParams.delete('focus')
  window.history.replaceState(window.history.state, '', url)
}

export function BloomAtelier({ projectId, data }: { projectId: string; data: WorkbenchUnitData }) {
  const queryClient = useQueryClient()
  const searchParams = useSearchParamsSafe()
  const focus = searchParams.get('focus')
  const moduleParam = searchParams.get('modules')

  const initial = useMemo(() => {
    const fromUrl = (moduleParam ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(isUnitId)
    const base = fromUrl.length >= 2 ? Array.from(new Set(fromUrl)).slice(0, 6) : [...DEFAULT_MODULES]
    if (isUnitId(focus) && !base.includes(focus)) {
      if (base.length >= 6) base.splice(base.length - 1, 1)
      base.push(focus)
    }
    return { modules: base, selected: isUnitId(focus) && base.includes(focus) ? focus : base[0] }
    // 只在进入工坊时读取一次 URL，后续由本地状态写回。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [active, setActive] = useState<BloomUnitId[]>(initial.modules)
  const [selected, setSelected] = useState<BloomUnitId>(initial.selected)
  const [detailOpen, setDetailOpen] = useState(Boolean(focus))
  const [refreshing, setRefreshing] = useState(false)

  const atelier = useAtelierData(projectId, data.units)

  const activeModules = useMemo(
    () =>
      active
        .map((id) => atelier.modules.get(id))
        .filter((module): module is AtelierModule => Boolean(module)),
    [active, atelier.modules],
  )

  const points = useMemo(() => radialPoints(active), [active])

  const edges = useMemo(() => {
    const list: Edge[] = []
    PAIR_RELATIONS.forEach(([from, to, label]) => {
      if (!points.has(from) || !points.has(to)) return
      const edge = curveBetween(from, to, points, label)
      if (edge) list.push(edge)
    })
    return list
  }, [points])

  const selectedModule = atelier.modules.get(selected) ?? activeModules[0]
  const selectedUnit = selectedModule?.unit

  const commit = useCallback(
    (modules: BloomUnitId[], nextSelected: BloomUnitId | null) => {
      syncUrl(modules, nextSelected)
    },
    [],
  )

  const choose = (id: BloomUnitId) => {
    setSelected(id)
    setDetailOpen(true)
    commit(active, id)
  }

  const toggle = (id: BloomUnitId) => {
    if (active.includes(id)) {
      if (active.length <= 2) return
      const next = active.filter((item) => item !== id)
      setActive(next)
      const nextSelected = selected === id ? next[0] : selected
      setSelected(nextSelected)
      if (selected === id) setDetailOpen(false)
      commit(next, nextSelected)
      return
    }
    if (active.length >= 6) return
    const next = [...active, id]
    setActive(next)
    setSelected(id)
    setDetailOpen(true)
    commit(next, id)
  }

  const removeSelected = () => {
    if (!selectedModule || active.length <= 2) return
    toggle(selectedModule.id)
  }

  const handleRefresh = () => {
    if (refreshing) return
    setRefreshing(true)
    data.refresh()
    void queryClient.invalidateQueries()
    window.setTimeout(() => setRefreshing(false), 780)
  }

  const enterNode = (id: BloomUnitId) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(id)
    }
  }

  const overall = atelier.quality.overall
  const readyCount = activeModules.filter((module) => module.state === 'ready').length
  const gaps = activeModules
    .flatMap((module) =>
      module.blockers.map((blocker) => ({
        id: module.id,
        title: module.unit.title,
        blocker,
        state: module.state,
      })),
    )
    .slice(0, 4)

  return (
    <div className="bloom-page bloom-page--atelier">
      <div className="bloom-shell bloom-atelier">
        <div className="bloom-atelier__grid" aria-hidden="true" />

        <header className="bloom-atelier__topbar">
          <div className="bloom-atelier__identity">
            <Link className="bloom-atelier__back" to={`/projects/${projectId}/workbench`}>
              <Icon as={ChevronLeft} size={13} />
              绽放台
            </Link>
            <span className="bloom-atelier__mark" aria-hidden="true">
              <Icon as={Workflow} size={16} />
            </span>
            <div className="bloom-atelier__project">
              <p>{data.project?.name ?? '复现项目'}</p>
              <span>{data.project?.paper_title ?? '复现审计工作区'}</span>
            </div>
          </div>

          <nav className="bloom-atelier__tabs" aria-label="工作台视图">
            <Link to={`/projects/${projectId}/workbench`}>绽放</Link>
            <span className="is-active">
              <Icon as={CircleDot} size={9} />
              工坊
            </span>
            <Link to={`/projects/${projectId}/workbench?view=loom`}>证据织机</Link>
          </nav>

          <div className="bloom-atelier__readout">
            <span className="bloom-atelier__readout-label">READINESS</span>
            <strong>{overall == null ? '—' : overall.toFixed(3)}</strong>
            <span className="bloom-atelier__readout-meta">
              {readyCount}/{activeModules.length} 就绪 · {activeModules.length}/6 模块
            </span>
          </div>
        </header>

        <div className={`bloom-atelier__body${detailOpen ? ' is-detail-open' : ''}`}>
          <aside className="bloom-atelier__library" aria-label="模块库">
            <div className="bloom-atelier__library-head">
              <div>
                <p className="bloom-atelier__eyebrow">MODULE LIBRARY</p>
                <h2>可选模块</h2>
              </div>
              <span className="bloom-atelier__counter">{active.length}/6</span>
            </div>

            <div className="bloom-atelier__library-list">
              {ALL_IDS.map((id) => {
                const module = atelier.modules.get(id)
                const unit = module?.unit ?? data.units.find((item) => item.id === id)
                if (!unit) return null
                const UnitIcon = UNIT_ICONS[id]
                const isActive = active.includes(id)
                const isSelected = selected === id
                const morph = morphOf(id)
                return (
                  <button
                    key={id}
                    type="button"
                    className={`bloom-library-row${isActive ? ' is-active' : ''}${
                      isSelected ? ' is-selected' : ''
                    }`}
                    onClick={() => (isActive ? choose(id) : toggle(id))}
                    aria-pressed={isActive}
                    title={isActive ? `查看 ${unit.title}` : `加入工坊：${unit.title}`}
                  >
                    <span className="bloom-library-row__index">
                      {String(unit.order + 1).padStart(2, '0')}
                    </span>
                    <span className="bloom-library-row__icon" aria-hidden="true">
                      <Icon as={UnitIcon} size={13} />
                    </span>
                    <span className="bloom-library-row__text">
                      <span className="bloom-library-row__title">{unit.title}</span>
                      <span className="bloom-library-row__meta">
                        {MORPH_META[morph].cn} · {module?.note ?? unit.status}
                      </span>
                    </span>
                    <span className={`bloom-library-row__dot tone-${module?.state ?? 'empty'}`}>
                      {isActive ? <Icon as={Minus} size={10} /> : <Icon as={Plus} size={10} />}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="bloom-atelier__library-foot">
              <Icon as={SlidersHorizontal} size={12} />
              以 2–6 个模块装配同一张复现工作台；移除模块不会删除任何后端数据。
            </div>
          </aside>

          <section className="bloom-atelier__canvas" aria-label="复现工作区">
            <div className="bloom-atelier__canvas-head">
              <div>
                <p className="bloom-atelier__eyebrow">WORKSPACE · LIVE GRAPH</p>
                <h1>复现工坊</h1>
              </div>
              <p className="bloom-atelier__canvas-hint">
                <Icon as={Maximize2} size={11} />
                节点展示真实单元状态，点击进入右侧详情
              </p>
            </div>

            <div className="bloom-atelier__tray" aria-label="移动端模块库">
              {ALL_IDS.map((id) => {
                const unit = data.units.find((item) => item.id === id)
                if (!unit) return null
                return (
                  <button
                    key={id}
                    type="button"
                    className={active.includes(id) ? 'is-active' : ''}
                    onClick={() => (active.includes(id) ? choose(id) : toggle(id))}
                  >
                    {unit.title}
                  </button>
                )
              })}
            </div>

            <div className="bloom-atelier__graph">
              <svg
                className="bloom-atelier__edges"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                
                {active.map((id) => {
                  const point = points.get(id)
                  if (!point) return null
                  return (
                    <line
                      key={`hub-${id}`}
                      x1={point.x}
                      y1={point.y}
                      x2={50}
                      y2={50}
                      className="atelier-edge atelier-edge--hub"
                      vectorEffect="non-scaling-stroke"
                    />
                  )
                })}
                {edges.map((edge) => (
                  <path
                    key={edge.key}
                    d={edge.d}
                    className="atelier-edge atelier-edge--pair"
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
              </svg>

              {edges.map((edge) => (
                <span
                  key={`label-${edge.key}`}
                  className="bloom-atelier__edge-label"
                  style={{ left: `${edge.labelPoint.x}%`, top: `${edge.labelPoint.y}%` }}
                >
                  {edge.label}
                </span>
              ))}

              <div className="bloom-atelier__hub">
                <span className="bloom-atelier__hub-kicker">PROJECT HUB · 01</span>
                <strong>{data.project?.name ?? '复现项目'}</strong>
                <span className="bloom-atelier__hub-paper">
                  {data.project?.paper_title ?? '复现审计工作区'}
                </span>
                <span className="bloom-atelier__hub-score">
                  {overall == null ? '—' : overall.toFixed(3)}
                  <small>覆盖分</small>
                </span>
                <span className="bloom-atelier__hub-meta">
                  {activeModules.length} 个模块 · {readyCount} 个就绪 · 实时接口
                </span>
              </div>

              {activeModules.map((module, index) => {
                const UnitIcon = UNIT_ICONS[module.id]
                const point = points.get(module.id)
                const morph = morphOf(module.id)
                const morphShort =
                  morph === 'instrument' ? 'INST' : morph === 'lattice' ? 'LATT' : 'FOL'
                if (!point) return null
                return (
                  <button
                    key={module.id}
                    type="button"
                    className={`bloom-atelier-node state-${module.state} bloom-atelier-node--${morph}${
                      selected === module.id ? ' is-selected' : ''
                    }`}
                    style={
                      {
                        left: `${point.x}%`,
                        top: `${point.y}%`,
                        '--node-index': index,
                      } as CSSProperties
                    }
                    onClick={() => choose(module.id)}
                    onKeyDown={enterNode(module.id)}
                    aria-label={`打开 ${module.unit.title} 工作区`}
                  >
                    <span className="bloom-atelier-node__top">
                      <span className="bloom-atelier-node__icon" aria-hidden="true">
                        <Icon as={UnitIcon} size={14} />
                      </span>
                      <span className="bloom-atelier-node__code">
                        {String(module.unit.order + 1).padStart(2, '0')} / {morphShort}
                      </span>
                      <span className={`bloom-atelier-node__state state-${module.state}`}>
                        {STATE_LABEL[module.state]}
                      </span>
                    </span>
                    <span className="bloom-atelier-node__title">{module.unit.title}</span>
                    <span className="bloom-atelier-node__metric">
                      {module.unit.metric}
                      <small>{module.unit.metricLabel}</small>
                    </span>
                    <span className="bloom-atelier-node__role">{module.role}</span>
                    <span className="bloom-atelier-node__note">
                      {module.blockers[0] ?? module.note}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="bloom-atelier__stack" aria-label="工作区模块列表">
              {activeModules.map((module) => (
                <button
                  key={module.id}
                  type="button"
                  className={selected === module.id ? 'is-selected' : ''}
                  onClick={() => choose(module.id)}
                >
                  <span className={`bloom-atelier-node__state state-${module.state}`}>
                    {STATE_LABEL[module.state]}
                  </span>
                  <span className="bloom-atelier__stack-title">{module.unit.title}</span>
                  <span className="bloom-atelier__stack-note">
                    {module.blockers[0] ?? module.note}
                  </span>
                  <span className="bloom-atelier__stack-metric">{module.unit.metric}</span>
                </button>
              ))}
            </div>

            <div className="bloom-atelier__gaps">
              <div className="bloom-atelier__gaps-head">
                <span>装配缺口 · GAP REGISTER</span>
                <strong>{gaps.length}</strong>
              </div>
              {gaps.length ? (
                <ul>
                  {gaps.map((gap) => (
                    <li key={`${gap.id}-${gap.blocker}`}>
                      <span className={`state-${gap.state}`} aria-hidden="true" />
                      <span className="bloom-atelier__gaps-title">{gap.title}</span>
                      <span className="bloom-atelier__gaps-note">{gap.blocker}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="bloom-atelier__gaps-empty">当前装配未发现阻塞项。</p>
              )}
              <div className="bloom-atelier__gaps-next">
                <span>建议下一步</span>
                <p>
                  {atelier.summary.missingEnv.length
                    ? `补齐环境缺失项 ${atelier.summary.missingEnv.join('、')}，再执行一次可复现运行。`
                    : atelier.summary.failedRuns
                      ? '打开复现运行，查看失败诊断与资源占用。'
                      : atelier.summary.pendingTasks
                        ? '在复现规划中完成待人工确认的任务。'
                        : '当前工作区已具备最小复现闭环。'}
                </p>
              </div>
              <p className="bloom-atelier__gaps-rule">
                工坊只并置模块，不合并业务对象，不改变权限；移除模块不会删除任何后端数据。
              </p>
            </div>

            <footer className="bloom-atelier__bench">
              <div className="bloom-atelier__bench-score">
                <span>READINESS</span>
                <strong>{overall == null ? '—' : overall.toFixed(3)}</strong>
                <small title={atelier.quality.note}>平台评分 · 非学术质量判定</small>
              </div>
              <div className="bloom-atelier__bench-bars">
                {atelier.quality.bars
                  .filter((bar) =>
                    [
                      'material_completeness',
                      'environment_consistency',
                      'code_executability',
                      'run_success',
                      'result_comparability',
                    ].includes(bar.key),
                  )
                  .map((bar) => (
                    <span key={bar.key} className="bloom-atelier-bar" title={bar.basis}>
                      <span className="bloom-atelier-bar__label">{bar.label}</span>
                      <span className="bloom-atelier-bar__track">
                        <span style={{ width: `${Math.round(bar.score * 100)}%` }} />
                      </span>
                      <span className="bloom-atelier-bar__value">{bar.score.toFixed(2)}</span>
                    </span>
                  ))}
              </div>
              <div className="bloom-atelier__signals">
                <span className={atelier.summary.missingEnv.length ? 'is-warn' : ''}>
                  环境缺失 {atelier.summary.missingEnv.length}
                </span>
                <span className={atelier.summary.failedRuns ? 'is-warn' : ''}>
                  失败运行 {atelier.summary.failedRuns}
                </span>
                <span>
                  事实证据 {atelier.summary.factsWithEvidence}/{atelier.summary.factsTotal}
                </span>
              </div>
              <button
                type="button"
                className="bloom-atelier__refresh"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <Icon as={RefreshCw} size={12} />
                {refreshing ? '同步中' : '刷新'}
              </button>
            </footer>
          </section>

          <aside
            className="bloom-atelier__detail"
            data-morph={selectedModule ? morphOf(selectedModule.id) : undefined}
            aria-label={selectedUnit ? `${selectedUnit.title}详情` : '模块详情'}
          >
            {selectedModule && selectedUnit ? (
              <>
                <div className="bloom-atelier__detail-head">
                  <div>
                    <p className="bloom-atelier__eyebrow">
                      {String(selectedUnit.order + 1).padStart(2, '0')} · {MORPH_META[morphOf(selectedModule.id)].label}
                    </p>
                    <h2>{selectedUnit.title}</h2>
                    <span className={`bloom-atelier__detail-state state-${selectedModule.state}`}>
                      {STATE_LABEL[selectedModule.state]} · {selectedModule.note}
                    </span>
                  </div>
                  <div className="bloom-atelier__detail-tools">
                    <button
                      type="button"
                      className="bloom-atelier__detail-close"
                      onClick={() => setDetailOpen(false)}
                      aria-label="关闭详情"
                      title="关闭详情"
                    >
                      <Icon as={X} size={15} />
                    </button>
                    <Link
                      className="bloom-atelier__detail-open"
                      to={
                        selectedUnit.links[0]?.to ??
                        `/projects/${projectId}/overview`
                      }
                      title={`在标准视图打开 ${selectedUnit.links[0]?.label ?? ''}`}
                    >
                      <Icon as={ArrowUpRight} size={14} />
                    </Link>
                  </div>
                </div>

                <div className="bloom-atelier__detail-metrics">
                  {selectedModule.metrics.map((metric) => (
                    <span key={metric.label}>
                      <small>{metric.label}</small>
                      <strong>{metric.value}</strong>
                    </span>
                  ))}
                  <span>
                    <small>状态</small>
                    <strong>{STATE_LABEL[selectedModule.state]}</strong>
                  </span>
                </div>

                {selectedModule.blockers.length > 0 && (
                  <div className="bloom-atelier__blockers">
                    <span>待处理</span>
                    <ul>
                      {selectedModule.blockers.map((blocker) => (
                        <li key={blocker}>{blocker}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="bloom-atelier__detail-scroll">
                  <UnitDetail unitId={selectedModule.id} projectId={projectId} />

                  <section className="bloom-atelier__context" aria-label="当前工坊的其它模块">
                    <div className="bloom-atelier__context-head">
                      <span>IN THIS WORKSPACE · 装配上下文</span>
                      <strong>{activeModules.length - 1}</strong>
                    </div>
                    <ul>
                      {activeModules
                        .filter((module) => module.id !== selectedModule.id)
                        .map((module) => (
                          <li key={module.id}>
                            <button type="button" onClick={() => choose(module.id)}>
                              <span
                                className={`bloom-atelier__context-dot state-${module.state}`}
                                aria-hidden="true"
                              />
                              <span>{module.unit.title}</span>
                              <small>{STATE_LABEL[module.state]}</small>
                              <span className="bloom-atelier__context-metric">
                                {module.unit.metric}
                              </span>
                            </button>
                          </li>
                        ))}
                    </ul>
                  </section>
                </div>

                <div className="bloom-atelier__detail-foot">
                  <button
                    type="button"
                    className="bloom-atelier__remove"
                    onClick={removeSelected}
                    disabled={active.length <= 2}
                    title={active.length <= 2 ? '工坊至少保留两个模块' : '从工坊移除，不删除数据'}
                  >
                    <Icon as={Minus} size={12} />
                    移出工坊
                  </button>
                  <Link
                    className="bloom-atelier__jump"
                    to={`/projects/${projectId}/workbench?focus=${selectedModule.id}`}
                  >
                    在绽放台展开
                    <Icon as={ArrowUpRight} size={12} />
                  </Link>
                </div>
              </>
            ) : (
              <div className="bloom-atelier__detail-empty">
                <Icon as={Workflow} size={22} />
                从左侧模块库选择模块。
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

/** 从 useSearchParams 拆出的安全读取：工坊只读初始参数，避免状态回环。 */
function useSearchParamsSafe() {
  // 延迟 import 会造成首帧空白；这里直接依赖 URLSearchParams。
  return new URLSearchParams(window.location.search)
}
