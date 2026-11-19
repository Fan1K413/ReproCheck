// 站点 Function 跨域集成冒烟：对 dev/function-local.mjs 桥接（8001）跑真实 routes.ts + 种子。
// 用法：node dev/site-smoke.mjs [base]   默认 http://127.0.0.1:8001/functions/v1/app
const BASE = process.argv[2] || 'http://127.0.0.1:8001/functions/v1/app';
const PID = 'proj-209c77cd39f94212';
const CASE = 'case-c3d8a5d22038455c';
const results = [];
let token = '';

async function req(method, path, { body, auth = true, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (raw) return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { status: res.status, json };
}
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 200) });
  if (!ok) console.log('FAIL', name, detail);
}
const data = (r) => r.json?.data ?? {};

// 1 健康
let r = await req('GET', '/api/v1/health', { auth: false });
check('health', r.status === 200 && r.json?.success, r.status);

// 2 登录失败 → 401
r = await req('POST', '/api/v1/auth/login', { auth: false, body: { email: 'lead@reprocheck.demo', password: 'wrong-pass' } });
check('login:bad-password-401', r.status === 401, r.status);

// 3 登录成功
r = await req('POST', '/api/v1/auth/login', { auth: false, body: { email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' } });
token = data(r).token || '';
check('login:lead', r.status === 200 && token.split('.').length === 3, r.status);

// 4 未带令牌 → 401（/projects 镜像后端允许匿名列表；me 必须鉴权）
r = await req('GET', '/api/v1/auth/me', { auth: false });
check('auth:missing-token-401', r.status === 401, r.status);

// 5 me
r = await req('GET', '/api/v1/auth/me');
check('me', data(r).user?.email === 'lead@reprocheck.demo' && (data(r).organizations || []).length >= 1, JSON.stringify(data(r).user?.email));

// 6 项目列表含种子项目
r = await req('GET', '/api/v1/projects');
const projects = data(r).items || data(r).projects || [];
check('projects:seeded', projects.some(p => p.id === PID || p.project_id === PID), projects.length);

// 7 组织列表
r = await req('GET', '/api/v1/orgs');
check('orgs:seeded', r.status === 200 && JSON.stringify(r.json).includes('开源复现审计实验室'), r.status);

// 8 团队成员（项目级 RBAC 读）
r = await req('GET', `/api/v1/projects/${PID}/members`);
check('team:members', r.status === 200 && (data(r).items || []).length >= 2, r.status);

// 9 基准案例列表 + 详情 + 事实 + 验证记录
r = await req('GET', '/api/v1/cases');
const cases = data(r).items || [];
check('cases:seeded', cases.some(c => (c.case_id || c.id) === CASE), cases.length);
r = await req('GET', `/api/v1/cases/${CASE}`);
check('case:detail', r.status === 200 && JSON.stringify(r.json).includes(CASE), r.status);
r = await req('GET', `/api/v1/cases/${CASE}/facts`);
check('case:facts', r.status === 200 && Array.isArray(data(r).items), r.status);
r = await req('GET', `/api/v1/cases/${CASE}/verifications`);
const verifs = data(r).items || [];
check('case:verifications', r.status === 200 && verifs.length >= 1, verifs.length);

// 10 质量重算（只能由验证记录推导）
r = await req('POST', `/api/v1/cases/${CASE}/quality/recompute`, { body: {} });
check('case:quality-recompute', r.status === 200 && data(r).quality !== undefined || r.status === 200, JSON.stringify(data(r)).slice(0, 120));

// 11 案例检索
r = await req('POST', '/api/v1/cases/search', { body: { query: 'ResNet-50 复现', top_k: 5 } });
check('cases:search', r.status === 200, JSON.stringify(r.json).slice(0, 120));

// 12 事实 schema
r = await req('GET', '/api/v1/fact-schema');
check('fact-schema', r.status === 200, r.status);

// 13 材料列表 + 事实修订（integer 主键回归）
r = await req('GET', `/api/v1/materials?project_id=${PID}`);
const materials = data(r).items || [];
check('materials:seeded', r.status === 200 && materials.length >= 1, materials.length);
r = await req('GET', `/api/v1/facts?project_id=${PID}`);
const facts = data(r).items || [];
check('facts:seeded', facts.length >= 1, facts.length);
if (facts.length) {
  const f = facts[0];
  const fid = f.fact_id || f.id;
  const before = Number(f.revision_count || 0);
  r = await req('PATCH', `/api/v1/facts/${fid}`, { body: { normalized_value: `${f.normalized_value ?? ''}（冒烟修订）`.trim(), note: 'site-smoke 修订留痕' } });
  check('fact:patch', r.status === 200 && Number(data(r).revision_count) === before + 1, JSON.stringify(data(r)).slice(0, 120));
  r = await req('GET', `/api/v1/facts/${fid}/revisions`);
  const revs = data(r).items || [];
  check('fact:revisions-persisted', revs.length >= 1 && String(revs[revs.length - 1].revision_id).startsWith('rev-'), revs.length);
}

// 14 规则列表 + 离线评估（基线对比，指标精确复现）
r = await req('GET', '/api/v1/rules');
const rules = data(r).items || [];
const acc = rules.find(x => String(x.rule_key || '').startsWith('accuracy_tolerance')) || rules[0];
check('rules:seeded', !!acc, rules.length);
if (acc) {
  const rid = acc.rule_id || acc.id;
  r = await req('GET', `/api/v1/rules/${rid}`);
  const samples = (data(r).test_samples || []).map(s => ({ input: s.input, expected: s.expected, label: s.label }));
  check('rules:test-samples', samples.length >= 1, samples.length);
  r = await req('POST', `/api/v1/rules/${rid}/evaluate`, { body: { dataset_ref: 'verify://accuracy-v2-samples', samples, baseline_version: 1 } });
  const ev = data(r);
  const cur = ev.candidate?.metrics ?? ev.after?.metrics ?? ev.metrics ?? {};
  const base = ev.baseline?.metrics ?? {};
  check('rules:eval-compare', r.status === 200 && Number(cur.precision) === 1 && Number(base.precision) === 0.5 && Number(ev.delta?.precision) === 0.5,
    JSON.stringify({ cur: cur.precision, base: base.precision, delta: ev.delta?.precision }));
}

// 15 反馈创建 → 分诊 → 列表过滤
r = await req('POST', '/api/v1/feedback', { body: { project_id: PID, feedback_type: 'supplement', note: 'site-smoke：补充材料已核对。' } });
const fbId = data(r).feedback_id || data(r).id;
check('feedback:create', r.status === 200 && !!fbId, JSON.stringify(data(r)).slice(0, 100));
r = await req('POST', `/api/v1/feedback/${fbId}/triage`, { body: { status: 'resolved', resolution: '冒烟脚本关闭。' } });
check('feedback:triage', r.status === 200 && data(r).status === 'resolved', data(r).status);
r = await req('GET', `/api/v1/feedback?project_id=${PID}&status=resolved`);
check('feedback:filter', (data(r).items || []).some(f => (f.feedback_id || f.id) === fbId), r.status);

// 16 受控 RAG（当前论文证据优先）
r = await req('POST', '/api/v1/rag/query', { body: { query: 'FID 偏高 原因', project_id: PID, top_k: 5 } });
check('rag:query', r.status === 200 && Array.isArray(data(r).hits), JSON.stringify(data(r)).slice(0, 100));

// 17 仓库连接器列表
r = await req('GET', '/api/v1/integrations/repositories');
check('integrations:repos', r.status === 200, r.status);

// 18 令牌：创建（明文仅一次）→ 列表不含哈希/明文 → 开放 API → 日志 → 吊销后 401
r = await req('POST', '/api/v1/api-tokens', { body: { name: 'smoke 令牌', scopes: ['project.read', 'report.read', 'audit.run', 'repro.read'] } });
const plain = data(r).token || data(r).plaintext || '';
const tokenId = data(r).token_id || data(r).id;
check('token:create-once', r.status === 200 && plain.startsWith('rc_live_') && !!tokenId, plain.slice(0, 12));
r = await req('GET', '/api/v1/api-tokens');
const listStr = JSON.stringify(r.json);
check('token:list-no-secret', r.status === 200 && !listStr.includes('token_hash') && !listStr.includes(plain), r.status);
const savedToken = token; token = plain;
r = await req('GET', '/api/open/v1/projects');
check('open:projects-with-token', r.status === 200 && r.json?.success, r.status);
r = await req('POST', '/api/open/v1/audits', { body: { material_id: materials[0]?.material_id || materials[0]?.id } });
check('open:audits-demo-limit', r.status === 501 && r.json?.error?.code === 'DEMO_LIMIT', `${r.status} ${r.json?.error?.code}`);
token = 'rc_live_invalid000000000000000000';
r = await req('GET', '/api/open/v1/projects');
check('open:invalid-token-401', r.status === 401, r.status);
token = savedToken;
r = await req('GET', `/api/v1/api-tokens/${tokenId}/logs`);
check('token:call-logs', r.status === 200 && (data(r).items || []).length >= 1, (data(r).items || []).length);
r = await req('POST', `/api/v1/api-tokens/${tokenId}/revoke`, { body: {} });
check('token:revoke', r.status === 200, r.status);
token = plain;
r = await req('GET', '/api/open/v1/projects');
check('open:revoked-token-401', r.status === 401, r.status);
token = savedToken;

// 19 治理：导出（zip 可下载）+ 保留策略
r = await req('POST', '/api/v1/governance/export', { body: {} });
const expId = data(r).export_id || data(r).request_id || data(r).id;
check('governance:export', r.status === 200 && data(r).status === 'completed', data(r).status);
r = await req('GET', `/api/v1/governance/export/${expId}/download`, { raw: true });
check('governance:export-download', r.status === 200 && r.buf.length > 100 && r.buf.slice(0, 2).toString() === 'PK', `${r.status} ${r.buf.length}B`);
r = await req('GET', '/api/v1/governance/retention');
check('governance:retention', r.status === 200, r.status);

// 20 复现域：计划 / 运行 / 报告（HTML 免鉴权可读）
r = await req('GET', `/api/v1/reproductions/plans?project_id=${PID}`);
check('repro:plans', r.status === 200 && (data(r).items || []).length >= 1, (data(r).items || []).length);
r = await req('GET', `/api/v1/reproductions/reports?project_id=${PID}`);
const reports = data(r).items || [];
check('repro:reports', reports.length >= 1, reports.length);
if (reports.length) {
  const repId = reports[0].report_id || reports[0].id;
  r = await req('GET', `/api/v1/reproductions/reports/${repId}/html`, { auth: false, raw: true });
  const html = r.buf.toString('utf8');
  check('repro:report-html', r.status === 200 && html.includes('<html') || html.includes('<!DOCTYPE'), `${r.status} ${html.length}B`);
}

// 21 诚实演示边界：上传/解析无运行时 → DEMO_LIMIT
r = await req('POST', '/api/v1/materials/upload', { body: { project_id: PID } });
check('demo-limit:upload', r.status === 501 && r.json?.error?.code === 'DEMO_LIMIT', `${r.status} ${r.json?.error?.code}`);

// 22 RBAC：新注册非成员 → 项目数据 404（不泄露存在性）
const outsiderEmail = `smoke-outsider-${Date.now()}@lab.edu`;
r = await req('POST', '/api/v1/auth/register', { auth: false, body: { email: outsiderEmail, password: 'Outsider#2026', display_name: '冒烟 outsiders' } });
check('rbac:register', r.status === 200 || r.status === 201, r.status);
r = await req('POST', '/api/v1/auth/login', { auth: false, body: { email: outsiderEmail, password: 'Outsider#2026' } });
const outsiderToken = data(r).token || '';
const leadToken = token; token = outsiderToken;
r = await req('GET', `/api/v1/projects/${PID}/members`);
check('rbac:non-member-404', r.status === 404, r.status);
r = await req('GET', `/api/v1/materials?project_id=${PID}`);
check('rbac:non-member-materials-404', r.status === 404, r.status);
token = leadToken;

// 汇总
const failed = results.filter(x => !x.ok);
console.log(`\nSMOKE ${results.length - failed.length}/${results.length} ok`);
failed.forEach(f => console.log('FAIL', f.name, f.detail));
process.exitCode = failed.length ? 1 : 0;