import { create } from 'zustand'
import type { AuthUser, OrgSummary } from '../types/stage6'

const TOKEN_KEY = 'rc_token'
const USER_KEY = 'rc_user'

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function readUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

type AuthState = {
  token: string | null
  user: AuthUser | null
  orgs: OrgSummary[]
  setSession: (token: string, user: AuthUser) => void
  setIdentity: (user: AuthUser, orgs: OrgSummary[]) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  token: readToken(),
  user: readUser(),
  orgs: [],
  setSession: (token, user) => {
    try {
      localStorage.setItem(TOKEN_KEY, token)
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    } catch {
      /* 隐私模式下 localStorage 不可用时仅保留内存会话 */
    }
    set({ token, user })
  },
  setIdentity: (user, orgs) => {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    } catch {
      /* ignore */
    }
    set({ user, orgs })
  },
  logout: () => {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    } catch {
      /* ignore */
    }
    set({ token: null, user: null, orgs: [] })
  },
}))