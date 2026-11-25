/**
 * ReproCheck · 极简空间登录 / 注册页
 * 以精密轨道动效与建筑感留白替代大段功能宣讲，聚焦登录与快速体验。
 */
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, Mail, ScanSearch, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { ThemeToggle } from '../../components/ThemeToggle'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'
import '../../styles/rc-unified.css'

const DEMO_ACCOUNTS = [
  { role: '负责人', name: '林晚晴', email: 'lead@reprocheck.demo' },
  { role: '研究员', name: '陈叙', email: 'researcher@reprocheck.demo' },
  { role: '复核员', name: '沈知微', email: 'reviewer@reprocheck.demo' },
  { role: '观察者', name: '顾远', email: 'viewer@reprocheck.demo' },
]
const DEMO_PASSWORD = 'ReproCheck#2026'

const ORBIT_NODES = [
  { icon: 'file' as const, label: '论文' },
  { icon: 'database' as const, label: '数据' },
  { icon: 'terminal' as const, label: '运行' },
  { icon: 'network' as const, label: '证据' },
  { icon: 'shield' as const, label: '裁决' },
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
    <div className="rc-auth-stage">
      <div className="rc-auth-topbar">
        <ThemeToggle />
      </div>

      <div className="rc-auth-layout">
        <section className="rc-auth-brand" aria-label="ReproCheck">
          <div className="rc-auth-logo">
            <span className="rc-auth-logomark">
              <Icon as={ScanSearch} size="md" />
            </span>
            <div>
              <p className="rc-auth-brandname">ReproCheck</p>
              <p className="rc-auth-brandsub">科研复现审计官</p>
            </div>
          </div>

          <div className="rc-auth-orbit" aria-hidden="true">
            <span className="rc-auth-orbit-sweep" />
            {ORBIT_NODES.map((node, index) => (
              <span
                key={node.label}
                className={`rc-auth-orbit-node rc-auth-orbit-node--${'abcde'[index]}`}
                title={node.label}
              >
                <Icon name={node.icon} size="sm" />
              </span>
            ))}
            <div className="rc-auth-orbit-disc">
              <div className="rc-auth-orbit-copy">
                <span className="rc-auth-orbit-name">ReproCheck</span>
                <span className="rc-auth-orbit-sub">EVIDENCE · VERIFY</span>
              </div>
            </div>
          </div>

          <div className="rc-auth-pills" aria-hidden="true">
            <span>证据溯源</span>
            <span>交叉核对</span>
            <span>可复核裁决</span>
          </div>
        </section>

        <section className="rc-auth-panel" aria-label="登录或注册 ReproCheck">
          <div className="rc-auth-panel-inner">
            <div className="rc-auth-mobilebrand">
              <span className="rc-auth-logomark">
                <Icon as={ScanSearch} size="md" />
              </span>
              <div>
                <p className="rc-auth-brandname">ReproCheck</p>
                <p className="rc-auth-brandsub">科研复现审计官</p>
              </div>
            </div>

            <div className="rc-auth-card">
              <div
                className="rc-auth-switch"
                data-mode={mode}
                role="group"
                aria-label="登录或注册"
              >
                <span className="rc-auth-switch-thumb" aria-hidden="true" />
                {(['login', 'register'] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={mode === item}
                    className="rc-auth-switchbtn"
                    onClick={() => {
                      setMode(item)
                      setFormError('')
                    }}
                  >
                    {item === 'login' ? '登录' : '注册'}
                  </button>
                ))}
              </div>

              <h1 className="rc-auth-title">
                {mode === 'login' ? '进入工作台' : '创建工作空间'}
              </h1>

              <form onSubmit={submit} className="rc-auth-form">
                <div>
                  <label htmlFor="auth-email" className="field-label">邮箱</label>
                  <div className="rc-auth-fieldwrap">
                    <Icon as={Mail} size="sm" className="rc-auth-fieldicon" />
                    <input
                      id="auth-email"
                      type="email"
                      autoComplete="email"
                      className="rc-auth-input"
                      placeholder="you@lab.edu"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      required
                    />
                  </div>
                </div>

                {mode === 'register' && (
                  <div className="rc-auth-reveal">
                    <label htmlFor="auth-name" className="field-label">称呼（可选）</label>
                    <div className="rc-auth-fieldwrap">
                      <Icon as={UserRound} size="sm" className="rc-auth-fieldicon" />
                      <input
                        id="auth-name"
                        type="text"
                        className="rc-auth-input"
                        placeholder="林晚晴"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label htmlFor="auth-password" className="field-label">密码</label>
                  <div className="rc-auth-fieldwrap">
                    <Icon name="key" size="sm" className="rc-auth-fieldicon" />
                    <input
                      id="auth-password"
                      type="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      className="rc-auth-input"
                      placeholder="至少 8 位"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      required
                      minLength={8}
                    />
                  </div>
                </div>

                {formError && (
                  <div className="rc-auth-alert" role="alert">
                    <Icon name="alert" size="sm" />
                    <p>{formError}</p>
                  </div>
                )}

                <button
                  type="submit"
                  className="btn-primary mt-1 w-full justify-center"
                  disabled={authMutation.isPending}
                >
                  {authMutation.isPending ? (
                    <Icon name="loader" size="sm" className="animate-spin" />
                  ) : (
                    <Icon as={ArrowRight} size="sm" />
                  )}
                  {mode === 'login' ? '登录' : '注册并进入'}
                </button>
              </form>

              <div className="rc-auth-demo-inline">
                <div className="rc-auth-demo-head">
                  <span>演示账号</span>
                  <span className="mono">{DEMO_PASSWORD}</span>
                </div>
                <div className="rc-auth-demogrid">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      type="button"
                      onClick={() => fillDemo(account.email)}
                      aria-pressed={email === account.email}
                      className="rc-auth-demobtn"
                    >
                      <span className="rc-auth-demobtn-name">{account.name}</span>
                      <span className="rc-auth-demobtn-role">{account.role}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
