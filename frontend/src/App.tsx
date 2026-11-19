import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { RequireAuth } from './components/RequireAuth'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectNewPage from './pages/ProjectNewPage'
import LlmSettingsPage from './pages/LlmSettingsPage'
import DemoAuditPage from './pages/DemoAuditPage'
import MaterialsPage from './pages/MaterialsPage'
import MaterialDetailPage from './pages/MaterialDetailPage'
import ParseTasksPage from './pages/ParseTasksPage'
import FactsPage from './pages/FactsPage'
import EvidenceGraphPage from './pages/EvidenceGraphPage'
import OverviewPage from './pages/OverviewPage'
import LoginPage from './pages/auth/LoginPage'
import ReproductionOverviewPage from './pages/reproduction/ReproductionOverviewPage'
import ReproductionPlanPage from './pages/reproduction/ReproductionPlanPage'
import ReproductionEnvironmentPage from './pages/reproduction/ReproductionEnvironmentPage'
import ReproductionConsolePage from './pages/reproduction/ReproductionConsolePage'
import ReproductionComparisonPage from './pages/reproduction/ReproductionComparisonPage'
import ReproductionDiagnosticsPage from './pages/reproduction/ReproductionDiagnosticsPage'
import ReproductionReportsPage from './pages/reproduction/ReproductionReportsPage'
import OrganizationsPage from './pages/stage6/OrganizationsPage'
import RolesPage from './pages/stage6/RolesPage'
import ProjectTeamPage from './pages/stage6/ProjectTeamPage'
import BenchmarkPage from './pages/stage6/BenchmarkPage'
import CaseDetailPage from './pages/stage6/CaseDetailPage'
import FactSchemaPage from './pages/stage6/FactSchemaPage'
import RulesPage from './pages/stage6/RulesPage'
import FeedbackPage from './pages/stage6/FeedbackPage'
import KnowledgePage from './pages/stage6/KnowledgePage'
import IntegrationsPage from './pages/stage6/IntegrationsPage'
import ApiTokensPage from './pages/stage6/ApiTokensPage'
import GovernancePage from './pages/stage6/GovernancePage'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<ProjectNewPage />} />
          <Route path="settings/llm" element={<LlmSettingsPage />} />
          <Route path="demo/audit" element={<DemoAuditPage />} />
          <Route path="projects/:projectId/materials" element={<MaterialsPage />} />
          <Route path="materials/:materialId" element={<MaterialDetailPage />} />
          <Route path="projects/:projectId/tasks" element={<ParseTasksPage />} />
          <Route path="projects/:projectId/facts" element={<FactsPage />} />
          <Route path="projects/:projectId/evidence-graph" element={<EvidenceGraphPage />} />
          <Route path="projects/:projectId/overview" element={<OverviewPage />} />

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

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}