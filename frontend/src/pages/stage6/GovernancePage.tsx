import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Bot,
  CheckCircle2,
  Clock,
  History,
  Info,
  Layers,
  ListChecks,
  Package,
  ShieldAlert,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '../../components/CopyButton'
import { DataTable, type Column } from '../../components/DataTable'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { Icon } from '../../components/Icon'
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
import type { AiConsent, RetentionPolicy } from '../../types/stage6'
import '../../styles/wave-d-stage6.css'

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
    render: (c) => <span className="mono whitespace-nowrap text-xs rcw-muted">{c.scope}</span>,
  },
  {
    key: 'granted',
    header: '授权时间',
    render: (c) => (
      <span className="mono whitespace-nowrap text-xs rcw-muted">{formatDateTime(c.granted_at)}</span>
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
      <span className="mono block max-w-[180px] truncate text-[11px] rcw-faint" title={c.consent_id}>
        {c.consent_id}
      </span>
    ),
  },
]

const retentionColumns: Column<RetentionRule>[] = [
  {
    key: 'data',
    header: '数据类别',
    render: (rule) => <span className="whitespace-nowrap font-medium">{rule.data}</span>,
  },
  {
    key: 'retention',
    header: '保留规则',
    render: (rule) => <span className="text-xs leading-relaxed rcw-muted">{rule.retention}</span>,
  },
]

function StatCard({ icon: Glyph, value, label }: { icon: LucideIcon; value: string; label: string }) {
  return (
    <div className="rcw-kpi">
      <span className="rcw-kpi-icon"><Icon as={Glyph} size="sm" /></span>
      <div className="min-w-0">
        <p className="rcw-kpi-value">{value}</p>
        <p className="rcw-kpi-label">{label}</p>
      </div>
    </div>
  )
}

export default function GovernancePage() {
  const queryClient = useQueryClient()
  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const [tab, setTab] = useState('classification')
  const [activeLevel, setActiveLevel] = useState<string | null>(null)

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
    const classes = [...data.classes].reverse() // 由严到宽排列，形成「由上至下递减」的敏感度层级
    const selected = classes.find((cls) => cls.level === activeLevel) ?? null
    const maxWidth = classes.length > 0 ? 100 : 100
    return (
      <div className="rcw-stack">
        <div className="rcw-note">
          <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
            <Icon name="shield" size="sm" style={{ marginTop: 2 }} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">治理原则</p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--rc-text)' }}>{data.principle}</p>
            </div>
          </div>
        </div>

        <div className="rcw-split" style={{ gridTemplateColumns: 'minmax(0, 5fr) minmax(0, 7fr)' }}>
          {/* 策略层级轨 */}
          <section className="rcw-card rcw-card-tight">
            <h3 className="text-sm font-semibold" style={{ marginBottom: 'var(--rc-space-3)' }}>敏感度层级</h3>
            <div className="rcw-stack-tight">
              {classes.map((cls, index) => {
                const tone = DATA_CLASS_TONES[cls.level] ?? 'neutral'
                const active = selected?.level === cls.level
                const width = maxWidth - index * (60 / Math.max(1, classes.length))
                return (
                  <button
                    key={cls.level}
                    type="button"
                    className="rcw-tier"
                    aria-pressed={active}
                    onClick={() => setActiveLevel(active ? null : cls.level)}
                  >
                    <span className="min-w-0 flex-1 text-left">
                      <span className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                        <span className="truncate text-sm font-semibold">{cls.label}</span>
                        <StatusBadge tone={tone} dot={false}>{cls.examples.length} 例</StatusBadge>
                      </span>
                      <span className="mono block truncate text-[11px] rcw-faint">{cls.level}</span>
                      <span className="rcw-tier-bar" style={{ width: `${width}%`, opacity: 0.35 + (index / Math.max(1, classes.length - 1)) * 0.65 }} aria-hidden="true" />
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed rcw-faint">
              层级条宽度按目录顺序递减；点击任一层级查看该级的处理要求与示例。
            </p>
          </section>

          {/* 选中层级详情 / 全部层级卡 */}
          <div className="rcw-stack">
            {selected ? (
              <section className="rcw-card">
                <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
                  <div>
                    <h4 className="text-sm font-semibold">{selected.label}</h4>
                    <span className="mono text-[11px] rcw-faint">{selected.level}</span>
                  </div>
                  <StatusBadge tone={DATA_CLASS_TONES[selected.level] ?? 'neutral'}>{selected.label}</StatusBadge>
                </div>
                <p className="mt-3 text-sm leading-relaxed">{selected.handling}</p>
                <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-4)' }}>
                  {selected.examples.map((example) => (
                    <span key={example} className="rcw-chip">{example}</span>
                  ))}
                </div>
                <button type="button" className="btn-ghost mt-4" onClick={() => setActiveLevel(null)}>返回全部层级</button>
              </section>
            ) : (
              <div className="rcw-grid rcw-grid-2">
                {data.classes.map((cls) => (
                  <button
                    key={cls.level}
                    type="button"
                    className="rcw-card rcw-card-tight rcw-card-hover text-left"
                    onClick={() => setActiveLevel(cls.level)}
                  >
                    <div className="rcw-row-between" style={{ gap: 'var(--rc-space-2)' }}>
                      <span className="mono text-xs rcw-faint">{cls.level}</span>
                      <StatusBadge tone={DATA_CLASS_TONES[cls.level] ?? 'neutral'}>{cls.label}</StatusBadge>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed rcw-muted">{cls.handling}</p>
                    <div className="rcw-row" style={{ gap: 'var(--rc-space-1)', marginTop: 'var(--rc-space-3)', paddingTop: 'var(--rc-space-3)', borderTop: 'var(--rc-stroke-hair)' }}>
                      {cls.examples.map((example) => (
                        <span key={example} className="rcw-chip">{example}</span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
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
      <div className="rcw-stack">
        <section className="rcw-card rcw-card-tight">
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
        </section>
        {consentQuery.isPending ? (
          <LoadingState compact message="正在读取授权状态…" />
        ) : consentQuery.isError ? (
          <ErrorState compact message={consentQuery.error.message} code={errorCode(consentQuery.error)} onRetry={() => void consentQuery.refetch()} />
        ) : (
          <>
            <div className="rcw-grid rcw-grid-2">
              <section className="rcw-card">
                <p className="text-xs font-semibold rcw-muted">当前授权状态</p>
                <div className="rcw-row mt-2" style={{ gap: 'var(--rc-space-2)' }}>
                  {activeConsent == null ? (
                    <Icon as={Bot} size="sm" tone="subtle" />
                  ) : activeConsent.allow_external_llm ? (
                    <Icon as={CheckCircle2} size="sm" tone="success" />
                  ) : (
                    <Icon as={XCircle} size="sm" tone="danger" />
                  )}
                  <StatusBadge tone={consentMeta.tone}>{consentMeta.label}</StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed rcw-muted">
                  {activeConsent == null
                    ? '该项目尚未设置 AI 外部模型授权。'
                    : activeConsent.allow_external_llm
                      ? '该项目已允许在审计 / RAG 流程中调用外部 LLM。'
                      : '该项目已明确拒绝外部 LLM 调用。'}
                </p>
                {activeConsent && (
                  <div className="mono mt-2.5 text-[11px] rcw-faint">
                    <p className="break-all">consent_id: {activeConsent.consent_id}</p>
                    <p>scope: {activeConsent.scope} · 授权于 {formatDateTime(activeConsent.granted_at)}</p>
                  </div>
                )}
              </section>
              <section className="rcw-card">
                <p className="text-xs font-semibold rcw-muted">授权门（require_ai_consent）</p>
                <div className="mt-2">
                  <StatusBadge tone={requireOn ? 'warning' : 'neutral'}>{requireOn ? '开' : '关'}</StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-relaxed rcw-muted">
                  开启后，无有效授权时后端拒绝一切外部 LLM 调用（AI_CONSENT_REQUIRED，HTTP 403），绝不静默发送；
                  关闭时兼容演示模式直接放行。当前网关状态：{requireOn ? '开' : '关'}。
                </p>
              </section>
            </div>

            <section className="rcw-card">
              <p className="text-sm font-semibold">变更授权</p>
              <p className="mt-0.5 text-xs rcw-muted">仅项目负责人及以上可变更；提交后撤销同范围旧授权并保留历史。</p>
              <div className="rcw-row" style={{ gap: 'var(--rc-space-2)', marginTop: 'var(--rc-space-3)' }}>
                <button
                  type="button"
                  aria-pressed={effectiveAllow}
                  onClick={() => setAllowChoice(true)}
                  className="rcw-tier"
                  style={{
                    width: 'auto',
                    alignItems: 'center',
                    borderColor: effectiveAllow ? 'var(--rc-success)' : 'var(--rc-border-hair)',
                    backgroundColor: effectiveAllow ? 'var(--rc-success-wash)' : 'var(--rc-surface)',
                    color: effectiveAllow ? 'var(--rc-success)' : 'var(--rc-text-muted)',
                  }}
                >
                  <Icon as={CheckCircle2} size="xs" />授权
                </button>
                <button
                  type="button"
                  aria-pressed={!effectiveAllow}
                  onClick={() => setAllowChoice(false)}
                  className="rcw-tier"
                  style={{
                    width: 'auto',
                    alignItems: 'center',
                    borderColor: !effectiveAllow ? 'var(--rc-danger)' : 'var(--rc-border-hair)',
                    backgroundColor: !effectiveAllow ? 'var(--rc-danger-wash)' : 'var(--rc-surface)',
                    color: !effectiveAllow ? 'var(--rc-danger)' : 'var(--rc-text-muted)',
                  }}
                >
                  <Icon as={XCircle} size="xs" />拒绝
                </button>
                <span className="rcw-chip">scope: project</span>
                <button
                  type="button"
                  className="btn-primary ml-auto"
                  disabled={grantMutation.isPending || !consentPid}
                  onClick={() => grantMutation.mutate({ allow: effectiveAllow, projectId: consentPid })}
                >
                  {grantMutation.isPending ? '正在提交…' : '提交授权决定'}
                </button>
              </div>
            </section>

            <section className="rcw-card">
              <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
                <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
                  <Icon as={History} size="sm" tone="accent" />授权历史
                </h3>
                <StatusBadge tone="neutral">{history.length} 条</StatusBadge>
              </div>
              <div style={{ marginTop: 'var(--rc-space-3)' }}>
                <DataTable
                  columns={consentColumns}
                  data={history}
                  rowKey={(c) => c.consent_id}
                  empty={<EmptyState compact icon={History} title="暂无授权记录" description="提交授权决定后，记录会显示在这里。" />}
                />
              </div>
            </section>
          </>
        )}
      </div>
    )
  }

  const renderExport = () => {
    const record = exportMutation.data
    return (
      <div className="rcw-stack">
        <section className="rcw-card rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
          <span className="rcw-kpi-icon"><Icon as={Package} size="sm" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">导出本人相关数据（zip）</p>
            <p className="mt-1 text-xs leading-relaxed rcw-muted">
              同步构建，导出包含本人账户与授权范围内数据：项目元数据、材料与事实清单（manifest.json）。
              不含密钥、令牌与他人私密材料原文。
            </p>
            <button
              type="button"
              className="btn-primary mt-3"
              disabled={exportMutation.isPending}
              onClick={() => exportMutation.mutate()}
            >
              <Icon name="download" size="xs" className={exportMutation.isPending ? 'animate-pulse' : ''} />
              {exportMutation.isPending ? '正在同步构建…' : '请求导出'}
            </button>
          </div>
        </section>
        {exportMutation.isError && (
          <section className="rcw-card">
            <ErrorState compact message={exportMutation.error.message} code={errorCode(exportMutation.error)} onRetry={() => exportMutation.mutate()} />
          </section>
        )}
        {record ? (
          <section className="rcw-card">
            <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
              <p className="text-sm font-semibold">最近一次导出</p>
              <StatusBadge tone={record.status === 'completed' ? 'success' : record.status === 'failed' ? 'danger' : 'warning'}>
                {record.status === 'completed' ? '已完成' : record.status === 'failed' ? '失败' : record.status}
              </StatusBadge>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rcw-card rcw-card-flat rcw-card-tight">
                <p className="text-[11px] rcw-faint">导出 ID</p>
                <div className="rcw-row mt-0.5" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
                  <code className="mono min-w-0 flex-1 break-all text-xs">{record.export_id}</code>
                  <CopyButton text={record.export_id} className="shrink-0" />
                </div>
              </div>
              <div className="rcw-card rcw-card-flat rcw-card-tight">
                <p className="text-[11px] rcw-faint">时间</p>
                <p className="mono mt-0.5 text-xs rcw-muted">请求 {formatDateTime(record.created_at)}</p>
                <p className="mono text-xs rcw-muted">完成 {formatDateTime(record.completed_at)}</p>
              </div>
            </div>
            <div className="rcw-row mt-3" style={{ gap: 'var(--rc-space-2)' }}>
              <button
                type="button"
                className="btn-primary"
                disabled={!record.file_available || record.status !== 'completed' || downloading}
                onClick={() => void downloadZip(record.export_id)}
              >
                <Icon name="download" size="xs" />
                {downloading ? '正在下载…' : '下载 zip'}
              </button>
              <span className="text-xs rcw-muted">
                {record.file_available ? '文件已生成，可下载。' : '文件尚未生成。'}
              </span>
            </div>
            <p className="mt-2.5 text-[11px] leading-relaxed rcw-faint">
              导出包含本人账户与授权范围内数据；下载需登录态，文件由后端保留策略管理。
            </p>
          </section>
        ) : (
          !exportMutation.isError && (
            <div className="rcw-card rcw-card-flat rcw-card-tight text-center text-xs rcw-faint">
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
          <div className="rcw-note">
            <div className="rcw-row" style={{ gap: 'var(--rc-space-3)', alignItems: 'flex-start' }}>
              <Icon as={ShieldAlert} size="sm" style={{ marginTop: 2 }} />
              <div className="min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--rc-text)' }}>保留策略仅组织管理员可见</p>
                <p className="mt-1 text-sm leading-relaxed rcw-muted">
                  保留策略仅组织管理员（data.manage）可见，当前账户无权查看。如需了解数据保留期限与清理安排，请联系组织管理员。
                </p>
              </div>
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
      <div className="rcw-stack">
        <div className="rcw-grid rcw-grid-2">
          <StatCard icon={Clock} value={`${policy.default_days} 天`} label="默认保留期限（审计轨迹）" />
          <StatCard icon={ListChecks} value={`${policy.rules.length} 条`} label="分类保留规则" />
        </div>
        <section className="rcw-card">
          <div className="rcw-row-between" style={{ paddingBottom: 'var(--rc-space-3)', borderBottom: 'var(--rc-stroke-hair)' }}>
            <h3 className="rcw-row" style={{ gap: 'var(--rc-space-2)' }}>
              <Icon as={History} size="sm" tone="accent" />分类保留规则
            </h3>
          </div>
          <div style={{ marginTop: 'var(--rc-space-3)' }}>
            <DataTable
              columns={retentionColumns}
              data={policy.rules}
              rowKey={(rule) => rule.data}
              empty={<EmptyState compact title="暂无保留规则" />}
            />
          </div>
        </section>
        <div className="rcw-note">
          <p className="rcw-row" style={{ gap: 'var(--rc-space-2)', alignItems: 'flex-start' }}>
            <Icon as={Info} size="xs" style={{ marginTop: 3 }} />
            <span className="text-xs leading-relaxed">{policy.note}</span>
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rcw-page">
      <div className="rcw-stack">
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
    </div>
  )
}
