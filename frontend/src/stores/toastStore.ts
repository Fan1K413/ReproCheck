import { create } from 'zustand'

export type ToastTone = 'success' | 'error' | 'info'

export type Toast = { id: number; tone: ToastTone; message: string }

type ToastState = {
  toasts: Toast[]
  push: (tone: ToastTone, message: string) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (tone, message) => {
    seq += 1
    const id = seq
    set((state) => ({ toasts: [...state.toasts.slice(-3), { id, tone, message }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, 4200)
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}