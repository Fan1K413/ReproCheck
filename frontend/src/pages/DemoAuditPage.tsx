/**
 * Wave E · 审计演示（/demo/audit）
 * --------------------------------------------------------------------------
 * 设计：动态透视卡片 —— 后端返回的真实结果被组织成多个「分析方案」，
 *      方案之间沿透视轴滑入滑出（400ms / --rc-dur-slow + --rc-ease-out），
 *      每个方案内部是「材料 A ↔ 材料 B」双层透视对比（3D 倾角 4° ≤ 6°）。
 * 数据：全部来自 api.demoAudit 的真实返回（materials / extracted_facts /
 *      comparisons / findings / evidence / llm_meta），无任何伪造数据。
 */
import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  Braces,
  CheckCircle2,
  Info,
  ScanSearch,
} from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { StatusBadge } from '../components/StatusBadge'
import { displayValue, formatCount, formatDuration } from '../features/format'
import { comparisonMeta, severityTone } from '../features/llm'
import { useElapsed } from '../hooks/useElapsed'
import { ApiError, api } from '../services/api'
import { useAuditStore } from '../stores/auditStore'
import '../styles/wave-e-model.css'
import type { Comparison, Evidence, ExtractedFact } from '../types/api'

/* 官方合成测试材料 —— 非真实论文 */
const DEFAULT_MATERIAL_A =
  '研究实验使用 Batch Size 为 64，Learning Rate 为 0.001，训练轮数为 100 epochs，优化器为 AdamW。'
const DEFAULT_MATERIAL_B = `batch_size: 32
learning_rate: 0.0001
epochs: 100
optimizer: AdamW`

type SchemeKey = 'extract' | 'compare' | 'risk'

const SCHEMES: { key: SchemeKey; label: string; hint: string }[] = [
  { key: 'extract', label: '方案一 · 结构化参数抽取', hint: '材料 A ↔ 材料 B 抽取结果' },
  { key: 'compare', label: '方案二 · 参数一致性比对', hint: '基准值 ↔ 复现值逐字段对照' },
  { key: 'risk', label: '方案三 · 风险与证据', hint: '风险说明 ↔ 证据原文' },
]

const factColumns: Column<ExtractedFact>[] = [
  {
    key: 'field',
    header: '字段',
    render: (fact) => (
      <div className="min-w-0">
        <p className="rc-we-mono text-[13px] font-medium">{fact.field_key}</p>
        <p className="rc-we-mono mt-0.5 text-[10px] text-ink-subtle">{fact.evidence_chunk_id}</p>
      </div>
    ),
  },
  {
    key: 'raw',
    header: '原值',
    render: (fact) => <span className="rc-we-mono text-[13px]">{fact.raw_value}</span>,
  },
  {
    key: 'normalized',
    header: '标准值',
    render: (fact) => (
      <span className="rc-we-mono text-[13px]">{displayValue(fact.normalized_value, fact.unit)}</span>
    ),
  },
  {
    key: 'confidence',
    header: '置信度',
    align: 'right',
    render: (fact) => (
      <span className="rc-we-mono text-[12px] text-ink-muted">
        {Number.isFinite(fact.confidence) ? fact.confidence.toFixed(2) : '—'}
      </span>
    ),
  },
]

function SpecLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rc-we-spec">
      <span className="rc-we-spec__k">{label}</span>
      <div className="rc-we-spec__v">{children}</div>
    </div>
  )
}

export default function DemoAuditPage() {
  const [materialA, setMaterialA] = useState(DEFAULT_MATERIAL_A)
  const [materialB, setMaterialB] = useState(DEFAULT_MATERIAL_B)
  const [scheme, setScheme] = useState<SchemeKey>('extract')
  const [moving, setMoving] = useState(false)
  const setLastResult = useAuditStore((state) => state.setLastResult)
  const mutation = useMutation({ mutationFn: api.demoAudit })
  const elapsed = useElapsed(mutation.isPending)

  const result = mutation.data
  const apiError = mutation.error as ApiError | null

  const materialNames = useMemo(() => {
    if (!result) return new Map<string, string>()
    return new Map(result.materials.map((item) => [item.material_id, item.source_name]))
  }, [result])

  const evidences = useMemo(() => {
    if (!result) return [] as Evidence[]
    const seen = new Set<string>()
    const collected: Evidence[] = []
    for (const finding of result.findings) {
      for (const evidence of finding.evidence) {
        if (!seen.has(evidence.evidence_id)) {
          seen.add(evidence.evidence_id)
          collected.push(evidence)
        }
      }
    }
    return collected
  }, [result])

  /** 材料 A / B 与其抽取结果：优先按 material_id 对齐，缺失时退回顺序对齐。 */
  const materialPairs = useMemo(() => {
    if (!result) return null
    const [first, second] = result.materials
    const factsOf = (materialId: string | undefined, fallbackIndex: number) =>
      result.extracted_facts.find((group) => group.material_id === materialId) ??
      result.extracted_facts[fallbackIndex] ??
      null
    return {
      a: { material: first ?? null, facts: factsOf(first?.material_id, 0) },
      b: { material: second ?? null, facts: factsOf(second?.material_id, 1) },
    }
  }, [result])

  function submit() {
    mutation.mutate(
      {
        project_name: '合成材料审计演示',
        material_a_text: materialA,
        material_b_text: materialB,
        use_default_materials: false,
      },
      { onSuccess: (data) => setLastResult(data) },
    )
  }

  function restoreDefaults() {
    setMaterialA(DEFAULT_MATERIAL_A)
    setMaterialB(DEFAULT_MATERIAL_B)
  }

  function selectScheme(next: SchemeKey) {
    if (next === scheme) return
    setScheme(next)
    setMoving(true)
    window.setTimeout(() => setMoving(false), 420)
  }

  const metaItems = result
    ? [
        { label: 'LLM 调用次数', value: formatCount(result.llm_meta.calls) },
        { label: 'Token 总量', value: formatCount(result.llm_meta.total_tokens) },
        { label: '调用耗时', value: formatDuration(result.llm_meta.duration_ms) },
        { label: '使用模型', value: result.llm_meta.model },
      ]
    : []

  const comparisonRows: Comparison[] = result?.comparisons ?? []

  return (
    <div className="rc-we-page">
      <header className="rc-we-head">
        <div className="rc-we-head__text">
          <p className="rc-we-eyebrow">Demo Audit · 审计演示</p>
          <h1 className="rc-we-title">审计演示</h1>
          <p className="rc-we-lead">
            对两段材料执行结构化参数抽取与一致性比对，所有结果均由后端分析实时返回。
            分析完成后可在多个分析方案之间透视切换，查看同一批结果的不同切面。
          </p>
        </div>
      </header>

      <div className="rc-we-grid rc-we-grid--2">
        {[
          {
            key: 'material-a',
            label: '材料 A',
            file: 'paper_excerpt.txt',
            value: materialA,
            onChange: setMaterialA,
          },
          {
            key: 'material-b',
            label: '材料 B',
            file: 'config.yaml',
            value: materialB,
            onChange: setMaterialB,
          },
        ].map((item) => (
          <section key={item.key} className="rc-we-card">
            <div className="rc-we-card__head">
              <h2 className="rc-we-card__title">
                <Icon name="file" size="md" tone="accent" />
                {item.label}
                <span className="rc-we-mono" style={{ fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-subtle)' }}>
                  {item.file}
                </span>
              </h2>
            </div>
            <div className="rc-we-card__body rc-we-card__body--tight">
              <textarea
                className="field-input mono min-h-[160px] resize-y text-[13px] leading-relaxed"
                value={item.value}
                onChange={(event) => item.onChange(event.target.value)}
                spellCheck={false}
                aria-label={`${item.label} 内容`}
              />
              <p className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--rc-warning)' }}>
                <Icon name="triangleAlert" size="xs" />
                合成测试材料，非真实论文
              </p>
            </div>
          </section>
        ))}
      </div>

      <section className="rc-we-card">
        <div className="rc-we-card__body rc-we-card__body--tight">
          <div className="rc-we-row-between">
            <p style={{ maxWidth: '36rem', fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
              开始分析将调用后端 LLM 服务，对输入材料进行参数抽取、一致性比对与风险说明。
            </p>
            <div className="rc-we-row" style={{ gap: 'var(--rc-space-2)' }}>
              <button type="button" className="btn-ghost" onClick={restoreDefaults} disabled={mutation.isPending}>
                <Icon name="rotate" size="sm" />
                恢复默认材料
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={submit}
                disabled={mutation.isPending || !materialA.trim() || !materialB.trim()}
              >
                {mutation.isPending ? (
                  <>
                    <Icon name="loader" size="sm" className="animate-spin" />
                    分析中…
                  </>
                ) : (
                  <>
                    <Icon as={ScanSearch} size="sm" />
                    开始分析
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </section>

      {mutation.isPending && (
        <div className="rc-we-card" role="status" aria-live="polite">
          <div className="rc-we-card__body" style={{ padding: 'var(--rc-space-8)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  display: 'grid',
                  placeItems: 'center',
                  width: 48,
                  height: 48,
                  borderRadius: 'var(--rc-radius-disc)',
                  backgroundColor: 'var(--rc-accent-wash)',
                  color: 'var(--rc-violet)',
                }}
              >
                <Icon name="loader" size="xl" className="animate-spin" />
              </div>
              <p style={{ marginTop: 'var(--rc-space-4)', fontWeight: 'var(--rc-fw-sb)' }}>
                AI 正在抽取结构化信息…
              </p>
              <p className="rc-we-mono" style={{ marginTop: 4, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                已等待 {elapsed.toFixed(1)} s
              </p>
            </div>
          </div>
        </div>
      )}

      {mutation.isError && (
        <section className="rc-we-card">
          <div className="rc-we-card__body">
            <ErrorState
              message={apiError?.message ?? '分析失败，请稍后重试。'}
              code={apiError?.code}
              onRetry={submit}
            />
          </div>
        </section>
      )}

      {mutation.isSuccess && result && (
        <div className="rc-we-stack">
          {/* ---------- 运行元信息 ---------- */}
          <section className="rc-we-card">
            <div className="rc-we-card__head">
              <h2 className="rc-we-card__title">
                <Icon name="flask" size="md" tone="accent" />
                运行元信息
              </h2>
              <StatusBadge tone={result.status === 'completed' || result.status === 'success' ? 'success' : 'neutral'}>
                {result.status}
              </StatusBadge>
            </div>
            <div className="rc-we-card__body">
              <SpecLine label="运行 ID">
                <span className="rc-we-spec__v--mono">{result.run_id}</span>
              </SpecLine>
              <div className="rc-we-grid rc-we-grid--4" style={{ marginTop: 'var(--rc-space-4)' }}>
                {metaItems.map((item) => (
                  <div key={item.label} className="rc-we-kpi">
                    <p className="rc-we-kpi__k">{item.label}</p>
                    <p className="rc-we-kpi__v" title={item.value}>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ---------- 方案透视卡组 ---------- */}
          <div className="rc-we-deck">
            <div className="rc-we-row-between">
              <div>
                <p className="rc-we-eyebrow">Analysis Schemes · 分析方案</p>
                <p className="rc-we-lead" style={{ marginTop: 4 }}>
                  同一批后端结果的三种切面，切换时沿透视轴滑入滑出。
                </p>
              </div>
            </div>

            <div className="rc-we-deck__tabs" role="tablist" aria-label="分析方案切换">
              {SCHEMES.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={scheme === item.key}
                  className="rc-we-tab"
                  onClick={() => selectScheme(item.key)}
                  title={item.hint}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="rc-we-deck__stage">
              {/* 方案一：结构化参数抽取 */}
              <article
                className={`rc-we-deck__card${moving ? ' is-moving' : ''}`}
                data-depth={scheme === 'extract' ? 0 : 1}
                aria-hidden={scheme !== 'extract'}
              >
                <div className="rc-we-deck__panel rc-we-deck__panel--glass">
                  <div className="rc-we-deck__panelhead">
                    <h3 className="rc-we-deck__paneltitle">
                      <Icon as={Braces} size="md" tone="accent" />
                      结构化参数抽取
                    </h3>
                    <StatusBadge tone="accent">
                      {result.extracted_facts.reduce((total, group) => total + group.facts.length, 0)} 项
                    </StatusBadge>
                  </div>
                  <div className="rc-we-deck__panelbody">
                    {result.extracted_facts.length === 0 ? (
                      <EmptyState compact title="未抽取到结构化参数" />
                    ) : (
                      <div className="rc-we-duo">
                        <div className="rc-we-duo__card rc-we-duo__card--front is-entering">
                          <p className="rc-we-duo__label">
                            <Icon name="file" size="xs" />
                            材料 A · {materialPairs?.a.material?.source_name ?? materialNames.get(materialPairs?.a.facts?.material_id ?? '') ?? '—'}
                          </p>
                          <p className="rc-we-duo__value">{materialPairs?.a.facts?.facts.length ?? 0} 项参数</p>
                          <div style={{ marginTop: 'var(--rc-space-4)' }}>
                            <DataTable
                              columns={factColumns}
                              data={materialPairs?.a.facts?.facts ?? []}
                              rowKey={(fact) => `a-${fact.field_key}`}
                              empty={<EmptyState compact title="材料 A 未抽取到参数" />}
                            />
                          </div>
                        </div>
                        <div className="rc-we-duo__card rc-we-duo__card--back">
                          <p className="rc-we-duo__label">
                            <Icon name="file" size="xs" />
                            材料 B · {materialPairs?.b.material?.source_name ?? materialNames.get(materialPairs?.b.facts?.material_id ?? '') ?? '—'}
                          </p>
                          <p className="rc-we-duo__value">{materialPairs?.b.facts?.facts.length ?? 0} 项参数</p>
                          <div style={{ marginTop: 'var(--rc-space-4)' }}>
                            <DataTable
                              columns={factColumns}
                              data={materialPairs?.b.facts?.facts ?? []}
                              rowKey={(fact) => `b-${fact.field_key}`}
                              empty={<EmptyState compact title="材料 B 未抽取到参数" />}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>

              {/* 方案二：参数一致性比对 */}
              <article
                className={`rc-we-deck__card${moving ? ' is-moving' : ''}`}
                data-depth={scheme === 'compare' ? 0 : 1}
                aria-hidden={scheme !== 'compare'}
              >
                <div className="rc-we-deck__panel rc-we-deck__panel--glass">
                  <div className="rc-we-deck__panelhead">
                    <h3 className="rc-we-deck__paneltitle">
                      <Icon as={ScanSearch} size="md" tone="accent" />
                      参数一致性比对
                    </h3>
                    <StatusBadge tone="neutral">{comparisonRows.length} 个字段</StatusBadge>
                  </div>
                  <div className="rc-we-deck__panelbody">
                    {comparisonRows.length === 0 ? (
                      <EmptyState compact title="暂无比较结果" />
                    ) : (
                      <div className="rc-we-duo">
                        <div className="rc-we-duo__card rc-we-duo__card--front is-entering">
                          <p className="rc-we-duo__label">
                            <Icon name="file" size="xs" />
                            基准值 · 材料 A
                          </p>
                          <ul className="rc-we-stack-tight" style={{ margin: 'var(--rc-space-4) 0 0', padding: 0, listStyle: 'none' }}>
                            {comparisonRows.map((row) => (
                              <li key={row.field_key} className="rc-we-spec" style={{ padding: 'var(--rc-space-2) 0' }}>
                                <span className="rc-we-spec__k">
                                  {row.label}
                                  <span className="rc-we-mono" style={{ marginLeft: 6, fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-subtle)' }}>
                                    {row.field_key}
                                  </span>
                                </span>
                                <span className="rc-we-spec__v rc-we-spec__v--mono">{displayValue(row.value_a)}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div className="rc-we-duo__card rc-we-duo__card--back">
                          <p className="rc-we-duo__label">
                            <Icon name="file" size="xs" />
                            复现值 · 材料 B
                          </p>
                          <ul className="rc-we-stack-tight" style={{ margin: 'var(--rc-space-4) 0 0', padding: 0, listStyle: 'none' }}>
                            {comparisonRows.map((row) => (
                              <li key={row.field_key} className="rc-we-spec" style={{ padding: 'var(--rc-space-2) 0' }}>
                                <span className="rc-we-spec__k">
                                  {row.label}
                                  <span className="rc-we-mono" style={{ marginLeft: 6, fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-subtle)' }}>
                                    {row.evidence_b_id ?? row.evidence_a_id ?? '—'}
                                  </span>
                                </span>
                                <span className="rc-we-spec__v" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                                  <span className="rc-we-spec__v--mono">{displayValue(row.value_b)}</span>
                                  <StatusBadge tone={comparisonMeta[row.status].tone}>
                                    {comparisonMeta[row.status].label}
                                  </StatusBadge>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>

              {/* 方案三：风险与证据 */}
              <article
                className={`rc-we-deck__card${moving ? ' is-moving' : ''}`}
                data-depth={scheme === 'risk' ? 0 : 1}
                aria-hidden={scheme !== 'risk'}
              >
                <div className="rc-we-deck__panel rc-we-deck__panel--glass">
                  <div className="rc-we-deck__panelhead">
                    <h3 className="rc-we-deck__paneltitle">
                      <Icon name="triangleAlert" size="md" tone="accent" />
                      风险说明与证据原文
                    </h3>
                    <StatusBadge tone={result.findings.length > 0 ? 'danger' : 'success'}>
                      {result.findings.length} 项风险 · {evidences.length} 条证据
                    </StatusBadge>
                  </div>
                  <div className="rc-we-deck__panelbody">
                    <div className="rc-we-duo">
                      <div className="rc-we-duo__card rc-we-duo__card--front is-entering">
                        <p className="rc-we-duo__label">
                          <Icon name="triangleAlert" size="xs" />
                          风险说明
                        </p>
                        {result.findings.length === 0 ? (
                          <div style={{ marginTop: 'var(--rc-space-4)' }}>
                            <EmptyState compact icon={CheckCircle2} title="未发现风险项" />
                          </div>
                        ) : (
                          <ul className="rc-we-stack-tight" style={{ margin: 'var(--rc-space-4) 0 0', padding: 0, listStyle: 'none' }}>
                            {result.findings.map((finding) => (
                              <li key={finding.finding_id} className="rc-we-card" style={{ boxShadow: 'none' }}>
                                <div className="rc-we-card__body rc-we-card__body--tight">
                                  <div className="rc-we-row-between">
                                    <p style={{ fontWeight: 'var(--rc-fw-sb)', lineHeight: 1.4 }}>{finding.title}</p>
                                    <StatusBadge tone={severityTone(finding.severity)}>{finding.severity}</StatusBadge>
                                  </div>
                                  <p className="rc-we-mono" style={{ marginTop: 4, fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-subtle)' }}>
                                    {finding.field_key}
                                  </p>
                                  <p style={{ marginTop: 8, fontSize: 'var(--rc-fs-body)', lineHeight: 1.6, color: 'var(--rc-text-muted)' }}>
                                    {finding.ai_explanation}
                                  </p>
                                  {finding.evidence.length > 0 && (
                                    <p style={{ marginTop: 8, fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                                      关联证据 {finding.evidence.length} 条
                                    </p>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="rc-we-duo__card rc-we-duo__card--back">
                        <p className="rc-we-duo__label">
                          <Icon name="scroll" size="xs" />
                          证据原文
                        </p>
                        {evidences.length === 0 ? (
                          <div style={{ marginTop: 'var(--rc-space-4)' }}>
                            <EmptyState compact title="暂无证据片段" />
                          </div>
                        ) : (
                          <ul className="rc-we-stack-tight" style={{ margin: 'var(--rc-space-4) 0 0', padding: 0, listStyle: 'none' }}>
                            {evidences.map((evidence) => (
                              <li key={evidence.evidence_id} className="rc-we-card" style={{ boxShadow: 'none' }}>
                                <div className="rc-we-card__body rc-we-card__body--tight">
                                  <div className="rc-we-row" style={{ gap: 'var(--rc-space-2)' }}>
                                    <span style={{ fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-sb)' }}>
                                      {evidence.source_name}
                                    </span>
                                    <span className="rc-we-mono" style={{ fontSize: 'var(--rc-fs-micro)', color: 'var(--rc-text-muted)' }}>
                                      {evidence.chunk_id}
                                    </span>
                                  </div>
                                  <blockquote
                                    className="rc-we-mono"
                                    style={{
                                      margin: 'var(--rc-space-2) 0 0',
                                      paddingLeft: 'var(--rc-space-3)',
                                      borderLeft: '2px solid var(--rc-violet)',
                                      fontSize: '13px',
                                      lineHeight: 1.6,
                                      color: 'var(--rc-text-muted)',
                                    }}
                                  >
                                    {evidence.original_text}
                                  </blockquote>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
          </div>
        </div>
      )}

      {!mutation.isPending && !mutation.isError && !result && (
        <section className="rc-we-card">
          <div className="rc-we-card__body">
            <EmptyState
              icon={ScanSearch}
              title="尚未运行审计"
              description="确认两段材料后点击「开始分析」，抽取结果、一致性比较与风险说明将显示在这里。"
            />
          </div>
        </section>
      )}

      <div className="rc-we-note">
        <Icon as={Info} size="md" className="rc-we-note__icon" />
        <div>
          <p className="rc-we-note__title">演示数据说明</p>
          <p>
            页面内置的是<strong>合成测试材料</strong>（非真实论文），用于展示抽取与比对链路；
            所有结构化结果与风险说明均由后端 LLM 实时生成，页面不预置任何结论。
          </p>
        </div>
      </div>
    </div>
  )
}
