import { useMutation } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowRight,
  BookOpenCheck,
  FlaskConical,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ScanSearch,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'

const DEMO_ACCOUNTS = [
  { role: '项目负责人', name: '林晚晴', email: 'lead@reprocheck.demo' },
  { role: '研究员', name: '陈叙', email: 'researcher@reprocheck.demo' },
  { role: '复核员', name: '沈知微', email: 'reviewer@reprocheck.demo' },
  { role: '观察者', name: '顾远', email: 'viewer@reprocheck.demo' },
]
const DEMO_PASSWORD = 'ReproCheck#2026'

const FEATURES = [
  { icon: Users, title: '组织 · 团队 · RBAC', text: '组织隔离、项目角色与权限矩阵，重要操作全程留痕。' },
  { icon: BookOpenCheck, title: '科研复现基准库', text: '标准化事实与四级质量阶梯，等级只由验证证据计算。' },
  { icon: FlaskConical, title: '规则生命周期', text: '版本、测试、离线评估与回滚，单条反馈绝不自动改规则。' },
  { icon: ShieldCheck, title: '受控 RAG 与治理', text: '当前证据永远优先；数据分级、AI 授权与本人数据导出。' },
]

export default function LoginPage() {
  const token = useAuthStore((state) => state.token)
  const setSession = useAuthStore((state) => state.setSession)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [formError, setFormError] = useState('')

  const authMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'register') {
        return stage6Api.register({ email, password, display_name: displayName })
      }
      return stage6Api.login({ email, password })
    },
    onSuccess: (data) => {
      setSession(data.token, data.user)
      navigate(from, { replace: true })
    },
    onError: (error) => {
      setFormError(error instanceof ApiError ? error.message : '请求失败，请稍后重试。')
    },
  })

  if (token) {
    return <Navigate to={from} replace />
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setFormError('')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setFormError('请输入有效的邮箱地址。')
      return
    }
    if (password.length < 8) {
      setFormError('密码至少 8 位。')
      return
    }
    authMutation.mutate()
  }

  const fillDemo = (demoEmail: string) => {
    setMode('login')
    setEmail(demoEmail)
    setPassword(DEMO_PASSWORD)
    setFormError('')
  }

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* 品牌区 */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-navy-950 p-10 text-white lg:flex xl:p-14">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(720px 420px at 12% -8%, rgba(46,107,255,0.34), transparent 62%), radial-gradient(560px 380px at 108% 22%, rgba(26,127,82,0.22), transparent 60%), radial-gradient(640px 420px at 40% 118%, rgba(30,79,209,0.28), transparent 64%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />

        <div className="relative">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-accent shadow-pop">
              <ScanSearch size={24} strokeWidth={2} />
            </div>
            <div>
              <p className="text-lg font-semibold tracking-tight">ReproCheck</p>
              <p className="text-xs text-white/55">科研复现审计官 · 团队协作平台</p>
            </div>
          </div>

          <h1 className="mt-12 max-w-md text-[32px] font-semibold leading-[1.25] tracking-tight xl:text-4xl">
            让每一次复现审计，
            <br />
            <span className="text-accent-soft">都有证据、有角色、有留痕。</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-white/60">
            第六阶段将单机审计工具升级为团队协作平台：组织与项目双层隔离、基准案例质量阶梯、
            规则版本治理与受控知识检索，全部操作写入不可覆盖的审计轨迹。
          </p>

          <ul className="mt-10 space-y-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon
              return (
                <li key={feature.title} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/[0.08] ring-1 ring-white/10">
                    <Icon size={16} strokeWidth={1.9} className="text-accent-soft" />
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{feature.title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-white/55">{feature.text}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>

        <div className="relative mt-10 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
          <p className="flex items-center gap-2 text-xs font-medium text-white/75">
            <Lock size={13} className="text-accent-soft" />
            安全约定
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-white/50">
            密钥与令牌仅在后端加密保存，绝不回显明文；非项目成员访问一律 404；
            AI 与客户端都不能直接设置案例质量等级。
          </p>
        </div>
      </div>

      {/* 表单区 */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-dark">
              <ScanSearch size={21} />
            </div>
            <div>
              <p className="text-base font-semibold">ReproCheck</p>
              <p className="text-xs text-ink-subtle">科研复现审计官 · 团队协作平台</p>
            </div>
          </div>

          <div className="panel px-6 py-7 sm:px-8">
            <div className="flex rounded-md bg-canvas p-1">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setFormError('')
                  }}
                  className={`flex-1 rounded px-3 py-2 text-sm font-medium transition-colors ${
                    mode === m ? 'bg-surface text-ink shadow-panel' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {m === 'login' ? '登录' : '注册新账户'}
                </button>
              ))}
            </div>

            <h2 className="mt-6 text-lg font-semibold">
              {mode === 'login' ? '欢迎回来' : '创建账户'}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {mode === 'login'
                ? '登录后进入团队工作台，数据按组织与项目隔离。'
                : '注册即自动创建个人工作空间，可立即创建项目。'}
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="auth-email" className="field-label">邮箱</label>
                <div className="relative">
                  <Mail size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                  <input
                    id="auth-email"
                    type="email"
                    autoComplete="email"
                    className="field-input pl-9"
                    placeholder="you@lab.edu"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {mode === 'register' && (
                <div>
                  <label htmlFor="auth-name" className="field-label">显示名称（可选）</label>
                  <div className="relative">
                    <UserRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                      id="auth-name"
                      type="text"
                      className="field-input pl-9"
                      placeholder="例如：林晚晴"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="auth-password" className="field-label">密码</label>
                <div className="relative">
                  <KeyRound size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                  <input
                    id="auth-password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    className="field-input pl-9"
                    placeholder="至少 8 位"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </div>

              {formError && (
                <div className="flex items-start gap-2 rounded-md border border-danger/25 bg-danger-wash px-3 py-2.5" role="alert">
                  <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" />
                  <p className="text-xs leading-relaxed text-danger">{formError}</p>
                </div>
              )}

              <button type="submit" className="btn-primary w-full justify-center" disabled={authMutation.isPending}>
                {authMutation.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <ArrowRight size={16} />
                )}
                {mode === 'login' ? '登录工作台' : '注册并进入'}
              </button>
            </form>
          </div>

          <div className="panel mt-4 px-6 py-5">
            <p className="text-xs font-semibold text-ink">演示账户（种子数据）</p>
            <p className="mt-0.5 text-[11px] text-ink-subtle">
              点击自动填充，密码统一为 <span className="mono">{DEMO_PASSWORD}</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => fillDemo(account.email)}
                  className={`rounded-md border px-3 py-2 text-left transition-colors ${
                    email === account.email
                      ? 'border-accent bg-accent-wash'
                      : 'border-line bg-surface hover:border-accent/50 hover:bg-canvas'
                  }`}
                >
                  <p className="text-xs font-semibold text-ink">{account.name}</p>
                  <p className="mt-0.5 text-[10px] text-ink-subtle">{account.role}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}