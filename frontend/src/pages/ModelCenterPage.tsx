/**
 * 模型管理中心（/settings/models）
 * 统一工作流：先在「提供商」页添加自己的接口与密钥，再在「我的模型」中直接从已添加的提供商里选用模型。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  CheckCircle2,
  CircleSlash2,
  Cpu,
  Download,
  KeyRound,
  Link2,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { ErrorState } from '../components/ErrorState'
import { Icon } from '../components/Icon'
import { LoadingState } from '../components/LoadingState'
import { Modal } from '../components/Modal'
import { StatusBadge } from '../components/StatusBadge'
import { formatDateTime } from '../features/format'
import { ApiError } from '../services/api'
import { modelApi } from '../services/modelApi'
import { toast } from '../stores/toastStore'
import GuidedModelSetup from '../ux/GuidedModelSetup'
import '../styles/wave-e-model.css'
import type { ModelCredential, ModelProfile, RemoteModel, TaskBinding, TestResult } from '../types/model'

type Section = 'providers' | 'models' | 'bindings' | 'logs' | 'stats'

const SECTIONS: { key: Section; label: string; icon: typeof Cpu; hint: string }[] = [
  { key: 'providers', label: '提供商', icon: KeyRound, hint: '添加接口、密钥与测试' },
  { key: 'models', label: '我的模型', icon: Cpu, hint: '从已添加提供商选用模型' },
  { key: 'bindings', label: '任务分配', icon: SlidersHorizontal, hint: '按科研任务指定模型' },
  { key: 'logs', label: '调用记录', icon: Activity, hint: '真实调用与延迟' },
  { key: 'stats', label: '用量统计', icon: BarChart3, hint: '次数 / Token / 耗时' },
]

function normalizeSection(tab: string | null): Section {
  if (tab === 'models' || tab === 'default') return 'models'
  if (tab === 'bindings') return 'bindings'
  if (tab === 'logs') return 'logs'
  if (tab === 'stats') return 'stats'
  return 'providers'
}

const TASK_LABELS: Record<string, string> = {
  pdf_extraction: 'PDF 论文解析',
  fact_extraction: '科研事实抽取',
  diff_analysis: '论文与代码差异分析',
  failure_diagnosis: '失败原因分析',
  rag_qa: 'RAG 问答',
  report_generation: '报告生成',
  summary: '科研材料总结',
}

function errMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function Panel({
  title,
  icon,
  children,
  action,
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="rc-we-card">
      <div className="rc-we-card__head">
        <h3 className="rc-we-card__title">
          {icon}
          {title}
        </h3>
        {action}
      </div>
      <div className="rc-we-card__body">{children}</div>
    </section>
  )
}

function TestResultView({ result }: { result: TestResult | null }) {
  if (!result) return null
  const ok = result.status === 'success'
  return (
    <div
      className={`rc-we-note${ok ? '' : ' rc-we-note--danger'}`}
      role="status"
      style={{ marginTop: 'var(--rc-space-3)' }}
    >
      <Icon as={ok ? CheckCircle2 : XCircle} size="md" className="rc-we-note__icon" />
      <div>
        <p className="rc-we-note__title" style={{ color: ok ? 'var(--rc-success)' : 'var(--rc-danger)' }}>
          {ok ? '连接成功' : `连接失败：${result.status}`}
        </p>
        <p className="rc-we-mono" style={{ marginTop: 4 }}>
          {ok
            ? `${result.provider} / ${result.model} · ${result.latency_ms}ms · tokens ${result.prompt_tokens ?? 0}+${result.completion_tokens ?? 0}`
            : `${result.error_code ?? '-'} ${result.error_message ?? ''}`}
        </p>
        {result.reply_preview && <p style={{ marginTop: 4 }}>回复：{result.reply_preview}</p>}
      </div>
    </div>
  )
}

function deckDepth(index: number, active: number, total: number): number {
  if (total <= 0) return 0
  return (index - active + total) % total
}

export default function ModelCenterPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [section, setSection] = useState<Section>(() => normalizeSection(params.get('tab')))
  const [profileOpen, setProfileOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [profileForm, setProfileForm] = useState({
    credential_id: '',
    model_id: '',
    display_name: '',
    temperature: 0,
    timeout_s: 60,
    max_retries: 1,
    max_tokens: 2048,
    is_default: false,
    is_fallback: false,
  })
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([])
  const [bindForm, setBindForm] = useState({
    task_key: 'fact_extraction',
    primary_profile_id: '',
    fallback_profile_id: '',
    auto_route: false,
    cost_preference: 'balanced',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [testingCredId, setTestingCredId] = useState<string | null>(null)
  const [activeProfile, setActiveProfile] = useState(0)
  const [moving, setMoving] = useState(false)
  const firstRender = useRef(true)

  const providersQ = useQuery({ queryKey: ['model-providers'], queryFn: modelApi.providers })
  const credsQ = useQuery({ queryKey: ['model-credentials'], queryFn: modelApi.credentials })
  const profilesQ = useQuery({ queryKey: ['model-profiles'], queryFn: modelApi.profiles })
  const bindsQ = useQuery({
    queryKey: ['model-bindings'],
    queryFn: () => modelApi.bindings(),
    enabled: section === 'bindings',
  })
  const logsQ = useQuery({
    queryKey: ['model-logs'],
    queryFn: () => modelApi.callLogs(100),
    enabled: section === 'logs',
  })
  const statsQ = useQuery({
    queryKey: ['model-stats'],
    queryFn: modelApi.stats,
    enabled: section === 'stats',
  })

  const refresh = () => void qc.invalidateQueries()

  useEffect(() => {
    const next = normalizeSection(params.get('tab'))
    if (next !== section) setSection(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setMoving(true)
    const timer = window.setTimeout(() => setMoving(false), 420)
    return () => window.clearTimeout(timer)
  }, [activeProfile])

  const creds = credsQ.data ?? []
  const activeCreds = useMemo(() => creds.filter((c) => c.status === 'active'), [creds])
  const profiles = profilesQ.data ?? []
  const providerMetaMap = useMemo(
    () => new Map((providersQ.data ?? []).map((p) => [p.key, p])),
    [providersQ.data],
  )

  const selectedCred: ModelCredential | null = useMemo(
    () => activeCreds.find((c) => c.id === profileForm.credential_id) ?? null,
    [activeCreds, profileForm.credential_id],
  )

  const suggestedModels = useMemo(() => {
    if (remoteModels.length > 0) return remoteModels.map((m) => m.id).slice(0, 20)
    if (!selectedCred) return []
    return providerMetaMap.get(selectedCred.provider_key)?.default_models ?? []
  }, [remoteModels, selectedCred, providerMetaMap])

  const credName = (id: string | null) =>
    creds.find((c) => c.id === id)?.name ?? (id ? '已删除提供商' : '—')

  const safeActive = useMemo(
    () => (profiles.length === 0 ? 0 : Math.min(activeProfile, profiles.length - 1)),
    [activeProfile, profiles.length],
  )

  const changeSection = (next: Section) => {
    setSection(next)
    setTestResult(null)
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  const openAddModel = (presetCredId?: string) => {
    const chosenId = presetCredId || activeCreds[0]?.id || ''
    setRemoteModels([])
    setProfileForm({
      credential_id: chosenId,
      model_id: '',
      display_name: '',
      temperature: 0,
      timeout_s: 60,
      max_retries: 1,
      max_tokens: 2048,
      is_default: profiles.length === 0,
      is_fallback: false,
    })
    setProfileOpen(true)
  }

  const testCred = useMutation({
    mutationFn: (id: string) => modelApi.testCredential(id),
    onSuccess: (r) => {
      setTestResult(r)
      setTestingCredId(null)
    },
    onError: (e) => {
      setTestResult({ status: 'provider_error', error_message: errMessage(e, '测试失败') })
      setTestingCredId(null)
    },
  })
  const fetchRemoteModels = useMutation({
    mutationFn: (credId: string) => modelApi.fetchModels(credId),
    onSuccess: (data) => {
      setRemoteModels(data.models)
      if (data.models.length === 0) toast.info('该提供商未返回远端模型列表，可手动输入模型 ID')
      else toast.success(`已拉取 ${data.models.length} 个远端模型`)
    },
    onError: (e) => toast.error(errMessage(e, '拉取模型列表失败')),
  })
  const testProfile = useMutation({
    mutationFn: (id: string) => modelApi.testProfile(id),
    onSuccess: setTestResult,
    onError: (e) => setTestResult({ status: 'provider_error', error_message: errMessage(e, '测试失败') }),
  })
  const revokeCred = useMutation({
    mutationFn: modelApi.revokeCredential,
    onSuccess: () => {
      toast.success('提供商已停用')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '停用失败')),
  })
  const purgeCred = useMutation({
    mutationFn: modelApi.purgeCredential,
    onSuccess: () => {
      toast.success('提供商已删除')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })
  const createProfile = useMutation({
    mutationFn: modelApi.createProfile,
    onSuccess: () => {
      setProfileOpen(false)
      toast.success('模型已保存')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '保存失败')),
  })
  const updateProfile = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModelProfile> }) =>
      modelApi.updateProfile(id, body),
    onSuccess: () => {
      toast.success('模型已更新')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '更新失败')),
  })
  const deleteProfile = useMutation({
    mutationFn: modelApi.deleteProfile,
    onSuccess: () => {
      toast.success('模型已删除')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })
  const upsertBinding = useMutation({
    mutationFn: modelApi.upsertBinding,
    onSuccess: () => {
      setBindOpen(false)
      toast.success('绑定已保存')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '保存失败')),
  })
  const deleteBinding = useMutation({
    mutationFn: modelApi.deleteBinding,
    onSuccess: () => {
      toast.success('绑定已删除')
      refresh()
    },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })

  return (
    <div className="rc-we-page">
      <header className="rc-we-head">
        <div className="rc-we-head__text">
          <p className="rc-we-eyebrow">AI 模型中心</p>
          <h1 className="rc-we-title">模型与提供商</h1>
          <p className="rc-we-lead">添加自己的模型提供商，并在已添加的提供商中选用模型</p>
        </div>
        <div className="rc-we-actions">
          <button
            type="button"
            className="btn-ghost"
            onClick={refresh}
            disabled={credsQ.isFetching || profilesQ.isFetching}
          >
            <Icon
              name="rotate"
              size="sm"
              className={credsQ.isFetching || profilesQ.isFetching ? 'animate-spin' : ''}
            />
            刷新
          </button>
        </div>
      </header>

      <div className="rc-we-split">
        <nav className="rc-we-nav" aria-label="模型管理导航">
          {SECTIONS.map(({ key, label, icon: SectionIcon, hint }) => (
            <button
              key={key}
              type="button"
              onClick={() => changeSection(key)}
              aria-current={section === key ? 'page' : undefined}
              className="rc-we-nav__item"
            >
              <Icon as={SectionIcon} size="sm" />
              <span style={{ minWidth: 0 }}>
                <span className="rc-we-nav__label">{label}</span>
                <span className="rc-we-nav__hint">{hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <div className="rc-we-stack">
          {section === 'providers' && (
            <>
              <GuidedModelSetup onDone={refresh} />

              <Panel
                title={`已添加的提供商（${creds.length}）`}
                icon={<Icon name="key" size="md" tone="accent" />}
              >
                {credsQ.isPending ? (
                  <LoadingState message="读取提供商…" compact />
                ) : creds.length === 0 ? (
                  <p className="rc-we-empty">尚未添加提供商，请在上方填写接口地址与 API Key 后保存。</p>
                ) : (
                  <div className="rc-we-scroll">
                    <table className="data-table data-table-dense">
                      <thead>
                        <tr>
                          <th>名称</th>
                          <th>接口地址</th>
                          <th>密钥</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {creds.map((c) => {
                          const meta = providerMetaMap.get(c.provider_key)
                          const endpoint = c.base_url || meta?.default_base_url || '—'
                          return (
                            <tr key={c.id}>
                              <td className="font-medium">
                                {c.name || meta?.name || c.provider_key}
                              </td>
                              <td className="rc-we-mono max-w-[240px] truncate text-xs" title={endpoint}>
                                {endpoint}
                              </td>
                              <td className="rc-we-mono text-xs">{c.key_hint || '—'}</td>
                              <td>
                                <StatusBadge tone={c.status === 'active' ? 'success' : 'neutral'}>
                                  {c.status === 'active' ? '可用' : c.status}
                                </StatusBadge>
                              </td>
                              <td>
                                <div className="flex flex-wrap gap-2">
                                  {c.status === 'active' && (
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() => openAddModel(c.id)}
                                    >
                                      <Icon name="plus" size="xs" /> 选模型
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    disabled={testingCredId === c.id}
                                    onClick={() => {
                                      setTestResult(null)
                                      setTestingCredId(c.id)
                                      testCred.mutate(c.id)
                                    }}
                                  >
                                    {testingCredId === c.id ? (
                                      <Icon name="loader" size="xs" className="animate-spin" />
                                    ) : (
                                      <Icon as={Link2} size="xs" />
                                    )}{' '}
                                    测试
                                  </button>
                                  {c.status === 'active' && (
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() => revokeCred.mutate(c.id)}
                                    >
                                      <Icon as={CircleSlash2} size="xs" /> 停用
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="btn-ghost"
                                    disabled={purgeCred.isPending}
                                    onClick={() => {
                                      if (window.confirm(`确定删除「${c.name || c.provider_key}」？关联的模型配置也会删除，任务分配中的引用会清除。`)) {
                                        purgeCred.mutate(c.id)
                                      }
                                    }}
                                  >
                                    <Icon name="trash" size="xs" /> 删除
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <TestResultView result={testResult} />
              </Panel>
            </>
          )}

          {section === 'models' && (
            <Panel
              title="我的模型"
              icon={<Icon as={Cpu} size="md" tone="accent" />}
              action={
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() =>
                    activeCreds.length > 0 ? openAddModel() : changeSection('providers')
                  }
                >
                  <Icon name="plus" size="sm" />
                  {activeCreds.length > 0 ? '添加模型' : '先添加提供商'}
                </button>
              }
            >
              {profilesQ.isPending ? (
                <LoadingState message="读取模型…" compact />
              ) : profiles.length === 0 ? (
                <p className="rc-we-empty">
                  {activeCreds.length > 0
                    ? '尚未添加模型，点击右上角从已添加的提供商中选用。'
                    : '尚未添加提供商，请先在「提供商」页添加接口与 API Key。'}
                </p>
              ) : (
                <div className="rc-we-deck">
                  <div className="rc-we-deck__tabs" role="tablist" aria-label="模型切换">
                    {profiles.map((p, index) => (
                      <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={index === safeActive}
                        className="rc-we-tab"
                        onClick={() => setActiveProfile(index)}
                      >
                        <Icon as={Cpu} size="xs" />
                        <span className="truncate">{p.display_name || p.model_id}</span>
                      </button>
                    ))}
                  </div>

                  <div className="rc-we-deck__stage">
                    {profiles.map((p, index) => {
                      const depth = deckDepth(index, safeActive, profiles.length)
                      const front = depth === 0
                      return (
                        <article
                          key={p.id}
                          className={`rc-we-deck__card${moving ? ' is-moving' : ''}`}
                          data-depth={depth}
                          style={{ zIndex: profiles.length - depth }}
                          aria-hidden={!front}
                        >
                          <div className="rc-we-deck__panel rc-we-deck__panel--glass">
                            <div className="rc-we-deck__panelhead">
                              <div style={{ minWidth: 0 }}>
                                <p className="rc-we-deck__layer rc-we-deck__layer--front">
                                  <Icon as={Cpu} size="xs" />
                                  {credName(p.credential_id)}
                                </p>
                                <h4 className="rc-we-deck__paneltitle">
                                  {p.display_name || p.model_id}
                                </h4>
                                <p
                                  className="rc-we-mono"
                                  style={{
                                    marginTop: 4,
                                    fontSize: 'var(--rc-fs-mono)',
                                    color: 'var(--rc-text-subtle)',
                                  }}
                                >
                                  {p.model_id}
                                </p>
                              </div>
                              <div className="rc-we-row">
                                {p.is_default && <StatusBadge tone="accent">默认</StatusBadge>}
                                {p.is_fallback && <StatusBadge tone="warning">备用</StatusBadge>}
                                {!p.enabled && <StatusBadge tone="neutral">已禁用</StatusBadge>}
                              </div>
                            </div>

                            <div className="rc-we-deck__panelbody">
                              {front ? (
                                <>
                                  <div className="rc-we-deck__meta">
                                    <div>
                                      <p className="rc-we-kpi__k">所属提供商</p>
                                      <p className="rc-we-kpi__v" style={{ fontSize: 'var(--rc-fs-body)' }}>
                                        {credName(p.credential_id)}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="rc-we-kpi__k">温度</p>
                                      <p className="rc-we-kpi__v">{String(p.params?.temperature ?? 0)}</p>
                                    </div>
                                    <div>
                                      <p className="rc-we-kpi__k">超时</p>
                                      <p className="rc-we-kpi__v">{p.timeout_s}s</p>
                                    </div>
                                    <div>
                                      <p className="rc-we-kpi__k">重试</p>
                                      <p className="rc-we-kpi__v">{p.max_retries}</p>
                                    </div>
                                    <div>
                                      <p className="rc-we-kpi__k">最大 Token</p>
                                      <p className="rc-we-kpi__v">{p.max_tokens ?? '—'}</p>
                                    </div>
                                    <div>
                                      <p className="rc-we-kpi__k">状态</p>
                                      <p className="rc-we-kpi__v" style={{ fontSize: 'var(--rc-fs-body)' }}>
                                        {p.enabled ? '启用中' : '已禁用'}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="rc-we-row" style={{ marginTop: 'var(--rc-space-5)' }}>
                                    <button
                                      type="button"
                                      className="btn-primary"
                                      onClick={() => {
                                        setTestResult(null)
                                        testProfile.mutate(p.id)
                                      }}
                                    >
                                      {testProfile.isPending ? (
                                        <Icon name="loader" size="sm" className="animate-spin" />
                                      ) : (
                                        <Icon as={Link2} size="sm" />
                                      )}{' '}
                                      测试连接
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() =>
                                        updateProfile.mutate({ id: p.id, body: { enabled: !p.enabled } })
                                      }
                                    >
                                      {p.enabled ? '禁用' : '启用'}
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      disabled={p.is_default}
                                      onClick={() =>
                                        updateProfile.mutate({ id: p.id, body: { is_default: true } })
                                      }
                                    >
                                      设为默认
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      disabled={p.is_fallback}
                                      onClick={() =>
                                        updateProfile.mutate({ id: p.id, body: { is_fallback: true } })
                                      }
                                    >
                                      设为备用
                                    </button>
                                    <button
                                      type="button"
                                      className="btn-ghost"
                                      onClick={() => deleteProfile.mutate(p.id)}
                                    >
                                      <Icon name="trash" size="sm" /> 删除
                                    </button>
                                  </div>
                                  <TestResultView result={testResult} />
                                </>
                              ) : (
                                <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                                  {p.enabled ? '启用中' : '已禁用'} · T={String(p.params?.temperature ?? 0)} ·{' '}
                                  {p.timeout_s}s
                                </p>
                              )}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              )}
            </Panel>
          )}

          {section === 'bindings' && (
            <Panel
              title="按任务分配模型"
              icon={<Icon as={SlidersHorizontal} size="md" tone="accent" />}
              action={
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => setBindOpen(true)}
                  disabled={profiles.length === 0}
                >
                  <Icon name="plus" size="sm" /> 添加分配
                </button>
              }
            >
              {bindsQ.isPending ? (
                <LoadingState message="读取任务分配…" compact />
              ) : (bindsQ.data ?? []).length === 0 ? (
                <p className="rc-we-empty">
                  {profiles.length === 0 ? '请先添加模型，再按任务分配。' : '尚未配置任务级分配，当前均使用默认模型。'}
                </p>
              ) : (
                <div className="rc-we-scroll">
                  <table className="data-table data-table-dense">
                    <thead>
                      <tr>
                        <th>科研任务</th>
                        <th>主模型</th>
                        <th>备用模型</th>
                        <th>自动路由</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(bindsQ.data ?? []).map((b: TaskBinding) => (
                        <tr key={b.id}>
                          <td className="font-medium">{TASK_LABELS[b.task_key] ?? b.task_key}</td>
                          <td className="rc-we-mono text-xs">
                            {profiles.find((p) => p.id === b.primary_profile_id)?.model_id ?? '—'}
                          </td>
                          <td className="rc-we-mono text-xs">
                            {profiles.find((p) => p.id === b.fallback_profile_id)?.model_id ?? '—'}
                          </td>
                          <td>
                            <StatusBadge tone={b.auto_route ? 'accent' : 'neutral'}>
                              {b.auto_route ? '开启' : '关闭'}
                            </StatusBadge>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-ghost"
                              onClick={() => deleteBinding.mutate(b.id)}
                            >
                              <Icon name="trash" size="xs" /> 删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {section === 'logs' && (
            <Panel title="调用记录" icon={<Icon as={Activity} size="md" tone="accent" />}>
              {logsQ.isPending ? (
                <LoadingState message="读取调用记录…" compact />
              ) : (logsQ.data ?? []).length === 0 ? (
                <p className="rc-we-empty">暂无模型调用记录。</p>
              ) : (
                <div className="rc-we-scroll">
                  <table className="data-table data-table-dense">
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>任务</th>
                        <th>模型</th>
                        <th>结果</th>
                        <th>Token</th>
                        <th>耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(logsQ.data ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="rc-we-mono text-xs">{formatDateTime(l.created_at)}</td>
                          <td className="text-xs">{TASK_LABELS[l.task_key] || l.task_key || '—'}</td>
                          <td className="rc-we-mono text-xs">{l.model_id}</td>
                          <td>
                            <StatusBadge tone={l.success ? 'success' : 'danger'}>
                              {l.success ? '成功' : l.error_code ?? '失败'}
                            </StatusBadge>
                          </td>
                          <td className="rc-we-mono text-xs">
                            {l.prompt_tokens}+{l.completion_tokens}
                          </td>
                          <td className="rc-we-mono text-xs">{l.duration_ms}ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {section === 'stats' && (
            <Panel title="用量统计" icon={<Icon as={BarChart3} size="md" tone="accent" />}>
              {statsQ.isPending ? (
                <LoadingState message="统计中…" compact />
              ) : statsQ.isError || !statsQ.data ? (
                <ErrorState message="无法读取统计" onRetry={() => void statsQ.refetch()} />
              ) : (
                <>
                  <div className="rc-we-grid rc-we-grid--4 rc-stagger">
                    {[
                      ['总调用', statsQ.data.total_calls],
                      ['成功', statsQ.data.success_calls],
                      ['失败', statsQ.data.failed_calls],
                      ['P95 耗时', `${statsQ.data.p95_duration_ms}ms`],
                      ['输入 Token', statsQ.data.prompt_tokens],
                      ['输出 Token', statsQ.data.completion_tokens],
                      ['平均耗时', `${statsQ.data.avg_duration_ms}ms`],
                      ['任务数', Object.keys(statsQ.data.by_task).length],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rc-we-kpi">
                        <div className="rc-we-kpi__k">{label}</div>
                        <div className="rc-we-kpi__v">{value}</div>
                      </div>
                    ))}
                  </div>
                  {statsQ.data.cost_note && (
                    <p
                      style={{
                        marginTop: 'var(--rc-space-4)',
                        fontSize: 'var(--rc-fs-caption)',
                        color: 'var(--rc-text-muted)',
                      }}
                    >
                      {statsQ.data.cost_note}
                    </p>
                  )}
                </>
              )}
            </Panel>
          )}
        </div>
      </div>

      {/* 添加模型：只从用户已添加的提供商中选择 */}
      <Modal
        open={profileOpen}
        title="添加模型"
        onClose={() => setProfileOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setProfileOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={createProfile.isPending || !selectedCred || !profileForm.model_id.trim()}
              onClick={() => {
                if (!selectedCred) return
                createProfile.mutate({
                  provider_key: selectedCred.provider_key,
                  credential_id: selectedCred.id,
                  model_id: profileForm.model_id.trim(),
                  display_name: profileForm.display_name.trim() || undefined,
                  params: { temperature: profileForm.temperature },
                  timeout_s: profileForm.timeout_s,
                  max_retries: profileForm.max_retries,
                  max_tokens: profileForm.max_tokens,
                  is_default: profileForm.is_default,
                  is_fallback: profileForm.is_fallback,
                })
              }}
            >
              {createProfile.isPending ? (
                <Icon name="loader" size="sm" className="animate-spin" />
              ) : (
                <Icon name="plus" size="sm" />
              )}{' '}
              保存模型
            </button>
          </>
        }
      >
        <div className="rc-we-stack-tight">
          <div className="block">
            <div className="ux-model-label-row">
              <label htmlFor="rc-pick-cred" className="field-label mb-0">
                已添加的提供商
              </label>
              {selectedCred && (
                <button
                  type="button"
                  className="ux-text-link text-[11px]"
                  disabled={fetchRemoteModels.isPending}
                  onClick={() => fetchRemoteModels.mutate(selectedCred.id)}
                >
                  {fetchRemoteModels.isPending ? (
                    <Icon name="loader" size="xs" className="animate-spin" />
                  ) : (
                    <Download size={11} />
                  )}
                  拉取远端模型
                </button>
              )}
            </div>
            <select
              id="rc-pick-cred"
              className="field-input"
              value={profileForm.credential_id}
              onChange={(e) => {
                setRemoteModels([])
                setProfileForm({ ...profileForm, credential_id: e.target.value })
              }}
            >
              {activeCreds.length === 0 ? (
                <option value="">暂无可用提供商</option>
              ) : (
                activeCreds.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.key_hint || c.provider_key})
                  </option>
                ))
              )}
            </select>
          </div>

          <label className="block">
            <span className="field-label">模型 ID</span>
            <input
              className="field-input mono"
              value={profileForm.model_id}
              onChange={(e) => setProfileForm({ ...profileForm, model_id: e.target.value })}
              placeholder="例如 qwen-plus / deepseek-chat / gpt-4o-mini"
            />
          </label>

          {suggestedModels.length > 0 && (
            <div className="ux-model-options" aria-label="可选模型">
              {suggestedModels.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`ux-model-option${profileForm.model_id === id ? ' is-selected' : ''}`}
                  onClick={() => setProfileForm({ ...profileForm, model_id: id })}
                >
                  <strong>{id}</strong>
                </button>
              ))}
            </div>
          )}

          <label className="block">
            <span className="field-label">显示名称（可选）</span>
            <input
              className="field-input"
              value={profileForm.display_name}
              onChange={(e) => setProfileForm({ ...profileForm, display_name: e.target.value })}
              placeholder={profileForm.model_id || '留空则同模型 ID'}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ['temperature', '温度'],
                ['timeout_s', '超时（秒）'],
                ['max_retries', '最大重试'],
                ['max_tokens', '最大 Token'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="field-label">{label}</span>
                <input
                  className="field-input mono"
                  type="number"
                  step={key === 'temperature' ? '0.1' : '1'}
                  value={String(profileForm[key])}
                  onChange={(e) =>
                    setProfileForm({ ...profileForm, [key]: Number(e.target.value) })
                  }
                />
              </label>
            ))}
          </div>

          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={profileForm.is_default}
                onChange={(e) => setProfileForm({ ...profileForm, is_default: e.target.checked })}
              />{' '}
              设为默认
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={profileForm.is_fallback}
                onChange={(e) => setProfileForm({ ...profileForm, is_fallback: e.target.checked })}
              />{' '}
              设为备用
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={bindOpen}
        title="任务模型分配"
        onClose={() => setBindOpen(false)}
        footer={
          <>
            <button type="button" className="btn-ghost" onClick={() => setBindOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={upsertBinding.isPending || !bindForm.primary_profile_id}
              onClick={() =>
                upsertBinding.mutate({
                  task_key: bindForm.task_key,
                  primary_profile_id: bindForm.primary_profile_id,
                  fallback_profile_id: bindForm.fallback_profile_id || undefined,
                  auto_route: bindForm.auto_route,
                  cost_preference: bindForm.cost_preference,
                })
              }
            >
              {upsertBinding.isPending ? (
                <Icon name="loader" size="sm" className="animate-spin" />
              ) : (
                <Icon as={Link2} size="sm" />
              )}{' '}
              保存分配
            </button>
          </>
        }
      >
        <div className="rc-we-stack-tight">
          <label className="block">
            <span className="field-label">科研任务</span>
            <select
              className="field-input"
              value={bindForm.task_key}
              onChange={(e) => setBindForm({ ...bindForm, task_key: e.target.value })}
            >
              {Object.entries(TASK_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">主模型</span>
            <select
              className="field-input"
              value={bindForm.primary_profile_id}
              onChange={(e) => setBindForm({ ...bindForm, primary_profile_id: e.target.value })}
            >
              <option value="">请选择</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name || p.model_id} · {credName(p.credential_id)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">备用模型（可选）</span>
            <select
              className="field-input"
              value={bindForm.fallback_profile_id}
              onChange={(e) => setBindForm({ ...bindForm, fallback_profile_id: e.target.value })}
            >
              <option value="">— 不设置 —</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name || p.model_id} · {credName(p.credential_id)}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="field-label">成本偏好</span>
            <select
              className="field-input"
              value={bindForm.cost_preference}
              onChange={(e) => setBindForm({ ...bindForm, cost_preference: e.target.value })}
            >
              <option value="balanced">均衡</option>
              <option value="quality">优先质量</option>
              <option value="cost">优先低成本</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={bindForm.auto_route}
              onChange={(e) => setBindForm({ ...bindForm, auto_route: e.target.checked })}
            />
            开启自动路由
          </label>
        </div>
      </Modal>
    </div>
  )
}
