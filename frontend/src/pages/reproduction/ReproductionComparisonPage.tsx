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
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
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

function formatNumber(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 6 }).format(value)
}

function ConditionValue({ value }: { value: boolean | null | undefined }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-success">
        <Check size={13} /> 是
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-danger">
        <X size={13} /> 否
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-ink-subtle">
      <CircleHelp size={13} /> 未记录
    </span>
  )
}

function QualityCard({ dimension }: { dimension: QualityDimension }) {
  const max = dimension.max > 0 ? dimension.max : 1
  const width = Math.min(100, Math.max(0, Math.round((dimension.score / max) * 100)))
  return (
    <div className="rounded-lg border border-line-soft p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-semibold">{dimension.label || dimension.key}</h4>
          <StatusBadge tone="neutral" dot={false}>权重 {dimension.weight}</StatusBadge>
        </div>
        <span className="mono text-xs text-ink-muted">
          {dimension.score} / {dimension.max}
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-neutral-wash">
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-xs text-ink-muted">
        {dimension.basis || '后端未提供评分依据。'}
      </p>
      {(dimension.missing ?? []).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dimension.missing.map((item, index) => (
            <StatusBadge key={`${item}-${index}`} tone="warning" dot={false}>{item}</StatusBadge>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ReproductionComparisonPage() {
  const pid = useParams().pid ?? ''
  useTrackProject(pid)
  const [expandedId, setExpandedId] = useState<string | null>(null)

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

  if (comparisonQuery.isPending) {
    return <LoadingState message="正在读取指标对照…" hint="GET /reproductions/metric-comparisons" />
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

  const comparisons = comparisonQuery.data?.items ?? []

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent-dark">Result Comparison</p>
          <h2 className="mt-1 text-lg font-semibold">结果对照与质量评估</h2>
          <p className="mt-1 text-sm text-ink-muted">
            论文值与复现值均来自后端，判定由后端规则给出；展开行查看六项条件检查与容差依据。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/projects/${pid}/reproduction`} className="btn-ghost">返回总览</Link>
          <Link to={`/projects/${pid}/reproduction/reports`} className="btn-ghost">报告中心</Link>
        </div>
      </div>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <GitCompare size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">指标对照</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}>
            GET /metric-comparisons · {comparisonQuery.data?.total ?? 0}
          </StatusBadge>
        </div>
        {comparisons.length === 0 ? (
          <div className="p-5">
            <EmptyState
              compact
              icon={GitCompare}
              title="暂无指标对照"
              description="后端未返回该项目的指标对照数据。"
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                      <tr
                        className="cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : comparison.comparison_id)}
                      >
                        <td className="font-medium">{comparison.metric_name}</td>
                        <td className="mono text-right text-xs">
                          {formatNumber(comparison.paper_value)}{comparison.unit ? ` ${comparison.unit}` : ''}
                        </td>
                        <td className="mono text-right text-xs">
                          {formatNumber(comparison.reproduced_value)}{comparison.unit ? ` ${comparison.unit}` : ''}
                        </td>
                        <td className="mono text-right text-xs">{formatNumber(comparison.diff_absolute)}</td>
                        <td className="mono text-right text-xs">
                          {comparison.diff_relative == null
                            ? '—'
                            : `${(comparison.diff_relative * 100).toFixed(2)}%`}
                        </td>
                        <td>
                          <StatusBadge tone={verdictTone(comparison.verdict)}>
                            {verdictLabel(comparison.verdict)}
                          </StatusBadge>
                        </td>
                        <td className="text-xs text-ink-muted">{comparison.rule || '—'}</td>
                        <td className="text-ink-muted">
                          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                        </td>
                      </tr>
                      {expanded && (
                        <tr>
                          <td colSpan={8} className="bg-canvas/60">
                            <div className="grid gap-4 py-2 lg:grid-cols-2">
                              <div>
                                <h4 className="text-xs font-semibold text-ink-muted">条件一致性检查</h4>
                                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                                  {keys.length === 0 ? (
                                    <li className="text-xs text-ink-subtle">后端未返回条件检查项。</li>
                                  ) : (
                                    keys.map((key) => (
                                      <li key={key} className="flex items-center justify-between gap-2 rounded border border-line-soft bg-surface px-2 py-1.5">
                                        <span className="text-xs text-ink">{conditionLabel(key)}</span>
                                        <ConditionValue value={comparison.conditions_check?.[key]} />
                                      </li>
                                    ))
                                  )}
                                </ul>
                              </div>
                              <div>
                                <h4 className="text-xs font-semibold text-ink-muted">容差依据 tolerance_basis</h4>
                                <p className="mt-2 whitespace-pre-wrap break-words text-xs text-ink">
                                  {comparison.tolerance_basis || '后端未提供容差依据。'}
                                </p>
                                <p className="mono mt-3 text-[10px] text-ink-subtle">
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
        )}
      </section>

      <section className="panel overflow-hidden">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Scale size={17} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">复现质量评估</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}>GET /reproductions/quality</StatusBadge>
        </div>
        <div className="p-5">
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
            <div className="space-y-5">
              <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-wash p-3">
                <Info size={16} className="mt-0.5 shrink-0 text-accent-dark" />
                <p className="text-xs leading-relaxed text-ink-muted">
                  {qualityQuery.data?.scope_note || '后端未提供范围说明。'}
                  {' '}该评分明确不是学术质量判定，仅用于描述证据完备程度与流程可核查性。
                </p>
              </div>

              {qualityQuery.data?.overall != null && (
                <div className="rounded-lg border border-line-soft bg-canvas/60 p-4">
                  <p className="text-xs font-medium text-ink-muted">综合得分（后端计算）</p>
                  <p className="mono mt-1 text-2xl font-semibold text-ink">{qualityQuery.data.overall}</p>
                </div>
              )}

              {(qualityQuery.data?.dimensions ?? []).length === 0 ? (
                <EmptyState compact title="暂无质量维度" description="后端未返回质量评估维度。" />
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {qualityQuery.data.dimensions.map((dimension) => (
                    <QualityCard key={dimension.key} dimension={dimension} />
                  ))}
                </div>
              )}

              {qualityQuery.data?.formula && (
                <div>
                  <h4 className="text-xs font-semibold text-ink-muted">计算公式 formula</h4>
                  <pre className="mono mt-2 overflow-x-auto rounded-md border border-line-soft bg-canvas/60 p-3 text-xs whitespace-pre-wrap text-ink">
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
