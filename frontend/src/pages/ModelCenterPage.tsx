/**
 * 第十一阶段：模型管理中心（Wave E · /settings/models）
 * --------------------------------------------------------------------------
 * 设计：动态透视卡片 —— 多个模型配置沿透视轴层叠，切换时 400ms
 *      （--rc-dur-slow + --rc-ease-out）滑入滑出；3D 倾角 ≤4°，窄屏降级为纵向滑动。
 * 安全：配置过程全程在授权后端完成；API Key 用 password 输入框、提交后立即清空，
 *      且**永不写入 sessionStorage 草稿**（草稿采用非敏感字段白名单）。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Activity,
  BarChart3,
  BookMarked,
  CheckCircle2,
  CircleSlash2,
  Cpu,
  KeyRound,
  Link2,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  XCircle,
} from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'
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
import type { ModelProfile, TaskBinding, TestResult } from '../types/model'

type Section = 'setup' | 'providers' | 'credentials' | 'models' | 'default' | 'bindings' | 'logs' | 'stats'

const SECTIONS: { key: Section; label: string; icon: typeof Cpu; hint: string }[] = [
  { key: 'setup', label: '连接 AI 助手', icon: Sparkles, hint: '五步向导，先测试再保存' },
  { key: 'providers', label: '服务商详情', icon: BookMarked, hint: '查看真实适配器清单' },
  { key: 'credentials', label: '密钥管理', icon: KeyRound, hint: '撤销或删除已有密钥' },
  { key: 'models', label: '模型配置', icon: Cpu, hint: '高级参数与逐个测试' },
  { key: 'default', label: '默认模型', icon: CheckCircle2, hint: '默认与备用策略' },
  { key: 'bindings', label: '按任务分配', icon: SlidersHorizontal, hint: '高级：不同科研任务用不同模型' },
  { key: 'logs', label: '调用记录', icon: Activity, hint: '真实调用元数据' },
  { key: 'stats', label: '用量统计', icon: BarChart3, hint: '次数 / Token / 耗时' },
]

const SECTION_KEYS = new Set<string>(SECTIONS.map((item) => item.key))

const TASK_LABELS: Record<string, string> = {
  pdf_extraction: 'PDF 论文解析', fact_extraction: '科研事实抽取',
  diff_analysis: '论文与代码差异分析', failure_diagnosis: '失败原因分析',
  rag_qa: 'RAG 问答', report_generation: '报告生成', summary: '科研材料总结',
}

/** 凭据草稿槽位：只允许写入非敏感字段（白名单），api_key 永不落盘。 */
const CRED_DRAFT_KEY = 'rc.draft.model-credential'

function errMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

function Panel({ title, icon, children, action }: {
  title: string; icon?: ReactNode; children: ReactNode; action?: ReactNode
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
          {ok ? '连接成功（真实调用）' : `连接失败：${result.status}`}
        </p>
        <p className="rc-we-mono" style={{ marginTop: 4 }}>
          {ok
            ? `${result.provider} / ${result.model} · ${result.latency_ms}ms · tokens ${result.prompt_tokens ?? 0}+${result.completion_tokens ?? 0}`
            : `${result.error_code ?? '-'} ${result.error_message ?? ''}`}
        </p>
        {result.reply_preview && (
          <p style={{ marginTop: 4 }}>回复预览：{result.reply_preview}</p>
        )}
      </div>
    </div>
  )
}

/** 透视卡组：当前选中卡在 depth 0，其余按循环次序退到后面。 */
function deckDepth(index: number, active: number, total: number): number {
  if (total <= 0) return 0
  return (index - active + total) % total
}

export default function ModelCenterPage() {
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const initialTab = params.get('tab')
  const [section, setSection] = useState<Section>(
    initialTab && SECTION_KEYS.has(initialTab) ? initialTab as Section : 'setup',
  )
  const [credOpen, setCredOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [bindOpen, setBindOpen] = useState(false)
  const [credForm, setCredForm] = useState({ provider_key: 'qwen', name: '', api_key: '', base_url: '' })
  const [profileForm, setProfileForm] = useState({
    provider_key: 'qwen', credential_id: '', model_id: '', display_name: '',
    temperature: 0, timeout_s: 60, max_retries: 1, max_tokens: 2048,
    is_default: false, is_fallback: false,
  })
  const [bindForm, setBindForm] = useState({
    task_key: 'fact_extraction', primary_profile_id: '', fallback_profile_id: '',
    auto_route: false, cost_preference: 'balanced',
  })
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [credTestId, setCredTestId] = useState<string | null>(null)
  const [activeProfile, setActiveProfile] = useState(0)
  const [moving, setMoving] = useState(false)
  const firstRender = useRef(true)

  const providersQ = useQuery({ queryKey: ['model-providers'], queryFn: modelApi.providers })
  const credsQ = useQuery({ queryKey: ['model-credentials'], queryFn: modelApi.credentials, enabled: section === 'credentials' || section === 'models' || section === 'default' })
  const profilesQ = useQuery({ queryKey: ['model-profiles'], queryFn: modelApi.profiles, enabled: section === 'models' || section === 'default' || section === 'bindings' })
  const bindsQ = useQuery({ queryKey: ['model-bindings'], queryFn: () => modelApi.bindings(), enabled: section === 'bindings' })
  const logsQ = useQuery({ queryKey: ['model-logs'], queryFn: () => modelApi.callLogs(100), enabled: section === 'logs' })
  const statsQ = useQuery({ queryKey: ['model-stats'], queryFn: modelApi.stats, enabled: section === 'stats' })

  const refresh = () => void qc.invalidateQueries()

  /* ------------------------------------------------------------------------
   * 凭据草稿：白名单写入 —— 供应商 / 名称 / 接口地址可恢复，
   * api_key 明确排除，绝不进入 sessionStorage。
   * ---------------------------------------------------------------------- */
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(CRED_DRAFT_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, unknown>
      setCredForm((prev) => ({
        ...prev,
        provider_key: typeof parsed.provider_key === 'string' ? parsed.provider_key : prev.provider_key,
        name: typeof parsed.name === 'string' ? parsed.name : prev.name,
        base_url: typeof parsed.base_url === 'string' ? parsed.base_url : prev.base_url,
      }))
    } catch {
      /* 草稿损坏或隐私模式受限：忽略即可 */
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        // 白名单：只有这三个非敏感字段会落盘，api_key 不在列表内。
        const safeDraft = {
          provider_key: credForm.provider_key,
          name: credForm.name,
          base_url: credForm.base_url,
        }
        window.sessionStorage.setItem(CRED_DRAFT_KEY, JSON.stringify(safeDraft))
      } catch {
        /* sessionStorage 不可用时静默跳过 */
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [credForm.provider_key, credForm.name, credForm.base_url])

  const clearCredDraft = () => {
    try {
      window.sessionStorage.removeItem(CRED_DRAFT_KEY)
    } catch {
      /* ignore */
    }
  }

  /* 透视切换：活动期才挂 will-change，动画结束后自动摘掉 */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setMoving(true)
    const timer = window.setTimeout(() => setMoving(false), 420)
    return () => window.clearTimeout(timer)
  }, [activeProfile])

  const createCred = useMutation({
    mutationFn: modelApi.createCredential,
    onSuccess: (data) => {
      setCredOpen(false)
      setCredForm((f) => ({ ...f, api_key: '' })) // 立即清空明文
      clearCredDraft()
      toast.success('凭据已加密保存，创建后仅显示脱敏信息。')
      refresh()
      // 创建后自动发起一次真实连接测试，并在这里真正触发 mutation。
      setCredTestId(data.id)
      testCred.mutate(data.id)
    },
    onError: (e) => toast.error(errMessage(e, '凭据保存失败')),
  })
  const testCred = useMutation({
    mutationFn: (id: string) => modelApi.testCredential(id),
    onSuccess: (r) => { setTestResult(r); setCredTestId(null) },
    onError: (e) => { setTestResult({ status: 'provider_error', error_message: errMessage(e, '测试失败') }); setCredTestId(null) },
  })
  const testProfile = useMutation({
    mutationFn: (id: string) => modelApi.testProfile(id),
    onSuccess: setTestResult,
    onError: (e) => setTestResult({ status: 'provider_error', error_message: errMessage(e, '测试失败') }),
  })
  const revokeCred = useMutation({
    mutationFn: modelApi.revokeCredential,
    onSuccess: () => { toast.success('凭据已撤销'); refresh() },
    onError: (e) => toast.error(errMessage(e, '撤销失败')),
  })
  const purgeCred = useMutation({
    mutationFn: modelApi.purgeCredential,
    onSuccess: () => { toast.success('凭据已删除'); refresh() },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })
  const createProfile = useMutation({
    mutationFn: modelApi.createProfile,
    onSuccess: () => { setProfileOpen(false); toast.success('模型配置已保存'); refresh() },
    onError: (e) => toast.error(errMessage(e, '模型配置保存失败')),
  })
  const updateProfile = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ModelProfile> }) => modelApi.updateProfile(id, body),
    onSuccess: () => { toast.success('模型配置已更新'); refresh() },
    onError: (e) => toast.error(errMessage(e, '更新失败')),
  })
  const deleteProfile = useMutation({
    mutationFn: modelApi.deleteProfile,
    onSuccess: () => { toast.success('模型配置已删除'); refresh() },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })
  const upsertBinding = useMutation({
    mutationFn: modelApi.upsertBinding,
    onSuccess: () => { setBindOpen(false); toast.success('任务模型绑定已保存'); refresh() },
    onError: (e) => toast.error(errMessage(e, '绑定保存失败')),
  })
  const deleteBinding = useMutation({
    mutationFn: modelApi.deleteBinding,
    onSuccess: () => { toast.success('绑定已删除'); refresh() },
    onError: (e) => toast.error(errMessage(e, '删除失败')),
  })

  const creds = credsQ.data ?? []
  const profiles = profilesQ.data ?? []
  const providers = providersQ.data ?? []
  const credName = (id: string | null) =>
    creds.find((c) => c.id === id)?.name ?? (id ? '未关联凭据' : '—')

  // 模型列表变化时保证选中项合法
  const safeActive = useMemo(
    () => (profiles.length === 0 ? 0 : Math.min(activeProfile, profiles.length - 1)),
    [activeProfile, profiles.length],
  )

  useEffect(() => {
    const tab = params.get('tab')
    if (tab && SECTION_KEYS.has(tab) && tab !== section) setSection(tab as Section)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  const changeSection = (next: Section) => {
    setSection(next)
    const nextParams = new URLSearchParams(params)
    nextParams.set('tab', next)
    setParams(nextParams, { replace: true })
  }

  return (
    <div className="rc-we-page">
      <header className="rc-we-head">
        <div className="rc-we-head__text">
          <p className="rc-we-eyebrow">AI 模型服务 · 可按需配置</p>
          <h1 className="rc-we-title">连接 AI 助手</h1>
          <p className="rc-we-lead">
            不会配置也没关系：选择服务商、粘贴密钥、确认模型、真实测试，再保存。
            不配置也不影响项目、材料、对照和报告等本地功能。
          </p>
        </div>
        <div className="rc-we-actions">
          <Link to="/manual#api" className="btn-ghost">查看图文说明</Link>
          <button type="button" className="btn-ghost" onClick={refresh} disabled={providersQ.isFetching}>
            <Icon name="rotate" size="sm" className={providersQ.isFetching ? 'animate-spin' : ''} />
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
              className={`rc-we-nav__item${key !== 'setup' && key !== 'providers' ? ' rc-we-nav__item--advanced' : ''}`}
            >
              <Icon as={SectionIcon} size="sm" />
              <span style={{ minWidth: 0 }}>
                <span className="rc-we-nav__label">{label}</span>
                <span className="rc-we-nav__hint">{hint}</span>
              </span>
            </button>
          ))}
          {section !== 'setup' && (
            <button type="button" className="ux-model-back-simple" onClick={() => changeSection('setup')}>
              返回简单配置
            </button>
          )}
        </nav>

        <div className="rc-we-stack">
          {section === 'setup' && <GuidedModelSetup onDone={refresh} />}

          {section !== 'setup' && section !== 'providers' && (
            <div className="ux-advanced-banner">
              <strong>你正在高级管理模式</strong>
              <span>这里的选项用于排错、批量管理和精细控制。第一次配置请用“连接 AI 助手”向导，避免改错。</span>
              <button type="button" className="ux-text-link" onClick={() => changeSection('setup')}>回到简单配置</button>
            </div>
          )}

          {section === 'providers' && (
            <Panel
              title="服务商与适配器详情（高级）"
              icon={<Icon as={BookMarked} size="md" tone="accent" />}
            >
              {providersQ.isPending ? <LoadingState message="读取供应商…" /> : providersQ.isError ? (
                <ErrorState message="无法读取供应商列表" onRetry={() => void providersQ.refetch()} />
              ) : providers.length === 0 ? (
                <p className="rc-we-empty">后端未返回任何供应商。</p>
              ) : (
                <>
                  <div className="rc-we-scroll">
                    <table className="data-table data-table-dense">
                      <thead><tr>
                        <th>供应商</th><th>协议</th><th>默认端点</th><th>能力</th><th>联调状态</th>
                      </tr></thead>
                      <tbody>
                        {providers.map((p) => (
                          <tr key={p.key}>
                            <td className="font-medium">{p.name}<div className="rc-we-mono text-[11px] text-ink-subtle">{p.key}</div></td>
                            <td className="rc-we-mono text-xs">{p.protocol}</td>
                            <td className="rc-we-mono max-w-[240px] truncate text-xs" title={p.default_base_url}>
                              {p.default_base_url || '需用户填写'}
                            </td>
                            <td className="text-xs">{p.capabilities.length} 项</td>
                            <td><StatusBadge tone={p.real_api_tested ? 'success' : 'neutral'}>
                              {p.real_api_tested ? '已联调' : '未真实联调'}
                            </StatusBadge></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ marginTop: 'var(--rc-space-3)', fontSize: 'var(--rc-fs-caption)', lineHeight: 1.6, color: 'var(--rc-text-muted)' }}>
                    适配层均按官方 API 文档实现并通过协议级模拟测试；本环境未取得任何厂商真实 API Key，
                    因此不宣称真实联调成功。连接测试会在你保存自己的 Key 后真实调用目标 API。
                  </p>
                </>
              )}
            </Panel>
          )}

          {section === 'credentials' && (
            <Panel
              title="API 凭据"
              icon={<Icon name="key" size="md" tone="accent" />}
              action={
                <button type="button" className="btn-primary" onClick={() => setCredOpen(true)}>
                  <Icon name="plus" size="sm" /> 添加凭据
                </button>
              }
            >
              <div className="rc-we-note">
                <Icon name="shield" size="md" className="rc-we-note__icon" />
                <div>
                  <p className="rc-we-note__title">密钥边界</p>
                  <ul className="rc-we-note__list">
                    <li>Key 只提交到授权后端，以独立密钥加密；列表仅显示脱敏提示，创建后无法再次查看明文。</li>
                    <li>浏览器草稿只保存供应商 / 名称 / 接口地址，<b>API Key 永不写入 sessionStorage</b>，提交后立即清空。</li>
                    <li>支持撤销与彻底删除，不同用户严格隔离。</li>
                  </ul>
                </div>
              </div>
              {credsQ.isPending ? <LoadingState message="读取凭据…" /> : creds.length === 0 ? (
                <p className="rc-we-empty">还没有凭据。点击「添加凭据」配置自己的 API Key。</p>
              ) : (
                <div className="rc-we-scroll" style={{ marginTop: 'var(--rc-space-4)' }}>
                  <table className="data-table data-table-dense">
                    <thead><tr><th>名称</th><th>供应商</th><th>脱敏 Key</th><th>状态</th><th>操作</th></tr></thead>
                    <tbody>
                      {creds.map((c) => (
                        <tr key={c.id}>
                          <td className="font-medium">{c.name}</td>
                          <td className="rc-we-mono text-xs">{c.provider_key}</td>
                          <td className="rc-we-mono text-xs">{c.key_hint || '—'}</td>
                          <td><StatusBadge tone={c.status === 'active' ? 'success' : 'neutral'}>{c.status}</StatusBadge></td>
                          <td>
                            <div className="flex flex-wrap gap-2">
                              <button type="button" className="btn-ghost" disabled={testCred.isPending}
                                onClick={() => { setTestResult(null); testCred.mutate(c.id) }}>
                                {testCred.isPending
                                  ? <Icon name="loader" size="xs" className="animate-spin" />
                                  : <Icon as={Link2} size="xs" />} 测试
                              </button>
                              {c.status === 'active' && (
                                <button type="button" className="btn-ghost" onClick={() => revokeCred.mutate(c.id)}>
                                  <Icon as={CircleSlash2} size="xs" /> 撤销
                                </button>
                              )}
                              <button type="button" className="btn-ghost" onClick={() => purgeCred.mutate(c.id)}>
                                <Icon name="trash" size="xs" /> 删除
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <TestResultView result={testResult} />
            </Panel>
          )}

          {section === 'models' && (
            <Panel
              title="我的模型"
              icon={<Icon as={Cpu} size="md" tone="accent" />}
              action={
                <button type="button" className="btn-primary" onClick={() => setProfileOpen(true)}>
                  <Icon name="plus" size="sm" /> 添加模型
                </button>
              }
            >
              {profilesQ.isPending ? (
                <LoadingState message="读取模型…" />
              ) : profiles.length === 0 ? (
                <p className="rc-we-empty">还没有模型配置。先添加凭据，再添加模型。</p>
              ) : (
                <div className="rc-we-deck">
                  <div className="rc-we-deck__tabs" role="tablist" aria-label="模型透视切换">
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
                                  {front ? '当前模型' : `层叠 ${depth}`}
                                </p>
                                <h4 className="rc-we-deck__paneltitle">{p.display_name || p.model_id}</h4>
                                <p className="rc-we-mono" style={{ marginTop: 4, fontSize: 'var(--rc-fs-mono)', color: 'var(--rc-text-subtle)' }}>
                                  {p.provider_key} / {p.model_id}
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
                                      <p className="rc-we-kpi__k">凭据</p>
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
                                      <p className="rc-we-kpi__k">最大重试</p>
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
                                    <button type="button" className="btn-primary" onClick={() => { setTestResult(null); testProfile.mutate(p.id) }}>
                                      {testProfile.isPending
                                        ? <Icon name="loader" size="sm" className="animate-spin" />
                                        : <Icon as={Link2} size="sm" />} 测试连接
                                    </button>
                                    <button type="button" className="btn-ghost" onClick={() => updateProfile.mutate({ id: p.id, body: { enabled: !p.enabled } })}>
                                      {p.enabled ? '禁用' : '启用'}
                                    </button>
                                    <button type="button" className="btn-ghost" disabled={p.is_default}
                                      onClick={() => updateProfile.mutate({ id: p.id, body: { is_default: true } })}>
                                      设为默认
                                    </button>
                                    <button type="button" className="btn-ghost" disabled={p.is_fallback}
                                      onClick={() => updateProfile.mutate({ id: p.id, body: { is_fallback: true } })}>
                                      设为备用
                                    </button>
                                    <button type="button" className="btn-ghost" onClick={() => deleteProfile.mutate(p.id)}>
                                      <Icon name="trash" size="sm" /> 删除
                                    </button>
                                  </div>
                                  <TestResultView result={testResult} />
                                </>
                              ) : (
                                <p style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-subtle)' }}>
                                  {p.enabled ? '启用中' : '已禁用'} · T={String(p.params?.temperature ?? 0)} · {p.timeout_s}s · retry {p.max_retries}
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

          {section === 'default' && (
            <Panel title="默认与备用模型" icon={<Icon name="badgeCheck" size="md" tone="accent" />}>
              {profiles.length === 0 ? <p className="rc-we-empty">请先添加模型。</p> : (
                <div className="rc-we-grid rc-we-grid--2">
                  {profiles.map((p) => (
                    <div key={p.id} className="rc-we-card" style={{ boxShadow: 'none' }}>
                      <div className="rc-we-card__body rc-we-card__body--tight">
                        <div className="rc-we-row-between">
                          <span style={{ fontWeight: 'var(--rc-fw-m)' }}>{p.display_name || p.model_id}</span>
                          <div className="rc-we-row" style={{ gap: 'var(--rc-space-1)' }}>
                            {p.is_default && <StatusBadge tone="accent">默认</StatusBadge>}
                            {p.is_fallback && <StatusBadge tone="warning">备用</StatusBadge>}
                          </div>
                        </div>
                        <p className="rc-we-mono" style={{ marginTop: 4, fontSize: 'var(--rc-fs-mono)', color: 'var(--rc-text-muted)' }}>
                          {p.provider_key} / {p.model_id}
                        </p>
                        <div className="rc-we-row" style={{ marginTop: 'var(--rc-space-3)' }}>
                          <button type="button" className="btn-ghost" disabled={p.is_default}
                            onClick={() => updateProfile.mutate({ id: p.id, body: { is_default: true } })}>
                            设为默认
                          </button>
                          <button type="button" className="btn-ghost" disabled={p.is_fallback}
                            onClick={() => updateProfile.mutate({ id: p.id, body: { is_fallback: true } })}>
                            设为备用
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p style={{ marginTop: 'var(--rc-space-3)', fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                备用模型仅在用户显式绑定后参与故障切换，并记录切换原因；不会静默切换到未授权供应商。
              </p>
            </Panel>
          )}

          {section === 'bindings' && (
            <Panel
              title="科研任务模型分配"
              icon={<Icon as={SlidersHorizontal} size="md" tone="accent" />}
              action={
                <button type="button" className="btn-primary" onClick={() => setBindOpen(true)}>
                  <Icon name="plus" size="sm" /> 添加绑定
                </button>
              }
            >
              <p style={{ marginBottom: 'var(--rc-space-3)', fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                默认行为：未绑定的任务继续使用服务端环境变量配置；绑定后严格使用你选择的模型，不静默替换。
              </p>
              {bindsQ.isPending ? <LoadingState message="读取绑定…" /> : (bindsQ.data ?? []).length === 0 ? (
                <p className="rc-we-empty">尚未配置任务级绑定。</p>
              ) : (
                <div className="rc-we-scroll">
                  <table className="data-table data-table-dense">
                    <thead><tr><th>科研任务</th><th>主模型</th><th>备用模型</th><th>自动路由</th><th>操作</th></tr></thead>
                    <tbody>
                      {(bindsQ.data ?? []).map((b: TaskBinding) => (
                        <tr key={b.id}>
                          <td className="font-medium">{TASK_LABELS[b.task_key] ?? b.task_key}</td>
                          <td className="rc-we-mono text-xs">{profiles.find((p) => p.id === b.primary_profile_id)?.model_id ?? '—'}</td>
                          <td className="rc-we-mono text-xs">{profiles.find((p) => p.id === b.fallback_profile_id)?.model_id ?? '—'}</td>
                          <td><StatusBadge tone={b.auto_route ? 'accent' : 'neutral'}>{b.auto_route ? '开启' : '关闭'}</StatusBadge></td>
                          <td><button type="button" className="btn-ghost" onClick={() => deleteBinding.mutate(b.id)}>
                            <Icon name="trash" size="xs" /> 删除
                          </button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}

          {section === 'logs' && (
            <Panel title="最近调用记录" icon={<Icon as={Activity} size="md" tone="accent" />}>
              {logsQ.isPending ? <LoadingState message="读取调用记录…" /> : (logsQ.data ?? []).length === 0 ? (
                <p className="rc-we-empty">暂无模型调用记录。</p>
              ) : (
                <div className="rc-we-scroll">
                  <table className="data-table data-table-dense">
                    <thead><tr><th>时间</th><th>任务</th><th>模型</th><th>结果</th><th>Token</th><th>耗时</th></tr></thead>
                    <tbody>
                      {(logsQ.data ?? []).map((l) => (
                        <tr key={l.id}>
                          <td className="rc-we-mono text-xs">{formatDateTime(l.created_at)}</td>
                          <td className="text-xs">{TASK_LABELS[l.task_key] || l.task_key || '—'}</td>
                          <td className="rc-we-mono text-xs">{l.model_id}</td>
                          <td><StatusBadge tone={l.success ? 'success' : 'danger'}>
                            {l.success ? '成功' : (l.error_code ?? '失败')}
                          </StatusBadge></td>
                          <td className="rc-we-mono text-xs">{l.prompt_tokens}+{l.completion_tokens}</td>
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
            <Panel title="使用统计" icon={<Icon as={BarChart3} size="md" tone="accent" />}>
              {statsQ.isPending ? <LoadingState message="统计中…" /> : statsQ.isError || !statsQ.data ? (
                <ErrorState message="无法读取统计" onRetry={() => void statsQ.refetch()} />
              ) : (
                <>
                  <div className="rc-we-grid rc-we-grid--4">
                    {[
                      ['总调用', statsQ.data.total_calls], ['成功', statsQ.data.success_calls],
                      ['失败', statsQ.data.failed_calls], ['P95 耗时', `${statsQ.data.p95_duration_ms}ms`],
                      ['输入 Token', statsQ.data.prompt_tokens], ['输出 Token', statsQ.data.completion_tokens],
                      ['平均耗时', `${statsQ.data.avg_duration_ms}ms`], ['按任务分组', Object.keys(statsQ.data.by_task).length],
                    ].map(([label, value]) => (
                      <div key={String(label)} className="rc-we-kpi">
                        <div className="rc-we-kpi__k">{label}</div>
                        <div className="rc-we-kpi__v">{value}</div>
                      </div>
                    ))}
                  </div>
                  <p style={{ marginTop: 'var(--rc-space-4)', fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
                    {statsQ.data.cost_note}
                  </p>
                </>
              )}
            </Panel>
          )}
        </div>
      </div>

      <Modal open={credOpen} title="添加 API 凭据" description="提交后仅显示脱敏信息；Key 以独立密钥加密，绝不写入浏览器存储。"
        onClose={() => { setCredOpen(false); setCredForm((f) => ({ ...f, api_key: '' })) }}
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => setCredOpen(false)}>取消</button>
          <button type="button" className="btn-primary" disabled={createCred.isPending || !credForm.api_key}
            onClick={() => createCred.mutate({
              provider_key: credForm.provider_key, name: credForm.name,
              api_key: credForm.api_key, base_url: credForm.base_url || undefined,
            })}>
            {createCred.isPending ? <Icon name="loader" size="sm" className="animate-spin" /> : <Icon name="key" size="sm" />} 保存凭据
          </button>
        </>}>
        <div className="rc-we-stack-tight">
          <label className="block">
            <span className="field-label">供应商</span>
            <select className="field-input" value={credForm.provider_key}
              onChange={(e) => setCredForm({ ...credForm, provider_key: e.target.value })}>
              {providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="field-label">名称（可选）</span>
            <input className="field-input" value={credForm.name}
              onChange={(e) => setCredForm({ ...credForm, name: e.target.value })} placeholder="例如：课题组千问" />
          </label>
          <label className="block">
            <span className="field-label">API Key</span>
            <input className="field-input mono" type="password" autoComplete="off" value={credForm.api_key}
              onChange={(e) => setCredForm({ ...credForm, api_key: e.target.value })}
              placeholder="仅提交到授权后端，前端不保存" />
            <span className="mt-1 block text-xs text-ink-muted">
              密码框内容不进入浏览器草稿：刷新页面后需要重新输入。
            </span>
          </label>
          {(credForm.provider_key === 'openai_compatible' || credForm.base_url) && (
            <label className="block">
              <span className="field-label">Base URL（自定义接口必填）</span>
              <input className="field-input mono" value={credForm.base_url}
                onChange={(e) => setCredForm({ ...credForm, base_url: e.target.value })}
                placeholder="https://model.lab.example.edu/v1" />
              <span className="mt-1 block text-xs text-ink-muted">仅 HTTPS；内网地址会被安全策略拒绝。</span>
            </label>
          )}
        </div>
      </Modal>

      <Modal open={profileOpen} title="添加模型" description="模型名按供应商控制台实际可用值填写；结构化任务会检查 JSON 能力。"
        onClose={() => setProfileOpen(false)}
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => setProfileOpen(false)}>取消</button>
          <button type="button" className="btn-primary" disabled={createProfile.isPending || !profileForm.model_id}
            onClick={() => createProfile.mutate({
              provider_key: profileForm.provider_key, model_id: profileForm.model_id,
              credential_id: profileForm.credential_id || undefined,
              display_name: profileForm.display_name || undefined,
              params: { temperature: profileForm.temperature },
              timeout_s: profileForm.timeout_s, max_retries: profileForm.max_retries,
              max_tokens: profileForm.max_tokens, is_default: profileForm.is_default,
              is_fallback: profileForm.is_fallback,
            })}>
            {createProfile.isPending ? <Icon name="loader" size="sm" className="animate-spin" /> : <Icon name="plus" size="sm" />} 保存模型
          </button>
        </>}>
        <div className="rc-we-stack-tight">
          <label className="block"><span className="field-label">供应商</span>
            <select className="field-input" value={profileForm.provider_key}
              onChange={(e) => setProfileForm({ ...profileForm, provider_key: e.target.value })}>
              {providers.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="field-label">API 凭据</span>
            <select className="field-input" value={profileForm.credential_id}
              onChange={(e) => setProfileForm({ ...profileForm, credential_id: e.target.value })}>
              <option value="">— 不关联（仅占位）—</option>
              {creds.filter((c) => c.provider_key === profileForm.provider_key && c.status === 'active').map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.key_hint})</option>
              ))}
            </select>
          </label>
          <label className="block"><span className="field-label">模型 ID</span>
            <input className="field-input mono" value={profileForm.model_id}
              onChange={(e) => setProfileForm({ ...profileForm, model_id: e.target.value })}
              placeholder="例如 qwen-plus / deepseek-flash / gpt-4o-mini" />
          </label>
          <label className="block"><span className="field-label">显示名称</span>
            <input className="field-input" value={profileForm.display_name}
              onChange={(e) => setProfileForm({ ...profileForm, display_name: e.target.value })} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            {([
              ['temperature', '温度', 'number'], ['timeout_s', '超时（秒）', 'number'],
              ['max_retries', '最大重试', 'number'], ['max_tokens', '最大 Token', 'number'],
            ] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="field-label">{label}</span>
                <input className="field-input mono" type="number" step={key === 'temperature' ? '0.1' : '1'}
                  value={String(profileForm[key])}
                  onChange={(e) => setProfileForm({ ...profileForm, [key]: Number(e.target.value) })} />
              </label>
            ))}
          </div>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={profileForm.is_default}
                onChange={(e) => setProfileForm({ ...profileForm, is_default: e.target.checked })} /> 设为默认
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={profileForm.is_fallback}
                onChange={(e) => setProfileForm({ ...profileForm, is_fallback: e.target.checked })} /> 设为备用
            </label>
          </div>
        </div>
      </Modal>

      <Modal open={bindOpen} title="绑定科研任务模型" description="严格使用所选模型；自动路由默认关闭，开启后也只在授权模型中选择。"
        onClose={() => setBindOpen(false)}
        footer={<>
          <button type="button" className="btn-ghost" onClick={() => setBindOpen(false)}>取消</button>
          <button type="button" className="btn-primary" disabled={upsertBinding.isPending || !bindForm.primary_profile_id}
            onClick={() => upsertBinding.mutate({
              task_key: bindForm.task_key, primary_profile_id: bindForm.primary_profile_id,
              fallback_profile_id: bindForm.fallback_profile_id || undefined,
              auto_route: bindForm.auto_route, cost_preference: bindForm.cost_preference,
            })}>
            {upsertBinding.isPending ? <Icon name="loader" size="sm" className="animate-spin" /> : <Icon as={Link2} size="sm" />} 保存绑定
          </button>
        </>}>
        <div className="rc-we-stack-tight">
          <label className="block"><span className="field-label">科研任务</span>
            <select className="field-input" value={bindForm.task_key}
              onChange={(e) => setBindForm({ ...bindForm, task_key: e.target.value })}>
              {Object.entries(TASK_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="block"><span className="field-label">主模型</span>
            <select className="field-input" value={bindForm.primary_profile_id}
              onChange={(e) => setBindForm({ ...bindForm, primary_profile_id: e.target.value })}>
              <option value="">请选择</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.model_id} · {p.model_id}</option>)}
            </select>
          </label>
          <label className="block"><span className="field-label">备用模型（可选）</span>
            <select className="field-input" value={bindForm.fallback_profile_id}
              onChange={(e) => setBindForm({ ...bindForm, fallback_profile_id: e.target.value })}>
              <option value="">— 不设置 —</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.display_name || p.model_id} · {p.model_id}</option>)}
            </select>
          </label>
          <label className="block"><span className="field-label">成本偏好</span>
            <select className="field-input" value={bindForm.cost_preference}
              onChange={(e) => setBindForm({ ...bindForm, cost_preference: e.target.value })}>
              <option value="balanced">均衡</option><option value="quality">优先质量</option>
              <option value="cost">优先低成本</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={bindForm.auto_route}
              onChange={(e) => setBindForm({ ...bindForm, auto_route: e.target.checked })} />
            开启自动路由（默认关闭；仅记录决策原因，不静默换供应商）
          </label>
          <p className="flex items-center gap-2 text-xs text-ink-muted">
            <Icon as={RotateCcw} size="xs" /> 模型生成的推断不会直接写入已验证事实，关键结论仍需证据验证。
          </p>
        </div>
      </Modal>

      {credTestId && (
        <div className="rc-we-row" style={{ fontSize: 'var(--rc-fs-caption)', color: 'var(--rc-text-muted)' }}>
          <Icon name="loader" size="xs" className="animate-spin" />
          正在对凭据 {credName(credTestId)} 发起真实连接测试…
        </div>
      )}
    </div>
  )
}
