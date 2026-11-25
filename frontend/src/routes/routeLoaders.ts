import { lazy } from 'react'

/**
 * 统一路由分片加载器：
 * 1. 保留代码分割不拖慢首屏；
 * 2. 首屏空闲后静默预加载常用页面，配合侧栏悬停预加载，实现“点击零白屏、零模块加载闪烁”的原生 SPA 切换。
 */
export const routeLoaders = {
  projects: () => import('../pages/ProjectsPage'),
  projectNew: () => import('../pages/ProjectNewPage'),
  guided: () => import('../pages/GuidedReproductionPage'),
  manual: () => import('../pages/UserManualPage'),
  projectWorkbench: () =>
    import('../pages/ProjectWorkbenchPage').then((m) => ({ default: m.ProjectWorkbenchPage })),
  llmSettings: () => import('../pages/LlmSettingsPage'),
  modelCenter: () => import('../pages/ModelCenterPage'),
  demoAudit: () => import('../pages/DemoAuditPage'),
  materials: () => import('../pages/MaterialsPage'),
  materialDetail: () => import('../pages/MaterialDetailPage'),
  parseTasks: () => import('../pages/ParseTasksPage'),
  facts: () => import('../pages/FactsPage'),
  evidenceGraph: () => import('../pages/EvidenceGraphPage'),
  overview: () => import('../pages/OverviewPage'),
  verification: () => import('../pages/ProjectVerificationPage'),
  handoff: () => import('../pages/HandoffPage'),
  reproOverview: () => import('../pages/reproduction/ReproductionOverviewPage'),
  reproPlan: () => import('../pages/reproduction/ReproductionPlanPage'),
  reproEnv: () => import('../pages/reproduction/ReproductionEnvironmentPage'),
  reproConsole: () => import('../pages/reproduction/ReproductionConsolePage'),
  reproComparison: () => import('../pages/reproduction/ReproductionComparisonPage'),
  reproDiagnostics: () => import('../pages/reproduction/ReproductionDiagnosticsPage'),
  reproReports: () => import('../pages/reproduction/ReproductionReportsPage'),
  orgs: () => import('../pages/stage6/OrganizationsPage'),
  roles: () => import('../pages/stage6/RolesPage'),
  projectTeam: () => import('../pages/stage6/ProjectTeamPage'),
  benchmark: () => import('../pages/stage6/BenchmarkPage'),
  caseDetail: () => import('../pages/stage6/CaseDetailPage'),
  factSchema: () => import('../pages/stage6/FactSchemaPage'),
  rules: () => import('../pages/stage6/RulesPage'),
  feedback: () => import('../pages/stage6/FeedbackPage'),
  knowledge: () => import('../pages/stage6/KnowledgePage'),
  integrations: () => import('../pages/stage6/IntegrationsPage'),
  apiTokens: () => import('../pages/stage6/ApiTokensPage'),
  governance: () => import('../pages/stage6/GovernancePage'),
  statsAudit: () => import('../pages/StatsAuditPage'),
  dataAudit: () => import('../pages/DataAuditPage'),
  experimentDiff: () => import('../pages/ExperimentDiffPage'),
  changeMonitor: () => import('../pages/ChangeMonitorPage'),
  notFound: () => import('../pages/NotFoundPage'),
} as const

export const LazyPages = {
  ProjectsPage: lazy(routeLoaders.projects),
  ProjectNewPage: lazy(routeLoaders.projectNew),
  GuidedReproductionPage: lazy(routeLoaders.guided),
  UserManualPage: lazy(routeLoaders.manual),
  ProjectWorkbenchPage: lazy(routeLoaders.projectWorkbench),
  LlmSettingsPage: lazy(routeLoaders.llmSettings),
  ModelCenterPage: lazy(routeLoaders.modelCenter),
  DemoAuditPage: lazy(routeLoaders.demoAudit),
  MaterialsPage: lazy(routeLoaders.materials),
  MaterialDetailPage: lazy(routeLoaders.materialDetail),
  ParseTasksPage: lazy(routeLoaders.parseTasks),
  FactsPage: lazy(routeLoaders.facts),
  EvidenceGraphPage: lazy(routeLoaders.evidenceGraph),
  OverviewPage: lazy(routeLoaders.overview),
  ProjectVerificationPage: lazy(routeLoaders.verification),
  HandoffPage: lazy(routeLoaders.handoff),
  ReproductionOverviewPage: lazy(routeLoaders.reproOverview),
  ReproductionPlanPage: lazy(routeLoaders.reproPlan),
  ReproductionEnvironmentPage: lazy(routeLoaders.reproEnv),
  ReproductionConsolePage: lazy(routeLoaders.reproConsole),
  ReproductionComparisonPage: lazy(routeLoaders.reproComparison),
  ReproductionDiagnosticsPage: lazy(routeLoaders.reproDiagnostics),
  ReproductionReportsPage: lazy(routeLoaders.reproReports),
  OrganizationsPage: lazy(routeLoaders.orgs),
  RolesPage: lazy(routeLoaders.roles),
  ProjectTeamPage: lazy(routeLoaders.projectTeam),
  BenchmarkPage: lazy(routeLoaders.benchmark),
  CaseDetailPage: lazy(routeLoaders.caseDetail),
  FactSchemaPage: lazy(routeLoaders.factSchema),
  RulesPage: lazy(routeLoaders.rules),
  FeedbackPage: lazy(routeLoaders.feedback),
  KnowledgePage: lazy(routeLoaders.knowledge),
  IntegrationsPage: lazy(routeLoaders.integrations),
  ApiTokensPage: lazy(routeLoaders.apiTokens),
  GovernancePage: lazy(routeLoaders.governance),
  StatsAuditPage: lazy(routeLoaders.statsAudit),
  DataAuditPage: lazy(routeLoaders.dataAudit),
  ExperimentDiffPage: lazy(routeLoaders.experimentDiff),
  ChangeMonitorPage: lazy(routeLoaders.changeMonitor),
  NotFoundPage: lazy(routeLoaders.notFound),
} as const

type LoaderKey = keyof typeof routeLoaders

const preloaded = new Set<LoaderKey>()

function runLoader(key: LoaderKey) {
  if (preloaded.has(key)) return
  preloaded.add(key)
  void routeLoaders[key]().catch(() => {
    preloaded.delete(key)
  })
}

const PATH_MATCHERS: Array<[RegExp, LoaderKey]> = [
  [/^\/projects\/new/, 'projectNew'],
  [/^\/projects\/[^/]+\/workbench/, 'projectWorkbench'],
  [/^\/projects\/[^/]+\/materials/, 'materials'],
  [/^\/materials\/[^/]+/, 'materialDetail'],
  [/^\/projects\/[^/]+\/tasks/, 'parseTasks'],
  [/^\/projects\/[^/]+\/facts/, 'facts'],
  [/^\/projects\/[^/]+\/evidence-graph/, 'evidenceGraph'],
  [/^\/projects\/[^/]+\/overview/, 'overview'],
  [/^\/projects\/[^/]+\/verification/, 'verification'],
  [/^\/projects\/[^/]+\/handoff/, 'handoff'],
  [/^\/projects\/[^/]+\/data-audit/, 'dataAudit'],
  [/^\/projects\/[^/]+\/experiments\/diff/, 'experimentDiff'],
  [/^\/projects\/[^/]+\/change-monitor/, 'changeMonitor'],
  [/^\/projects\/[^/]+\/team/, 'projectTeam'],
  [/^\/projects\/[^/]+\/reproduction\/environment/, 'reproEnv'],
  [/^\/projects\/[^/]+\/reproduction\/comparison/, 'reproComparison'],
  [/^\/projects\/[^/]+\/reproduction\/diagnostics/, 'reproDiagnostics'],
  [/^\/projects\/[^/]+\/reproduction\/reports/, 'reproReports'],
  [/^\/projects\/[^/]+\/reproduction/, 'reproOverview'],
  [/^\/reproductions\/plans\/[^/]+/, 'reproPlan'],
  [/^\/reproductions\/runs\/[^/]+/, 'reproConsole'],
  [/^\/projects/, 'projects'],
  [/^\/start\/reproduce/, 'guided'],
  [/^\/manual/, 'manual'],
  [/^\/settings\/models/, 'modelCenter'],
  [/^\/settings\/llm/, 'llmSettings'],
  [/^\/demo\/audit/, 'demoAudit'],
  [/^\/orgs/, 'orgs'],
  [/^\/roles/, 'roles'],
  [/^\/benchmark\/[^/]+/, 'caseDetail'],
  [/^\/benchmark/, 'benchmark'],
  [/^\/fact-schema/, 'factSchema'],
  [/^\/rules/, 'rules'],
  [/^\/feedback/, 'feedback'],
  [/^\/knowledge/, 'knowledge'],
  [/^\/integrations/, 'integrations'],
  [/^\/api-tokens/, 'apiTokens'],
  [/^\/governance/, 'governance'],
  [/^\/stats-audit/, 'statsAudit'],
]

/** 悬停或聚焦链接时立即预加载目标分片 */
export function preloadRouteByPath(path: string) {
  const clean = path.split('?')[0]
  for (const [pattern, key] of PATH_MATCHERS) {
    if (pattern.test(clean)) {
      runLoader(key)
      return
    }
  }
}

let warmStarted = false

/** 首屏渲染稳定后，在浏览器空闲时静默预热核心高频页面分片 */
export function warmCoreRoutes() {
  if (warmStarted || typeof window === 'undefined') return
  warmStarted = true
  const priority: LoaderKey[] = [
    'projects',
    'materials',
    'guided',
    'modelCenter',
    'projectWorkbench',
  ]

  const schedule = (fn: () => void) => {
    if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 1200 })
    else window.setTimeout(fn, 180)
  }

  const pump = () => {
    const batch = priority.splice(0, 4)
    batch.forEach(runLoader)
    if (priority.length > 0) {
      window.setTimeout(() => schedule(pump), 260)
    }
  }

  window.setTimeout(() => schedule(pump), 450)
}
