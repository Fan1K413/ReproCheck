/**
 * 数据质量审计（图4 精密 + §2.3 数据结构透视条）
 *
 * 业务未变：运行审计 POST /projects/{id}/data-audits、历史列表、规则目录全部保留。
 * 新增特色交互：**结构透视条（Structure Ribbon）** —— 左侧真实数据集树（材料），
 * 右侧按真实占比展开的结构条带：
 *   · 文件规模条带：块宽 ∝ MaterialView.size_bytes 真实占比（无占比时不画条）
 *   · 字段类型条带：块宽 ∝ 该类型字段数 / 字段总数（真实字段计数）
 *   · 字段明细：字段名 / 类型 / 真实取值 / 状态；后端未提供 row_count 时只显示名称与取值
 *
 * 真实数据绑定：
 *   - GET  /projects/{id}/data-audits        → DataAuditRunSummary[]
 *   - GET  /projects/{id}/data-audits/{aid}  → DataAuditReport
 *   - GET  /data-audits/rules               → DataAuditRule[]
 *   - GET  /materials?project_id={id}       → MaterialView{filename,material_type,size_bytes,chunk_count,fact_count,sha256}
 *   - GET  /facts?project_id={id}&material_id={mid} → FactViewV2[]
 */
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Icon } from '../components/Icon'
import { EmptyState } from '../components/EmptyState'
import { ErrorState } from '../components/ErrorState'
import { LoadingState } from '../components/LoadingState'
import { PageHeader } from '../components/PageHeader'
import { StatusBadge, type Tone } from '../components/StatusBadge'
import { formatBytes } from '../features/format'
import { ApiError, api } from '../services/api'
import { dataAuditApi } from '../services/dataAuditApi'
import { toast } from '../stores/toastStore'
import type {
  DataAuditEvidence,
  DataAuditFinding,
  DataAuditReport,
  DataAuditSeverity,
} from '../types/dataAudit'
import type { FactViewV2, MaterialView } from '../types/api'
import '../styles/wave-c-verify.css'

/* ------------------------------------------------------------------ 常量 */

const SEVERITY_META: Record<DataAuditSeverity, { label: string; tone: Tone }> = {
  critical: { label: '严重', tone: 'danger' },
  high: { label: '高', tone: 'danger' },
  medium: { label: '中', tone: 'warning' },
  low: { label: '低', tone: 'navy' },
  info: { label: '提示', tone: 'accent' },
  unknown: { label: '证据不足', tone: 'neutral' },
}

const SEVERITY_ORDER: DataAuditSeverity[] = [
  'critical',
  'high',
  'medium',
  'low',
  'info',
  'unknown',
]

const CATEGORY_LABEL: Record<string, string> = {
  integrity: '数据集完整性',
  leakage: '数据泄漏',
  distribution: '分布与统计',
  preprocessing: '数据预处理',
}

/** 字段类型三档（Phase 1 §4.3：字符串 / 数值 / 时间用不同灰度紫）。 */
type FieldKind = 'num' | 'text' | 'time'
const FIELD_KIND_META: Record<FieldKind, { label: string; cls: string }> = {
  num: { label: '数值', cls: 'rc4-ribbon__block--num' },
  text: { label: '文本', cls: 'rc4-ribbon__block--text' },
  time: { label: '时间', cls: 'rc4-ribbon__block--time' },
}

const TIME_UNITS = ['s', 'ms', 'us', 'ns', 'min', 'minute', 'hour', 'hours', 'day', 'days', 'timestamp']

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

/** 依据真实取值与单位判定字段类型；无法判定时归入文本。 */
function fieldKind(fact: FactViewV2): FieldKind {
  const unit = (fact.unit ?? '').trim().toLowerCase()
  if (TIME_UNITS.includes(unit)) return 'time'
  if (/time|date|timestamp/.test(fact.field_key.toLowerCase())) return 'time'
  const value = fact.normalized_value
  if (typeof value === 'number' && Number.isFinite(value)) return 'num'
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return 'num'
  return 'text'
}

/* ------------------------------------------------------------------ 证据与发现 */

function EvidenceRow({ evidence }: { evidence: DataAuditEvidence }) {
  const items: Array<[string, string]> = [['数据文件', evidence.file_path]]
  if (evidence.sample_id) items.push(['样本标识', evidence.sample_id])
  if (evidence.field) items.push(['数据字段', evidence.field])
  if (evidence.code_location) items.push(['代码位置', evidence.code_location])
  if (evidence.paper_description) items.push(['论文描述', evidence.paper_description])
  if (evidence.dataset_version) items.push(['数据集版本', evidence.dataset_version])
  if (evidence.detail) items.push(['明细', evidence.detail])
  if (evidence.log_ref) items.push(['审计日志', evidence.log_ref])
  return (
    <div className="rc4-evidence">
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>
              {label}
            </dt>
            <dd className="mono break-all text-[11px] leading-4" style={{ color: 'var(--rc-text)' }}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function FindingCard({ finding }: { finding: DataAuditFinding }) {
  const meta = SEVERITY_META[finding.severity] ?? SEVERITY_META.unknown
  return (
    <article className="rc4-panel">
      <div className="rc4-panel__head">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          <span className="rcw-chip">{finding.rule_id}</span>
          <span className="rc4-list__title">{finding.rule_name}</span>
        </div>
        <span className="rc4-panel__hint">
          置信度：{finding.confidence}
          {finding.affects ? ` · 影响：${finding.affects}` : ''}
        </span>
      </div>
      <div className="rc4-panel__body">
        <p className="text-sm leading-6" style={{ color: 'var(--rc-text)' }}>
          {finding.message}
        </p>
        {finding.justification && (
          <p className="mt-2 text-xs leading-5" style={{ color: 'var(--rc-text-muted)' }}>
            <span style={{ color: 'var(--rc-text-subtle)' }}>判定依据：</span>
            {finding.justification}
          </p>
        )}
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--rc-violet)' }}>
            <Icon name="chevronDown" size="xs" className="transition-transform group-open:rotate-180" />
            证据明细（{finding.evidence.length} 条）
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {finding.evidence.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--rc-warning)' }}>
                该发现缺少可定位证据，不应作为结论依据。
              </p>
            ) : (
              finding.evidence.map((evidence, index) => (
                <EvidenceRow key={`${finding.rule_id}-e${index}`} evidence={evidence} />
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
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ §2.3 结构透视条 */

type MaterialFact = { fact: FactViewV2; rowCount: number | null }

/** 字段 → row_count：仅当后端在证据定位里给出真实行数时才使用。 */
function toMaterialFacts(facts: FactViewV2[] | undefined): MaterialFact[] {
  return (facts ?? []).map((fact) => {
    const locator = fact.evidence?.[0]?.source_locator as { row_count?: number } | null | undefined
    const rowCount = typeof locator?.row_count === 'number' ? locator.row_count : null
    return { fact, rowCount }
  })
}

function StructureRibbon({
  materials,
  facts,
  fading,
  onFadeEnd,
}: {
  materials: MaterialView[]
  facts: MaterialFact[]
  fading: boolean
  onFadeEnd: () => void
}) {
  const totalBytes = materials.reduce((sum, item) => sum + (item.size_bytes ?? 0), 0)

  const kindGroups = useMemo(() => {
    const groups = new Map<FieldKind, MaterialFact[]>()
    for (const item of facts) {
      const kind = fieldKind(item.fact)
      groups.set(kind, [...(groups.get(kind) ?? []), item])
    }
    return groups
  }, [facts])

  const totalFields = facts.length

  return (
    <div
      className={`rc4-ribbon${fading ? ' rc4-ribbon--active rc4-ribbon--fade' : ''}`}
      onAnimationEnd={onFadeEnd}
    >
      {/* 文件规模条带：块宽 ∝ 真实 size_bytes 占比 */}
      <div className="rc4-ribbon__row">
        <p className="rc4-ribbon__caption">
          <span>文件规模条带</span>
          <span>
            {totalBytes > 0
              ? `总大小 ${formatBytes(totalBytes)}`
              : '后端未提供 size_bytes，不绘制占比条'}
          </span>
        </p>
        {materials.length === 0 ? (
          <p className="rc4-list__meta">暂无结构统计：项目内没有可统计的数据文件。</p>
        ) : totalBytes <= 0 ? (
          <div className="rc4-wave__empty">缺少 size_bytes，块宽不可计算</div>
        ) : (
          <div className="rc4-ribbon__track">
            {materials.map((material) => {
              const ratio = (material.size_bytes ?? 0) / totalBytes
              return (
                <button
                  key={material.material_id}
                  type="button"
                  className="rc4-ribbon__block rc4-ribbon__block--text"
                  style={{ flexGrow: ratio, flexBasis: 0 }}
                  aria-label={`数据文件 ${material.filename}，大小 ${formatBytes(material.size_bytes)}，占总量 ${(ratio * 100).toFixed(1)}%`}
                >
                  <span className="rc4-ribbon__name">{material.filename}</span>
                  <span className="rc4-ribbon__value">
                    {formatBytes(material.size_bytes)} · {(ratio * 100).toFixed(1)}%
                  </span>
                  <span className="rc4-ribbon__tip" role="tooltip">
                    类型：{material.material_type}
                    <br />
                    分块：{material.chunk_count ?? '—'} · 事实：{material.fact_count ?? '—'}
                    <br />
                    版本：{material.sha256 ? material.sha256.slice(0, 8) : '—'}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 字段类型条带：块宽 ∝ 真实字段计数占比 */}
      <div className="rc4-ribbon__row">
        <p className="rc4-ribbon__caption">
          <span>字段类型条带</span>
          <span>{totalFields > 0 ? `${totalFields} 个字段` : '所选文件未抽取字段'}</span>
        </p>
        {totalFields === 0 ? (
          <div className="rc4-wave__empty">该数据集暂无可统计的字段</div>
        ) : (
          <div className="rc4-ribbon__track">
            {(Object.keys(FIELD_KIND_META) as FieldKind[]).map((kind) => {
              const group = kindGroups.get(kind) ?? []
              if (group.length === 0) return null
              const ratio = group.length / totalFields
              return (
                <button
                  key={kind}
                  type="button"
                  className={`rc4-ribbon__block ${FIELD_KIND_META[kind].cls}`}
                  style={{ flexGrow: ratio, flexBasis: 0 }}
                  aria-label={`${FIELD_KIND_META[kind].label}字段 ${group.length} 个，占 ${(ratio * 100).toFixed(1)}%`}
                >
                  <span className="rc4-ribbon__name">{FIELD_KIND_META[kind].label}</span>
                  <span className="rc4-ribbon__value">
                    {group.length} 个 · {(ratio * 100).toFixed(1)}%
                  </span>
                  <span className="rc4-ribbon__tip" role="tooltip">
                    {group.map((item) => item.fact.field_label).join('、')}
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* 字段明细：真实取值与状态；无 row_count 时不画长度 */}
      <div className="rc4-ribbon__row">
        <p className="rc4-ribbon__caption">
          <span>字段明细</span>
          <span>
            {facts.some((item) => item.rowCount !== null)
              ? '含 row_count，字段占比可计算'
              : '后端未提供 row_count，仅显示名称与真实取值'}
          </span>
        </p>
        {facts.length === 0 ? (
          <p className="rc4-list__meta">暂无字段明细。</p>
        ) : (
          <div className="rc4-fields">
            <div className="rc4-fields__row rc4-fields__row--head">
              <span>字段</span>
              <span>类型</span>
              <span>取值</span>
              <span>状态</span>
            </div>
            {facts.map((item) => {
              const kind = fieldKind(item.fact)
              return (
                <div key={item.fact.fact_id} className="rc4-fields__row">
                  <span className="rc4-fields__name">{item.fact.field_label}</span>
                  <span>{FIELD_KIND_META[kind].label}</span>
                  <span className="rc4-fields__value">
                    {item.fact.normalized_value === null
                      ? '—'
                      : `${item.fact.normalized_value}${
                          item.fact.unit ? ` ${item.fact.unit}` : ''
                        }`}
                    {item.rowCount !== null ? ` · ${item.rowCount} 行` : ''}
                  </span>
                  <StatusBadge
                    tone={
                      item.fact.extraction_status === 'supported'
                        ? 'success'
                        : item.fact.extraction_status === 'unsupported'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {item.fact.extraction_status}
                  </StatusBadge>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ 报告视图 */

function ReportView({ report }: { report: DataAuditReport }) {
  const categories = new Map<string, DataAuditFinding[]>()
  for (const finding of report.findings) {
    const rule = finding.rule_id.split('-')[0]
    const key =
      rule === 'INT'
        ? 'integrity'
        : rule === 'LEAK'
          ? 'leakage'
          : rule === 'DIST'
            ? 'distribution'
            : 'preprocessing'
    categories.set(key, [...(categories.get(key) ?? []), finding])
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <div className="min-w-0">
            <p className="rc4-panel__hint">
              审计编号 <span className="mono">{report.audit_id}</span>
            </p>
            <p className="rc4-panel__hint">
              生成时间：{formatTime(report.created_at)} · 版本：{report.version} · 耗时 {report.duration_ms} ms
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="danger">阻断项 {report.blocking_count}</StatusBadge>
            <StatusBadge tone="neutral">发现 {report.findings.length} 条</StatusBadge>
          </div>
        </div>
        <div className="rc4-panel__body">
          <div className="rc4-kpis mb-4">
            {SEVERITY_ORDER.map((severity) => (
              <div key={severity} className="rc4-kpi">
                <p className="rc4-kpi__label">{SEVERITY_META[severity].label}</p>
                <p className="rc4-kpi__value">{report.counts[severity] ?? 0}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
            <span className="inline-flex items-center gap-1">
              <Icon name="shield" size="xs" tone="success" />
              只读执行：{report.scope.read_only ? '是' : '否'}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="shield" size="xs" tone="success" />
              外部调用：{report.scope.external_calls ? '有' : '无'}
            </span>
            <span>采样上限 {report.scope.limits?.sample_rows ?? '—'} 行/文件</span>
          </div>
          {report.stats && (
            <p className="mt-3 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
              扫描文件 {String(report.stats.files_scanned ?? 0)} 个 · 代码文件{' '}
              {String(report.stats.code_files_scanned ?? 0)} 个 · 总行数{' '}
              {String(report.stats.total_rows ?? 0)} · 数据集版本{' '}
              {report.stats.dataset_version ? String(report.stats.dataset_version) : '未识别'}
            </p>
          )}
        </div>
      </section>

      {report.findings.length === 0 ? (
        <section className="rc4-panel">
          <EmptyState
            title="未发现问题"
            description="本次扫描未触发任何规则；「证据不足」类规则结果见规则执行概览。"
            compact
          />
        </section>
      ) : (
        Array.from(categories.entries()).map(([category, findings]) => (
          <section key={category} className="rc4-panel">
            <div className="rc4-panel__head">
              <h3 className="rc4-panel__title">{CATEGORY_LABEL[category] ?? category}</h3>
              <span className="rc4-panel__hint">{findings.length} 条</span>
            </div>
            <div className="rc4-panel__body flex flex-col gap-3">
              {findings.map((finding, index) => (
                <FindingCard key={`${finding.rule_id}-${index}`} finding={finding} />
              ))}
            </div>
          </section>
        ))
      )}

      <RuleResultsTable ruleResults={report.rule_results} />
    </div>
  )
}

function RuleResultsTable({ ruleResults }: { ruleResults: Record<string, string> }) {
  const entries = Object.entries(ruleResults)
  const meta: Record<string, { label: string; tone: Tone }> = {
    fail: { label: '触发', tone: 'danger' },
    pass: { label: '通过', tone: 'success' },
    skipped: { label: '未评估', tone: 'neutral' },
  }
  return (
    <section className="rc4-panel">
      <div className="rc4-panel__head">
        <h3 className="rc4-panel__title">
          <Icon name="database" size="sm" tone="accent" />
          规则执行概览
        </h3>
        <span className="rc4-panel__hint">{entries.length} 条规则</span>
      </div>
      <div className="rc4-panel__body">
        <p className="rc4-list__meta mb-3">
          「未评估」表示当前数据/代码条件下该规则无法得出结论，不代表通过。
        </p>
        {entries.length === 0 ? (
          <p className="rc4-list__meta">后端未返回规则执行结果。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {entries.map(([ruleId, result]) => {
              const m = meta[result] ?? meta.skipped
              return (
                <StatusBadge key={ruleId} tone={m.tone}>
                  {ruleId} {m.label}
                </StatusBadge>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ 页面主体 */

export default function DataAuditPage() {
  const { projectId = '' } = useParams()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [includeCodeScan, setIncludeCodeScan] = useState(true)
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [fading, setFading] = useState(false)

  const listQuery = useQuery({
    queryKey: ['data-audit', 'list', projectId],
    queryFn: () => dataAuditApi.list(projectId),
    enabled: Boolean(projectId),
    retry: 1,
  })

  const runMutation = useMutation({
    mutationFn: () => dataAuditApi.run(projectId, { include_code_scan: includeCodeScan }),
    onSuccess: (report) => {
      toast.success(`审计完成：${report.findings.length} 条发现，阻断 ${report.blocking_count} 条`)
      setSelectedId(report.audit_id)
      void queryClient.invalidateQueries({ queryKey: ['data-audit', 'list', projectId] })
    },
    onError: (error) => toast.error(`数据审计失败：${errorMessage(error)}`),
  })

  const detailQuery = useQuery({
    queryKey: ['data-audit', 'detail', projectId, selectedId],
    queryFn: () => dataAuditApi.get(projectId, selectedId as string),
    enabled: Boolean(projectId && selectedId),
    retry: 0,
  })

  const rulesQuery = useQuery({
    queryKey: ['data-audit', 'rules'],
    queryFn: dataAuditApi.rules,
    retry: 1,
  })

  /* §2.3 结构透视条的真实数据源：项目材料 + 所选材料的字段。 */
  const materialsQuery = useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
    enabled: Boolean(projectId),
  })

  const materials = useMemo(() => materialsQuery.data?.items ?? [], [materialsQuery.data])

  const factsQuery = useQuery({
    queryKey: ['facts', projectId, materialId],
    queryFn: () => api.listFacts(projectId, materialId as string),
    enabled: Boolean(projectId && materialId),
  })

  /* 切换数据集时条带交叉淡入（200ms），动画结束后移除 will-change。 */
  useEffect(() => {
    if (!factsQuery.data) return
    setFading(true)
  }, [factsQuery.data, materialId])

  useEffect(() => {
    if (materials.length === 0) return
    if (!materialId || !materials.some((item) => item.material_id === materialId)) {
      setMaterialId(materials[0].material_id)
    }
  }, [materials, materialId])

  const report = detailQuery.data ?? runMutation.data
  const latestId = listQuery.data?.items?.[0]?.audit_id ?? null
  const materialFacts = useMemo(() => toMaterialFacts(factsQuery.data?.items), [factsQuery.data])

  const totalFacts = materials.reduce((sum, item) => sum + (item.fact_count ?? 0), 0)
  const totalBytes = materials.reduce((sum, item) => sum + (item.size_bytes ?? 0), 0)

  return (
    <div className="rc4-page">
      <PageHeader
        title="数据质量审计"
        description="检查数据集完整性、数据泄漏、分布统计与预处理一致性——只读执行，全部发现附带证据"
      />

      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <div className="min-w-0">
            <h3 className="rc4-panel__title">
              <Icon name="file" size="sm" tone="accent" />
              执行审计
            </h3>
            <p className="rc4-panel__hint">
              对项目已上传的数据材料做本地只读扫描：不上传、不外发、不修改原文件。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--rc-text-muted)' }}>
              <input
                type="checkbox"
                checked={includeCodeScan}
                onChange={(event) => setIncludeCodeScan(event.target.checked)}
                className="h-4 w-4 rounded"
                style={{ accentColor: 'var(--rc-accent)' }}
              />
              同时扫描代码（泄漏/预处理规则）
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={runMutation.isPending || !projectId}
              onClick={() => runMutation.mutate()}
            >
              {runMutation.isPending ? (
                <Icon name="rotate" size="sm" className="animate-spin" />
              ) : (
                <Icon name="play" size="sm" />
              )}
              {runMutation.isPending ? '审计中…' : '运行数据审计'}
            </button>
          </div>
        </div>
      </section>

      {runMutation.isPending && (
        <section className="rc4-panel">
          <LoadingState message="正在执行数据审计…" hint="分块读取、哈希与规则计算均为本地确定性过程。" compact />
        </section>
      )}
      {runMutation.isError && (
        <section className="rc4-panel">
          <ErrorState
            message={errorMessage(runMutation.error)}
            code={errorCode(runMutation.error)}
            onRetry={() => runMutation.mutate()}
            compact
          />
        </section>
      )}
      {detailQuery.isError && (
        <section className="rc4-panel">
          <ErrorState
            message={errorMessage(detailQuery.error)}
            code={errorCode(detailQuery.error)}
            onRetry={() => void detailQuery.refetch()}
            compact
          />
        </section>
      )}
      {report && !runMutation.isPending && <ReportView report={report} />}
      {!report && !runMutation.isPending && !runMutation.isError && (
        <section className="rc4-panel">
          <EmptyState
            title="暂无审计结果"
            description={
              latestId
                ? '点击「运行数据审计」执行新的扫描，或从历史记录中选择一次审计查看报告。'
                : '项目还没有数据材料。先在「材料管理」上传 CSV/JSONL 等数据文件，再运行审计。'
            }
            compact
          />
        </section>
      )}

      {/* §2.3 结构透视条 */}
      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h3 className="rc4-panel__title">
              <Icon name="database" size="sm" tone="accent" />
              数据结构透视条
            </h3>
            <span className="rc4-panel__hint">
              {materials.length} 个文件 · {totalFacts} 个字段 · {formatBytes(totalBytes)}
            </span>
          </div>
        </div>
        <div className="rc4-panel__body">
          {materialsQuery.isPending ? (
            <LoadingState compact message="正在读取数据集结构…" />
          ) : materialsQuery.isError ? (
            <ErrorState
              compact
              message={errorMessage(materialsQuery.error)}
              code={errorCode(materialsQuery.error)}
              onRetry={() => void materialsQuery.refetch()}
            />
          ) : materials.length === 0 ? (
            <EmptyState
              compact
              title="暂无结构统计"
              description="项目内还没有可统计的数据文件；上传材料后这里会按真实占比展开结构条带。"
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-12">
              {/* 左 2 列：真实数据集树 */}
              <div className="lg:col-span-2">
                <p className="rcw-overline mb-2">数据集树</p>
                <div className="rc4-tree" role="tree" aria-label="项目数据集">
                  {materials.map((material) => (
                    <button
                      key={material.material_id}
                      type="button"
                      role="treeitem"
                      className="rc4-tree__item"
                      aria-current={material.material_id === materialId}
                      onClick={() => setMaterialId(material.material_id)}
                    >
                      <span className="rc4-tree__name">{material.filename}</span>
                      <span className="rc4-tree__meta">
                        {material.material_type} · {formatBytes(material.size_bytes)} ·{' '}
                        {material.chunk_count ?? 0} 块 · {material.fact_count ?? 0} 字段
                      </span>
                      <span className="rc4-tree__meta">
                        版本 {material.sha256 ? material.sha256.slice(0, 8) : '—'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 右 10 列：结构条带 */}
              <div className="lg:col-span-10">
                {factsQuery.isPending ? (
                  <LoadingState compact message="正在读取字段结构…" />
                ) : factsQuery.isError ? (
                  <ErrorState
                    compact
                    message={errorMessage(factsQuery.error)}
                    code={errorCode(factsQuery.error)}
                    onRetry={() => void factsQuery.refetch()}
                  />
                ) : (
                  <StructureRibbon
                    key={materialId ?? 'none'}
                    materials={materials}
                    facts={materialFacts}
                    fading={fading}
                    onFadeEnd={() => setFading(false)}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 历史记录 */}
      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <h3 className="rc4-panel__title">历史审计</h3>
          <span className="rc4-panel__hint">{listQuery.data?.items.length ?? 0} 条</span>
        </div>
        <div className="rc4-panel__body">
          {listQuery.isPending ? (
            <LoadingState message="加载历史记录…" compact />
          ) : (listQuery.data?.items.length ?? 0) === 0 ? (
            <p className="rc4-list__meta">尚无历史审计记录。</p>
          ) : (
            <div className="rc4-list">
              {listQuery.data?.items.map((item) => (
                <button
                  key={item.audit_id}
                  type="button"
                  className="rc4-list__row w-full text-left"
                  data-focus={selectedId === item.audit_id}
                  aria-pressed={selectedId === item.audit_id}
                  onClick={() => setSelectedId(item.audit_id)}
                >
                  <span className="rc4-list__main">
                    <span className="rc4-list__title mono">{item.audit_id.slice(0, 12)}…</span>
                    <span className="rc4-list__meta block">
                      {item.created_at ? formatTime(item.created_at) : '—'} · 发现 {item.finding_count} ·
                      阻断 {item.blocking_count} · {item.duration_ms} ms
                    </span>
                  </span>
                  {item.blocking_count > 0 ? (
                    <Icon name="triangleAlert" size="sm" tone="danger" />
                  ) : (
                    <Icon name="badgeCheck" size="sm" tone="success" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* 规则目录 */}
      <section className="rc4-panel">
        <div className="rc4-panel__head">
          <h3 className="rc4-panel__title">审计规则目录</h3>
          <span className="rc4-panel__hint">{rulesQuery.data?.total ?? '—'} 条</span>
        </div>
        <div className="rc4-panel__body">
          {rulesQuery.isPending ? (
            <LoadingState message="加载规则目录…" compact />
          ) : rulesQuery.isError ? (
            <p className="text-xs" style={{ color: 'var(--rc-warning)' }}>
              规则目录加载失败。
            </p>
          ) : (
            <div className="rc4-table-wrap">
              <table className="rc4-table">
                <thead>
                  <tr>
                    <th>规则</th>
                    <th>类别</th>
                    <th>默认严重度</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {rulesQuery.data?.items.map((rule) => {
                    const sev = SEVERITY_META[rule.default_severity] ?? SEVERITY_META.unknown
                    return (
                      <tr key={rule.rule_id}>
                        <td className="mono">{rule.rule_id}</td>
                        <td>{CATEGORY_LABEL[rule.category] ?? rule.category}</td>
                        <td>
                          <StatusBadge tone={sev.tone}>{sev.label}</StatusBadge>
                        </td>
                        <td style={{ color: 'var(--rc-text-muted)' }}>{rule.description}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
