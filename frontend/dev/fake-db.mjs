// 本地开发用内存假 DB（supabase 风格子集），仅供 dev/ 本地入口注入；绝不部署。
import { SEED } from '../functions/seed_data.ts';

const UNIQUE = {
  users: [['email']],
  organizations: [['slug']],
  org_members: [['org_id', 'user_id']],
  project_members: [['project_id', 'user_id']],
  team_members: [['team_id', 'user_id']],
  audit_rules: [['rule_key']],
  audit_rule_versions: [['rule_id', 'version']],
  role_permissions: [['role_id', 'permission_id']],
  permissions: [['key']],
  roles: [['key']],
  api_tokens: [['token_hash']],
  invitations: [['token_hash']],
  source_chunks: [['material_id', 'chunk_id']],
  reproduction_tasks: [['plan_id', 'task_key']],
};

export function createFakeDb({ withSeed = true } = {}) {
  const tables = new Map();
  for (const name of Object.keys(SEED)) tables.set(name, withSeed ? SEED[name].map(r => ({ ...r })) : []);
  const get = name => {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name);
  };
  const conflict = (name, row) => {
    const list = get(name);
    if (row.id !== undefined && list.some(r => r.id === row.id)) return true;
    for (const cols of UNIQUE[name] ?? []) {
      if (cols.every(c => row[c] !== undefined) && list.some(r => cols.every(c => r[c] === row[c]))) return true;
    }
    return false;
  };

  function builder(name, op, payload) {
    const filters = [];
    const orders = [];
    let limitN = null;
    let selectCols = null;
    const api = {
      select(cols) { selectCols = cols; return api; },
      eq(col, v) { filters.push(r => r[col] === v); return api; },
      neq(col, v) { filters.push(r => r[col] !== v); return api; },
      in(col, vs) { filters.push(r => vs.includes(r[col])); return api; },
      gte(col, v) { filters.push(r => r[col] >= v); return api; },
      lte(col, v) { filters.push(r => r[col] <= v); return api; },
      gt(col, v) { filters.push(r => r[col] > v); return api; },
      lt(col, v) { filters.push(r => r[col] < v); return api; },
      order(col, { ascending = true } = {}) { orders.push([col, ascending]); return api; },
      limit(n) { limitN = n; return api; },
      maybeSingle() { api._single = true; return api; },
      single() { api._single = true; return api; },
      then(resolve, reject) {
        try { resolve(run()); } catch (e) { reject(e); }
      },
    };
    function matched() {
      let list = get(name).filter(r => filters.every(f => f(r)));
      for (const [col, asc] of orders.slice().reverse()) {
        list = list.slice().sort((a, b) => {
          const av = a[col], bv = b[col];
          if (av === bv) return 0;
          if (av === null || av === undefined) return 1;
          if (bv === null || bv === undefined) return -1;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      return list;
    }
    function project(r) {
      if (!selectCols || selectCols === '*') return { ...r };
      const out = {};
      for (const c of selectCols.split(',').map(s => s.trim())) out[c] = r[c] ?? null;
      return out;
    }
    function run() {
      if (op === 'select') {
        let list = matched();
        if (limitN !== null) list = list.slice(0, limitN);
        const data = list.map(project);
        return { data: api._single ? (data[0] ?? null) : data, error: null };
      }
      if (op === 'insert') {
        const rowsIn = Array.isArray(payload) ? payload : [payload];
        const inserted = [];
        for (const row of rowsIn) {
          if (conflict(name, row)) return { data: null, error: { code: '23505', message: 'duplicate key' } };
          const copy = { ...row };
          get(name).push(copy);
          inserted.push(copy);
        }
        const data = inserted.map(project);
        return { data: api._single ? (data[0] ?? null) : data, error: null };
      }
      if (op === 'insertIfAbsent') {
        if (conflict(name, payload)) return { data: [], error: null };
        const copy = { ...payload };
        get(name).push(copy);
        return { data: [project(copy)], error: null };
      }
      if (op === 'update') {
        const list = matched();
        for (const r of list) Object.assign(r, payload);
        const data = list.map(project);
        return { data: api._single ? (data[0] ?? null) : data, error: null };
      }
      if (op === 'delete') {
        const list = matched();
        const ids = new Set(list);
        tables.set(name, get(name).filter(r => !ids.has(r)));
        const data = list.map(project);
        return { data: api._single ? (data[0] ?? null) : data, error: null };
      }
      return { data: null, error: { code: 'unsupported', message: 'unsupported op' } };
    }
    return api;
  }

  return {
    from(name) {
      return {
        select: cols => builder(name, 'select').select(cols ?? '*'),
        insert: payload => builder(name, 'insert', payload),
        insertIfAbsent: payload => builder(name, 'insertIfAbsent', payload),
        update: payload => builder(name, 'update', payload),
        delete: () => builder(name, 'delete'),
      };
    },
    _tables: tables,
  };
}

export function createFakeStorage() {
  const objects = new Map();
  return {
    async upload(path, body) { objects.set(path, body); return { path }; },
    async download(path) {
      if (!objects.has(path)) { const e = new Error('not found'); e.code = 'storage_object_not_found'; throw e; }
      return new Response(objects.get(path));
    },
    async remove(path) { objects.delete(path); return { ok: true }; },
    async list() { return [...objects.keys()].map(path => ({ name: path })); },
    async createSignedUploadUrl(path) { return { path, token: 'local-fake', signedUrl: `/local-storage/${path}` }; },
    async createSignedUrl(path) { return { signedUrl: `/local-storage/${path}` }; },
  };
}