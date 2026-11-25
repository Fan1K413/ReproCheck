import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { LoadingState } from './components/LoadingState'
import { RequireAuth } from './components/RequireAuth'
import LoginPage from './pages/auth/LoginPage'
import WorkbenchPage from './workbench/WorkbenchPage'

const ProjectsPage = lazy(() => import('./pages/ProjectsPage'))
const ProjectNewPage = lazy(() => import('./pages/ProjectNewPage'))
const GuidedReproductionPage = lazy(() => import('./pages/GuidedReproductionPage'))
const UserManualPage = lazy(() => import('./pages/UserManualPage'))
const ProjectWorkbenchPage = lazy(() => import('./pages/ProjectWorkbenchPage').then((m) => ({ default: m.ProjectWorkbenchPage })))
const LlmSettingsPage = lazy(() => import('./pages/LlmSettingsPage'))
const ModelCenterPage = lazy(() => import('./pages/ModelCenterPage'))
const DemoAuditPage = lazy(() => import('./pages/DemoAuditPage'))
const MaterialsPage = lazy(() => import('./pages/MaterialsPage'))
const MaterialDetailPage = lazy(() => import('./pages/MaterialDetailPage'))
const ParseTasksPage = lazy(() => import('./pages/ParseTasksPage'))
const FactsPage = lazy(() => import('./pages/FactsPage'))
const EvidenceGraphPage = lazy(() => import('./pages/EvidenceGraphPage'))
const OverviewPage = lazy(() => import('./pages/OverviewPage'))
const ProjectVerificationPage = lazy(() => import('./pages/ProjectVerificationPage'))
const HandoffPage = lazy(() => import('./pages/HandoffPage'))
const ReproductionOverviewPage = lazy(() => import('./pages/reproduction/ReproductionOverviewPage'))
const ReproductionPlanPage = lazy(() => import('./pages/reproduction/ReproductionPlanPage'))
const ReproductionEnvironmentPage = lazy(() => import('./pages/reproduction/ReproductionEnvironmentPage'))
const ReproductionConsolePage = lazy(() => import('./pages/reproduction/ReproductionConsolePage'))
const ReproductionComparisonPage = lazy(() => import('./pages/reproduction/ReproductionComparisonPage'))
const ReproductionDiagnosticsPage = lazy(() => import('./pages/reproduction/ReproductionDiagnosticsPage'))
const ReproductionReportsPage = lazy(() => import('./pages/reproduction/ReproductionReportsPage'))
const OrganizationsPage = lazy(() => import('./pages/stage6/OrganizationsPage'))
const RolesPage = lazy(() => import('./pages/stage6/RolesPage'))
const ProjectTeamPage = lazy(() => import('./pages/stage6/ProjectTeamPage'))
const BenchmarkPage = lazy(() => import('./pages/stage6/BenchmarkPage'))
const CaseDetailPage = lazy(() => import('./pages/stage6/CaseDetailPage'))
const FactSchemaPage = lazy(() => import('./pages/stage6/FactSchemaPage'))
const RulesPage = lazy(() => import('./pages/stage6/RulesPage'))
const FeedbackPage = lazy(() => import('./pages/stage6/FeedbackPage'))
const KnowledgePage = lazy(() => import('./pages/stage6/KnowledgePage'))
const IntegrationsPage = lazy(() => import('./pages/stage6/IntegrationsPage'))
const ApiTokensPage = lazy(() => import('./pages/stage6/ApiTokensPage'))
const GovernancePage = lazy(() => import('./pages/stage6/GovernancePage'))
const StatsAuditPage = lazy(() => import('./pages/StatsAuditPage'))
const DataAuditPage = lazy(() => import('./pages/DataAuditPage'))
const ExperimentDiffPage = lazy(() => import('./pages/ExperimentDiffPage'))
const ChangeMonitorPage = lazy(() => import('./pages/ChangeMonitorPage'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

export default function App() {
  return (
    <Suspense fallback={<div className="rcw-page"><LoadingState message="正在加载页面模块…" /></div>}>
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        {/* L1 一级工作台：全屏舞台，不套 AppLayout 侧栏 */}
        <Route index element={<WorkbenchPage />} />
        <Route element={<AppLayout />}>
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<ProjectNewPage />} />
          <Route path="start/reproduce" element={<GuidedReproductionPage />} />
          <Route path="manual" element={<UserManualPage />} />
          <Route path="projects/:projectId/workbench" element={<ProjectWorkbenchPage />} />
          <Route path="settings/llm" element={<LlmSettingsPage />} />
          <Route path="settings/models" element={<ModelCenterPage />} />
          <Route path="demo/audit" element={<DemoAuditPage />} />
          <Route path="projects/:projectId/materials" element={<MaterialsPage />} />
          <Route path="materials/:materialId" element={<MaterialDetailPage />} />
          <Route path="projects/:projectId/tasks" element={<ParseTasksPage />} />
          <Route path="projects/:projectId/facts" element={<FactsPage />} />
          <Route path="projects/:projectId/evidence-graph" element={<EvidenceGraphPage />} />
          <Route path="projects/:projectId/overview" element={<OverviewPage />} />

          {/* 第九阶段：能力驾驶舱 */}
          <Route path="projects/:projectId/verification" element={<ProjectVerificationPage />} />
          <Route path="projects/:projectId/handoff" element={<HandoffPage />} />

          {/* 第十一阶段：新增科研功能 */}
          <Route path="projects/:projectId/experiments/diff" element={<ExperimentDiffPage />} />
          <Route path="projects/:projectId/change-monitor" element={<ChangeMonitorPage />} />

          {/* 第四阶段：科研复现工作台 */}
          <Route path="projects/:pid/reproduction" element={<ReproductionOverviewPage />} />
          <Route path="reproductions/plans/:planId" element={<ReproductionPlanPage />} />
          <Route path="reproductions/runs/:runId" element={<ReproductionConsolePage />} />
          <Route path="projects/:pid/reproduction/environment" element={<ReproductionEnvironmentPage />} />
          <Route path="projects/:pid/reproduction/comparison" element={<ReproductionComparisonPage />} />
          <Route path="projects/:pid/reproduction/diagnostics" element={<ReproductionDiagnosticsPage />} />
          <Route path="projects/:pid/reproduction/reports" element={<ReproductionReportsPage />} />

          {/* 第六阶段：团队协作平台 */}
          <Route path="orgs" element={<OrganizationsPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="projects/:projectId/team" element={<ProjectTeamPage />} />
          <Route path="benchmark" element={<BenchmarkPage />} />
          <Route path="benchmark/:caseId" element={<CaseDetailPage />} />
          <Route path="fact-schema" element={<FactSchemaPage />} />
          <Route path="rules" element={<RulesPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="api-tokens" element={<ApiTokensPage />} />
          <Route path="governance" element={<GovernancePage />} />
          <Route path="stats-audit" element={<StatsAuditPage />} />

          {/* 第十阶段：数据质量与数据完整性审计引擎 */}
          <Route path="projects/:projectId/data-audit" element={<DataAuditPage />} />

          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
      </Routes>
    </Suspense>
  )
}