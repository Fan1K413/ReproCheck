/**
 * 统计学审计（图4 精密 + 统计表）
 *
 * 业务未变：完整审计 POST /stats-audit/run、单原语计算 POST /stats-audit/compute、
 * 目录 GET /stats-audit/catalog 与「载入示例」全部保留。
 * 新增特色交互：**可复算统计量总表** —— 从 report.computations 的真实计算结果里抽取
 * 均值/标准差/置信区间/p 值/效应量等数值，列表 + 检索 + 点击展开原始 JSON；
 * 没有对应数值的计算项如实留空，不补造。
 *
 * 真实数据绑定：StatsReport{ report_id, created_at, version, scope, counts, blocking_count,
 *   findings[], computations, limitations[] }
 */
import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Calculator, FlaskConical } from 'lucide-react'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { ApiError } from '../services/api'
import { statsApi } from '../services/statsApi'
import { toast } from '../stores/toastStore'
import type {
  StatsComputeResult,
  StatsEvidence,
  StatsReport,
  StatsVerdict,
} from '../types/stats'
import '../styles/wave-c-verify.css'

/* ------------------------------------------------------------------ 常量 */

type Mode = 'full' | 'compute'
type HistogramData = { counts: number[]; edges: number[]; source: string }
type CiRow = { label: string; low: number; high: number; center: number }
type SeedRow = { seed: string; mean: number; std: number | null }

const VERDICT_META: Record<StatsVerdict, { label: string; tone: Tone; hint: string }> = {
  calculation_error: {
    label: '计算错误',
    tone: 'danger',
    hint: '重算值与报告值不一致',
  },
  method_inapplicable: {
    label: '统计方法不适用',
    tone: 'danger',
    hint: '方法前提或口径存疑',
  },
  insufficient_evidence: {
    label: '证据不足',
    tone: 'neutral',
    hint: '输入数据不足以判断',
  },
  potential_bias: {
    label: '潜在偏差',
    tone: 'warning',
    hint: '报告或选取口径需核对',
  },
  needs_human_review: {
    label: '需要人工复核',
    tone: 'accent',
    hint: '无法自动定性',
  },
  verified: {
    label: '已得到数据验证',
    tone: 'success',
    hint: '按公开公式复算一致',
  },
}

const VERDICT_ORDER: StatsVerdict[] = [
  'calculation_error',
  'method_inapplicable',
  'insufficient_evidence',
  'potential_bias',
  'needs_human_review',
  'verified',
]

const FALLBACK_OPERATIONS = [
  'mean',
  'std',
  'variance',
  'verify_mean_std',
  'check_consistency',
  'analyze_seed_impact',
  'confidence_interval',
  'effect_size',
  'hypothesis_test',
  'multiple_comparison',
  'power_analysis',
  'detect_outliers',
  'distribution_data',
  'compute_classification_metrics',
  'compute_roc_auc',
  'audit_metric_claims',
  'check_control_group',
  'guard_causal_language',
]

/** 官方合成示例：非真实论文数据，仅用于演示输入结构与复算链路。 */
const SAMPLE_DATA = {
  claims: {
    mean: 0.82,
    std: 0.04,
    accuracy: 0.9,
    f1: 0.88,
  },
  samples: {
    values: [0.78, 0.81, 0.83, 0.85, 0.79, 0.82, 0.86, 0.8, 0.84, 0.83],
    ddof: 1,
  },
  runs: [
    { name: 'run_1', values: [0.79, 0.81, 0.83, 0.8, 0.82] },
    { name: 'run_2', values: [0.82, 0.84, 0.85, 0.83, 0.84] },
    { name: 'run_3', values: [0.8, 0.79, 0.82, 0.81, 0.83] },
  ],
  seed_scores: {
    seed_42: [0.82, 0.84, 0.81, 0.83, 0.85],
    seed_7: [0.74, 0.76, 0.75, 0.73, 0.77],
    seed_2024: [0.83, 0.86, 0.84, 0.85, 0.82],
  },
  group_a: [0.82, 0.84, 0.85, 0.83, 0.86, 0.81, 0.84, 0.83],
  group_b: [0.75, 0.74, 0.77, 0.76, 0.73, 0.78, 0.75, 0.76],
  alpha: 0.05,
  test_kind: 'welch',
  pvalues: [0.01, 0.02, 0.03, 0.04, 0.2],
  multiple_method: 'holm',
  multiple_comparison_corrected: false,
  effect_size: 0.55,
  n: 40,
  bins: 8,
  dataset: {
    task_type: 'classification',
    y_true: [1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0],
    y_pred: [1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0],
    y_score: [0.9, 0.2, 0.8, 0.3, 0.4, 0.88, 0.15, 0.65, 0.75, 0.25, 0.92, 0.35],
    labels: [0, 1],
  },
  control_group: {
    baseline_declared: true,
    randomization_declared: true,
    blinding_declared: false,
  },
  claimed_components: ['特征模块', '编码模块', '校准模块'],
  ablations: ['去除特征模块', '去除编码模块'],
  baselines: ['同期基线模型'],
  reported_seeds: [42],
  total_seeds: 3,
  reported_splits: ['test'],
  best_only: true,
  n_repeats: 2,
  pvalue: 0.02,
}

const SAMPLE_JSON = JSON.stringify(SAMPLE_DATA, null, 2)
const DEFAULT_KWARGS = JSON.stringify({ values: [1, 2, 3, 4, 5] }, null, 2)

/* ------------------------------------------------------------------ 工具 */

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const out: number[] = []
  for (const item of value) {
    const num = asFiniteNumber(item)
    if (num === null) return null
    out.push(num)
  }
  return out
}

function formatJson(value: unknown): string {
  if (value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2) ?? '—'
  } catch {
    return '无法序列化'
  }
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (Math.abs(value) >= 1000) return value.toFixed(0)
  return Number(value.toFixed(3)).toString()
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('zh-CN', { hour12: false })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '请求失败，请稍后重试。'
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

function parseObject(text: string, label: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error(`${label}不是合法的 JSON。`)
  }
  const record = asRecord(parsed)
  if (!record) throw new Error(`${label}必须是 JSON 对象。`)
  return record
}

function resultParts(value: unknown): {
  top: Record<string, unknown>
  values: Record<string, unknown>
} {
  const top = asRecord(value) ?? {}
  return { top, values: asRecord(top.values) ?? {} }
}

/** 直方图数据：优先取 core.distribution_data，并兼容别名与顶层 counts/bin_edges。 */
function collectHistogram(report: StatsReport): HistogramData | null {
  const candidates = [
    'core.distribution_data',
    'distribution_data',
    'core.STAT-010',
    'STAT-010',
  ]
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(report.computations, key)) continue
    const { top, values } = resultParts(report.computations[key])
    const counts = asNumberArray(values.counts ?? top.counts)
    if (!counts || counts.length === 0) continue
    const rawEdges = asNumberArray(values.bin_edges ?? top.bin_edges)
    const edges =
      rawEdges && rawEdges.length >= counts.length + 1
        ? rawEdges
        : Array.from({ length: counts.length + 1 }, (_, index) => index)
    return { counts, edges, source: key }
  }
  return null
}

/** 森林图数据：发现证据的 ci_low/ci_high/mean 与 computations 中的置信区间结果。 */
function collectCiRows(report: StatsReport): CiRow[] {
  const rows: CiRow[] = []
  const pushRow = (label: string, low: number | null, high: number | null, center: number | null) => {
    if (low === null || high === null || !Number.isFinite(low) || !Number.isFinite(high)) return
    const point = center ?? (low + high) / 2
    rows.push({ label, low, high, center: Number.isFinite(point) ? point : (low + high) / 2 })
  }

  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      const recomputed = asRecord(evidence.recomputed)
      if (!recomputed) continue
      pushRow(
        finding.rule_id,
        asFiniteNumber(recomputed.ci_low),
        asFiniteNumber(recomputed.ci_high),
        asFiniteNumber(recomputed.mean),
      )
    }
  }

  for (const [key, value] of Object.entries(report.computations)) {
    const normalized = key.replace(/^core\./, '')
    if (!normalized.includes('confidence') && !normalized.includes('STAT-004')) continue
    const { top, values } = resultParts(value)
    const source = asFiniteNumber(values.ci_low) !== null ? values : top
    pushRow(
      normalized,
      asFiniteNumber(source.ci_low),
      asFiniteNumber(source.ci_high),
      asFiniteNumber(source.mean),
    )
  }

  const seen = new Set<string>()
  return rows
    .filter((row) => {
      const key = `${row.label}|${row.low}|${row.high}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

/** 种子影响数据：优先用 per_seed 汇总，其次从证据输入中的 seed_scores 逐组求均值。 */
function collectSeedRows(report: StatsReport): SeedRow[] {
  const candidates = [
    'core.analyze_seed_impact',
    'analyze_seed_impact',
    'core.STAT-003',
    'STAT-003',
  ]
  for (const key of candidates) {
    if (!Object.prototype.hasOwnProperty.call(report.computations, key)) continue
    const { top, values } = resultParts(report.computations[key])
    const perSeed = values.per_seed ?? top.per_seed
    if (!Array.isArray(perSeed)) continue
    const rows: SeedRow[] = []
    for (const item of perSeed) {
      const record = asRecord(item)
      if (!record) continue
      const mean = asFiniteNumber(record.mean)
      if (mean === null) continue
      const seed = typeof record.seed === 'string' ? record.seed : String(record.seed ?? `种子${rows.length + 1}`)
      rows.push({ seed, mean, std: asFiniteNumber(record.std) })
    }
    if (rows.length > 0) return rows
  }

  for (const finding of report.findings) {
    for (const evidence of finding.evidence) {
      const inputs = asRecord(evidence.inputs)
      const seeds = asRecord(inputs?.seed_scores)
      if (!seeds) continue
      const rows: SeedRow[] = []
      for (const [seed, raw] of Object.entries(seeds)) {
        const scores = asNumberArray(raw)
        if (!scores || scores.length === 0) continue
        rows.push({
          seed,
          mean: scores.reduce((sum, item) => sum + item, 0) / scores.length,
          std: null,
        })
      }
      if (rows.length > 0) return rows
    }
  }
  return []
}

/* ------------------------------------------------------------------ 可复算统计量总表 */

const STAT_NAMES: Array<[string, string]> = [
  ['mean', '均值'],
  ['std', '标准差'],
  ['variance', '方差'],
  ['ci_low', '置信下界'],
  ['ci_high', '置信上界'],
  ['pvalue', 'p 值'],
  ['effect_size', '效应量'],
  ['cohens_d', "Cohen's d"],
  ['hedges_g', "Hedges' g"],
  ['n', '样本量'],
  ['count', '计数'],
  ['total', '总数'],
  ['correct', '正确数'],
  ['predicted', '预测数'],
  ['tp', 'TP'],
  ['fp', 'FP'],
  ['fn', 'FN'],
  ['tn', 'TN'],
  ['false_positive_rate', '误报率'],
  ['false_negative_rate', '漏报率'],
  ['accuracy', '准确率'],
  ['precision', '精确率'],
  ['recall', '召回率'],
  ['f1', 'F1'],
  ['statistic', '检验统计量'],
  ['critical_value', '临界值'],
]

type StatRow = {
  computation: string
  stat: string
  statLabel: string
  value: string
}

/** 从真实 computations 里抽取可复算数值；没有对应数值的项不出现。 */
function collectStatRows(report: StatsReport): StatRow[] {
  const rows: StatRow[] = []
  for (const [key, raw] of Object.entries(report.computations)) {
    const { top, values } = resultParts(raw)
    const source: Record<string, unknown> = { ...top, ...values }
    for (const [name, label] of STAT_NAMES) {
      const value = source[name]
      const numeric = asFiniteNumber(value)
      if (numeric !== null) {
        rows.push({
          computation: key.replace(/^core\./, ''),
          stat: name,
          statLabel: label,
          value: formatNumber(numeric),
        })
        continue
      }
      if (typeof value === 'string' && value.trim() !== '') {
        rows.push({
          computation: key.replace(/^core\./, ''),
          stat: name,
          statLabel: label,
          value,
        })
      }
    }
  }
  return rows
}

/* ------------------------------------------------------------------ 通用展示组件 */

function VerdictBadge({
  verdict,
  label,
  count,
}: {
  verdict: StatsVerdict
  label?: string
  count?: number
}) {
  const meta = VERDICT_META[verdict] ?? VERDICT_META.verified
  return (
    <StatusBadge tone={meta.tone}>
      {label ?? meta.label}
      {count !== undefined ? ` · ${count}` : ''}
    </StatusBadge>
  )
}

function ChartPanel({
  title,
  hint,
  legend,
  empty,
  children,
}: {
  title: string
  hint: string
  legend: Array<{ color: string; label: string; shape: 'bar' | 'line' | 'dot' }>
  empty: boolean
  children: ReactNode
}) {
  return (
    <section className="rc4-chart">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="rc4-panel__title">{title}</h4>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
            {hint}
          </p>
        </div>
        <div className="rc4-chart__legend">
          {legend.map((item) => (
            <span key={item.label}>
              <span
                className={`rc4-chart__swatch${item.shape === 'dot' ? ' rc4-chart__swatch--dot' : ''}`}
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </span>
          ))}
        </div>
      </div>
      {empty ? <div className="rc4-wave__empty">暂无可视化数据</div> : children}
    </section>
  )
}

/* ------------------------------------------------------------------ 手写 SVG 图表 */

function HistogramChart({ data }: { data: HistogramData }) {
  const width = 640
  const height = 240
  const left = 48
  const right = 16
  const top = 16
  const bottom = 40
  const plotW = width - left - right
  const plotH = height - top - bottom
  const { counts, edges } = data
  const maxCount = Math.max(...counts, 1)
  const first = edges[0] ?? 0
  const last = edges[edges.length - 1] ?? first + 1
  const span = last - first || 1
  const xAt = (edge: number) => left + ((edge - first) / span) * plotW
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => first + ratio * span)
  const yTicks = [0, maxCount / 2, maxCount]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="样本分布直方图">
      {yTicks.map((tick, index) => {
        const y = top + plotH - (tick / maxCount) * plotH
        return (
          <g key={`y-${index}`}>
            <line
              x1={left}
              y1={y}
              x2={left + plotW}
              y2={y}
              stroke="var(--rc-border)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={left - 6}
              y={y + 3}
              fill="var(--rc-text-subtle)"
              fontSize="10"
              textAnchor="end"
            >
              {formatNumber(tick)}
            </text>
          </g>
        )
      })}
      <line
        x1={left}
        y1={top + plotH}
        x2={left + plotW}
        y2={top + plotH}
        stroke="var(--rc-text-subtle)"
        strokeWidth="1"
      />
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="var(--rc-text-subtle)" strokeWidth="1" />
      {counts.map((count, index) => {
        const x0 = xAt(edges[index] ?? first + (index * span) / counts.length)
        const x1 = xAt(edges[index + 1] ?? first + ((index + 1) * span) / counts.length)
        const barW = Math.max(2, (x1 - x0) * 0.76)
        const barX = x0 + (x1 - x0 - barW) / 2
        const barH = (count / maxCount) * plotH
        return (
          <rect
            key={`bar-${index}`}
            x={barX}
            y={top + plotH - barH}
            width={barW}
            height={count > 0 ? Math.max(barH, 1) : 0}
            rx="2"
            fill="var(--rc-success)"
            stroke="var(--rc-success)"
            strokeWidth="1"
          />
        )
      })}
      {xTicks.map((tick, index) => (
        <text
          key={`x-${index}`}
          x={xAt(tick)}
          y={top + plotH + 16}
          fill="var(--rc-text-muted)"
          fontSize="10"
          textAnchor="middle"
        >
          {formatNumber(tick)}
        </text>
      ))}
      <text
        x={left + plotW / 2}
        y={height - 2}
        fill="var(--rc-text-subtle)"
        fontSize="10"
        textAnchor="middle"
      >
        样本取值
      </text>
      <text
        x="10"
        y={top + plotH / 2}
        fill="var(--rc-text-subtle)"
        fontSize="10"
        textAnchor="middle"
        transform={`rotate(-90 10 ${top + plotH / 2})`}
      >
        频数
      </text>
    </svg>
  )
}

function ForestChart({ rows }: { rows: CiRow[] }) {
  const width = 640
  const rowH = 36
  const height = Math.max(160, 48 + rows.length * rowH)
  const left = 96
  const right = 24
  const top = 20
  const bottom = 36
  const plotW = width - left - right
  const lows = rows.map((row) => Math.min(row.low, row.center))
  const highs = rows.map((row) => Math.max(row.high, row.center))
  const min = Math.min(...lows)
  const max = Math.max(...highs)
  const pad = (max - min) * 0.1 || 1
  const domainMin = min - pad
  const domainMax = max + pad
  const xAt = (value: number) => left + ((value - domainMin) / (domainMax - domainMin)) * plotW
  const axisY = height - bottom
  const xTicks = Array.from({ length: 5 }, (_, index) => domainMin + (index / 4) * (domainMax - domainMin))

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="置信区间森林图">
      {xTicks.map((tick, index) => (
        <g key={`tick-${index}`}>
          <line
            x1={xAt(tick)}
            y1={top - 8}
            x2={xAt(tick)}
            y2={axisY}
            stroke="var(--rc-border)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
          <text
            x={xAt(tick)}
            y={axisY + 16}
            fill="var(--rc-text-muted)"
            fontSize="10"
            textAnchor="middle"
          >
            {formatNumber(tick)}
          </text>
        </g>
      ))}
      <line
        x1={left}
        y1={axisY}
        x2={left + plotW}
        y2={axisY}
        stroke="var(--rc-text-subtle)"
        strokeWidth="1"
      />
      {rows.map((row, index) => {
        const y = top + index * rowH + rowH / 2
        const x0 = xAt(row.low)
        const x1 = xAt(row.high)
        const center = xAt(row.center)
        return (
          <g key={`${row.label}-${index}`}>
            <text x={8} y={y + 4} fill="var(--rc-text-muted)" fontSize="11">
              {row.label}
            </text>
            <line
              x1={x0}
              y1={y}
              x2={x1}
              y2={y}
              stroke="var(--rc-info)"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <line x1={x0} y1={y - 5} x2={x0} y2={y + 5} stroke="var(--rc-info)" strokeWidth="2" />
            <line x1={x1} y1={y - 5} x2={x1} y2={y + 5} stroke="var(--rc-info)" strokeWidth="2" />
            <circle
              cx={center}
              cy={y}
              r="4"
              fill="var(--rc-danger)"
              stroke="var(--rc-danger)"
              strokeWidth="1"
            />
          </g>
        )
      })}
      <text
        x={left + plotW / 2}
        y={height - 2}
        fill="var(--rc-text-subtle)"
        fontSize="10"
        textAnchor="middle"
      >
        区间端点与中心取值
      </text>
    </svg>
  )
}

function SeedChart({ rows }: { rows: SeedRow[] }) {
  const width = 640
  const height = 240
  const left = 48
  const right = 16
  const top = 16
  const bottom = 40
  const plotW = width - left - right
  const plotH = height - top - bottom
  const values = rows.flatMap((row) => [row.mean - (row.std ?? 0), row.mean + (row.std ?? 0)])
  const min = Math.min(0, ...values)
  const max = Math.max(...values)
  const paddedMax = max === min ? min + 1 : max
  const yAt = (value: number) => top + plotH - ((value - min) / (paddedMax - min)) * plotH
  const slot = plotW / rows.length
  const barW = Math.min(56, slot * 0.55)
  const yTicks = [min, (min + paddedMax) / 2, paddedMax]

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="各种子均值对比条形图">
      {yTicks.map((tick, index) => {
        const y = yAt(tick)
        return (
          <g key={`y-${index}`}>
            <line
              x1={left}
              y1={y}
              x2={left + plotW}
              y2={y}
              stroke="var(--rc-border)"
              strokeWidth="1"
              strokeDasharray="4 4"
            />
            <text
              x={left - 6}
              y={y + 3}
              fill="var(--rc-text-subtle)"
              fontSize="10"
              textAnchor="end"
            >
              {formatNumber(tick)}
            </text>
          </g>
        )
      })}
      <line
        x1={left}
        y1={yAt(min)}
        x2={left + plotW}
        y2={yAt(min)}
        stroke="var(--rc-text-subtle)"
        strokeWidth="1"
      />
      <line x1={left} y1={top} x2={left} y2={top + plotH} stroke="var(--rc-text-subtle)" strokeWidth="1" />
      {rows.map((row, index) => {
        const centerX = left + slot * (index + 0.5)
        const barY = yAt(Math.max(row.mean, min))
        const barH = Math.max(1, Math.abs(yAt(row.mean) - yAt(min)))
        const seedLabel = row.seed.length > 10 ? `${row.seed.slice(0, 9)}…` : row.seed
        return (
          <g key={`${row.seed}-${index}`}>
            <rect
              x={centerX - barW / 2}
              y={barY}
              width={barW}
              height={barH}
              rx="2"
              fill="var(--rc-violet)"
              stroke="var(--rc-violet)"
              strokeWidth="1"
            />
            {row.std !== null && (
              <line
                x1={centerX}
                y1={yAt(row.mean + row.std)}
                x2={centerX}
                y2={yAt(Math.max(0, row.mean - row.std))}
                stroke="var(--rc-text-subtle)"
                strokeWidth="2"
              />
            )}
            <text
              x={centerX}
              y={top + plotH + 16}
              fill="var(--rc-text-muted)"
              fontSize="10"
              textAnchor="middle"
            >
              {seedLabel}
            </text>
          </g>
        )
      })}
      <text
        x={left + plotW / 2}
        y={height - 2}
        fill="var(--rc-text-subtle)"
        fontSize="10"
        textAnchor="middle"
      >
        随机种子
      </text>
      <text
        x="10"
        y={top + plotH / 2}
        fill="var(--rc-text-subtle)"
        fontSize="10"
        textAnchor="middle"
        transform={`rotate(-90 10 ${top + plotH / 2})`}
      >
        均值
      </text>
    </svg>
  )
}

/* ------------------------------------------------------------------ 报告展示 */

function EvidenceBlock({ evidence }: { evidence: StatsEvidence }) {
  return (
    <div className="rc4-evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--rc-text)' }}>
          来源：{evidence.source || '输入'}
        </span>
        <span className="mono text-[10px]" style={{ color: 'var(--rc-text-subtle)' }}>
          {evidence.method || '未标注方法'}
        </span>
      </div>
      <div className="rc4-evidence__pair">
        <div className="min-w-0">
          <p className="text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
            报告值
          </p>
          <pre className="rc4-evidence__pre">{formatJson(evidence.claimed)}</pre>
        </div>
        <div className="min-w-0">
          <p className="text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
            重算值
          </p>
          <pre className="rc4-evidence__pre">{formatJson(evidence.recomputed)}</pre>
        </div>
      </div>
      {evidence.formula && (
        <div className="mt-2">
          <p className="text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
            计算公式
          </p>
          <p
            className="mono mt-1 break-all rounded px-2 py-1 text-[10px] leading-4"
            style={{ backgroundColor: 'var(--rc-surface-3)', color: 'var(--rc-success)' }}
          >
            {evidence.formula}
          </p>
        </div>
      )}
      {evidence.inputs && Object.keys(evidence.inputs).length > 0 && (
        <div className="mt-2">
          <p className="text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
            重算输入
          </p>
          <pre className="rc4-evidence__pre">{formatJson(evidence.inputs)}</pre>
        </div>
      )}
      {evidence.note && (
        <p className="mt-2 text-[11px] leading-5" style={{ color: 'var(--rc-text-subtle)' }}>
          说明：{evidence.note}
        </p>
      )}
    </div>
  )
}

function FindingCard({
  finding,
  index,
  open,
  onToggle,
}: {
  finding: StatsReport['findings'][number]
  index: number
  open: boolean
  onToggle: (key: string) => void
}) {
  const meta = VERDICT_META[finding.verdict] ?? VERDICT_META.verified
  const key = `${finding.rule_id}-${index}`
  return (
    <article className="rc4-panel">
      <div className="rc4-panel__head">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rcw-chip">{finding.rule_id}</span>
          <span className="rc4-list__title">{finding.rule_name}</span>
        </div>
        <VerdictBadge verdict={finding.verdict} label={finding.verdict_label_zh || meta.label} />
      </div>
      <div className="rc4-panel__body">
        <p className="text-sm leading-6" style={{ color: 'var(--rc-text)' }}>
          {finding.message}
        </p>
        <p className="mt-2 text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
          分类：{finding.category} · 置信度：{finding.confidence} · 影响范围：{finding.affects}
        </p>
        {finding.justification && (
          <p className="mt-2 text-xs leading-5" style={{ color: 'var(--rc-text-muted)' }}>
            <span style={{ color: 'var(--rc-text-subtle)' }}>判定依据：</span>
            {finding.justification}
          </p>
        )}
        <details className="group mt-3" open={open}>
          <summary
            className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold"
            style={{ color: 'var(--rc-violet)' }}
            onClick={(event) => {
              event.preventDefault()
              onToggle(key)
            }}
          >
            <Icon name="chevronDown" size="xs" className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            证据明细（{finding.evidence.length} 条）
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {finding.evidence.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                该发现未附带可复算证据。
              </p>
            ) : (
              finding.evidence.map((evidence, evidenceIndex) => (
                <EvidenceBlock key={`evidence-${evidenceIndex}`} evidence={evidence} />
              ))
            )}
          </div>
        </details>
        {finding.suggestion && (
          <p className="mt-3 text-xs leading-5" style={{ color: 'var(--rc-warning)' }}>
            <span style={{ color: 'var(--rc-text-subtle)' }}>复核建议：</span>
            {finding.suggestion}
          </p>
        )}
        <p
          className="mt-3 flex items-center gap-1.5 text-[11px]"
          style={{ color: 'var(--rc-text-subtle)' }}
        >
          <Icon
            name={finding.causal_language_checked ? 'badgeCheck' : 'triangleAlert'}
            size="xs"
            tone={finding.causal_language_checked ? 'success' : 'warning'}
          />
          表述守卫：{finding.causal_language_checked ? '通过，仅陈述统计事实' : '未通过，已转人工复核'}
        </p>
      </div>
    </article>
  )
}

/** 特色交互：可复算统计量总表（检索 + 展开原始结果）。 */
function StatTable({ report }: { report: StatsReport }) {
  const [filter, setFilter] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const rows = useMemo(() => collectStatRows(report), [report])

  const visible = useMemo(() => {
    const keyword = filter.trim().toLowerCase()
    if (!keyword) return rows
    return rows.filter(
      (row) =>
        row.computation.toLowerCase().includes(keyword) ||
        row.statLabel.includes(keyword) ||
        row.stat.toLowerCase().includes(keyword),
    )
  }, [rows, filter])

  return (
    <section className="rc4-panel">
      <div className="rc4-panel__head">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h3 className="rc4-panel__title">可复算统计量总表</h3>
          <span className="rc4-panel__hint">
            {visible.length} / {rows.length} 项 · 来源 computations
          </span>
        </div>
        <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--rc-text-muted)' }}>
          <Icon name="search" size="xs" tone="subtle" />
          <input
            className="field-input h-8 w-44 text-xs"
            style={{ height: 32 }}
            placeholder="检索计算项或统计量"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            aria-label="检索统计量总表"
          />
        </label>
      </div>
      <div className="rc4-panel__body">
        {rows.length === 0 ? (
          <p className="rc4-list__meta">
            后端未返回可复算数值；此处不补造任何统计量。
          </p>
        ) : visible.length === 0 ? (
          <EmptyState compact title="没有匹配的计算项" description="换一个关键词再试。" />
        ) : (
          <div className="rc4-table-wrap">
            <table className="rc4-table">
              <thead>
                <tr>
                  <th>计算项</th>
                  <th>统计量</th>
                  <th>数值</th>
                  <th>原始结果</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const raw = report.computations[row.computation]
                  const rawKey = Object.keys(report.computations).find(
                    (key) => key.replace(/^core\./, '') === row.computation,
                  )
                  return (
                    <tr key={`${row.computation}-${row.stat}`}>
                      <td className="mono">{row.computation}</td>
                      <td>{row.statLabel}</td>
                      <td className="mono">{row.value}</td>
                      <td>
                        <button
                          type="button"
                          className="rcw-chip"
                          aria-expanded={openKey === `${row.computation}-${row.stat}`}
                          onClick={() =>
                            setOpenKey(
                              openKey === `${row.computation}-${row.stat}`
                                ? null
                                : `${row.computation}-${row.stat}`,
                            )
                          }
                        >
                          <Icon
                            name={
                              openKey === `${row.computation}-${row.stat}` ? 'chevronUp' : 'chevronDown'
                            }
                            size="xs"
                          />
                          {openKey === `${row.computation}-${row.stat}` ? '收起' : '展开'}
                        </button>
                        {openKey === `${row.computation}-${row.stat}` && rawKey !== undefined && (
                          <pre className="rc4-evidence__pre mt-2">{formatJson(raw)}</pre>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

function ReportView({
  report,
  histogram,
  ciRows,
  seedRows,
  openEvidence,
  onToggleEvidence,
}: {
  report: StatsReport
  histogram: HistogramData | null
  ciRows: CiRow[]
  seedRows: SeedRow[]
  openEvidence: Record<string, boolean>
  onToggleEvidence: (key: string) => void
}) {
  const scopeKeys = Array.isArray(report.scope.input_keys)
    ? report.scope.input_keys.map((item) => String(item))
    : []
  return (
    <div className="flex flex-col gap-4">
      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <div className="min-w-0">
            <p className="rc4-panel__hint">
              报告编号 <span className="mono">{report.report_id}</span>
            </p>
            <p className="rc4-panel__hint">
              生成时间：{formatTime(report.created_at)} · 版本：{report.version}
            </p>
            {scopeKeys.length > 0 && (
              <p className="rc4-panel__hint">审计范围：{scopeKeys.join('、')}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">阻断项 {report.blocking_count}</StatusBadge>
            <StatusBadge tone="neutral">发现 {report.findings.length} 条</StatusBadge>
          </div>
        </div>
        <div className="rc4-panel__body">
          <div className="rc4-kpis">
            {VERDICT_ORDER.map((verdict) => (
              <div key={verdict} className="rc4-kpi">
                <p className="rc4-kpi__label">{VERDICT_META[verdict].hint}</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <VerdictBadge verdict={verdict} />
                  <span className="rc4-kpi__value text-lg">{report.counts[verdict] ?? 0}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <h3 className="rc4-panel__title">审计发现</h3>
          <span className="rc4-panel__hint">
            每条发现均可展开证据，核对报告值、重算值、公式与输入。
          </span>
        </div>
        <div className="rc4-panel__body">
          {report.findings.length === 0 ? (
            <EmptyState title="暂无发现" description="本次输入未产生审计发现。" compact />
          ) : (
            <div className="flex flex-col gap-3">
              {report.findings.map((finding, index) => (
                <FindingCard
                  key={`${finding.rule_id}-${index}`}
                  finding={finding}
                  index={index}
                  open={Boolean(openEvidence[`${finding.rule_id}-${index}`])}
                  onToggle={onToggleEvidence}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <StatTable report={report} />

      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <h3 className="rc4-panel__title">可复算数据可视化</h3>
          <span className="rc4-panel__hint">全部图形只画真实计算结果</span>
        </div>
        <div className="rc4-panel__body">
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartPanel
              title="样本分布直方图"
              hint={histogram ? `数据来源：${histogram.source}` : '来自分布数据的分箱计数'}
              legend={[{ color: 'var(--rc-success)', label: '频数', shape: 'bar' }]}
              empty={!histogram}
            >
              {histogram && <HistogramChart data={histogram} />}
            </ChartPanel>
            <ChartPanel
              title="置信区间森林图"
              hint="线段为区间，圆点为中心取值"
              legend={[
                { color: 'var(--rc-info)', label: '区间', shape: 'line' },
                { color: 'var(--rc-danger)', label: '中心值', shape: 'dot' },
              ]}
              empty={ciRows.length === 0}
            >
              <ForestChart rows={ciRows} />
            </ChartPanel>
            <ChartPanel
              title="随机种子均值对比"
              hint="细线表示组内标准差；缺失则不绘制"
              legend={[
                { color: 'var(--rc-violet)', label: '各种子均值', shape: 'bar' },
                { color: 'var(--rc-text-subtle)', label: '组内标准差', shape: 'line' },
              ]}
              empty={seedRows.length === 0}
            >
              <SeedChart rows={seedRows} />
            </ChartPanel>
          </div>
        </div>
      </section>

      <section className="rcw-note rcw-note--warn">
        <Icon name="triangleAlert" size="sm" tone="warning" />
        <div>
          <p className="font-semibold">边界声明与未验证项</p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-xs leading-5">
            {report.limitations.map((item, index) => (
              <li key={`limitation-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}

function ComputeResultView({
  result,
  operation,
}: {
  result: StatsComputeResult
  operation: string
}) {
  const values = asRecord(result.values) ?? {}
  return (
    <section className="rc4-panel">
      <div className="rc4-panel__head">
        <h3 className="rc4-panel__title">计算结果</h3>
        <StatusBadge tone={result.supported ? 'success' : 'warning'}>
          {result.supported ? '计算完成' : '未计算'}
        </StatusBadge>
      </div>
      <div className="rc4-panel__body">
        <p className="rc4-list__meta">
          原语：<span className="mono">{operation}</span>
          {result.method ? ` · 方法：${result.method}` : ''}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rc4-kpi">
            <p className="rc4-kpi__label">主结果</p>
            <pre className="rc4-evidence__pre mt-1">{formatJson(result.value ?? null)}</pre>
          </div>
          <div className="rc4-kpi">
            <p className="rc4-kpi__label">附加数值</p>
            <pre className="rc4-evidence__pre mt-1">{formatJson(values)}</pre>
          </div>
        </div>
        <div className="mt-3 rc4-kpi">
          <p className="rc4-kpi__label">计算公式</p>
          <p className="mono mt-1 break-all text-xs leading-5" style={{ color: 'var(--rc-text)' }}>
            {result.formula || '该原语未提供公式。'}
          </p>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rc4-kpi">
            <p className="rc4-kpi__label">重算输入</p>
            <pre className="rc4-evidence__pre mt-1">{formatJson(result.inputs)}</pre>
          </div>
          <div className="rc4-kpi">
            <p className="rc4-kpi__label">说明</p>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--rc-text-muted)' }}>
              {result.note || '该原语未提供额外说明。'}
            </p>
          </div>
        </div>
        {!result.supported && (
          <p
            className="mt-3 rounded px-3 py-2 text-xs leading-5"
            style={{ backgroundColor: 'var(--rc-warning-wash)', color: 'var(--rc-warning)' }}
          >
            当前参数下未返回可用数值，请核对参数后重试；不会补造结果。
          </p>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 页面主体 */

export default function StatsAuditPage() {
  const [mode, setMode] = useState<Mode>('full')
  const [auditInput, setAuditInput] = useState(SAMPLE_JSON)
  const [kwargsInput, setKwargsInput] = useState(DEFAULT_KWARGS)
  const [operation, setOperation] = useState('mean')
  const [openEvidence, setOpenEvidence] = useState<Record<string, boolean>>({})

  const catalogQuery = useQuery({
    queryKey: ['stats-audit', 'catalog'],
    queryFn: statsApi.catalog,
    retry: 1,
  })
  const operations = useMemo(() => {
    const fromCatalog = catalogQuery.data?.operations ?? []
    return fromCatalog.length > 0 ? fromCatalog : FALLBACK_OPERATIONS
  }, [catalogQuery.data])
  const selectedOperation = operations.includes(operation) ? operation : operations[0] ?? 'mean'

  const auditMutation = useMutation({
    mutationFn: () => statsApi.run(parseObject(auditInput, '实验统计输入')),
    onError: (error) => toast.error(`运行审计失败：${errorMessage(error)}`),
  })
  const computeMutation = useMutation({
    mutationFn: () => statsApi.compute(selectedOperation, parseObject(kwargsInput, '计算参数')),
    onError: (error) => toast.error(`计算失败：${errorMessage(error)}`),
  })

  const report = auditMutation.data
  const histogram = useMemo(() => (report ? collectHistogram(report) : null), [report])
  const ciRows = useMemo(() => (report ? collectCiRows(report) : []), [report])
  const seedRows = useMemo(() => (report ? collectSeedRows(report) : []), [report])

  const toggleEvidence = (key: string) => {
    setOpenEvidence((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  return (
    <div className="rc4-page">
      <PageHeader
        title="统计学审计"
        description="检查实验结果是否有合理的统计支撑（不替代人工判断）"
      />

      <div className="rc4-rail" role="tablist" aria-label="审计模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'full'}
          onClick={() => setMode('full')}
          className="rc4-rail__item"
          style={
            mode === 'full'
              ? { borderColor: 'var(--rc-magenta)', backgroundColor: 'var(--rc-accent-wash)' }
              : undefined
          }
        >
          <FlaskConical size={14} />
          完整审计
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'compute'}
          onClick={() => setMode('compute')}
          className="rc4-rail__item"
          style={
            mode === 'compute'
              ? { borderColor: 'var(--rc-magenta)', backgroundColor: 'var(--rc-accent-wash)' }
              : undefined
          }
        >
          <Calculator size={14} />
          单原语计算
        </button>
      </div>

      {mode === 'full' ? (
        <>
          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <div className="min-w-0">
                <h3 className="rc4-panel__title">完整审计输入</h3>
                <p className="rc4-panel__hint">
                  填写实验统计 JSON；缺失字段记为证据不足，不补造数值。
                </p>
              </div>
              <button type="button" className="btn-ghost" onClick={() => setAuditInput(SAMPLE_JSON)}>
                <Icon name="rotate" size="sm" />
                载入示例
              </button>
            </div>
            <div className="rc4-panel__body">
              <label htmlFor="stats-audit-input" className="field-label">
                实验统计 JSON
              </label>
              <textarea
                id="stats-audit-input"
                value={auditInput}
                onChange={(event) => setAuditInput(event.target.value)}
                rows={14}
                spellCheck={false}
                className="field-input mono"
                style={{ height: 'auto' }}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={auditMutation.isPending}
                  onClick={() => auditMutation.mutate()}
                >
                  {auditMutation.isPending ? (
                    <Icon name="rotate" size="sm" className="animate-spin" />
                  ) : (
                    <Icon name="play" size="sm" />
                  )}
                  {auditMutation.isPending ? '审计中…' : '运行审计'}
                </button>
                <span className="text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
                  示例含多次运行、种子分数、两组样本、p 值与指标声称（合成示例，非真实论文数据）。
                </span>
              </div>
            </div>
          </section>

          {auditMutation.isPending && (
            <section className="rc4-panel">
              <LoadingState
                message="正在执行统计审计…"
                hint="全部为可复算的确定性计算，不调用模型。"
                compact
              />
            </section>
          )}
          {auditMutation.isError && (
            <section className="rc4-panel">
              <ErrorState
                message={errorMessage(auditMutation.error)}
                code={errorCode(auditMutation.error)}
                onRetry={() => auditMutation.mutate()}
                compact
              />
            </section>
          )}
          {report && (
            <ReportView
              report={report}
              histogram={histogram}
              ciRows={ciRows}
              seedRows={seedRows}
              openEvidence={openEvidence}
              onToggleEvidence={toggleEvidence}
            />
          )}
          {!report && !auditMutation.isPending && !auditMutation.isError && (
            <section className="rc4-panel">
              <EmptyState
                title="暂无审计结果"
                description="载入示例或填写实验统计 JSON 后，点击「运行审计」查看六类可信度结果。"
                compact
              />
            </section>
          )}
        </>
      ) : (
        <>
          <section className="rc4-panel">
            <div className="rc4-panel__head">
              <div className="min-w-0">
                <h3 className="rc4-panel__title">单原语计算</h3>
                <p className="rc4-panel__hint">返回数值、公式与重算输入，便于独立复核。</p>
              </div>
            </div>
            <div className="rc4-panel__body">
              <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
                <div className="min-w-0">
                  <label htmlFor="stats-operation" className="field-label">
                    计算原语
                  </label>
                  <select
                    id="stats-operation"
                    value={selectedOperation}
                    onChange={(event) => setOperation(event.target.value)}
                    className="field-input"
                  >
                    {operations.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                  {catalogQuery.isError && (
                    <p className="mt-2 text-[11px]" style={{ color: 'var(--rc-warning)' }}>
                      目录加载失败，已显示常用原语。
                    </p>
                  )}
                  <p className="mt-2 text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
                    目录版本：{catalogQuery.data?.version ?? '未加载'}
                  </p>
                </div>
                <div className="min-w-0">
                  <label htmlFor="stats-kwargs" className="field-label">
                    参数 JSON
                  </label>
                  <textarea
                    id="stats-kwargs"
                    value={kwargsInput}
                    onChange={(event) => setKwargsInput(event.target.value)}
                    rows={10}
                    spellCheck={false}
                    className="field-input mono"
                    style={{ height: 'auto' }}
                  />
                  <p className="mt-2 text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
                    不同原语参数不同：均值使用样本数组，检验使用两组样本，种子分析使用分组分数。
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="btn-primary"
                  disabled={computeMutation.isPending}
                  onClick={() => computeMutation.mutate()}
                >
                  {computeMutation.isPending ? (
                    <Icon name="rotate" size="sm" className="animate-spin" />
                  ) : (
                    <Icon name="play" size="sm" />
                  )}
                  {computeMutation.isPending ? '计算中…' : '计算'}
                </button>
              </div>
            </div>
          </section>

          {catalogQuery.isPending && (
            <section className="rc4-panel">
              <LoadingState message="正在加载原语目录…" compact />
            </section>
          )}
          {computeMutation.isPending && (
            <section className="rc4-panel">
              <LoadingState message="正在执行计算…" compact />
            </section>
          )}
          {computeMutation.isError && (
            <section className="rc4-panel">
              <ErrorState
                message={errorMessage(computeMutation.error)}
                code={errorCode(computeMutation.error)}
                onRetry={() => computeMutation.mutate()}
                compact
              />
            </section>
          )}
          {computeMutation.data && (
            <ComputeResultView result={computeMutation.data} operation={selectedOperation} />
          )}
          {!computeMutation.data && !computeMutation.isPending && !computeMutation.isError && (
            <section className="rc4-panel">
              <EmptyState
                title="暂无计算结果"
                description="选择计算原语并填写参数 JSON 后，点击「计算」查看可复算数值。"
                compact
              />
            </section>
          )}
        </>
      )}
    </div>
  )
}
