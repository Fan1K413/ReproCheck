// 定向路由遍历：38 条业务路由（真实 id 替换参数），检查内容、横向溢出与标题
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const PID = 'proj-209c77cd39f94212'
const OUT = path.resolve('../.screenshots')
const templates = [
  '/', '/projects', '/projects/new', '/projects/:pid/workbench',
  '/settings/llm', '/settings/models', '/demo/audit',
  '/projects/:pid/materials', '/materials/:mid', '/projects/:pid/tasks',
  '/projects/:pid/facts', '/projects/:pid/evidence-graph', '/projects/:pid/overview',
  '/projects/:pid/verification', '/projects/:pid/handoff',
  '/projects/:pid/experiments/diff', '/projects/:pid/change-monitor',
  '/projects/:pid/reproduction', '/reproductions/plans/:planId', '/reproductions/runs/:runId',
  '/projects/:pid/reproduction/environment', '/projects/:pid/reproduction/comparison',
  '/projects/:pid/reproduction/diagnostics', '/projects/:pid/reproduction/reports',
  '/orgs', '/roles', '/projects/:pid/team', '/benchmark', '/benchmark/:caseId',
  '/fact-schema', '/rules', '/feedback', '/knowledge', '/integrations',
  '/api-tokens', '/governance', '/stats-audit', '/projects/:pid/data-audit',
]
const resolve = (t) =>
  t.replace(':pid', PID).replace(':mid', 'mat-871df978b09448e5').replace(':planId', 'plan-b4bbf8748a2d41')
   .replace(':runId', 'run-5a12abd229444e').replace(':caseId', 'case-c3d8a5d22038455c')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror ${page.url()}: ${e}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console ${page.url()}: ${m.text()}`) })

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.getByText('林晚晴', { exact: true }).last().click({ force: true })
await page.waitForTimeout(250)
await page.getByText('登录工作台', { exact: true }).last().click({ force: true })
await page.waitForTimeout(900)

const rows = []
for (const t of templates) {
  const url = resolve(t)
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  const r = await page.evaluate(() => ({
    path: location.pathname,
    textLen: (document.querySelector('main') ?? document.body).innerText.trim().length,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    title: document.querySelector('.rc-l2-header h1')?.textContent?.trim() ?? null,
    h1: document.querySelector('h1, h2')?.textContent?.trim() ?? null,
  }))
  rows.push({ template: t, ...r })
}
const bad = rows.filter((r) => r.textLen < 40 || r.overflow)
const result = { total: rows.length, ok: rows.length - bad.length, bad, errors: errors.slice(0, 8), rows }
fs.writeFileSync(path.join(OUT, 'v4-route-sweep.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify({ total: result.total, ok: result.ok, bad: result.bad, errors: result.errors }, null, 2))
await browser.close()
