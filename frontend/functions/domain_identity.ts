// 身份 / 组织 / 协作域：镜像 backend/app/api/v1/{auth,orgs,collab,roles,projects}.py
// 及 services/{auth_service,org_service,collab_service,trail_service}.py 与 api/deps.py。
// 仅使用可擦除语法（Node 24 strip-types）；密钥/哈希绝不进入响应；邀请明文仅创建时返回一次。
import {
  AppError, newId, nowIso, rows, one, requireStr, intParam,
  orgRole, projectRole, hasPermission,
  hashPassword, verifyPassword, createAccessToken, sha256Hex, generateToken,
} from './core.ts';
import type { Router, Deps, Call, Db, UserRow } from './core.ts';

// ---- 常量（镜像后端） ----
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const INVITATION_EXPIRE_DAYS = 7;
const PROJECT_ROLE_RANK: Record<string, number> = { viewer: 0, reviewer: 1, researcher: 2, project_lead: 3 };
const PROJECT_ROLES = ['project_lead', 'researcher', 'reviewer', 'viewer'];
const COMMENT_TARGETS = ['evidence', 'fact', 'finding', 'material', 'task'];
const REVIEW_TARGETS = ['finding', 'remediation'];
const ORG_ROLES = ['org_admin', 'member'];
const REVIEW_DECISIONS = ['approved', 'rejected', 'changes_requested'];
// Python sorted(set) 的列表字面量（镜像后端 f-string 错误消息）。
const PROJECT_ROLES_MSG = "项目角色须为 ['project_lead', 'researcher', 'reviewer', 'viewer']。";
const COMMENT_TARGETS_MSG = "评论对象须为 ['evidence', 'fact', 'finding', 'material', 'task']。";
const REVIEW_TARGETS_MSG = "复核对象须为 ['finding', 'remediation']。";
// delete_project 级联清理的 project_id 关联表（镜像 projects.py 显式删除列表 + 协作关联）。
const PROJECT_CASCADE_TABLES = [
  'execution_logs', 'execution_artifacts', 'reproduction_metrics', 'metric_comparisons',
  'failure_diagnostics', 'remediation_proposals', 'reproduction_runs', 'execution_environments',
  'reproduction_reports', 'reproduction_tasks', 'reproduction_plans',
  'comments', 'review_requests', 'project_members',
];

const s = (v: any, def = ''): string => (typeof v === 'string' ? v : def);
// core.normalize 会把时间戳读成无时区后缀的 ISO（代表 UTC）；比较时按 UTC 解析。
const parseUtcMs = (v: string): number => Date.parse(/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(v) ? v : v + 'Z');

// ---- 视图（字段名与后端 service 视图 / 前端 types 完全一致） ----
function userView(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    display_name: u.display_name || '',
    is_platform_admin: u.is_platform_admin ?? false,
    created_at: u.created_at || '',
    last_login_at: u.last_login_at ?? null,
  };
}
function orgView(o: any) {
  return {
    id: o.id, name: o.name, slug: o.slug, description: o.description || '',
    owner_user_id: o.owner_user_id ?? null, created_at: o.created_at || '',
  };
}
function projectView(p: any) {
  return {
    id: p.id, name: p.name, domain: p.domain || '', paper_title: p.paper_title || '',
    description: p.description || '', created_at: p.created_at || '',
    owner_user_id: p.owner_user_id ?? null, org_id: p.org_id ?? null,
  };
}

// ---- 审计轨迹（镜像 trail_service.record_trail：before/after 以 JSON 文本入库） ----
type TrailOpts = {
  action: string; actor_user_id?: string | null; org_id?: string | null; project_id?: string | null;
  target_type?: string; target_id?: string; before?: any; after?: any; summary?: string; request_id?: string;
};
async function recordTrail(db: Db, o: TrailOpts): Promise<void> {
  const dump = (v: any): string | null => (v == null ? null : (typeof v === 'string' ? v : JSON.stringify(v)));
  await db.from('audit_trail').insert({
    id: newId('trail'),
    org_id: o.org_id ?? null,
    project_id: o.project_id ?? null,
    actor_user_id: o.actor_user_id ?? null,
    action: o.action,
    target_type: o.target_type ?? '',
    target_id: o.target_id ?? '',
    before_json: dump(o.before),
    after_json: dump(o.after),
    summary: o.summary ?? '',
    request_id: o.request_id ?? '',
    created_at: nowIso(),
  }).select('*');
}

// ---- 组织成员校验（镜像 org_service.ensure_org_member） ----
async function ensureOrgMember(db: Db, user: UserRow, orgId: string, admin = false): Promise<{ org: any; role: string }> {
  const org = one(await db.from('organizations').select('*').eq('id', orgId).limit(1));
  if (!org) throw new AppError('NOT_FOUND', '组织不存在或无权访问。');
  if (user.is_platform_admin) return { org, role: 'org_admin' };
  const role = await orgRole(db, orgId, user.id);
  if (!role) throw new AppError('NOT_FOUND', '组织不存在或无权访问。');
  if (admin && role !== 'org_admin') throw new AppError('FORBIDDEN', '需要组织管理员权限。');
  return { org, role };
}

// ---- 项目访问校验（镜像 deps.resolve_project_access：非成员 404，组织/平台管理员合法 bypass） ----
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

// ---- 权限判定（镜像 deps.user_has_permission：平台管理员 > 组织管理员 > 组织角色 > 项目角色） ----
async function userHasPermission(db: Db, user: UserRow, perm: string, opts: { orgId?: string | null; projectId?: string | null } = {}): Promise<boolean> {
  if (user.is_platform_admin) return true;
  let orgId = opts.orgId ?? null;
  const projectId = opts.projectId ?? null;
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

// ---- 批量取用户/组织（仅安全列，避免 N+1；绝不取 password_hash） ----
async function userMap(db: Db, ids: string[]): Promise<Record<string, any>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: Record<string, any> = {};
  if (!uniq.length) return out;
  const us = rows(await db.from('users').select('id,email,display_name').in('id', uniq).limit(1000));
  for (const u of us) out[u.id] = u;
  return out;
}
async function orgMap(db: Db, ids: string[]): Promise<Record<string, any>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  const out: Record<string, any> = {};
  if (!uniq.length) return out;
  const os = rows(await db.from('organizations').select('*').in('id', uniq).limit(1000));
  for (const o of os) out[o.id] = o;
  return out;
}

// ---- 项目可见集合（镜像 projects._visible_project_ids；平台管理员返回 null=全部） ----
async function visibleProjectIds(db: Db, user: UserRow): Promise<Set<string> | null> {
  if (user.is_platform_admin) return null;
  const pms = rows(await db.from('project_members').select('project_id').eq('user_id', user.id).limit(1000));
  const ids = new Set<string>(pms.map((m: any) => m.project_id));
  const oms = rows(await db.from('org_members').select('org_id').eq('user_id', user.id).eq('role_key', 'org_admin').limit(1000));
  const adminOrgs = oms.map((m: any) => m.org_id);
  if (adminOrgs.length) {
    const ps = rows(await db.from('projects').select('id').in('org_id', adminOrgs).limit(1000));
    for (const p of ps) ids.add(p.id);
  }
  return ids;
}

export function register(router: Router, _deps: Deps): void {
  // ============================ 认证 ============================
  router.post('/api/v1/auth/register', async (c: Call) => {
    const email = requireStr(c.body, 'email').toLowerCase();
    if (!EMAIL_RE.test(email)) throw new AppError('VALIDATION_ERROR', '邮箱格式不正确。');
    const password = s(c.body?.password);
    if (password.length < 8) throw new AppError('VALIDATION_ERROR', '密码至少 8 位。');
    const exists = one(await c.db.from('users').select('id').eq('email', email).limit(1));
    if (exists) throw new AppError('CONFLICT', '该邮箱已注册。');
    const displayName = s(c.body?.display_name).trim() || email.split('@')[0];
    const userId = newId('user');
    const u = one(await c.db.from('users').insert({
      id: userId, email, password_hash: await hashPassword(password), display_name: displayName,
      is_active: true, is_platform_admin: false, created_at: nowIso(), last_login_at: null,
    }).select('*'));
    // 个人组织（镜像 auth_service.register）
    const orgId = newId('org');
    const slug = `u-${userId.slice(-12)}`;
    await c.db.from('organizations').insert({
      id: orgId, name: `${displayName} 的工作空间`, slug,
      description: '注册时自动创建的个人组织。', owner_user_id: userId, created_at: nowIso(),
    }).select('*');
    await c.db.from('org_members').insert({
      id: newId('om'), org_id: orgId, user_id: userId, role_key: 'org_admin', joined_at: nowIso(),
    }).select('*');
    await recordTrail(c.db, {
      action: 'user.register', actor_user_id: userId, org_id: orgId,
      target_type: 'user', target_id: userId, summary: '用户注册', request_id: c.rid,
    });
    const token = await createAccessToken(u.id, u.email, c.secret);
    return { token, user: userView(u) };
  }, { auth: false });

  router.post('/api/v1/auth/login', async (c: Call) => {
    const email = requireStr(c.body, 'email').toLowerCase();
    const password = s(c.body?.password);
    const user = one(await c.db.from('users').select('*').eq('email', email).limit(1));
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw new AppError('UNAUTHORIZED', '邮箱或密码错误。', null, 401);
    }
    if (!user.is_active) throw new AppError('FORBIDDEN', '账户已停用。');
    await c.db.from('users').update({ last_login_at: nowIso() }).eq('id', user.id).select('*');
    await recordTrail(c.db, {
      action: 'user.login', actor_user_id: user.id, target_type: 'user', target_id: user.id,
      summary: '用户登录', request_id: c.rid,
    });
    const u = one(await c.db.from('users').select('*').eq('id', user.id).limit(1));
    const token = await createAccessToken(u.id, u.email, c.secret);
    return { token, user: userView(u) };
  }, { auth: false });

  router.post('/api/v1/auth/logout', async (c: Call) => {
    const user = c.user as UserRow;
    await recordTrail(c.db, {
      action: 'user.logout', actor_user_id: user.id, target_type: 'user', target_id: user.id,
      summary: '用户退出', request_id: c.rid,
    });
    return { logged_out: true };
  });

  router.get('/api/v1/auth/me', async (c: Call) => {
    const user = c.user as UserRow;
    const ms = rows(await c.db.from('org_members').select('*').eq('user_id', user.id).limit(1000));
    const om = await orgMap(c.db, ms.map((m: any) => m.org_id));
    const organizations: any[] = [];
    for (const m of ms) {
      const org = om[m.org_id];
      if (org) organizations.push({ id: org.id, name: org.name, slug: org.slug, role_key: m.role_key });
    }
    return { user: userView(user), organizations };
  });

  // ============================ 组织 ============================
  router.get('/api/v1/orgs', async (c: Call) => {
    const user = c.user as UserRow;
    let items: any[];
    if (user.is_platform_admin) {
      const os = rows(await c.db.from('organizations').select('*').order('created_at', { ascending: false }).limit(1000));
      items = os.map(orgView);
    } else {
      const ms = rows(await c.db.from('org_members').select('*').eq('user_id', user.id).limit(1000));
      const om = await orgMap(c.db, ms.map((m: any) => m.org_id));
      items = [];
      for (const m of ms) {
        const org = om[m.org_id];
        if (org) items.push({ ...orgView(org), role_key: m.role_key });
      }
    }
    return { items, total: items.length };
  });

  router.post('/api/v1/orgs', async (c: Call) => {
    const user = c.user as UserRow;
    const name = s(c.body?.name);
    if (!name.trim()) throw new AppError('VALIDATION_ERROR', '组织名称不能为空。');
    const description = s(c.body?.description);
    const orgId = newId('org');
    const slug = `org-${newId('x').slice(-12)}`;
    const o = one(await c.db.from('organizations').insert({
      id: orgId, name: name.trim(), slug, description, owner_user_id: user.id, created_at: nowIso(),
    }).select('*'));
    await c.db.from('org_members').insert({
      id: newId('om'), org_id: orgId, user_id: user.id, role_key: 'org_admin', joined_at: nowIso(),
    }).select('*');
    await recordTrail(c.db, {
      action: 'org.create', actor_user_id: user.id, org_id: orgId,
      target_type: 'org', target_id: orgId, summary: `创建组织 ${name}`, request_id: c.rid,
    });
    return orgView(o);
  });

  router.get('/api/v1/orgs/:org_id', async (c: Call) => {
    const { org, role } = await ensureOrgMember(c.db, c.user as UserRow, c.params.org_id);
    return { ...orgView(org), role_key: role };
  });

  router.get('/api/v1/orgs/:org_id/members', async (c: Call) => {
    await ensureOrgMember(c.db, c.user as UserRow, c.params.org_id);
    const ms = rows(await c.db.from('org_members').select('*').eq('org_id', c.params.org_id).limit(1000));
    const um = await userMap(c.db, ms.map((m: any) => m.user_id));
    const items = ms.map((m: any) => {
      const u = um[m.user_id];
      return {
        user_id: m.user_id, email: u?.email ?? '', display_name: u?.display_name ?? '',
        role_key: m.role_key, joined_at: m.joined_at || '',
      };
    });
    return { items, total: items.length };
  });

  router.patch('/api/v1/orgs/:org_id/members/:user_id', async (c: Call) => {
    const user = c.user as UserRow;
    const { org_id, user_id } = c.params;
    await ensureOrgMember(c.db, user, org_id, true);
    const roleKey = requireStr(c.body, 'role_key');
    if (!ORG_ROLES.includes(roleKey)) throw new AppError('VALIDATION_ERROR', '组织角色仅支持 org_admin / member。');
    const m = one(await c.db.from('org_members').select('*').eq('org_id', org_id).eq('user_id', user_id).limit(1));
    if (!m) throw new AppError('NOT_FOUND', '成员不存在。');
    const before = m.role_key;
    await c.db.from('org_members').update({ role_key: roleKey }).eq('org_id', org_id).eq('user_id', user_id).select('*');
    await recordTrail(c.db, {
      action: 'member.role_change', actor_user_id: user.id, org_id,
      target_type: 'org_member', target_id: user_id,
      before: { role_key: before }, after: { role_key: roleKey }, summary: '修改组织角色', request_id: c.rid,
    });
    return { user_id, role_key: roleKey };
  });

  router.delete('/api/v1/orgs/:org_id/members/:user_id', async (c: Call) => {
    const user = c.user as UserRow;
    const { org_id, user_id } = c.params;
    await ensureOrgMember(c.db, user, org_id, true);
    const m = one(await c.db.from('org_members').select('*').eq('org_id', org_id).eq('user_id', user_id).limit(1));
    if (!m) throw new AppError('NOT_FOUND', '成员不存在。');
    await c.db.from('org_members').delete().eq('org_id', org_id).eq('user_id', user_id).select('*');
    // 撤销该成员在本组织所有项目中的权限
    const projects = rows(await c.db.from('projects').select('id').eq('org_id', org_id).limit(1000));
    const pids = projects.map((p: any) => p.id);
    if (pids.length) {
      await c.db.from('project_members').delete().eq('user_id', user_id).in('project_id', pids).select('*');
    }
    await recordTrail(c.db, {
      action: 'member.remove', actor_user_id: user.id, org_id,
      target_type: 'org_member', target_id: user_id, before: { role_key: m.role_key },
      summary: '移除成员并撤销项目权限', request_id: c.rid,
    });
    return { removed: user_id, revoked_projects: pids.length };
  });

  // ============================ 邀请 ============================
  router.post('/api/v1/orgs/:org_id/invitations', async (c: Call) => {
    const user = c.user as UserRow;
    const orgId = c.params.org_id;
    await ensureOrgMember(c.db, user, orgId, true);
    const emailRaw = requireStr(c.body, 'email');
    const roleKey = s(c.body?.role_key, 'member');
    if (!ORG_ROLES.includes(roleKey)) throw new AppError('VALIDATION_ERROR', '邀请角色仅支持 org_admin / member。');
    const { plain, hash } = await generateToken('rc_invite');
    const invId = newId('inv');
    const expiresAt = new Date(Date.now() + INVITATION_EXPIRE_DAYS * 86_400_000).toISOString();
    const i = one(await c.db.from('invitations').insert({
      id: invId, org_id: orgId, email: emailRaw.toLowerCase(), role_key: roleKey,
      token_hash: hash, status: 'pending', expires_at: expiresAt, invited_by: user.id,
      created_at: nowIso(), accepted_at: null,
    }).select('*'));
    await recordTrail(c.db, {
      action: 'invitation.create', actor_user_id: user.id, org_id: orgId,
      target_type: 'invitation', target_id: invId, after: { email: emailRaw, role_key: roleKey },
      summary: '创建邀请', request_id: c.rid,
    });
    // 明文 token 仅此一次返回；库存只有 sha256。
    return { id: i.id, email: i.email, role_key: roleKey, status: i.status, expires_at: i.expires_at, token: plain };
  });

  router.get('/api/v1/orgs/:org_id/invitations', async (c: Call) => {
    await ensureOrgMember(c.db, c.user as UserRow, c.params.org_id, true);
    const is = rows(await c.db.from('invitations').select('*').eq('org_id', c.params.org_id)
      .order('created_at', { ascending: false }).limit(1000));
    const items = is.map((i: any) => ({
      id: i.id, email: i.email, role_key: i.role_key, status: i.status,
      expires_at: i.expires_at, created_at: i.created_at,
    }));
    return { items, total: items.length };
  });

  router.post('/api/v1/invitations/accept', async (c: Call) => {
    const user = c.user as UserRow;
    const token = requireStr(c.body, 'token');
    const thash = await sha256Hex(token);
    const inv = one(await c.db.from('invitations').select('*').eq('token_hash', thash).limit(1));
    if (!inv) throw new AppError('NOT_FOUND', '邀请链接无效。');
    if (inv.status !== 'pending') throw new AppError('CONFLICT', `邀请已${inv.status}，无法接受。`);
    const now = Date.now();
    if (parseUtcMs(inv.expires_at) < now) {
      await c.db.from('invitations').update({ status: 'expired' }).eq('id', inv.id).select('*');
      throw new AppError('CONFLICT', '邀请链接已过期。');
    }
    const existing = one(await c.db.from('org_members').select('id').eq('org_id', inv.org_id).eq('user_id', user.id).limit(1));
    if (!existing) {
      await c.db.from('org_members').insert({
        id: newId('om'), org_id: inv.org_id, user_id: user.id, role_key: inv.role_key, joined_at: nowIso(),
      }).select('*');
    }
    await c.db.from('invitations').update({ status: 'accepted', accepted_at: nowIso() }).eq('id', inv.id).select('*');
    await recordTrail(c.db, {
      action: 'invitation.accept', actor_user_id: user.id, org_id: inv.org_id,
      target_type: 'invitation', target_id: inv.id, summary: '接受邀请', request_id: c.rid,
    });
    return { org_id: inv.org_id, role_key: inv.role_key, status: 'accepted' };
  });

  router.post('/api/v1/invitations/:inv_id/revoke', async (c: Call) => {
    const user = c.user as UserRow;
    const invId = c.params.inv_id;
    const inv = one(await c.db.from('invitations').select('*').eq('id', invId).limit(1));
    if (!inv) throw new AppError('NOT_FOUND', '邀请不存在。');
    await ensureOrgMember(c.db, user, inv.org_id, true);
    await c.db.from('invitations').update({ status: 'revoked' }).eq('id', invId).select('*');
    await recordTrail(c.db, {
      action: 'invitation.revoke', actor_user_id: user.id, org_id: inv.org_id,
      target_type: 'invitation', target_id: invId, summary: '撤销邀请', request_id: c.rid,
    });
    return { id: invId, status: 'revoked' };
  });

  // ============================ 团队 / 工作空间 ============================
  router.post('/api/v1/orgs/:org_id/teams', async (c: Call) => {
    const user = c.user as UserRow;
    const orgId = c.params.org_id;
    await ensureOrgMember(c.db, user, orgId, true);
    const name = requireStr(c.body, 'name');
    const description = s(c.body?.description);
    const teamId = newId('team');
    const t = one(await c.db.from('teams').insert({
      id: teamId, org_id: orgId, name, description, created_at: nowIso(),
    }).select('*'));
    await recordTrail(c.db, {
      action: 'team.create', actor_user_id: user.id, org_id: orgId,
      target_type: 'team', target_id: teamId, summary: `创建团队 ${name}`, request_id: c.rid,
    });
    return { id: t.id, org_id: orgId, name: t.name, description: t.description || '' };
  });

  router.get('/api/v1/orgs/:org_id/teams', async (c: Call) => {
    await ensureOrgMember(c.db, c.user as UserRow, c.params.org_id);
    const ts = rows(await c.db.from('teams').select('*').eq('org_id', c.params.org_id).limit(1000));
    const tids = ts.map((t: any) => t.id);
    const counts: Record<string, number> = {};
    if (tids.length) {
      const tms = rows(await c.db.from('team_members').select('team_id').in('team_id', tids).limit(1000));
      for (const tm of tms) counts[tm.team_id] = (counts[tm.team_id] ?? 0) + 1;
    }
    const items = ts.map((t: any) => ({
      id: t.id, name: t.name, description: t.description || '', member_count: counts[t.id] ?? 0,
    }));
    return { items, total: items.length };
  });

  router.post('/api/v1/teams/:team_id/members', async (c: Call) => {
    const user = c.user as UserRow;
    const teamId = c.params.team_id;
    const t = one(await c.db.from('teams').select('*').eq('id', teamId).limit(1));
    if (!t) throw new AppError('NOT_FOUND', '团队不存在。');
    await ensureOrgMember(c.db, user, t.org_id, true);
    const userId = requireStr(c.body, 'user_id');
    const roleInTeam = s(c.body?.role_in_team, 'member');
    const exists = one(await c.db.from('team_members').select('id').eq('team_id', teamId).eq('user_id', userId).limit(1));
    if (exists) throw new AppError('CONFLICT', '该用户已在团队中。');
    await c.db.from('team_members').insert({
      id: newId('tm'), team_id: teamId, user_id: userId, role_in_team: roleInTeam, joined_at: nowIso(),
    }).select('*');
    return { team_id: teamId, user_id: userId, role_in_team: roleInTeam };
  });

  router.get('/api/v1/teams/:team_id/members', async (c: Call) => {
    const user = c.user as UserRow;
    const teamId = c.params.team_id;
    const t = one(await c.db.from('teams').select('*').eq('id', teamId).limit(1));
    // 安全加固（约束 6：组织查询按成员身份隔离）；后端此接口未校验，团队不存在时返回空列表以保持兼容。
    if (t) await ensureOrgMember(c.db, user, t.org_id);
    const tms = rows(await c.db.from('team_members').select('*').eq('team_id', teamId).limit(1000));
    const um = await userMap(c.db, tms.map((m: any) => m.user_id));
    const items = tms.map((m: any) => ({
      user_id: m.user_id, email: um[m.user_id]?.email ?? '', role_in_team: m.role_in_team,
    }));
    return { items, total: items.length };
  });

  router.post('/api/v1/orgs/:org_id/workspaces', async (c: Call) => {
    const user = c.user as UserRow;
    const orgId = c.params.org_id;
    await ensureOrgMember(c.db, user, orgId, true);
    const name = requireStr(c.body, 'name');
    const description = s(c.body?.description);
    const wsId = newId('ws');
    const w = one(await c.db.from('workspaces').insert({
      id: wsId, org_id: orgId, name, description, created_at: nowIso(),
    }).select('*'));
    return { id: w.id, org_id: orgId, name: w.name, description: w.description || '' };
  });

  router.get('/api/v1/orgs/:org_id/workspaces', async (c: Call) => {
    await ensureOrgMember(c.db, c.user as UserRow, c.params.org_id);
    const ws = rows(await c.db.from('workspaces').select('*').eq('org_id', c.params.org_id).limit(1000));
    const items = ws.map((w: any) => ({ id: w.id, name: w.name, description: w.description || '' }));
    return { items, total: items.length };
  });

  // ============================ 项目协作 ============================
  router.post('/api/v1/projects/:project_id/members', async (c: Call) => {
    const user = c.user as UserRow;
    const projectId = c.params.project_id;
    const proj = await resolveProjectAccess(c.db, projectId, user);
    if (!(await userHasPermission(c.db, user, 'project.manage', { projectId }))) {
      throw new AppError('FORBIDDEN', '需要项目管理权限。');
    }
    const userId = requireStr(c.body, 'user_id');
    const roleKey = s(c.body?.role_key, 'researcher');
    if (!PROJECT_ROLES.includes(roleKey)) throw new AppError('VALIDATION_ERROR', PROJECT_ROLES_MSG);
    const target = one(await c.db.from('users').select('id').eq('id', userId).limit(1));
    if (!target) throw new AppError('NOT_FOUND', '用户不存在。');
    const exists = one(await c.db.from('project_members').select('id').eq('project_id', projectId).eq('user_id', userId).limit(1));
    if (exists) throw new AppError('CONFLICT', '该用户已是项目成员。');
    await c.db.from('project_members').insert({
      id: newId('pm'), project_id: projectId, user_id: userId, role_key: roleKey,
      added_by: user.id, added_at: nowIso(),
    }).select('*');
    await recordTrail(c.db, {
      action: 'project.member_add', actor_user_id: user.id, org_id: proj.org_id, project_id: projectId,
      target_type: 'project_member', target_id: userId, after: { role_key: roleKey },
      summary: '分配项目成员', request_id: c.rid,
    });
    return { project_id: projectId, user_id: userId, role_key: roleKey };
  });

  router.get('/api/v1/projects/:project_id/members', async (c: Call) => {
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, c.user as UserRow);
    const pms = rows(await c.db.from('project_members').select('*').eq('project_id', projectId).limit(1000));
    const um = await userMap(c.db, pms.map((m: any) => m.user_id));
    const items = pms.map((m: any) => {
      const u = um[m.user_id];
      return {
        user_id: m.user_id, email: u?.email ?? '', display_name: u?.display_name ?? '',
        role_key: m.role_key, added_at: m.added_at || '',
      };
    });
    return { items, total: items.length };
  });

  router.patch('/api/v1/projects/:project_id/members/:user_id', async (c: Call) => {
    const user = c.user as UserRow;
    const { project_id, user_id } = c.params;
    const proj = await resolveProjectAccess(c.db, project_id, user);
    if (!(await userHasPermission(c.db, user, 'project.manage', { projectId: project_id }))) {
      throw new AppError('FORBIDDEN', '需要项目管理权限。');
    }
    const roleKey = requireStr(c.body, 'role_key');
    if (!PROJECT_ROLES.includes(roleKey)) throw new AppError('VALIDATION_ERROR', '无效项目角色。');
    const pm = one(await c.db.from('project_members').select('*').eq('project_id', project_id).eq('user_id', user_id).limit(1));
    if (!pm) throw new AppError('NOT_FOUND', '项目成员不存在。');
    const before = pm.role_key;
    await c.db.from('project_members').update({ role_key: roleKey }).eq('project_id', project_id).eq('user_id', user_id).select('*');
    await recordTrail(c.db, {
      action: 'project.member_role', actor_user_id: user.id, org_id: proj.org_id, project_id,
      target_type: 'project_member', target_id: user_id,
      before: { role_key: before }, after: { role_key: roleKey }, summary: '修改项目角色', request_id: c.rid,
    });
    return { user_id, role_key: roleKey };
  });

  router.delete('/api/v1/projects/:project_id/members/:user_id', async (c: Call) => {
    const user = c.user as UserRow;
    const { project_id, user_id } = c.params;
    const proj = await resolveProjectAccess(c.db, project_id, user);
    if (!(await userHasPermission(c.db, user, 'project.manage', { projectId: project_id }))) {
      throw new AppError('FORBIDDEN', '需要项目管理权限。');
    }
    const pm = one(await c.db.from('project_members').select('*').eq('project_id', project_id).eq('user_id', user_id).limit(1));
    if (!pm) throw new AppError('NOT_FOUND', '项目成员不存在。');
    await c.db.from('project_members').delete().eq('project_id', project_id).eq('user_id', user_id).select('*');
    await recordTrail(c.db, {
      action: 'project.member_remove', actor_user_id: user.id, org_id: proj.org_id, project_id,
      target_type: 'project_member', target_id: user_id, before: { role_key: pm.role_key },
      summary: '移除项目成员', request_id: c.rid,
    });
    return { removed: user_id };
  });

  router.post('/api/v1/projects/:project_id/comments', async (c: Call) => {
    const user = c.user as UserRow;
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, user);
    if (!(await userHasPermission(c.db, user, 'comment.write', { projectId }))) {
      throw new AppError('FORBIDDEN', '当前角色不能评论。');
    }
    const targetType = requireStr(c.body, 'target_type');
    if (!COMMENT_TARGETS.includes(targetType)) throw new AppError('VALIDATION_ERROR', COMMENT_TARGETS_MSG);
    const targetId = requireStr(c.body, 'target_id');
    const text = s(c.body?.body);
    if (!text.trim()) throw new AppError('VALIDATION_ERROR', '评论内容不能为空。');
    const commentId = newId('cmt');
    const cm = one(await c.db.from('comments').insert({
      id: commentId, project_id: projectId, author_user_id: user.id,
      target_type: targetType, target_id: targetId, body: text.trim(),
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*'));
    await recordTrail(c.db, {
      action: 'comment.create', actor_user_id: user.id, project_id: projectId,
      target_type: targetType, target_id: targetId, summary: '发表评论', request_id: c.rid,
    });
    return {
      id: cm.id, target_type: targetType, target_id: targetId, body: cm.body,
      author_user_id: user.id, created_at: cm.created_at,
    };
  });

  router.get('/api/v1/projects/:project_id/comments', async (c: Call) => {
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, c.user as UserRow);
    const targetType = c.q.get('target_type');
    const targetId = c.q.get('target_id');
    let cs = rows(await c.db.from('comments').select('*').eq('project_id', projectId)
      .order('created_at', { ascending: true }).limit(1000));
    if (targetType) cs = cs.filter((x: any) => x.target_type === targetType);
    if (targetId) cs = cs.filter((x: any) => x.target_id === targetId);
    const um = await userMap(c.db, cs.map((x: any) => x.author_user_id));
    const items = cs.map((x: any) => ({
      id: x.id, target_type: x.target_type, target_id: x.target_id, body: x.body,
      author_user_id: x.author_user_id, author_name: um[x.author_user_id]?.display_name ?? '',
      created_at: x.created_at,
    }));
    return { items, total: items.length };
  });

  router.delete('/api/v1/comments/:comment_id', async (c: Call) => {
    const user = c.user as UserRow;
    const commentId = c.params.comment_id;
    const cm = one(await c.db.from('comments').select('*').eq('id', commentId).limit(1));
    if (!cm) throw new AppError('NOT_FOUND', '评论不存在。');
    await resolveProjectAccess(c.db, cm.project_id, user);
    if (cm.author_user_id !== user.id && !(await userHasPermission(c.db, user, 'project.manage', { projectId: cm.project_id }))) {
      throw new AppError('FORBIDDEN', '只能删除本人评论或需项目管理权限。');
    }
    await c.db.from('comments').delete().eq('id', commentId).select('*');
    return { deleted: commentId };
  });

  router.post('/api/v1/projects/:project_id/reviews', async (c: Call) => {
    const user = c.user as UserRow;
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, user);
    const targetType = requireStr(c.body, 'target_type');
    if (!REVIEW_TARGETS.includes(targetType)) throw new AppError('VALIDATION_ERROR', REVIEW_TARGETS_MSG);
    const targetId = requireStr(c.body, 'target_id');
    const reviewerUserId = c.body?.reviewer_user_id ?? null;
    const reviewId = newId('rev');
    await c.db.from('review_requests').insert({
      id: reviewId, project_id: projectId, target_type: targetType, target_id: targetId,
      requested_by: user.id, reviewer_user_id: reviewerUserId, status: 'pending',
      decision_note: '', created_at: nowIso(), decided_at: null,
    }).select('*');
    await recordTrail(c.db, {
      action: 'review.request', actor_user_id: user.id, project_id: projectId,
      target_type: targetType, target_id: targetId, summary: '提交复核申请', request_id: c.rid,
    });
    return { id: reviewId, target_type: targetType, target_id: targetId, status: 'pending', reviewer_user_id: reviewerUserId };
  });

  router.get('/api/v1/projects/:project_id/reviews', async (c: Call) => {
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, c.user as UserRow);
    const rs = rows(await c.db.from('review_requests').select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(1000));
    const items = rs.map((r: any) => ({
      id: r.id, target_type: r.target_type, target_id: r.target_id, status: r.status,
      requested_by: r.requested_by, reviewer_user_id: r.reviewer_user_id,
      decision_note: r.decision_note || '', created_at: r.created_at, decided_at: r.decided_at ?? null,
    }));
    return { items, total: items.length };
  });

  router.post('/api/v1/reviews/:review_id/decide', async (c: Call) => {
    const user = c.user as UserRow;
    const reviewId = c.params.review_id;
    const r = one(await c.db.from('review_requests').select('*').eq('id', reviewId).limit(1));
    if (!r) throw new AppError('NOT_FOUND', '复核申请不存在。');
    await resolveProjectAccess(c.db, r.project_id, user);
    const status = requireStr(c.body, 'status');
    if (!REVIEW_DECISIONS.includes(status)) throw new AppError('VALIDATION_ERROR', '无效审核结论。');
    const decisionNote = s(c.body?.decision_note);
    const isReviewer = r.reviewer_user_id === user.id;
    if (!isReviewer && !(await userHasPermission(c.db, user, 'review.decide', { projectId: r.project_id }))) {
      throw new AppError('FORBIDDEN', '仅指定审核人或具备审核权限者可裁定。');
    }
    const before = r.status;
    await c.db.from('review_requests').update({ status, decision_note: decisionNote, decided_at: nowIso() })
      .eq('id', reviewId).select('*');
    await recordTrail(c.db, {
      action: 'review.decide', actor_user_id: user.id, project_id: r.project_id,
      target_type: r.target_type, target_id: r.target_id,
      before: { status: before }, after: { status, note: decisionNote }, summary: '审核复核申请', request_id: c.rid,
    });
    return { id: reviewId, status, decision_note: decisionNote };
  });

  router.get('/api/v1/projects/:project_id/activity', async (c: Call) => {
    const projectId = c.params.project_id;
    await resolveProjectAccess(c.db, projectId, c.user as UserRow);
    const limit = intParam(c.q, 'limit', 50, 1, 200);
    const offset = intParam(c.q, 'offset', 0, 0, 1_000_000);
    const all = rows(await c.db.from('audit_trail').select('*').eq('project_id', projectId)
      .order('created_at', { ascending: false }).limit(1000));
    const total = all.length;
    const items = all.slice(offset, offset + limit).map((t: any) => ({
      id: t.id, action: t.action, actor_user_id: t.actor_user_id, target_type: t.target_type,
      target_id: t.target_id, before: t.before_json, after: t.after_json,
      summary: t.summary || '', created_at: t.created_at,
    }));
    return { items, total, limit, offset };
  });

  // ============================ RBAC 目录 ============================
  router.get('/api/v1/roles', async (c: Call) => {
    const rs = rows(await c.db.from('roles').select('*').limit(1000));
    const items = rs.map((r: any) => ({ key: r.key, name: r.name, scope: r.scope, description: r.description || '' }));
    return { items, total: items.length };
  });

  router.get('/api/v1/permissions', async (c: Call) => {
    const ps = rows(await c.db.from('permissions').select('*').limit(1000));
    const items = ps.map((p: any) => ({ key: p.key, description: p.description || '' }));
    return { items, total: items.length };
  });

  router.get('/api/v1/roles/:role_key/permissions', async (c: Call) => {
    const roleKey = c.params.role_key;
    const role = one(await c.db.from('roles').select('*').eq('key', roleKey).limit(1));
    if (!role) throw new AppError('NOT_FOUND', '角色不存在。');
    const rps = rows(await c.db.from('role_permissions').select('permission_id').eq('role_id', role.id).limit(1000));
    const pids = rps.map((rp: any) => rp.permission_id);
    const perms = pids.length ? rows(await c.db.from('permissions').select('*').in('id', pids).limit(1000)) : [];
    return { role_key: roleKey, permissions: perms.map((p: any) => ({ key: p.key, description: p.description || '' })) };
  });

  // ============================ 项目管理 ============================
  router.get('/api/v1/projects', async (c: Call) => {
    let ps = rows(await c.db.from('projects').select('*').order('created_at', { ascending: false }).limit(1000));
    if (c.user) {
      const visible = await visibleProjectIds(c.db, c.user);
      if (visible !== null) ps = ps.filter((p: any) => visible.has(p.id));
    }
    const items = ps.map(projectView);
    return { items, total: items.length };
  }, { auth: false });

  router.post('/api/v1/projects', async (c: Call) => {
    const user = c.user;
    const name = requireStr(c.body, 'name', 200);
    const domain = s(c.body?.domain);
    const paperTitle = s(c.body?.paper_title);
    const description = s(c.body?.description);
    let orgId = c.body?.org_id ?? null;
    const workspaceId = c.body?.workspace_id ?? null;
    if (user && !orgId) {
      const om = one(await c.db.from('org_members').select('org_id').eq('user_id', user.id).limit(1));
      orgId = om?.org_id ?? null;
    }
    const projectId = newId('proj');
    const p = one(await c.db.from('projects').insert({
      id: projectId, name, domain, paper_title: paperTitle, description,
      owner_user_id: user ? user.id : null, org_id: orgId, workspace_id: workspaceId,
      created_at: nowIso(), updated_at: nowIso(),
    }).select('*'));
    if (user) {
      await c.db.from('project_members').insert({
        id: newId('pm'), project_id: projectId, user_id: user.id, role_key: 'project_lead',
        added_by: user.id, added_at: nowIso(),
      }).select('*');
      await recordTrail(c.db, {
        action: 'project.create', actor_user_id: user.id, org_id: orgId, project_id: projectId,
        target_type: 'project', target_id: projectId, after: { name }, summary: '创建项目', request_id: c.rid,
      });
    }
    return projectView(p);
  }, { auth: false });

  router.delete('/api/v1/projects/:project_id', async (c: Call) => {
    const user = c.user;
    if (!user) throw new AppError('UNAUTHORIZED', '需要登录。', null, 401);
    const projectId = c.params.project_id;
    const proj = await resolveProjectAccess(c.db, projectId, user, 3); // project_lead+
    // 级联清理（镜像 projects.delete_project + MaterialService.delete 的 DB 效果）。
    const materials = rows(await c.db.from('materials').select('id').eq('project_id', projectId).limit(1000));
    for (const m of materials) {
      await c.db.from('source_chunks').delete().eq('material_id', m.id).select('*');
      await c.db.from('notebook_cells').delete().eq('material_id', m.id).select('*');
    }
    await c.db.from('extracted_facts').delete().eq('project_id', projectId).select('*');
    await c.db.from('evidences').delete().eq('project_id', projectId).select('*');
    for (const t of PROJECT_CASCADE_TABLES) {
      await c.db.from(t).delete().eq('project_id', projectId).select('*');
    }
    await c.db.from('materials').delete().eq('project_id', projectId).select('*');
    await recordTrail(c.db, {
      action: 'project.delete', actor_user_id: user.id, org_id: proj.org_id, project_id: projectId,
      target_type: 'project', target_id: projectId, before: { name: proj.name },
      summary: '删除项目并级联清理', request_id: c.rid,
    });
    await c.db.from('projects').delete().eq('id', projectId).select('*');
    return { deleted: true, project_id: projectId, materials_removed: materials.length };
  }, { auth: false });
}