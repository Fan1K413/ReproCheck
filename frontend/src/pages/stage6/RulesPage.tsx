import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight,
  Database,
  FileText,
  FlaskConical,
  Gauge,
  GitBranch,
  History,
  Layers,
  Plus,
  Power,
  RotateCcw,
  ScrollText,
  Timer,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
import { JsonBlock } from '../../components/JsonBlock'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { formatDateTime, formatDuration } from '../../features/format'
import { RISK_LEVELS } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import type {
  RuleDetail, RuleEvalCompare, RuleEvalSingle, RuleEvaluation, RuleMetrics, RuleTestResult, RuleVersion,
} from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

/* ---------------- 本地常量与工具 ---------------- */

const RULE_KEY_RE = /^[a-z0-9_-]{2,80}$/
const CHECK_TYPE_OPTIONS = [
  { key: 'field_compare', label: '字段对比' }, { key: 'unit_mismatch', label: '单位不一致' }, { key: 'missing_evidence', label: '证据缺失' },
]
/** severity 与后端审计 schema 的 Literal["high","medium","low"] 对齐。 */
const SEVERITY_OPTIONS = [{ key: 'low', label: '低' }, { key: 'medium', label: '中' }, { key: 'high', label: '高' }]
const METRIC_KEYS = ['precision', 'recall', 'fp_rate', 'fn_rate', 'accuracy', 'pass_rate'] as const
const METRIC_LABELS: Record<string, string> = { precision: '精确率', recall: '召回率', fp_rate: '假阳率', fn_rate: '假阴率', accuracy: '准确率', pass_rate: '样本通过率' }
const LOWER_BETTER = new Set<string>(['fp_rate', 'fn_rate'])
const SAMPLE_EXAMPLE = `[
  {
    "label": "consistent_case",
    "input": { "a": { "learning_rate": 0.001 }, "b": { "learning_rate": 0.001 } },
    "expected": { "status": "consistent", "conflict_fields": [] }
  }
]`

/** 风险等级排序权重（critical > high > medium > low），用于「优先级」排序。 */
const RISK_WEIGHT: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

type SortMode = 'priority' | 'name' | 'domain' | 'version'
const SORT_MODES: { key: SortMode; label: string }[] = [
  { key: 'priority', label: '优先级' },
  { key: 'name', label: '名称' },
  { key: 'domain', label: '领域' },
  { key: 'version', label: '版本' },
]

type LogicDraft = { type: string; fields: string; tolerance: string; severity: string }
type SampleInput = { input: Record<string, unknown>; expected: Record<string, unknown>; label?: string }
type EvalSampleRow = { key: string; label: string; expected_positive: boolean; predicted_positive: boolean; matched: boolean; error: string | null }

function pct(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
}
function errCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}
function draftFromLogic(logic?: Record<string, unknown>): LogicDraft {
  const l = logic ?? {}
  const type = typeof l.type === 'string' && CHECK_TYPE_OPTIONS.some((o) => o.key === l.type) ? l.type : 'field_compare'
  const severity = typeof l.severity === 'string' && SEVERITY_OPTIONS.some((o) => o.key === l.severity) ? l.severity : 'medium'
  return {
    type, severity,
    fields: Array.isArray(l.fields) ? l.fields.map(String).join(', ') : '',
    tolerance: typeof l.tolerance === 'number' ? String(l.tolerance) : '0.001',
  }
}
function buildLogic(draft: LogicDraft): Record<string, unknown> {
  const logic: Record<string, unknown> = { type: draft.type, fields: draft.fields.split(',').map((f) => f.trim()).filter(Boolean), severity: draft.severity }
  if (draft.type === 'field_compare') logic.tolerance = Number(draft.tolerance)
  return logic
}
function validateLogic(draft: LogicDraft): string | null {
  if (draft.fields.split(',').map((f) => f.trim()).filter(Boolean).length === 0) return '至少填写 1 个参与比对的字段（逗号分隔）。'
  if (draft.type === 'field_compare') {
    const tol = Number(draft.tolerance)
    if (!Number.isFinite(tol) || tol < 0) return '容差 tolerance 须为 ≥ 0 的数值。'
  }
  return null
}
function parseSamples(text: string, required: boolean): { samples: SampleInput[]; error: string | null } {
  const trimmed = text.trim()
  const requiredMsg = '至少需要 1 条测试样本（后端强制要求）。'
  if (!trimmed) return { samples: [], error: required ? requiredMsg : null }
  let parsed: unknown
  try { parsed = JSON.parse(trimmed) } catch { return { samples: [], error: 'JSON 解析失败：请检查引号、逗号与括号是否配对。' } }
  if (!Array.isArray(parsed)) return { samples: [], error: '测试样本须为 JSON 数组。' }
  if (required && parsed.length === 0) return { samples: [], error: requiredMsg }
  const isObj = (v: unknown) => typeof v === 'object' && v !== null && !Array.isArray(v)
  const samples: SampleInput[] = []
  for (let i = 0; i < parsed.length; i += 1) {
    const item: unknown = parsed[i]
    if (!isObj(item)) return { samples: [], error: `第 ${i + 1} 条样本须为对象（含 input 与 expected）。` }
    const record = item as Record<string, unknown>
    if (!isObj(record.input) || !isObj(record.expected)) return { samples: [], error: `第 ${i + 1} 条样本的 input 与 expected 须为 JSON 对象。` }
    samples.push({
      input: record.input as Record<string, unknown>, expected: record.expected as Record<string, unknown>,
      label: typeof record.label === 'string' ? record.label : undefined,
    })
  }
  return { samples, error: null }
}
function isCompare(data: RuleEvalSingle | RuleEvalCompare): data is RuleEvalCompare {
  return 'candidate' in data
}
function toEvalRows(results: unknown[]): EvalSampleRow[] {
  const rows: EvalSampleRow[] = []
  results.forEach((item, index) => {
    if (typeof item !== 'object' || item === null) return
    const r = item as Record<string, unknown>
    if (typeof r.label !== 'string' || typeof r.expected_positive !== 'boolean' || typeof r.predicted_positive !== 'boolean' || typeof r.matched !== 'boolean') return
    rows.push({
      key: `${index}-${r.label}`, label: r.label, expected_positive: r.expected_positive,
      predicted_positive: r.predicted_positive, matched: r.matched, error: typeof r.error === 'string' ? r.error : null,
    })
  })
  return rows
}

/* ---------------- 子组件 ---------------- */

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] rcw-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{error}</p>}
    </div>
  )
}

function ModalActions({ onCancel, onSubmit, pending, label, pendingLabel, icon: Glyph }: {
  onCancel: () => void; onSubmit: () => void; pending: boolean; label: string; pendingLabel: string; icon: LucideIcon
}) {
  return (
    <>
      <button type="button" className="btn-ghost" onClick={onCancel}>取消</button>
      <button type="button" className="btn-primary" disabled={pending} onClick={onSubmit}>
        <Icon as={Glyph} size="xs" />{pending ? pendingLabel : label}
      </button>
    </>
  )
}

function LogicEditor({ value, onChange }: { value: LogicDraft; onChange: (next: LogicDraft) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="检查类型 type">
        <select className="field-input" value={value.type} onChange={(e) => onChange({ ...value, type: e.target.value })}>
          {CHECK_TYPE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}（{o.key}）</option>)}
        </select>
      </Field>
      <Field label="严重度 severity">
        <select className="field-input" value={value.severity} onChange={(e) => onChange({ ...value, severity: e.target.value })}>
          {SEVERITY_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}（{o.key}）</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="参与字段 fields（逗号分隔，至少 1 个）">
          <input className="field-input mono" placeholder="learning_rate, batch_size, epochs" value={value.fields} onChange={(e) => onChange({ ...value, fields: e.target.value })} />
        </Field>
      </div>
      {value.type === 'field_compare' && (
        <div className="sm:col-span-2">
          <Field label="相对容差 tolerance（数值字段按相对容差判定一致性）">
            <input type="number" step="0.001" min="0" className="field-input mono" value={value.tolerance} onChange={(e) => onChange({ ...value, tolerance: e.target.value })} />
          </Field>
        </div>
      )}
    </div>
  )
}

function LogicFieldset({ draft, onChange, error }: { draft: LogicDraft; onChange: (d: LogicDraft) => void; error?: string }) {
  return (
    <div className="rounded-md p-3" style={{ border: 'var(--rc-stroke-hair)' }}>
      <p className="mb-2 text-xs font-semibold rcw-muted">检查逻辑 check_logic_json</p>
      <LogicEditor value={draft} onChange={onChange} />
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--rc-danger)' }}>{error}</p>}
      <p className="field-label mt-3">实时预览</p>
      <JsonBlock value={buildLogic(draft)} maxHeight="max-h-40" />
    </div>
  )
}

function SamplesField({ label, value, onChange, error, hint, rows = 6 }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; hint?: string; rows?: number
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      <textarea className="field-input mono text-xs" rows={rows} placeholder={SAMPLE_EXAMPLE} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}

function MetricsBoard({ metrics, compact = false }: { metrics: RuleMetrics; compact?: boolean }) {
  const cells = [
    { key: 'tp', label: '真阳 TP', cls: 'bg-success-wash text-success' }, { key: 'fp', label: '假阳 FP', cls: 'bg-danger-wash text-danger' },
    { key: 'fn', label: '假阴 FN', cls: 'bg-warning-wash text-warning' }, { key: 'tn', label: '真阴 TN', cls: 'bg-neutral-wash text-neutral' },
  ]
  return (
    <div className="rcw-stack-tight">
      <div className={compact ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6'}>
        {METRIC_KEYS.map((key) => (
          <div key={key} className="rounded-md py-2" style={{ border: 'var(--rc-stroke-hair)', backgroundColor: 'var(--rc-surface-2)', paddingLeft: 12, paddingRight: 12 }}>
            <p className="text-[11px] rcw-faint">{METRIC_LABELS[key]}</p>
            <p className={`mono mt-0.5 font-semibold ${compact ? 'text-base' : 'text-lg'}`}>{pct(metrics[key])}</p>
          </div>
        ))}
      </div>
      <div className="rcw-row" style={{ alignItems: 'stretch', gap: 'var(--rc-space-3)' }}>
        <div className="grid w-52 shrink-0 grid-cols-2 gap-1.5">
          {cells.map((c) => (
            <div key={c.key} className={`rounded-md px-3 py-2 ${c.cls}`}>
              <p className="text-[11px] font-medium opacity-80">{c.label}</p>
              <p className="mono text-lg font-semibold">{metrics[c.key] ?? 0}</p>
            </div>
          ))}
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col justify-center gap-1.5 rounded-md border px-3 py-2 text-xs rcw-muted" style={{ borderColor: 'var(--rc-stroke-hair)' }}>
          <span className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}><Icon as={Timer} size="xs" />运行耗时：<span className="mono">{formatDuration(metrics.runtime_ms)}</span></span>
          <span>样本总数：<span className="mono">{metrics.total ?? 0}</span> 条 · 正类定义：预测 status = conflict（检出问题），真值取自样本 expected。</span>
        </div>
      </div>
    </div>
  )
}

function EvalSampleTable({ results, compact = false }: { results: unknown[]; compact?: boolean }) {
  const rows = toEvalRows(results)
  if (rows.length === 0) return null
  const columns: Column<EvalSampleRow>[] = [
    {
      key: 'label', header: '样本',
      render: (r) => compact
        ? <span className="mono block max-w-[130px] truncate text-xs" title={r.label}>{r.label}</span>
        : <span className="mono text-xs">{r.label}</span>,
    },
    { key: 'gt', header: compact ? '真值' : '真实正类', align: 'center', render: (r) => <StatusBadge tone={r.expected_positive ? 'warning' : 'neutral'} dot={false}>{r.expected_positive ? '是' : '否'}</StatusBadge> },
    { key: 'pred', header: compact ? '预测' : '预测正类', align: 'center', render: (r) => <StatusBadge tone={r.predicted_positive ? 'warning' : 'neutral'} dot={false}>{r.predicted_positive ? '是' : '否'}</StatusBadge> },
    {
      key: 'matched', header: compact ? '匹配' : '全量匹配', align: 'center',
      render: (r) => r.matched
        ? <span className="rcw-row" style={{ gap: 'var(--rc-space-1)', justifyContent: 'center', fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-m)', color: 'var(--rc-success)' }} title="全量匹配通过"><Icon name="check" size="xs" tone="success" />{compact ? '' : '通过'}</span>
        : <span className="rcw-row" style={{ gap: 'var(--rc-space-1)', justifyContent: 'center', fontSize: 'var(--rc-fs-caption)', fontWeight: 'var(--rc-fw-m)', color: 'var(--rc-danger)' }} title="全量匹配未通过"><Icon as={X} size="xs" tone="danger" />{compact ? '' : '未通过'}</span>,
    },
    {
      key: 'error', header: '错误',
      render: (r) => r.error
        ? <span className="text-xs font-medium" style={{ color: 'var(--rc-danger)' }} title={r.error}>!</span>
        : <span className="text-xs rcw-faint">—</span>,
    },
  ]
  return <div className="mt-3 overflow-hidden rounded-md" style={{ border: 'var(--rc-stroke-hair)' }}><DataTable dense={compact} columns={columns} data={rows} rowKey={(r) => r.key} /></div>
}

const evalHistoryColumns: Column<RuleEvaluation>[] = [
  { key: 'version', header: '版本', render: (e) => <span className="mono text-xs font-medium">v{e.version}</span> },
  { key: 'dataset', header: '数据集', render: (e) => <span className="mono text-xs rcw-muted">{e.dataset_ref || '—'}</span> },
  { key: 'precision', header: '精确率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.precision)}</span> },
  { key: 'recall', header: '召回率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.recall)}</span> },
  { key: 'pass_rate', header: '通过率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.pass_rate)}</span> },
  { key: 'ran_by', header: '执行人', render: (e) => e.ran_by_name ? <span className="text-xs rcw-muted">{e.ran_by_name}</span> : <span className="mono text-[11px] rcw-faint">{e.ran_by ?? '—'}</span> },
  { key: 'created', header: '时间', render: (e) => <span className="mono whitespace-nowrap text-[11px] rcw-muted">{formatDateTime(e.created_at)}</span> },
]

/* ---------------- 页面 ---------------- */

export default function RulesPage() {
  const queryClient = useQueryClient()
  const [domainFilter, setDomainFilter] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('all')
  const [sortMode, setSortMode] = useState<SortMode>('priority')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState('versions')
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [ruleForm, setRuleForm] = useState({ rule_key: '', name: '', domain: '', description: '', risk_level: 'medium', evidence_requirement: '', change_note: '' })
  const [ruleLogic, setRuleLogic] = useState<LogicDraft>(draftFromLogic())
  const [ruleSamples, setRuleSamples] = useState('')
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({})
  const [versionOpen, setVersionOpen] = useState(false)
  const [versionLogic, setVersionLogic] = useState<LogicDraft>(draftFromLogic())
  const [versionNote, setVersionNote] = useState('')
  const [versionSamples, setVersionSamples] = useState('')
  const [versionErrors, setVersionErrors] = useState<Record<string, string>>({})
  const [rollbackTarget, setRollbackTarget] = useState<RuleVersion | null>(null)
  const [testResult, setTestResult] = useState<{ ruleId: string; data: RuleTestResult } | null>(null)
  const [evalDataset, setEvalDataset] = useState('')
  const [evalSamples, setEvalSamples] = useState('')
  const [evalBaseline, setEvalBaseline] = useState('')
  const [evalError, setEvalError] = useState<string | null>(null)
  const [evalResult, setEvalResult] = useState<{ ruleId: string; data: RuleEvalSingle | RuleEvalCompare } | null>(null)

  const rulesQuery = useQuery({ queryKey: ['stage6-rules'], queryFn: () => stage6Api.listRules() })
  const detailQuery = useQuery({ queryKey: ['stage6-rule', selectedId], queryFn: () => stage6Api.getRule(selectedId ?? ''), enabled: !!selectedId })
  const versionsQuery = useQuery({ queryKey: ['stage6-rule-versions', selectedId], queryFn: () => stage6Api.listRuleVersions(selectedId ?? ''), enabled: !!selectedId })
  const evalsQuery = useQuery({ queryKey: ['stage6-rule-evals', selectedId], queryFn: () => stage6Api.listRuleEvaluations(selectedId ?? ''), enabled: !!selectedId })

  useEffect(() => {
    const items = rulesQuery.data?.items ?? []
    if (items.length === 0) { setSelectedId(null); return }
    setSelectedId((cur) => (cur && items.some((r) => r.id === cur) ? cur : items[0].id))
  }, [rulesQuery.data])

  const allRules = rulesQuery.data?.items ?? []
  const keyword = domainFilter.trim().toLowerCase()
  const filtered = allRules.filter((r) => (!keyword || r.domain.toLowerCase().includes(keyword)) && (enabledFilter === 'all' || (enabledFilter === 'enabled') === r.is_enabled))
  /* 优先级排序：启用状态优先 → 风险等级（critical 最高）→ 版本号倒序 → 名称 */
  const rules = [...filtered].sort((a, b) => {
    if (sortMode === 'name') return a.name.localeCompare(b.name)
    if (sortMode === 'domain') return (a.domain || '').localeCompare(b.domain || '')
    if (sortMode === 'version') return b.current_version - a.current_version
    if (a.is_enabled !== b.is_enabled) return a.is_enabled ? -1 : 1
    const ra = RISK_WEIGHT[a.risk_level] ?? 9
    const rb = RISK_WEIGHT[b.risk_level] ?? 9
    if (ra !== rb) return ra - rb
    if (a.current_version !== b.current_version) return b.current_version - a.current_version
    return a.name.localeCompare(b.name)
  })
  const detail: RuleDetail | undefined = detailQuery.data
  const versions = versionsQuery.data?.items ?? []
  const detailRisk = detail ? (RISK_LEVELS[detail.risk_level] ?? { label: detail.risk_level, tone: 'neutral' as const }) : null

  const invalidateRule = (ruleId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['stage6-rules'] })
    void queryClient.invalidateQueries({ queryKey: ['stage6-rule', ruleId] })
    void queryClient.invalidateQueries({ queryKey: ['stage6-rule-versions', ruleId] })
  }
  const seedMut = useMutation({
    mutationFn: () => stage6Api.seedRules(),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-rules'] })
      toast.success(`默认规则载入完成：新增 ${data.seeded.length} 条 / 跳过 ${data.skipped.length} 条`)
    },
    onError: (error) => toast.error(error.message),
  })
  const createMut = useMutation({
    mutationFn: (body: Parameters<typeof stage6Api.createRule>[0]) => stage6Api.createRule(body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-rules'] })
      setSelectedId(data.id); setTab('versions'); setCreateOpen(false)
      toast.success(`规则 ${data.rule_key} 已创建，v1 已激活`)
    },
    onError: (error) => toast.error(error.message),
  })
  const toggleMut = useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => stage6Api.setRuleEnabled(vars.id, vars.enabled),
    onSuccess: (_data, vars) => { invalidateRule(vars.id); toast.success(vars.enabled ? '规则已启用，参与后续审计治理' : '规则已停用，不再参与审计判定') },
    onError: (error) => toast.error(error.message),
  })
  const versionMut = useMutation({
    mutationFn: (vars: { ruleId: string; body: Parameters<typeof stage6Api.createRuleVersion>[1] }) => stage6Api.createRuleVersion(vars.ruleId, vars.body),
    onSuccess: (_data, vars) => {
      invalidateRule(vars.ruleId); setVersionOpen(false); setTestResult(null); setEvalResult(null)
      toast.success('新版本已创建并激活，测试样本已随版本入库')
    },
    onError: (error) => toast.error(error.message),
  })
  const rollbackMut = useMutation({
    mutationFn: (vars: { ruleId: string; version: number }) => stage6Api.rollbackRule(vars.ruleId, vars.version),
    onSuccess: (_data, vars) => {
      invalidateRule(vars.ruleId); setRollbackTarget(null); setTestResult(null); setEvalResult(null)
      toast.success(`已回滚到 v${vars.version}：复制其逻辑与样本生成新版本并激活`)
    },
    onError: (error) => toast.error(error.message),
  })
  const testMut = useMutation({
    mutationFn: (ruleId: string) => stage6Api.runRuleTests(ruleId),
    onSuccess: (data, ruleId) => { setTestResult({ ruleId, data }); toast.success(`样本测试完成：${data.passed}/${data.total} 通过（${pct(data.pass_rate)}）`) },
    onError: (error) => toast.error(error.message),
  })
  const evalMut = useMutation({
    mutationFn: (vars: { ruleId: string; body: Parameters<typeof stage6Api.evaluateRule>[1] }) => stage6Api.evaluateRule(vars.ruleId, vars.body),
    onSuccess: (data, vars) => {
      setEvalResult({ ruleId: vars.ruleId, data })
      void queryClient.invalidateQueries({ queryKey: ['stage6-rule-evals', vars.ruleId] })
      toast.success('离线评估完成，指标已落库留痕')
    },
    onError: (error) => toast.error(error.message),
  })

  const openCreate = () => {
    setRuleForm({ rule_key: '', name: '', domain: '', description: '', risk_level: 'medium', evidence_requirement: '', change_note: '' })
    setRuleLogic(draftFromLogic()); setRuleSamples(''); setRuleErrors({}); setCreateOpen(true)
  }
  const submitCreate = () => {
    const errors: Record<string, string> = {}
    if (!RULE_KEY_RE.test(ruleForm.rule_key.trim())) errors.rule_key = 'rule_key 仅允许小写字母 / 数字 / 下划线 / 连字符（2–80 位）。'
    if (!ruleForm.name.trim()) errors.name = '请填写规则名称。'
    const logicError = validateLogic(ruleLogic)
    if (logicError) errors.logic = logicError
    const parsed = parseSamples(ruleSamples, false)
    if (parsed.error) errors.samples = parsed.error
    setRuleErrors(errors)
    if (Object.keys(errors).length > 0) return
    createMut.mutate({
      rule_key: ruleForm.rule_key.trim(), name: ruleForm.name.trim(), domain: ruleForm.domain.trim(),
      description: ruleForm.description.trim(), risk_level: ruleForm.risk_level, evidence_requirement: ruleForm.evidence_requirement.trim(),
      check_logic_json: buildLogic(ruleLogic), change_note: ruleForm.change_note.trim() || '初始版本', test_samples: parsed.samples,
    })
  }
  const openVersion = () => {
    if (!detail) return
    setVersionLogic(draftFromLogic(detail.active_version.check_logic))
    setVersionNote(''); setVersionSamples(''); setVersionErrors({}); setVersionOpen(true)
  }
  const submitVersion = () => {
    if (!detail) return
    const errors: Record<string, string> = {}
    const logicError = validateLogic(versionLogic)
    if (logicError) errors.logic = logicError
    const parsed = parseSamples(versionSamples, true)
    if (parsed.error) errors.samples = parsed.error
    setVersionErrors(errors)
    if (Object.keys(errors).length > 0) return
    versionMut.mutate({ ruleId: detail.id, body: { check_logic_json: buildLogic(versionLogic), change_note: versionNote.trim(), test_samples: parsed.samples } })
  }
  const loadEvalSamples = () => {
    if (!detail) return
    setEvalSamples(JSON.stringify(detail.test_samples.map((s) => ({ label: s.label, input: s.input, expected: s.expected })), null, 2))
    setEvalError(null)
  }
  const submitEval = () => {
    if (!detail) return
    const parsed = parseSamples(evalSamples, true)
    if (parsed.error) { setEvalError(parsed.error); return }
    setEvalError(null)
    evalMut.mutate({ ruleId: detail.id, body: { dataset_ref: evalDataset.trim(), samples: parsed.samples, baseline_version: evalBaseline === '' ? null : Number(evalBaseline) } })
  }

  const shownTest = testResult && testResult.ruleId === selectedId ? testResult.data : null
  const shownEval = evalResult && evalResult.ruleId === selectedId ? evalResult.data : null
  const enabledCount = allRules.filter((r) => r.is_enabled).length
  const highRiskCount = allRules.filter((r) => r.risk_level === 'high' || r.risk_level === 'critical').length
  const kpis = [
    { label: '规则总数', value: allRules.length, icon: 'scroll' as const },
    { label: '启用中', value: enabledCount, icon: 'shield' as const },
    { label: '已停用', value: allRules.length - enabledCount, icon: 'triangleAlert' as const },
    { label: '高危规则', value: highRiskCount, icon: 'alert' as const },
  ]

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
        <PageHeader
          title="审计规则"
          description="规则版本、测试与评估"
          actions={
            <>
              <button type="button" className="btn-ghost" disabled={seedMut.isPending} onClick={() => seedMut.mutate()}>
                <Icon as={Database} size="xs" />{seedMut.isPending ? '载入中…' : '载入默认规则'}
              </button>
              <button type="button" className="btn-primary" onClick={openCreate}><Icon name="plus" size="xs" />新建规则</button>
            </>
          }
        />

        <div className="rcw-grid rcw-grid-4 rc-stagger">
          {kpis.map((kpi) => (
            <div key={kpi.label} className="rcw-kpi">
              <span className="rcw-kpi-icon"><Icon name={kpi.icon} size="sm" /></span>
              <div className="min-w-0">
                <p className="rcw-kpi-value">{kpi.value}</p>
                <p className="rcw-kpi-label">{kpi.label}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rcw-split rcw-split-wide">
          {/* ---------- 规则清单（优先级排序） ---------- */}
          <section className="rcw-rail">
            <div className="rcw-rail-head">
              <h3 className="text-sm font-semibold">规则清单</h3>
              {rulesQuery.data && <StatusBadge tone="neutral" dot={false}>{rules.length} / {allRules.length}</StatusBadge>}
            </div>
            <div className="rcw-stack-tight" style={{ padding: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
              <input className="field-input" placeholder="按领域筛选，如：机器学习" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} aria-label="按领域筛选规则" />
              <select className="field-input" value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value)} aria-label="按启用状态筛选">
                <option value="all">全部状态</option><option value="enabled">仅启用</option><option value="disabled">仅停用</option>
              </select>
              <div>
                <p className="rcw-overline" style={{ marginBottom: 'var(--rc-space-2)' }}>排序</p>
                <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                  {SORT_MODES.map((mode) => (
                    <button
                      key={mode.key}
                      type="button"
                      className="rcw-chip rcw-chip-btn"
                      aria-pressed={sortMode === mode.key}
                      onClick={() => setSortMode(mode.key)}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {rulesQuery.isPending ? <LoadingState compact message="正在读取规则…" />
              : rulesQuery.isError ? <ErrorState compact message={rulesQuery.error.message} code={errCode(rulesQuery.error)} onRetry={() => void rulesQuery.refetch()} />
              : rules.length === 0 ? (
                <EmptyState
                  compact
                  icon={ScrollText}
                  title={allRules.length === 0 ? '尚无审计规则' : '没有匹配的规则'}
                  description={allRules.length === 0 ? '载入平台默认规则，或新建一条自定义规则。' : '尝试调整领域关键词或启用状态筛选。'}
                  action={allRules.length === 0 ? (
                    <button type="button" className="btn-primary" disabled={seedMut.isPending} onClick={() => seedMut.mutate()}>
                      <Icon as={Database} size="xs" />载入默认规则
                    </button>
                  ) : undefined}
                />
              ) : (
                <div className="rcw-rail-body rcw-rail-scroll">
                  {rules.map((rule) => {
                    const risk = RISK_LEVELS[rule.risk_level] ?? { label: rule.risk_level, tone: 'neutral' as const }
                    const active = rule.id === selectedId
                    return (
                      <button
                        key={rule.id}
                        type="button"
                        onClick={() => { setSelectedId(rule.id); setExpandedVersion(null) }}
                        aria-pressed={active}
                        className="rcw-rail-item"
                      >
                        <span className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                          <span className="truncate text-sm font-semibold">{rule.name}</span>
                          <span
                            className="rcw-dot"
                            data-tone={rule.is_enabled ? 'success' : 'muted'}
                            title={rule.is_enabled ? '启用中' : '已停用'}
                            aria-hidden="true"
                          />
                        </span>
                        <span className="mono mt-1 block truncate text-[11px] rcw-faint">{rule.rule_key}</span>
                        <span className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-2)' }}>
                          {rule.domain && <span className="rcw-chip">{rule.domain}</span>}
                          <StatusBadge tone={risk.tone} dot={false}>风险 {risk.label}</StatusBadge>
                          <span className="rcw-chip">v{rule.current_version}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
          </section>

          {/* ---------- 规则详情 ---------- */}
          <section className="min-w-0 rcw-stack">
            {!selectedId ? (
              <div className="rcw-card">
                {rulesQuery.isPending ? <LoadingState message="正在读取规则…" />
                  : <EmptyState icon={ScrollText} title="选择左侧规则查看详情" description="也可以载入默认规则，或新建一条自定义规则开始治理。" />}
              </div>
            ) : detailQuery.isPending ? <div className="rcw-card"><LoadingState message="正在读取规则详情…" /></div>
              : detailQuery.isError ? <div className="rcw-card"><ErrorState message={detailQuery.error.message} code={errCode(detailQuery.error)} onRetry={() => void detailQuery.refetch()} /></div>
              : detail && detailRisk ? (
                <>
                  <section className="rcw-card rcw-card-glass">
                    <div className="rcw-row-between" style={{ alignItems: 'flex-start' }}>
                      <div className="min-w-0">
                        <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                          <h3 className="text-base font-semibold">{detail.name}</h3>
                          <span className="rcw-chip">{detail.rule_key}</span>
                          <CopyButton text={detail.rule_key} label="复制键" className="px-2 py-1 text-xs" />
                        </div>
                        <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)' }}>
                          {detail.domain && <StatusBadge tone="neutral" dot={false}>{detail.domain}</StatusBadge>}
                          <StatusBadge tone={detailRisk.tone} dot={false}>风险 {detailRisk.label}</StatusBadge>
                          <StatusBadge tone={detail.is_enabled ? 'success' : 'neutral'}>{detail.is_enabled ? '启用中' : '已停用'}</StatusBadge>
                          <StatusBadge tone="accent" dot={false}>当前 v{detail.current_version}</StatusBadge>
                        </div>
                      </div>
                      <button type="button" className="btn-ghost" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate({ id: detail.id, enabled: !detail.is_enabled })}>
                        <Icon as={Power} size="xs" />{detail.is_enabled ? '停用规则' : '启用规则'}
                      </button>
                    </div>
                    {detail.description && <p className="mt-3 text-sm leading-relaxed rcw-muted">{detail.description}</p>}
                    {detail.evidence_requirement && (
                      <p className="rcw-row mt-2" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                        <Icon as={FileText} size="xs" tone="accent" style={{ marginTop: 3 }} />
                        <span className="text-xs rcw-muted">证据要求：{detail.evidence_requirement}</span>
                      </p>
                    )}
                    <p className="mono mt-3 text-[11px] rcw-faint">创建 {formatDateTime(detail.created_at)} · 更新 {formatDateTime(detail.updated_at)}</p>
                  </section>

                  <section className="rcw-card">
                    <div style={{ padding: '0 var(--rc-space-2) var(--rc-space-1)' }}>
                      <Tabs active={tab} onChange={setTab} tabs={[
                        { key: 'versions', label: '版本', icon: GitBranch, count: versions.length },
                        { key: 'samples', label: '测试样本', icon: FlaskConical, count: detail.test_samples.length },
                        { key: 'eval', label: '离线评估', icon: Gauge },
                      ]} />
                    </div>

                    <div className="rcw-stack" style={{ marginTop: 'var(--rc-space-4)' }}>
                      {tab === 'versions' && (
                        <>
                          <div className="rcw-row-between">
                            <p className="text-xs rcw-muted">版本只增不改：回滚会复制目标版本生成全新版本号，历史完整保留。</p>
                            <button type="button" className="btn-primary" onClick={openVersion}><Icon name="plus" size="xs" />新建版本</button>
                          </div>
                          {versionsQuery.isPending ? <LoadingState compact message="正在读取版本历史…" />
                            : versionsQuery.isError ? <ErrorState compact message={versionsQuery.error.message} code={errCode(versionsQuery.error)} onRetry={() => void versionsQuery.refetch()} />
                            : versions.length === 0 ? <EmptyState compact icon={GitBranch} title="暂无版本记录" />
                            : (
                              <div className="rcw-timeline">
                                {versions.map((v) => (
                                  <div key={v.id} className="rcw-timeline-item" style={{ marginBottom: 'var(--rc-space-3)' }}>
                                    <span className="rcw-timeline-dot" data-tone={v.is_active ? 'accent' : 'muted'} aria-hidden="true" />
                                    <div className="rcw-card rcw-card-tight">
                                      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                        <span className="mono text-xs font-semibold rcw-ink">v{v.version}</span>
                                        {v.is_active && <StatusBadge tone="success">当前激活</StatusBadge>}
                                        <span className="min-w-0 flex-1 truncate text-sm">{v.change_note || '（无变更说明）'}</span>
                                        <StatusBadge tone="neutral" dot={false}>{v.sample_count} 条样本</StatusBadge>
                                      </div>
                                      <p className="mono mt-1 text-[11px] rcw-faint">{formatDateTime(v.created_at)} · 创建人 {v.created_by ?? '—'}</p>
                                      <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginTop: 'var(--rc-space-2)' }}>
                                        <button
                                          type="button"
                                          className="btn-ghost px-2 py-1 text-xs"
                                          aria-expanded={expandedVersion === v.id}
                                          onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}
                                        >
                                          {expandedVersion === v.id ? <Icon name="chevronDown" size="xs" /> : <Icon as={ChevronRight} size="xs" />}检查逻辑 JSON
                                        </button>
                                        {!v.is_active && (
                                          <button type="button" className="rcw-danger px-2 py-1 text-xs" onClick={() => setRollbackTarget(v)}>
                                            <Icon name="rotate" size="xs" />回滚到此版本
                                          </button>
                                        )}
                                      </div>
                                      {expandedVersion === v.id && <div className="mt-2"><JsonBlock value={v.check_logic} maxHeight="max-h-56" /></div>}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                        </>
                      )}

                      {tab === 'samples' && (
                        <>
                          <div className="rcw-row-between">
                            <p className="text-xs rcw-muted">样本绑定当前激活版本 v{detail.current_version}，由确定性评估器逐条比对期望与实际输出。</p>
                            <button type="button" className="btn-primary" disabled={testMut.isPending || detail.test_samples.length === 0} onClick={() => testMut.mutate(detail.id)}>
                              <Icon name="play" size="xs" />{testMut.isPending ? '测试运行中…' : '运行样本测试'}
                            </button>
                          </div>
                          {detail.test_samples.length === 0
                            ? <EmptyState compact icon={FlaskConical} title="当前版本没有测试样本" description="新建版本时附带样本，或回滚到带样本的历史版本。" />
                            : (
                              <div className="rcw-grid rcw-grid-2">
                                {detail.test_samples.map((s) => (
                                  <div key={s.id} className="rcw-card rcw-card-tight">
                                    <p className="mono text-xs font-semibold">{s.label || s.id}</p>
                                    <p className="field-label mt-2">输入 input</p>
                                    <JsonBlock value={s.input} maxHeight="max-h-40" />
                                    <p className="field-label mt-2">期望 expected</p>
                                    <JsonBlock value={s.expected} maxHeight="max-h-40" />
                                  </div>
                                ))}
                              </div>
                            )}
                          {shownTest && (
                            <section className="rcw-card rcw-card-flat">
                              <div className="rcw-row" style={{ gap: 'var(--rc-space-4)' }}>
                                <div>
                                  <p className="text-[11px] rcw-faint">样本通过率</p>
                                  <p
                                    className="mono text-3xl font-semibold"
                                    style={{ color: shownTest.pass_rate >= 1 ? 'var(--rc-success)' : shownTest.pass_rate > 0 ? 'var(--rc-warning)' : 'var(--rc-danger)' }}
                                  >
                                    {pct(shownTest.pass_rate)}
                                  </p>
                                </div>
                                <div className="rcw-row" style={{ gap: 'var(--rc-space-1)' }}>
                                  <StatusBadge tone="accent" dot={false}>版本 v{shownTest.version}</StatusBadge>
                                  <StatusBadge tone="success" dot={false}>通过 {shownTest.passed}</StatusBadge>
                                  <StatusBadge tone="danger" dot={false}>失败 {shownTest.failed}</StatusBadge>
                                  <StatusBadge tone="neutral" dot={false}>共 {shownTest.total} 条</StatusBadge>
                                </div>
                              </div>
                              <div className="rcw-stack-tight" style={{ marginTop: 'var(--rc-space-3)' }}>
                                {shownTest.results.map((r) => (
                                  <div key={r.sample_id} className="rcw-card rcw-card-tight">
                                    <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                      <span className="mono text-xs font-medium">{r.label || r.sample_id}</span>
                                      <StatusBadge tone={r.passed ? 'success' : 'danger'} dot={false}>{r.passed ? '✓ 匹配' : '✗ 不匹配'}</StatusBadge>
                                    </div>
                                    {r.error && <p className="mt-1 text-xs" style={{ color: 'var(--rc-danger)' }}>{r.error}</p>}
                                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                                      <div><p className="field-label">期望 expected</p><JsonBlock value={r.expected} maxHeight="max-h-40" /></div>
                                      <div><p className="field-label">实际 actual</p><JsonBlock value={r.actual} maxHeight="max-h-40" /></div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </section>
                          )}
                        </>
                      )}

                      {tab === 'eval' && (
                        <>
                          <section className="rcw-card rcw-card-flat rcw-card-tight">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Field label="数据集标识 dataset_ref">
                                <input className="field-input mono" placeholder="如：imagenet_val_subset_v1" value={evalDataset} onChange={(e) => setEvalDataset(e.target.value)} />
                              </Field>
                              <Field label="基线版本（留空 = 单版本评估）">
                                <select className="field-input" value={evalBaseline} onChange={(e) => setEvalBaseline(e.target.value)}>
                                  <option value="">单版本评估（当前激活 v{detail.current_version}）</option>
                                  {versions.map((v) => <option key={v.id} value={v.version}>对比基线 v{v.version}{v.is_active ? '（当前激活）' : ''}</option>)}
                                </select>
                              </Field>
                            </div>
                            <div className="mt-3">
                              <div className="rcw-row-between">
                                <label className="field-label" style={{ marginBottom: 0 }}>评估样本 JSON（input + expected，至少 1 条）</label>
                                <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={loadEvalSamples} disabled={detail.test_samples.length === 0}>
                                  <Icon as={Layers} size="xs" />从测试样本载入
                                </button>
                              </div>
                              <textarea className="field-input mono mt-1.5 text-xs" rows={7} placeholder={SAMPLE_EXAMPLE} value={evalSamples} onChange={(e) => { setEvalSamples(e.target.value); setEvalError(null) }} />
                            </div>
                            {evalError && <p className="mt-2 text-xs" style={{ color: 'var(--rc-danger)' }}>{evalError}</p>}
                            <div className="mt-3 flex justify-end">
                              <button type="button" className="btn-primary" disabled={evalMut.isPending} onClick={submitEval}>
                                <Icon as={Gauge} size="xs" />{evalMut.isPending ? '评估中…' : '开始离线评估'}
                              </button>
                            </div>
                          </section>

                          {shownEval && (isCompare(shownEval) ? (
                            <section className="rcw-card">
                              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                <StatusBadge tone="accent" dot={false}>版本对比评估</StatusBadge>
                                <span className="mono text-xs font-medium">v{shownEval.baseline.version} → v{shownEval.candidate.version}</span>
                                {shownEval.dataset_ref && <span className="mono text-xs rcw-faint">{shownEval.dataset_ref}</span>}
                              </div>
                              <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)' }}>
                                {METRIC_KEYS.map((key) => {
                                  const d = shownEval.delta[key]
                                  if (typeof d !== 'number') return null
                                  const good = LOWER_BETTER.has(key) ? d < 0 : d > 0
                                  const tone = d === 0 ? 'neutral' : good ? 'success' : 'danger'
                                  return <StatusBadge key={key} tone={tone} dot={false}>{METRIC_LABELS[key]} {d > 0 ? '+' : ''}{(d * 100).toFixed(1)}pp</StatusBadge>
                                })}
                              </div>
                              <div className="rcw-grid rcw-grid-2" style={{ marginTop: 'var(--rc-space-3)' }}>
                                <div className="rcw-card rcw-card-tight">
                                  <p className="mb-2 text-xs font-semibold rcw-muted">基线 v{shownEval.baseline.version}</p>
                                  <MetricsBoard compact metrics={shownEval.baseline.metrics} />
                                  <EvalSampleTable compact results={shownEval.baseline.results} />
                                </div>
                                <div className="rcw-card rcw-card-tight" style={{ borderColor: 'var(--rc-accent)' }}>
                                  <p className="mb-2 text-xs font-semibold rcw-ink">候选 v{shownEval.candidate.version}（当前激活）</p>
                                  <MetricsBoard compact metrics={shownEval.candidate.metrics} />
                                  <EvalSampleTable compact results={shownEval.candidate.results} />
                                </div>
                              </div>
                            </section>
                          ) : (
                            <section className="rcw-card">
                              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                <StatusBadge tone="accent" dot={false}>单版本评估 v{shownEval.version}</StatusBadge>
                                {shownEval.dataset_ref && <span className="mono text-xs rcw-faint">{shownEval.dataset_ref}</span>}
                              </div>
                              <div className="mt-3">
                                <MetricsBoard metrics={shownEval.metrics} />
                                <EvalSampleTable results={shownEval.results} />
                              </div>
                            </section>
                          ))}

                          <section className="rcw-card">
                            <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
                              <h4 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                                <Icon as={History} size="sm" tone="accent" />评估历史
                              </h4>
                              {evalsQuery.data && <StatusBadge tone="neutral" dot={false}>{evalsQuery.data.total} 次</StatusBadge>}
                            </div>
                            <div style={{ marginTop: 'var(--rc-space-3)' }}>
                              {evalsQuery.isPending ? <LoadingState compact message="正在读取评估历史…" />
                                : evalsQuery.isError ? <ErrorState compact message={evalsQuery.error.message} code={errCode(evalsQuery.error)} onRetry={() => void evalsQuery.refetch()} />
                                : <DataTable
                                  columns={evalHistoryColumns}
                                  data={evalsQuery.data?.items ?? []}
                                  rowKey={(e) => e.id}
                                  empty={<EmptyState compact icon={Gauge} title="尚无评估记录" description="运行一次离线评估后，指标会落库并显示在这里。" />}
                                />}
                            </div>
                          </section>
                        </>
                      )}
                    </div>
                  </section>
                </>
              ) : null}
          </section>
        </div>
      </div>

      {/* 新建规则 */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} wide title="新建审计规则"
        description="创建后生成 v1 并激活；可附带测试样本用于离线验证。需要 rule.manage 权限。"
        footer={<ModalActions onCancel={() => setCreateOpen(false)} onSubmit={submitCreate} pending={createMut.isPending} label="创建规则" pendingLabel="创建中…" icon={Plus} />}>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="规则键 rule_key *" hint="小写字母 / 数字 / 下划线 / 连字符，2–80 位，全局唯一。" error={ruleErrors.rule_key}>
              <input className="field-input mono" placeholder="accuracy_tolerance_0p1" value={ruleForm.rule_key} onChange={(e) => setRuleForm({ ...ruleForm, rule_key: e.target.value })} />
            </Field>
            <Field label="规则名称 *" error={ruleErrors.name}>
              <input className="field-input" placeholder="准确率容差校验（0.1%）" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} />
            </Field>
            <Field label="领域 domain">
              <input className="field-input" placeholder="机器学习" value={ruleForm.domain} onChange={(e) => setRuleForm({ ...ruleForm, domain: e.target.value })} />
            </Field>
            <Field label="风险等级 risk_level">
              <select className="field-input" value={ruleForm.risk_level} onChange={(e) => setRuleForm({ ...ruleForm, risk_level: e.target.value })}>
                {Object.entries(RISK_LEVELS).map(([key, m]) => <option key={key} value={key}>{m.label}（{key}）</option>)}
              </select>
            </Field>
          </div>
          <Field label="描述 description">
            <textarea className="field-input" rows={2} placeholder="说明该规则的审计目的与判定口径" value={ruleForm.description} onChange={(e) => setRuleForm({ ...ruleForm, description: e.target.value })} />
          </Field>
          <Field label="证据要求 evidence_requirement">
            <input className="field-input" placeholder="需论文侧与复现侧双侧原文证据。" value={ruleForm.evidence_requirement} onChange={(e) => setRuleForm({ ...ruleForm, evidence_requirement: e.target.value })} />
          </Field>
          <LogicFieldset draft={ruleLogic} onChange={setRuleLogic} error={ruleErrors.logic} />
          <SamplesField label="测试样本 test_samples（可选，JSON 数组）" value={ruleSamples} onChange={setRuleSamples} error={ruleErrors.samples} />
          <Field label="变更说明 change_note">
            <input className="field-input" placeholder="初始版本" value={ruleForm.change_note} onChange={(e) => setRuleForm({ ...ruleForm, change_note: e.target.value })} />
          </Field>
        </div>
      </Modal>

      {/* 新建版本 */}
      <Modal open={versionOpen} onClose={() => setVersionOpen(false)} wide title={`新建版本（当前 v${detail?.current_version ?? '—'}）`}
        description="逻辑已预填当前激活版本；后端要求新版本至少 1 条测试样本，先离线验证再上生产。"
        footer={<ModalActions onCancel={() => setVersionOpen(false)} onSubmit={submitVersion} pending={versionMut.isPending} label="创建并激活新版本" pendingLabel="提交中…" icon={GitBranch} />}>
        <div className="space-y-3">
          <LogicFieldset draft={versionLogic} onChange={setVersionLogic} error={versionErrors.logic} />
          <Field label="变更说明 change_note">
            <input className="field-input" placeholder="如：放宽容差至 0.1%，覆盖混合精度训练场景" value={versionNote} onChange={(e) => setVersionNote(e.target.value)} />
          </Field>
          <SamplesField
            label="测试样本 test_samples *（JSON 数组，至少 1 条）"
            rows={7}
            value={versionSamples}
            onChange={setVersionSamples}
            error={versionErrors.samples}
            hint="每条样本须含 input（a/b 两侧字段）与 expected（期望输出）对象，label 可选。"
          />
        </div>
      </Modal>

      {/* 回滚确认 */}
      <Modal open={!!rollbackTarget} onClose={() => setRollbackTarget(null)} title="确认回滚版本"
        description="回滚不会删除或改写任何历史版本，该操作将写入审计轨迹。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRollbackTarget(null)}>取消</button>
            <button type="button" className="rcw-danger" disabled={rollbackMut.isPending}
              onClick={() => { if (rollbackTarget && selectedId) rollbackMut.mutate({ ruleId: selectedId, version: rollbackTarget.version }) }}>
              <Icon as={RotateCcw} size="xs" />{rollbackMut.isPending ? '回滚中…' : '确认回滚'}
            </button>
          </>
        }>
        {rollbackTarget && (
          <div className="space-y-2 text-sm rcw-muted">
            <p>
              将复制 <span className="mono font-semibold" style={{ color: 'var(--rc-text)' }}>v{rollbackTarget.version}</span> 的检查逻辑与{' '}
              <span className="mono font-semibold" style={{ color: 'var(--rc-text)' }}>{rollbackTarget.sample_count}</span> 条测试样本，生成全新版本{' '}
              <span className="mono font-semibold" style={{ color: 'var(--rc-text)' }}>v{(detail?.current_version ?? rollbackTarget.version) + 1}</span> 并立即激活。
            </p>
            <p className="text-xs rcw-faint">当前激活版本将自动停用；需要 rule.manage 权限。</p>
            <JsonBlock value={rollbackTarget.check_logic} maxHeight="max-h-40" />
          </div>
        )}
      </Modal>
    </div>
  )
}
