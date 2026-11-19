import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronRight, Database, FileText, FlaskConical, Gauge, GitBranch,
  History, Layers, Play, Plus, Power, RotateCcw, ScrollText, ShieldCheck, Timer, X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
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
const DANGER_BTN = 'inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50'

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
      {hint && <p className="mt-1 text-[11px] text-ink-subtle">{hint}</p>}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

function ModalActions({ onCancel, onSubmit, pending, label, pendingLabel, icon: Icon }: {
  onCancel: () => void; onSubmit: () => void; pending: boolean; label: string; pendingLabel: string; icon: LucideIcon
}) {
  return (
    <>
      <button type="button" className="btn-ghost" onClick={onCancel}>取消</button>
      <button type="button" className="btn-primary" disabled={pending} onClick={onSubmit}>
        <Icon size={16} strokeWidth={1.8} />{pending ? pendingLabel : label}
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
    <div className="rounded-lg border border-line-soft p-3">
      <p className="mb-2 text-xs font-semibold text-ink-muted">检查逻辑 check_logic_json</p>
      <LogicEditor value={draft} onChange={onChange} />
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
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
    <div className="space-y-3">
      <div className={compact ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6'}>
        {METRIC_KEYS.map((key) => (
          <div key={key} className={`rounded-md border border-line-soft bg-canvas py-2 ${compact ? 'px-2.5' : 'px-3'}`}>
            <p className="text-[11px] text-ink-subtle">{METRIC_LABELS[key]}</p>
            <p className={`mono mt-0.5 font-semibold text-ink ${compact ? 'text-base' : 'text-lg'}`}>{pct(metrics[key])}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-stretch gap-3">
        <div className="grid w-52 shrink-0 grid-cols-2 gap-1.5">
          {cells.map((c) => (
            <div key={c.key} className={`rounded-md px-3 py-2 ${c.cls}`}>
              <p className="text-[11px] font-medium opacity-80">{c.label}</p>
              <p className="mono text-lg font-semibold">{metrics[c.key] ?? 0}</p>
            </div>
          ))}
        </div>
        <div className="flex min-w-[200px] flex-1 flex-col justify-center gap-1.5 rounded-md border border-line-soft px-3 py-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1.5"><Timer size={16} strokeWidth={1.8} />运行耗时：<span className="mono">{formatDuration(metrics.runtime_ms)}</span></span>
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
        ? <span className="inline-flex items-center gap-1 text-xs font-medium text-success" title="全量匹配通过"><Check size={16} strokeWidth={1.8} />{compact ? '' : '通过'}</span>
        : <span className="inline-flex items-center gap-1 text-xs font-medium text-danger" title="全量匹配未通过"><X size={16} strokeWidth={1.8} />{compact ? '' : '未通过'}</span>,
    },
    {
      key: 'error', header: '错误',
      render: (r) => r.error
        ? <span className="text-xs font-medium text-danger" title={r.error}>!</span>
        : <span className="text-xs text-ink-subtle">—</span>,
    },
  ]
  return <div className="mt-3 overflow-hidden rounded-md border border-line-soft"><DataTable dense={compact} columns={columns} data={rows} rowKey={(r) => r.key} /></div>
}

const evalHistoryColumns: Column<RuleEvaluation>[] = [
  { key: 'version', header: '版本', render: (e) => <span className="mono text-xs font-medium">v{e.version}</span> },
  { key: 'dataset', header: '数据集', render: (e) => <span className="mono text-xs text-ink-muted">{e.dataset_ref || '—'}</span> },
  { key: 'precision', header: '精确率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.precision)}</span> },
  { key: 'recall', header: '召回率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.recall)}</span> },
  { key: 'pass_rate', header: '通过率', align: 'right', render: (e) => <span className="mono text-xs">{pct(e.metrics?.pass_rate)}</span> },
  { key: 'ran_by', header: '执行人', render: (e) => e.ran_by_name ? <span className="text-xs text-ink-muted">{e.ran_by_name}</span> : <span className="mono text-[11px] text-ink-subtle">{e.ran_by ?? '—'}</span> },
  { key: 'created', header: '时间', render: (e) => <span className="mono whitespace-nowrap text-[11px] text-ink-muted">{formatDateTime(e.created_at)}</span> },
]

/* ---------------- 页面 ---------------- */

export default function RulesPage() {
  const queryClient = useQueryClient()
  const [domainFilter, setDomainFilter] = useState('')
  const [enabledFilter, setEnabledFilter] = useState('all')
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
  const rules = allRules.filter((r) => (!keyword || r.domain.toLowerCase().includes(keyword)) && (enabledFilter === 'all' || (enabledFilter === 'enabled') === r.is_enabled))
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

  return (
    <div className="space-y-5">
      <PageHeader
        title="审计规则"
        description="规则生命周期管理：版本演进、离线样本测试与版本对比评估。变更须由具备 rule.manage 权限的成员显式发起，全程留痕。"
        actions={
          <>
            <button type="button" className="btn-ghost" disabled={seedMut.isPending} onClick={() => seedMut.mutate()}>
              <Database size={16} strokeWidth={1.8} />{seedMut.isPending ? '载入中…' : '载入默认规则'}
            </button>
            <button type="button" className="btn-primary" onClick={openCreate}><Plus size={16} strokeWidth={1.8} />新建规则</button>
          </>
        }
      />
      <div className="flex items-start gap-3 rounded-panel border border-accent/30 bg-accent-wash px-4 py-3">
        <ShieldCheck size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent-dark" />
        <p className="text-sm leading-relaxed text-accent-dark">规则生命周期受控：单条反馈不会自动修改生产规则；新版本必须携带测试样本，上线前通过样本测试与离线评估把关。</p>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        {/* 左侧：规则主清单 */}
        <section className="panel overflow-hidden">
          <div className="panel-header">
            <h3 className="text-sm font-semibold">规则清单</h3>
            {rulesQuery.data && <StatusBadge tone="neutral" dot={false}>{rules.length} / {allRules.length}</StatusBadge>}
          </div>
          <div className="space-y-2 border-b border-line-soft p-3">
            <input className="field-input" placeholder="按领域筛选，如：机器学习" value={domainFilter} onChange={(e) => setDomainFilter(e.target.value)} aria-label="按领域筛选规则" />
            <select className="field-input" value={enabledFilter} onChange={(e) => setEnabledFilter(e.target.value)} aria-label="按启用状态筛选">
              <option value="all">全部状态</option><option value="enabled">仅启用</option><option value="disabled">仅停用</option>
            </select>
          </div>
          {rulesQuery.isPending ? <LoadingState compact message="正在读取规则…" hint="GET /rules" />
            : rulesQuery.isError ? <ErrorState compact message={rulesQuery.error.message} code={errCode(rulesQuery.error)} onRetry={() => void rulesQuery.refetch()} />
            : rules.length === 0 ? (
              <EmptyState compact icon={ScrollText} title={allRules.length === 0 ? '尚无审计规则' : '没有匹配的规则'}
                description={allRules.length === 0 ? '载入平台默认规则，或新建一条自定义规则。' : '尝试调整领域关键词或启用状态筛选。'}
                action={allRules.length === 0 ? (
                  <button type="button" className="btn-primary" disabled={seedMut.isPending} onClick={() => seedMut.mutate()}><Database size={16} strokeWidth={1.8} />载入默认规则</button>
                ) : undefined} />
            ) : (
              <div className="max-h-[560px] space-y-2 overflow-y-auto p-3">
                {rules.map((rule) => {
                  const risk = RISK_LEVELS[rule.risk_level] ?? { label: rule.risk_level, tone: 'neutral' as const }
                  const active = rule.id === selectedId
                  return (
                    <button key={rule.id} type="button" onClick={() => { setSelectedId(rule.id); setExpandedVersion(null) }}
                      className={`w-full rounded-lg border p-3 text-left transition ${active ? 'border-accent bg-accent-wash' : 'border-line bg-surface hover:border-accent/50 hover:bg-canvas'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-ink">{rule.name}</span>
                        <span className={`h-2 w-2 shrink-0 rounded-full ${rule.is_enabled ? 'bg-success' : 'bg-neutral/50'}`} title={rule.is_enabled ? '启用中' : '已停用'} />
                      </div>
                      <p className="mono mt-0.5 truncate text-[11px] text-ink-subtle">{rule.rule_key}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {rule.domain && <StatusBadge tone="neutral" dot={false}>{rule.domain}</StatusBadge>}
                        <StatusBadge tone={risk.tone} dot={false}>风险 {risk.label}</StatusBadge>
                        <span className="mono rounded bg-canvas px-1.5 text-[10px] leading-5 text-ink-muted">v{rule.current_version}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
        </section>

        {/* 右侧：规则详情 */}
        <section className="min-w-0 space-y-4">
          {!selectedId ? (
            <div className="panel">
              {rulesQuery.isPending ? <LoadingState message="正在读取规则…" />
                : <EmptyState icon={ScrollText} title="选择左侧规则查看详情" description="也可以载入默认规则，或新建一条自定义规则开始治理。" />}
            </div>
          ) : detailQuery.isPending ? <div className="panel"><LoadingState message="正在读取规则详情…" hint="GET /rules/{id}" /></div>
            : detailQuery.isError ? <div className="panel"><ErrorState message={detailQuery.error.message} code={errCode(detailQuery.error)} onRetry={() => void detailQuery.refetch()} /></div>
            : detail && detailRisk ? (
              <>
                <div className="panel p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold">{detail.name}</h3>
                        <span className="mono rounded bg-canvas px-2 py-0.5 text-[11px] text-ink-muted">{detail.rule_key}</span>
                        <CopyButton text={detail.rule_key} label="复制键" className="px-2 py-1 text-xs" />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {detail.domain && <StatusBadge tone="neutral" dot={false}>{detail.domain}</StatusBadge>}
                        <StatusBadge tone={detailRisk.tone} dot={false}>风险 {detailRisk.label}</StatusBadge>
                        <StatusBadge tone={detail.is_enabled ? 'success' : 'neutral'}>{detail.is_enabled ? '启用中' : '已停用'}</StatusBadge>
                        <StatusBadge tone="accent" dot={false}>当前 v{detail.current_version}</StatusBadge>
                      </div>
                    </div>
                    <button type="button" className="btn-ghost" disabled={toggleMut.isPending} onClick={() => toggleMut.mutate({ id: detail.id, enabled: !detail.is_enabled })}>
                      <Power size={16} strokeWidth={1.8} />{detail.is_enabled ? '停用规则' : '启用规则'}
                    </button>
                  </div>
                  {detail.description && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{detail.description}</p>}
                  {detail.evidence_requirement && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                      <FileText size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent-dark" />证据要求：{detail.evidence_requirement}
                    </p>
                  )}
                  <p className="mono mt-3 text-[11px] text-ink-subtle">创建 {formatDateTime(detail.created_at)} · 更新 {formatDateTime(detail.updated_at)}</p>
                </div>

                <div className="panel overflow-hidden">
                  <div className="px-3 pt-2">
                    <Tabs active={tab} onChange={setTab} tabs={[
                      { key: 'versions', label: '版本', icon: GitBranch, count: versions.length },
                      { key: 'samples', label: '测试样本', icon: FlaskConical, count: detail.test_samples.length },
                      { key: 'eval', label: '离线评估', icon: Gauge },
                    ]} />
                  </div>
                  <div className="p-4 sm:p-5">
                    {tab === 'versions' && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-ink-muted">版本只增不改：回滚会复制目标版本生成全新版本号，历史完整保留。</p>
                          <button type="button" className="btn-primary" onClick={openVersion}><Plus size={16} strokeWidth={1.8} />新建版本</button>
                        </div>
                        {versionsQuery.isPending ? <LoadingState compact message="正在读取版本历史…" />
                          : versionsQuery.isError ? <ErrorState compact message={versionsQuery.error.message} code={errCode(versionsQuery.error)} onRetry={() => void versionsQuery.refetch()} />
                          : versions.length === 0 ? <EmptyState compact icon={GitBranch} title="暂无版本记录" />
                          : (
                            <ol className="space-y-3">
                              {versions.map((v) => (
                                <li key={v.id} className="flex gap-3">
                                  <div className="flex flex-col items-center">
                                    <span className={`mono grid h-9 w-9 shrink-0 place-items-center rounded-full text-xs font-semibold ${v.is_active ? 'bg-accent text-accent-dark' : 'border border-line bg-canvas text-ink-muted'}`}>v{v.version}</span>
                                    <span className="mt-1 w-px flex-1 bg-line" />
                                  </div>
                                  <div className="min-w-0 flex-1 rounded-lg border border-line-soft p-3">
                                    <div className="flex flex-wrap items-center gap-2">
                                      {v.is_active && <StatusBadge tone="success">当前激活</StatusBadge>}
                                      <span className="text-sm font-medium text-ink">{v.change_note || '（无变更说明）'}</span>
                                      <StatusBadge tone="neutral" dot={false}>{v.sample_count} 条样本</StatusBadge>
                                    </div>
                                    <p className="mono mt-1 text-[11px] text-ink-subtle">{formatDateTime(v.created_at)} · 创建人 {v.created_by ?? '—'}</p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2">
                                      <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={() => setExpandedVersion(expandedVersion === v.id ? null : v.id)}>
                                        {expandedVersion === v.id ? <ChevronDown size={16} strokeWidth={1.8} /> : <ChevronRight size={16} strokeWidth={1.8} />}检查逻辑 JSON
                                      </button>
                                      {!v.is_active && <button type="button" className={DANGER_BTN} onClick={() => setRollbackTarget(v)}><RotateCcw size={16} strokeWidth={1.8} />回滚到此版本</button>}
                                    </div>
                                    {expandedVersion === v.id && <div className="mt-2"><JsonBlock value={v.check_logic} maxHeight="max-h-56" /></div>}
                                  </div>
                                </li>
                              ))}
                            </ol>
                          )}
                      </div>
                    )}

                    {tab === 'samples' && (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-ink-muted">样本绑定当前激活版本 v{detail.current_version}，由确定性评估器逐条比对期望与实际输出。</p>
                          <button type="button" className="btn-primary" disabled={testMut.isPending || detail.test_samples.length === 0} onClick={() => testMut.mutate(detail.id)}>
                            <Play size={16} strokeWidth={1.8} />{testMut.isPending ? '测试运行中…' : '运行样本测试'}
                          </button>
                        </div>
                        {detail.test_samples.length === 0
                          ? <EmptyState compact icon={FlaskConical} title="当前版本没有测试样本" description="新建版本时附带样本，或回滚到带样本的历史版本。" />
                          : (
                            <div className="grid gap-3 md:grid-cols-2">
                              {detail.test_samples.map((s) => (
                                <div key={s.id} className="rounded-lg border border-line-soft p-3">
                                  <p className="mono text-xs font-semibold text-ink">{s.label || s.id}</p>
                                  <p className="field-label mt-2">输入 input</p>
                                  <JsonBlock value={s.input} maxHeight="max-h-40" />
                                  <p className="field-label mt-2">期望 expected</p>
                                  <JsonBlock value={s.expected} maxHeight="max-h-40" />
                                </div>
                              ))}
                            </div>
                          )}
                        {shownTest && (
                          <div className="rounded-lg border border-line bg-canvas p-4">
                            <div className="flex flex-wrap items-center gap-4">
                              <div>
                                <p className="text-[11px] text-ink-subtle">样本通过率</p>
                                <p className={`mono text-3xl font-semibold ${shownTest.pass_rate >= 1 ? 'text-success' : shownTest.pass_rate > 0 ? 'text-warning' : 'text-danger'}`}>{pct(shownTest.pass_rate)}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <StatusBadge tone="accent" dot={false}>版本 v{shownTest.version}</StatusBadge>
                                <StatusBadge tone="success" dot={false}>通过 {shownTest.passed}</StatusBadge>
                                <StatusBadge tone="danger" dot={false}>失败 {shownTest.failed}</StatusBadge>
                                <StatusBadge tone="neutral" dot={false}>共 {shownTest.total} 条</StatusBadge>
                              </div>
                            </div>
                            <div className="mt-3 space-y-2">
                              {shownTest.results.map((r) => (
                                <div key={r.sample_id} className="rounded-md border border-line-soft bg-surface p-3">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="mono text-xs font-medium">{r.label || r.sample_id}</span>
                                    <StatusBadge tone={r.passed ? 'success' : 'danger'} dot={false}>{r.passed ? '✓ 匹配' : '✗ 不匹配'}</StatusBadge>
                                  </div>
                                  {r.error && <p className="mt-1 text-xs text-danger">{r.error}</p>}
                                  <div className="mt-2 grid gap-2 md:grid-cols-2">
                                    <div><p className="field-label">期望 expected</p><JsonBlock value={r.expected} maxHeight="max-h-40" /></div>
                                    <div><p className="field-label">实际 actual</p><JsonBlock value={r.actual} maxHeight="max-h-40" /></div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {tab === 'eval' && (
                      <div className="space-y-4">
                        <div className="rounded-lg border border-line-soft p-4">
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
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <label className="field-label mb-0">评估样本 JSON（input + expected，至少 1 条）</label>
                              <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={loadEvalSamples} disabled={detail.test_samples.length === 0}>
                                <Layers size={16} strokeWidth={1.8} />从测试样本载入
                              </button>
                            </div>
                            <textarea className="field-input mono mt-1.5 text-xs" rows={7} placeholder={SAMPLE_EXAMPLE} value={evalSamples} onChange={(e) => { setEvalSamples(e.target.value); setEvalError(null) }} />
                          </div>
                          {evalError && <p className="mt-2 text-xs text-danger">{evalError}</p>}
                          <div className="mt-3 flex justify-end">
                            <button type="button" className="btn-primary" disabled={evalMut.isPending} onClick={submitEval}>
                              <Gauge size={16} strokeWidth={1.8} />{evalMut.isPending ? '评估中…' : '开始离线评估'}
                            </button>
                          </div>
                        </div>

                        {shownEval && (isCompare(shownEval) ? (
                          <div className="space-y-3 rounded-lg border border-accent/30 bg-accent-wash p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone="accent" dot={false}>版本对比评估</StatusBadge>
                              <span className="mono text-xs font-medium text-ink">v{shownEval.baseline.version} → v{shownEval.candidate.version}</span>
                              {shownEval.dataset_ref && <span className="mono text-xs text-ink-subtle">{shownEval.dataset_ref}</span>}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {METRIC_KEYS.map((key) => {
                                const d = shownEval.delta[key]
                                if (typeof d !== 'number') return null
                                const good = LOWER_BETTER.has(key) ? d < 0 : d > 0
                                const tone = d === 0 ? 'neutral' : good ? 'success' : 'danger'
                                return <StatusBadge key={key} tone={tone} dot={false}>{METRIC_LABELS[key]} {d > 0 ? '+' : ''}{(d * 100).toFixed(1)}pp</StatusBadge>
                              })}
                            </div>
                            <div className="grid gap-3 xl:grid-cols-2">
                              <div className="rounded-lg border border-line-soft bg-surface p-3">
                                <p className="mb-2 text-xs font-semibold text-ink-muted">基线 v{shownEval.baseline.version}</p>
                                <MetricsBoard compact metrics={shownEval.baseline.metrics} />
                                <EvalSampleTable compact results={shownEval.baseline.results} />
                              </div>
                              <div className="rounded-lg border border-accent/30 bg-surface p-3">
                                <p className="mb-2 text-xs font-semibold text-accent-dark">候选 v{shownEval.candidate.version}（当前激活）</p>
                                <MetricsBoard compact metrics={shownEval.candidate.metrics} />
                                <EvalSampleTable compact results={shownEval.candidate.results} />
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 rounded-lg border border-line-soft p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusBadge tone="accent" dot={false}>单版本评估 v{shownEval.version}</StatusBadge>
                              {shownEval.dataset_ref && <span className="mono text-xs text-ink-subtle">{shownEval.dataset_ref}</span>}
                            </div>
                            <MetricsBoard metrics={shownEval.metrics} />
                            <EvalSampleTable results={shownEval.results} />
                          </div>
                        ))}

                        <div className="overflow-hidden rounded-lg border border-line-soft">
                          <div className="panel-header">
                            <h4 className="flex items-center gap-1.5 text-sm font-semibold"><History size={16} strokeWidth={1.8} />评估历史</h4>
                            {evalsQuery.data && <StatusBadge tone="neutral" dot={false}>{evalsQuery.data.total} 次</StatusBadge>}
                          </div>
                          {evalsQuery.isPending ? <LoadingState compact message="正在读取评估历史…" />
                            : evalsQuery.isError ? <ErrorState compact message={evalsQuery.error.message} code={errCode(evalsQuery.error)} onRetry={() => void evalsQuery.refetch()} />
                            : <DataTable columns={evalHistoryColumns} data={evalsQuery.data?.items ?? []} rowKey={(e) => e.id}
                                empty={<EmptyState compact icon={Gauge} title="尚无评估记录" description="运行一次离线评估后，指标会落库并显示在这里。" />} />}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : null}
        </section>
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
          <SamplesField label="测试样本 test_samples *（JSON 数组，至少 1 条）" rows={7} value={versionSamples} onChange={setVersionSamples}
            error={versionErrors.samples} hint="每条样本须含 input（a/b 两侧字段）与 expected（期望输出）对象，label 可选。" />
        </div>
      </Modal>

      {/* 回滚确认 */}
      <Modal open={!!rollbackTarget} onClose={() => setRollbackTarget(null)} title="确认回滚版本"
        description="回滚不会删除或改写任何历史版本，该操作将写入审计轨迹。"
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setRollbackTarget(null)}>取消</button>
            <button type="button" className={DANGER_BTN} disabled={rollbackMut.isPending}
              onClick={() => { if (rollbackTarget && selectedId) rollbackMut.mutate({ ruleId: selectedId, version: rollbackTarget.version }) }}>
              <RotateCcw size={16} strokeWidth={1.8} />{rollbackMut.isPending ? '回滚中…' : '确认回滚'}
            </button>
          </>
        }>
        {rollbackTarget && (
          <div className="space-y-2 text-sm text-ink-muted">
            <p>
              将复制 <span className="mono font-semibold text-ink">v{rollbackTarget.version}</span> 的检查逻辑与{' '}
              <span className="mono font-semibold text-ink">{rollbackTarget.sample_count}</span> 条测试样本，生成全新版本{' '}
              <span className="mono font-semibold text-ink">v{(detail?.current_version ?? rollbackTarget.version) + 1}</span> 并立即激活。
            </p>
            <p className="text-xs text-ink-subtle">当前激活版本将自动停用；需要 rule.manage 权限。</p>
            <JsonBlock value={rollbackTarget.check_logic} maxHeight="max-h-40" />
          </div>
        )}
      </Modal>
    </div>
  )
}