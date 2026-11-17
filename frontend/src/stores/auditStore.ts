import { create } from 'zustand'
import type { AuditResult } from '../types/api'

type AuditState = {
  lastResult: AuditResult | null
  setLastResult: (result: AuditResult) => void
}

/** 保留最近一次演示审计结果，供工作台展示“最近发现问题”。不落盘，不伪造数据。 */
export const useAuditStore = create<AuditState>((set) => ({
  lastResult: null,
  setLastResult: (lastResult) => set({ lastResult }),
}))
