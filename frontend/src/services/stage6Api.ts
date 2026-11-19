import { ApiError, request } from './api'
import type {
  ActivityData,
  AiConsent,
  ApiCallLog,
  ApiToken,
  ApiTokenCreated,
  AuditRule,
  AuthResult,
  BenchmarkCase,
  CaseFact,
  CaseListData,
  CaseSearchData,
  CaseVerification,
  ClassificationData,
  Comment,
  ConsentData,
  ExportRequest,
  FactSchemaData,
  Feedback,
  Invitation,
  InvitationCreated,
  Items,
  KnowledgeDocument,
  MeData,
  NotebookData,
  Organization,
  OrgMember,
  Permission,
  ProjectMember,
  QualityRecomputeResult,
  RagQueryData,
  RepositoryConnection,
  RepoSnapshot,
  RetentionPolicy,
  ReviewRequest,
  Role,
  RolePermissions,
  RuleDetail,
  RuleEvalCompare,
  RuleEvalSingle,
  RuleEvaluation,
  RuleSeedResult,
  RuleTestResult,
  RuleVersion,
  Team,
  TeamMember,
  VerificationCreated,
  Workspace,
} from '../types/stage6'

const enc = encodeURIComponent

function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`)
  return parts.length ? `?${parts.join('&')}` : ''
}

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

const del = <T>(path: string) => request<T>(path, { method: 'DELETE' })

export const stage6Api = {
  /* ---------------- 认证 ---------------- */
  register: (body: { email: string; password: string; display_name?: string }) =>
    post<AuthResult>('/auth/register', body),
  login: (body: { email: string; password: string }) => post<AuthResult>('/auth/login', body),
  logout: () => post<{ logged_out: boolean }>('/auth/logout'),
  me: () => request<MeData>('/auth/me'),

  /* ---------------- 组织 / 成员 / 邀请 ---------------- */
  listOrgs: () => request<Items<Organization>>('/orgs'),
  createOrg: (body: { name: string; description?: string }) => post<Organization>('/orgs', body),
  getOrg: (orgId: string) => request<Organization>(`/orgs/${enc(orgId)}`),
  listOrgMembers: (orgId: string) => request<Items<OrgMember>>(`/orgs/${enc(orgId)}/members`),
  updateOrgMember: (orgId: string, userId: string, roleKey: string) =>
    patch<{ user_id: string; role_key: string }>(`/orgs/${enc(orgId)}/members/${enc(userId)}`, { role_key: roleKey }),
  removeOrgMember: (orgId: string, userId: string) =>
    del<{ removed: string; revoked_projects: number }>(`/orgs/${enc(orgId)}/members/${enc(userId)}`),
  createInvitation: (orgId: string, body: { email: string; role_key?: string }) =>
    post<InvitationCreated>(`/orgs/${enc(orgId)}/invitations`, body),
  listInvitations: (orgId: string) => request<Items<Invitation>>(`/orgs/${enc(orgId)}/invitations`),
  acceptInvitation: (token: string) =>
    post<{ org_id: string; role_key: string; status: string }>('/invitations/accept', { token }),
  revokeInvitation: (invId: string) => post<{ id: string; status: string }>(`/invitations/${enc(invId)}/revoke`),

  /* ---------------- 团队 / 工作空间 ---------------- */
  listTeams: (orgId: string) => request<Items<Team>>(`/orgs/${enc(orgId)}/teams`),
  createTeam: (orgId: string, body: { name: string; description?: string }) =>
    post<Team>(`/orgs/${enc(orgId)}/teams`, body),
  listTeamMembers: (teamId: string) => request<Items<TeamMember>>(`/teams/${enc(teamId)}/members`),
  addTeamMember: (teamId: string, body: { user_id: string; role_in_team?: string }) =>
    post<{ team_id: string; user_id: string; role_in_team: string }>(`/teams/${enc(teamId)}/members`, body),
  listWorkspaces: (orgId: string) => request<Items<Workspace>>(`/orgs/${enc(orgId)}/workspaces`),
  createWorkspace: (orgId: string, body: { name: string; description?: string }) =>
    post<Workspace>(`/orgs/${enc(orgId)}/workspaces`, body),

  /* ---------------- RBAC 目录 ---------------- */
  listRoles: () => request<Items<Role>>('/roles'),
  listPermissions: () => request<Items<Permission>>('/permissions'),
  rolePermissions: (roleKey: string) => request<RolePermissions>(`/roles/${enc(roleKey)}/permissions`),

  /* ---------------- 项目协作 ---------------- */
  listProjectMembers: (projectId: string) => request<Items<ProjectMember>>(`/projects/${enc(projectId)}/members`),
  addProjectMember: (projectId: string, body: { user_id: string; role_key?: string }) =>
    post<{ project_id: string; user_id: string; role_key: string }>(`/projects/${enc(projectId)}/members`, body),
  updateProjectMember: (projectId: string, userId: string, roleKey: string) =>
    patch<{ user_id: string; role_key: string }>(`/projects/${enc(projectId)}/members/${enc(userId)}`, { role_key: roleKey }),
  removeProjectMember: (projectId: string, userId: string) =>
    del<{ removed: string }>(`/projects/${enc(projectId)}/members/${enc(userId)}`),
  listComments: (projectId: string, targetType?: string, targetId?: string) =>
    request<Items<Comment>>(`/projects/${enc(projectId)}/comments${qs({ target_type: targetType, target_id: targetId })}`),
  createComment: (projectId: string, body: { target_type: string; target_id: string; body: string }) =>
    post<Comment>(`/projects/${enc(projectId)}/comments`, body),
  deleteComment: (commentId: string) => del<{ deleted: string }>(`/comments/${enc(commentId)}`),
  listReviews: (projectId: string) => request<Items<ReviewRequest>>(`/projects/${enc(projectId)}/reviews`),
  createReview: (projectId: string, body: { target_type: string; target_id: string; reviewer_user_id?: string | null }) =>
    post<ReviewRequest>(`/projects/${enc(projectId)}/reviews`, body),
  decideReview: (reviewId: string, body: { status: string; decision_note?: string }) =>
    post<{ id: string; status: string; decision_note: string }>(`/reviews/${enc(reviewId)}/decide`, body),
  listActivity: (projectId: string, limit = 50, offset = 0) =>
    request<ActivityData>(`/projects/${enc(projectId)}/activity${qs({ limit, offset })}`),
  deleteProject: (projectId: string) =>
    del<{ deleted: boolean; project_id: string; materials_removed: number }>(`/projects/${enc(projectId)}`),

  /* ---------------- 基准案例库 ---------------- */
  listCases: (params: {
    q?: string; domain?: string; research_task?: string; dataset?: string
    quality_level?: string; org_id?: string; is_public?: boolean
    sort?: string; limit?: number; offset?: number
  } = {}) => request<CaseListData>(`/cases${qs(params)}`),
  createCase: (body: {
    title: string; doi?: string; source_url?: string; domain?: string; research_task?: string
    model_architecture?: string; dataset_name?: string; code_repo_url?: string; code_commit?: string
    license?: string; summary?: string; org_id?: string | null; is_public?: boolean
  }) => post<BenchmarkCase>('/cases', body),
  getCase: (caseId: string) => request<BenchmarkCase>(`/cases/${enc(caseId)}`),
  searchCases: (body: { query: string; filters?: Record<string, unknown>; top_k?: number }) =>
    post<CaseSearchData>('/cases/search', body),
  listCaseFacts: (caseId: string, params: { field_key?: string; category?: string } = {}) =>
    request<Items<CaseFact>>(`/cases/${enc(caseId)}/facts${qs(params)}`),
  addCaseFact: (caseId: string, body: {
    raw_field?: string; field_key?: string; raw_value: string; unit?: string
    source_type?: string; source_ref?: string; context?: string
    applicable_experiment?: string; confidence?: number
  }) => post<CaseFact>(`/cases/${enc(caseId)}/facts`, body),
  listVerifications: (caseId: string) => request<Items<CaseVerification>>(`/cases/${enc(caseId)}/verifications`),
  addVerification: (caseId: string, body: {
    verification_type: string; result?: string
    conditions_json?: Record<string, unknown> | string | null; notes?: string; project_id?: string | null
  }) => post<VerificationCreated>(`/cases/${enc(caseId)}/verifications`, body),
  recomputeQuality: (caseId: string, confirmDowngrade = false) =>
    post<QualityRecomputeResult>(`/cases/${enc(caseId)}/quality/recompute`, { confirm_downgrade: confirmDowngrade }),
  getFactSchema: () => request<FactSchemaData>('/fact-schema'),

  /* ---------------- 审计规则 ---------------- */
  listRules: (params: { domain?: string; is_enabled?: boolean } = {}) =>
    request<Items<AuditRule>>(`/rules${qs(params)}`),
  createRule: (body: {
    rule_key: string; name: string; domain?: string; description?: string; risk_level?: string
    evidence_requirement?: string; check_logic_json: Record<string, unknown>
    change_note?: string; test_samples?: { input: Record<string, unknown>; expected: Record<string, unknown>; label?: string }[]
    is_enabled?: boolean
  }) => post<AuditRule>('/rules', body),
  seedRules: () => post<RuleSeedResult>('/rules/seed'),
  getRule: (ruleId: string) => request<RuleDetail>(`/rules/${enc(ruleId)}`),
  setRuleEnabled: (ruleId: string, isEnabled: boolean) =>
    patch<AuditRule>(`/rules/${enc(ruleId)}`, { is_enabled: isEnabled }),
  listRuleVersions: (ruleId: string) => request<Items<RuleVersion>>(`/rules/${enc(ruleId)}/versions`),
  createRuleVersion: (ruleId: string, body: {
    check_logic_json: Record<string, unknown>; change_note?: string
    test_samples?: { input: Record<string, unknown>; expected: Record<string, unknown>; label?: string }[]
  }) => post<RuleVersion>(`/rules/${enc(ruleId)}/versions`, body),
  rollbackRule: (ruleId: string, version: number) =>
    post<AuditRule>(`/rules/${enc(ruleId)}/rollback`, { version }),
  runRuleTests: (ruleId: string) => post<RuleTestResult>(`/rules/${enc(ruleId)}/test`),
  listRuleEvaluations: (ruleId: string) => request<Items<RuleEvaluation>>(`/rules/${enc(ruleId)}/evaluations`),
  evaluateRule: (ruleId: string, body: {
    dataset_ref?: string
    samples: { input: Record<string, unknown>; expected: Record<string, unknown>; label?: string }[]
    baseline_version?: number | null
  }) => post<RuleEvalSingle | RuleEvalCompare>(`/rules/${enc(ruleId)}/evaluate`, body),

  /* ---------------- 反馈治理 ---------------- */
  listFeedback: (projectId: string, status?: string) =>
    request<Items<Feedback>>(`/feedback${qs({ project_id: projectId, status })}`),
  createFeedback: (body: {
    project_id: string; finding_id?: string | null; run_id?: string | null
    feedback_type: string; note?: string; evidence_ref?: string; context_json?: Record<string, unknown> | null
  }) => post<Feedback>('/feedback', body),
  triageFeedback: (feedbackId: string, body: { status: string; resolution?: string }) =>
    post<Feedback>(`/feedback/${enc(feedbackId)}/triage`, body),

  /* ---------------- 受控 RAG ---------------- */
  ragQuery: (body: { query: string; project_id?: string | null; top_k?: number; synthesize?: boolean }) =>
    post<RagQueryData>('/rag/query', body),
  listDocuments: (sourceType?: string) => request<Items<KnowledgeDocument>>(`/rag/documents${qs({ source_type: sourceType })}`),
  addDocument: (body: { source_type: string; source_ref?: string; title: string; content: string; is_public?: boolean }) =>
    post<KnowledgeDocument>('/rag/documents', body),

  /* ---------------- 外部集成 ---------------- */
  listRepositories: () => request<Items<RepositoryConnection>>('/integrations/repositories'),
  connectRepository: (body: {
    provider: string; account_label: string; auth_type?: string; token?: string
    org_id?: string | null; repo_allowlist?: string[]; scopes?: string[]
  }) => post<RepositoryConnection>('/integrations/repositories', body),
  revokeRepository: (connId: string) =>
    post<RepositoryConnection>(`/integrations/repositories/${enc(connId)}/revoke`),
  syncRepository: (connId: string, body: { repo_full_name: string; ref?: string }) =>
    post<RepoSnapshot>(`/integrations/repositories/${enc(connId)}/sync`, body),
  listSnapshots: (connId: string) =>
    request<Items<RepoSnapshot>>(`/integrations/repositories/${enc(connId)}/snapshots`),
  getNotebook: (materialId: string) => request<NotebookData>(`/materials/${enc(materialId)}/notebook`),

  /* ---------------- 开放 API Token ---------------- */
  listApiTokens: () => request<Items<ApiToken>>('/api-tokens'),
  createApiToken: (body: {
    name: string; scopes: string[]; rate_limit_per_min?: number
    expires_at?: string | null; org_id?: string | null
  }) => post<ApiTokenCreated>('/api-tokens', body),
  revokeApiToken: (tokenId: string) => post<ApiToken>(`/api-tokens/${enc(tokenId)}/revoke`),
  listApiLogs: (tokenId: string) => request<Items<ApiCallLog>>(`/api-tokens/${enc(tokenId)}/logs`),

  /* ---------------- 数据治理 ---------------- */
  getClassification: () => request<ClassificationData>('/governance/classification'),
  getAiConsent: (params: { project_id?: string; org_id?: string } = {}) =>
    request<ConsentData>(`/governance/ai-consent${qs(params)}`),
  grantAiConsent: (body: { allow_external_llm: boolean; scope?: string; project_id?: string | null; org_id?: string | null }) =>
    post<AiConsent>('/governance/ai-consent', body),
  requestExport: () => post<ExportRequest>('/governance/export'),
  getExport: (exportId: string) => request<ExportRequest>(`/governance/export/${enc(exportId)}`),
  getRetention: () => request<RetentionPolicy>('/governance/retention'),
}

/** 下载本人数据导出 zip（二进制流，带登录令牌）。 */
export async function downloadExport(exportId: string): Promise<void> {
  const base = ((import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api').replace(/\/$/, '')
  const token = localStorage.getItem('rc_token')
  let response: Response
  try {
    response = await fetch(`${base}/v1/governance/export/${enc(exportId)}/download`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', '无法连接到服务，下载未开始。', null, 'frontend')
  }
  if (!response.ok) {
    throw new ApiError('DOWNLOAD_FAILED', `下载失败（HTTP ${response.status}）。`, null, 'frontend')
  }
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${exportId}.zip`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}