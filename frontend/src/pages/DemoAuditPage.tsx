import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CheckCircle2,
  FileText,
  FlaskConical,
  Info,
  Loader2,
  RotateCcw,
  ScanSearch,
} from 'lucide-react'
import { DataTable, type Column } from '../components/DataTable'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { StatusBadge } from '../components/StatusBadge'
import { displayValue, formatCount, formatDuration } from '../features/format'
import { comparisonMeta, severityTone } from '../features/llm'
import { useElapsed } from '../hooks/useElapsed'
import { ApiError, api } from '../services/api'
import { useAuditStore } from '../stores/auditStore'
import type { Comparison, Evidence, ExtractedFact } from '../types/api'

/* 官方合成测试材料 —— 非真实论文 */
const DEFAULT_MATERIAL_A =
  '研究实验使用 Batch Size 为 64，Learning Rate 为 0.001，训练轮数为 100 epochs，优化器为 AdamW。'
const DEFAULT_MATERIAL_B = `batch_size: 32
learning_rate: 0.0001
epochs: 100
optimizer: AdamW`

const factColumns: Column<ExtractedFact>[] = [
  {
    key: 'field',
    header: '字段',
    render: (fact) => (
      <div className="min-w-0">
        <p className="mono text-[13px] font-medium text-ink">{fact.field_key}</p>
        <p className="mono mt-0.5 text-[10px] text-ink-subtle">{fact.evidence_chunk_id}</p>
      </div>
    ),
  },
  {
    key: 'raw',
    header: '原值',
    render: (fact) => <span className="mono text-[13px]">{fact.raw_value}</span>,
  },
  {
    key: 'normalized',
    header: '标准值',
    render: (fact) => (
      <span className="mono text-[13px]">{displayValue(fact.normalized_value, fact.unit)}</span>
    ),
  },
  {
    key: 'confidence',
    header: '置信度',
    align: 'right',
    render: (fact) => (
      <span className="mono text-[12px] text-ink-muted">
        {Number.isFinite(fact.confidence) ? fact.confidence.toFixed(2) : '—'}
      </span>
    ),
  },
]

const comparisonColumns: Column<Comparison>[] = [
  {
    key: 'field',
    header: '字段',
    render: (comparison) => (
      <div className="min-w-0">
        <p className="font-medium text-ink">{comparison.label}</p>
        <p className="mono mt-0.5 text-[11px] text-ink-subtle">{comparison.field_key}</p>
      </div>
    ),
  },
  {
    key: 'value_a',
    header: '材料 A 值',
    render: (comparison) => (
      <span className="mono text-[13px]">{displayValue(comparison.value_a)}</span>
    ),
  },
  {
    key: 'value_b',
    header: '材料 B 值',
    render: (comparison) => (
      <span className="mono text-[13px]">{displayValue(comparison.value_b)}</span>
    ),
  },
  {
    key: 'status',
    header: '状态',
    align: 'right',
    render: (comparison) => (
      <StatusBadge tone={comparisonMeta[comparison.status].tone}>
        {comparisonMeta[comparison.status].label}
      </StatusBadge>
    ),
  },
]

export default function DemoAuditPage() {
  const [materialA, setMaterialA] = useState(DEFAULT_MATERIAL_A)
  const [materialB, setMaterialB] = useState(DEFAULT_MATERIAL_B)
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

  const metaItems = result
    ? [
        { label: 'LLM 调用次数', value: formatCount(result.llm_meta.calls) },
        { label: 'Token 总量', value: formatCount(result.llm_meta.total_tokens) },
        { label: '调用耗时', value: formatDuration(result.llm_meta.duration_ms) },
        { label: '使用模型', value: result.llm_meta.model },
      ]
    : []

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">审计演示</h2>
        <p className="mt-1 text-sm text-ink-muted">
          对两段材料执行结构化参数抽取与一致性比对，所有结果均由后端分析实时返回。
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
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
          <section key={item.key} className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={16} className="shrink-0 text-accent-dark" />
                <h3 className="text-sm font-semibold">{item.label}</h3>
                <span className="mono truncate rounded bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">
                  {item.file}
                </span>
              </div>
            </div>
            <div className="p-4">
              <textarea
                className="field-input mono min-h-[160px] resize-y text-[13px] leading-relaxed"
                value={item.value}
                onChange={(event) => item.onChange(event.target.value)}
                spellCheck={false}
                aria-label={`${item.label} 内容`}
              />
              <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                <Info size={13} />
                合成测试材料，非真实论文
              </p>
            </div>
          </section>
        ))}
      </div>

      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-xl text-xs text-ink-muted">
          开始分析将调用后端 LLM 服务，对输入材料进行参数抽取、一致性比对与风险说明。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={restoreDefaults}
            disabled={mutation.isPending}
          >
            <RotateCcw size={15} />
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
                <Loader2 size={16} className="animate-spin" />
                分析中…
              </>
            ) : (
              <>
                <ScanSearch size={16} />
                开始分析
              </>
            )}
          </button>
        </div>
      </div>

      {mutation.isPending && (
        <div className="panel flex flex-col items-center justify-center py-16" role="status" aria-live="polite">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-wash text-accent-dark">
            <Loader2 size={24} className="animate-spin" />
          </div>
          <p className="mt-4 text-sm font-semibold text-ink">AI 正在抽取结构化信息…</p>
          <p className="mono mt-1 text-xs text-ink-subtle">已等待 {elapsed.toFixed(1)} s</p>
        </div>
      )}

      {mutation.isError && (
        <div className="panel">
          <ErrorState
            message={apiError?.message ?? '分析失败，请稍后重试。'}
            code={apiError?.code}
            onRetry={submit}
          />
        </div>
      )}

      {mutation.isSuccess && result && (
        <div className="space-y-4">
          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <FlaskConical size={17} className="text-accent-dark" />
                <h3 className="text-sm font-semibold">运行元信息</h3>
              </div>
              <StatusBadge tone={result.status === 'completed' || result.status === 'success' ? 'success' : 'neutral'}>
                {result.status}
              </StatusBadge>
            </div>
            <div className="p-5">
              <p className="text-xs text-ink-subtle">运行 ID</p>
              <p className="mono mt-0.5 text-sm font-medium text-ink">{result.run_id}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {metaItems.map((item) => (
                  <div key={item.label} className="rounded-md border border-line-soft bg-canvas px-3 py-2">
                    <p className="text-[11px] text-ink-subtle">{item.label}</p>
                    <p className="mono mt-0.5 truncate text-[13px] font-medium text-ink" title={item.value}>
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <div className="flex items-center gap-2">
                <BracesIcon />
                <h3 className="text-sm font-semibold">结构化参数抽取</h3>
              </div>
              <StatusBadge tone="accent">
                {result.extracted_facts.reduce((total, group) => total + group.facts.length, 0)} 项
              </StatusBadge>
            </div>
            {result.extracted_facts.length === 0 ? (
              <EmptyState compact title="未抽取到结构化参数" />
            ) : (
              <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-line">
                {result.extracted_facts.map((group) => (
                  <div key={group.material_id} className="min-w-0">
                    <div className="flex items-center gap-2 border-b border-line-soft bg-canvas px-4 py-2.5">
                      <FileText size={14} className="shrink-0 text-accent-dark" />
                      <span className="truncate text-xs font-semibold text-ink">
                        {materialNames.get(group.material_id) ?? group.material_id}
                      </span>
                      <span className="mono ml-auto shrink-0 text-[11px] text-ink-subtle">
                        {group.facts.length} 项
                      </span>
                    </div>
                    <DataTable
                      columns={factColumns}
                      data={group.facts}
                      rowKey={(fact) => `${group.material_id}-${fact.field_key}`}
                      empty={<EmptyState compact title="该材料未抽取到参数" />}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel overflow-hidden">
            <div className="panel-header">
              <h3 className="text-sm font-semibold">参数一致性比较</h3>
              <StatusBadge tone="neutral">{result.comparisons.length} 个字段</StatusBadge>
            </div>
            <DataTable
              columns={comparisonColumns}
              data={result.comparisons}
              rowKey={(comparison) => comparison.field_key}
              empty={<EmptyState compact title="暂无比较结果" />}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="panel overflow-hidden">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">风险说明</h3>
                <StatusBadge tone={result.findings.length > 0 ? 'danger' : 'success'}>
                  {result.findings.length} 项
                </StatusBadge>
              </div>
              {result.findings.length === 0 ? (
                <EmptyState compact icon={CheckCircle2} title="未发现风险项" />
              ) : (
                <ul className="divide-y divide-line-soft">
                  {result.findings.map((finding) => (
                    <li key={finding.finding_id} className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold leading-snug text-ink">{finding.title}</p>
                        <StatusBadge tone={severityTone(finding.severity)}>
                          {finding.severity}
                        </StatusBadge>
                      </div>
                      <p className="mono mt-1 text-[11px] text-ink-subtle">{finding.field_key}</p>
                      <p className="mt-2 text-sm leading-relaxed text-ink-muted">
                        {finding.ai_explanation}
                      </p>
                      {finding.evidence.length > 0 && (
                        <p className="mt-2 text-xs text-ink-subtle">
                          关联证据 {finding.evidence.length} 条
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel overflow-hidden">
              <div className="panel-header">
                <h3 className="text-sm font-semibold">证据原文</h3>
                <StatusBadge tone="neutral">{evidences.length} 条</StatusBadge>
              </div>
              {evidences.length === 0 ? (
                <EmptyState compact title="暂无证据片段" />
              ) : (
                <ul className="space-y-3 p-5">
                  {evidences.map((evidence) => (
                    <li key={evidence.evidence_id} className="rounded-md border border-line-soft bg-canvas p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-ink">{evidence.source_name}</span>
                        <span className="mono rounded bg-surface px-1.5 py-0.5 text-[11px] text-ink-muted">
                          {evidence.chunk_id}
                        </span>
                      </div>
                      <blockquote className="mono mt-2 border-l-2 border-accent pl-3 text-[13px] leading-relaxed text-ink-muted">
                        {evidence.original_text}
                      </blockquote>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}

      {!mutation.isPending && !mutation.isError && !result && (
        <div className="panel">
          <EmptyState
            icon={ScanSearch}
            title="尚未运行审计"
            description="确认两段材料后点击「开始分析」，抽取结果、一致性比较与风险说明将显示在这里。"
          />
        </div>
      )}
    </div>
  )
}

function BracesIcon() {
  return (
    <span className="mono flex h-[17px] w-[17px] items-center justify-center rounded bg-accent-wash text-[11px] font-semibold text-accent-dark">
      {'{}'}
    </span>
  )
}
