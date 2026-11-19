import type { Tone } from '../components/StatusBadge'

/* 第六阶段各枚举的中文标签与徽章色调，集中维护以保证全站一致。 */

export const QUALITY_LEVELS: { key: string; label: string; tone: Tone }[] = [
  { key: 'unverified', label: '未验证', tone: 'neutral' },
  { key: 'partially_verified', label: '部分验证', tone: 'warning' },
  { key: 'execution_verified', label: '执行验证', tone: 'accent' },
  { key: 'independently_reviewed', label: '独立复核', tone: 'success' },
]

export function qualityMeta(key: string): { label: string; tone: Tone } {
  return QUALITY_LEVELS.find((l) => l.key === key) ?? { label: key, tone: 'neutral' }
}

export function qualityRank(key: string): number {
  const index = QUALITY_LEVELS.findIndex((l) => l.key === key)
  return index < 0 ? 0 : index
}

export const VERIFICATION_RESULTS: Record<string, { label: string; tone: Tone }> = {
  pass: { label: '通过', tone: 'success' },
  fail: { label: '失败', tone: 'danger' },
  partial: { label: '部分通过', tone: 'warning' },
}

export const VERIFICATION_TYPES: Record<string, string> = {
  execution: '执行复现',
  review: '人工复核',
}

export const PROJECT_ROLES: { key: string; label: string; tone: Tone }[] = [
  { key: 'project_lead', label: '项目负责人', tone: 'navy' },
  { key: 'researcher', label: '研究员', tone: 'accent' },
  { key: 'reviewer', label: '复核员', tone: 'success' },
  { key: 'viewer', label: '观察者', tone: 'neutral' },
]

export function projectRoleMeta(key: string): { label: string; tone: Tone } {
  return PROJECT_ROLES.find((r) => r.key === key) ?? { label: key, tone: 'neutral' }
}

export const ORG_ROLES: Record<string, { label: string; tone: Tone }> = {
  org_admin: { label: '组织管理员', tone: 'navy' },
  member: { label: '成员', tone: 'neutral' },
}

export const REVIEW_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '待裁定', tone: 'warning' },
  approved: { label: '已通过', tone: 'success' },
  rejected: { label: '已驳回', tone: 'danger' },
  changes_requested: { label: '需修改', tone: 'accent' },
}

export const COMMENT_TARGETS: Record<string, string> = {
  finding: '审计发现',
  evidence: '证据',
  task: '任务',
  fact: '事实',
  material: '材料',
}

export const REVIEW_TARGETS: Record<string, string> = {
  finding: '审计发现',
  remediation: '整改建议',
}

export const FEEDBACK_TYPES: Record<string, { label: string; tone: Tone }> = {
  confirm: { label: '确认无误', tone: 'success' },
  false_positive: { label: '误报', tone: 'danger' },
  insufficient_evidence: { label: '证据不足', tone: 'warning' },
  request_review: { label: '请求复核', tone: 'accent' },
  supplement: { label: '补充材料', tone: 'accent' },
  fix_note: { label: '修正说明', tone: 'neutral' },
}

export const FEEDBACK_STATUS: Record<string, { label: string; tone: Tone }> = {
  open: { label: '待处理', tone: 'warning' },
  triaged: { label: '已分诊', tone: 'accent' },
  resolved: { label: '已解决', tone: 'success' },
  disputed: { label: '有争议', tone: 'danger' },
}

export const RISK_LEVELS: Record<string, { label: string; tone: Tone }> = {
  low: { label: '低', tone: 'neutral' },
  medium: { label: '中', tone: 'warning' },
  high: { label: '高', tone: 'danger' },
  critical: { label: '严重', tone: 'danger' },
}

export const PROVENANCE_CLASSES: Record<string, { label: string; tone: Tone }> = {
  current_evidence: { label: '当前证据', tone: 'success' },
  historical_case: { label: '历史案例', tone: 'warning' },
  external_knowledge: { label: '外部知识', tone: 'accent' },
  model_inference: { label: '模型推断', tone: 'navy' },
}

export const RAG_SOURCE_TYPES: Record<string, string> = {
  verified_case: '已验证案例',
  normalized_fact: '标准化事实',
  audit_rule: '审计规则',
  repro_method: '复现方法',
  env_config: '环境配置',
  failure_diagnosis: '失败诊断',
}

export const REPO_PROVIDERS: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  gitee: 'Gitee',
}

export const REPO_STATUS: Record<string, { label: string; tone: Tone }> = {
  connected: { label: '已连接', tone: 'success' },
  no_credentials: { label: '未配置凭据', tone: 'warning' },
  revoked: { label: '已撤销', tone: 'neutral' },
}

export const SNAPSHOT_STATUS: Record<string, { label: string; tone: Tone }> = {
  synced: { label: '已同步', tone: 'success' },
  blocked_no_credentials: { label: '缺少凭据', tone: 'warning' },
  blocked_fetch_failed: { label: '拉取失败', tone: 'danger' },
}

export const API_SCOPES: { key: string; label: string }[] = [
  { key: 'project.read', label: '读取项目' },
  { key: 'project.write', label: '创建项目' },
  { key: 'material.write', label: '上传材料' },
  { key: 'audit.run', label: '发起审计' },
  { key: 'audit.read', label: '读取审计' },
  { key: 'repro.read', label: '读取复现' },
  { key: 'report.read', label: '读取报告' },
]

export const DATA_CLASS_TONES: Record<string, Tone> = {
  public: 'success',
  internal: 'accent',
  confidential: 'warning',
  restricted: 'danger',
}

export const INVITATION_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: '待接受', tone: 'warning' },
  accepted: { label: '已接受', tone: 'success' },
  revoked: { label: '已撤销', tone: 'neutral' },
  expired: { label: '已过期', tone: 'danger' },
}

/** 审计轨迹 action 前缀 → 中文分组名。 */
export function trailActionLabel(action: string): string {
  const map: Record<string, string> = {
    'user.register': '用户注册',
    'user.login': '用户登录',
    'user.logout': '用户退出',
    'org.create': '创建组织',
    'member.role_change': '修改组织角色',
    'member.remove': '移除组织成员',
    'invitation.create': '创建邀请',
    'invitation.accept': '接受邀请',
    'invitation.revoke': '撤销邀请',
    'team.create': '创建团队',
    'project.create': '创建项目',
    'project.delete': '删除项目',
    'project.member_add': '分配项目成员',
    'project.member_role': '修改项目角色',
    'project.member_remove': '移除项目成员',
    'comment.create': '发表评论',
    'review.request': '提交复核申请',
    'review.decide': '裁定复核',
    'case.create': '创建基准案例',
    'case.fact_add': '新增案例事实',
    'case.verification': '提交案例验证',
    'case.quality_change': '质量等级变更',
    'case.quality_recompute': '质量等级重算',
    'rule.seed': '初始化默认规则',
    'rule.create': '创建规则',
    'rule.enable': '启用规则',
    'rule.disable': '停用规则',
    'rule.version': '规则新版本',
    'rule.rollback': '规则回滚',
    'rule.test': '规则测试',
    'rule.evaluate': '规则评估',
    'rule.evaluate_compare': '规则版本对比',
    'feedback.create': '提交审计反馈',
    'feedback.triage': '反馈分诊',
    'rag.document_add': '知识文档入库',
    'integration.connect': '连接代码仓库',
    'integration.revoke': '撤销仓库连接',
    'integration.sync': '同步仓库快照',
    'api_token.create': '创建 API Token',
    'api_token.revoke': '撤销 API Token',
    'governance.consent': 'AI 授权变更',
    'governance.export': '数据导出',
  }
  return map[action] ?? action
}