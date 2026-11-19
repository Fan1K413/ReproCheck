// 本地 Function 桥接：Node 24 原生 TS strip-types 运行真实 routes.ts + 内存假 DB。
// 用法：node dev/function-local.mjs [port]
import http from 'node:http';
import { application } from '../functions/routes.ts';
import { createFakeDb, createFakeStorage } from './fake-db.mjs';

const port = Number(process.argv[2] || 8001);
const db = createFakeDb();
const handle = application({
  db,
  storage: createFakeStorage(),
  requireUser: () => { throw new Error('platform identity unavailable locally'); },
  BackendError: class BackendError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } },
  secret: process.env.APP_JWT_SECRET || 'local-dev-secret-not-for-production',
});

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
    });
    const response = await handle({ request, requestId: `local-${Date.now()}` });
    const buf = Buffer.from(await response.arrayBuffer());
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(buf);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: String(err?.message ?? err) } }));
  }
});
server.listen(port, '127.0.0.1', () => {
  console.log(`local function bridge: http://127.0.0.1:${port}/functions/v1/app/api/v1/health`);
});