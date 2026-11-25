// 域模块 D+E：外部仓库集成 / Notebook / 开放 API Token / 开放 API（rc_live_ 令牌）/ 数据治理。
// 镜像 backend/app/api/v1/{integrations,api_tokens,governance}.py、api/open_v1.py 与对应 services。
// 安全：凭据 Fernet 加密落库绝不回显；API Token 明文仅创建返回一次，库存 sha256；
//       开放 API 按令牌所属用户的项目可见性隔离；非成员项目一律 404。
import {
  AppError, newId, nowIso, rows, one, parseJson, intParam,
  sha256Hex, generateToken, encryptSecret, decryptSecret,
  orgRole, projectRole, hasPermission, stripAppPath,
} from './core.ts';
import type { Router, Deps, Call, Db, UserRow } from './core.ts';

// ---- 与 backend 对齐的常量 ----
const PROVIDERS = ['github', 'gitlab', 'gitee'];
const VALID_SCOPES = [
  'project.read', 'project.write', 'material.write',
  'audit.run', 'audit.read', 'repro.read', 'report.read',
];
const PROJECT_ROLE_RANK: Record<string, number> = { viewer: 0, reviewer: 1, researcher: 2, project_lead: 3 };
// settings.require_ai_consent / data_retention_days 的后端默认值（演示站点与 backend 默认配置一致）。
const REQUIRE_AI_CONSENT = false;
const DATA_RETENTION_DAYS = 365;
const RATE_WINDOW_MS = 60_000; // api_token_service.check_rate_limit：每 token 每分钟滑动窗口
const FETCH_LIMIT = 1000;

// ---- 通用小助手 ----
// core.normalize 会去掉时间戳的 Z/+00:00 后缀；比较时补回 UTC，避免被当作本地时间。
function tsMillis(v: any): number {
  if (typeof v !== 'string' || !v) return NaN;
  const s = /(Z|[+-]\d{2}:?\d{2})$/.test(v) ? v : `${v}Z`;
  return Date.parse(s);
}

// pydantic 校验失败镜像（main.py RequestValidationError → 422）。
function pydanticFail(field: string, msg: string): never {
  throw new AppError('VALIDATION_ERROR', '请求参数校验失败。', [{ loc: ['body', field], msg }], 422);
}
function reqStr(body: any, field: string): string {
  const v = body?.[field];
  if (v === undefined || v === null) pydanticFail(field, 'Field required');
  if (typeof v !== 'string') pydanticFail(field, 'Input should be a valid string');
  return v;
}
function strList(body: any, field: string, def: string[] = []): string[] {
  const v = body?.[field];
  if (v === undefined) return def;
  if (!Array.isArray(v) || v.some(x => typeof x !== 'string')) pydanticFail(field, 'Input should be a valid list');
  return v;
}
function optStr(body: any, field: string, def: string | null = null): string | null {
  const v = body?.[field];
  if (v === undefined) return def;
  if (v === null) return null;
  if (typeof v !== 'string') pydanticFail(field, 'Input should be a valid string');
  return v;
}

// deps.py user_has_permission：平台管理员 > org_admin > 组织角色权限 > 项目角色权限。
async function userHasPermission(db: Db, user: UserRow, perm: string, orgId: string | null = null, projectId: string | null = null): Promise<boolean> {
  if (user.is_platform_admin) return true;
  if (projectId && !orgId) {
    const proj = one(await db.from('projects').select('org_id').eq('id', projectId).limit(1));
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

// deps.py resolve_project_access：非成员 404（隐藏存在性），角色不足 403；平台/组织管理员 bypass。
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

async function userOrgIds(db: Db, userId: string): Promise<string[]> {
  return rows(await db.from('org_members').select('org_id').eq('user_id', userId).limit(FETCH_LIMIT)).map(r => r.org_id);
}

// trail_service.record_trail：重要操作留痕，before/after 序列化为文本 JSON。
async function recordTrail(db: Db, e: {
  action: string; actor_user_id?: string | null; org_id?: string | null; project_id?: string | null;
  target_type?: string; target_id?: string; before?: any; after?: any; summary?: string; request_id?: string;
}): Promise<void> {
  const dump = (v: any) => (v === null || v === undefined ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
  rows(await db.from('audit_trail').insert({
    id: newId('trail'), org_id: e.org_id ?? null, project_id: e.project_id ?? null,
    actor_user_id: e.actor_user_id ?? null, action: e.action,
    target_type: e.target_type ?? '', target_id: e.target_id ?? '',
    before_json: dump(e.before), after_json: dump(e.after),
    summary: e.summary ?? '', request_id: e.request_id ?? '', created_at: nowIso(),
  }).select('*'));
}

// ============================ D · 外部仓库集成 ============================

function connView(r: any): any {
  // 绝不包含 token_encrypted / 明文令牌。
  return {
    connection_id: r.id, provider: r.provider, account_label: r.account_label ?? '',
    auth_type: r.auth_type ?? 'pat', status: r.status, org_id: r.org_id ?? null,
    repo_allowlist: parseJson(r.repo_allowlist_json, []),
    has_token: !!r.token_encrypted,
    created_at: r.created_at ?? '', revoked_at: r.revoked_at ?? null,
  };
}

function snapshotView(s: any): any {
  const diff = parseJson(s.version_diff_json, {}) ?? {};
  return {
    snapshot_id: s.id, connection_id: s.connection_id,
    repo_full_name: s.repo_full_name, default_branch: s.default_branch ?? '',
    commit_sha: s.commit_sha ?? '', tag: s.tag ?? '', branch: s.branch ?? '',
    status: diff.status ?? 'synced', detail: diff,
    fetched_at: s.fetched_at ?? '',
  };
}

async function getConn(db: Db, user: UserRow, connId: string): Promise<any> {
  const conn = one(await db.from('repository_connections').select('*').eq('id', connId).limit(1));
  if (!conn) throw new AppError('NOT_FOUND', '仓库连接不存在或无权访问。');
  if (user.is_platform_admin || conn.user_id === user.id) return conn;
  if (conn.org_id && (await userOrgIds(db, user.id)).includes(conn.org_id)) return conn;
  throw new AppError('NOT_FOUND', '仓库连接不存在或无权访问。');
}

async function connectRepository(c: Call): Promise<any> {
  const provider = reqStr(c.body, 'provider').toLowerCase();
  if (!PROVIDERS.includes(provider)) {
    throw new AppError('VALIDATION_ERROR', `不支持的仓库服务商：${provider || '(空)'}`);
  }
  let orgId = optStr(c.body, 'org_id');
  if (!orgId) orgId = (await userOrgIds(c.db, c.user!.id))[0] ?? null;
  if (!await userHasPermission(c.db, c.user!, 'integration.manage', orgId)) {
    throw new AppError('FORBIDDEN', '缺少权限：integration.manage');
  }
  const token = optStr(c.body, 'token') ?? '';
  const allowlist = strList(c.body, 'repo_allowlist');
  const scopes = strList(c.body, 'scopes');
  const authType = optStr(c.body, 'auth_type', 'pat') ?? 'pat';
  const accountLabel = optStr(c.body, 'account_label', '') ?? '';
  const inserted = one(await c.db.from('repository_connections').insert({
    id: newId('repo'), org_id: orgId, user_id: c.user!.id, provider,
    account_label: accountLabel, auth_type: authType,
    token_encrypted: token ? await encryptSecret(token, c.secret) : null,
    scopes_json: JSON.stringify(scopes),
    status: token ? 'connected' : 'no_credentials',
    repo_allowlist_json: JSON.stringify(allowlist),
    created_at: nowIso(), revoked_at: null,
  }).select('*'));
  await recordTrail(c.db, {
    action: 'integration.connect', actor_user_id: c.user!.id, org_id: orgId,
    target_type: 'repository_connection', target_id: inserted.id,
    after: { provider, has_token: !!token }, summary: '连接外部仓库', request_id: c.rid,
  });
  return connView(inserted);
}

async function listRepositories(c: Call): Promise<any> {
  const user = c.user!;
  let list: any[];
  if (user.is_platform_admin) {
    list = rows(await c.db.from('repository_connections').select('*').limit(FETCH_LIMIT));
  } else {
    // 后端为 user_id == self OR org_id IN orgs；DB 子集无 OR，分两次查询后按 id 去重合并。
    const own = rows(await c.db.from('repository_connections').select('*').eq('user_id', user.id).limit(FETCH_LIMIT));
    const orgs = await userOrgIds(c.db, user.id);
    const orgRows = orgs.length
      ? rows(await c.db.from('repository_connections').select('*').in('org_id', orgs).limit(FETCH_LIMIT))
      : [];
    const seen = new Map<string, any>();
    for (const r of [...own, ...orgRows]) seen.set(r.id, r);
    list = [...seen.values()];
  }
  const items = list.map(connView);
  return { items, total: items.length };
}

async function revokeRepository(c: Call): Promise<any> {
  const user = c.user!;
  const conn = await getConn(c.db, user, c.params.conn_id);
  const isAdmin = await userHasPermission(c.db, user, 'integration.manage', conn.org_id ?? null);
  if (conn.user_id !== user.id && !isAdmin && !user.is_platform_admin) {
    throw new AppError('FORBIDDEN', '仅创建者或组织管理员可撤销连接。');
  }
  const updated = one(await c.db.from('repository_connections').update({
    status: 'revoked', token_encrypted: null, revoked_at: nowIso(),
  }).eq('id', conn.id).select('*'));
  await recordTrail(c.db, {
    action: 'integration.revoke', actor_user_id: user.id, org_id: conn.org_id ?? null,
    target_type: 'repository_connection', target_id: conn.id,
    summary: '撤销仓库连接并清空凭据', request_id: c.rid,
  });
  return connView(updated);
}

// 真实拉取 GitHub 远端 commit（固定主机 api.github.com；绝不伪造 sha）。
// 错误名镜像 httpx：非 2xx → HTTPStatusError（raise_for_status），超时 → ReadTimeout，网络 → ConnectError。
async function fetchGithubCommit(token: string, repoFullName: string, ref: string): Promise<any> {
  const named = (name: string) => { const e = new Error(name); e.name = name; return e; };
  const url = `https://api.github.com/repos/${repoFullName}/commits/${ref || 'HEAD'}`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'ReproCheck-Site',
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
  } catch (e: any) {
    throw named(e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'ReadTimeout' : 'ConnectError');
  }
  if (!res.ok) throw named('HTTPStatusError');
  let data: any;
  try { data = await res.json(); } catch { throw named('JSONDecodeError'); }
  return {
    commit_sha: data?.sha ?? '', branch: ref || 'HEAD', default_branch: '',
    message: data?.commit?.message ?? '',
  };
}

async function syncRepository(c: Call): Promise<any> {
  const user = c.user!;
  const conn = await getConn(c.db, user, c.params.conn_id);
  if (!await userHasPermission(c.db, user, 'integration.manage', conn.org_id ?? null)) {
    throw new AppError('FORBIDDEN', '缺少权限：integration.manage');
  }
  if (conn.status === 'revoked') throw new AppError('CONFLICT', '连接已撤销，无法同步。');
  const repoFullName = reqStr(c.body, 'repo_full_name');
  const ref = optStr(c.body, 'ref', '') ?? '';
  const allowlist: string[] = parseJson(conn.repo_allowlist_json, []) ?? [];
  if (allowlist.length && !allowlist.includes(repoFullName)) {
    throw new AppError('FORBIDDEN', '仓库不在该连接的白名单内。');
  }
  // 出站 URL 注入防护：仅允许 owner/repo 与保守 ref 字符集（主机固定 api.github.com）。
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repoFullName)) {
    throw new AppError('VALIDATION_ERROR', '仓库全名格式非法（应为 owner/repo）。');
  }
  if (ref && !/^[A-Za-z0-9_./-]+$/.test(ref)) {
    throw new AppError('VALIDATION_ERROR', 'ref 格式非法。');
  }

  const base = {
    id: newId('snap'), connection_id: conn.id, project_id: null,
    repo_full_name: repoFullName, branch: ref, default_branch: '', commit_sha: '', tag: '',
    fetched_at: nowIso(),
  };
  if (!conn.token_encrypted) {
    const snap = one(await c.db.from('repository_snapshots').insert({
      ...base,
      version_diff_json: JSON.stringify({
        status: 'blocked_no_credentials',
        reason: '未配置访问令牌，无法真实拉取远端 commit；不伪造版本号。',
      }),
    }).select('*'));
    return snapshotView(snap);
  }

  // 解密失败 → core 安全凭据错误（与 backend ValueError 同文案），绝不回显密文。
  const token = await decryptSecret(conn.token_encrypted, c.secret);
  if (conn.provider !== 'github') {
    // 站点出站仅放行 api.github.com；gitlab/gitee 拉取运行时未部署。
    throw new AppError('DEMO_LIMIT', '演示站点未部署该执行运行时。', null, 501);
  }
  let info: any;
  try {
    info = await fetchGithubCommit(token, repoFullName, ref);
  } catch (exc: any) {
    const snap = one(await c.db.from('repository_snapshots').insert({
      ...base,
      version_diff_json: JSON.stringify({
        status: 'blocked_fetch_failed',
        reason: `远端拉取失败：${exc?.name ?? 'Error'}`,
      }),
    }).select('*'));
    return snapshotView(snap);
  }

  const snap = one(await c.db.from('repository_snapshots').insert({
    ...base,
    commit_sha: info.commit_sha ?? '', default_branch: info.default_branch ?? '',
    branch: info.branch ?? ref,
    version_diff_json: JSON.stringify({ status: 'synced', message: info.message ?? '' }),
  }).select('*'));
  await recordTrail(c.db, {
    action: 'integration.sync', actor_user_id: user.id, org_id: conn.org_id ?? null,
    target_type: 'repository_snapshot', target_id: snap.id,
    after: { repo: repoFullName, commit_sha: snap.commit_sha },
    summary: '同步仓库快照', request_id: c.rid,
  });
  return snapshotView(snap);
}

async function listSnapshots(c: Call): Promise<any> {
  await getConn(c.db, c.user!, c.params.conn_id);
  const list = rows(await c.db.from('repository_snapshots').select('*')
    .eq('connection_id', c.params.conn_id).order('fetched_at', { ascending: false }).limit(FETCH_LIMIT));
  const items = list.map(snapshotView);
  return { items, total: items.length };
}

// ============================ D · Notebook ============================

function cellOutputs(r: any): any[] {
  const parsed = parseJson(r.outputs_json, []);
  return Array.isArray(parsed) ? parsed : [];
}

function cellView(r: any): any {
  const outputs = cellOutputs(r);
  return {
    cell_id: r.id, nb_cell_id: r.cell_id ?? '', cell_type: r.cell_type,
    source: r.source ?? '', execution_count: r.execution_count ?? null,
    order_index: r.order_index ?? 0, output_count: outputs.length, outputs,
  };
}

function sourceText(src: any): string {
  if (Array.isArray(src)) return src.join('');
  return src || '';
}

// notebook_service.parse_notebook：幂等重建细胞（纯 DB 逻辑，绝不执行 notebook 代码）。
async function parseNotebook(c: Call, material: any, storage: any): Promise<any> {
  const materialId = material.id;
  if (material.material_type !== 'notebook' && !(material.original_filename ?? '').toLowerCase().endsWith('.ipynb')) {
    throw new AppError('VALIDATION_ERROR', '该材料不是 Notebook（.ipynb）。');
  }
  let raw: string = material.raw_text ?? '';
  if (!raw.trim() && storage && material.stored_path) {
    // 站点存储中读取原文；对象不存在时与 backend 一致退化为空串 → 明确解析失败。
    try {
      const res = await storage.download(material.stored_path);
      raw = await res.text();
    } catch { raw = ''; }
  }
  let nb: any;
  try {
    nb = JSON.parse(raw);
  } catch {
    const detail = raw.trim() ? 'Unexpected token' : 'Expecting value: line 1 column 1 (char 0)';
    throw new AppError('VALIDATION_ERROR', `Notebook 解析失败：${detail}`);
  }
  const cells = nb?.cells;
  if (!Array.isArray(cells)) throw new AppError('VALIDATION_ERROR', 'Notebook 解析失败：缺少 cells 数组');

  rows(await c.db.from('notebook_cells').delete().eq('material_id', materialId).select('*'));
  const newCells = cells.map((cell: any, idx: number) => {
    if (!cell || typeof cell !== 'object') {
      throw new AppError('VALIDATION_ERROR', 'Notebook 解析失败：细胞结构非法。');
    }
    return {
      id: newId('nbcell'), material_id: materialId, cell_id: String(cell.id ?? ''),
      cell_type: cell.cell_type ?? 'code', source: sourceText(cell.source),
      execution_count: cell.execution_count ?? null,
      outputs_json: JSON.stringify(cell.outputs || []).slice(0, 20000),
      order_index: idx,
    };
  });
  if (newCells.length) rows(await c.db.from('notebook_cells').insert(newCells).select('*'));
  return { material_id: materialId, cell_count: newCells.length, cells: newCells.map(cellView) };
}

async function getNotebook(c: Call, storage: any): Promise<any> {
  const material = one(await c.db.from('materials').select('*').eq('id', c.params.material_id).limit(1));
  if (!material) throw new AppError('NOT_FOUND', '材料不存在或无权访问。');
  await resolveProjectAccess(c.db, material.project_id, c.user!);
  const list = rows(await c.db.from('notebook_cells').select('*')
    .eq('material_id', material.id).order('order_index', { ascending: true }).limit(FETCH_LIMIT));
  if (!list.length) return parseNotebook(c, material, storage);
  return { material_id: material.id, cell_count: list.length, cells: list.map(cellView) };
}

// ============================ D · 开放 API Token 管理 ============================

function tokenView(t: any): any {
  // 绝不包含 token_hash / 明文。
  return {
    token_id: t.id, name: t.name, prefix: t.prefix ?? '',
    scopes: parseJson(t.scopes_json, []),
    rate_limit_per_min: t.rate_limit_per_min ?? 60,
    org_id: t.org_id ?? null, is_revoked: !!t.is_revoked,
    expires_at: t.expires_at ?? null, last_used_at: t.last_used_at ?? null,
    created_at: t.created_at ?? '',
  };
}

async function createToken(c: Call): Promise<any> {
  const user = c.user!;
  if (c.body?.scopes === undefined || c.body?.scopes === null) pydanticFail('scopes', 'Field required');
  const scopes = strList(c.body, 'scopes');
  const bad = scopes.filter(s => !VALID_SCOPES.includes(s));
  if (bad.length) throw new AppError('VALIDATION_ERROR', `非法 scope：[${bad.map(s => `'${s}'`).join(', ')}]`);
  if (!scopes.length) throw new AppError('VALIDATION_ERROR', '至少需要一个 scope。');
  let orgId = optStr(c.body, 'org_id');
  if (!orgId) orgId = (await userOrgIds(c.db, user.id))[0] ?? null;
  if (!await userHasPermission(c.db, user, 'api.manage', orgId)) {
    throw new AppError('FORBIDDEN', '缺少权限：api.manage');
  }
  const name = optStr(c.body, 'name', 'API Token') ?? 'API Token';
  const rlRaw = c.body?.rate_limit_per_min;
  if (rlRaw !== undefined && rlRaw !== null && !Number.isInteger(rlRaw)) pydanticFail('rate_limit_per_min', 'Input should be a valid integer');
  const rateLimit = Number(rlRaw ?? 60) || 60;
  const expiresRaw = optStr(c.body, 'expires_at');
  let expiresAt: string | null = null;
  if (expiresRaw) {
    const ms = tsMillis(expiresRaw);
    if (!Number.isFinite(ms)) throw new AppError('VALIDATION_ERROR', 'expires_at 不是合法的 ISO 时间。');
    expiresAt = new Date(ms).toISOString();
  }
  const { plain, hash } = await generateToken('rc_live');
  const inserted = one(await c.db.from('api_tokens').insert({
    id: newId('tok'), user_id: user.id, org_id: orgId, name,
    token_hash: hash, prefix: 'rc_live_', scopes_json: JSON.stringify(scopes),
    rate_limit_per_min: rateLimit, expires_at: expiresAt,
    last_used_at: null, is_revoked: false, created_at: nowIso(),
  }).select('*'));
  await recordTrail(c.db, {
    action: 'api_token.create', actor_user_id: user.id, org_id: orgId,
    target_type: 'api_token', target_id: inserted.id, after: { scopes },
    summary: '创建开放 API Token', request_id: c.rid,
  });
  return { ...tokenView(inserted), token: plain }; // 明文仅此一次
}

async function listTokens(c: Call): Promise<any> {
  const list = rows(await c.db.from('api_tokens').select('*').eq('user_id', c.user!.id).limit(FETCH_LIMIT));
  const items = list.map(tokenView);
  return { items, total: items.length };
}

async function getToken(db: Db, user: UserRow, tokenId: string): Promise<any> {
  const t = one(await db.from('api_tokens').select('*').eq('id', tokenId).limit(1));
  if (!t) throw new AppError('NOT_FOUND', 'Token 不存在。');
  if (t.user_id === user.id || user.is_platform_admin) return t;
  if (await userHasPermission(db, user, 'api.manage', t.org_id ?? null)) return t;
  throw new AppError('NOT_FOUND', 'Token 不存在或无权访问。');
}

async function revokeToken(c: Call): Promise<any> {
  const t = await getToken(c.db, c.user!, c.params.token_id);
  const updated = one(await c.db.from('api_tokens').update({ is_revoked: true }).eq('id', t.id).select('*'));
  await recordTrail(c.db, {
    action: 'api_token.revoke', actor_user_id: c.user!.id, org_id: t.org_id ?? null,
    target_type: 'api_token', target_id: t.id, summary: '撤销 API Token', request_id: c.rid,
  });
  return tokenView(updated);
}

async function listLogs(c: Call): Promise<any> {
  await getToken(c.db, c.user!, c.params.token_id);
  const limit = intParam(c.q, 'limit', 50, 1, 200);
  const list = rows(await c.db.from('api_call_logs').select('*')
    .eq('token_id', c.params.token_id).order('created_at', { ascending: false }).limit(limit));
  const items = list.map(r => ({
    log_id: r.id, endpoint: r.endpoint, method: r.method,
    status_code: r.status_code, duration_ms: r.duration_ms, created_at: r.created_at ?? '',
  }));
  return { items, total: items.length };
}

// ============================ D · 开放 API（/api/open/v1） ============================

// api_token_service.authenticate：前缀校验 → sha256 查库 → 撤销/过期。
// last_used_at 与后端一致仅在调用成功（会话提交）时持久化，见 openCall。
async function authenticateToken(c: Call): Promise<any> {
  const header = c.request.headers.get('authorization') ?? '';
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    throw new AppError('UNAUTHORIZED', '需要开放 API 令牌（Bearer rc_live_...）。');
  }
  const plain = header.slice(7).trim();
  if (!plain || !plain.startsWith('rc_live_')) throw new AppError('UNAUTHORIZED', '无效的开放 API 令牌。');
  const hashed = await sha256Hex(plain);
  const t = one(await c.db.from('api_tokens').select('*').eq('token_hash', hashed).limit(1));
  if (!t || t.is_revoked) throw new AppError('UNAUTHORIZED', '令牌不存在或已撤销。');
  if (t.expires_at && tsMillis(t.expires_at) < Date.now()) throw new AppError('UNAUTHORIZED', '令牌已过期。');
  return t;
}

// check_rate_limit 的 DB 窗口移植：统计 api_call_logs 近 60s 内通过速率检查的调用。
// 后端 deque 仅在通过检查时 append（被拒的 429 不计入），故排除 status_code=429 的日志。
async function checkRateLimit(db: Db, t: any): Promise<void> {
  const windowStart = Date.now() - RATE_WINDOW_MS;
  const logs = rows(await db.from('api_call_logs').select('*')
    .eq('token_id', t.id).order('created_at', { ascending: false }).limit(FETCH_LIMIT));
  const count = logs.filter(r => r.status_code !== 429 && tsMillis(r.created_at) >= windowStart).length;
  if (count >= (t.rate_limit_per_min ?? 60)) {
    throw new AppError('RATE_LIMITED', '开放 API 调用超过速率限制，请稍后重试。');
  }
}

function checkScope(t: any, scope: string): void {
  const scopes: string[] = parseJson(t.scopes_json, []) ?? [];
  if (!scopes.includes(scope)) throw new AppError('FORBIDDEN', `令牌缺少 scope：${scope}`);
}

// open_v1._visible_ids：平台管理员全量；否则项目成员资格 + 担任 org_admin 的组织下项目。
async function visibleIds(db: Db, user: UserRow): Promise<Set<string> | null> {
  if (user.is_platform_admin) return null;
  const pms = rows(await db.from('project_members').select('project_id').eq('user_id', user.id).limit(FETCH_LIMIT));
  const ids = new Set<string>(pms.map(r => r.project_id));
  const oms = rows(await db.from('org_members').select('org_id')
    .eq('user_id', user.id).eq('role_key', 'org_admin').limit(FETCH_LIMIT));
  if (oms.length) {
    const ps = rows(await db.from('projects').select('id').in('org_id', oms.map(r => r.org_id)).limit(FETCH_LIMIT));
    for (const p of ps) ids.add(p.id);
  }
  return ids;
}

// api_token_service.log_call：字段与后端一致（IP 仅存哈希；无 IP 则空串）。
async function logCall(c: Call, t: any, statusCode: number, started: number): Promise<void> {
  const fwd = c.request.headers.get('x-forwarded-for') ?? '';
  const ip = fwd.split(',')[0].trim();
  rows(await c.db.from('api_call_logs').insert({
    id: newId('apilog'), token_id: t.id,
    endpoint: stripAppPath(c.request.url) ?? new URL(c.request.url).pathname,
    method: c.request.method, status_code: statusCode,
    duration_ms: Math.max(0, Date.now() - started),
    ip_hash: ip ? await sha256Hex(ip) : '',
    created_at: nowIso(),
  }).select('*'));
}

// get_api_context + 各 handler 的 _log 包装：认证 → 速率 → 用户 → scope → 业务；
// 令牌认证成功的每次调用（含失败状态码）都落 api_call_logs；无令牌可归属时无法落日志（与后端一致）。
async function openCall(c: Call, scope: string, fn: (token: any, user: UserRow) => Promise<any>): Promise<any> {
  const started = Date.now();
  let token: any = null;
  try {
    token = await authenticateToken(c);
    await checkRateLimit(c.db, token);
    const user = one(await c.db.from('users').select('*').eq('id', token.user_id).limit(1));
    if (!user || user.is_active === false) throw new AppError('UNAUTHORIZED', '令牌所属用户不可用。');
    checkScope(token, scope);
    const data = await fn(token, user);
    rows(await c.db.from('api_tokens').update({ last_used_at: nowIso() }).eq('id', token.id).select('*'));
    await logCall(c, token, 200, started);
    return data;
  } catch (e) {
    if (token) {
      try { await logCall(c, token, e instanceof AppError ? e.status : 500, started); } catch { /* 不掩盖原始错误 */ }
    }
    throw e;
  }
}

// parse_tasks 未包含在站点 schema 中（见迁移报告）：表缺失时按“无任务”处理，其余 DB 错误照常安全报错。
function oneOrMissingTable(result: { data?: any; error?: any }): any | null {
  if (result?.error) {
    if (result.error.code === '42P01') return null;
    throw new AppError('DB_SAVE_FAILED', '数据服务暂时不可用，请稍后重试。');
  }
  return one(result);
}

async function openListProjects(c: Call): Promise<any> {
  return openCall(c, 'project.read', async (_token, user) => {
    const visible = await visibleIds(c.db, user);
    let list = rows(await c.db.from('projects').select('*').order('created_at', { ascending: false }).limit(FETCH_LIMIT));
    if (visible !== null) list = list.filter(p => visible.has(p.id));
    const items = list.map(p => ({ id: p.id, name: p.name, domain: p.domain || '', org_id: p.org_id ?? null }));
    return { items, total: items.length };
  });
}

async function openCreateProject(c: Call): Promise<any> {
  return openCall(c, 'project.write', async (token, user) => {
    const name = c.body?.name;
    if (!name) throw new AppError('VALIDATION_ERROR', '缺少项目名称 name。');
    const proj = one(await c.db.from('projects').insert({
      id: newId('proj'), name, domain: c.body?.domain ?? '',
      paper_title: c.body?.paper_title ?? '', description: c.body?.description ?? '',
      owner_user_id: user.id, org_id: token.org_id ?? null, workspace_id: null,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*'));
    rows(await c.db.from('project_members').insert({
      id: newId('pm'), project_id: proj.id, user_id: user.id,
      role_key: 'project_lead', added_by: user.id, added_at: nowIso(),
    }).select('*'));
    return { id: proj.id, name: proj.name, org_id: proj.org_id ?? null };
  });
}

async function openUploadMaterial(c: Call): Promise<any> {
  return openCall(c, 'material.write', async (_token, user) => {
    // 后端契约为 multipart Form(project_id)+File(file)；站点 Function 层仅投递 JSON 体。
    if (c.body !== null && c.body !== undefined) {
      const projectId = c.body?.project_id;
      if (!projectId || typeof projectId !== 'string') pydanticFail('project_id', 'Field required');
      const visible = await visibleIds(c.db, user);
      if (visible !== null && !visible.has(projectId)) throw new AppError('NOT_FOUND', '项目不存在或无权访问。');
    }
    // 二进制文件上传/落盘运行时未部署：明确拒绝，不伪造材料记录。
    throw new AppError('DEMO_LIMIT', '演示站点未部署该执行运行时。', null, 501);
  });
}

// governance_service.ensure_ai_consent：require_ai_consent=False（后端默认）时直接放行。
async function ensureAiConsent(db: Db, projectId: string | null, orgId: string | null = null): Promise<void> {
  if (!REQUIRE_AI_CONSENT) return;
  const all = rows(await db.from('ai_consents').select('*').limit(FETCH_LIMIT));
  const hit = all.find(r => r.revoked_at == null && r.allow_external_llm === true && (
    projectId ? (r.project_id === projectId || (r.org_id ?? null) === (orgId ?? null))
      : (r.org_id ?? null) === (orgId ?? null)
  ));
  if (!hit) {
    throw new AppError('AI_CONSENT_REQUIRED', '未授权外部模型：请先在治理设置中授予 AI 外部模型调用同意。');
  }
}

async function openStartAudit(c: Call): Promise<any> {
  return openCall(c, 'audit.run', async (_token, user) => {
    const materialId = c.body?.material_id;
    if (!materialId) throw new AppError('VALIDATION_ERROR', '缺少 material_id。');
    const m = one(await c.db.from('materials').select('*').eq('id', materialId).limit(1));
    if (!m) throw new AppError('NOT_FOUND', '材料不存在。');
    const visible = await visibleIds(c.db, user);
    if (visible !== null && !visible.has(m.project_id)) throw new AppError('NOT_FOUND', '材料不存在或无权访问。');
    const proj = one(await c.db.from('projects').select('org_id').eq('id', m.project_id).limit(1));
    await ensureAiConsent(c.db, m.project_id, proj?.org_id ?? null);
    // 后端在此创建 ParseTask 并立即运行 LLM 抽取管线；站点未部署 LLM 运行时，
    // 不创建虚假任务记录，整段明确 DEMO_LIMIT。
    throw new AppError('DEMO_LIMIT', '演示站点未部署该执行运行时。', null, 501);
  });
}

async function openGetAudit(c: Call): Promise<any> {
  return openCall(c, 'audit.read', async (_token, user) => {
    const t = oneOrMissingTable(await c.db.from('parse_tasks').select('*').eq('id', c.params.task_id).limit(1));
    if (!t) throw new AppError('NOT_FOUND', '审计任务不存在。');
    const visible = await visibleIds(c.db, user);
    if (visible !== null && !visible.has(t.project_id)) throw new AppError('NOT_FOUND', '审计任务不存在或无权访问。');
    return {
      task_id: t.id, status: t.status, facts_count: t.facts_count,
      model_calls: t.model_calls, total_tokens: t.total_tokens,
    };
  });
}

async function openListReproductions(c: Call): Promise<any> {
  return openCall(c, 'repro.read', async (_token, user) => {
    const visible = await visibleIds(c.db, user);
    const projectId = c.q.get('project_id');
    let query = c.db.from('reproduction_runs').select('*').order('created_at', { ascending: false });
    if (projectId) query = query.eq('project_id', projectId);
    let list = rows(await query.limit(FETCH_LIMIT));
    if (visible !== null) list = list.filter(r => visible.has(r.project_id));
    const items = list.map(r => ({
      run_id: r.id, project_id: r.project_id, status: r.status,
      execution_enabled: !!r.execution_enabled,
    }));
    return { items, total: items.length };
  });
}

async function openGetReport(c: Call): Promise<any> {
  return openCall(c, 'report.read', async (_token, user) => {
    const r = one(await c.db.from('reproduction_reports').select('*').eq('id', c.params.report_id).limit(1));
    if (!r) throw new AppError('NOT_FOUND', '报告不存在。');
    const visible = await visibleIds(c.db, user);
    if (visible !== null && !visible.has(r.project_id)) throw new AppError('NOT_FOUND', '报告不存在或无权访问。');
    return {
      report_id: r.id, title: r.title, status: r.status, version: r.version,
      html_available: !!r.html, scope_note: r.scope_note ?? '',
    };
  });
}

// ============================ E · 数据治理 ============================

const DATA_CLASSES = [
  { level: 'public', label: '公开', examples: ['公开基准案例', '已发布报告摘要'],
    handling: '可公开检索；不含未发表材料。' },
  { level: 'internal', label: '内部', examples: ['组织内项目元数据', '审计规则'],
    handling: '仅组织成员可见；导出需授权。' },
  { level: 'confidential', label: '机密', examples: ['未发表论文原文', '抽取事实与证据'],
    handling: '仅项目成员可见；外部 LLM 调用需 AI 授权；不得进入公共 RAG。' },
  { level: 'restricted', label: '受限', examples: ['密码哈希', '仓库令牌', 'API Token'],
    handling: '加密/哈希落库；绝不回显明文；不参与导出与模型输入。' },
];

const RETENTION_POLICY = {
  default_days: DATA_RETENTION_DAYS,
  rules: [
    { data: '材料原文与证据', retention: '项目存续期间保留；删除项目级联清理物理文件。' },
    { data: '审计轨迹', retention: `保留 ${DATA_RETENTION_DAYS} 天，不可被结论修订覆盖。` },
    { data: 'API 调用日志', retention: '保留 90 天，IP 仅存哈希。' },
    { data: '撤销的令牌/连接', retention: '立即失效并清空密文，元数据留痕。' },
  ],
  note: '保留策略为治理声明；自动清理任务需由部署侧定时执行（当前未内置 cron）。',
};

function classificationView(): any {
  return {
    classes: DATA_CLASSES,
    principle: '当前论文证据优先；历史案例与外部知识不得覆盖当前事实；受限数据绝不出库回显。',
  };
}

function consentView(r: any): any {
  return {
    consent_id: r.id, org_id: r.org_id ?? null, project_id: r.project_id ?? null,
    allow_external_llm: !!r.allow_external_llm, scope: r.scope,
    granted_at: r.granted_at ?? '', revoked_at: r.revoked_at ?? null,
  };
}

async function grantAiConsent(c: Call): Promise<any> {
  const user = c.user!;
  const allow = c.body?.allow_external_llm;
  if (allow !== undefined && typeof allow !== 'boolean') pydanticFail('allow_external_llm', 'Input should be a valid boolean');
  const projectId = optStr(c.body, 'project_id');
  let orgId = optStr(c.body, 'org_id');
  if (projectId) {
    const proj = await resolveProjectAccess(c.db, projectId, user, 3); // project_lead+
    orgId = orgId || proj.org_id || null;
  } else {
    if (!orgId) {
      const adminOrgs = rows(await c.db.from('org_members').select('org_id')
        .eq('user_id', user.id).eq('role_key', 'org_admin').limit(FETCH_LIMIT));
      orgId = adminOrgs[0]?.org_id ?? null;
    }
    if (!await userHasPermission(c.db, user, 'data.manage', orgId)) {
      throw new AppError('FORBIDDEN', '缺少权限：data.manage（组织管理员或项目负责人）。');
    }
  }
  const allowBool = !!allow;
  const scope = optStr(c.body, 'scope', 'project') ?? 'project';
  // 撤销同范围旧授权（project_id/org_id 含 NULL 匹配），保留历史。
  const all = rows(await c.db.from('ai_consents').select('*').limit(FETCH_LIMIT));
  const priorIds = all.filter(r => r.revoked_at == null
    && (r.project_id ?? null) === (projectId ?? null)
    && (r.org_id ?? null) === (orgId ?? null)).map(r => r.id);
  if (priorIds.length) {
    rows(await c.db.from('ai_consents').update({ revoked_at: nowIso() }).in('id', priorIds).select('*'));
  }
  const inserted = one(await c.db.from('ai_consents').insert({
    id: newId('consent'), org_id: orgId ?? null, project_id: projectId ?? null,
    user_id: user.id, allow_external_llm: allowBool, scope,
    granted_at: nowIso(), revoked_at: null,
  }).select('*'));
  await recordTrail(c.db, {
    action: 'governance.ai_consent', actor_user_id: user.id, org_id: orgId ?? null,
    project_id: projectId ?? null, target_type: 'ai_consent', target_id: inserted.id,
    after: { allow_external_llm: allowBool, scope },
    summary: '设置 AI 外部模型授权', request_id: c.rid,
  });
  return consentView(inserted);
}

async function getAiConsent(c: Call): Promise<any> {
  const projectId = c.q.get('project_id') || null;
  const orgId = c.q.get('org_id') || null;
  if (projectId) await resolveProjectAccess(c.db, projectId, c.user!);
  const all = rows(await c.db.from('ai_consents').select('*').limit(FETCH_LIMIT));
  const list = all.filter(r => r.revoked_at == null
    && (projectId ? r.project_id === projectId : (orgId ? (r.org_id ?? null) === orgId : true)))
    .sort((a, b) => tsMillis(b.granted_at) - tsMillis(a.granted_at));
  return {
    active: list.length ? consentView(list[0]) : null,
    require_ai_consent: REQUIRE_AI_CONSENT,
    history: list.map(consentView),
  };
}

function exportView(r: any): any {
  return {
    export_id: r.id, status: r.status, file_available: !!r.file_path,
    created_at: r.created_at ?? '', completed_at: r.completed_at ?? null,
  };
}

// governance_service._build_export：仅请求者本人可见的项目元数据与事实，绝不含密钥/令牌/他人私密原文。
async function buildExportManifest(db: Db, user: UserRow): Promise<any> {
  const pms = rows(await db.from('project_members').select('project_id').eq('user_id', user.id).limit(FETCH_LIMIT));
  const owned = rows(await db.from('projects').select('id').eq('owner_user_id', user.id).limit(FETCH_LIMIT));
  const pids = [...new Set([...pms.map(r => r.project_id), ...owned.map(r => r.id)])];
  const projects = pids.length ? rows(await db.from('projects').select('*').in('id', pids).limit(FETCH_LIMIT)) : [];
  const manifest: any = {
    exported_at: new Date().toISOString(), user_id: user.id,
    project_count: projects.length, projects: [],
  };
  for (const p of projects) {
    const materials = rows(await db.from('materials').select('*').eq('project_id', p.id).limit(FETCH_LIMIT));
    const facts = rows(await db.from('extracted_facts').select('*').eq('project_id', p.id).limit(FETCH_LIMIT));
    manifest.projects.push({
      id: p.id, name: p.name, domain: p.domain,
      materials: materials.map(m => ({ id: m.id, source_name: m.source_name, sha256: m.sha256, parse_status: m.parse_status })),
      facts: facts.map(f => ({
        fact_id: f.fact_id, field_key: f.field_key, raw_value: f.raw_value,
        normalized_value: f.normalized_value, parser_source: f.parser_source,
      })),
    });
  }
  return manifest;
}

// ---- 最小 ZIP（STORE 无压缩）写入器：镜像 backend zipfile 产物 manifest.json + README.txt ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true); lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    lh.set(name, 30);
    parts.push(lh, data);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    // 30 extraLen / 32 commentLen / 34 diskStart / 36 internalAttrs 均为 0；38 externalAttrs=0。
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true); // 本地头偏移（central directory 固定字段位 42）
    ch.set(name, 46);
    central.push(ch);
    offset += lh.length + data.length;
  }
  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + eocd.length);
  let p = 0;
  for (const part of [...parts, ...central, eocd]) { out.set(part, p); p += part.length; }
  return out;
}

const EXPORT_README = '本导出仅包含请求者本人可见的项目元数据与事实，不含密钥/令牌/他人私密材料原文。';

async function requestExport(c: Call): Promise<any> {
  const user = c.user!;
  const req = one(await c.db.from('data_export_requests').insert({
    id: newId('export'), user_id: user.id, org_id: null, status: 'pending',
    file_path: null, created_at: nowIso(), completed_at: null,
  }).select('*'));
  let updated: any;
  try {
    await buildExportManifest(c.db, user); // 构建失败 → failed，与后端一致
    updated = one(await c.db.from('data_export_requests').update({
      status: 'completed', file_path: `exports/${user.id}/${req.id}.zip`, completed_at: nowIso(),
    }).eq('id', req.id).select('*'));
  } catch (exc: any) {
    rows(await c.db.from('data_export_requests').update({ status: 'failed' }).eq('id', req.id).select('*'));
    throw new AppError('INTERNAL_ERROR', `数据导出失败：${exc?.name ?? 'Error'}`);
  }
  await recordTrail(c.db, {
    action: 'governance.export', actor_user_id: user.id,
    target_type: 'data_export', target_id: req.id, summary: '导出本人数据', request_id: c.rid,
  });
  return exportView(updated);
}

async function getExportRow(db: Db, user: UserRow, requestId: string): Promise<any> {
  const r = one(await db.from('data_export_requests').select('*').eq('id', requestId).limit(1));
  if (!r || (r.user_id !== user.id && !user.is_platform_admin)) {
    throw new AppError('NOT_FOUND', '导出请求不存在或无权访问。');
  }
  return r;
}

async function getExport(c: Call): Promise<any> {
  return exportView(await getExportRow(c.db, c.user!, c.params.request_id));
}

// 后端 FileResponse(zip, media_type=application/zip, filename={id}.zip)。
// 站点无本地磁盘：下载时按同一 _build_export 逻辑从本人可见 DB 行重建内容并打包（STORE zip）。
async function downloadExport(c: Call): Promise<Response> {
  const r = await getExportRow(c.db, c.user!, c.params.request_id);
  if (!r.file_path) throw new AppError('NOT_FOUND', '导出文件尚未生成或已清理。');
  // 内容归属请求者本人（平台管理员代下载时亦如此），与后端生成时一致。
  const owner = one(await c.db.from('users').select('*').eq('id', r.user_id).limit(1)) ?? c.user!;
  const manifest = await buildExportManifest(c.db, owner);
  const enc = new TextEncoder();
  const zip = zipStore([
    { name: 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 2)) },
    { name: 'README.txt', data: enc.encode(EXPORT_README) },
  ]);
  return new Response(zip, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${r.id}.zip"`,
    },
  });
}

async function retention(c: Call): Promise<any> {
  const user = c.user!;
  let allowed = !!user.is_platform_admin;
  if (!allowed) {
    const adminOrgs = rows(await c.db.from('org_members').select('org_id')
      .eq('user_id', user.id).eq('role_key', 'org_admin').limit(FETCH_LIMIT));
    for (const o of adminOrgs) {
      if (await userHasPermission(c.db, user, 'data.manage', o.org_id)) { allowed = true; break; }
    }
  }
  if (!allowed) throw new AppError('FORBIDDEN', '缺少权限：data.manage（组织管理员）。');
  return RETENTION_POLICY;
}

// ============================ 路由注册 ============================

export function register(router: Router, deps: Deps): void {
  const storage = deps.storage;

  // 外部集成（JWT）
  router.post('/api/v1/integrations/repositories', connectRepository);
  router.get('/api/v1/integrations/repositories', listRepositories);
  router.post('/api/v1/integrations/repositories/:conn_id/revoke', revokeRepository);
  router.post('/api/v1/integrations/repositories/:conn_id/sync', syncRepository);
  router.get('/api/v1/integrations/repositories/:conn_id/snapshots', listSnapshots);
  router.get('/api/v1/materials/:material_id/notebook', c => getNotebook(c, storage));

  // 开放 API Token 管理（JWT）
  router.post('/api/v1/api-tokens', createToken);
  router.get('/api/v1/api-tokens', listTokens);
  router.post('/api/v1/api-tokens/:token_id/revoke', revokeToken);
  router.get('/api/v1/api-tokens/:token_id/logs', listLogs);

  // 开放 API（rc_live_ 令牌鉴权，非 JWT；handler 内部镜像 get_api_context）
  router.get('/api/open/v1/projects', openListProjects, { auth: false });
  router.post('/api/open/v1/projects', openCreateProject, { auth: false });
  router.post('/api/open/v1/materials', openUploadMaterial, { auth: false });
  router.post('/api/open/v1/audits', openStartAudit, { auth: false });
  router.get('/api/open/v1/audits/:task_id', openGetAudit, { auth: false });
  router.get('/api/open/v1/reproductions', openListReproductions, { auth: false });
  router.get('/api/open/v1/reports/:report_id', openGetReport, { auth: false });

  // 数据治理（JWT）
  router.get('/api/v1/governance/classification', async () => classificationView());
  router.post('/api/v1/governance/ai-consent', grantAiConsent);
  router.get('/api/v1/governance/ai-consent', getAiConsent);
  router.post('/api/v1/governance/export', requestExport);
  router.get('/api/v1/governance/export/:request_id', getExport);
  router.get('/api/v1/governance/export/:request_id/download', downloadExport);
  router.get('/api/v1/governance/retention', retention);
}
