import assert from 'node:assert/strict';
import test from 'node:test';
import { application } from '../functions/routes.ts';
import { createAccessToken } from '../functions/core.ts';
import { createFakeDb } from './fake-db.mjs';

test('Site routes authorize projects and store audit results', async () => {
  const db = createFakeDb({ withSeed: false });
  const secret = 'site-test-secret-for-local-regression';
  await db.from('users').insert([
    { id: 'u1', email: 'one@test.com', is_active: true },
    { id: 'u2', email: 'two@test.com', is_active: true },
    { id: 'u3', email: 'three@test.com', is_active: true },
  ]);
  await db.from('projects').insert({ id: 'p1' });
  await db.from('project_members').insert([
    { project_id: 'p1', user_id: 'u1', role_key: 'researcher' },
    { project_id: 'p1', user_id: 'u2', role_key: 'viewer' },
  ]);
  await db.from('roles').insert({ id: 'role1', key: 'researcher' });
  await db.from('permissions').insert({ id: 'perm1', key: 'audit.run' });
  await db.from('role_permissions').insert({ role_id: 'role1', permission_id: 'perm1' });
  await db.from('extracted_facts').insert({ id: 1, fact_id: 'fact1', project_id: 'p1',
    material_id: 'm1', field_key: 'batch_size', raw_value: '32', extraction_status: 'supported' });
  const report = { audit_id: 'da1', project_id: 'p1', created_at: '2026-01-01T00:00:00Z',
    findings: [], blocking_count: 0, duration_ms: 2, scope: {} };
  const compute = async (method, path, body) => {
    if (path === 'stats-audit/catalog') return { rules: [] };
    if (path === 'stats-audit/compute') {
      assert.equal(body.operation, 'mean');
      return { value: 2 };
    }
    if (path === 'data-audits/run') {
      assert.equal(body.project_id, 'p1');
      assert.equal(body.files[0].name, 'train.csv');
      return report;
    }
    if (path === 'verdict-summary') {
      assert.deepEqual(body.sources.facts.map(f => f.extraction_status), ['supported']);
      return { verdicts: { VERIFIED: 1 } };
    }
    throw new Error(`Unexpected compute request: ${method} ${path}`);
  };
  const handle = application({ db, secret, compute });
  const tokens = await Promise.all(['one', 'two', 'three'].map((name, index) =>
    createAccessToken(`u${index + 1}`, `${name}@test.com`, secret)));
  async function send(path, body, index = 0, method = body ? 'POST' : 'GET') {
    const response = await handle({ request: new Request(`https://site.test/functions/v1/app/api/v1${path}`, {
      method, headers: { Authorization: `Bearer ${tokens[index]}`, 'Content-Type': body ? 'application/json' : 'text/plain' },
      body: body ? JSON.stringify(body) : undefined,
    }) });
    return [response.status, await response.json()];
  }
  assert.equal((await send('/projects/p1/evidence-graph', null, 2))[0], 404);
  assert.equal((await send('/projects/p1/evidence-graph'))[1].data.counts.facts, 1);
  assert.equal((await send('/projects/p1/verdict-summary'))[1].data.verdicts.VERIFIED, 1);
  assert.equal((await send('/stats-audit/catalog'))[0], 200);
  assert.equal((await send('/stats-audit/compute', { operation: 'mean' }))[1].data.value, 2);
  const csv = { files: [{ name: 'train.csv', text: 'id,value\n1,2\n' }] };
  assert.equal((await send('/projects/p1/data-audits', csv, 1))[0], 403);
  assert.deepEqual((await send('/projects/p1/data-audits', csv))[1].data, report);
  assert.equal((await send('/projects/p1/data-audits'))[1].data.total, 1);
  assert.deepEqual((await send('/projects/p1/data-audits/da1'))[1].data, report);
  const setup = await send('/model-setup', { provider_key: 'qwen', api_key: 'test-source-key', model_id: 'qwen-plus' });
  assert.equal(setup[0], 200);
  assert.equal(setup[1].data.profile.model_id, 'qwen-plus');
  assert.ok(!JSON.stringify(setup).includes('test-source-key'));
  assert.equal((await send('/model-credentials/test-draft', { provider_key: 'qwen', model_id: 'qwen-plus' }))[0], 422);
  const id = setup[1].data.credential.id;
  assert.equal((await send(`/model-credentials/${id}`, null, 0, 'DELETE'))[0], 200);
  assert.equal((await send(`/model-credentials/${id}/test`, {}))[0], 403);
});
