import type { LucideIcon } from 'lucide-react'
import { useEffect } from 'react'
import {
  BookOpenCheck,
  Building2,
  ChartNoAxesCombined,
  ClipboardList,
  Cpu,
  FileSearch,
  Files,
  FlaskConical,
  FolderKanban,
  GitCompare,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareMore,
  Network,
  Plug,
  ScanSearch,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Users,
  X,
} from 'lucide-react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { stage6Api } from '../services/stage6Api'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import { Toaster } from './Toaster'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  title: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', icon: LayoutDashboard, title: '工作台' },
  { to: '/projects', label: '项目', icon: FolderKanban, title: '项目' },
  { to: '/settings/llm', label: 'AI 模型服务', icon: Cpu, title: 'AI 模型服务' },
  { to: '/demo/audit', label: '审计演示', icon: FlaskConical, title: '审计演示' },
]

const COLLAB_ITEMS: NavItem[] = [
  { to: '/orgs', label: '组织与成员', icon: Building2, title: '组织与成员' },
  { to: '/roles', label: '角色权限', icon: ShieldCheck, title: '角色权限' },
]

const BENCHMARK_ITEMS: NavItem[] = [
  { to: '/benchmark', label: '基准案例库', icon: BookOpenCheck, title: '基准案例库' },
  { to: '/fact-schema', label: '事实字段目录', icon: FileSearch, title: '事实字段目录' },
  { to: '/rules', label: '审计规则', icon: ScrollText, title: '审计规则' },
  { to: '/feedback', label: '反馈治理', icon: MessageSquareMore, title: '反馈治理' },
  { to: '/knowledge', label: '知识检索', icon: Sparkles, title: '知识检索' },
]

const GOVERNANCE_ITEMS: NavItem[] = [
  { to: '/integrations', label: '外部集成', icon: Plug, title: '外部集成' },
  { to: '/api-tokens', label: 'API 令牌', icon: KeyRound, title: 'API 令牌' },
  { to: '/governance', label: '数据治理', icon: ShieldCheck, title: '数据治理' },
]

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/projects/new')) return '新建项目'
  if (/^\/materials\/[^/]+/.test(pathname)) return '材料详情'
  if (/\/projects\/[^/]+\/materials/.test(pathname)) return '材料管理'
  if (/\/projects\/[^/]+\/tasks/.test(pathname)) return '解析任务'
  if (/\/projects\/[^/]+\/evidence-graph/.test(pathname)) return '科研结论证据图谱'
  if (/\/projects\/[^/]+\/facts/.test(pathname)) return '科研事实'
  if (/\/projects\/[^/]+\/overview/.test(pathname)) return '解析概览'
  if (/\/projects\/[^/]+\/verification/.test(pathname)) return '项目验证'
  if (/\/projects\/[^/]+\/handoff/.test(pathname)) return '交接包'
  if (/\/projects\/[^/]+\/team/.test(pathname)) return '项目团队'
  if (/\/projects\/[^/]+\/reproduction\/environment/.test(pathname)) return '复现环境'
  if (/\/projects\/[^/]+\/reproduction\/comparison/.test(pathname)) return '结果对照'
  if (/\/projects\/[^/]+\/reproduction\/diagnostics/.test(pathname)) return 'AI 诊断'
  if (/\/projects\/[^/]+\/reproduction\/reports/.test(pathname)) return '报告中心'
  if (/\/projects\/[^/]+\/reproduction/.test(pathname)) return '复现总览'
  if (/^\/reproductions\/plans\/[^/]+/.test(pathname)) return '复现规划 DAG'
  if (/^\/reproductions\/runs\/[^/]+/.test(pathname)) return '执行控制台'
  if (/^\/benchmark\/[^/]+/.test(pathname)) return '案例详情'
  const all = [...NAV_ITEMS, ...COLLAB_ITEMS, ...BENCHMARK_ITEMS, ...GOVERNANCE_ITEMS]
  const match = all.find(
    (item) => item.to === pathname || (item.to !== '/' && pathname.startsWith(item.to)),
  )
  return match?.title ?? '工作台'
}

/** 侧栏「材料解析」分组的链接；无最近项目时引导到项目列表选择。 */
function stage2NavItems(lastProjectId: string | null): NavItem[] {
  const to = (suffix: string) =>
    lastProjectId ? `/projects/${lastProjectId}/${suffix}` : '/projects'
  return [
    { to: to('materials'), label: '材料管理', icon: Files, title: '材料管理' },
    { to: to('tasks'), label: '解析任务', icon: ListChecks, title: '解析任务' },
    { to: to('facts'), label: '科研事实', icon: ClipboardList, title: '科研事实' },
    { to: to('evidence-graph'), label: '证据图谱', icon: Network, title: '科研结论证据图谱' },
    { to: to('overview'), label: '解析概览', icon: ChartNoAxesCombined, title: '解析概览' },
  ]
}

/** 侧栏「能力驾驶舱」分组；无最近项目时退化为项目列表，沿用现有模式。 */
function stage9NavItems(lastProjectId: string | null): NavItem[] {
  const to = (suffix: string) =>
    lastProjectId ? `/projects/${lastProjectId}/${suffix}` : '/projects'
  return [
    {
      to: to('verification'),
      label: '项目验证',
      icon: ShieldCheck,
      title: lastProjectId ? '项目验证' : '请先在「项目」中选择一个项目',
    },
    {
      to: to('handoff'),
      label: '交接包',
      icon: Files,
      title: lastProjectId ? '交接包' : '请先在「项目」中选择一个项目',
    },
  ]
}

/** 侧栏「复现验证」分组；规划/控制台优先直达最近访问的具体对象。 */
function stage4NavItems(
  lastProjectId: string | null,
  lastPlanId: string | null,
  lastRunId: string | null,
): NavItem[] {
  const project = (suffix: string) =>
    lastProjectId ? `/projects/${lastProjectId}/reproduction${suffix}` : '/projects'
  const overview = project('')
  return [
    { to: overview, label: '总览', icon: LayoutDashboard, title: '复现总览' },
    {
      to: lastPlanId ? `/reproductions/plans/${lastPlanId}` : overview,
      label: '规划',
      icon: Network,
      title: lastPlanId ? '复现规划 DAG' : '请先从总览选择一个规划',
    },
    { to: project('/environment'), label: '环境', icon: Server, title: '复现环境' },
    {
      to: lastRunId ? `/reproductions/runs/${lastRunId}` : overview,
      label: '控制台',
      icon: Terminal,
      title: lastRunId ? '执行控制台' : '请先从总览或规划选择一个运行',
    },
    { to: project('/comparison'), label: '结果对照', icon: GitCompare, title: '结果对照' },
    { to: project('/diagnostics'), label: 'AI 诊断', icon: Sparkles, title: 'AI 诊断' },
    { to: project('/reports'), label: '报告中心', icon: Files, title: '报告中心' },
  ]
}

function NavGroup({ label, items, hint, onNavigate }: {
  label: string
  items: NavItem[]
  hint?: string
  onNavigate: () => void
}) {
  return (
    <>
      <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
        {label}
      </p>
      {hint && <p className="px-3 pb-2 text-[11px] leading-snug text-white/45">{hint}</p>}
      <ul className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          return (
            <li key={item.label}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                title={item.title}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `relative flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-[transform,background-color] hover:scale-[1.02] ${
                    isActive
                      ? 'bg-accent text-accent-dark'
                      : 'text-white/70 hover:bg-white/[0.08] hover:text-white'
                  }`
                }
              >
                <Icon size={18} strokeWidth={1.8} className="shrink-0" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </>
  )
}

export default function AppLayout() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)
  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const lastPlanId = useUIStore((state) => state.lastPlanId)
  const lastRunId = useUIStore((state) => state.lastRunId)
  const user = useAuthStore((state) => state.user)
  const orgs = useAuthStore((state) => state.orgs)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const location = useLocation()
  const pageTitle = getPageTitle(location.pathname)
  useEffect(() => {
    document.querySelector('aside nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [location.pathname])
  const stage2Items = stage2NavItems(lastProjectId)
  const stage4Items = stage4NavItems(lastProjectId, lastPlanId, lastRunId)
  const stage9Items = stage9NavItems(lastProjectId)
  const teamItem: NavItem = {
    to: lastProjectId ? `/projects/${lastProjectId}/team` : '/projects',
    label: '项目团队',
    icon: Users,
    title: lastProjectId ? '项目团队' : '请先在「项目」中选择一个项目',
  }
  const today = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

  const handleLogout = async () => {
    try {
      await stage6Api.logout()
    } catch {
      /* 退出留痕失败不阻断本地会话清理 */
    }
    logout()
    navigate('/login', { replace: true })
  }

  const initial = (user?.display_name || user?.email || '?').slice(0, 1).toUpperCase()

  return (
    <div className="min-h-screen bg-canvas">
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          className="fixed inset-0 z-30 bg-navy-950/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col bg-navy-900 text-white transition-transform duration-200 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-white/10 px-5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-dark">
            <ScanSearch size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-black tracking-tight">ReproCheck</p>
            <p className="truncate text-[11px] text-white/55">科研复现审计官</p>
          </div>
          <button
            type="button"
            className="ml-auto text-white/60 lg:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭导航"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5">
          <NavGroup label="导航" items={NAV_ITEMS} onNavigate={() => setSidebarOpen(false)} />
          <NavGroup
            label="材料解析"
            items={stage2Items}
            hint={lastProjectId ? undefined : '请先在「项目」中选择一个项目'}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup
            label="复现验证"
            items={stage4Items}
            hint={lastProjectId ? undefined : '请先在「项目」中选择一个项目'}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup
            label="能力驾驶舱"
            items={stage9Items}
            hint={lastProjectId ? undefined : '请先在「项目」中选择一个项目'}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup
            label="团队协作"
            items={[...COLLAB_ITEMS, teamItem]}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup label="基准与知识" items={BENCHMARK_ITEMS} onNavigate={() => setSidebarOpen(false)} />
          <NavGroup label="集成与治理" items={GOVERNANCE_ITEMS} onNavigate={() => setSidebarOpen(false)} />
        </nav>

        <div className="shrink-0 border-t border-white/10 px-5 py-4">
          <p className="mono text-[10px] text-white/40">API /api/v1 · 第六阶段</p>
          <p className="mt-1 text-[11px] leading-snug text-white/45">密钥仅在后端读取与保存</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface/90 backdrop-blur px-4 sm:px-6">
          <button
            type="button"
            className="rounded p-1.5 text-ink-muted hover:bg-canvas lg:hidden"
            onClick={() => setSidebarOpen(true)}
            aria-label="打开导航"
          >
            <Menu size={20} />
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-ink-subtle">
              <span>ReproCheck</span>
              <span className="text-line">/</span>
              <span className="truncate">{pageTitle}</span>
            </div>
            <h1 className="truncate text-xl font-black leading-none tracking-tight">{pageTitle}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-xs text-ink-subtle xl:inline">{today}</span>
            <span className="hidden h-4 w-px bg-line xl:inline-block" />
            {user && (
              <div className="flex items-center gap-2.5">
                <div className="hidden min-w-0 text-right sm:block">
                  <p className="truncate text-xs font-semibold leading-tight text-ink">
                    {user.display_name || user.email}
                  </p>
                  <p className="truncate text-[10px] leading-tight text-ink-subtle">
                    {orgs[0]?.name ?? (user.is_platform_admin ? '平台管理员' : '个人工作空间')}
                  </p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-dark">
                  {initial}
                </span>
                <button
                  type="button"
                  className="rounded-full border border-line p-2 text-ink-muted transition-colors hover:border-danger/40 hover:bg-danger-wash hover:text-danger"
                  onClick={() => void handleLogout()}
                  title="退出登录"
                  aria-label="退出登录"
                >
                  <LogOut size={15} />
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
      <Toaster />
    </div>
  )
}