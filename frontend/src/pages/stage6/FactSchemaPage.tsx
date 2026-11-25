import { useQuery } from '@tanstack/react-query'
import { Hash, LayoutGrid, Ruler, SearchX, Tags } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { LoadingState } from '../../components/LoadingState'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import type { FactSchemaField } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/* --------------------------------------------------------------------------
 * 扇形字段关系（global-design-system.md §4 「数据集 / 结构可视化」语言的变体）
 * 扇区角度严格 ∝ 真实 field_count，绝不画装饰比例；字段扇出动画 180ms。
 * ------------------------------------------------------------------------ */

const WHEEL_SIZE = 420
const WHEEL_CENTER = WHEEL_SIZE / 2
const WHEEL_RADIUS = 148
const WHEEL_INNER = 62

type Sector = {
  key: string
  label: string
  count: number
  ratio: number
  start: number
  end: number
  path: string
  labelPos: { x: number; y: number }
}

function polar(radius: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: WHEEL_CENTER + radius * Math.cos(rad), y: WHEEL_CENTER + radius * Math.sin(rad) }
}

function buildSectors(categories: { key: string; label: string; field_count: number }[]): Sector[] {
  const total = categories.reduce((sum, item) => sum + item.field_count, 0)
  if (total === 0) return []
  let cursor = 0
  return categories.map((item) => {
    const ratio = item.field_count / total
    const start = cursor
    const end = cursor + ratio * 360
    cursor = end
    const outerStart = polar(WHEEL_RADIUS, start)
    const outerEnd = polar(WHEEL_RADIUS, end)
    const innerStart = polar(WHEEL_INNER, start)
    const innerEnd = polar(WHEEL_INNER, end)
    const largeArc = ratio > 0.5 ? 1 : 0
    const path = [
      `M ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      `L ${outerStart.x.toFixed(2)} ${outerStart.y.toFixed(2)}`,
      `A ${WHEEL_RADIUS} ${WHEEL_RADIUS} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)} ${outerEnd.y.toFixed(2)}`,
      `L ${innerEnd.x.toFixed(2)} ${innerEnd.y.toFixed(2)}`,
      `A ${WHEEL_INNER} ${WHEEL_INNER} 0 ${largeArc} 0 ${innerStart.x.toFixed(2)} ${innerStart.y.toFixed(2)}`,
      'Z',
    ].join(' ')
    const mid = polar((WHEEL_RADIUS + WHEEL_INNER) / 2 + 12, (start + end) / 2)
    return { key: item.key, label: item.label, count: item.field_count, ratio, start, end, path, labelPos: mid }  })
}

function StatCard({ icon, label, value }: { icon: typeof Hash; label: string; value: number }) {
  return (
    <div className="rcw-kpi">
      <span className="rcw-kpi-icon"><Icon as={icon} size="sm" /></span>
      <div className="min-w-0">
        <p className="rcw-kpi-value">{value}</p>
        <p className="rcw-kpi-label">{label}</p>
      </div>
    </div>
  )
}

function FieldCard({ field, index }: { field: FactSchemaField; index: number }) {
  return (
    <article
      className="rcw-card rcw-card-tight rcw-fan-item"
      data-open="true"
      style={{ '--rcw-fan-i': Math.min(index, 11) } as CSSProperties}
    >
      <div className="rcw-row-between" style={{ alignItems: 'baseline' }}>
        <p className="mono text-[13px] font-semibold rcw-ink">{field.field_key}</p>
        {field.is_numeric && <StatusBadge tone="success" dot={false}>数值型</StatusBadge>}
      </div>
      <p className="mt-1 text-sm font-medium">{field.label}</p>
      <p className="text-xs rcw-faint">{field.label_en}</p>
      <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)' }}>
        <StatusBadge tone="accent" dot={false}>{field.value_type_label}</StatusBadge>
        {field.unit && <StatusBadge tone="neutral" dot={false}>单位 {field.unit}</StatusBadge>}
        <StatusBadge tone="navy" dot={false}>{field.category_label}</StatusBadge>
      </div>
      {field.aliases.length > 0 && (
        <div style={{ marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
          <p className="rcw-overline" style={{ marginBottom: 'var(--rc-space-2)' }}>字段关系 · 别名自动映射</p>
          <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
            {field.aliases.map((alias) => (
              <span key={alias} className="rcw-chip">{alias}</span>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

export default function FactSchemaPage() {
  const [search, setSearch] = useState('')
  /* categoryOverride = null → 默认聚焦第一个类别；'' → 全部类别；其余为具体类别键 */
  const [categoryOverride, setCategoryOverride] = useState<string | null>(null)
  const schemaQuery = useQuery({ queryKey: ['stage6', 'fact-schema'], queryFn: stage6Api.getFactSchema })

  const data = schemaQuery.data
  const category = categoryOverride ?? data?.categories?.[0]?.key ?? ''
  const keyword = search.trim().toLowerCase()
  const matches = (field: FactSchemaField) =>
    !keyword ||
    [field.field_key, field.label, field.label_en, field.category_label, ...field.aliases].some((text) =>
      text.toLowerCase().includes(keyword),
    )
  const visibleFields = (data?.fields ?? []).filter((field) => matches(field) && (!category || field.category === category))
  const groups = (data?.categories ?? [])
    .map((item) => ({ ...item, fields: visibleFields.filter((field) => field.category === item.key) }))
    .filter((group) => group.fields.length > 0)
  const unitCount = (data?.fields ?? []).filter((field) => field.unit !== '').length
  const aliasCount = (data?.fields ?? []).reduce((sum, field) => sum + field.aliases.length, 0)
  const sectors = buildSectors(data?.categories ?? [])
  const activeSector = sectors.find((s) => s.key === category) ?? null

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="事实字段目录"
          description="标准化科研事实字段目录"
          actions={
            data && (
              <>
                <StatusBadge tone="navy" dot={false}><span className="mono">schema {data.version}</span></StatusBadge>
                <CopyButton text={JSON.stringify({ version: data.version, fields: data.fields }, null, 2)} label="复制目录 JSON" />
              </>
            )
          }
        />

        {schemaQuery.isPending ? (
          <section className="rcw-card"><LoadingState message="正在加载字段目录…" /></section>
        ) : schemaQuery.isError ? (
          <section className="rcw-card">
            <ErrorState
              message={schemaQuery.error.message}
              code={schemaQuery.error instanceof ApiError ? schemaQuery.error.code : undefined}
              onRetry={() => void schemaQuery.refetch()}
            />
          </section>
        ) : (
          <>
            <div className="rcw-grid rcw-grid-4 rc-stagger">
              <StatCard icon={Hash} label="字段总数" value={schemaQuery.data.total} />
              <StatCard icon={LayoutGrid} label="类别数" value={schemaQuery.data.categories.length} />
              <StatCard icon={Ruler} label="带单位字段数" value={unitCount} />
              <StatCard icon={Tags} label="别名关系数" value={aliasCount} />
            </div>

            {/* ---------- 扇形总览 + 字段关系 ---------- */}
            <div className="rcw-fan-wrap">
              <section className="rcw-card rcw-card-tight">
                <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                  <h3 className="text-sm font-semibold">字段扇区</h3>
                  <span className="text-[11px] rcw-faint">
                    {activeSector ? `已选：${activeSector.label}` : '点击扇区展开该类别字段'}
                  </span>
                </div>
                <svg
                  className="rcw-wheel"
                  viewBox={`0 0 ${WHEEL_SIZE} ${WHEEL_SIZE}`}
                  role="group"
                  aria-label="字段类别扇形分布"
                >
                  <circle cx={WHEEL_CENTER} cy={WHEEL_CENTER} r={WHEEL_INNER - 6} fill="var(--rc-surface-2)" stroke="var(--rc-border-hair)" />
                  {sectors.map((sector, index) => {
                    const selected = category === sector.key
                    return (
                      <g key={sector.key}>
                        <path
                          className="rcw-wheel-sector"
                          d={sector.path}
                          role="button"
                          tabIndex={0}
                          aria-pressed={selected}
                          aria-label={`${sector.label}，${sector.count} 个字段，占比 ${(sector.ratio * 100).toFixed(1)}%`}
                          fill="var(--rc-accent)"
                          fillOpacity={selected ? 0.78 : 0.24 + (index % 4) * 0.08}
                          stroke={selected ? 'var(--rc-magenta)' : 'var(--rc-border)'}
                          strokeWidth={selected ? 1.5 : 1}
                          onClick={() => setCategoryOverride(selected ? '' : sector.key)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setCategoryOverride(selected ? '' : sector.key)
                            }
                          }}
                        />
                        {sector.ratio >= 0.08 && (
                          <text
                            className="rcw-wheel-label"
                            x={sector.labelPos.x}
                            y={sector.labelPos.y}
                            textAnchor="middle"
                            dominantBaseline="middle"
                            style={{ pointerEvents: 'none' }}
                          >
                            {sector.label}
                          </text>
                        )}
                      </g>
                    )
                  })}
                  <text className="rcw-wheel-hub-label" x={WHEEL_CENTER} y={WHEEL_CENTER - 6} textAnchor="middle">
                    schema
                  </text>
                  <text
                    x={WHEEL_CENTER}
                    y={WHEEL_CENTER + 14}
                    textAnchor="middle"
                    style={{ fontFamily: 'var(--rc-font-mono)', fontSize: 13, fontWeight: 600, fill: 'var(--rc-text)' }}
                  >
                    {schemaQuery.data.version}
                  </text>
                </svg>
                <ul className="rcw-stack-tight" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {sectors.map((sector) => (
                    <li key={sector.key}>
                      <button
                        type="button"
                        className="rcw-row-between w-full"
                        style={{ gap: 'var(--rc-space-2)', padding: 'var(--rc-space-1) 0', cursor: 'pointer' }}
                        aria-pressed={category === sector.key}
                        onClick={() => setCategoryOverride(category === sector.key ? '' : sector.key)}
                      >
                        <span className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                          <span className="rcw-dot" data-tone={category === sector.key ? 'accent' : 'muted'} aria-hidden="true" />
                          <span className="text-xs">{sector.label}</span>
                        </span>
                        <span className="mono text-[11px] rcw-faint">
                          {sector.count} 字段 · {(sector.ratio * 100).toFixed(1)}%
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="rcw-stack">
                {/* 搜索与类别筛选 */}
                <section className="rcw-card rcw-card-tight">
                  <div className="relative">
                    <Icon name="search" size="xs" tone="subtle" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                    <input
                      className="field-input"
                      style={{ paddingLeft: 36 }}
                      placeholder="搜索字段键 / 中文名 / 英文名 / 别名，如 lr、学习率、batch…"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      aria-label="搜索字段"
                    />
                  </div>
                  <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)' }}>
                    <button
                      type="button"
                      className="rcw-chip rcw-chip-btn"
                      aria-pressed={category === ''}
                      onClick={() => setCategoryOverride('')}
                    >
                      全部 <span className="mono">{schemaQuery.data.total}</span>
                    </button>
                    {schemaQuery.data.categories.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        className="rcw-chip rcw-chip-btn"
                        aria-pressed={category === item.key}
                        onClick={() => setCategoryOverride(category === item.key ? '' : item.key)}
                      >
                        {item.label} <span className="mono">{item.field_count}</span>
                      </button>
                    ))}
                  </div>
                </section>

                {groups.length === 0 ? (
                  <section className="rcw-card">
                    <EmptyState
                      icon={SearchX}
                      title="未找到匹配字段"
                      description="尝试其他关键词或切换类别；未收录字段在录入时会自动降级为 snake_case 键，不丢弃信息。"
                      action={
                        <button type="button" className="btn-ghost" onClick={() => { setSearch(''); setCategoryOverride('') }}>
                          清除筛选
                        </button>
                      }
                    />
                  </section>
                ) : (
                  groups.map((group) => (
                    <section key={group.key} className="rcw-card rcw-card-tight">
                      <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)' }}>
                        <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                          <h3 className="text-sm font-semibold">{group.label}</h3>
                          <span className="rcw-chip">{group.key}</span>
                        </div>
                        <StatusBadge tone="neutral" dot={false}>{group.fields.length} 个字段</StatusBadge>
                      </div>
                      <div className="rcw-fan-list">
                        {group.fields.map((field, index) => <FieldCard key={field.field_key} field={field} index={index} />)}
                      </div>
                    </section>
                  ))
                )}
              </div>
            </div>

            {/* ---------- 归一化规则 ---------- */}
            <section className="rcw-card">
              <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
                <h3 className="text-sm font-semibold">归一化规则</h3>
                <StatusBadge tone="neutral" dot={false}>确定性纯规则 · 不调用大模型</StatusBadge>
              </div>
              <ul className="rcw-grid rcw-grid-2" style={{ listStyle: 'none', margin: 0, padding: 'var(--rc-space-4) 0 0' }}>
                {schemaQuery.data.normalization_rules.map((rule, index) => (
                  <li key={`${rule}-${index}`} className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                    <Icon name="check" size="xs" tone="success" style={{ marginTop: 3 }} />
                    <span className="text-xs leading-relaxed rcw-muted">{rule}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
