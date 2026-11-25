import { useQuery } from '@tanstack/react-query'
import {
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  GitCompare,
  Info,
  Scale,
  X,
} from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { StatusBadge } from '../../components/StatusBadge'
import {
  conditionLabel,
  orderedConditionKeys,
  verdictLabel,
  verdictTone,
} from '../../features/reproductionMeta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError } from '../../services/api'
import { reproductionApi } from '../../services/reproductionApi'
import type { ComparisonView, QualityDimension } from '../../types/reproduction'
import '../../styles/wave-a-repro.css'

function formatNumber(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)
}

/** 指标数字 200ms 计数过渡；prefers-reduced-motion 下直接到值。 */
function useCountUp(value: number | null, duration = 200): string {
  const [display, setDisplay] = useState<number | null>(value)
  const fromRef = useRef<number | null>(value)

  useEffect(() => {
    if (value == null) {
      setDisplay(null)
      fromRef.current = null
      return
    }
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = fromRef.current ?? value
    if (reduce || from === value) {
      setDisplay(value)
      fromRef.current = value
      return
    }
    const start = performance.now()
    let frame = 0
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (value - from) * eased)
      if (t < 1) {
        frame = window.requestAnimationFrame(step)
      } else {
        fromRef.current = value
      }
    }
    frame = window.requestAnimationFrame(step)
    return () => window.cancelAnimationFrame(frame)
  }, [value, duration])

  return display == null ? '—' : formatNumber(display)
}

function ConditionValue({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-success)' }}>
        <Icon as={Check} size="xs" tone="success" />
        是
      </span>
    )
  }
  if (value === false) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-danger)' }}>
        <Icon as={X} size="xs" tone="danger" />
        否
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
      <Icon as={CircleHelp} size="xs" tone="subtle" />
      未记录
    </span>
  )
}

function QualityCard({ dimension }: { dimension: QualityDimension }) {
  const max = dimension.max > 0 ? dimension.max : 1
  const ratio = Math.min(1, Math.max(0, dimension.score / max))
  return (
    <div className="rc-wa-panel" style={{ backgroundColor: 'var(--rc-surface-3)' }}>
      <div className="rc-wa-panel__body rc-wa-panel__body--tight" style={{ display: 'grid', gap: 'var(--rc-space-3)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--rc-space-2)' }}>
          <span style={{ fontSize: 'var(--rc-fs-h3)', fontWeight: 'var(--rc-fw-sb)' }}>
            {dimension.label || dimension.key}
          </span>
          <span className="mono" style={{ fontSize: 'var(--rc-fs-mono)', color: 'var(--rc-text-muted)' }}>
            {dimension.score} / {dimension.max}
          </span>
        </div>
        <div className="rc-wa-meter">
          <div
            className="rc-wa-meter__fill"
            data-tone={ratio >= 0.8 ? 'accent' : ratio >= 0.5 ? 'warning' : 'danger'}
            style={{ transform: `scaleX(${ratio})` }}
          />
        </div>
        <p className="rc-wa-kpi__hint">{dimension.basis || '后端未提供评分依据。'}</p>
        {(dimension.missing ?? []).length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }}>
            {dimension.missing.map((item, index) => (
              <StatusBadge key={`${item}-${index}`} tone="warning" dot={false}>
                {item}
              </StatusBadge>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default function ReproductionComparisonPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [activeMetric, setActiveMetric] = useState<string | null>(null)
  const [activeComparisonId, setActiveComparisonId] = useState<string | null>(null)
  const [entering, setEntering] = useState(false)

  const comparisonQuery = useQuery({
    queryKey: ['repro-comparisons', pid],
    queryFn: () => reproductionApi.listComparisons(pid),
    enabled: !!pid,
  })
  const qualityQuery = useQuery({
    queryKey: ['repro-quality', pid],
    queryFn: () => reproductionApi.getQuality(pid),
    enabled: !!pid,
    retry: false,
  })

  const comparisons = useMemo(() => comparisonQuery.data?.items ?? [], [comparisonQuery.data])

  const metricNames = useMemo(() => {
    const names: string[] = []
    comparisons.forEach((item) => {
      if (!names.includes(item.metric_name)) names.push(item.metric_name)
    })
    return names
  }, [comparisons])

  useEffect(() => {
    if (activeMetric) return
    // 默认聚焦第一条「论文值与复现值俱全」的对照，避免首屏落在数据不足项上。
    const preferred = comparisons.find((item) => item.paper_value != null && item.reproduced_value != null)
    const next = preferred?.metric_name ?? comparisons[0]?.metric_name
    if (next) setActiveMetric(next)
  }, [comparisons, activeMetric])

  const candidates = useMemo(
    () => comparisons.filter((item) => item.metric_name === activeMetric),
    [comparisons, activeMetric],
  )

  useEffect(() => {
    if (!activeComparisonId && candidates.length > 0) setActiveComparisonId(candidates[0].comparison_id)
  }, [candidates, activeComparisonId])

  useEffect(() => {
    if (!activeComparisonId) return
    setEntering(true)
    const timer = window.setTimeout(() => setEntering(false), 420)
    return () => window.clearTimeout(timer)
  }, [activeComparisonId])

  const active = comparisons.find((item) => item.comparison_id === activeComparisonId) ?? null

  /* 差异条长度 ∝ 真实 diff_relative（全局同尺度，便于横向比较） */
  const maxAbsDiff = Math.max(
    0.000001,
    ...comparisons.map((item) => Math.abs(item.diff_relative ?? 0)),
  )

  const reproducedText = useCountUp(active?.reproduced_value ?? null)

  if (comparisonQuery.isPending) {
    return <LoadingState message="正在读取指标对照…" hint="正在读取后端指标对照" />
  }
  if (comparisonQuery.isError) {
    return (
      <ErrorState
        message={comparisonQuery.error instanceof Error ? comparisonQuery.error.message : '无法获取指标对照。'}
        code={comparisonQuery.error instanceof ApiError ? comparisonQuery.error.code : undefined}
        onRetry={() => void comparisonQuery.refetch()}
      />
    )
  }

  return (
    <div className="rc-wa-page">
      <header className="rc-wa-head">
        <div className="rc-wa-head__text">
          <p className="rc-wa-eyebrow">结果对照</p>
          <h1 className="rc-wa-title">结果对照与质量评估</h1>
          <p className="rc-wa-lede">
            论文值与复现值均来自后端，判定由后端规则给出；切换方案时透视卡 400ms 滑入，差异条长度 ∝ 真实 diff_relative。
          </p>
        </div>
        <div className="rc-wa-head__actions">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">
            返回总览
          </Link>
          <Link to={`/projects/${pid}/reproduction/reports`} className="btn-ghost">
            报告中心
          </Link>
        </div>
      </header>

      {comparisons.length === 0 ? (
        <section className="rc-wa-panel">
          <div className="rc-wa-panel__body">
            <EmptyState
              icon={GitCompare}
              title="暂无指标对照"
              description="后端未返回该项目的指标对照数据。"
            />
          </div>
        </section>
      ) : (
        <>
          {/* 顶部 2 列对照选择器 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={GitCompare} size="sm" tone="accent" />
                对照选择器
              </div>
              <span className="rc-wa-source">指标对照 · {comparisonQuery.data?.total ?? 0}</span>
            </div>
            <div className="rc-wa-panel__body" style={{ display: 'grid', gap: 'var(--rc-space-4)' }}>
              <div>
                <p className="rc-wa-sub" style={{ marginBottom: 'var(--rc-space-2)' }}>
                  指标
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }} role="group" aria-label="指标选择">
                  {metricNames.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="rc-wa-pick"
                      style={{ width: 'auto' }}
                      aria-pressed={name === activeMetric}
                      onClick={() => {
                        setActiveMetric(name)
                        setActiveComparisonId(null)
                      }}
                    >
                      <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>{name}</span>
                      <span className="rc-wa-pick__id">
                        {comparisons.filter((item) => item.metric_name === name).length} 条对照
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="rc-wa-sub" style={{ marginBottom: 'var(--rc-space-2)' }}>
                  基准方案
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--rc-space-2)' }} role="group" aria-label="基准方案选择">
                  {candidates.map((item) => (
                    <button
                      key={item.comparison_id}
                      type="button"
                      className="rc-wa-pick"
                      style={{ width: 'auto', maxWidth: 420 }}
                      aria-pressed={item.comparison_id === activeComparisonId}
                      onClick={() => setActiveComparisonId(item.comparison_id)}
                    >
                      <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                        论文基准 {item.paper_value == null ? '数据不足' : formatNumber(item.paper_value)}
                        {item.unit ? ` ${item.unit}` : ''}
                      </span>
                      <span className="rc-wa-pick__id">
                        {item.verdict === 'not_comparable'
                          ? '协议不一致 · 不作数值判定'
                          : `复现 ${formatNumber(item.reproduced_value)} · ${item.rule || '—'}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 中部双层透视卡 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={Scale} size="sm" tone="accent" />
                双结果透视对比
              </div>
              {active && (
                <StatusBadge tone={verdictTone(active.verdict)}>{verdictLabel(active.verdict)}</StatusBadge>
              )}
            </div>
            <div className="rc-wa-panel__body">
              {!active ? (
                <EmptyState compact title="请选择对照方案" description="在上方选择指标与基准方案后展示透视对比。" />
              ) : (
                <div className="rc-wa-dual" key={active.comparison_id}>
                  {/* 后卡：复现值（同一格内错位叠压在前卡之上） */}
                  <div className={`rc-wa-dual__card rc-wa-dual__card--back${entering ? ' is-entering' : ''}`}>
                    <span className="rc-wa-dual__label">复现值 reproduced_value</span>
                    <span
                      className="rc-wa-dual__value"
                      style={{ marginTop: 0, fontSize: 'var(--rc-fs-h1)', color: 'var(--rc-violet)' }}
                    >
                      {reproducedText}
                      {active.unit ? ` ${active.unit}` : ''}
                    </span>
                    <span className="rc-wa-kpi__hint" style={{ marginTop: 0, marginLeft: 'auto' }}>
                      {active.comparison_id}
                    </span>
                  </div>

                  {/* 前卡：论文基准 */}
                  <div className={`rc-wa-dual__card rc-wa-dual__card--front${entering ? ' is-entering' : ''}`}>
                    <p className="rc-wa-dual__label">论文基准 paper_value</p>
                    <p className="rc-wa-dual__value">
                      {active.paper_value == null ? '数据不足' : formatNumber(active.paper_value)}
                      {active.paper_value != null && active.unit ? ` ${active.unit}` : ''}
                    </p>

                    <div className="rc-wa-dual__grid">
                      <div>
                        <p className="rc-wa-dual__label">复现值</p>
                        <p className="rc-wa-meta__v" style={{ fontSize: 'var(--rc-fs-h3)' }}>
                          {formatNumber(active.reproduced_value)}
                          {active.unit ? ` ${active.unit}` : ''}
                        </p>
                      </div>
                      <div>
                        <p className="rc-wa-dual__label">绝对差 diff_absolute</p>
                        <p className="rc-wa-meta__v" style={{ fontSize: 'var(--rc-fs-h3)' }}>
                          {formatNumber(active.diff_absolute)}
                        </p>
                      </div>
                      <div>
                        <p className="rc-wa-dual__label">相对差 diff_relative</p>
                        <p
                          className="rc-wa-meta__v"
                          style={{
                            fontSize: 'var(--rc-fs-h3)',
                            color:
                              active.diff_relative == null
                                ? 'var(--rc-text-subtle)'
                                : Math.abs(active.diff_relative) > 0
                                  ? 'var(--rc-danger)'
                                  : 'var(--rc-success)',
                          }}
                        >
                          {active.diff_relative == null
                            ? '数据不足'
                            : `${active.diff_relative >= 0 ? '+' : ''}${(active.diff_relative * 100).toFixed(2)}%`}
                        </p>
                      </div>
                    </div>

                    {active.diff_relative == null ? (
                      <p className="rc-wa-kpi__hint" style={{ marginTop: 'var(--rc-space-4)' }}>
                        论文值或复现值缺失，按规范不绘制对比条；判定：{verdictLabel(active.verdict)}。
                      </p>
                    ) : (
                      <>
                        <div className="rc-wa-diffbar" aria-hidden="true">
                          <span className="rc-wa-diffbar__axis" />
                          <span
                            className="rc-wa-diffbar__fill"
                            data-sign={
                              active.verdict === 'exact_match'
                                ? 'ok'
                                : active.diff_relative >= 0
                                  ? 'pos'
                                  : 'neg'
                            }
                            style={{
                              transform:
                                active.verdict === 'exact_match'
                                  ? 'none'
                                  : `scaleX(${Math.min(1, Math.abs(active.diff_relative) / maxAbsDiff)})`,
                            }}
                          />
                        </div>
                        <p className="rc-wa-kpi__hint" style={{ marginTop: 'var(--rc-space-2)' }}>
                          双向差异条：以 0 为中心，长度 ∝ |diff_relative| / {maxAbsDiff.toFixed(6)}（全局同尺度）
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* 底部差异明细表 */}
          <section className="rc-wa-panel">
            <div className="rc-wa-panel__head">
              <div className="rc-wa-panel__title">
                <Icon as={GitCompare} size="sm" tone="accent" />
                差异明细
              </div>
              <span className="rc-wa-source">conditions_check / tolerance_basis</span>
            </div>
            <div className="rc-wa-panel__body rc-wa-panel__body--flush rc-wa-tablehost">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th className="text-right">论文值</th>
                    <th className="text-right">复现值</th>
                    <th className="text-right">绝对差</th>
                    <th className="text-right">相对差</th>
                    <th>判定</th>
                    <th>规则</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {comparisons.map((comparison: ComparisonView) => {
                    const expanded = expandedId === comparison.comparison_id
                    const keys = orderedConditionKeys(Object.keys(comparison.conditions_check ?? {}))
                    return (
                      <Fragment key={comparison.comparison_id}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="rc-wa-rowbtn"
                              aria-expanded={expanded}
                              aria-controls={`cond-${comparison.comparison_id}`}
                              onClick={() => setExpandedId(expanded ? null : comparison.comparison_id)}
                            >
                              <Icon as={expanded ? ChevronDown : ChevronRight} size="xs" tone="muted" />
                              <span style={{ fontWeight: 'var(--rc-fw-sb)' }}>{comparison.metric_name}</span>
                            </button>
                          </td>
                          <td className="mono text-right">
                            {formatNumber(comparison.paper_value)}
                            {comparison.unit ? ` ${comparison.unit}` : ''}
                          </td>
                          <td className="mono text-right">
                            {formatNumber(comparison.reproduced_value)}
                            {comparison.unit ? ` ${comparison.unit}` : ''}
                          </td>
                          <td className="mono text-right">{formatNumber(comparison.diff_absolute)}</td>
                          <td className="mono text-right">
                            {comparison.diff_relative == null
                              ? '—'
                              : `${(comparison.diff_relative * 100).toFixed(2)}%`}
                          </td>
                          <td>
                            <StatusBadge tone={verdictTone(comparison.verdict)}>
                              {verdictLabel(comparison.verdict)}
                            </StatusBadge>
                          </td>
                          <td style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                            {comparison.rule || '—'}
                          </td>
                          <td style={{ color: 'var(--rc-text-subtle)' }}>
                            <Icon as={expanded ? ChevronDown : ChevronRight} size="xs" tone="subtle" />
                          </td>
                        </tr>
                        {expanded && (
                          <tr>
                            <td colSpan={8} style={{ backgroundColor: 'var(--rc-surface-3)' }}>
                              <div id={`cond-${comparison.comparison_id}`} style={{ display: 'grid', gap: 'var(--rc-space-4)', padding: 'var(--rc-space-2) 0' }}>
                                <div>
                                  <p className="rc-wa-sub">条件一致性检查</p>
                                  <div className="rc-wa-condgrid" style={{ marginTop: 'var(--rc-space-2)' }}>
                                    {keys.length === 0 ? (
                                      <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                                        后端未返回条件检查项。
                                      </p>
                                    ) : (
                                      keys.map((key) => (
                                        <div
                                          key={key}
                                          style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 'var(--rc-space-2)',
                                            padding: 'var(--rc-space-2)',
                                            border: 'var(--rc-stroke-hair)',
                                            borderRadius: 'var(--rc-radius-xs)',
                                          }}
                                        >
                                          <span style={{ fontSize: 'var(--rc-fs-caption)' }}>{conditionLabel(key)}</span>
                                          <ConditionValue value={comparison.conditions_check?.[key]} />
                                        </div>
                                      ))
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <p className="rc-wa-sub">容差依据 tolerance_basis</p>
                                  <p
                                    style={{
                                      marginTop: 'var(--rc-space-2)',
                                      fontSize: 'var(--rc-fs-caption)',
                                      color: 'var(--rc-text)',
                                      whiteSpace: 'pre-wrap',
                                      overflowWrap: 'anywhere',
                                    }}
                                  >
                                    {comparison.tolerance_basis || '后端未提供容差依据。'}
                                  </p>
                                  <p className="rc-wa-pick__id" style={{ marginTop: 'var(--rc-space-2)' }}>
                                    comparison_id: {comparison.comparison_id}
                                  </p>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* 质量评估 */}
      <section className="rc-wa-panel">
        <div className="rc-wa-panel__head">
          <div className="rc-wa-panel__title">
            <Icon as={Scale} size="sm" tone="accent" />
            复现质量评估
          </div>
          <span className="rc-wa-source">来源：后端质量对照聚合</span>
        </div>
        <div className="rc-wa-panel__body">
          {qualityQuery.isPending ? (
            <LoadingState compact message="正在读取质量评估…" />
          ) : qualityQuery.isError ? (
            <ErrorState
              compact
              message={qualityQuery.error instanceof Error ? qualityQuery.error.message : '无法获取质量评估。'}
              code={qualityQuery.error instanceof ApiError ? qualityQuery.error.code : undefined}
              onRetry={() => void qualityQuery.refetch()}
            />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--rc-space-5)' }}>
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--rc-space-3)',
                  padding: 'var(--rc-space-3)',
                  borderRadius: 'var(--rc-radius-sm)',
                  backgroundColor: 'var(--rc-accent-wash)',
                }}
              >
                <Icon as={Info} size="sm" tone="accent" />
                <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)', lineHeight: 1.6 }}>
                  {qualityQuery.data?.scope_note || '后端未提供范围说明。'}
                  {' '}该评分明确不是学术质量判定，仅用于描述证据完备程度与流程可核查性。
                </p>
              </div>

              {qualityQuery.data?.overall != null && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'var(--rc-space-3)',
                    padding: 'var(--rc-space-4)',
                    border: 'var(--rc-stroke-hair)',
                    borderRadius: 'var(--rc-radius-sm)',
                    backgroundColor: 'var(--rc-surface-3)',
                  }}
                >
                  <span className="rc-wa-kpi__label">综合得分（后端计算）</span>
                  <span className="mono" style={{ fontSize: 'var(--rc-fs-h1)', fontWeight: 'var(--rc-fw-sb)' }}>
                    {qualityQuery.data.overall}
                  </span>
                </div>
              )}

              {(qualityQuery.data?.dimensions ?? []).length === 0 ? (
                <EmptyState compact title="暂无质量维度" description="后端未返回质量评估维度。" />
              ) : (
                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--rc-space-3)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
                  }}
                >
                  {qualityQuery.data.dimensions.map((dimension) => (
                    <QualityCard key={dimension.key} dimension={dimension} />
                  ))}
                </div>
              )}

              {qualityQuery.data?.formula && (
                <div>
                  <p className="rc-wa-sub">计算公式 formula</p>
                  <pre
                    className="mono rc-wa-code"
                    style={{ marginTop: 'var(--rc-space-2)', padding: 'var(--rc-space-3)', whiteSpace: 'pre-wrap' }}
                  >
                    {qualityQuery.data.formula}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
