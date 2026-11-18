import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import ProjectNewPage from './pages/ProjectNewPage'
import LlmSettingsPage from './pages/LlmSettingsPage'
import DemoAuditPage from './pages/DemoAuditPage'
import MaterialsPage from './pages/MaterialsPage'
import MaterialDetailPage from './pages/MaterialDetailPage'
import ParseTasksPage from './pages/ParseTasksPage'
import FactsPage from './pages/FactsPage'
import OverviewPage from './pages/OverviewPage'
import ReproductionOverviewPage from './pages/reproduction/ReproductionOverviewPage'
import ReproductionPlanPage from './pages/reproduction/ReproductionPlanPage'
import ReproductionEnvironmentPage from './pages/reproduction/ReproductionEnvironmentPage'
import ReproductionConsolePage from './pages/reproduction/ReproductionConsolePage'
import ReproductionComparisonPage from './pages/reproduction/ReproductionComparisonPage'
import ReproductionDiagnosticsPage from './pages/reproduction/ReproductionDiagnosticsPage'
import ReproductionReportsPage from './pages/reproduction/ReproductionReportsPage'

export default function App() {
  return (
    <Routes>
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
        <Route path="projects/:projectId/overview" element={<OverviewPage />} />

        {/* 第四阶段：科研复现工作台 */}
        <Route path="projects/:pid/reproduction" element={<ReproductionOverviewPage />} />
        <Route path="reproductions/plans/:planId" element={<ReproductionPlanPage />} />
        <Route path="reproductions/runs/:runId" element={<ReproductionConsolePage />} />
        <Route path="projects/:pid/reproduction/environment" element={<ReproductionEnvironmentPage />} />
        <Route path="projects/:pid/reproduction/comparison" element={<ReproductionComparisonPage />} />
        <Route path="projects/:pid/reproduction/diagnostics" element={<ReproductionDiagnosticsPage />} />
        <Route path="projects/:pid/reproduction/reports" element={<ReproductionReportsPage />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
