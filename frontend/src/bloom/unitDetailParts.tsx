import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Icon } from '../components/Icon'
import { api } from '../services/api'
import { dataAuditApi } from '../services/dataAuditApi'
import { reproductionApi } from '../services/reproductionApi'
import { stage6Api } from '../services/stage6Api'
import type { MaterialType } from '../types/api'

/* ---------------- 数据钩子：与工作台摘要共用同一缓存键 ---------------- */

export function useProjectMaterials(projectId: string) {
  return useQuery({
    queryKey: ['materials', projectId],
    queryFn: () => api.listMaterials(projectId),
    enabled: Boolean(projectId),
  })
}

export function useProjectTasks(projectId: string) {
  return useQuery({
    queryKey: ['parse-tasks', projectId],
    queryFn: () => api.listTasks(projectId),
    enabled: Boolean(projectId),
  })
}

export function useParseOverview(projectId: string) {
  return useQuery({
    queryKey: ['parse-overview', projectId],
    queryFn: () => api.getParseOverview(projectId),
    enabled: Boolean(projectId),
  })
}

export function useFactsSummary(projectId: string) {
  return useQuery({
    queryKey: ['facts-summary', projectId],
    queryFn: () => api.getFactsSummary(projectId),
    enabled: Boolean(projectId),
  })
}

export function useEvidenceGraph(projectId: string) {
  return useQuery({
    queryKey: ['evidence-graph', projectId],
    queryFn: () => api.getEvidenceGraph(projectId),
    enabled: Boolean(projectId),
  })
}

export function useReproPlans(projectId: string) {
  return useQuery({
    queryKey: ['repro-plans', projectId],
    queryFn: () => reproductionApi.listPlans(projectId),
    enabled: Boolean(projectId),
  })
}

export function usePlanDetail(planId: string | undefined) {
  return useQuery({
    queryKey: ['repro-plan', planId],
    queryFn: () => reproductionApi.getPlan(planId as string),
    enabled: Boolean(planId),
  })
}

export function useReproEnvironments(projectId: string) {
  return useQuery({
    queryKey: ['repro-envs', projectId],
    queryFn: () => reproductionApi.listEnvironments(projectId),
    enabled: Boolean(projectId),
  })
}

export function useReproRuns(projectId: string) {
  return useQuery({
    queryKey: ['repro-runs', projectId],
    queryFn: () => reproductionApi.listRuns(projectId),
    enabled: Boolean(projectId),
  })
}

export function useReproQuality(projectId: string) {
  return useQuery({
    queryKey: ['repro-quality', projectId],
    queryFn: () => reproductionApi.getQuality(projectId),
    enabled: Boolean(projectId),
  })
}

export function useComparisons(projectId: string) {
  return useQuery({
    queryKey: ['repro-comparisons', projectId],
    queryFn: () => reproductionApi.listComparisons(projectId),
    enabled: Boolean(projectId),
  })
}

export function useReproReports(projectId: string) {
  return useQuery({
    queryKey: ['repro-reports', projectId],
    queryFn: () => reproductionApi.listReports(projectId),
    enabled: Boolean(projectId),
  })
}

export function useVerdictSummary(projectId: string) {
  return useQuery({
    queryKey: ['verdict-summary', projectId],
    queryFn: () => api.getVerdictSummary(projectId),
    enabled: Boolean(projectId),
  })
}

export function useProjectMembers(projectId: string) {
  return useQuery({
    queryKey: ['project-members', projectId],
    queryFn: () => stage6Api.listProjectMembers(projectId),
    enabled: Boolean(projectId),
  })
}

export function useDataAudits(projectId: string) {
  return useQuery({
    queryKey: ['data-audits', projectId],
    queryFn: () => dataAuditApi.list(projectId),
    enabled: Boolean(projectId),
  })
}

/* ---------------- 共享展示块 ---------------- */

export type MetricItem = {
  label: string
  value: string | number
  hint?: string
}

export function MetricGrid({ items }: { items: MetricItem[] }) {
  return (
    <div className="bloom-metrics">
      {items.map((item) => (
        <div className="bloom-metric" key={item.label}>
          <div className="bloom-metric__label">{item.label}</div>
          <div className="bloom-metric__value">{item.value}</div>
          {item.hint && <div className="bloom-metric__hint">{item.hint}</div>}
        </div>
      ))}
    </div>
  )
}

export function Section({
  title,
  icon: UnitIcon,
  note,
  children,
}: {
  title: string
  icon?: LucideIcon
  note?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="bloom-section">
      <div className="bloom-section__head">
        <h3 className="bloom-section__title">
          {UnitIcon && <Icon as={UnitIcon} size={14} />}
          {title}
        </h3>
        {note && <span className="bloom-section__note">{note}</span>}
      </div>
      {children}
    </section>
  )
}

export function BarRow({
  label,
  value,
  max,
  display,
  tone,
}: {
  label: string
  value: number
  max: number
  display: string
  tone?: 'warning' | 'danger'
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="bloom-bar-row">
      <span className="bloom-bar-row__label" title={label}>
        {label}
      </span>
      <span className="bloom-bar">
        <span
          className={`bloom-bar__fill${tone ? ` is-${tone}` : ''}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="bloom-bar-row__value">{display}</span>
    </div>
  )
}

export function Chip({ tone = 'neutral', children }: { tone?: string; children: ReactNode }) {
  return <span className={`bloom-chip tone-${tone}`}>{children}</span>
}

export function EmptyNote({
  title,
  description,
  action,
}: {
  title: string
  description: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="bloom-empty">
      <strong>{title}</strong>
      <span>{description}</span>
      {action}
    </div>
  )
}

export function PanelLoading({ label }: { label: string }) {
  return <div className="bloom-note">正在读取{label}…</div>
}

export function PanelError({
  label,
  onRetry,
}: {
  label: string
  onRetry?: () => void
}) {
  return (
    <div className="bloom-note is-warning">
      <span>{label}读取失败；页面其余单元不受影响。</span>
      {onRetry && (
        <button type="button" className="bloom-chip tone-warning" onClick={onRetry}>
          重试
        </button>
      )}
    </div>
  )
}

/* ---------------- 文案映射（对后端历史状态保持宽容） ---------------- */

const MATERIAL_STATUS: Record<string, { label: string; tone: string }> = {
  uploaded: { label: '已上传', tone: 'neutral' },
  queued: { label: '排队中', tone: 'neutral' },
  parsing: { label: '解析中', tone: 'accent' },
  extracting: { label: '抽取中', tone: 'accent' },
  parsed: { label: '已解析', tone: 'success' },
  completed: { label: '已完成', tone: 'success' },
  partially_completed: { label: '部分完成', tone: 'warning' },
  failed: { label: '失败', tone: 'danger' },
  unsupported: { label: '不支持', tone: 'danger' },
}

export function materialStatus(status: string): { label: string; tone: string } {
  return MATERIAL_STATUS[status] ?? { label: status || '未知', tone: 'neutral' }
}

const RUN_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: '等待中', tone: 'neutral' },
  queued: { label: '排队中', tone: 'neutral' },
  running: { label: '运行中', tone: 'accent' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
  cancel_requested: { label: '取消中', tone: 'warning' },
  blocked_no_sandbox: { label: '无沙箱阻塞', tone: 'danger' },
  blocked_security: { label: '安全阻塞', tone: 'danger' },
}

export function runStatus(status: string): { label: string; tone: string } {
  return RUN_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const TASK_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: '待确认', tone: 'neutral' },
  blocked: { label: '阻塞', tone: 'danger' },
  confirmed: { label: '已确认', tone: 'accent' },
  running: { label: '运行中', tone: 'accent' },
  completed: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
}

export function planTaskStatus(status: string): { label: string; tone: string } {
  return TASK_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const PLAN_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: '草稿', tone: 'neutral' },
  active: { label: '进行中', tone: 'accent' },
  confirmed: { label: '已确认', tone: 'success' },
  completed: { label: '已完成', tone: 'success' },
  archived: { label: '已归档', tone: 'neutral' },
  blocked: { label: '阻塞', tone: 'danger' },
}

export function planStatus(status: string): { label: string; tone: string } {
  return PLAN_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const FEASIBILITY: Record<string, { label: string; tone: string }> = {
  feasible: { label: '可行', tone: 'success' },
  ready: { label: '就绪', tone: 'success' },
  needs_human_review: { label: '待人工', tone: 'warning' },
  missing_material: { label: '缺材料', tone: 'warning' },
  missing_dependency: { label: '缺依赖', tone: 'warning' },
  missing_configuration: { label: '缺配置', tone: 'warning' },
  blocked_security: { label: '安全阻塞', tone: 'danger' },
  unverifiable: { label: '不可验证', tone: 'danger' },
}

export function feasibility(status: string): { label: string; tone: string } {
  return FEASIBILITY[status] ?? { label: status, tone: 'neutral' }
}

const VERDICT: Record<string, { label: string; tone: string }> = {
  exact_match: { label: '完全一致', tone: 'success' },
  within_tolerance: { label: '容差内', tone: 'success' },
  significant_deviation: { label: '显著偏差', tone: 'danger' },
  insufficient_data: { label: '数据不足', tone: 'warning' },
  not_comparable: { label: '不可比', tone: 'neutral' },
  needs_manual_review: { label: '待复核', tone: 'warning' },
}

export function comparisonVerdict(verdict: string): { label: string; tone: string } {
  return VERDICT[verdict] ?? { label: verdict, tone: 'neutral' }
}

const MEMBER_ROLE: Record<string, string> = {
  project_lead: '项目负责人',
  researcher: '研究员',
  reviewer: '复核员',
  viewer: '观察者',
}

export function memberRole(role: string): string {
  return MEMBER_ROLE[role] ?? role
}

const MATERIAL_TYPE_LABEL: Record<MaterialType, string> = {
  pdf: 'PDF',
  python: 'Python',
  notebook: 'Notebook',
  zip: '压缩包',
  yaml: 'YAML',
  json: 'JSON',
  toml: 'TOML',
  requirements: '依赖清单',
  readme: 'README',
  text: '文本',
  csv: 'CSV',
  xlsx: 'Excel',
  code_repository: '代码仓库',
  unknown: '其他',
}

export function materialTypeLabel(type: string): string {
  return MATERIAL_TYPE_LABEL[type as MaterialType] ?? type
}

export function isDataMaterial(type: string): boolean {
  return type === 'csv' || type === 'xlsx'
}

export function isCodeMaterial(type: string): boolean {
  return type === 'python' || type === 'notebook' || type === 'zip' ||
    type === 'requirements' || type === 'code_repository'
}

export function isConfigMaterial(type: string): boolean {
  return type === 'yaml' || type === 'json' || type === 'toml'
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`
  return `${(ms / 3_600_000).toFixed(1)} h`
}
