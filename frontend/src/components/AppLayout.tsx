import type { LucideIcon } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
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
  Grid2X2,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListTree,
  LogOut,
  MessageSquareMore,
  Network,
  Orbit,
  Plug,
  Radar,
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
import AllFeaturesPopover from '../workbench/AllFeaturesPopover'
import { consumeRouteNotice, ENTRIES, setRouteNotice } from '../workbench/EntryLauncher'
import NextStepCard from '../ux/NextStepCard'
import PageHelpButton from '../ux/PageHelpDrawer'
import { Icon } from './Icon'
import { Toaster } from './Toaster'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  title: string
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', icon: LayoutDashboard, title: '工作台' },
  { to: '/?what=1', label: '我想做什么', icon: Sparkles, title: '按任务找下一步' },
  { to: '/projects', label: '项目档案', icon: FolderKanban, title: '项目档案' },
  { to: '/start/reproduce', label: '四步复现引导', icon: Sparkles, title: '四步复现引导' },
  { to: '/settings/models?tab=setup', label: '连接 AI 助手', icon: Cpu, title: '连接 AI 助手' },
  { to: '/settings/llm', label: '系统 AI 状态', icon: Server, title: '系统 AI 状态' },
  { to: '/manual', label: '中文使用手册', icon: BookOpenCheck, title: '中文使用手册' },
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
  if (pathname === '/start/reproduce') return '四步复现引导'
  if (pathname === '/manual') return '中文使用手册'
  if (pathname === '/settings/models') return '连接 AI 助手'
  if (pathname === '/settings/llm') return '系统 AI 状态'
  if (pathname === '/stats-audit') return '统计学审计'
  if (/\/projects\/[^/]+\/workbench/.test(pathname)) return '项目总览图'
  if (/^\/materials\/[^/]+/.test(pathname)) return '材料详情'
  if (/\/projects\/[^/]+\/materials/.test(pathname)) return '论文与材料'
  if (/\/projects\/[^/]+\/tasks/.test(pathname)) return '自动处理任务'
  if (/\/projects\/[^/]+\/evidence-graph/.test(pathname)) return '证据关系图'
  if (/\/projects\/[^/]+\/facts/.test(pathname)) return '科研事实'
  if (/\/projects\/[^/]+\/overview/.test(pathname)) return '解析概览'
  if (/\/projects\/[^/]+\/verification/.test(pathname)) return '项目验证'
  if (/\/projects\/[^/]+\/handoff/.test(pathname)) return '交接包'
  if (/\/projects\/[^/]+\/data-audit/.test(pathname)) return '数据质量检查'
  if (/\/projects\/[^/]+\/experiments\/diff/.test(pathname)) return '实验差异分析'
  if (/\/projects\/[^/]+\/change-monitor/.test(pathname)) return '项目变化监控'
  if (/\/projects\/[^/]+\/team/.test(pathname)) return '项目团队'
  if (/\/projects\/[^/]+\/reproduction\/environment/.test(pathname)) return '实验环境'
  if (/\/projects\/[^/]+\/reproduction\/comparison/.test(pathname)) return '结果对照'
  if (/\/projects\/[^/]+\/reproduction\/diagnostics/.test(pathname)) return 'AI 诊断'
  if (/\/projects\/[^/]+\/reproduction\/reports/.test(pathname)) return '审计报告'
  if (/\/projects\/[^/]+\/reproduction/.test(pathname)) return '复现总览'
  if (/^\/reproductions\/plans\/[^/]+/.test(pathname)) return '复现步骤清单'
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
    {
      to: to('workbench'),
      label: '项目总览图',
      icon: Orbit,
      title: lastProjectId ? '项目总览图' : '请先在「项目」中选择一个项目',
    },
    { to: to('materials'), label: '论文与材料', icon: Files, title: '论文与材料' },
    { to: to('tasks'), label: '自动处理任务', icon: ListChecks, title: '自动处理任务' },
    { to: to('facts'), label: '科研事实', icon: ClipboardList, title: '科研事实' },
    { to: to('evidence-graph'), label: '证据关系图', icon: Network, title: '科研结论证据图谱' },
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
    {
      to: to('experiments/diff'),
      label: '实验差异分析',
      icon: GitCompare,
      title: lastProjectId ? '实验差异分析' : '请先在「项目」中选择一个项目',
    },
    {
      to: to('change-monitor'),
      label: '变化监控',
      icon: Radar,
      title: lastProjectId ? '变化监控' : '请先在「项目」中选择一个项目',
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
    { to: overview, label: '复现总览', icon: LayoutDashboard, title: '复现总览' },
    {
      to: lastPlanId ? `/reproductions/plans/${lastPlanId}` : overview,
      label: '步骤清单',
      icon: Network,
      title: lastPlanId ? '复现步骤清单' : '请先从总览选择一个规划',
    },
    { to: project('/environment'), label: '实验环境', icon: Server, title: '实验环境' },
    {
      to: lastRunId ? `/reproductions/runs/${lastRunId}` : overview,
      label: '执行',
      icon: Terminal,
      title: lastRunId ? '执行控制台' : '请先从总览或规划选择一个运行',
    },
    { to: project('/comparison'), label: '结果对照', icon: GitCompare, title: '结果对照' },
    { to: project('/diagnostics'), label: 'AI 诊断', icon: Sparkles, title: 'AI 诊断' },
    { to: project('/reports'), label: '审计报告', icon: Files, title: '审计报告' },
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
      <p
        className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: 'var(--rc-text-subtle)' }}
      >
        {label}
      </p>
      {hint && (
        <p className="px-3 pb-2 text-[11px] leading-snug" style={{ color: 'var(--rc-text-subtle)' }}>
          {hint}
        </p>
      )}
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.label}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              title={item.title}
              onClick={onNavigate}
              className={({ isActive }) =>
                `relative flex items-center gap-3 rounded-full px-4 py-2.5 text-sm font-semibold transition-[transform,background-color,color] hover:scale-[1.02] ${
                  isActive
                    ? 'bg-[var(--rc-accent)] text-[color:var(--rc-hi)]'
                    : 'text-[color:var(--rc-text-muted)] hover:bg-[var(--rc-accent-wash)] hover:text-[color:var(--rc-text)]'
                }`
              }
            >
              <Icon as={item.icon} size="sm" />
              <span className="truncate">{item.label}</span>
            </NavLink>
          </li>
        ))}
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
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const lastNoticePath = useRef<string | null>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement>(null)
  // V3 统一深色空间体系：历史浅色皮肤已移除。这里仍监听页面可能声明的皮肤，
  // 兼容未来局部预览；当前所有 L2 页面默认与主工作台保持同一视觉语义。
  const [pageSkin, setPageSkin] = useState<'light' | null>(null)

  // useLayoutEffect：在首次绘制前就把皮肤镜像到布局根，避免"深色顶栏闪一帧"。
  useLayoutEffect(() => {
    const mainEl = document.querySelector('main')
    if (!mainEl) {
      setPageSkin(null)
      return
    }
    const read = () => {
      // 页面级皮肤优先取 main 的直接子节点（路由页根容器），
      // 取不到再退一步找子树内第一个皮肤标记。
      const direct = mainEl.firstElementChild as HTMLElement | null
      const owner =
        (direct?.getAttribute('data-rc-skin') ? direct : null) ??
        (direct?.querySelector<HTMLElement>('[data-rc-skin]') ?? null)
      setPageSkin(owner?.getAttribute('data-rc-skin') === 'light' ? 'light' : null)
    }
    read()
    const raf = window.requestAnimationFrame(read)
    // 少数页面先渲染加载态、数据就绪后才挂皮肤，补一次延迟复核。
    const timer = window.setTimeout(read, 320)
    return () => {
      window.cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
  }, [location.pathname])

  useEffect(() => {
    document.querySelector('aside nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [location.pathname])

  // 抽屉是 L3：打开时焦点进入，关闭后归还「目录」按钮（交互规范 §1.4）
  useEffect(() => {
    if (!sidebarOpen) return
    drawerRef.current?.querySelector<HTMLElement>('nav a')?.focus({ preventScroll: true })
    return () => drawerTriggerRef.current?.focus?.({ preventScroll: true })
  }, [sidebarOpen])

  // 工作台无项目上下文时的降级提示，跳到 L2 后在页内顶部显示一次。
  // 按路径去重，避免 StrictMode 双次执行 effect 时把提示吃掉。
  useEffect(() => {
    if (lastNoticePath.current === location.pathname) return
    lastNoticePath.current = location.pathname
    const message = consumeRouteNotice()
    setNotice(message)
    if (!message) return
    const timer = window.setTimeout(() => setNotice(null), 5200)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  const returnToWorkbench = () => {
    setRouteNotice(undefined)
    setFeaturesOpen(false)
    setSidebarOpen(false)
    navigate('/')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || featuresOpen) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      // 页面自己打开的 L3 浮层优先处理 Esc；目录抽屉自身不参与这一判定
      if (document.querySelector('[role="dialog"]:not([data-rc-drawer])')) return
      // Esc 优先级：先关抽屉，再返回 L1
      if (sidebarOpen) {
        setSidebarOpen(false)
        return
      }
      returnToWorkbench()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [featuresOpen, navigate, sidebarOpen, setSidebarOpen])

  const currentEntryId = ENTRIES.find((entry) =>
    entry.features.some((feature) => {
      const pattern = `^${feature.route.replace(/:[A-Za-z]+/g, '[^/]+')}$`
      return new RegExp(pattern).test(location.pathname)
    }),
  )?.id
  const currentEntry = ENTRIES.find((entry) => entry.id === currentEntryId)
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
  const isBloomWorkbench = /^\/projects\/[^/]+\/workbench/.test(location.pathname)

  // Bloom 账本是沉浸式舞台：隐藏全局侧栏与顶栏，由舞台自己的项目条承担导航。
  if (isBloomWorkbench) {
    return (
      <div className="bloom-layout">
        <Outlet />
        <PageHelpButton floating />
        <Toaster />
      </div>
    )
  }

  return (
    <div
      className="rc-app-universe min-h-screen"
      data-rc-skin={pageSkin ?? undefined}
      style={{ color: 'var(--rc-text)' }}
    >
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭功能目录"
          className="fixed inset-0 z-30"
          style={{
            backgroundColor: 'var(--rc-scrim)',
            backdropFilter: 'var(--rc-blur-scrim)',
            WebkitBackdropFilter: 'var(--rc-blur-scrim)',
          }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {sidebarOpen && (
        <aside
          id="rc-feature-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label="功能目录"
          aria-modal="true"
          data-rc-drawer="true"
          className="fixed inset-y-0 left-0 z-40 flex w-[280px] max-w-[85vw] translate-x-0 flex-col transition-transform duration-200"
          style={{
            backgroundColor: 'var(--rc-bg-2)',
            borderRight: 'var(--rc-stroke)',
            backdropFilter: 'var(--rc-blur-panel)',
            WebkitBackdropFilter: 'var(--rc-blur-panel)',
            boxShadow: 'var(--rc-shadow-far)',
            transitionTimingFunction: 'var(--rc-ease-inout)',
          }}
        >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b px-5" style={{ borderColor: 'var(--rc-border-hair)' }}>
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
            style={{ backgroundColor: 'var(--rc-accent)', color: 'var(--rc-hi)' }}
          >
            <Icon as={ScanSearch} size="md" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[17px] font-semibold tracking-tight">ReproCheck</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--rc-text-subtle)' }}>科研复现审计官</p>
          </div>
          <button
            type="button"
            className="ml-auto rounded-full p-1.5"
            style={{ color: 'var(--rc-text-muted)' }}
            onClick={() => setSidebarOpen(false)}
            aria-label="关闭功能目录"
          >
            <Icon as={X} size="sm" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="功能目录分组">
          <NavGroup label="导航" items={NAV_ITEMS} onNavigate={() => setSidebarOpen(false)} />
          <NavGroup
            label="论文与材料"
            items={stage2Items}
            hint={lastProjectId ? undefined : '请先在「项目」中选择一个项目'}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup
            label="做一次复现"
            items={stage4Items}
            hint={lastProjectId ? undefined : '请先在「项目」中选择一个项目'}
            onNavigate={() => setSidebarOpen(false)}
          />
          <NavGroup
            label="结果与交付"
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

          <div className="shrink-0 border-t px-5 py-4" style={{ borderColor: 'var(--rc-border-hair)' }}>
            <p className="text-[10px]" style={{ color: 'var(--rc-text-subtle)' }}>ReproCheck · 科研复现审计官</p>
            <p className="mt-1 text-[11px] leading-snug" style={{ color: 'var(--rc-text-subtle)' }}>
              密钥仅在后端读取与保存
            </p>
          </div>
        </aside>
      )}

      {/* 内容区全宽，不再为常驻侧栏预留 248px；最大宽由 --rc-content-max 约束 */}
      <div className="flex min-h-screen flex-col">
        <header
          className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 px-4 sm:px-6 rc-l2-header"
          style={{ height: 'var(--rc-header-h)' }}
        >
          <button
            ref={drawerTriggerRef}
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium"
            style={{ border: 'var(--rc-stroke)', color: 'var(--rc-text)', backgroundColor: 'var(--rc-surface-glass)' }}
            onClick={() => setSidebarOpen(true)}
            aria-label="打开功能目录"
            aria-expanded={sidebarOpen}
            aria-controls="rc-feature-drawer"
          >
            <Icon as={ListTree} size="sm" />
            <span className="hidden sm:inline">目录</span>
          </button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--rc-text-subtle)' }}>
              <button
                type="button"
                className="rc-crumb-home"
                onClick={returnToWorkbench}
                aria-label="返回工作台"
              >
                <Icon as={ArrowLeft} size="xs" />
                工作台
              </button>
              <span aria-hidden="true" style={{ color: 'var(--rc-border-strong)' }}>›</span>
              {currentEntry && currentEntry.name !== pageTitle && (
                <>
                  <span className="truncate">{currentEntry.name}</span>
                  <span aria-hidden="true" style={{ color: 'var(--rc-border-strong)' }}>›</span>
                </>
              )}
              <span className="truncate" aria-current="page">{pageTitle}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <PageHelpButton compact />
            <button
              type="button"
              className="rc-all-btn"
              onClick={() => setFeaturesOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={featuresOpen}
              aria-label="打开全部功能"
            >
              <Icon as={Grid2X2} size="xs" />
              <span className="hidden sm:inline">全部功能</span>
            </button>
            <span className="hidden text-xs xl:inline" style={{ color: 'var(--rc-text-subtle)' }}>{today}</span>
            <span className="hidden h-4 w-px xl:inline-block" style={{ backgroundColor: 'var(--rc-border)' }} />
            {user && (
              <div className="flex items-center gap-2.5">
                <div className="hidden min-w-0 text-right sm:block">
                  <p className="truncate text-xs font-semibold leading-tight" style={{ color: 'var(--rc-text)' }}>
                    {user.display_name || user.email}
                  </p>
                  <p className="truncate text-[10px] leading-tight" style={{ color: 'var(--rc-text-subtle)' }}>
                    {orgs[0]?.name ?? (user.is_platform_admin ? '平台管理员' : '个人工作空间')}
                  </p>
                </div>
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ backgroundColor: 'var(--rc-accent)', color: 'var(--rc-hi)' }}
                >
                  {initial}
                </span>
                <button
                  type="button"
                  className="rounded-full border p-2 transition-colors"
                  style={{ borderColor: 'var(--rc-border)', color: 'var(--rc-text-muted)' }}
                  onClick={() => void handleLogout()}
                  title="退出登录"
                  aria-label="退出登录"
                >
                  <Icon as={LogOut} size="xs" />
                </button>
              </div>
            )}
          </div>
        </header>

        {notice && (
          <div className="rc-route-notice" role="status">
            {notice}
          </div>
        )}
        <div className="rc-next-step-slot">
          <NextStepCard />
        </div>
        <main
          className="rc-app-main mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6"
          style={{ maxWidth: 'var(--rc-content-max)' }}
        >
          <Outlet />
        </main>
      </div>
      <AllFeaturesPopover
        open={featuresOpen}
        onClose={() => setFeaturesOpen(false)}
        preferredEntryId={currentEntryId}
      />
      <Toaster />
    </div>
  )
}
