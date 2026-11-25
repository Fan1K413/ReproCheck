import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react'
import { matchPath, Route, Routes, useLocation, useNavigationType } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { LoadingState } from './components/LoadingState'
import { RequireAuth } from './components/RequireAuth'
import {
  RouteProgressBar,
  RouteTransitionContext,
  ScreenTransition,
} from './components/RouteTransition'
import LoginPage from './pages/auth/LoginPage'
import { LazyPages, warmCoreRoutes } from './routes/routeLoaders'
import { useAuthStore } from './stores/authStore'
import WorkbenchPage from './workbench/WorkbenchPage'

export default function App() {
  const location = useLocation()
  const navType = useNavigationType()
  const token = useAuthStore((state) => state.token)
  const [displayLocation, setDisplayLocation] = useState(location)
  const [isPending, startTransition] = useTransition()
  const lastLocationRef = useRef(location)
  const lastNavDirRef = useRef<'push' | 'pop' | 'replace'>('push')
  const crossesLogin = Boolean(matchPath('/login', location.pathname) || matchPath('/login', displayLocation.pathname))
  const routeLocation = crossesLogin ? location : displayLocation
  const routePending = !crossesLogin && isPending

  useEffect(() => {
    if (token) warmCoreRoutes()
  }, [token])

  useLayoutEffect(() => {
    if (lastLocationRef.current === location) return
    lastLocationRef.current = location

    // 认证切换直接使用新路由，避免保留旧页面的 Navigate 并重复重定向。
    if (crossesLogin || location.pathname === displayLocation.pathname) {
      setDisplayLocation(location)
      return
    }

    lastNavDirRef.current = navType === 'POP' ? 'pop' : navType === 'REPLACE' ? 'replace' : 'push'
    window.dispatchEvent(new CustomEvent('rc:capture-route-ghost'))
    startTransition(() => {
      setDisplayLocation(location)
    })
  }, [location, displayLocation.pathname, crossesLogin, navType, startTransition])

  const transitionCtx = useMemo(
    () => ({
      displayLocation: routeLocation,
      isPending: routePending,
      direction: lastNavDirRef.current,
    }),
    [routeLocation, routePending],
  )

  return (
    <RouteTransitionContext.Provider value={transitionCtx}>
      <RouteProgressBar />
      <Routes location={routeLocation}>
        <Route
          path="/login"
          element={
            <ScreenTransition screenKey="login">
              <LoginPage />
            </ScreenTransition>
          }
        />
        <Route element={<RequireAuth />}>
          {/* L1 一级工作台：全屏舞台，不套 AppLayout 侧栏 */}
          <Route
            index
            element={
              <ScreenTransition screenKey="workbench">
                <WorkbenchPage />
              </ScreenTransition>
            }
          />
          <Route element={<AppLayout />}>
            <Route path="projects" element={<LazyPages.ProjectsPage />} />
            <Route path="projects/new" element={<LazyPages.ProjectNewPage />} />
            <Route path="start/reproduce" element={<LazyPages.GuidedReproductionPage />} />
            <Route path="manual" element={<LazyPages.UserManualPage />} />
            <Route
              path="projects/:projectId/workbench"
              element={
                <Suspense fallback={<div className="p-10"><LoadingState message="正在打开项目工作台…" /></div>}>
                  <LazyPages.ProjectWorkbenchPage />
                </Suspense>
              }
            />
            <Route path="settings/llm" element={<LazyPages.LlmSettingsPage />} />
            <Route path="settings/models" element={<LazyPages.ModelCenterPage />} />
            <Route path="demo/audit" element={<LazyPages.DemoAuditPage />} />
            <Route path="projects/:projectId/materials" element={<LazyPages.MaterialsPage />} />
            <Route path="materials/:materialId" element={<LazyPages.MaterialDetailPage />} />
            <Route path="projects/:projectId/tasks" element={<LazyPages.ParseTasksPage />} />
            <Route path="projects/:projectId/facts" element={<LazyPages.FactsPage />} />
            <Route path="projects/:projectId/evidence-graph" element={<LazyPages.EvidenceGraphPage />} />
            <Route path="projects/:projectId/overview" element={<LazyPages.OverviewPage />} />

            {/* 第九阶段：能力驾驶舱 */}
            <Route path="projects/:projectId/verification" element={<LazyPages.ProjectVerificationPage />} />
            <Route path="projects/:projectId/handoff" element={<LazyPages.HandoffPage />} />

            {/* 第十一阶段：新增科研功能 */}
            <Route path="projects/:projectId/experiments/diff" element={<LazyPages.ExperimentDiffPage />} />
            <Route path="projects/:projectId/change-monitor" element={<LazyPages.ChangeMonitorPage />} />

            {/* 第四阶段：科研复现工作台 */}
            <Route path="projects/:pid/reproduction" element={<LazyPages.ReproductionOverviewPage />} />
            <Route path="reproductions/plans/:planId" element={<LazyPages.ReproductionPlanPage />} />
            <Route path="reproductions/runs/:runId" element={<LazyPages.ReproductionConsolePage />} />
            <Route path="projects/:pid/reproduction/environment" element={<LazyPages.ReproductionEnvironmentPage />} />
            <Route path="projects/:pid/reproduction/comparison" element={<LazyPages.ReproductionComparisonPage />} />
            <Route path="projects/:pid/reproduction/diagnostics" element={<LazyPages.ReproductionDiagnosticsPage />} />
            <Route path="projects/:pid/reproduction/reports" element={<LazyPages.ReproductionReportsPage />} />

            {/* 第六阶段：团队协作平台 */}
            <Route path="orgs" element={<LazyPages.OrganizationsPage />} />
            <Route path="roles" element={<LazyPages.RolesPage />} />
            <Route path="projects/:projectId/team" element={<LazyPages.ProjectTeamPage />} />
            <Route path="benchmark" element={<LazyPages.BenchmarkPage />} />
            <Route path="benchmark/:caseId" element={<LazyPages.CaseDetailPage />} />
            <Route path="fact-schema" element={<LazyPages.FactSchemaPage />} />
            <Route path="rules" element={<LazyPages.RulesPage />} />
            <Route path="feedback" element={<LazyPages.FeedbackPage />} />
            <Route path="knowledge" element={<LazyPages.KnowledgePage />} />
            <Route path="integrations" element={<LazyPages.IntegrationsPage />} />
            <Route path="api-tokens" element={<LazyPages.ApiTokensPage />} />
            <Route path="governance" element={<LazyPages.GovernancePage />} />
            <Route path="stats-audit" element={<LazyPages.StatsAuditPage />} />

            {/* 第十阶段：数据质量与数据完整性审计引擎 */}
            <Route path="projects/:projectId/data-audit" element={<LazyPages.DataAuditPage />} />

            <Route path="*" element={<LazyPages.NotFoundPage />} />
          </Route>
        </Route>
      </Routes>
    </RouteTransitionContext.Provider>
  )
}
