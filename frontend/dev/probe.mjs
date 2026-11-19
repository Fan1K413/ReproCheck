// 单域隔离探针：node dev/probe.mjs <domain_identity|domain_benchmark|domain_rules|domain_integrations> [port]
// 只加载指定域模块 + 内存假 DB，避免并行开发时互相影响。
import http from 'node:http';
import { Router, makeHandler, createAccessToken } from '../functions/core.ts';
import { createFakeDb, createFakeStorage } from './fake-db.mjs';

const domain = process.argv[2];
const port = Number(process.argv[3] || 8010);
if (!domain) { console.error('usage: node dev/probe.mjs <domain module name> [port]'); process.exit(1); }
const mod = await import(`../functions/${domain}.ts`);
const db = createFakeDb();
const deps = { db, storage: createFakeStorage(), secret: process.env.APP_JWT_SECRET || 'local-dev-secret-not-for-production' };
const router = new Router();
mod.register(router, deps);
const handle = makeHandler(router, deps);

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  const response = await handle({ request, requestId: `probe-${Date.now()}` });
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(response.status, headers);
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', async () => {
  const token = await createAccessToken('user-72cb6c33fd9a4b0a', 'lead@reprocheck.demo', deps.secret);
  console.log(`probe ${domain}: http://127.0.0.1:${port}/functions/v1/app/api/v1/health`);
  console.log(`LEAD_TOKEN=${token}`);
});