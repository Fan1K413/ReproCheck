/**
 * V3 · 原生登录 / 注册页
 *
 * 设计基准与 / 主工作台一致：紫黑折叠场、玻璃圆盘、精密轨道与空间浮层。
 * 全部为 React + CSS + SVG 原生实现；不使用旧 UI 截图或静态图片冒充界面。
 * 业务保持不变：登录 / 注册、真实接口、表单校验、演示账号一键填充。
 */
import { useMutation } from '@tanstack/react-query'
import {
  ArrowRight,
  BookOpenCheck,
  FlaskConical,
  Mail,
  ScanSearch,
  ShieldCheck,
  UserRound,
  Users,
} from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Icon } from '../../components/Icon'
import { ApiError } from '../../services/api'
import { stage6Api } from '../../services/stage6Api'
import { useAuthStore } from '../../stores/authStore'
import '../../styles/rc-unified.css'

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

const ORBIT_ICONS = ['sparkles', 'folder', 'file', 'network', 'settings'] as const

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
      <div className="rc-auth-layout">
        <section className="rc-auth-brand" aria-label="ReproCheck 能力说明">
          <div className="rc-auth-logo">
            <span className="rc-auth-logomark">
              <Icon as={ScanSearch} size="lg" />
            </span>
            <div>
              <p className="rc-auth-brandname">ReproCheck</p>
              <p className="rc-auth-brandsub">科研复现审计官 · 团队协作平台</p>
            </div>
          </div>

          <div className="rc-auth-orbit" aria-hidden="true">
            {ORBIT_ICONS.map((icon, index) => (
              <span key={icon} className={`rc-auth-orbit-node rc-auth-orbit-node--${'abcde'[index]}`}>
                <Icon name={icon} size="sm" />
              </span>
            ))}
            <div className="rc-auth-orbit-disc">
              <div className="rc-auth-orbit-copy">
                <span className="rc-auth-orbit-sub">审计工作台</span>
                <span className="rc-auth-orbit-name">ReproCheck</span>
                <span className="rc-auth-orbit-sub">证据 · 角色 · 追溯</span>
              </div>
            </div>
          </div>

          <ul className="rc-auth-claims">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="rc-auth-claim">
                <span className="rc-auth-claim-icon">
                  <Icon as={feature.icon} size="sm" />
                </span>
                <div className="min-w-0">
                  <p className="rc-auth-claim-title">{feature.title}</p>
                  <p className="rc-auth-claim-text">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
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
              <div className="rc-auth-switch" role="group" aria-label="登录或注册">
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
                    {item === 'login' ? '登录' : '注册新账户'}
                  </button>
                ))}
              </div>

              <h1 className="rc-auth-title">
                {mode === 'login' ? '回到审计工作台' : '创建科研工作空间'}
              </h1>
              <p className="rc-auth-sub">
                {mode === 'login'
                  ? '登录后进入团队工作台，项目、材料与证据按组织隔离。'
                  : '注册会创建个人组织，可立即建立第一个复现审计项目。'}
              </p>

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
                  <div>
                    <label htmlFor="auth-name" className="field-label">显示名称（可选）</label>
                    <div className="rc-auth-fieldwrap">
                      <Icon as={UserRound} size="sm" className="rc-auth-fieldicon" />
                      <input
                        id="auth-name"
                        type="text"
                        className="rc-auth-input"
                        placeholder="例如：林晚晴"
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

                <button type="submit" className="btn-primary w-full justify-center" disabled={authMutation.isPending}>
                  {authMutation.isPending ? (
                    <Icon name="loader" size="sm" className="animate-spin" />
                  ) : (
                    <Icon as={ArrowRight} size="sm" />
                  )}
                  {mode === 'login' ? '登录工作台' : '注册并进入'}
                </button>
              </form>
            </div>

            <div className="rc-auth-demo">
              <p className="rc-auth-demo-title">演示账户（种子数据）</p>
              <p className="rc-auth-demo-text">
                点击自动填充，密码统一为 <span className="mono">{DEMO_PASSWORD}</span>
              </p>
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
        </section>
      </div>
    </div>
  )
}
