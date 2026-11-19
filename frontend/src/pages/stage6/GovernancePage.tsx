import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  CheckCircle2,
  Clock,
  Download,
  History,
  Info,
  Layers,
  ListChecks,
  Package,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { LoadingState } from '../../components/LoadingState'
import { PageHeader } from '../../components/PageHeader'
import { StatusBadge } from '../../components/StatusBadge'
import { Tabs } from '../../components/Tabs'
import { formatDateTime } from '../../features/format'
import { DATA_CLASS_TONES } from '../../features/stage6Meta'
import { useTrackProject } from '../../hooks/useTrackProject'
import { ApiError, api } from '../../services/api'
import { downloadExport, stage6Api } from '../../services/stage6Api'
import { toast } from '../../stores/toastStore'
import { useUIStore } from '../../stores/uiStore'
import type { AiConsent, DataClass, RetentionPolicy } from '../../types/stage6'

type RetentionRule = RetentionPolicy['rules'][number]

function errorCode(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code : undefined
}

const consentColumns: Column<AiConsent>[] = [
  {
    key: 'decision',
    header: '授权决定',
    render: (c) => (
      <StatusBadge tone={c.allow_external_llm ? 'success' : 'danger'}>
        {c.allow_external_llm ? '授权' : '拒绝'}
      </StatusBadge>
    ),
  },
  {
    key: 'scope',
    header: '范围',
    render: (c) => <span className="mono whitespace-nowrap text-xs text-ink-muted">{c.scope}</span>,
  },
  {
    key: 'granted',
    header: '授权时间',
    render: (c) => (
      <span className="mono whitespace-nowrap text-xs text-ink-muted">{formatDateTime(c.granted_at)}</span>
    ),
  },
  {
    key: 'state',
    header: '状态',
    render: (c) =>
      c.revoked_at ? (
        <StatusBadge tone="neutral">已撤销</StatusBadge>
      ) : (
        <StatusBadge tone="success">生效中</StatusBadge>
      ),
  },
  {
    key: 'id',
    header: '授权 ID',
    render: (c) => (
      <span className="mono block max-w-[180px] truncate text-[11px] text-ink-subtle" title={c.consent_id}>
        {c.consent_id}
      </span>
    ),
  },
]

const retentionColumns: Column<RetentionRule>[] = [
  {
    key: 'data',
    header: '数据类别',
    render: (rule) => <span className="whitespace-nowrap font-medium text-ink">{rule.data}</span>,
  },
  {
    key: 'retention',
    header: '保留规则',
    render: (rule) => <span className="text-xs leading-relaxed text-ink-muted">{rule.retention}</span>,
  },
]

function DataClassCard({ cls }: { cls: DataClass }) {
  const tone = DATA_CLASS_TONES[cls.level] ?? 'neutral'
  return (
    <div className="panel flex flex-col gap-2.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="mono text-xs text-ink-subtle">{cls.level}</span>
        <StatusBadge tone={tone}>{cls.label}</StatusBadge>
      </div>
      <p className="text-sm leading-relaxed text-ink">{cls.handling}</p>
      <div className="mt-auto flex flex-wrap gap-1.5 border-t border-line-soft pt-2.5">
        {cls.examples.map((example) => (
          <span key={example} className="rounded bg-neutral-wash px-2 py-0.5 text-[11px] text-neutral">
            {example}
          </span>
        ))}
      </div>
    </div>
  )
}

function StatCard({ icon: Icon, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="panel flex items-center gap-3 p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <p className="mono text-xl font-semibold leading-7 text-ink">{value}</p>
        <p className="text-xs text-ink-muted">{label}</p>
      </div>
    </div>
  )
}

export default function GovernancePage() {
  const queryClient = useQueryClient()
  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const [tab, setTab] = useState('classification')

  /* ---------------- 数据分级 ---------------- */
  const classificationQuery = useQuery({
    queryKey: ['stage6-classification'],
    queryFn: stage6Api.getClassification,
    enabled: tab === 'classification',
  })

  /* ---------------- AI 授权 ---------------- */
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: tab === 'consent',
  })
  const projects = projectsQuery.data?.items ?? []
  const [consentProjectId, setConsentProjectId] = useState<string | null>(null)
  const consentProject =
    projects.find((p) => p.id === consentProjectId) ??
    projects.find((p) => p.id === lastProjectId) ??
    projects[0] ??
    null
  const consentPid = consentProject?.id ?? ''
  useTrackProject(consentPid)

  const consentQuery = useQuery({
    queryKey: ['stage6-consent', consentPid],
    queryFn: () => stage6Api.getAiConsent({ project_id: consentPid }),
    enabled: tab === 'consent' && !!consentPid,
  })
  const activeConsent = consentQuery.data?.active ?? null
  const requireOn = consentQuery.data?.require_ai_consent ?? false
  const history = consentQuery.data?.history ?? []
  const [allowChoice, setAllowChoice] = useState<boolean | null>(null)
  const effectiveAllow = allowChoice ?? activeConsent?.allow_external_llm ?? true

  const grantMutation = useMutation({
    mutationFn: (vars: { allow: boolean; projectId: string }) =>
      stage6Api.grantAiConsent({ allow_external_llm: vars.allow, scope: 'project', project_id: vars.projectId }),
    onSuccess: (_consent, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['stage6-consent', vars.projectId] })
      toast.success(vars.allow ? '已授权：该项目可调用外部 LLM。' : '已拒绝：该项目的外部 LLM 调用将被阻断。')
      setAllowChoice(null)
    },
    onError: (error) => toast.error(error.message),
  })

  /* ---------------- 数据导出 ---------------- */
  const exportMutation = useMutation({
    mutationFn: stage6Api.requestExport,
    onSuccess: () => toast.success('本人数据导出已同步构建完成。'),
    onError: (error) => toast.error(error.message),
  })
  const [downloading, setDownloading] = useState(false)
  const downloadZip = async (exportId: string) => {
    setDownloading(true)
    try {
      await downloadExport(exportId)
      toast.success('导出 zip 已开始下载。')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '下载失败，请稍后重试。')
    } finally {
      setDownloading(false)
    }
  }

  /* ---------------- 保留策略 ---------------- */
  const retentionQuery = useQuery({
    queryKey: ['stage6-retention'],
    queryFn: stage6Api.getRetention,
    enabled: tab === 'retention',
    retry: false,
  })

  const renderClassification = () => {
    if (classificationQuery.isPending) return <LoadingState message="正在读取数据分级目录…" />
    if (classificationQuery.isError)
      return (
        <ErrorState message={classificationQuery.error.message} code={errorCode(classificationQuery.error)} onRetry={() => void classificationQuery.refetch()} />
      )
    const data = classificationQuery.data
    if (!data || data.classes.length === 0) return <EmptyState title="暂无分级目录" />
    return (
      <div className="space-y-4">
        <div className="panel flex items-start gap-3 border-accent bg-accent-wash p-4">
          <ShieldCheck size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent-dark" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-accent-dark">治理原则</p>
            <p className="mt-1 text-sm leading-relaxed text-ink">{data.principle}</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.classes.map((cls) => (
            <DataClassCard key={cls.level} cls={cls} />
          ))}
        </div>
      </div>
    )
  }

  const renderConsent = () => {
    if (projectsQuery.isPending) return <LoadingState message="正在读取项目列表…" />
    if (projectsQuery.isError)
      return (
        <ErrorState message={projectsQuery.error.message} code={errorCode(projectsQuery.error)} onRetry={() => void projectsQuery.refetch()} />
      )
    if (projects.length === 0)
      return <EmptyState icon={Bot} title="尚无项目" description="创建项目后，可设置项目级 AI 外部模型授权。" />
    const consentMeta =
      activeConsent == null
        ? { label: '未设置', tone: 'neutral' as const }
        : activeConsent.allow_external_llm
          ? { label: '已授权', tone: 'success' as const }
          : { label: '已拒绝', tone: 'danger' as const }
    return (
      <div className="space-y-4">
        <div className="panel p-4">
          <label className="field-label" htmlFor="consent-project">项目（授权范围固定为 project）</label>
          <select
            id="consent-project"
            className="field-input"
            value={consentPid}
            onChange={(e) => {
              setConsentProjectId(e.target.value)
              setAllowChoice(null)
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {consentQuery.isPending ? (
          <LoadingState compact message="正在读取授权状态…" />
        ) : consentQuery.isError ? (
          <ErrorState compact message={consentQuery.error.message} code={errorCode(consentQuery.error)} onRetry={() => void consentQuery.refetch()} />
        ) : (
          <>
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="panel p-4">
                <p className="text-xs font-semibold text-ink-muted">当前授权状态</p>
                <div className="mt-2 flex items-center gap-2.5">
                  {activeConsent == null ? (
                    <Bot size={18} strokeWidth={1.8} className="text-ink-subtle" />
                  ) : activeConsent.allow_external_llm ? (
                    <CheckCircle2 size={18} strokeWidth={1.8} className="text-success" />
                  ) : (
                    <XCircle size={18} strokeWidth={1.8} className="text-danger" />
                  )}
                  <StatusBadge tone={consentMeta.tone} className="!px-2.5 !py-1 !text-sm">
                    {consentMeta.label}
                  </StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  {activeConsent == null
                    ? '该项目尚未设置 AI 外部模型授权。'
                    : activeConsent.allow_external_llm
                      ? '该项目已允许在审计 / RAG 流程中调用外部 LLM。'
                      : '该项目已明确拒绝外部 LLM 调用。'}
                </p>
                {activeConsent && (
                  <div className="mono mt-2.5 space-y-0.5 text-[11px] text-ink-subtle">
                    <p className="break-all">consent_id: {activeConsent.consent_id}</p>
                    <p>scope: {activeConsent.scope} · 授权于 {formatDateTime(activeConsent.granted_at)}</p>
                  </div>
                )}
              </div>
              <div className="panel p-4">
                <p className="text-xs font-semibold text-ink-muted">授权门（require_ai_consent）</p>
                <div className="mt-2">
                  <StatusBadge tone={requireOn ? 'warning' : 'neutral'}>{requireOn ? '开' : '关'}</StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-ink-muted">
                  开启后，无有效授权时后端拒绝一切外部 LLM 调用（AI_CONSENT_REQUIRED，HTTP 403），绝不静默发送；
                  关闭时兼容演示模式直接放行。当前网关状态：{requireOn ? '开' : '关'}。
                </p>
              </div>
            </div>

            <div className="panel p-4">
              <p className="text-sm font-semibold">变更授权</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                仅项目负责人及以上可变更；提交后撤销同范围旧授权并保留历史。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-pressed={effectiveAllow}
                  onClick={() => setAllowChoice(true)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition ${
                    effectiveAllow
                      ? 'border-success bg-success-wash text-success'
                      : 'border-line bg-surface text-ink-muted hover:bg-canvas'
                  }`}
                >
                  <CheckCircle2 size={16} strokeWidth={1.8} />
                  授权
                </button>
                <button
                  type="button"
                  aria-pressed={!effectiveAllow}
                  onClick={() => setAllowChoice(false)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition ${
                    !effectiveAllow
                      ? 'border-danger bg-danger-wash text-danger'
                      : 'border-line bg-surface text-ink-muted hover:bg-canvas'
                  }`}
                >
                  <XCircle size={16} strokeWidth={1.8} />
                  拒绝
                </button>
                <span className="mono rounded bg-neutral-wash px-2 py-1 text-[11px] text-neutral">scope: project</span>
                <button
                  type="button"
                  className="btn-primary ml-auto"
                  disabled={grantMutation.isPending || !consentPid}
                  onClick={() => grantMutation.mutate({ allow: effectiveAllow, projectId: consentPid })}
                >
                  {grantMutation.isPending ? '正在提交…' : '提交授权决定'}
                </button>
              </div>
            </div>

            <div className="panel overflow-hidden">
              <div className="panel-header">
                <div className="flex items-center gap-2">
                  <History size={16} strokeWidth={1.8} className="text-accent-dark" />
                  <h3 className="text-sm font-semibold">授权历史</h3>
                </div>
                <StatusBadge tone="neutral">{history.length} 条</StatusBadge>
              </div>
              <DataTable
                columns={consentColumns}
                data={history}
                rowKey={(c) => c.consent_id}
                empty={
                  <EmptyState compact icon={History} title="暂无授权记录" description="提交授权决定后，记录会显示在这里。" />
                }
              />
            </div>
          </>
        )}
      </div>
    )
  }

  const renderExport = () => {
    const record = exportMutation.data
    return (
      <div className="space-y-4">
        <div className="panel flex items-start gap-3 p-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent-wash text-accent-dark">
            <Package size={18} strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">导出本人相关数据（zip）</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              同步构建，导出包含本人账户与授权范围内数据：项目元数据、材料与事实清单（manifest.json）。
              不含密钥、令牌与他人私密材料原文。
            </p>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              <Download size={16} strokeWidth={1.8} className={exportMutation.isPending ? 'animate-pulse' : ''} />
              {exportMutation.isPending ? '正在同步构建…' : '请求导出'}
            </button>
          </div>
        </div>
        {exportMutation.isError && (
          <ErrorState compact message={exportMutation.error.message} code={errorCode(exportMutation.error)} onRetry={() => exportMutation.mutate()} />
        )}
        {record ? (
          <div className="panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">最近一次导出</p>
              <StatusBadge tone={record.status === 'completed' ? 'success' : record.status === 'failed' ? 'danger' : 'warning'}>
                {record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : record.status}
              </StatusBadge>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-line bg-canvas px-3 py-2">
                <p className="text-[11px] text-ink-subtle">导出 ID</p>
                <div className="mt-0.5 flex items-start gap-2">
                  <code className="mono min-w-0 flex-1 break-all text-xs leading-5 text-ink">{record.export_id}</code>
                  <CopyButton text={record.export_id} className="shrink-0" />
                </div>
              </div>
              <div className="rounded-md border border-line bg-canvas px-3 py-2">
                <p className="text-[11px] text-ink-subtle">时间</p>
                <p className="mono mt-0.5 text-xs text-ink-muted">请求 {formatDateTime(record.created_at)}</p>
                <p className="mono text-xs text-ink-muted">完成 {formatDateTime(record.completed_at)}</p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={!record.file_available || record.status !== 'completed' || downloading}
                onClick={() => void downloadZip(record.export_id)}
              >
                <Download size={16} strokeWidth={1.8} />
                {downloading ? '正在下载…' : '下载 zip'}
              </button>
              <span className="text-xs text-ink-muted">
                {record.file_available ? '文件已生成，可下载。' : '文件尚未生成。'}
              </span>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed text-ink-subtle">
              导出包含本人账户与授权范围内数据；下载需登录态，文件由后端保留策略管理。
            </p>
          </div>
        ) : (
          !exportMutation.isError && (
            <div className="rounded-panel border border-dashed border-line px-4 py-6 text-center text-xs text-ink-subtle">
              尚未发起导出请求；同步构建完成后，此处显示导出记录与下载入口。
            </div>
          )
        )}
      </div>
    )
  }

  const renderRetention = () => {
    if (retentionQuery.isPending) return <LoadingState message="正在读取保留策略…" />
    if (retentionQuery.isError) {
      const error = retentionQuery.error
      if (error instanceof ApiError && error.code === 'FORBIDDEN') {
        return (
          <div className="panel flex items-start gap-3 bg-neutral-wash p-5">
            <ShieldAlert size={18} strokeWidth={1.8} className="mt-0.5 shrink-0 text-neutral" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">保留策略仅组织管理员可见</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                保留策略仅组织管理员（data.manage）可见，当前账户无权查看。如需了解数据保留期限与清理安排，请联系组织管理员。
              </p>
            </div>
          </div>
        )
      }
      return (
        <ErrorState message={error.message} code={errorCode(error)} onRetry={() => void retentionQuery.refetch()} />
      )
    }
    const policy = retentionQuery.data
    if (!policy) return <EmptyState title="暂无保留策略" />
    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard icon={Clock} value={`${policy.default_days} 天`} label="默认保留期限（审计轨迹）" />
          <StatCard icon={ListChecks} value={`${policy.rules.length} 条`} label="分类保留规则" />
        </div>
        <div className="panel overflow-hidden">
          <div className="panel-header">
            <div className="flex items-center gap-2">
              <History size={16} strokeWidth={1.8} className="text-accent-dark" />
              <h3 className="text-sm font-semibold">分类保留规则</h3>
            </div>
          </div>
          <DataTable
            columns={retentionColumns}
            data={policy.rules}
            rowKey={(rule) => rule.data}
            empty={<EmptyState compact title="暂无保留规则" />}
          />
        </div>
        <div className="panel flex items-start gap-3 border-accent bg-accent-wash p-4">
          <Info size={16} strokeWidth={1.8} className="mt-0.5 shrink-0 text-accent-dark" />
          <p className="text-xs leading-relaxed text-ink">{policy.note}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="安全与数据治理"
        description="数据分级 · AI 授权 · 本人数据导出 · 保留策略"
      />
      <Tabs
        tabs={[
          { key: 'classification', label: '数据分级', icon: Layers, count: classificationQuery.data?.classes.length },
          { key: 'consent', label: 'AI 授权', icon: Bot, count: consentQuery.data?.history?.length },
          { key: 'export', label: '数据导出', icon: Package },
          { key: 'retention', label: '保留策略', icon: History, count: retentionQuery.data?.rules.length },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'classification' && renderClassification()}
      {tab === 'consent' && renderConsent()}
      {tab === 'export' && renderExport()}
      {tab === 'retention' && renderRetention()}
    </div>
  )
}