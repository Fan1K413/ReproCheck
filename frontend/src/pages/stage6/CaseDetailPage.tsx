import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  ExternalLink,
  FileText,
  FlaskConical,
  GitBranch,
  Globe,
  Info,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Scale,
  Search,
  ShieldCheck,
  Target,
  User,
  XCircle,
} from 'lucide-react'
import { Fragment, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { JsonBlock } from '../../components/JsonBlock'
import { LoadingState } from '../../components/LoadingState'
import { Modal } from '../../components/Modal'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { displayValue, formatConfidence, formatDateTime } from '../../features/format'
import { QUALITY_LEVELS, VERIFICATION_RESULTS, VERIFICATION_TYPES, qualityMeta, qualityRank } from '../../features/stage6Meta'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'
import { toast } from '../../stores/toastStore'
import type {
  BenchmarkCase,
  CaseFact,
  FactSchemaData,
  QualityEvidence,
  QualityRecomputeResult,
  Traceability,
  VerificationCreated,
} from '../../types/stage6'

/* 与后端 benchmark_service.SOURCE_TYPES 完全一致 */
const SOURCE_TYPES = [
  { key: 'paper', label: '论文原文' },
  { key: 'code', label: '代码仓库' },
  { key: 'config', label: '配置文件' },
  { key: 'log', label: '运行日志' },
  { key: 'dataset_card', label: '数据集说明' },
  { key: 'manual', label: '人工录入' },
  { key: 'execution', label: '执行复现' },
  { key: 'review', label: '人工复核' },
  { key: 'other', label: '其他' },
]
const sourceLabel = (key: string) => SOURCE_TYPES.find((item) => item.key === key)?.label ?? key

/* 全部取自后端 ENVIRONMENT_KEYS 常量；任一非空即视为「声明运行环境」 */
const ENV_FIELDS = [
  { key: 'gpu', label: 'GPU 型号', placeholder: 'NVIDIA A100 80GB' },
  { key: 'gpu_count', label: 'GPU 数量', placeholder: '4' },
  { key: 'cpu', label: 'CPU 型号', placeholder: 'Intel Xeon 8358' },
  { key: 'memory', label: '内存（GB）', placeholder: '256' },
  { key: 'python_version', label: 'Python 版本', placeholder: '3.10.12' },
  { key: 'pytorch_version', label: 'PyTorch 版本', placeholder: '2.1.0' },
  { key: 'cuda_version', label: 'CUDA 版本', placeholder: '12.1' },
  { key: 'operating_system', label: '操作系统', placeholder: 'Ubuntu 22.04' },
  { key: 'driver_version', label: '驱动版本', placeholder: '535.104.05' },
  { key: 'framework', label: '深度学习框架', placeholder: 'PyTorch' },
  { key: 'docker_image', label: '容器镜像', placeholder: 'nvcr.io/nvidia/pytorch:23.10' },
  { key: 'mixed_precision', label: '混合精度', placeholder: 'fp16 / bf16 / fp32' },
  { key: 'code_commit', label: '代码提交号', placeholder: 'commit SHA' },
]

const COUNT_LABELS: Record<string, string> = {
  total: '验证总数',
  execution_pass: '执行通过',
  execution_pass_with_environment: '执行通过·含环境',
  review_pass: '复核通过',
  fail: '失败',
  partial: '部分通过',
}

const FACT_COLUMNS: Column<CaseFact>[] = [
  {
    key: 'field',
    header: '字段',
    render: (fact) => (
      <div className="min-w-[150px]">
        <p className="mono text-xs font-semibold text-accent-dark">{fact.field_key}</p>
        <p className="mt-0.5 text-xs text-ink">{fact.label}{fact.is_standard ? '' : '（自定义）'}</p>
        <p className="mt-0.5 text-[10px] text-ink-subtle">
          {fact.category_label}
          {fact.raw_field && fact.raw_field !== fact.field_key && <span className="mono"> · 原文 {fact.raw_field}</span>}
        </p>
      </div>
    ),
  },
  {
    key: 'raw',
    header: '原始值',
    render: (fact) => (
      <span className="mono text-xs">
        {fact.raw_value}
        {fact.unit && <span className="ml-1 rounded bg-canvas px-1 text-[10px] text-ink-subtle">{fact.unit}</span>}
      </span>
    ),
  },
  {
    key: 'normalized',
    header: '归一值',
    render: (fact) =>
      fact.normalized_value ? (
        <span className="mono text-xs text-success">{displayValue(fact.normalized_value, fact.unit)}</span>
      ) : (
        <span className="text-xs text-ink-subtle">—</span>
      ),
  },
  {
    key: 'source',
    header: '来源',
    render: (fact) => (
      <div className="min-w-[120px]">
        <StatusBadge tone="neutral" dot={false}>{sourceLabel(fact.source_type)}</StatusBadge>
        {fact.source_ref && (
          <p className="mono mt-1 max-w-[200px] truncate text-[10px] text-ink-subtle" title={fact.source_ref}>{fact.source_ref}</p>
        )}
      </div>
    ),
  },
  {
    key: 'confidence',
    header: '置信度',
    align: 'right',
    render: (fact) => (
      <div className="flex flex-col items-end gap-1">
        <span className="mono text-xs">{formatConfidence(fact.confidence)}</span>
        <span className="h-1 w-14 overflow-hidden rounded-full bg-canvas">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round(fact.confidence * 100)}%` }} />
        </span>
      </div>
    ),
  },
  {
    key: 'experiment',
    header: '适用实验',
    render: (fact) => (
      <div className="max-w-[170px] text-xs text-ink-muted">
        {fact.applicable_experiment || '—'}
        {fact.context && <p className="mt-0.5 truncate text-[10px] text-ink-subtle" title={fact.context}>{fact.context}</p>}
      </div>
    ),
  },
]

function QualityBadge({ level }: { level: string }) {
  const meta = qualityMeta(level)
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
}

function Ladder({ current }: { current: string }) {
  const rank = qualityRank(current)
  return (
    <div className="flex items-start">
      {QUALITY_LEVELS.map((step, index) => (
        <Fragment key={step.key}>
          {index > 0 && <div className={`mt-3.5 h-0.5 flex-1 ${index <= rank ? 'bg-accent' : 'bg-line'}`} />}
          <div className="flex w-20 shrink-0 flex-col items-center gap-1.5 sm:w-28">
            <div
              className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                index < rank
                  ? 'bg-success text-white'
                  : index === rank
                    ? 'bg-accent text-accent-dark ring-4 ring-accent-wash'
                    : 'bg-canvas text-ink-subtle ring-1 ring-line'
              }`}
            >
              {index < rank ? <Check size={14} strokeWidth={2.2} /> : index + 1}
            </div>
            <span className={`text-center text-[11px] leading-tight ${index === rank ? 'font-semibold text-accent-dark' : 'text-ink-subtle'}`}>
              {step.label}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  )
}

type BasisItem = NonNullable<QualityEvidence['basis']>[number]

function BasisList({ items, muted = false }: { items: BasisItem[]; muted?: boolean }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item.verification_id} className="flex items-start gap-2 text-xs">
          <BadgeCheck size={14} className={`mt-0.5 shrink-0 ${muted ? 'text-ink-subtle' : 'text-success'}`} />
          <div className="min-w-0">
            <p className={muted ? 'text-ink-muted' : 'text-ink'}>{item.reason}</p>
            <p className="mono mt-0.5 text-[10px] text-ink-subtle">
              {VERIFICATION_TYPES[item.verification_type] ?? item.verification_type} · {VERIFICATION_RESULTS[item.result]?.label ?? item.result} · {formatDateTime(item.created_at)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function EvidenceView({ evidence, full = false }: { evidence: QualityEvidence; full?: boolean }) {
  const counts = Object.entries(evidence.counts ?? {})
  const notes = evidence.notes ?? []
  return (
    <div className="space-y-3">
      {counts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {counts.map(([key, value]) => (
            <span key={key} className="rounded bg-canvas px-2 py-1 text-[11px] text-ink-muted ring-1 ring-line">
              {COUNT_LABELS[key] ?? key} <b className="mono text-ink">{value}</b>
            </span>
          ))}
        </div>
      )}
      {(evidence.basis?.length ?? 0) > 0 && <BasisList items={evidence.basis ?? []} />}
      {full && (evidence.supporting?.length ?? 0) > 0 && (
        <details className="rounded-md border border-line-soft bg-canvas/50 p-3">
          <summary className="cursor-pointer text-xs font-medium text-ink-muted">辅助证据（{evidence.supporting?.length ?? 0} 条）</summary>
          <div className="mt-2"><BasisList items={evidence.supporting ?? []} muted /></div>
        </details>
      )}
      {full && evidence.environment && Object.keys(evidence.environment).length > 0 && (
        <div>
          <p className="field-label">运行环境证据</p>
          <JsonBlock value={evidence.environment} maxHeight="max-h-40" />
        </div>
      )}
      {full && evidence.independent_reviewer_user_id && (
        <p className="text-[11px] text-ink-muted">独立复核人：<span className="mono">{evidence.independent_reviewer_user_id}</span></p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1">
          {notes.map((note, index) => (
            <li key={`${note}-${index}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted">
              <Info size={13} className="mt-0.5 shrink-0 text-accent-dark" /> {note}
            </li>
          ))}
        </ul>
      )}
      {full && (
        <p className="mono text-[10px] text-ink-subtle">
          rule_version: {evidence.rule_version ?? '—'} · computed_at: {formatDateTime(evidence.computed_at)}
          {evidence.downgrade_blocked ? ' · 降级已拦截' : ''}
        </p>
      )}
    </div>
  )
}

function RecomputeResultPanel({ result }: { result: QualityRecomputeResult }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <QualityBadge level={result.previous_level} />
        <ArrowRight size={15} strokeWidth={1.8} className="text-ink-subtle" />
        <QualityBadge level={result.quality_level} />
        {result.changed ? <StatusBadge tone="success">等级已变更</StatusBadge> : <StatusBadge tone="neutral">等级未变化</StatusBadge>}
        {result.downgrade_blocked && <StatusBadge tone="danger">降级被拦截</StatusBadge>}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
        计算等级 <QualityBadge level={result.computed_level} /> · 纳入验证 <b className="mono">{result.verification_count}</b> 条
      </p>
      <EvidenceView evidence={result.quality_evidence} full />
    </div>
  )
}

function TracePanel({ trace }: { trace: Traceability }) {
  const flags = [
    { label: '来源文献（doi/URL）', ok: trace.has_source },
    { label: '代码仓库指针', ok: trace.has_code },
    { label: '代码提交号', ok: trace.has_code_commit },
    { label: '许可声明', ok: trace.has_license },
  ]
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {flags.map((flag) => (
          <div
            key={flag.label}
            className={`flex items-center gap-2 rounded-md border p-2.5 text-xs ${
              flag.ok ? 'border-success/30 bg-success-wash text-success' : 'border-line bg-canvas text-ink-subtle'
            }`}
          >
            {flag.ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />} {flag.label}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-muted">
        <StatusBadge tone={trace.complete ? 'success' : 'warning'}>{trace.complete ? '追溯链完整' : '追溯链存在缺口'}</StatusBadge>
        <span className="rounded bg-canvas px-2 py-0.5 ring-1 ring-line">
          分发策略：<span className="mono">{trace.redistribution}</span>（仅元数据与指针）
        </span>
      </div>
      {trace.warnings.length > 0 && (
        <ul className="space-y-1">
          {trace.warnings.map((warning, index) => (
            <li key={`${warning}-${index}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warning">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {warning}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

type FactForm = {
  raw_field: string; field_key: string; raw_value: string; unit: string; source_type: string
  source_ref: string; context: string; applicable_experiment: string; confidence: number
}
const EMPTY_FACT: FactForm = {
  raw_field: '', field_key: '', raw_value: '', unit: '', source_type: 'paper',
  source_ref: '', context: '', applicable_experiment: '', confidence: 0.8,
}

function FactModal({ open, onClose, caseId, schema }: { open: boolean; onClose: () => void; caseId: string; schema: FactSchemaData | undefined }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FactForm>(EMPTY_FACT)
  const [errors, setErrors] = useState<{ field?: string; value?: string }>({})
  const mutation = useMutation({
    mutationFn: () =>
      stage6Api.addCaseFact(caseId, {
        raw_field: form.raw_field.trim() || undefined,
        field_key: form.field_key || undefined,
        raw_value: form.raw_value.trim(),
        unit: form.unit.trim() || undefined,
        source_type: form.source_type,
        source_ref: form.source_ref.trim() || undefined,
        context: form.context.trim() || undefined,
        applicable_experiment: form.applicable_experiment.trim() || undefined,
        confidence: form.confidence,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'case-facts', caseId] })
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'case', caseId] })
      toast.success('事实已录入，字段与数值已自动归一化')
      setForm(EMPTY_FACT)
      setErrors({})
      onClose()
    },
    onError: (error) => toast.error(error.message),
  })
  const submit = () => {
    const next: { field?: string; value?: string } = {}
    if (!form.raw_field.trim() && !form.field_key) next.field = '请选择标准字段，或填写原文字段名'
    if (!form.raw_value.trim()) next.value = '字段值不能为空'
    setErrors(next)
    if (next.field || next.value) return
    mutation.mutate()
  }
  return (
    <Modal
      open={open}
      wide
      title="添加案例事实"
      description="原始值永不丢失：raw_field/raw_value 与归一化结果同时保存。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" disabled={mutation.isPending} onClick={submit}><Plus size={15} strokeWidth={1.8} /> 录入事实</button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">标准字段（field_key）</label>
          <select className="field-input" value={form.field_key} onChange={(event) => setForm((prev) => ({ ...prev, field_key: event.target.value }))}>
            <option value="">自定义（按原文字段名归一化）</option>
            {(schema?.categories ?? []).map((category) => (
              <optgroup key={category.key} label={category.label}>
                {(schema?.fields ?? []).filter((field) => field.category === category.key).map((field) => (
                  <option key={field.field_key} value={field.field_key}>{field.label}（{field.field_key}）</option>
                ))}
              </optgroup>
            ))}
          </select>
          {errors.field && <p className="mt-1 text-xs text-danger">{errors.field}</p>}
        </div>
        <div>
          <label className="field-label">原文字段名（raw_field）</label>
          <input className="field-input" maxLength={120} placeholder="论文中的写法，如 Top-1 Acc (%)" value={form.raw_field} onChange={(event) => setForm((prev) => ({ ...prev, raw_field: event.target.value }))} />
        </div>
        <div>
          <label className="field-label">原始值（raw_value）*</label>
          <input className="field-input" placeholder="如 76.13% / 1e-3 / 90 epochs" value={form.raw_value} onChange={(event) => setForm((prev) => ({ ...prev, raw_value: event.target.value }))} />
          {errors.value && <p className="mt-1 text-xs text-danger">{errors.value}</p>}
        </div>
        <div>
          <label className="field-label">单位覆盖（可选）</label>
          <input className="field-input" maxLength={40} placeholder="留空则按字段目录自动推断" value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} />
        </div>
        <div>
          <label className="field-label">来源类型</label>
          <select className="field-input" value={form.source_type} onChange={(event) => setForm((prev) => ({ ...prev, source_type: event.target.value }))}>
            {SOURCE_TYPES.map((item) => <option key={item.key} value={item.key}>{item.label}（{item.key}）</option>)}
          </select>
        </div>
        <div>
          <label className="field-label">来源定位（source_ref）</label>
          <input className="field-input" maxLength={300} placeholder="Table 2 / §4.1 / run.log:L120" value={form.source_ref} onChange={(event) => setForm((prev) => ({ ...prev, source_ref: event.target.value }))} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">适用实验（applicable_experiment）</label>
          <input className="field-input" maxLength={200} placeholder="如 ImageNet top-1 主实验 / 消融 A3" value={form.applicable_experiment} onChange={(event) => setForm((prev) => ({ ...prev, applicable_experiment: event.target.value }))} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">上下文备注</label>
          <textarea className="field-input resize-y" rows={2} placeholder="原文语境、测量口径、注意事项" value={form.context} onChange={(event) => setForm((prev) => ({ ...prev, context: event.target.value }))} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">置信度（辅助参考，非校准概率）</label>
          <div className="flex items-center gap-3">
            <input type="range" min={0} max={1} step={0.05} className="flex-1 cursor-pointer accent-accent" value={form.confidence} onChange={(event) => setForm((prev) => ({ ...prev, confidence: Number(event.target.value) }))} />
            <span className="mono w-14 text-right text-sm font-semibold text-accent-dark">{formatConfidence(form.confidence)}</span>
          </div>
        </div>
        <p className="text-[11px] leading-relaxed text-ink-subtle sm:col-span-2">
          字段键由后端按原文字段名/别名自动归一化；未收录字段降级为 snake_case 并标记为非标准，不丢弃信息。
          {!schema && ' 标准字段目录暂不可用（加载中或请求失败），可直接填写原文字段名。'}
        </p>
      </div>
    </Modal>
  )
}

type VerifForm = { verification_type: string; result: string; notes: string; project_id: string; extraJson: string }
const EMPTY_VERIF: VerifForm = { verification_type: 'execution', result: 'pass', notes: '', project_id: '', extraJson: '' }

function VerificationModal({ open, onClose, caseId, benchmark, onResult }: {
  open: boolean; onClose: () => void; caseId: string; benchmark: BenchmarkCase; onResult: (result: VerificationCreated) => void
}) {
  const queryClient = useQueryClient()
  const user = useAuthStore((state) => state.user)
  const [form, setForm] = useState<VerifForm>(EMPTY_VERIF)
  const [env, setEnv] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<{ extra?: string }>({})
  const mutation = useMutation({
    mutationFn: (conditions: Record<string, unknown> | null) =>
      stage6Api.addVerification(caseId, {
        verification_type: form.verification_type,
        result: form.result,
        conditions_json: conditions,
        notes: form.notes.trim(),
        project_id: form.project_id.trim() || null,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'case', caseId] })
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'case-verifications', caseId] })
      toast.success(
        result.changed
          ? `验证已提交：质量等级 ${qualityMeta(result.previous_level).label} → ${qualityMeta(result.quality_level).label}`
          : '验证已提交，质量等级保持不变',
      )
      setForm(EMPTY_VERIF)
      setEnv({})
      setErrors({})
      onClose()
      onResult(result)
    },
    onError: (error) => toast.error(error.message),
  })
  const submit = () => {
    const conditions: Record<string, unknown> = {}
    if (form.verification_type === 'execution') {
      for (const field of ENV_FIELDS) {
        const value = (env[field.key] ?? '').trim()
        if (value) conditions[field.key] = value
      }
    }
    if (form.extraJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(form.extraJson)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
        Object.assign(conditions, parsed as Record<string, unknown>)
      } catch {
        setErrors({ extra: '附加条件须为合法的 JSON 对象，如 {"seed": 42}' })
        return
      }
    }
    setErrors({})
    mutation.mutate(Object.keys(conditions).length > 0 ? conditions : null)
  }
  const isExecution = form.verification_type === 'execution'
  return (
    <Modal
      open={open}
      wide
      title="提交验证记录"
      description="提交后系统按验证证据自动重算质量等级（只升不降），并写入审计轨迹。"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn-ghost" onClick={onClose}>取消</button>
          <button type="button" className="btn-primary" disabled={mutation.isPending} onClick={submit}><ClipboardCheck size={15} strokeWidth={1.8} /> 提交验证</button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">验证类型</label>
            <select className="field-input" value={form.verification_type} onChange={(event) => setForm((prev) => ({ ...prev, verification_type: event.target.value }))}>
              {Object.entries(VERIFICATION_TYPES).map(([key, label]) => <option key={key} value={key}>{label}（{key}）</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">验证结果</label>
            <select className="field-input" value={form.result} onChange={(event) => setForm((prev) => ({ ...prev, result: event.target.value }))}>
              {Object.entries(VERIFICATION_RESULTS).map(([key, meta]) => <option key={key} value={key}>{meta.label}（{key}）</option>)}
            </select>
          </div>
        </div>

        {isExecution ? (
          <div className="rounded-md border border-line bg-canvas/50 p-3">
            <p className="text-xs font-semibold text-ink">运行环境声明（conditions_json）</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
              以下键均来自后端 ENVIRONMENT_KEYS，任一非空即视为「声明运行环境」；execution pass ＋ 环境 → 执行验证。
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {ENV_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="field-label">{field.label} <span className="mono font-normal text-ink-subtle">{field.key}</span></label>
                  <input className="field-input" placeholder={field.placeholder} value={env[field.key] ?? ''} onChange={(event) => setEnv((prev) => ({ ...prev, [field.key]: event.target.value }))} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-line bg-canvas/50 p-3">
            <p className="field-label mb-1">复核人身份（由登录会话决定，不可指定他人）</p>
            <p className="text-sm font-medium text-ink">
              {user?.display_name ?? '当前登录用户'} <span className="mono text-[10px] font-normal text-ink-subtle">{user?.id ?? ''}</span>
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
              后端将当前账号记录为 verifier_user_id。仅当复核人 ≠ 执行验证人且 ≠ 案例创建者（{benchmark.created_by_name || benchmark.created_by}）时，
              review pass 才构成独立复核，可升级为「独立复核」。
            </p>
          </div>
        )}

        <div>
          <label className="field-label">附加条件 JSON（可选，合并进 conditions_json）</label>
          <textarea className="field-input mono resize-y text-xs" rows={2} placeholder='{"seed": 42, "batch_size": 256}' value={form.extraJson} onChange={(event) => setForm((prev) => ({ ...prev, extraJson: event.target.value }))} />
          {errors.extra && <p className="mt-1 text-xs text-danger">{errors.extra}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label">备注（notes）</label>
            <textarea className="field-input resize-y" rows={2} placeholder="复现口径、与原文差异、失败原因等" value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} />
          </div>
          <div>
            <label className="field-label">关联项目 ID（可选）</label>
            <input className="field-input mono" placeholder="project_…" value={form.project_id} onChange={(event) => setForm((prev) => ({ ...prev, project_id: event.target.value }))} />
          </div>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent-wash p-3 text-[11px] leading-relaxed text-accent-dark">
          <Info size={14} strokeWidth={1.8} className="mt-0.5 shrink-0" />
          <span>
            阶梯规则：review pass → 部分验证；execution pass＋环境键 → 执行验证；在此之上由不同用户 review pass → 独立复核；
            fail/partial 不升级。重算默认只升不降，降级需在「质量评估」页显式确认。
          </span>
        </div>
      </div>
    </Modal>
  )
}

export default function CaseDetailPage() {
  const { caseId = '' } = useParams()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('facts')
  const [factOpen, setFactOpen] = useState(false)
  const [verifOpen, setVerifOpen] = useState(false)
  const [verifResult, setVerifResult] = useState<VerificationCreated | null>(null)
  const [recomputeResult, setRecomputeResult] = useState<QualityRecomputeResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [factFieldInput, setFactFieldInput] = useState('')
  const [factFilters, setFactFilters] = useState({ fieldKey: '', category: '' })

  const caseQuery = useQuery({ queryKey: ['stage6', 'case', caseId], queryFn: () => stage6Api.getCase(caseId), enabled: Boolean(caseId) })
  const factsQuery = useQuery({
    queryKey: ['stage6', 'case-facts', caseId, factFilters],
    queryFn: () => stage6Api.listCaseFacts(caseId, { field_key: factFilters.fieldKey || undefined, category: factFilters.category || undefined }),
    enabled: Boolean(caseId),
  })
  const verificationsQuery = useQuery({ queryKey: ['stage6', 'case-verifications', caseId], queryFn: () => stage6Api.listVerifications(caseId), enabled: Boolean(caseId) })
  const schemaQuery = useQuery({ queryKey: ['stage6', 'fact-schema'], queryFn: stage6Api.getFactSchema })

  const recomputeMutation = useMutation({
    mutationFn: (confirmDowngrade: boolean) => stage6Api.recomputeQuality(caseId, confirmDowngrade),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6', 'case', caseId] })
      setRecomputeResult(result)
      setConfirmOpen(false)
      if (result.downgrade_blocked) {
        setConfirmOpen(true)
        toast.info('计算等级低于当前等级，降级需显式确认')
      } else {
        toast.success(
          result.changed
            ? `质量等级已更新：${qualityMeta(result.previous_level).label} → ${qualityMeta(result.quality_level).label}`
            : '重算完成，质量等级保持不变',
        )
      }
    },
    onError: (error) => toast.error(error.message),
  })

  const backLink = (
    <Link to="/benchmark" className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition hover:text-accent-dark">
      <ArrowLeft size={16} strokeWidth={1.8} /> 基准案例库
    </Link>
  )

  if (!caseId) {
    return (
      <div className="space-y-5">
        {backLink}
        <section className="panel"><EmptyState title="缺少案例 ID" description="请从基准案例库选择一个案例查看详情。" /></section>
      </div>
    )
  }
  if (caseQuery.isPending) {
    return <div className="space-y-5">{backLink}<section className="panel"><LoadingState message="正在读取案例详情…" /></section></div>
  }
  if (caseQuery.isError) {
    return (
      <div className="space-y-5">
        {backLink}
        <section className="panel">
          <ErrorState
            message={caseQuery.error.message}
            code={caseQuery.error instanceof ApiError ? caseQuery.error.code : undefined}
            onRetry={() => void caseQuery.refetch()}
          />
        </section>
      </div>
    )
  }

  const benchmark = caseQuery.data
  const quality = qualityMeta(benchmark.quality_level)
  const standard = benchmark.quality_standard
  const currentRequirement = standard?.levels.find((level) => level.key === benchmark.quality_level)?.requirement
  const doiHref = benchmark.doi.startsWith('http') ? benchmark.doi : `https://doi.org/${benchmark.doi}`
  const verifications = verificationsQuery.data?.items ?? []
  const chipClass = 'inline-flex items-center gap-1.5 rounded-md bg-accent-wash px-2 py-1 text-[11px] font-medium text-accent-dark'

  return (
    <div className="space-y-5">
      {backLink}

      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">{benchmark.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusBadge tone={quality.tone}>{quality.label}</StatusBadge>
              {benchmark.domain && <StatusBadge tone="navy" dot={false}>{benchmark.domain}</StatusBadge>}
              <StatusBadge tone={benchmark.is_public ? 'success' : 'neutral'} dot={false}>
                {benchmark.is_public ? <Globe size={12} /> : <Lock size={12} />}
                {benchmark.is_public ? '公开' : '组织内'}
              </StatusBadge>
              {benchmark.license && <StatusBadge tone="neutral" dot={false}><Scale size={12} /> {benchmark.license}</StatusBadge>}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-xs">
            {benchmark.doi && (
              <a href={doiHref} target="_blank" rel="noreferrer" className="mono inline-flex items-center gap-1 text-accent-dark hover:underline">
                <ExternalLink size={13} /> {benchmark.doi}
              </a>
            )}
            {benchmark.source_url && (
              <a href={benchmark.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-dark hover:underline">
                <ExternalLink size={13} /> 来源链接
              </a>
            )}
          </div>
        </div>
        {(benchmark.model_architecture || benchmark.dataset_name || benchmark.research_task) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {benchmark.model_architecture && <span className={chipClass}><Cpu size={13} /> {benchmark.model_architecture}</span>}
            {benchmark.dataset_name && <span className={chipClass}><Database size={13} /> {benchmark.dataset_name}</span>}
            {benchmark.research_task && <span className={chipClass}><Target size={13} /> {benchmark.research_task}</span>}
          </div>
        )}
        {benchmark.summary && <p className="mt-3 text-sm leading-relaxed text-ink-muted">{benchmark.summary}</p>}
        {benchmark.code_repo_url && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas/60 p-2.5 text-xs">
            <GitBranch size={14} strokeWidth={1.8} className="shrink-0 text-accent-dark" />
            <a href={benchmark.code_repo_url} target="_blank" rel="noreferrer" className="mono max-w-[46%] truncate text-accent-dark hover:underline">
              {benchmark.code_repo_url}
            </a>
            {benchmark.code_commit && (
              <>
                <span className="mono rounded bg-surface px-1.5 py-0.5 text-[10px] ring-1 ring-line">{benchmark.code_commit}</span>
                <CopyButton text={benchmark.code_commit} label="复制 commit" className="!px-2 !py-1 text-[11px]" />
              </>
            )}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-[11px] text-ink-subtle">
          <span>创建者：{benchmark.created_by_name || <span className="mono">{benchmark.created_by}</span>}</span>
          <span className="mono">创建 {formatDateTime(benchmark.created_at)}</span>
          <span className="mono">更新 {formatDateTime(benchmark.updated_at)}</span>
          <span className="mono">v{benchmark.version}</span>
          <CopyButton text={benchmark.id} label="复制案例 ID" className="!px-2 !py-1 text-[11px]" />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <FlaskConical size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">质量阶梯</h3>
          </div>
          <StatusBadge tone="neutral" dot={false}><span className="mono">{benchmark.quality_evidence.rule_version ?? 'stage6-b1'}</span></StatusBadge>
        </div>
        <div className="space-y-4 p-5">
          <Ladder current={benchmark.quality_level} />
          {currentRequirement && <p className="text-xs leading-relaxed text-ink-muted">当前等级要求：{currentRequirement}</p>}
          <EvidenceView evidence={benchmark.quality_evidence} />
          {standard && (
            <details className="rounded-md border border-line-soft bg-canvas/50 p-3">
              <summary className="cursor-pointer text-xs font-medium text-ink-muted">等级判定标准（{standard.rule_version}）</summary>
              <ul className="mt-2 space-y-1.5">
                {standard.levels.map((level) => (
                  <li key={level.key} className="text-[11px] leading-relaxed text-ink-muted">
                    <b className="text-ink">{level.label}</b>：{level.requirement}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div className="flex items-center gap-2">
            <Link2 size={16} strokeWidth={1.8} className="text-accent-dark" />
            <h3 className="text-sm font-semibold">来源可追溯性</h3>
          </div>
        </div>
        <div className="p-5"><TracePanel trace={benchmark.traceability} /></div>
      </section>

      <section className="panel overflow-hidden">
        <div className="px-5 pt-3">
          <Tabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: 'facts', label: '事实', icon: FileText, count: benchmark.fact_count ?? factsQuery.data?.total },
              { key: 'verifications', label: '验证记录', icon: ClipboardCheck, count: benchmark.verification_count ?? verificationsQuery.data?.total },
              { key: 'quality', label: '质量评估', icon: ShieldCheck },
            ]}
          />
        </div>
        <div className="p-5">
          {tab === 'facts' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[180px] flex-1">
                  <label className="field-label">字段键筛选（精确匹配）</label>
                  <input
                    className="field-input"
                    placeholder="如 learning_rate，回车应用"
                    value={factFieldInput}
                    onChange={(event) => setFactFieldInput(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') setFactFilters((prev) => ({ ...prev, fieldKey: factFieldInput.trim() })) }}
                  />
                </div>
                <div className="min-w-[160px]">
                  <label className="field-label">类别</label>
                  {schemaQuery.data ? (
                    <select className="field-input" value={factFilters.category} onChange={(event) => setFactFilters((prev) => ({ ...prev, category: event.target.value }))}>
                      <option value="">全部类别</option>
                      {schemaQuery.data.categories.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                      <option value="other">其他（非标准字段）</option>
                    </select>
                  ) : (
                    <input
                      className="field-input"
                      placeholder="类别键，如 metric"
                      value={factFilters.category}
                      onChange={(event) => setFactFilters((prev) => ({ ...prev, category: event.target.value }))}
                    />
                  )}
                </div>
                <button type="button" className="btn-ghost" onClick={() => setFactFilters((prev) => ({ ...prev, fieldKey: factFieldInput.trim() }))}>
                  <Search size={15} strokeWidth={1.8} /> 筛选
                </button>
                <button type="button" className="btn-primary" onClick={() => setFactOpen(true)}><Plus size={16} strokeWidth={1.8} /> 添加事实</button>
              </div>
              {factsQuery.isPending ? (
                <LoadingState compact message="正在读取案例事实…" />
              ) : factsQuery.isError ? (
                <ErrorState
                  compact
                  message={factsQuery.error.message}
                  code={factsQuery.error instanceof ApiError ? factsQuery.error.code : undefined}
                  onRetry={() => void factsQuery.refetch()}
                />
              ) : (
                <DataTable
                  columns={FACT_COLUMNS}
                  data={factsQuery.data.items}
                  rowKey={(fact) => fact.id}
                  empty={
                    <EmptyState
                      compact
                      icon={FileText}
                      title="尚无匹配的案例事实"
                      description="录入论文/代码中的关键数值与配置，归一化后即可用于比对与检索。"
                      action={<button type="button" className="btn-primary" onClick={() => setFactOpen(true)}><Plus size={15} strokeWidth={1.8} /> 添加事实</button>}
                    />
                  }
                />
              )}
            </div>
          )}

          {tab === 'verifications' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-muted">共 {verificationsQuery.data?.total ?? 0} 条验证 · 按时间正序 · 验证人身份由登录会话记录</p>
                <button type="button" className="btn-primary" onClick={() => setVerifOpen(true)}><Plus size={16} strokeWidth={1.8} /> 添加验证</button>
              </div>
              {verificationsQuery.isPending ? (
                <LoadingState compact message="正在读取验证记录…" />
              ) : verificationsQuery.isError ? (
                <ErrorState
                  compact
                  message={verificationsQuery.error.message}
                  code={verificationsQuery.error instanceof ApiError ? verificationsQuery.error.code : undefined}
                  onRetry={() => void verificationsQuery.refetch()}
                />
              ) : verifications.length === 0 ? (
                <EmptyState
                  compact
                  icon={ClipboardCheck}
                  title="尚无验证记录"
                  description="提交执行复现或人工复核后，质量等级将按证据自动计算。"
                  action={<button type="button" className="btn-primary" onClick={() => setVerifOpen(true)}><Plus size={15} strokeWidth={1.8} /> 添加验证</button>}
                />
              ) : (
                <ol className="relative ml-2 space-y-4 border-l border-line pl-5">
                  {verifications.map((verification) => {
                    const resultMeta = VERIFICATION_RESULTS[verification.result] ?? { label: verification.result, tone: 'neutral' as const }
                    const dotClass = verification.result === 'pass' ? 'bg-success' : verification.result === 'fail' ? 'bg-danger' : 'bg-warning'
                    return (
                      <li key={verification.id} className="relative">
                        <span className={`absolute -left-[26px] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-surface ${dotClass}`} />
                        <div className="panel p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{VERIFICATION_TYPES[verification.verification_type] ?? verification.verification_type}</span>
                              <StatusBadge tone={resultMeta.tone}>{resultMeta.label}</StatusBadge>
                            </div>
                            <span className="mono text-[11px] text-ink-subtle">{formatDateTime(verification.created_at)}</span>
                          </div>
                          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
                            <User size={13} /> {verification.verifier_name || '未知用户'}
                            <span className="mono text-[10px] text-ink-subtle">{verification.verifier_user_id}</span>
                          </p>
                          {verification.notes && <p className="mt-2 text-xs leading-relaxed text-ink">{verification.notes}</p>}
                          {Object.keys(verification.conditions).length > 0 && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[11px] font-medium text-accent-dark">条件 JSON（conditions）</summary>
                              <div className="mt-1.5"><JsonBlock value={verification.conditions} maxHeight="max-h-48" /></div>
                            </details>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ol>
              )}
            </div>
          )}

          {tab === 'quality' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">等级判定规则</h4>
                  {standard && <StatusBadge tone="navy" dot={false}><span className="mono">{standard.rule_version}</span></StatusBadge>}
                </div>
                <ol className="mt-3 space-y-2">
                  {(standard?.levels ?? QUALITY_LEVELS.map((level) => ({ key: level.key, label: level.label, requirement: '' }))).map((level, index) => (
                    <li key={level.key} className="flex items-start gap-2.5 text-xs">
                      <span className="mono mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-wash text-[10px] font-semibold text-accent-dark">{index + 1}</span>
                      <div>
                        <QualityBadge level={level.key} />
                        {level.requirement && <p className="mt-1 leading-relaxed text-ink-muted">{level.requirement}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
                {standard && (
                  <>
                    <ul className="mt-3 space-y-1 border-t border-line-soft pt-3">
                      {standard.principles.map((principle, index) => (
                        <li key={`${principle}-${index}`} className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-muted">
                          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-success" /> {principle}
                        </li>
                      ))}
                    </ul>
                    <details className="mt-3">
                      <summary className="cursor-pointer text-[11px] font-medium text-accent-dark">
                        环境键清单（{standard.environment_keys.length}）· 验证类型 {standard.verification_types.join(' / ')} · 结果 {standard.results.join(' / ')}
                      </summary>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {standard.environment_keys.map((key) => (
                          <span key={key} className="mono rounded bg-canvas px-1.5 py-0.5 text-[10px] text-ink-muted ring-1 ring-line">{key}</span>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </div>

              <div className="rounded-lg border border-line p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold">重新计算质量等级</h4>
                    <p className="mt-0.5 text-[11px] text-ink-muted">默认只升不降；若计算等级低于当前等级，需显式确认降级（写入审计轨迹）。</p>
                  </div>
                  <button type="button" className="btn-primary" disabled={recomputeMutation.isPending} onClick={() => recomputeMutation.mutate(false)}>
                    <RefreshCw size={15} strokeWidth={1.8} /> 重新计算质量
                  </button>
                </div>
                {recomputeResult && (
                  <div className="mt-4 border-t border-line-soft pt-4">
                    <RecomputeResultPanel result={recomputeResult} />
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-line p-4">
                <h4 className="text-sm font-semibold">当前质量证据</h4>
                <div className="mt-3"><EvidenceView evidence={benchmark.quality_evidence} full /></div>
              </div>
            </div>
          )}
        </div>
      </section>

      <FactModal open={factOpen} onClose={() => setFactOpen(false)} caseId={caseId} schema={schemaQuery.data} />
      <VerificationModal open={verifOpen} onClose={() => setVerifOpen(false)} caseId={caseId} benchmark={benchmark} onResult={setVerifResult} />

      <Modal
        open={verifResult !== null}
        title="验证提交结果"
        description="系统已按验证证据自动重算质量等级（只升不降）。"
        onClose={() => setVerifResult(null)}
        footer={<button type="button" className="btn-primary" onClick={() => setVerifResult(null)}>知道了</button>}
      >
        {verifResult && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-canvas/60 p-3 text-xs">
              <span className="font-medium">{VERIFICATION_TYPES[verifResult.verification.verification_type] ?? verifResult.verification.verification_type}</span>
              <StatusBadge tone={VERIFICATION_RESULTS[verifResult.verification.result]?.tone ?? 'neutral'}>
                {VERIFICATION_RESULTS[verifResult.verification.result]?.label ?? verifResult.verification.result}
              </StatusBadge>
              <span className="mono text-[10px] text-ink-subtle">{verifResult.verification.id}</span>
            </div>
            <RecomputeResultPanel result={verifResult} />
          </div>
        )}
      </Modal>

      <Modal
        open={confirmOpen}
        title="确认降级质量等级"
        description="降级需显式确认，操作将写入审计轨迹。"
        onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirmOpen(false)}>取消</button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-danger px-3 py-2 text-sm font-medium text-white transition hover:bg-danger/90 disabled:opacity-50"
              disabled={recomputeMutation.isPending}
              onClick={() => recomputeMutation.mutate(true)}
            >
              <AlertTriangle size={15} strokeWidth={1.8} /> 确认降级
            </button>
          </>
        }
      >
        {recomputeResult && (
          <div className="space-y-3">
            <div className="rounded-md border border-danger/30 bg-danger-wash p-3 text-xs leading-relaxed text-danger">
              系统按现有验证证据计算的等级为「{qualityMeta(recomputeResult.computed_level).label}」，低于当前等级「{qualityMeta(recomputeResult.previous_level).label}」。
              默认策略只升不降，本次重算已被拦截；确认后案例等级将降为计算值。
            </div>
            <RecomputeResultPanel result={recomputeResult} />
          </div>
        )}
      </Modal>
    </div>
  )
}