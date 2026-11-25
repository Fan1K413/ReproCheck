import { AppError, one, parseJson, projectContext, requirePermission, rows } from './core.ts';
import type { Call, Router } from './core.ts';

export type Compute = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<any>;

export const computeFromSite: Compute = async (method, path, body) => {
  const env = (globalThis as any).Deno?.env;
  const address = String(env?.get('APP_COMPUTE_URL') ?? '').trim();
  const token = String(env?.get('APP_COMPUTE_TOKEN') ?? '');
  let base: URL;
  try {
    base = new URL(address);
    if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash) throw new Error();
  } catch {
    throw new AppError('SERVICE_NOT_CONFIGURED', '请在 Site 服务端配置计算服务的 HTTPS 地址。', null, 503);
  }
  if (token.length < 32) throw new AppError('SERVICE_NOT_CONFIGURED', 'Site 计算服务凭据未配置。', null, 503);

  let response: Response;
  let result: any;
  try {
    response = await fetch(`${base.href.replace(/\/$/, '')}/api/v1/${path}`, {
      method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error', signal: AbortSignal.timeout(25_000),
    });
    result = await response.json();
  } catch {
    throw new AppError('COMPUTE_UNAVAILABLE', 'Site 计算服务暂不可用。', null, 502);
  }
  if (!response.ok || !result?.success) {
    if (response.status === 413 || response.status === 422) {
      throw new AppError('VALIDATION_ERROR', result?.error?.message ?? '审计输入不符合要求。', null, response.status);
    }
    throw new AppError('COMPUTE_UNAVAILABLE', 'Site 计算服务暂不可用。', null, 502);
  }
  return result.data;
};

async function projectRows(c: Call, table: string, fields: string, projectId: string, limit = 5000) {
  return rows(await c.db.from(table).select(fields).eq('project_id', projectId).limit(limit));
}

function locator(value: unknown) {
  return typeof value === 'string' ? parseJson(value, null) : value ?? null;
}

async function evidenceGraph(c: Call) {
  const projectId = c.params.project_id;
  await projectContext(c.db, projectId, c.user!);
  const [facts, evidence, materials, chunks] = await Promise.all([
    projectRows(c, 'extracted_facts', 'id,fact_id,material_id,field_key,field_label,raw_value,normalized_value,extraction_status', projectId, 1000),
    projectRows(c, 'evidence_items', 'evidence_id,fact_id,material_id,chunk_id,quote,verification_status,source_locator', projectId),
    projectRows(c, 'materials', 'id,source_name,sha256', projectId),
    projectRows(c, 'source_chunks', 'material_id,chunk_id,source_locator_json', projectId),
  ]);
  const factById = new Map(facts.map(f => [f.fact_id || String(f.id), f]));
  const materialById = new Map(materials.map(m => [m.id, m]));
  const chunkByKey = new Map(chunks.map(ch => [JSON.stringify([ch.material_id, ch.chunk_id]), ch]));
  const nodes = new Map<string, any>();
  const edges: Array<{ source: string; target: string; type: string }> = [];
  for (const [fid, fact] of factById) {
    const id = `fact:${fid}`;
    nodes.set(id, { id, type: 'fact', label: fact.field_label || fact.field_key,
      fact_id: fid, project_id: projectId, material_id: fact.material_id, field_key: fact.field_key,
      value: fact.normalized_value ?? fact.raw_value, extraction_status: fact.extraction_status });
  }
  for (const item of evidence) {
    const material = materialById.get(item.material_id);
    const chunk = chunkByKey.get(JSON.stringify([item.material_id, item.chunk_id]));
    if (!factById.has(item.fact_id) || !material || !chunk) continue;
    const evidenceId = `evidence:${item.evidence_id}`;
    const chunkId = `chunk:${item.material_id}:${item.chunk_id}`;
    const materialId = `material:${item.material_id}`;
    nodes.set(evidenceId, { id: evidenceId, type: 'evidence', label: (item.quote ?? '').slice(0, 160),
      evidence_id: item.evidence_id, source_locator: locator(item.source_locator),
      verification_status: item.verification_status });
    nodes.set(chunkId, { id: chunkId, type: 'source_chunk', label: chunk.chunk_id, chunk_id: chunk.chunk_id,
      material_id: chunk.material_id, source_locator: locator(chunk.source_locator_json) });
    nodes.set(materialId, { id: materialId, type: 'material', label: material.source_name,
      material_id: material.id, sha256: material.sha256 });
    edges.push({ source: `fact:${item.fact_id}`, target: evidenceId, type: 'supported_by' },
      { source: evidenceId, target: chunkId, type: 'quotes' },
      { source: chunkId, target: materialId, type: 'located_in' });
  }
  const graphNodes = [...nodes.values()];
  const count = (type: string) => graphNodes.filter(n => n.type === type).length;
  return { project_id: projectId, nodes: graphNodes, edges,
    counts: { facts: count('fact'), evidence: count('evidence'), materials: count('material'),
      source_chunks: count('source_chunk'), edges: edges.length } };
}

const VERDICT_COLUMNS = {
  materials: ['materials', 'sha256'],
  facts: ['extracted_facts', 'extraction_status,parser_source,revision_count'],
  evidence_items: ['evidence_items', 'source_locator'],
  findings: ['audit_findings', 'id'],
  audit_evidences: ['evidences', 'page_number,line_number'],
  revisions: ['fact_revisions', 'fact_id'],
  metrics: ['reproduction_metrics', 'extraction_method'],
  comparison_rows: ['metric_comparisons', 'verdict,rule,tolerance_basis'],
  diagnostics: ['failure_diagnostics', 'verification_method'],
};

export function register(router: Router, compute: Compute = computeFromSite) {
  router.get('/api/v1/projects/:project_id/evidence-graph', evidenceGraph);
  router.get('/api/v1/projects/:project_id/verdict-summary', async c => {
    const projectId = c.params.project_id;
    await projectContext(c.db, projectId, c.user!);
    const { revisions, ...direct } = VERDICT_COLUMNS;
    const entries = await Promise.all(Object.entries(direct).map(async ([key, [table, fields]]) =>
      [key, await projectRows(c, table, fields, projectId)]));
    const facts = await projectRows(c, 'extracted_facts', 'id,fact_id', projectId);
    const ids = facts.map(f => f.fact_id || String(f.id));
    const revs = ids.length ? rows(await c.db.from(revisions[0]).select(revisions[1]).in('fact_id', ids)) : [];
    return compute('POST', 'verdict-summary', { project_id: projectId, sources: { ...Object.fromEntries(entries), revisions: revs } });
  });

  router.get('/api/v1/stats-audit/catalog', async () => compute('GET', 'stats-audit/catalog'));
  router.post('/api/v1/stats-audit/run', async c => compute('POST', 'stats-audit/run', c.body));
  router.post('/api/v1/stats-audit/compute', async c => compute('POST', 'stats-audit/compute', c.body));
  router.get('/api/v1/data-audits/rules', async () => compute('GET', 'data-audits/rules'));
  router.post('/api/v1/projects/:project_id/data-audits', async c => {
    const projectId = c.params.project_id;
    const { role } = await projectContext(c.db, projectId, c.user!);
    if (role !== 'platform_admin') await requirePermission(c.db, role, 'audit.run');
    if (!Array.isArray(c.body?.files) || !c.body.files.length) {
      throw new AppError('VALIDATION_ERROR', '请为本次 Site 审计选择 CSV 文件。');
    }
    const report = await compute('POST', 'data-audits/run', { ...c.body, project_id: projectId });
    if (report?.project_id !== projectId || typeof report.audit_id !== 'string' || !Array.isArray(report.findings)) {
      throw new AppError('COMPUTE_UNAVAILABLE', 'Site 计算服务返回了无效的审计报告。', null, 502);
    }
    rows(await c.db.from('data_audit_runs').insert({
      id: report.audit_id, project_id: projectId, status: 'completed',
      created_at: report.created_at, finding_count: report.findings.length,
      blocking_count: report.blocking_count, duration_ms: report.duration_ms,
      report_json: JSON.stringify(report),
    }).select('id'));
    return report;
  });
  router.get('/api/v1/projects/:project_id/data-audits', async c => {
    const projectId = c.params.project_id;
    await projectContext(c.db, projectId, c.user!);
    const items = rows(await c.db.from('data_audit_runs')
      .select('id,created_at,status,finding_count,blocking_count,duration_ms')
      .eq('project_id', projectId).order('created_at', { ascending: false }).limit(20))
      .map(({ id, ...record }) => ({ audit_id: id, ...record }));
    return { items, total: items.length };
  });
  router.get('/api/v1/projects/:project_id/data-audits/:audit_id', async c => {
    const projectId = c.params.project_id;
    await projectContext(c.db, projectId, c.user!);
    const row = one(await c.db.from('data_audit_runs').select('report_json')
      .eq('project_id', projectId).eq('id', c.params.audit_id).limit(1));
    if (!row) throw new AppError('NOT_FOUND', '审计记录不存在。');
    const report = parseJson(row.report_json, null);
    if (!report) throw new AppError('INTERNAL_ERROR', '审计报告无法读取。');
    return report;
  });
}
