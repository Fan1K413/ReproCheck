import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ApiError } from '../services/api'
import { stage6Api } from '../services/stage6Api'
import { useAuthStore } from '../stores/authStore'
import { ErrorState } from './ErrorState'
import { LoadingState } from './LoadingState'

/** 路由守卫：无令牌跳转登录；令牌失效（401）自动清理会话。 */
export function RequireAuth() {
  const token = useAuthStore((state) => state.token)
  const user = useAuthStore((state) => state.user)
  const setIdentity = useAuthStore((state) => state.setIdentity)
  const logout = useAuthStore((state) => state.logout)
  const location = useLocation()

  const meQuery = useQuery({
    queryKey: ['me', token],
    queryFn: stage6Api.me,
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (meQuery.data) {
      setIdentity(meQuery.data.user, meQuery.data.organizations)
    }
  }, [meQuery.data, setIdentity])

  useEffect(() => {
    if (meQuery.error instanceof ApiError && meQuery.error.code === 'UNAUTHORIZED') {
      logout()
    }
  }, [meQuery.error, logout])

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (meQuery.isPending && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <LoadingState message="正在校验登录状态…" hint="读取当前身份与组织成员资格" />
      </div>
    )
  }

  if (meQuery.isError && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="panel w-full max-w-md">
          <ErrorState
            message={meQuery.error instanceof Error ? meQuery.error.message : '身份校验失败。'}
            code={meQuery.error instanceof ApiError ? meQuery.error.code : undefined}
            onRetry={() => void meQuery.refetch()}
          />
        </div>
      </div>
    )
  }

  return <Outlet />
}