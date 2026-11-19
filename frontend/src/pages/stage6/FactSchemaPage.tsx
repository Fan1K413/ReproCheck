import { useQuery } from '@tanstack/react-query'
import { Check, Hash, LayoutGrid, Ruler, Search, SearchX } from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import type { FactSchemaField } from '../../types/stage6'

function StatCard({ icon: Icon, label, value }: { icon: typeof Hash; label: string; value: number }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div>
        <p className="mono text-2xl font-semibold leading-tight text-ink">{value}</p>
        <p className="text-xs text-ink-muted">{label}</p>
      </div>
    </div>
  )
}

function FieldCard({ field }: { field: FactSchemaField }) {
  return (
    <article className="panel space-y-2.5 p-4 transition hover:border-accent/50">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
        <p className="mono text-[13px] font-semibold text-accent-dark">{field.field_key}</p>
        {field.is_numeric && <StatusBadge tone="success" dot={false}>数值型</StatusBadge>}
      </div>
      <div>
        <p className="text-sm font-medium text-ink">{field.label}</p>
        <p className="text-xs text-ink-subtle">{field.label_en}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <StatusBadge tone="accent" dot={false}>{field.value_type_label}</StatusBadge>
        {field.unit && <StatusBadge tone="neutral" dot={false}>单位 {field.unit}</StatusBadge>}
      </div>
      {field.aliases.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-subtle">别名（自动映射）</p>
          <div className="flex flex-wrap gap-1">
            {field.aliases.map((alias) => (
              <span key={alias} className="mono rounded bg-canvas px-1.5 py-0.5 text-[10px] leading-4 text-ink-muted ring-1 ring-line">
                {alias}
              </span>
            ))}
          </div>
        </div>
      )}
    </article>
  )
}

export default function FactSchemaPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const schemaQuery = useQuery({ queryKey: ['stage6', 'fact-schema'], queryFn: stage6Api.getFactSchema })

  const data = schemaQuery.data
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="事实字段目录"
        description="科研事实标准化字段 catalog（论文事实与案例事实共用的规范化 schema）。"
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
        <section className="panel"><LoadingState message="正在加载字段目录…" hint="GET /fact-schema" /></section>
      ) : schemaQuery.isError ? (
        <section className="panel">
          <ErrorState
            message={schemaQuery.error.message}
            code={schemaQuery.error instanceof ApiError ? schemaQuery.error.code : undefined}
            onRetry={() => void schemaQuery.refetch()}
          />
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard icon={Hash} label="字段总数" value={schemaQuery.data.total} />
            <StatCard icon={LayoutGrid} label="类别数" value={schemaQuery.data.categories.length} />
            <StatCard icon={Ruler} label="带单位字段数" value={unitCount} />
          </div>

          <section className="panel space-y-3 p-4">
            <div className="relative">
              <Search size={16} strokeWidth={1.8} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
              <input
                className="field-input pl-9"
                placeholder="搜索字段键 / 中文名 / 英文名 / 别名，如 lr、学习率、batch…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="搜索字段"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  category === '' ? 'border-accent bg-accent text-accent-dark' : 'border-line bg-surface text-ink-muted hover:border-accent/50 hover:text-ink'
                }`}
                onClick={() => setCategory('')}
              >
                全部 <span className="mono">{schemaQuery.data.total}</span>
              </button>
              {schemaQuery.data.categories.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                    category === item.key ? 'border-accent bg-accent text-accent-dark' : 'border-line bg-surface text-ink-muted hover:border-accent/50 hover:text-ink'
                  }`}
                  onClick={() => setCategory(item.key)}
                >
                  {item.label} <span className="mono">{item.field_count}</span>
                </button>
              ))}
            </div>
          </section>

          {groups.length === 0 ? (
            <section className="panel">
              <EmptyState
                icon={SearchX}
                title="未找到匹配字段"
                description="尝试其他关键词或切换类别；未收录字段在录入时会自动降级为 snake_case 键，不丢弃信息。"
                action={
                  <button type="button" className="btn-ghost" onClick={() => { setSearch(''); setCategory('') }}>
                    清除筛选
                  </button>
                }
              />
            </section>
          ) : (
            groups.map((group) => (
              <section key={group.key} className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">{group.label}</h3>
                  <span className="mono rounded bg-navy-100 px-1.5 py-0.5 text-[10px] text-navy-800">{group.key}</span>
                  <StatusBadge tone="neutral" dot={false}>{group.fields.length} 个字段</StatusBadge>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.fields.map((field) => <FieldCard key={field.field_key} field={field} />)}
                </div>
              </section>
            ))
          )}

          <section className="panel">
            <div className="panel-header">
              <h3 className="text-sm font-semibold">归一化规则</h3>
              <StatusBadge tone="neutral" dot={false}>确定性纯规则 · 不调用大模型</StatusBadge>
            </div>
            <ul className="grid gap-2.5 p-5 sm:grid-cols-2">
              {schemaQuery.data.normalization_rules.map((rule, index) => (
                <li key={`${rule}-${index}`} className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
                  <Check size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-success" /> {rule}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}