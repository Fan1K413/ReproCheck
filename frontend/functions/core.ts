// 站点 Function 共享核心：信封/错误码、WebCrypto 凭据安全、路由、RBAC 基础。
// 与 backend/app/core/{errors,security}.py 及信封契约保持一致；密钥仅存在于服务端。
// 域模块通过 register(router, deps) 挂载路由；handler 返回业务 data（自动包信封），
// 或直接返回 Response。抛 AppError 得到对应状态码的安全信封。

export type Db = any;
export type Ctx = { request: Request; requestId?: string };
export type Deps = { db: Db; secret: string; storage?: any };
export type UserRow = Record<string, any>;
export type Call = {
  request: Request;
  rid: string;
  q: URLSearchParams;
  params: Record<string, string>;
  db: Db;
  secret: string;
  user: UserRow | null;
  body: any;
};
export type Handler = (c: Call) => Promise<any>;

export const ERROR_STATUS: Record<string, number> = {
  VALIDATION_ERROR: 422,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  UNAUTHORIZED: 401,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_CONSENT_REQUIRED: 403,
  INTERNAL_ERROR: 500,
  DB_SAVE_FAILED: 500,
  SERVICE_NOT_CONFIGURED: 503,
  LLM_KEY_NOT_CONFIGURED: 503,
  LLM_INVALID_KEY: 401,
  LLM_NETWORK_ERROR: 502,
  LLM_TIMEOUT: 504,
  LLM_RATE_LIMITED: 429,
  LLM_INVALID_FORMAT: 502,
  LLM_PROVIDER_ERROR: 502,
  EVIDENCE_VALIDATION_FAILED: 422,
  EXECUTION_DISABLED: 423,
  SECURITY_BLOCKED: 422,
  DAG_INVALID: 422,
  METRIC_UNEXTRACTABLE: 422,
  PDF_UNAVAILABLE: 501,
  DEMO_LIMIT: 501,
};

export class AppError extends Error {
  code: string;
  details: any;
  status: number;
  constructor(code: string, message: string, details: any = null, status?: number) {
    super(message);
    this.code = code;
    this.details = details;
    this.status = status ?? ERROR_STATUS[code] ?? 500;
  }
}

export const ok = (data: any, rid: string) => ({ success: true, data, error: null, request_id: rid });
export const fail = (code: string, message: string, rid: string, details: any = null) => ({
  success: false, data: null, error: { code, message, details }, request_id: rid,
});

export const newId = (prefix: string) =>
  `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
export const nowIso = () => new Date().toISOString();

// 站点 PG 的 integer 主键无自增序列：写入前取 max(id)+1（镜像后端 SQLite autoincrement）。
export async function nextIntId(db: Db, table: string): Promise<number> {
  const top = one(await db.from(table).select('id').order('id', { ascending: false }).limit(1));
  return (Number(top?.id) || 0) + 1;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = (s: string) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  return Uint8Array.from(bin, ch => ch.charCodeAt(0));
};

export async function sha256Hex(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

// ---- 密码：pbkdf2_sha256$iterations$salt_hex$dk_hex（镜像 security.py） ----
const PBKDF2_ITERATIONS = 200_000;
async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${hex(salt.buffer)}$${hex(dk.buffer)}`;
}
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [algo, iters, saltHex, dkHex] = stored.split('$');
    if (algo !== 'pbkdf2_sha256') return false;
    const salt = Uint8Array.from(saltHex.match(/../g)!.map(h => parseInt(h, 16)));
    const dk = await pbkdf2(password, salt, parseInt(iters, 10));
    return hex(dk.buffer) === dkHex;
  } catch {
    return false;
  }
}

// ---- JWT HS256（sub/email/iat/exp，镜像 create_access_token） ----
async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signJwt(payload: Record<string, any>, secret: string): Promise<string> {
  const head = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}
export async function verifyJwt(token: string, secret: string): Promise<Record<string, any>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('UNAUTHORIZED', '登录状态无效或已过期，请重新登录。');
  const valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), unb64url(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!valid) throw new AppError('UNAUTHORIZED', '登录状态无效或已过期，请重新登录。');
  const payload = JSON.parse(new TextDecoder().decode(unb64url(parts[1])));
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new AppError('UNAUTHORIZED', '登录状态无效或已过期，请重新登录。');
  }
  return payload;
}
export const JWT_EXPIRE_HOURS = 12;
export async function createAccessToken(userId: string, email: string, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signJwt({ sub: userId, email, iat: now, exp: now + JWT_EXPIRE_HOURS * 3600 }, secret);
}

// ---- API Token / 邀请令牌：明文仅返回一次，库存 sha256 ----
export async function generateToken(prefix = 'rc'): Promise<{ plain: string; hash: string }> {
  const plain = `${prefix}_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  return { plain, hash: await sha256Hex(plain) };
}

// ---- Fernet 兼容对称加密（AES-128-CBC + HMAC-SHA256，key=urlsafe_b64(sha256(secret))） ----
async function fernetKeys(secret: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(secret)));
  const raw = unb64url(b64url(digest));
  return {
    sign: await crypto.subtle.importKey('raw', raw.slice(0, 16), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']),
    aes: await crypto.subtle.importKey('raw', raw.slice(16), 'AES-CBC', false, ['encrypt', 'decrypt']),
  };
}
export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const { sign, aes } = await fernetKeys(secret);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ts = Math.floor(Date.now() / 1000);
  const header = new Uint8Array(9);
  header[0] = 0x80;
  new DataView(header.buffer).setBigUint64(1, BigInt(ts));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, aes, enc.encode(plaintext)));
  const body = new Uint8Array([...header, ...iv, ...cipher]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', sign, body));
  return b64url(new Uint8Array([...body, ...mac]));
}
export async function decryptSecret(ciphertext: string, secret: string): Promise<string> {
  try {
    const raw = unb64url(ciphertext);
    const { sign, aes } = await fernetKeys(secret);
    const body = raw.slice(0, raw.length - 32);
    const valid = await crypto.subtle.verify('HMAC', sign, raw.slice(raw.length - 32), body);
    if (!valid || body[0] !== 0x80) throw new Error('bad token');
    const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: body.slice(9, 25) }, aes, body.slice(25));
    return new TextDecoder().decode(plain);
  } catch {
    throw new AppError('VALIDATION_ERROR', '凭据解密失败：加密密钥不匹配或数据损坏。');
  }
}

// ---- DB 结果助手：{data,error}；error 一律转安全 503，绝不回显原始信息 ----
const TS_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\+00:00|Z)$/;
function normalize(value: any): any {
  if (typeof value === 'string') {
    const m = value.match(TS_RE);
    // 与本地后端一致：视图输出不带时区后缀的 ISO 字符串。
    if (m) return m[1];
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalize(v);
    return out;
  }
  return value;
}
export function rows(result: { data?: any; error?: any }): any[] {
  if (result?.error) throw new AppError('DB_SAVE_FAILED', '数据服务暂时不可用，请稍后重试。');
  return normalize(result?.data ?? []);
}
export function one(result: { data?: any; error?: any }): any | null {
  const data = rows(result);
  return Array.isArray(data) ? (data.length ? data[0] : null) : (data ?? null);
}
export const num = (v: any): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};
export const parseJson = (v: any, fallback: any = null) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return fallback; } }
  return v;
};
export const pick = (row: Record<string, any>, fields: string[]) => {
  const out: Record<string, any> = {};
  for (const f of fields) out[f] = row[f] ?? null;
  return out;
};

// ---- 请求体 / 查询参数 ----
export async function readJson(request: Request, maxBytes = 262_144): Promise<any> {
  const ct = request.headers.get('content-type') ?? '';
  if (!ct.startsWith('application/json')) throw new AppError('VALIDATION_ERROR', '请求体必须为 JSON。');
  const reader = request.body?.getReader();
  if (!reader) throw new AppError('VALIDATION_ERROR', '请求体为空。');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new AppError('VALIDATION_ERROR', '请求体过大。'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AppError('VALIDATION_ERROR', '请求体不是合法 JSON。'); }
}
export function intParam(q: URLSearchParams, name: string, def: number, min = 1, max = 200): number {
  const raw = q.get(name);
  if (raw === null || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new AppError('VALIDATION_ERROR', `参数 ${name} 超出范围。`);
  return n;
}
export function requireStr(body: any, field: string, maxLen = 500): string {
  const v = body?.[field];
  if (typeof v !== 'string' || !v.trim() || v.length > maxLen) {
    throw new AppError('VALIDATION_ERROR', `字段 ${field} 必填且长度不超过 ${maxLen}。`);
  }
  return v.trim();
}

// ---- 身份与 RBAC 基础（业务权限仍由各域镜像后端服务判定） ----
export async function optionalUser(db: Db, request: Request, secret: string): Promise<UserRow | null> {
  const header = request.headers.get('authorization') ?? '';
  if (!header.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(header.indexOf(' ') + 1).trim();
  // 开放 API 令牌（rc_live_...）非 JWT：交由开放 API 路由自行鉴权。
  if (token.split('.').length !== 3) return null;
  if (!secret) throw new AppError('SERVICE_NOT_CONFIGURED', '站点尚未配置应用密钥，请联系管理员。');
  // 镜像后端 get_optional_user：无效/过期令牌与失效用户一律静默返回 null。
  let payload: any;
  try { payload = await verifyJwt(token, secret); } catch { return null; }
  const user = one(await db.from('users').select('*').eq('id', payload.sub).limit(1));
  if (!user || user.is_active === false) return null;
  return user;
}
export async function currentUser(db: Db, request: Request, secret: string): Promise<UserRow> {
  const user = await optionalUser(db, request, secret);
  if (!user) throw new AppError('UNAUTHORIZED', '需要登录：请提供有效的 Bearer 令牌。');
  return user;
}
export async function orgRole(db: Db, orgId: string, userId: string): Promise<string | null> {
  const m = one(await db.from('org_members').select('role_key').eq('org_id', orgId).eq('user_id', userId).limit(1));
  return m?.role_key ?? null;
}
export async function projectRole(db: Db, projectId: string, userId: string): Promise<string | null> {
  const m = one(await db.from('project_members').select('role_key').eq('project_id', projectId).eq('user_id', userId).limit(1));
  return m?.role_key ?? null;
}
// 非成员访问项目一律 404（不泄露项目存在性）。
export async function projectContext(db: Db, projectId: string, user: UserRow): Promise<{ project: any; role: string }> {
  const project = one(await db.from('projects').select('*').eq('id', projectId).limit(1));
  if (!project) throw new AppError('NOT_FOUND', '项目不存在。');
  const role = await projectRole(db, projectId, user.id);
  if (!role) throw new AppError('NOT_FOUND', '项目不存在。');
  return { project, role };
}
export async function hasPermission(db: Db, roleKey: string, permKey: string): Promise<boolean> {
  const role = one(await db.from('roles').select('id').eq('key', roleKey).limit(1));
  const perm = one(await db.from('permissions').select('id').eq('key', permKey).limit(1));
  if (!role || !perm) return false;
  const rp = one(await db.from('role_permissions').select('role_id').eq('role_id', role.id).eq('permission_id', perm.id).limit(1));
  return !!rp;
}
export async function requirePermission(db: Db, roleKey: string, permKey: string): Promise<void> {
  if (!(await hasPermission(db, roleKey, permKey))) {
    throw new AppError('FORBIDDEN', '当前角色无权执行该操作。');
  }
}

// ---- 路由 ----
type Route = { method: string; re: RegExp; names: string[]; handler: Handler; auth: boolean };
export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler, opts: { auth?: boolean } = {}) {
    const names: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:[a-zA-Z_]+/g, m => {
      names.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    this.routes.push({ method, re, names, handler, auth: opts.auth !== false });
  }
  get(p: string, h: Handler, o?: { auth?: boolean }) { this.add('GET', p, h, o); }
  post(p: string, h: Handler, o?: { auth?: boolean }) { this.add('POST', p, h, o); }
  patch(p: string, h: Handler, o?: { auth?: boolean }) { this.add('PATCH', p, h, o); }
  put(p: string, h: Handler, o?: { auth?: boolean }) { this.add('PUT', p, h, o); }
  delete(p: string, h: Handler, o?: { auth?: boolean }) { this.add('DELETE', p, h, o); }
  match(method: string, path: string): { route: Route; params: Record<string, string> } | null {
    let pathExists = false;
    for (const route of this.routes) {
      const m = path.match(route.re);
      if (!m) continue;
      pathExists = true;
      if (route.method !== method) continue;
      const params: Record<string, string> = {};
      route.names.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); });
      return { route, params };
    }
    if (pathExists) throw new AppError('NOT_FOUND', '请求方法不支持。', null, 405);
    return null;
  }
}

// 网关保留后缀、替换逻辑名 app 为物理函数名；Provider 可能剥离 /functions/v1。
export function stripAppPath(url: string): string | null {
  const pathname = new URL(url).pathname;
  const m = pathname.match(/^\/(?:functions\/v1\/)?(?:app|app-d[0-9a-f]{32})(\/.*)?$/);
  return m ? (m[1] || '/') : null;
}

// 统一分发：信封、鉴权、JSON 体、安全错误边界。pre 用于冷启动种子等前置钩子。
export function makeHandler(router: Router, deps: Deps, pre?: () => Promise<void>) {
  const { db, secret } = deps;
  return async (ctx: Ctx) => {
    const rid = ctx.requestId ?? newId('req');
    const request = ctx.request;
    const path = stripAppPath(request.url);
    if (path === null) return Response.json(fail('NOT_FOUND', '接口不存在。', rid), { status: 404 });
    if (path === '/api/v1/health' && request.method === 'GET') {
      return Response.json(ok({ status: 'ok', service: 'reprocheck-site', time: new Date().toISOString() }, rid));
    }
    try {
      if (pre) await pre();
      const hit = router.match(request.method, path);
      if (!hit) throw new AppError('NOT_FOUND', '接口不存在。');
      const user = hit.route.auth
        ? await currentUser(db, request, secret)
        : await optionalUser(db, request, secret);
      const body = (request.headers.get('content-type') ?? '').startsWith('application/json')
        ? await readJson(request)
        : null;
      const data = await hit.route.handler({
        request, rid, q: new URL(request.url).searchParams, params: hit.params,
        db, secret, user, body,
      });
      if (data instanceof Response) return data;
      return Response.json(ok(data, rid));
    } catch (error) {
      if (error instanceof AppError) {
        return Response.json(fail(error.code, error.message, rid, error.details), { status: error.status });
      }
      console.error('[app] unhandled error', rid, error);
      return Response.json(fail('INTERNAL_ERROR', '服务内部错误，请稍后重试。', rid), { status: 500 });
    }
  };
}