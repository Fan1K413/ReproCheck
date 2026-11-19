// C 组域：审计规则生命周期 + 反馈治理 + 受控 RAG。
// 忠实移植 backend/app/services/{rule_service,rule_eval,feedback_service,rag_service,trail_service}.py
// 与 backend/app/api/v1/{rules,feedback,rag}.py。数值比对语义（百分比感知 / 相对 vs 绝对容差 /
// 单位不一致 / 递归子集匹配）必须与 Python 完全一致；评估指标绝不硬编码。
// 治理约束：单条反馈绝不自动改生产规则；规则变更只能走显式版本流程（rule.manage + 离线样本）。
import { AppError, newId, nowIso, parseJson, rows, one, orgRole, projectRole, hasPermission } from './core.ts';
import type { Router, Deps, Call, Db, UserRow } from './core.ts';

// ============================ 常量（镜像 services/__init__.py 等） ============================

const FIELD_ALIASES: Record<string, [string, string]> = {
  batch_size: ['batch_size', 'Batch Size'],
  batchsize: ['batch_size', 'Batch Size'],
  'batch size': ['batch_size', 'Batch Size'],
  '批大小': ['batch_size', 'Batch Size'],
  learning_rate: ['learning_rate', 'Learning Rate'],
  learningrate: ['learning_rate', 'Learning Rate'],
  'learning rate': ['learning_rate', 'Learning Rate'],
  lr: ['learning_rate', 'Learning Rate'],
  '学习率': ['learning_rate', 'Learning Rate'],
  epochs: ['epochs', 'Epochs'],
  epoch: ['epochs', 'Epochs'],
  num_epochs: ['epochs', 'Epochs'],
  training_epochs: ['epochs', 'Epochs'],
  '训练轮数': ['epochs', 'Epochs'],
  optimizer: ['optimizer', 'Optimizer'],
  optim: ['optimizer', 'Optimizer'],
  '优化器': ['optimizer', 'Optimizer'],
};
const NUMERIC_FIELDS = new Set(['batch_size', 'learning_rate', 'epochs']);
const REL_TOL = 1e-6;
const CHECK_TYPES = ['field_compare', 'missing_evidence', 'unit_mismatch']; // sorted
const RISK_LEVELS = ['critical', 'high', 'low', 'medium']; // sorted
const FEEDBACK_TYPES = ['confirm', 'false_positive', 'fix_note', 'insufficient_evidence', 'request_review', 'supplement']; // sorted
const TRIAGE_STATUSES = ['disputed', 'resolved', 'triaged']; // sorted
const SOURCE_TYPES = ['audit_rule', 'env_config', 'failure_diagnosis', 'normalized_fact', 'repro_method', 'verified_case']; // sorted
const PROBLEM_KEYS = ['conflict_fields', 'unit_mismatch_fields', 'missing_evidence_fields'];
const PROJECT_ROLE_RANK: Record<string, number> = { viewer: 0, reviewer: 1, researcher: 2, project_lead: 3 };

const PROVENANCE_MAP: Record<string, string> = {
  verified_case: 'historical_case',
  normalized_fact: 'historical_case',
  failure_diagnosis: 'historical_case',
  audit_rule: 'external_knowledge',
  repro_method: 'external_knowledge',
  env_config: 'external_knowledge',
};
const PROVENANCE_CLASSES: Record<string, string> = {
  current_evidence: '当前论文/材料原始证据，最高优先，来自被审计对象本身',
  historical_case: '历史基准案例/标准化事实/失败诊断，仅供参考，不得覆盖当前事实',
  external_knowledge: '审计规则/复现方法/环境配置等外部知识',
  model_inference: '大模型合成内容，必须显式标注，不得冒充证据',
};
const CURRENT_EVIDENCE_PRIORITY_NOTE =
  '当前论文原始证据（current_evidence）永远优先；历史案例（historical_case）与' +
  '外部知识（external_knowledge）只能补充参考，不得覆盖或改写当前事实。';

// ============================ 通用工具 ============================

const isNil = (v: any): boolean => v === null || v === undefined;
const isPlainObject = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
// Python 真值：空 dict / 空 list / 0 / '' / None / False 均为假。
function pyTruthy(v: any): boolean {
  if (isNil(v)) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}
// Python list repr（用于错误消息与列表排序键）。
function pyRepr(v: any): string {
  if (isNil(v)) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  return '{' + Object.entries(v).map(([k, val]) => pyRepr(k) + ': ' + pyRepr(val)).join(', ') + '}';
}
const pyList = (arr: string[]): string => '[' + arr.map(x => `'${x}'`).join(', ') + ']';
// Python round（half-even）近似；用于指标 / 通过率 / 分数。
function roundNd(x: number, n: number): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, n);
  const scaled = x * f;
  const floored = Math.floor(scaled);
  const diff = scaled - floored;
  let r: number;
  if (diff > 0.5) r = floored + 1;
  else if (diff < 0.5) r = floored;
  else r = floored % 2 === 0 ? floored : floored + 1;
  return r / f;
}
const round4 = (x: number): number => roundNd(x, 4);
const round6 = (x: number): number => roundNd(x, 6);
const dumps = (v: any): string => JSON.stringify(v);
// trail_service._dump：None→null；str 原样；其余 JSON。
const dumpTrail = (v: any): string | null => (isNil(v) ? null : typeof v === 'string' ? v : JSON.stringify(v));
// pydantic bool  coercion（'false'/'0' → false）。
function coerceBool(v: any, def: boolean): boolean {
  if (isNil(v)) return def;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(s)) return true;
    if (['false', '0', 'no', 'off', ''].includes(s)) return false;
    return def;
  }
  return Boolean(v);
}
const loads = (text: any): any => parseJson(text, {});
// feedback_service._loads：解析失败 {}；非 dict → {"value": v}。
function feedbackLoads(text: any): Record<string, any> {
  if (!pyTruthy(text)) return {};
  const v = parseJson(text, null);
  if (v === null) return {};
  return isPlainObject(v) ? v : { value: v };
}

function normalizeFieldKey(raw: any): [string, string] {
  let key = String(raw ?? '').trim().toLowerCase().replace(/-/g, '_');
  key = key.replace(/\s+/g, ' ');
  return FIELD_ALIASES[key] ?? [key, key];
}

// rule_service._to_num：百分比感知（"76.1%" → 0.761），去逗号 / 空白；bool/None → None。
const FLOAT_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function toNum(value: any): number | null {
  if (isNil(value) || typeof value === 'boolean') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim().replace(/,/g, '');
  if (!s) return null;
  if (s.endsWith('%')) {
    const inner = toNum(s.slice(0, -1));
    return inner === null ? null : inner / 100.0;
  }
  if (FLOAT_RE.test(s)) return Number(s);
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity;
  if (/^nan$/i.test(s)) return NaN;
  return null;
}

// rule_service._coerce：标量或富字典 → (value, unit, evidence_ref)。
function coerce(entry: any): [any, string, string] {
  if (isPlainObject(entry)) {
    const value = 'value' in entry ? entry.value
      : 'normalized_value' in entry ? entry.normalized_value
        : 'raw_value' in entry ? entry.raw_value : null;
    const unit = String(entry.unit || '');
    const ev = String(entry.evidence_ref || entry.evidence_chunk_id || '');
    return [value, unit, ev];
  }
  return [entry, '', ''];
}

function sides(sampleInput: any): [Record<string, any>, Record<string, any>] {
  const pick = (k1: string, k2: string): any => {
    const v1 = sampleInput?.[k1];
    if (pyTruthy(v1)) return v1;
    const v2 = sampleInput?.[k2];
    if (pyTruthy(v2)) return v2;
    return {};
  };
  const a = pick('a', 'paper');
  const b = pick('b', 'repro');
  if (!isPlainObject(a) || !isPlainObject(b)) {
    throw new AppError('VALIDATION_ERROR', '样本 input 的 a/b（或 paper/repro）须为对象。');
  }
  return [a, b];
}

function indexSide(side: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [rawKey, entry] of Object.entries(side)) {
    out[normalizeFieldKey(rawKey)[0]] = entry;
  }
  return out;
}

// rule_service._compare：单位不一致 → False；数值字段相对容差；其余数值绝对容差；否则归一化字符串。
function compare(key: string, va: any, vb: any, ua: string, ub: string, tol: number): boolean | null {
  if (ua && ub && ua.trim().toLowerCase() !== ub.trim().toLowerCase()) return false;
  const na = toNum(va);
  const nb = toNum(vb);
  if (NUMERIC_FIELDS.has(key)) {
    if (na === null || nb === null) return null;
    return Math.abs(na - nb) <= tol * Math.max(Math.abs(na), Math.abs(nb), 1.0);
  }
  if (na !== null && nb !== null) return Math.abs(na - nb) <= tol;
  const sa = isNil(va) ? '' : String(va).trim().toLowerCase();
  const sb = isNil(vb) ? '' : String(vb).trim().toLowerCase();
  return sa === sb;
}

// ============================ 确定性评估器（镜像 run_check） ============================

function runCheck(checkLogic: any, sampleInput: any): Record<string, any> {
  const ctype = (checkLogic || {}).type;
  if (!CHECK_TYPES.includes(ctype)) {
    throw new AppError('VALIDATION_ERROR', `未知检查逻辑类型：${ctype}，须为 ${pyList(CHECK_TYPES)}。`);
  }
  const [aRaw, bRaw] = sides(sampleInput);
  const a = indexSide(aRaw);
  const b = indexSide(bRaw);
  let fields: any[] = checkLogic.fields;
  if (!pyTruthy(fields)) {
    fields = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
  }
  const normalized = (fields as any[]).map(f => normalizeFieldKey(String(f))[0]);
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const f of normalized) {
    if (!seen.has(f)) { seen.add(f); uniq.push(f); }
  }
  const keys = uniq;

  if (ctype === 'field_compare') {
    const tolRaw = checkLogic.tolerance;
    const tol = isNil(tolRaw) ? REL_TOL : Number(tolRaw);
    const conflicts: string[] = [];
    const missing: string[] = [];
    const details: Record<string, any> = {};
    for (const key of keys) {
      const ea = a[key];
      const eb = b[key];
      if (isNil(ea) || isNil(eb)) {
        missing.push(key);
        details[key] = { status: 'missing' };
        continue;
      }
      const [va, ua] = coerce(ea);
      const [vb, ub] = coerce(eb);
      const eq = compare(key, va, vb, ua, ub, tol);
      if (eq === false) conflicts.push(key);
      details[key] = { a: va, b: vb, unit_a: ua, unit_b: ub, equal: eq };
    }
    const status = conflicts.length ? 'conflict' : (missing.length ? 'missing' : 'consistent');
    return { status, conflict_fields: conflicts.slice().sort(), missing_fields: missing.slice().sort(), details };
  }

  if (ctype === 'unit_mismatch') {
    const mism: string[] = [];
    const details: Record<string, any> = {};
    for (const key of keys) {
      const ea = a[key];
      const eb = b[key];
      if (isNil(ea) || isNil(eb)) {
        details[key] = { status: 'missing' };
        continue;
      }
      const [, ua] = coerce(ea);
      const [, ub] = coerce(eb);
      const bad = Boolean(ua && ub && ua.trim().toLowerCase() !== ub.trim().toLowerCase());
      if (bad) mism.push(key);
      details[key] = { unit_a: ua, unit_b: ub, mismatch: bad };
    }
    const status = mism.length ? 'conflict' : 'consistent';
    return { status, unit_mismatch_fields: mism.slice().sort(), details };
  }

  // missing_evidence
  const lacking: string[] = [];
  const details: Record<string, any> = {};
  for (const key of keys) {
    const ea = a[key];
    const eb = b[key];
    let bad = false;
    for (const entry of [ea, eb]) {
      if (isNil(entry)) continue;
      const [, , ev] = coerce(entry);
      if (!ev.trim()) bad = true;
    }
    if (bad) lacking.push(key);
    details[key] = { missing_evidence: bad };
  }
  const status = lacking.length ? 'conflict' : 'consistent';
  return { status, missing_evidence_fields: lacking.slice().sort(), details };
}

// rule_service._equal：递归子集（仅 expected 键参与）；列表按集合（repr 排序）；数值相对容差。
function equal(expected: any, actual: any, tol = 1e-9): boolean {
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    return Object.keys(expected).every(k => k in actual && equal(expected[k], actual[k], tol));
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    const byRepr = (x: any, y: any): number => {
      const rx = pyRepr(x); const ry = pyRepr(y);
      return rx < ry ? -1 : rx > ry ? 1 : 0;
    };
    const se = expected.slice().sort(byRepr);
    const sa = actual.slice().sort(byRepr);
    return se.every((e, i) => equal(e, sa[i], tol));
  }
  if (typeof expected === 'boolean' || typeof actual === 'boolean') return expected === actual;
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(expected - actual) <= tol * Math.max(Math.abs(expected), Math.abs(actual), 1.0);
  }
  return expected === actual;
}
const samplePasses = (expected: any, prediction: any): boolean => equal(expected ?? {}, prediction ?? {});

// ============================ 权限 / 访问（镜像 api/deps.py） ============================

async function userHasPermission(db: Db, user: UserRow, perm: string, opts: { org_id?: string | null; project_id?: string | null }): Promise<boolean> {
  if (user.is_platform_admin) return true;
  let orgId = opts.org_id ?? null;
  const projectId = opts.project_id ?? null;
  if (projectId && !orgId) {
    const proj = one(await db.from('projects').select('*').eq('id', projectId).limit(1));
    orgId = proj?.org_id ?? null;
  }
  if (orgId) {
    const orole = await orgRole(db, orgId, user.id);
    if (orole === 'org_admin') return true;
    if (orole && await hasPermission(db, orole, perm)) return true;
  }
  if (projectId) {
    const prole = await projectRole(db, projectId, user.id);
    if (prole && await hasPermission(db, prole, perm)) return true;
  }
  return false;
}

async function resolveProjectAccess(db: Db, projectId: string, user: UserRow, minRank = 0): Promise<any> {
  const proj = one(await db.from('projects').select('*').eq('id', projectId).limit(1));
  if (!proj) throw new AppError('NOT_FOUND', '项目不存在或无权访问。');
  if (user.is_platform_admin) return proj;
  if (proj.org_id) {
    const orole = await orgRole(db, proj.org_id, user.id);
    if (orole === 'org_admin') return proj;
  }
  const prole = await projectRole(db, projectId, user.id);
  if (!prole) throw new AppError('NOT_FOUND', '项目不存在或无权访问。');
  if ((PROJECT_ROLE_RANK[prole] ?? 0) < minRank) throw new AppError('FORBIDDEN', '当前角色无权执行此操作。');
  return proj;
}

async function resolveRuleOrg(db: Db, user: UserRow): Promise<string | null> {
  if (user.is_platform_admin) {
    const m = one(await db.from('org_members').select('*').eq('user_id', user.id).limit(1));
    return m?.org_id ?? null;
  }
  const memberships = rows(await db.from('org_members').select('*').eq('user_id', user.id).limit(1000));
  for (const m of memberships) {
    if (await userHasPermission(db, user, 'rule.manage', { org_id: m.org_id })) return m.org_id;
  }
  throw new AppError('FORBIDDEN', '缺少权限：rule.manage（需要组织管理员）。');
}

async function userOrgIds(db: Db, user: UserRow): Promise<string[]> {
  const ms = rows(await db.from('org_members').select('*').eq('user_id', user.id).limit(1000));
  return ms.map(m => m.org_id);
}

async function canManageKnowledge(db: Db, user: UserRow): Promise<string | null> {
  if (user.is_platform_admin) {
    const orgs = await userOrgIds(db, user);
    return orgs.length ? orgs[0] : null;
  }
  for (const orgId of await userOrgIds(db, user)) {
    if (await userHasPermission(db, user, 'rule.manage', { org_id: orgId })) return orgId;
  }
  const pms = rows(await db.from('project_members').select('*').eq('user_id', user.id).limit(1000));
  for (const pm of pms) {
    if (await userHasPermission(db, user, 'case.manage', { project_id: pm.project_id })) {
      const proj = one(await db.from('projects').select('*').eq('id', pm.project_id).limit(1));
      return proj?.org_id ?? null;
    }
  }
  throw new AppError('FORBIDDEN', '缺少权限：rule.manage 或 case.manage。');
}

// ============================ 审计轨迹（镜像 trail_service.record_trail） ============================

async function recordTrail(db: Db, p: {
  action: string; actor_user_id?: string | null; org_id?: string | null; project_id?: string | null;
  target_type?: string; target_id?: string; before?: any; after?: any; summary?: string; request_id?: string;
}): Promise<void> {
  await one(await db.from('audit_trail').insert({
    id: newId('trail'),
    org_id: p.org_id ?? null,
    project_id: p.project_id ?? null,
    actor_user_id: p.actor_user_id ?? null,
    action: p.action,
    target_type: p.target_type ?? '',
    target_id: p.target_id ?? '',
    before_json: dumpTrail(p.before),
    after_json: dumpTrail(p.after),
    summary: p.summary ?? '',
    request_id: p.request_id ?? '',
    created_at: nowIso(),
  }).select('*'));
}

// ============================ 视图 ============================

function ruleView(rule: any, activeLogic?: any): Record<string, any> {
  const out: Record<string, any> = {
    id: rule.id, rule_key: rule.rule_key, name: rule.name, domain: rule.domain || '',
    description: rule.description || '', risk_level: rule.risk_level,
    evidence_requirement: rule.evidence_requirement || '', current_version: rule.current_version,
    is_enabled: rule.is_enabled, created_by: rule.created_by,
    created_at: rule.created_at || '', updated_at: rule.updated_at || '',
  };
  if (activeLogic !== undefined) out.check_logic = activeLogic;
  return out;
}
function versionView(v: any, sampleCount = 0): Record<string, any> {
  return {
    id: v.id, rule_id: v.rule_id, version: v.version,
    check_logic: loads(v.check_logic_json), change_note: v.change_note || '',
    is_active: v.is_active, created_by: v.created_by, sample_count: sampleCount,
    created_at: v.created_at || '',
  };
}
function feedbackView(f: any): Record<string, any> {
  return {
    id: f.id, project_id: f.project_id, finding_id: f.finding_id, run_id: f.run_id,
    user_id: f.user_id, feedback_type: f.feedback_type, note: f.note || '',
    evidence_ref: f.evidence_ref || '', context: feedbackLoads(f.context_json), status: f.status,
    created_at: f.created_at || '', resolved_by: f.resolved_by, resolved_at: f.resolved_at || null,
  };
}
function docView(d: any): Record<string, any> {
  return {
    id: d.id, source_type: d.source_type, source_ref: d.source_ref || '',
    title: d.title, content: d.content, org_id: d.org_id, is_public: d.is_public,
    created_by: d.created_by, provenance_class: PROVENANCE_MAP[d.source_type] ?? 'external_knowledge',
    created_at: d.created_at || '',
  };
}

// ============================ 规则数据访问 ============================

async function getRule(db: Db, ruleId: string): Promise<any> {
  const rule = one(await db.from('audit_rules').select('*').eq('id', ruleId).limit(1));
  if (!rule) throw new AppError('NOT_FOUND', '审计规则不存在。');
  return rule;
}
async function activeVersion(db: Db, rule: any): Promise<any> {
  let v = one(await db.from('audit_rule_versions').select('*').eq('rule_id', rule.id).eq('is_active', true).limit(1));
  if (!v) v = one(await db.from('audit_rule_versions').select('*').eq('rule_id', rule.id).eq('version', rule.current_version).limit(1));
  if (!v) throw new AppError('NOT_FOUND', '规则没有可用版本。');
  return v;
}
async function samplesOf(db: Db, versionId: string): Promise<any[]> {
  return rows(await db.from('rule_test_samples').select('*').eq('rule_version_id', versionId).limit(1000));
}
function validateLogic(logic: any): void {
  if (!isPlainObject(logic) || !CHECK_TYPES.includes(logic.type)) {
    throw new AppError('VALIDATION_ERROR', `check_logic_json.type 须为 ${pyList(CHECK_TYPES)}。`);
  }
}
function validateSamples(samples: any[]): void {
  for (const s of samples) {
    if (!isPlainObject(s) || !isPlainObject(s.input) || !isPlainObject(s.expected)) {
      throw new AppError('VALIDATION_ERROR', '每条测试样本须包含 input 与 expected 对象。');
    }
  }
}
async function insertSamples(db: Db, versionId: string, samples: any[]): Promise<void> {
  if (!samples.length) return;
  await rows(await db.from('rule_test_samples').insert(samples.map(s => ({
    id: newId('rts'), rule_version_id: versionId,
    input_json: dumps(s.input), expected_json: dumps(s.expected), label: s.label ?? '',
  }))).select('*'));
}
async function displayNames(db: Db, ids: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  const us = rows(await db.from('users').select('id,display_name').in('id', ids).limit(1000));
  for (const u of us) out[u.id] = u.display_name;
  return out;
}

// ============================ 默认规则种子（镜像 _default_rules） ============================

function defaultRules(): any[] {
  return [
    {
      rule_key: 'param_consistency', name: '参数一致性校验', domain: '机器学习',
      description: '比对论文与复现配置的关键超参数，数值按相对容差，字符串归一化；镜像第二层程序化比对。',
      risk_level: 'high', evidence_requirement: '需论文侧与复现侧双侧原文证据。',
      check_logic: { type: 'field_compare', fields: ['learning_rate', 'batch_size', 'epochs', 'optimizer'], tolerance: REL_TOL, severity: 'high' },
      samples: [
        { label: 'consistent_case', input: { a: { learning_rate: 0.001, batch_size: 64, epochs: 100, optimizer: 'AdamW' }, b: { learning_rate: 0.001, batch_size: 64, epochs: 100, optimizer: 'adamw' } }, expected: { status: 'consistent', conflict_fields: [] } },
        { label: 'batch_size_conflict', input: { a: { learning_rate: 0.001, batch_size: 64, epochs: 100, optimizer: 'AdamW' }, b: { learning_rate: 0.001, batch_size: 32, epochs: 100, optimizer: 'AdamW' } }, expected: { status: 'conflict', conflict_fields: ['batch_size'] } },
        { label: 'missing_epochs', input: { a: { learning_rate: 0.001, batch_size: 64, epochs: 100, optimizer: 'AdamW' }, b: { learning_rate: 0.001, batch_size: 64, optimizer: 'AdamW' } }, expected: { status: 'missing', missing_fields: ['epochs'] } },
      ],
    },
    {
      rule_key: 'unit_mismatch', name: '单位不一致检测', domain: '机器学习',
      description: '同一字段两侧单位不同即判冲突，避免把不同量纲的数值误判为一致。',
      risk_level: 'medium', evidence_requirement: '需标注两侧单位来源。',
      check_logic: { type: 'unit_mismatch', fields: ['learning_rate', 'batch_size'], severity: 'medium' },
      samples: [
        { label: 'same_unit', input: { a: { learning_rate: { value: 0.001, unit: '' }, batch_size: { value: 64, unit: 'samples' } }, b: { learning_rate: { value: 0.001, unit: '' }, batch_size: { value: 64, unit: 'samples' } } }, expected: { status: 'consistent', unit_mismatch_fields: [] } },
        { label: 'unit_conflict', input: { a: { learning_rate: { value: 0.001, unit: '' }, batch_size: { value: 64, unit: 'samples' } }, b: { learning_rate: { value: 0.001, unit: '' }, batch_size: { value: 64, unit: 'steps' } } }, expected: { status: 'conflict', unit_mismatch_fields: ['batch_size'] } },
      ],
    },
    {
      rule_key: 'missing_evidence', name: '证据缺失检测', domain: '通用',
      description: '字段任一侧缺少证据引用（evidence_ref）即标记，确保结论可溯源。',
      risk_level: 'high', evidence_requirement: '每个参与比对的字段都须有 evidence_ref。',
      check_logic: { type: 'missing_evidence', fields: ['learning_rate', 'batch_size'], severity: 'high' },
      samples: [
        { label: 'all_evidenced', input: { a: { learning_rate: { value: 0.001, evidence_ref: 'p_001' }, batch_size: { value: 64, evidence_ref: 'p_002' } }, b: { learning_rate: { value: 0.001, evidence_ref: 'c_001' }, batch_size: { value: 64, evidence_ref: 'c_002' } } }, expected: { status: 'consistent', missing_evidence_fields: [] } },
        { label: 'evidence_missing', input: { a: { learning_rate: { value: 0.001, evidence_ref: 'p_001' }, batch_size: { value: 64, evidence_ref: 'p_002' } }, b: { learning_rate: { value: 0.001, evidence_ref: 'c_001' }, batch_size: { value: 64 } } }, expected: { status: 'conflict', missing_evidence_fields: ['batch_size'] } },
      ],
    },
  ];
}

async function seedDefaultRules(db: Db, user: UserRow, rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const seeded: string[] = [];
  const skipped: string[] = [];
  for (const spec of defaultRules()) {
    const exists = one(await db.from('audit_rules').select('*').eq('rule_key', spec.rule_key).limit(1));
    if (exists) { skipped.push(spec.rule_key); continue; }
    const rule = one(await db.from('audit_rules').insert({
      id: newId('rule'), rule_key: spec.rule_key, name: spec.name, domain: spec.domain,
      description: spec.description, risk_level: spec.risk_level, evidence_requirement: spec.evidence_requirement,
      current_version: 1, is_enabled: true, created_by: user.id, created_at: nowIso(), updated_at: nowIso(),
    }).select('*'));
    const v = one(await db.from('audit_rule_versions').insert({
      id: newId('rv'), rule_id: rule.id, version: 1, check_logic_json: dumps(spec.check_logic),
      change_note: '默认规则初始版本', created_by: user.id, is_active: true, created_at: nowIso(),
    }).select('*'));
    await insertSamples(db, v.id, spec.samples);
    seeded.push(spec.rule_key);
  }
  if (seeded.length) {
    await recordTrail(db, {
      action: 'rule.seed', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule',
      target_id: seeded.join(','), after: { seeded }, summary: '初始化默认审计规则', request_id: rid,
    });
  }
  return { seeded, skipped, total: seeded.length + skipped.length };
}

// ============================ 规则 CRUD / 版本 ============================

async function createRule(db: Db, user: UserRow, payload: any, rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const ruleKey = String(payload?.rule_key ?? '').trim();
  const name = String(payload?.name ?? '').trim();
  if (!ruleKey || !name) throw new AppError('VALIDATION_ERROR', 'rule_key 与 name 不能为空。');
  if (!/^[a-z0-9_\-]{2,80}$/.test(ruleKey)) {
    throw new AppError('VALIDATION_ERROR', 'rule_key 仅允许小写字母 / 数字 / 下划线 / 连字符（2-80 位）。');
  }
  const logic = pyTruthy(payload?.check_logic_json) ? payload.check_logic_json
    : pyTruthy(payload?.check_logic) ? payload.check_logic : {};
  validateLogic(logic);
  const risk = payload?.risk_level ?? 'medium';
  if (!RISK_LEVELS.includes(risk)) throw new AppError('VALIDATION_ERROR', `risk_level 须为 ${pyList(RISK_LEVELS)}。`);
  const exists = one(await db.from('audit_rules').select('*').eq('rule_key', ruleKey).limit(1));
  if (exists) throw new AppError('CONFLICT', `规则键已存在：${ruleKey}。`);
  const samples = payload?.test_samples || [];
  validateSamples(samples);

  const rule = one(await db.from('audit_rules').insert({
    id: newId('rule'), rule_key: ruleKey, name, domain: payload?.domain ?? '',
    description: payload?.description ?? '', risk_level: risk, evidence_requirement: payload?.evidence_requirement ?? '',
    current_version: 1, is_enabled: coerceBool(payload?.is_enabled, true), created_by: user.id,
    created_at: nowIso(), updated_at: nowIso(),
  }).select('*'));
  const v = one(await db.from('audit_rule_versions').insert({
    id: newId('rv'), rule_id: rule.id, version: 1, check_logic_json: dumps(logic),
    change_note: payload?.change_note ?? '初始版本', created_by: user.id, is_active: true, created_at: nowIso(),
  }).select('*'));
  await insertSamples(db, v.id, samples);
  await recordTrail(db, {
    action: 'rule.create', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule', target_id: rule.id,
    after: { rule_key: ruleKey, version: 1, check_logic: logic }, summary: `创建审计规则 ${ruleKey}`, request_id: rid,
  });
  return ruleView(rule, logic);
}

async function listRules(db: Db, domain: string | null, isEnabled: boolean | null): Promise<any[]> {
  let rules = rows(await db.from('audit_rules').select('*').order('created_at', { ascending: true }).limit(1000));
  if (domain) rules = rules.filter(r => r.domain === domain);
  if (isEnabled !== null) rules = rules.filter(r => r.is_enabled === isEnabled);
  const out: any[] = [];
  for (const r of rules) {
    const v = await activeVersion(db, r);
    out.push(ruleView(r, loads(v.check_logic_json)));
  }
  return out;
}

async function getRuleDetail(db: Db, ruleId: string): Promise<any> {
  const rule = await getRule(db, ruleId);
  const v = await activeVersion(db, rule);
  const samples = await samplesOf(db, v.id);
  const data = ruleView(rule, loads(v.check_logic_json));
  data.active_version = versionView(v, samples.length);
  data.test_samples = samples.map(s => ({ id: s.id, label: s.label, input: loads(s.input_json), expected: loads(s.expected_json) }));
  return data;
}

async function setEnabled(db: Db, user: UserRow, ruleId: string, isEnabled: boolean, rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const rule = await getRule(db, ruleId);
  const before = rule.is_enabled;
  const updated = one(await db.from('audit_rules').update({ is_enabled: isEnabled, updated_at: nowIso() }).eq('id', rule.id).select('*'));
  await recordTrail(db, {
    action: isEnabled ? 'rule.enable' : 'rule.disable', actor_user_id: user.id, org_id: orgId,
    target_type: 'audit_rule', target_id: rule.id, before: { is_enabled: before }, after: { is_enabled: updated.is_enabled },
    summary: isEnabled ? '启用规则' : '停用规则', request_id: rid,
  });
  return ruleView(updated);
}

async function createVersion(db: Db, user: UserRow, ruleId: string, logic: any, changeNote: string, testSamples: any[], rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const rule = await getRule(db, ruleId);
  validateLogic(logic);
  if (!testSamples || testSamples.length < 1) {
    throw new AppError('VALIDATION_ERROR', '新版本必须附带至少 1 条测试样本（先离线验证再上生产）。');
  }
  validateSamples(testSamples);
  const oldVersion = rule.current_version;
  const oldActive = await activeVersion(db, rule);
  const before = { current_version: oldVersion, check_logic: loads(oldActive.check_logic_json) };
  await rows(await db.from('audit_rule_versions').update({ is_active: false }).eq('rule_id', rule.id).select('*'));
  const newNo = oldVersion + 1;
  const nv = one(await db.from('audit_rule_versions').insert({
    id: newId('rv'), rule_id: rule.id, version: newNo, check_logic_json: dumps(logic),
    change_note: changeNote || '', created_by: user.id, is_active: true, created_at: nowIso(),
  }).select('*'));
  await insertSamples(db, nv.id, testSamples);
  await one(await db.from('audit_rules').update({ current_version: newNo, updated_at: nowIso() }).eq('id', rule.id).select('*'));
  await recordTrail(db, {
    action: 'rule.version_create', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule', target_id: rule.id,
    before, after: { current_version: newNo, check_logic: logic, change_note: changeNote },
    summary: `规则 ${rule.rule_key} 新版本 v${newNo}`, request_id: rid,
  });
  return { rule_id: rule.id, current_version: newNo, version: versionView(nv, testSamples.length) };
}

async function listVersions(db: Db, ruleId: string): Promise<any[]> {
  const rule = await getRule(db, ruleId);
  const vs = rows(await db.from('audit_rule_versions').select('*').eq('rule_id', rule.id).order('version', { ascending: false }).limit(1000));
  const out: any[] = [];
  for (const v of vs) {
    const samples = await samplesOf(db, v.id);
    out.push(versionView(v, samples.length));
  }
  return out;
}

async function rollback(db: Db, user: UserRow, ruleId: string, version: number, rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const rule = await getRule(db, ruleId);
  const target = one(await db.from('audit_rule_versions').select('*').eq('rule_id', rule.id).eq('version', version).limit(1));
  if (!target) throw new AppError('NOT_FOUND', `目标版本不存在：v${version}。`);
  const targetLogic = loads(target.check_logic_json);
  const targetSamples = await samplesOf(db, target.id);
  const oldVersion = rule.current_version;
  const oldActive = await activeVersion(db, rule);
  const before = { current_version: oldVersion, check_logic: loads(oldActive.check_logic_json) };
  await rows(await db.from('audit_rule_versions').update({ is_active: false }).eq('rule_id', rule.id).select('*'));
  const newNo = oldVersion + 1;
  const nv = one(await db.from('audit_rule_versions').insert({
    id: newId('rv'), rule_id: rule.id, version: newNo, check_logic_json: dumps(targetLogic),
    change_note: `回滚自 v${version}`, created_by: user.id, is_active: true, created_at: nowIso(),
  }).select('*'));
  // 复制目标版本样本（保留原始 JSON 文本），保证回滚后仍可离线测试。
  if (targetSamples.length) {
    await rows(await db.from('rule_test_samples').insert(targetSamples.map(s => ({
      id: newId('rts'), rule_version_id: nv.id, input_json: s.input_json, expected_json: s.expected_json, label: s.label,
    }))).select('*'));
  }
  await one(await db.from('audit_rules').update({ current_version: newNo, updated_at: nowIso() }).eq('id', rule.id).select('*'));
  await recordTrail(db, {
    action: 'rule.rollback', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule', target_id: rule.id,
    before, after: { current_version: newNo, rolled_back_to: version, check_logic: targetLogic },
    summary: `规则 ${rule.rule_key} 回滚到 v${version}（生成 v${newNo}）`, request_id: rid,
  });
  return { rule_id: rule.id, rolled_back_to: version, current_version: newNo, check_logic: targetLogic, version: versionView(nv, targetSamples.length) };
}

async function runRuleTests(db: Db, user: UserRow, ruleId: string): Promise<any> {
  await resolveRuleOrg(db, user);
  const rule = await getRule(db, ruleId);
  const v = await activeVersion(db, rule);
  const logic = loads(v.check_logic_json);
  const samples = await samplesOf(db, v.id);
  const results: any[] = [];
  let passed = 0;
  for (const s of samples) {
    const inp = loads(s.input_json);
    const exp = loads(s.expected_json);
    let pred: any; let okSample: boolean; let err: string | null;
    try {
      pred = runCheck(logic, inp);
      okSample = samplePasses(exp, pred);
      err = null;
    } catch (exc) {
      if (exc instanceof AppError) { pred = {}; okSample = false; err = exc.message; }
      else throw exc;
    }
    if (okSample) passed += 1;
    results.push({ sample_id: s.id, label: s.label, passed: okSample, expected: exp, actual: pred, error: err });
  }
  const total = samples.length;
  const passRate = total ? passed / total : 0.0;
  return { rule_id: rule.id, version: v.version, total, passed, failed: total - passed, pass_rate: round4(passRate), results };
}

async function listEvaluations(db: Db, ruleId: string): Promise<any[]> {
  const rule = await getRule(db, ruleId);
  const es = rows(await db.from('rule_evaluations').select('*').eq('rule_id', rule.id).order('created_at', { ascending: false }).limit(1000));
  const runnerIds = Array.from(new Set(es.map(e => e.ran_by).filter((x: any) => !!x)));
  const runners = await displayNames(db, runnerIds);
  return es.map(e => ({
    id: e.id, rule_id: e.rule_id, version: e.version, dataset_ref: e.dataset_ref || '',
    metrics: loads(e.metrics_json), ran_by: e.ran_by, ran_by_name: runners[e.ran_by] ?? null,
    created_at: e.created_at || '',
  }));
}

// ============================ 离线评估（镜像 rule_eval.py） ============================

const expectedPositive = (expected: any): boolean => {
  if (!isPlainObject(expected)) return false;
  if (expected.status === 'conflict') return true;
  return PROBLEM_KEYS.some(k => pyTruthy(expected[k]));
};
const predictedPositive = (prediction: any): boolean => isPlainObject(prediction) && prediction.status === 'conflict';

function computeMetrics(logic: any, samples: any[]): { metrics: Record<string, any>; results: any[] } {
  let tp = 0; let fp = 0; let fn = 0; let tn = 0; let matched = 0;
  const results: any[] = [];
  const started = Date.now();
  samples.forEach((s, idx) => {
    const inp = s.input || {};
    const exp = s.expected || {};
    const label = (s.label ?? '') || `sample_${idx}`;
    let pred: any; let err: string | null;
    try { pred = runCheck(logic, inp); err = null; }
    catch (exc) {
      if (exc instanceof AppError) { pred = {}; err = exc.message; }
      else throw exc;
    }
    const gt = expectedPositive(exp);
    const pp = predictedPositive(pred);
    if (gt && pp) tp += 1;
    else if (!gt && pp) fp += 1;
    else if (gt && !pp) fn += 1;
    else tn += 1;
    const fullMatch = samplePasses(exp, pred);
    if (fullMatch) matched += 1;
    results.push({ label, expected_positive: gt, predicted_positive: pp, matched: fullMatch, expected: exp, actual: pred, error: err });
  });
  const runtimeMs = Math.trunc(Date.now() - started);
  const total = samples.length;
  const ratio = (n: number, d: number): number => (d ? round4(n / d) : 0.0);
  const metrics = {
    total, tp, fp, fn, tn,
    precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn),
    fp_rate: ratio(fp, fp + tn), fn_rate: ratio(fn, fn + tp),
    accuracy: ratio(tp + tn, total), pass_rate: ratio(matched, total),
    runtime_ms: runtimeMs,
  };
  return { metrics, results };
}

async function versionLogic(db: Db, ruleId: string, version: number | null): Promise<[number, any]> {
  if (version === null) {
    const rule = await getRule(db, ruleId);
    const v = await activeVersion(db, rule);
    return [v.version, loads(v.check_logic_json)];
  }
  const row = one(await db.from('audit_rule_versions').select('*').eq('rule_id', ruleId).eq('version', version).limit(1));
  if (!row) throw new AppError('NOT_FOUND', `版本不存在：v${version}。`);
  return [row.version, loads(row.check_logic_json)];
}

async function persistEvaluation(db: Db, ruleId: string, version: number, datasetRef: string, metrics: any, user: UserRow): Promise<void> {
  await one(await db.from('rule_evaluations').insert({
    id: newId('reval'), rule_id: ruleId, version, dataset_ref: datasetRef || '',
    metrics_json: dumps(metrics), ran_by: user.id, created_at: nowIso(),
  }).select('*'));
}

async function evaluateRule(db: Db, user: UserRow, ruleId: string, datasetRef: string, samples: any[], baselineVersion: number | null, rid: string): Promise<any> {
  const orgId = await resolveRuleOrg(db, user);
  const rule = await getRule(db, ruleId);
  if (!samples || !samples.length) throw new AppError('VALIDATION_ERROR', '评估样本不能为空。');
  for (const s of samples) {
    if (!isPlainObject(s) || !isPlainObject(s.input) || !isPlainObject(s.expected)) {
      throw new AppError('VALIDATION_ERROR', '每条评估样本须包含 input 与 expected 对象。');
    }
  }
  const [curVersion, curLogic] = await versionLogic(db, ruleId, null);
  const cur = computeMetrics(curLogic, samples);
  await persistEvaluation(db, ruleId, curVersion, datasetRef, cur.metrics, user);

  if (baselineVersion === null) {
    await recordTrail(db, {
      action: 'rule.evaluate', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule', target_id: ruleId,
      after: { version: curVersion, dataset_ref: datasetRef, metrics: cur.metrics },
      summary: `规则 ${rule.rule_key} 离线评估 v${curVersion}`, request_id: rid,
    });
    return { rule_id: ruleId, version: curVersion, dataset_ref: datasetRef, metrics: cur.metrics, results: cur.results };
  }

  const [baseVersion, baseLogic] = await versionLogic(db, ruleId, baselineVersion);
  const base = computeMetrics(baseLogic, samples);
  await persistEvaluation(db, ruleId, baseVersion, datasetRef, base.metrics, user);
  const delta: Record<string, number> = {};
  for (const k of ['precision', 'recall', 'fp_rate', 'fn_rate', 'accuracy', 'pass_rate']) {
    delta[k] = round4(cur.metrics[k] - base.metrics[k]);
  }
  await recordTrail(db, {
    action: 'rule.evaluate_compare', actor_user_id: user.id, org_id: orgId, target_type: 'audit_rule', target_id: ruleId,
    before: { version: baseVersion, metrics: base.metrics },
    after: { version: curVersion, metrics: cur.metrics, delta },
    summary: `规则 ${rule.rule_key} 版本对比 v${baseVersion}→v${curVersion}`, request_id: rid,
  });
  return {
    rule_id: ruleId, dataset_ref: datasetRef,
    baseline: { version: baseVersion, metrics: base.metrics, results: base.results },
    candidate: { version: curVersion, metrics: cur.metrics, results: cur.results },
    delta,
  };
}

// ============================ 反馈治理（镜像 feedback_service.py） ============================

async function createFeedback(db: Db, user: UserRow, body: any, rid: string): Promise<any> {
  const projectId = String(body?.project_id ?? '').trim();
  if (!projectId) throw new AppError('VALIDATION_ERROR', '字段 project_id 必填且长度不超过 500。');
  const proj = await resolveProjectAccess(db, projectId, user);
  const feedbackType = String(body?.feedback_type ?? '');
  if (!FEEDBACK_TYPES.includes(feedbackType)) {
    throw new AppError('VALIDATION_ERROR', `feedback_type 须为 ${pyList(FEEDBACK_TYPES)}。`);
  }
  const note = String(body?.note ?? '');
  const evidenceRef = String(body?.evidence_ref ?? '');
  if (['supplement', 'fix_note', 'insufficient_evidence'].includes(feedbackType) && !note.trim() && !evidenceRef.trim()) {
    throw new AppError('VALIDATION_ERROR', '该反馈类型需提供 note 或 evidence_ref 说明。');
  }
  const ctx = isPlainObject(body?.context_json) ? body.context_json : {};
  const findingId = isNil(body?.finding_id) ? null : body.finding_id;
  const runId = isNil(body?.run_id) ? null : body.run_id;
  const f = one(await db.from('audit_feedback').insert({
    id: newId('fb'), project_id: projectId, finding_id: findingId, run_id: runId,
    user_id: user.id, feedback_type: feedbackType, context_json: dumps(ctx),
    evidence_ref: evidenceRef || '', note: note || '', status: 'open',
    created_at: nowIso(), resolved_by: null, resolved_at: null,
  }).select('*'));
  await recordTrail(db, {
    action: 'feedback.create', actor_user_id: user.id, org_id: proj.org_id, project_id: projectId,
    target_type: 'audit_feedback', target_id: f.id,
    after: { feedback_type: feedbackType, finding_id: findingId, status: 'open' },
    summary: '提交审计反馈（不自动改规则）', request_id: rid,
  });
  return feedbackView(f);
}

async function listFeedback(db: Db, user: UserRow, projectId: string, status: string | null): Promise<any[]> {
  await resolveProjectAccess(db, projectId, user);
  let q = db.from('audit_feedback').select('*').eq('project_id', projectId);
  if (status) q = q.eq('status', status);
  const fs = rows(await q.order('created_at', { ascending: false }).limit(1000));
  const userIds = Array.from(new Set([
    ...fs.map(f => f.user_id).filter((x: any) => !!x),
    ...fs.map(f => f.resolved_by).filter((x: any) => !!x),
  ]));
  const names = await displayNames(db, userIds);
  return fs.map(f => {
    const view = feedbackView(f);
    view.user_name = names[f.user_id] ?? null;
    view.resolved_by_name = f.resolved_by ? (names[f.resolved_by] ?? null) : null;
    return view;
  });
}

async function triageFeedback(db: Db, user: UserRow, feedbackId: string, status: string, resolution: string, rid: string): Promise<any> {
  const f = one(await db.from('audit_feedback').select('*').eq('id', feedbackId).limit(1));
  if (!f) throw new AppError('NOT_FOUND', '反馈不存在。');
  const proj = await resolveProjectAccess(db, f.project_id, user);
  if (!(await userHasPermission(db, user, 'finding.review', { project_id: f.project_id }))) {
    throw new AppError('FORBIDDEN', '缺少权限：finding.review（需要审核人员及以上）。');
  }
  if (!TRIAGE_STATUSES.includes(status)) {
    throw new AppError('VALIDATION_ERROR', `分诊状态须为 ${pyList(TRIAGE_STATUSES)}。`);
  }
  const before = { status: f.status };
  const ctx = feedbackLoads(f.context_json);
  ctx.resolution = resolution || '';
  ctx.triage_status = status;
  let reviewId: string | null = null;
  let resolvedBy: string | null;
  let resolvedAt: string | null;
  if (status === 'disputed') {
    const rr = one(await db.from('review_requests').insert({
      id: newId('rev'), project_id: f.project_id, target_type: 'feedback', target_id: f.id,
      requested_by: user.id, reviewer_user_id: null, status: 'pending', decision_note: '',
      created_at: nowIso(), decided_at: null,
    }).select('*'));
    reviewId = rr.id;
    resolvedBy = null;
    resolvedAt = null;
  } else {
    resolvedBy = user.id;
    resolvedAt = nowIso();
  }
  const updated = one(await db.from('audit_feedback').update({
    status, context_json: dumps(ctx), resolved_by: resolvedBy, resolved_at: resolvedAt,
  }).eq('id', f.id).select('*'));
  await recordTrail(db, {
    action: 'feedback.triage', actor_user_id: user.id, org_id: proj.org_id, project_id: f.project_id,
    target_type: 'audit_feedback', target_id: f.id, before,
    after: { status, resolution, review_id: reviewId },
    summary: status === 'disputed' ? '分诊反馈（争议转人工）' : '分诊反馈', request_id: rid,
  });
  const out = feedbackView(updated);
  out.review_id = reviewId;
  out.requires_human_review = status === 'disputed';
  return out;
}

// ============================ 受控 RAG（镜像 rag_service.py） ============================

function tokenize(text: any): string[] {
  const t = String(text ?? '').toLowerCase();
  const tokens: string[] = t.match(/[a-z0-9]+/g) || [];
  const cjk: string[] = t.match(/[\u4e00-\u9fff]/g) || [];
  tokens.push(...cjk);
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1]);
  return tokens;
}
function tf(tokens: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of tokens) out[t] = (out[t] ?? 0) + 1;
  return out;
}
function cosine(qv: Record<string, number>, dv: Record<string, number>): number {
  const qKeys = Object.keys(qv);
  const dKeys = Object.keys(dv);
  if (!qKeys.length || !dKeys.length) return 0.0;
  let dot = 0;
  for (const t of qKeys) dot += qv[t] * (dv[t] ?? 0.0);
  let nq = 0; for (const t of qKeys) nq += qv[t] * qv[t];
  let nd = 0; for (const t of dKeys) nd += dv[t] * dv[t];
  nq = Math.sqrt(nq); nd = Math.sqrt(nd);
  if (nq === 0.0 || nd === 0.0) return 0.0;
  return dot / (nq * nd);
}

async function visibleDocs(db: Db, user: UserRow): Promise<any[]> {
  const all = rows(await db.from('knowledge_documents').select('*').order('created_at', { ascending: true }).limit(1000));
  if (user.is_platform_admin) return all;
  const orgIds = new Set(await userOrgIds(db, user));
  return all.filter(d => d.is_public || (d.org_id && orgIds.has(d.org_id)) || d.created_by === user.id);
}

function retrieve(query: string, docs: any[], topK: number): any[] {
  const qTokens = tokenize(query);
  if (!qTokens.length || !docs.length) return [];
  const corpus = docs.map(d => [...tokenize(d.title), ...tokenize(d.title), ...tokenize(d.content)]);
  const n = docs.length;
  const df: Record<string, number> = {};
  for (const tokens of corpus) {
    for (const t of new Set(tokens)) df[t] = (df[t] ?? 0) + 1;
  }
  const idf: Record<string, number> = {};
  for (const [t, c] of Object.entries(df)) idf[t] = Math.log((n + 1) / (c + 1)) + 1.0;
  const defaultIdf = Math.log((n + 1) / 1) + 1.0;
  const qTf = tf(qTokens);
  const qv: Record<string, number> = {};
  for (const [t, c] of Object.entries(qTf)) qv[t] = c * (idf[t] ?? defaultIdf);
  const scored: [number, any][] = [];
  docs.forEach((d, i) => {
    const dv: Record<string, number> = {};
    for (const [t, c] of Object.entries(tf(corpus[i]))) dv[t] = c * (idf[t] ?? 0.0);
    const score = cosine(qv, dv);
    if (score > 0.0) scored.push([score, d]);
  });
  scored.sort((a, b) => (b[0] - a[0]) || (a[1].id < b[1].id ? -1 : a[1].id > b[1].id ? 1 : 0));
  return scored.slice(0, Math.max(1, topK)).map(([score, d]) => ({
    document: docView(d), score: round6(score), source_ref: d.source_ref || '',
    provenance_class: PROVENANCE_MAP[d.source_type] ?? 'external_knowledge',
  }));
}

// 可选合成：本 Edge Function 未注入 LLM 密钥，镜像后端 is_llm_configured=False 的优雅降级 → null。
// 绝不阻断确定性检索；不抛 DEMO_LIMIT（后端无密钥时同样返回 synthesis=null）。
async function synthesize(_query: string, _hits: any[]): Promise<any | null> {
  return null;
}

async function ragQuery(db: Db, user: UserRow, body: any, rid: string): Promise<any> {
  const query = typeof body?.query === 'string' ? body.query : '';
  if (!query.trim()) throw new AppError('VALIDATION_ERROR', 'query 不能为空。');
  const tkRaw = body?.top_k;
  let topK = isNil(tkRaw) || tkRaw === 0 || tkRaw === '' ? 5 : Math.trunc(Number(tkRaw));
  if (!Number.isFinite(topK)) topK = 5;
  topK = Math.max(1, Math.min(topK, 50));
  const projectId = isNil(body?.project_id) ? null : body.project_id;
  let priorityNote: string | null = null;
  if (projectId) {
    await resolveProjectAccess(db, projectId, user);
    priorityNote = CURRENT_EVIDENCE_PRIORITY_NOTE;
  }
  const docs = await visibleDocs(db, user);
  const hits = retrieve(query, docs, topK);
  const synthesis = coerceBool(body?.synthesize, false) ? await synthesize(query, hits) : null;
  return {
    query, project_id: projectId, top_k: topK, hits, total_candidates: docs.length,
    provenance: {
      classes: PROVENANCE_CLASSES,
      current_evidence_priority: priorityNote || CURRENT_EVIDENCE_PRIORITY_NOTE,
      note: '检索为确定性 TF-IDF，命中均带 source_ref 与 provenance_class；知识库内容永远不是 current_evidence。',
    },
    synthesis,
  };
}

async function listDocuments(db: Db, user: UserRow, sourceType: string | null): Promise<any[]> {
  let docs = await visibleDocs(db, user);
  if (sourceType) docs = docs.filter(d => d.source_type === sourceType);
  return docs.map(docView);
}

async function addDocument(db: Db, user: UserRow, body: any, rid: string): Promise<any> {
  const orgId = await canManageKnowledge(db, user);
  const sourceType = String(body?.source_type ?? '');
  if (!SOURCE_TYPES.includes(sourceType)) {
    throw new AppError('VALIDATION_ERROR', `source_type 须为 ${pyList(SOURCE_TYPES)}。`);
  }
  const title = String(body?.title ?? '');
  const content = String(body?.content ?? '');
  if (!title.trim() || !content.trim()) throw new AppError('VALIDATION_ERROR', 'title 与 content 不能为空。');
  const isPublic = coerceBool(body?.is_public, false);
  const d = one(await db.from('knowledge_documents').insert({
    id: newId('kd'), source_type: sourceType, source_ref: String(body?.source_ref ?? '') || '',
    title: title.trim(), content, org_id: orgId, is_public: isPublic, created_by: user.id, created_at: nowIso(),
  }).select('*'));
  await recordTrail(db, {
    action: 'rag.document_add', actor_user_id: user.id, org_id: orgId, target_type: 'knowledge_document', target_id: d.id,
    after: { source_type: sourceType, provenance_class: PROVENANCE_MAP[sourceType], is_public: isPublic },
    summary: `入库知识文档（${sourceType}）`, request_id: rid,
  });
  return docView(d);
}

// ============================ 路由挂载 ============================

export function register(router: Router, _deps: Deps): void {
  const user = (c: Call): UserRow => c.user as UserRow;

  // ---- 审计规则 ----
  router.get('/api/v1/rules', async (c) => {
    const domain = c.q.get('domain');
    const rawEnabled = c.q.get('is_enabled');
    let isEnabled: boolean | null = null;
    if (rawEnabled !== null && rawEnabled !== '') {
      const s = rawEnabled.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(s)) isEnabled = true;
      else if (['false', '0', 'no', 'off'].includes(s)) isEnabled = false;
      else throw new AppError('VALIDATION_ERROR', '参数 is_enabled 须为布尔值。');
    }
    const items = await listRules(c.db, domain || null, isEnabled);
    return { items, total: items.length };
  });

  router.post('/api/v1/rules', async (c) => createRule(c.db, user(c), c.body, c.rid));
  router.post('/api/v1/rules/seed', async (c) => seedDefaultRules(c.db, user(c), c.rid));

  router.get('/api/v1/rules/:rule_id', async (c) => getRuleDetail(c.db, c.params.rule_id));

  router.patch('/api/v1/rules/:rule_id', async (c) => {
    if (isNil(c.body?.is_enabled)) throw new AppError('VALIDATION_ERROR', '字段 is_enabled 必填。');
    return setEnabled(c.db, user(c), c.params.rule_id, coerceBool(c.body.is_enabled, true), c.rid);
  });

  router.post('/api/v1/rules/:rule_id/versions', async (c) => {
    const logic = c.body?.check_logic_json;
    const changeNote = String(c.body?.change_note ?? '');
    const samples = c.body?.test_samples || [];
    return createVersion(c.db, user(c), c.params.rule_id, logic, changeNote, samples, c.rid);
  });

  router.get('/api/v1/rules/:rule_id/versions', async (c) => {
    const items = await listVersions(c.db, c.params.rule_id);
    return { items, total: items.length };
  });

  router.post('/api/v1/rules/:rule_id/rollback', async (c) => {
    const v = Number(c.body?.version);
    if (!Number.isInteger(v)) throw new AppError('VALIDATION_ERROR', '字段 version 须为整数。');
    return rollback(c.db, user(c), c.params.rule_id, v, c.rid);
  });

  router.post('/api/v1/rules/:rule_id/test', async (c) => runRuleTests(c.db, user(c), c.params.rule_id));

  router.get('/api/v1/rules/:rule_id/evaluations', async (c) => {
    const items = await listEvaluations(c.db, c.params.rule_id);
    return { items, total: items.length };
  });

  router.post('/api/v1/rules/:rule_id/evaluate', async (c) => {
    let datasetRef = c.body?.dataset_ref ?? '';
    if (typeof datasetRef !== 'string') throw new AppError('VALIDATION_ERROR', '字段 dataset_ref 须为字符串。');
    if (datasetRef.length > 200) throw new AppError('VALIDATION_ERROR', '字段 dataset_ref 长度不超过 200。');
    const samples = c.body?.samples || [];
    const bvRaw = c.body?.baseline_version;
    let baselineVersion: number | null = null;
    if (!isNil(bvRaw)) {
      const bv = Number(bvRaw);
      if (!Number.isInteger(bv)) throw new AppError('VALIDATION_ERROR', '字段 baseline_version 须为整数。');
      baselineVersion = bv;
    }
    return evaluateRule(c.db, user(c), c.params.rule_id, datasetRef, samples, baselineVersion, c.rid);
  });

  // ---- 反馈治理 ----
  router.post('/api/v1/feedback', async (c) => createFeedback(c.db, user(c), c.body, c.rid));

  router.get('/api/v1/feedback', async (c) => {
    const projectId = c.q.get('project_id');
    if (!projectId) throw new AppError('VALIDATION_ERROR', '字段 project_id 必填且长度不超过 500。');
    const items = await listFeedback(c.db, user(c), projectId, c.q.get('status') || null);
    return { items, total: items.length };
  });

  router.post('/api/v1/feedback/:feedback_id/triage', async (c) => {
    const status = String(c.body?.status ?? '');
    const resolution = String(c.body?.resolution ?? '');
    return triageFeedback(c.db, user(c), c.params.feedback_id, status, resolution, c.rid);
  });

  // ---- 受控 RAG ----
  router.post('/api/v1/rag/query', async (c) => ragQuery(c.db, user(c), c.body, c.rid));

  router.get('/api/v1/rag/documents', async (c) => {
    const items = await listDocuments(c.db, user(c), c.q.get('source_type') || null);
    return { items, total: items.length };
  });

  router.post('/api/v1/rag/documents', async (c) => addDocument(c.db, user(c), c.body, c.rid));
}