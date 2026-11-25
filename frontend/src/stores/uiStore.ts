import { create } from 'zustand'

export type ThemeMode = 'dark' | 'light'
export type ThemePreference = 'system' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'rc:theme:v1'
const SIDEBAR_COLLAPSED_KEY = 'rc:sidebar-collapsed:v1'
const THEME_CYCLE: readonly ThemePreference[] = ['system', 'light', 'dark']

function readSystemTheme(): ThemeMode {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function readInitialPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (saved === 'system' || saved === 'light' || saved === 'dark') return saved
  } catch {
    /* 隐私模式下回退到跟随系统 */
  }
  return 'system'
}

export function resolveTheme(preference: ThemePreference): ThemeMode {
  return preference === 'system' ? readSystemTheme() : preference
}

function readInitialSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function applyThemeToDocument(theme: ThemeMode, preference?: ThemePreference) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-rc-skin', theme)
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (meta) {
      meta.content = theme === 'light' ? '#f4f1ea' : '#050806'
    }
  }
  if (preference) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, preference)
    } catch {
      /* 忽略本地存储配额/隐私限制 */
    }
  }
}

type UIState = {
  /** 用户选择的模式偏好：默认跟随系统，依次循环 system -> light -> dark */
  themePreference: ThemePreference
  /** 当前实际生效的外观（dark | light），供着色器与组件直接消费 */
  theme: ThemeMode
  setThemePreference: (preference: ThemePreference) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  sidebarCollapsed: boolean
  toggleSidebarCollapsed: () => void
  /** 最近访问的项目 id，供侧栏「材料解析」分组生成带项目参数的链接 */
  lastProjectId: string | null
  setLastProjectId: (id: string | null) => void
  /** 最近访问的复现规划 id，供侧栏「复现验证」分组直达规划 DAG */
  lastPlanId: string | null
  setLastPlanId: (id: string | null) => void
  /** 最近访问的复现运行 id，供侧栏「复现验证」分组直达执行控制台 */
  lastRunId: string | null
  setLastRunId: (id: string | null) => void
}

const initialPreference = readInitialPreference()
const initialTheme = resolveTheme(initialPreference)

export const useUIStore = create<UIState>((set) => ({
  themePreference: initialPreference,
  theme: initialTheme,
  setThemePreference: (themePreference) => {
    const resolved = resolveTheme(themePreference)
    applyThemeToDocument(resolved, themePreference)
    set({ themePreference, theme: resolved })
  },
  setTheme: (theme) => {
    applyThemeToDocument(theme, theme)
    set({ themePreference: theme, theme })
  },
  toggleTheme: () =>
    set((state) => {
      const idx = THEME_CYCLE.indexOf(state.themePreference)
      const nextPref = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length]
      const nextTheme = resolveTheme(nextPref)
      applyThemeToDocument(nextTheme, nextPref)
      return { themePreference: nextPref, theme: nextTheme }
    }),
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  sidebarCollapsed: readInitialSidebarCollapsed(),
  toggleSidebarCollapsed: () =>
    set((state) => {
      const next = !state.sidebarCollapsed
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* 忽略本地存储限制 */
      }
      return { sidebarCollapsed: next }
    }),
  lastProjectId: null,
  setLastProjectId: (lastProjectId) => set({ lastProjectId }),
  lastPlanId: null,
  setLastPlanId: (lastPlanId) => set({ lastPlanId }),
  lastRunId: null,
  setLastRunId: (lastRunId) => set({ lastRunId }),
}))

let systemListenerBound = false

/** 启动时同步主题并监听操作系统深浅模式变化（仅在跟随系统时自动响应） */
export function initThemeSync() {
  const { themePreference } = useUIStore.getState()
  const resolved = resolveTheme(themePreference)
  applyThemeToDocument(resolved)
  if (resolved !== useUIStore.getState().theme) {
    useUIStore.setState({ theme: resolved })
  }

  if (systemListenerBound || typeof window === 'undefined' || !window.matchMedia) return
  systemListenerBound = true
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = () => {
    const state = useUIStore.getState()
    if (state.themePreference !== 'system') return
    const next = media.matches ? 'dark' : 'light'
    applyThemeToDocument(next)
    useUIStore.setState({ theme: next })
  }
  if (media.addEventListener) media.addEventListener('change', handleChange)
  else media.addListener(handleChange)
}
