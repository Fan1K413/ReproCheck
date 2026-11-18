import { create } from 'zustand'

type UIState = {
  sidebarOpen: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
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

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  lastProjectId: null,
  setLastProjectId: (lastProjectId) => set({ lastProjectId }),
  lastPlanId: null,
  setLastPlanId: (lastPlanId) => set({ lastPlanId }),
  lastRunId: null,
  setLastRunId: (lastRunId) => set({ lastRunId }),
}))
