import type { LucideIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  PanelLeftClose,
  PanelLeftOpen,
  Plug,
  Plus,
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
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { preloadRouteByPath } from '../routes/routeLoaders'
import { api } from '../services/api'
import { stage6Api } from '../services/stage6Api'
import { useAuthStore } from '../stores/authStore'
import { useUIStore } from '../stores/uiStore'
import AllFeaturesPopover from '../workbench/AllFeaturesPopover'
import { consumeRouteNotice, ENTRIES, setRouteNotice } from '../workbench/EntryLauncher'
import NextStepCard from '../ux/NextStepCard'
import PageHelpButton from '../ux/PageHelpDrawer'
import { Icon } from './Icon'
import { RouteStage, ScreenTransition, useRouteTransition } from './RouteTransition'
import { ThemeToggle } from './ThemeToggle'
import { Toaster } from './Toaster'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  title: string
  /** 精确匹配路径，避免父路由与子路由同时高亮 */
  exact?: boolean
  /** 缺少项目/规划/运行上下文时的降级链接，不应随目标列表页一起高亮 */
  fallback?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: '工作台', icon: LayoutDashboard, title: '工作台', exact: true },
  { to: '/projects', label: '项目档案', icon: FolderKanban, title: '项目档案', exact: true },
  { to: '/start/reproduce', label: '四步引导', icon: Sparkles, title: '四步复现引导' },
  { to: '/settings/models?tab=setup', label: 'AI 助手', icon: Cpu, title: '连接 AI 助手' },
  { to: '/settings/llm', label: 'AI 状态', icon: Server, title: '系统 AI 状态' },
  { to: '/manual', label: '使用手册', icon: BookOpenCheck, title: '中文使用手册' },
  { to: '/demo/audit', label: '审计演示', icon: FlaskConical, title: '审计演示' },
]

const COLLAB_ITEMS: NavItem[] = [
  { to: '/orgs', label: '组织成员', icon: Building2, title: '组织与成员' },
  { to: '/roles', label: '角色权限', icon: ShieldCheck, title: '角色权限' },
]

const BENCHMARK_ITEMS: NavItem[] = [
  { to: '/benchmark', label: '基准案例', icon: BookOpenCheck, title: '基准案例库' },
  { to: '/fact-schema', label: '事实字段', icon: FileSearch, title: '事实字段目录' },
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
    (item) => item.to === pathname || (item.to !== '/' && pathname.startsWith(item.to.split('?')[0])),
  )
  return match?.title ?? '工作台'
}

function stage2NavItems(projectId: string): NavItem[] {
  const to = (suffix: string) => `/projects/${projectId}/${suffix}`
  return [
    { to: to('workbench'), label: '总览图', icon: Orbit, title: '项目总览图' },
    { to: to('materials'), label: '论文材料', icon: Files, title: '论文与材料' },
    { to: to('tasks'), label: '处理任务', icon: ListChecks, title: '自动处理任务' },
    { to: to('facts'), label: '科研事实', icon: ClipboardList, title: '科研事实' },
    { to: to('evidence-graph'), label: '证据图谱', icon: Network, title: '证据关系图' },
    { to: to('overview'), label: '解析概览', icon: ChartNoAxesCombined, title: '解析概览' },
  ]
}

function stage9NavItems(projectId: string): NavItem[] {
  const to = (suffix: string) => `/projects/${projectId}/${suffix}`
  return [
    { to: to('verification'), label: '项目验证', icon: ShieldCheck, title: '项目验证' },
    { to: to('handoff'), label: '交接包', icon: Files, title: '交接包' },
    { to: to('experiments/diff'), label: '实验差异', icon: GitCompare, title: '实验差异分析' },
    { to: to('change-monitor'), label: '变化监控', icon: Radar, title: '项目变化监控' },
    { to: to('team'), label: '项目团队', icon: Users, title: '项目团队' },
  ]
}

function stage4NavItems(
  projectId: string,
  lastPlanId: string | null,
  lastRunId: string | null,
): NavItem[] {
  const project = (suffix: string) => `/projects/${projectId}/reproduction${suffix}`
  const items: NavItem[] = [
    { to: project(''), label: '复现总览', icon: LayoutDashboard, title: '复现总览', exact: true },
  ]
  if (lastPlanId) {
    items.push({
      to: `/reproductions/plans/${lastPlanId}`,
      label: '步骤清单',
      icon: Network,
      title: '复现步骤清单',
    })
  }
  items.push({ to: project('/environment'), label: '实验环境', icon: Server, title: '实验环境' })
  if (lastRunId) {
    items.push({
      to: `/reproductions/runs/${lastRunId}`,
      label: '执行终端',
      icon: Terminal,
      title: '执行控制台',
    })
  }
  items.push(
    { to: project('/comparison'), label: '结果对照', icon: GitCompare, title: '结果对照' },
    { to: project('/diagnostics'), label: 'AI 诊断', icon: Sparkles, title: 'AI 诊断' },
    { to: project('/reports'), label: '审计报告', icon: Files, title: '审计报告' },
  )
  return items
}

function NavGroup({
  label,
  items,
  collapsed = false,
  onNavigate,
}: {
  label: string
  items: NavItem[]
  collapsed?: boolean
  onNavigate?: () => void
}) {
  return (
    <div className="mb-3.5">
      {!collapsed && (
        <p
          className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: 'var(--rc-text-subtle)' }}
        >
          {label}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.label}>
            <NavLink
              to={item.to}
              end={Boolean(item.exact)}
              title={item.title}
              onClick={onNavigate}
              onMouseEnter={() => preloadRouteByPath(item.to)}
              onFocus={() => preloadRouteByPath(item.to)}
              className={({ isActive }) =>
                `rc-nav-link${isActive && !item.fallback ? ' is-active' : ''}${
                  item.fallback ? ' is-fallback' : ''
                }${collapsed ? ' is-collapsed' : ''}`
              }
            >
              <Icon as={item.icon} size="xs" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function AppLayout() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)
  const sidebarCollapsed = useUIStore((state) => state.sidebarCollapsed)
  const toggleSidebarCollapsed = useUIStore((state) => state.toggleSidebarCollapsed)
  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const setLastProjectId = useUIStore((state) => state.setLastProjectId)
  const lastPlanId = useUIStore((state) => state.lastPlanId)
  const lastRunId = useUIStore((state) => state.lastRunId)
  const user = useAuthStore((state) => state.user)
  const orgs = useAuthStore((state) => state.orgs)
  const logout = useAuthStore((state) => state.logout)
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const transition = useRouteTransition()
  const activePathname = transition?.displayLocation.pathname ?? routerLocation.pathname
  const pageTitle = getPageTitle(activePathname)

  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    staleTime: 60_000,
  })
  const projectList = projectsQuery.data?.items ?? []

  const urlProjectId = useMemo(() => {
    const match = activePathname.match(/^\/projects\/([^/]+)/)
    if (!match || match[1] === 'new') return null
    return match[1]
  }, [activePathname])

  const activeProjectId = useMemo(() => {
    if (urlProjectId) return urlProjectId
    if (lastProjectId && (projectList.length === 0 || projectList.some((p) => p.id === lastProjectId))) {
      return lastProjectId
    }
    return projectList[0]?.id ?? null
  }, [urlProjectId, lastProjectId, projectList])

  useEffect(() => {
    if (activeProjectId && activeProjectId !== lastProjectId) {
      setLastProjectId(activeProjectId)
    }
  }, [activeProjectId, lastProjectId, setLastProjectId])

  const switchActiveProject = (nextId: string) => {
    setLastProjectId(nextId)
    const projectSubMatch = activePathname.match(/^\/projects\/[^/]+(\/.+)$/)
    if (projectSubMatch) {
      navigate(`/projects/${nextId}${projectSubMatch[1]}`)
    } else {
      navigate(`/projects/${nextId}/materials`)
    }
  }

  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const lastNoticePath = useRef<string | null>(null)
  const drawerRef = useRef<HTMLElement>(null)
  const drawerTriggerRef = useRef<HTMLButtonElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.querySelector('aside nav a[aria-current="page"]')?.scrollIntoView({ block: 'nearest' })
  }, [activePathname])

  useEffect(() => {
    if (!sidebarOpen) return
    drawerRef.current?.querySelector<HTMLElement>('nav a')?.focus({ preventScroll: true })
    return () => drawerTriggerRef.current?.focus?.({ preventScroll: true })
  }, [sidebarOpen])

  useEffect(() => {
    if (lastNoticePath.current === activePathname) return
    lastNoticePath.current = activePathname
    const message = consumeRouteNotice()
    setNotice(message)
    if (!message) return
    const timer = window.setTimeout(() => setNotice(null), 5200)
    return () => window.clearTimeout(timer)
  }, [activePathname])

  const returnToWorkbench = () => {
    setRouteNotice(undefined)
    setFeaturesOpen(false)
    setSidebarOpen(false)
    navigate('/')
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSidebarOpen(false)
        setFeaturesOpen((open) => !open)
        return
      }
      if (event.key !== 'Escape' || featuresOpen) return
      const target = event.target as HTMLElement | null
      if (
        target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      ) {
        return
      }
      if (document.querySelector('[role="dialog"]:not([data-rc-drawer])')) return
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
      return new RegExp(pattern).test(activePathname)
    }),
  )?.id
  const currentEntry = ENTRIES.find((entry) => entry.id === currentEntryId)
  const stage2Items = activeProjectId ? stage2NavItems(activeProjectId) : []
  const stage4Items = activeProjectId ? stage4NavItems(activeProjectId, lastPlanId, lastRunId) : []
  const stage9Items = activeProjectId ? stage9NavItems(activeProjectId) : []

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
  const isBloomWorkbench = /^\/projects\/[^/]+\/workbench/.test(activePathname)

  if (isBloomWorkbench) {
    return (
      <ScreenTransition screenKey={`bloom:${activePathname}`}>
        <div className="bloom-layout">
          <Outlet />
          <Toaster />
        </div>
      </ScreenTransition>
    )
  }

  const renderNavGroups = (collapsed: boolean, closeDrawer?: () => void) => (
    <>
      <NavGroup label="导航" items={NAV_ITEMS} collapsed={collapsed} onNavigate={closeDrawer} />

      {activeProjectId ? (
        <div className="rc-project-nav-section">
          {!collapsed && (
            <div className="rc-spa-project-box">
              <div className="rc-spa-project-box__head">
                <span>当前项目</span>
                <Link
                  to="/projects/new"
                  className="rc-spa-project-box__add"
                  title="新建项目"
                  onClick={closeDrawer}
                  onMouseEnter={() => preloadRouteByPath('/projects/new')}
                >
                  <Plus size={12} />
                </Link>
              </div>
              {projectList.length > 0 ? (
                <select
                  aria-label="切换当前项目"
                  className="rc-spa-project-select"
                  value={activeProjectId}
                  onChange={(e) => {
                    switchActiveProject(e.target.value)
                    closeDrawer?.()
                  }}
                >
                  {projectList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="truncate px-1 text-xs font-medium" style={{ color: 'var(--rc-text)' }}>
                  {activeProjectId}
                </p>
              )}
            </div>
          )}
          <NavGroup label="材料" items={stage2Items} collapsed={collapsed} onNavigate={closeDrawer} />
          <NavGroup label="复现" items={stage4Items} collapsed={collapsed} onNavigate={closeDrawer} />
          <NavGroup label="验证" items={stage9Items} collapsed={collapsed} onNavigate={closeDrawer} />
        </div>
      ) : (
        <div className="mb-4 px-1">
          <Link
            to="/projects/new"
            className={`rc-spa-new-proj${collapsed ? ' is-collapsed' : ''}`}
            title="新建首个项目"
            onClick={closeDrawer}
            onMouseEnter={() => preloadRouteByPath('/projects/new')}
          >
            <Plus size={14} />
            {!collapsed && <span>新建项目</span>}
          </Link>
        </div>
      )}

      <NavGroup label="协作" items={COLLAB_ITEMS} collapsed={collapsed} onNavigate={closeDrawer} />
      <NavGroup label="规则" items={BENCHMARK_ITEMS} collapsed={collapsed} onNavigate={closeDrawer} />
      <NavGroup label="治理" items={GOVERNANCE_ITEMS} collapsed={collapsed} onNavigate={closeDrawer} />
    </>
  )

  return (
    <div className="rc-app-universe rc-spa-layout" style={{ color: 'var(--rc-text)' }}>
      {/* 桌面端常驻可折叠侧栏：切页期间永不卸载，彻底建立单页应用空间锚点 */}
      <aside
        className={`rc-spa-rail hidden lg:flex${sidebarCollapsed ? ' rc-spa-rail--collapsed' : ''}`}
        aria-label="主导航栏"
      >
        <div className="rc-spa-rail__head">
          <button
            type="button"
            className="rc-spa-brand"
            onClick={returnToWorkbench}
            title="回到罗盘工作台"
          >
            <span className="rc-spa-brand__mark">
              <Icon as={ScanSearch} size="sm" />
            </span>
            {!sidebarCollapsed && <span className="rc-spa-brand__name">ReproCheck</span>}
          </button>
          <button
            type="button"
            className="rc-spa-collapse-btn"
            onClick={toggleSidebarCollapsed}
            aria-label={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
            title={sidebarCollapsed ? '展开侧栏' : '折叠侧栏'}
          >
            <Icon as={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose} size="xs" />
          </button>
        </div>

        <nav className="rc-spa-rail__nav" aria-label="功能目录">
          {renderNavGroups(sidebarCollapsed)}
        </nav>
      </aside>

      {/* 移动端滑出抽屉 */}
      {sidebarOpen && (
        <button
          type="button"
          aria-label="关闭功能目录"
          className="rc-drawer-scrim fixed inset-0 z-30 lg:hidden"
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
          className="rc-drawer-panel fixed inset-y-0 left-0 z-40 flex w-[264px] max-w-[85vw] flex-col lg:hidden"
          style={{
            backgroundColor: 'var(--rc-surface)',
            borderRight: 'var(--rc-stroke)',
            boxShadow: 'var(--rc-shadow-far)',
          }}
        >
          <div
            className="flex h-15 shrink-0 items-center gap-3 border-b px-4 py-3.5"
            style={{ borderColor: 'var(--rc-border-hair)' }}
          >
            <span className="rc-spa-brand__mark">
              <Icon as={ScanSearch} size="sm" />
            </span>
            <p className="truncate text-[16px] font-semibold tracking-tight" style={{ fontFamily: 'var(--rc-font-display)' }}>
              ReproCheck
            </p>
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
          <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="移动端功能目录">
            {renderNavGroups(false, () => setSidebarOpen(false))}
          </nav>
        </aside>
      )}

      {/* 右侧独立滚动工作区：顶栏锚定，内容区执行旧页滑出 + 新页滑入无刷新转场 */}
      <div className="rc-spa-body">
        <header
          className="sticky top-0 z-20 flex shrink-0 items-center gap-3 px-4 sm:px-6 rc-l2-header"
          style={{ height: 'var(--rc-header-h)' }}
        >
          <button
            ref={drawerTriggerRef}
            type="button"
            className="inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium lg:hidden"
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
                  <span className="hidden truncate sm:inline">{currentEntry.name}</span>
                  <span className="hidden sm:inline" aria-hidden="true" style={{ color: 'var(--rc-border-strong)' }}>›</span>
                </>
              )}
              <span
                key={pageTitle}
                className="rc-crumb-current truncate font-medium"
                style={{ color: 'var(--rc-text)' }}
                aria-current="page"
              >
                {pageTitle}
              </span>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="rc-all-btn"
              onClick={() => setFeaturesOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={featuresOpen}
              aria-label="打开全部功能 (Ctrl+K)"
            >
              <Icon as={Grid2X2} size="xs" />
              <span className="hidden sm:inline">全部功能</span>
              <kbd className="rc-kbd hidden md:inline-flex">⌘K</kbd>
            </button>
            <ThemeToggle compact />
            <PageHelpButton compact />
            {user && (
              <div className="flex items-center gap-2 pl-1">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
                  style={{ backgroundColor: 'var(--rc-accent)', color: 'var(--rc-hi)' }}
                  title={`${user.display_name || user.email} · ${orgs[0]?.name ?? (user.is_platform_admin ? '平台管理员' : '个人空间')}`}
                >
                  {initial}
                </span>
                <button
                  type="button"
                  className="rounded-full border p-1.5 transition-colors hover:border-[var(--rc-border-strong)] hover:text-[var(--rc-text)]"
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

        <div ref={scrollRef} className="rc-spa-scroll">
          {notice && (
            <div className="rc-route-notice" role="status">
              {notice}
            </div>
          )}
          <div className="rc-next-step-slot">
            <NextStepCard />
          </div>
          <main
            className="rc-app-main mx-auto w-full flex-1 px-4 py-5 sm:px-6 sm:py-6"
            style={{ maxWidth: 'var(--rc-content-max)' }}
          >
            <RouteStage scrollContainerRef={scrollRef}>
              <Outlet />
            </RouteStage>
          </main>
        </div>
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
