import type { LucideIcon } from 'lucide-react'
import {
  ChartNoAxesCombined,
  ClipboardList,
  Cpu,
  Files,
  FlaskConical,
  FolderKanban,
  GitCompare,
  LayoutDashboard,
  ListChecks,
  Menu,
  Network,
  ScanSearch,
  Server,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

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

function getPageTitle(pathname: string): string {
  if (pathname.startsWith('/projects/new')) return '新建项目'
  if (/^\/materials\/[^/]+/.test(pathname)) return '材料详情'
  if (/\/projects\/[^/]+\/materials/.test(pathname)) return '材料管理'
  if (/\/projects\/[^/]+\/tasks/.test(pathname)) return '解析任务'
  if (/\/projects\/[^/]+\/facts/.test(pathname)) return '科研事实'
  if (/\/projects\/[^/]+\/overview/.test(pathname)) return '解析概览'
  if (/\/projects\/[^/]+\/reproduction\/environment/.test(pathname)) return '复现环境'
  if (/\/projects\/[^/]+\/reproduction\/comparison/.test(pathname)) return '结果对照'
  if (/\/projects\/[^/]+\/reproduction\/diagnostics/.test(pathname)) return 'AI 诊断'
  if (/\/projects\/[^/]+\/reproduction\/reports/.test(pathname)) return '报告中心'
  if (/\/projects\/[^/]+\/reproduction/.test(pathname)) return '复现总览'
  if (/^\/reproductions\/plans\/[^/]+/.test(pathname)) return '复现规划 DAG'
  if (/^\/reproductions\/runs\/[^/]+/.test(pathname)) return '执行控制台'
  const match = NAV_ITEMS.find(
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
    { to: to('overview'), label: '解析概览', icon: ChartNoAxesCombined, title: '解析概览' },
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

export default function AppLayout() {
  const sidebarOpen = useUIStore((state) => state.sidebarOpen)
  const setSidebarOpen = useUIStore((state) => state.setSidebarOpen)
  const lastProjectId = useUIStore((state) => state.lastProjectId)
  const lastPlanId = useUIStore((state) => state.lastPlanId)
  const lastRunId = useUIStore((state) => state.lastRunId)
  const location = useLocation()
  const pageTitle = getPageTitle(location.pathname)
  const stage2Items = stage2NavItems(lastProjectId)
  const stage4Items = stage4NavItems(lastProjectId, lastPlanId, lastRunId)
  const today = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date())

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
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-white">
            <ScanSearch size={20} strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold tracking-tight">ReproCheck</p>
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
          <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            导航
          </p>
          <ul className="space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/65 hover:bg-white/[0.06] hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-soft" />
                        )}
                        <Icon size={18} strokeWidth={1.8} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>

          <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            材料解析
          </p>
          {!lastProjectId && (
            <p className="px-3 pb-2 text-[11px] leading-snug text-white/45">
              请先在「项目」中选择一个项目
            </p>
          )}
          <ul className="space-y-1">
            {stage2Items.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    title={lastProjectId ? item.title : '请先在「项目」中选择一个项目'}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/65 hover:bg-white/[0.06] hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-soft" />
                        )}
                        <Icon size={18} strokeWidth={1.8} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>

          <p className="px-3 pb-2 pt-6 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/35">
            复现验证
          </p>
          {!lastProjectId && (
            <p className="px-3 pb-2 text-[11px] leading-snug text-white/45">
              请先在「项目」中选择一个项目
            </p>
          )}
          <ul className="space-y-1">
            {stage4Items.map((item) => {
              const Icon = item.icon
              return (
                <li key={item.label}>
                  <NavLink
                    to={item.to}
                    title={item.title}
                    onClick={() => setSidebarOpen(false)}
                    className={({ isActive }) =>
                      `relative flex items-center gap-3 rounded-md px-3 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-white/10 text-white'
                          : 'text-white/65 hover:bg-white/[0.06] hover:text-white'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-soft" />
                        )}
                        <Icon size={18} strokeWidth={1.8} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="shrink-0 border-t border-white/10 px-5 py-4">
          <p className="mono text-[10px] text-white/40">API /api/v1</p>
          <p className="mt-1 text-[11px] leading-snug text-white/45">密钥仅在后端读取与保存</p>
        </div>
      </aside>

      <div className="flex min-h-screen flex-col lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
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
            <h1 className="truncate text-base font-semibold leading-tight">{pageTitle}</h1>
          </div>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <span className="hidden text-xs text-ink-subtle xl:inline">{today}</span>
            <span className="hidden h-4 w-px bg-line xl:inline-block" />
            <span className="mono rounded bg-canvas px-2 py-1 text-[11px] text-ink-muted">v0.1.0</span>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 sm:px-6 sm:py-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
