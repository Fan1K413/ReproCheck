/**
 * 实验差异分析中心（图4 精密 + 差异监控）
 *
 * 业务未变：GET /experiments/runs 选择运行 → POST /experiments/diff 生成差异报告。
 * 特色交互：**偏差波形监控（Deviation Wave Monitor）** —— 用 Phase 1 §3.2 的「偏差波形」语义图形
 * （上下两条镜像轨迹 + 中心菱形偏差标记）绘制每个指标的真实偏差幅度：
 * 波形间距 ∝ |relative_diff|（相对 100% 封顶）；relative_diff 为 null 时不画波形，只标「数据不足」。
 *
 * 真实数据绑定：DiffReport{ conditions[], metric_diffs[], possible_explanations[],
 *   undetermined[], rerun_recommendation, affected_audit_conclusions[], causality_notice }
 */
import { useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import { DeviationWave, Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge } from '../components/StatusBadge'
import { formatDateTime } from '../features/format'
import { ApiError } from '../services/api'
import { researchApi } from '../services/researchApi'
import { toast } from '../stores/toastStore'
import '../styles/wave-c-verify.css'

/**
 * 偏差波形仪表：参考轨迹（虚线）与实测轨迹（实线）上下镜像，
 * 两条曲线的垂直间距严格 ∝ |relative_diff|；中心菱形标记偏差位置。
 */
function DeviationGauge({
  relativeDiff,
  label,
}: {
  relativeDiff: number | null
  label: string
}) {
  if (relativeDiff === null || !Number.isFinite(relativeDiff)) {
    return (
      <div className="rc4-wave__empty" role="img" aria-label={`${label}：缺少可比值，不绘制偏差波形`}>
        数据不足 · 不绘制偏差波形
      </div>
    )
  }

  const magnitude = Math.min(1, Math.abs(relativeDiff))
  const gap = 6 + magnitude * 14
  const refTop = 18
  const refBottom = 12
  const measuredTop = refTop + gap
  const measuredBottom = refBottom + gap
  const markerY = refTop + gap / 2

  return (
    <svg
      viewBox="0 0 160 48"
      className="w-full"
      role="img"
      aria-label={`${label}：相对偏差 ${(relativeDiff * 100).toFixed(2)}%，波形间距与偏差幅度成正比`}
    >
      <line
        x1="6"
        y1={markerY}
        x2="154"
        y2={markerY}
        stroke="var(--rc-border-strong)"
        strokeWidth="1"
        strokeDasharray="3 4"
      />
      <path
        d={`M6 ${refBottom} C 26 ${refBottom}, 34 ${refTop}, 54 ${refTop} C 74 ${refTop}, 82 ${refBottom}, 154 ${refBottom}`}
        fill="none"
        stroke="var(--rc-text-subtle)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
        strokeLinecap="round"
      />
      <path
        d={`M6 ${measuredBottom} C 26 ${measuredBottom}, 34 ${measuredTop}, 54 ${measuredTop} C 74 ${measuredTop}, 82 ${measuredBottom}, 154 ${measuredBottom}`}
        fill="none"
        stroke="var(--rc-violet)"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
      <path
        d={`M80 ${markerY - 4} L 84 ${markerY} L 80 ${markerY + 4} L 76 ${markerY} Z`}
        fill="none"
        stroke="var(--rc-magenta)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function ExperimentDiffPage() {
  const { projectId = '' } = useParams()
  const [selected, setSelected] = useState<string[]>([])
  const runsQ = useQuery({
    queryKey: ['exp-runs', projectId],
    queryFn: () => researchApi.runs(projectId),
    enabled: !!projectId,
  })
  const diff = useMutation({
    mutationFn: () => researchApi.diff(projectId, selected),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : '差异分析失败'),
  })

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 5 ? [...prev, id] : prev,
    )

  const runs = runsQ.data ?? []

  const comparableCount = useMemo(
    () => (diff.data?.metric_diffs ?? []).filter((item) => item.relative_diff !== null).length,
    [diff.data],
  )

  return (
    <div className="rc4-page">
      <PageHeader
        title="实验差异分析中心"
        description="比较两个或多个实验版本，找出条件与指标变化；只给出相关性线索，不认定因果。"
      />

      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="rc4-panel__title">
              <Icon name="grid" size="sm" tone="accent" />
              选择实验版本
            </h3>
            <span className="rc4-panel__hint">已选 {selected.length} / 5</span>
          </div>
          <button
            type="button"
            className="btn-primary"
            disabled={selected.length < 2 || diff.isPending}
            onClick={() => diff.mutate()}
          >
            {diff.isPending ? (
              <Icon name="rotate" size="sm" className="animate-spin" />
            ) : (
              <Icon name="play" size="sm" />
            )}
            {diff.isPending ? '正在生成…' : '生成差异报告'}
          </button>
        </div>
        <div className="rc4-panel__body">
          {runsQ.isPending ? (
            <LoadingState message="读取运行列表…" />
          ) : runsQ.isError ? (
            <ErrorState message="无法读取运行列表" onRetry={() => void runsQ.refetch()} />
          ) : runs.length === 0 ? (
            <EmptyState
              compact
              title="该项目还没有运行记录"
              description="没有真实运行记录时无法比较；本工具不做任何模拟对比。"
            />
          ) : (
            <div className="rc4-rail">
              {runs.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  className="rc4-rail__item"
                  aria-pressed={selected.includes(run.id)}
                  onClick={() => toggle(run.id)}
                >
                  <span className="mono">{run.id}</span>
                  <StatusBadge tone={run.status === 'completed' ? 'success' : 'neutral'}>
                    {run.status}
                  </StatusBadge>
                  <span className="rc4-list__meta">
                    {formatDateTime(run.started_at)} · {run.duration_ms}ms
                  </span>
                </button>
              ))}
            </div>
          )}
          {diff.isError && (
            <div className="mt-4">
              <ErrorState
                compact
                message={diff.error instanceof ApiError ? diff.error.message : '差异分析失败'}
                onRetry={() => diff.mutate()}
              />
            </div>
          )}
        </div>
      </section>

      {diff.data && (
        <>
          {/* 特色交互：偏差波形监控 */}
          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <h3 className="rc4-panel__title">
                  <DeviationWave size={20} />
                  偏差波形监控
                </h3>
                <span className="rc4-panel__hint">
                  波形间距 ∝ |relative_diff|（相对 100% 封顶）· 可比指标 {comparableCount} /{' '}
                  {diff.data.metric_diffs.length}
                </span>
              </div>
            </div>
            <div className="rc4-panel__body">
              {/* 真实可比性说明：无可比指标时给出原因，而不是画装饰波形 */}
              {(() => {
                const snapshots = diff.data.snapshots as Array<Record<string, unknown>>
                const emptyRuns = snapshots.filter(
                  (snapshot) =>
                    !snapshot.metrics ||
                    Object.keys(snapshot.metrics as Record<string, unknown>).length === 0,
                )
                if (comparableCount > 0) return null
                return (
                  <p className="rc4-list__meta mb-3">
                    本次比较没有可比指标：
                    {emptyRuns.length > 0
                      ? `${emptyRuns.length} 个运行未产出指标（见下方运行快照），无法计算真实偏差幅度。`
                      : '后端未返回 relative_diff，无法计算真实偏差幅度。'}
                  </p>
                )
              })()}
              <div className="rc4-wave">
                {diff.data.metric_diffs.map((metric) => (
                  <div key={metric.metric} className="rc4-wave__row">
                    <div className="rc4-wave__metric">
                      {metric.metric}
                      <span className="rc4-list__meta block">
                        {metric.values.map((value) => value ?? '—').join(' → ')}
                      </span>
                    </div>
                    <div className="rc4-wave__canvas">
                      <DeviationGauge
                        relativeDiff={metric.relative_diff}
                        label={`${metric.metric} 的相对偏差`}
                      />
                    </div>
                    <div className="rc4-wave__value">
                      <span className="block">
                        绝对差 {metric.absolute_diff ?? '—'}
                      </span>
                      <span className="block">
                        相对差{' '}
                        {metric.relative_diff === null
                          ? '—'
                          : `${(metric.relative_diff * 100).toFixed(2)}%`}
                      </span>
                      <span className="block">
                        <StatusBadge tone={metric.changed ? 'warning' : 'neutral'}>
                          {metric.changed ? '变化' : '未变'}
                        </StatusBadge>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="rc4-list__meta mt-3">
                缺少可比值的指标不绘制波形，也不用装饰条替代真实偏差。
              </p>

              {/* 运行快照的真实指标（缺失时如实标注，不用推测值补齐） */}
              <div className="mt-4">
                <p className="rcw-overline mb-2">运行快照指标</p>
                <div className="grid gap-3 md:grid-cols-2">
                  {diff.data.snapshots.map((snapshot) => {
                    const record = snapshot as Record<string, unknown>
                    const metrics = record.metrics as
                      | Record<string, { value?: number; unit?: string | null }>
                      | undefined
                    const entries = Object.entries(metrics ?? {})
                    return (
                      <div key={String(record.run_id)} className="rc4-kpi">
                        <p className="rc4-kpi__label">{String(record.run_id)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-2">
                          <StatusBadge tone={record.status === 'completed' ? 'success' : 'danger'}>
                            {String(record.status ?? '—')}
                          </StatusBadge>
                          {record.error_message ? (
                            <span className="rc4-list__meta break-all">
                              {String(record.error_message)}
                            </span>
                          ) : null}
                        </div>
                        {entries.length === 0 ? (
                          <p className="rc4-list__meta mt-2">该运行未产出任何指标。</p>
                        ) : (
                          <div className="mt-2 flex flex-col gap-1">
                            {entries.map(([name, metric]) => (
                              <p key={name} className="rc4-list__meta">
                                {name} ·{' '}
                                <span className="mono">
                                  {metric?.value === undefined ? '—' : metric.value}
                                  {metric?.unit ? ` ${metric.unit}` : ''}
                                </span>
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <h3 className="rc4-panel__title">条件变化</h3>
              <span className="rc4-panel__hint">{diff.data.conditions.length} 个维度</span>
            </div>
            <div className="rc4-panel__body">
              <div className="rc4-table-wrap">
                <table className="rc4-table">
                  <thead>
                    <tr>
                      <th>维度</th>
                      <th>状态</th>
                      <th>数据完整性</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.data.conditions.map((condition) => (
                      <tr key={condition.dimension}>
                        <td className="mono">{condition.dimension}</td>
                        <td>
                          <StatusBadge tone={condition.status === 'changed' ? 'warning' : 'neutral'}>
                            {condition.status}
                          </StatusBadge>
                        </td>
                        <td>{condition.unknown ? '未知（缺数据）' : '可比较'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <h3 className="rc4-panel__title">指标变化</h3>
              <span className="rc4-panel__hint">{diff.data.metric_diffs.length} 个指标</span>
            </div>
            <div className="rc4-panel__body">
              <div className="rc4-table-wrap">
                <table className="rc4-table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>各版本值</th>
                      <th>绝对差</th>
                      <th>相对差</th>
                      <th>结论</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.data.metric_diffs.map((metric) => (
                      <tr key={metric.metric}>
                        <td>{metric.metric}</td>
                        <td className="mono">{metric.values.map((v) => v ?? '—').join(' → ')}</td>
                        <td className="mono">{metric.absolute_diff ?? '—'}</td>
                        <td className="mono">
                          {metric.relative_diff === null
                            ? '—'
                            : `${(metric.relative_diff * 100).toFixed(2)}%`}
                        </td>
                        <td>
                          <StatusBadge tone={metric.changed ? 'warning' : 'neutral'}>
                            {metric.changed ? '变化' : '未变'}
                          </StatusBadge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rc4-panel">
              <div className="rc4-panel__head">
                <h3 className="rc4-panel__title">可能解释（仅相关性）</h3>
              </div>
              <div className="rc4-panel__body">
                {diff.data.possible_explanations.length === 0 ? (
                  <p className="rc4-list__meta">未发现可归因的线索。</p>
                ) : (
                  <div className="rc4-list">
                    {diff.data.possible_explanations.map((explanation, index) => (
                      <div key={index} className="rc4-list__row">
                        <div className="rc4-list__main">
                          <p className="rc4-list__title mono">{explanation.condition}</p>
                          <p className="rc4-list__meta">→ {explanation.metrics.join(', ')}</p>
                          <p className="rc4-list__meta">{explanation.text}</p>
                        </div>
                        <StatusBadge tone="neutral">{explanation.relation}</StatusBadge>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="rc4-panel">
              <div className="rc4-panel__head">
                <h3 className="rc4-panel__title">重跑建议与不确定项</h3>
              </div>
              <div className="rc4-panel__body">
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="rcw-overline mb-1">建议</p>
                    <p className="rc4-list__meta">
                      <StatusBadge tone="accent">
                        {diff.data.rerun_recommendation.recommendation}
                      </StatusBadge>{' '}
                      {diff.data.rerun_recommendation.reason}
                    </p>
                  </div>
                  <div>
                    <p className="rcw-overline mb-1">无法确定</p>
                    <p className="rc4-list__meta">
                      {diff.data.undetermined.join('、') || '无'}
                    </p>
                  </div>
                  <div>
                    <p className="rcw-overline mb-1">受影响的审计结论</p>
                    {diff.data.affected_audit_conclusions.length === 0 ? (
                      <p className="rc4-list__meta">无。</p>
                    ) : (
                      <div className="rc4-list">
                        {diff.data.affected_audit_conclusions.map((conclusion) => (
                          <div key={conclusion.id} className="rc4-list__row">
                            <div className="rc4-list__main">
                              <p className="rc4-list__title">{conclusion.metric}</p>
                              <p className="rc4-list__meta">
                                {conclusion.verdict} · {conclusion.impact}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          </div>

          <div className="rcw-note rcw-note--warn">
            <Icon name="triangleAlert" size="sm" tone="warning" />
            {diff.data.causality_notice}
          </div>
        </>
      )}
    </div>
  )
}
