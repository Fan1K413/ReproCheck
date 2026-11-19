/* 第六阶段 UI 验收脚本：headless Edge 桌面/移动视口巡检 + 关键交互 + 控制台错误采集。 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173'
const SHOTS = path.resolve('.verify-shots')
fs.mkdirSync(SHOTS, { recursive: true })

const report = { steps: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)) })
page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)))
page.on('requestfailed', (r) => report.failedRequests.push(`${r.url()} ${r.failure()?.errorText}`))

async function step(name, fn) {
  try { await fn(); report.steps.push({ name, ok: true }) }
  catch (e) { report.steps.push({ name, ok: false, error: String(e).slice(0, 240) }) }
}
async function clickText(text, exact = false, inDialog = false) {
  const handle = await page.evaluateHandle((text, exact, inDialog) => {
    const root = inDialog ? document.querySelector('[role="dialog"]') : document
    if (!root) return null
    const els = [...root.querySelectorAll('button, a, [role="tab"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      return exact ? t === text : t.includes(text)
    }) || null
  }, text, exact, inDialog)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(500)
}
async function fillInput(selector, value) {
  const ok = await page.evaluate((selector, value) => {
    const el = document.querySelector(selector)
    if (!el) return false
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, selector, value)
  if (!ok) throw new Error(`input not found: ${selector}`)
}
async function goto(route, waitMs = 1200) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(waitMs)
}
async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true })
}
async function overflowCheck(name) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  if (o.sw > o.iw + 2) report.steps.push({ name: `overflow:${name}`, ok: false, error: JSON.stringify(o) })
}

/* ---------- 登录 ---------- */
await step('login', async () => {
  await goto('/login')
  await shot('00-login-desktop')
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 })
  await sleep(1200)
})

const PID = 'proj-209c77cd39f94212'
const CASE = 'case-c3d8a5d22038455c'
const routes = [
  ['01-dashboard', '/'],
  ['02-projects', '/projects'],
  ['03-orgs', '/orgs'],
  ['04-roles', '/roles'],
  ['05-team', `/projects/${PID}/team`],
  ['06-benchmark', '/benchmark'],
  ['07-case', `/benchmark/${CASE}`],
  ['08-fact-schema', '/fact-schema'],
  ['09-rules', '/rules'],
  ['10-feedback', '/feedback'],
  ['11-knowledge', '/knowledge'],
  ['12-integrations', '/integrations'],
  ['13-api-tokens', '/api-tokens'],
  ['14-governance', '/governance'],
  ['15-materials', `/projects/${PID}/materials`],
  ['16-reproduction', `/projects/${PID}/reproduction`],
  ['17-repro-environment', `/projects/${PID}/reproduction/environment`],
  ['18-repro-comparison', `/projects/${PID}/reproduction/comparison`],
  ['19-repro-diagnostics', `/projects/${PID}/reproduction/diagnostics`],
  ['20-repro-reports', `/projects/${PID}/reproduction/reports`],
  ['21-facts', `/projects/${PID}/facts`],
  ['22-parse-tasks', `/projects/${PID}/tasks`],
  ['23-parse-overview', `/projects/${PID}/overview`],
]
for (const [name, route] of routes) {
  await step(`visit:${name}`, async () => { await goto(route); await shot(name); await overflowCheck(name) })
}

/* ---------- 交互 ---------- */
await step('repro:plan+run-detail', async () => {
  await goto(`/projects/${PID}/reproduction`)
  const planHref = await page.evaluate(() => document.querySelector('a[href*="/reproductions/plans/"]')?.getAttribute('href') || null)
  if (!planHref) throw new Error('plan link not found on overview')
  await goto(planHref); await shot('35-repro-plan-detail')
  await goto(`/projects/${PID}/reproduction`)
  const runHref = await page.evaluate(() => document.querySelector('a[href*="/reproductions/runs/"]')?.getAttribute('href') || null)
  if (!runHref) throw new Error('run link not found on overview')
  await goto(runHref); await sleep(800); await shot('36-repro-run-console')
})
await step('orgs:invite-tab+create', async () => {
  await goto('/orgs'); await clickText('开源复现审计实验室'); await sleep(400)
  await clickText('邀请')
  await fillInput('input[type="email"], input[placeholder*="邮箱"]', 'newmember@lab.edu')
  await clickText('发送邀请')
  await sleep(800); await shot('20-org-invite-token')
})
await step('team:tabs', async () => {
  await goto(`/projects/${PID}/team`)
  await clickText('评论'); await sleep(600); await shot('21-team-comments')
  await clickText('复核'); await sleep(600)
  await clickText('活动'); await sleep(800); await shot('22-team-activity')
})
await step('benchmark:search-mode', async () => {
  await goto('/benchmark'); await clickText('语义检索')
  await fillInput('textarea', 'ResNet-50 复现 学习率 warmup')
  await clickText('检索', true).catch(() => clickText('检索'))
  await sleep(1200); await shot('23-benchmark-search')
})
await step('benchmark:create-modal', async () => {
  await clickText('列表浏览'); await sleep(400)
  await clickText('新建案例'); await sleep(500); await shot('24-case-create-modal')
  await page.keyboard.press('Escape'); await sleep(400)
})
await step('case:tabs+recompute', async () => {
  await goto(`/benchmark/${CASE}`)
  await clickText('验证记录'); await sleep(700); await shot('25-case-verifications')
  await clickText('质量评估'); await sleep(500)
  await clickText('重新计算质量'); await sleep(1000); await shot('26-case-recompute')
})
await step('rules:eval-compare', async () => {
  await goto('/rules'); await sleep(600)
  await clickText('accuracy_tolerance')
  await clickText('离线评估'); await sleep(500)
  await clickText('从测试样本载入'); await sleep(400)
  const set = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const base = sels.find((s) => [...s.options].some((o) => o.value === '1' && /v?1/.test(o.textContent)))
    if (base) { base.value = '1'; base.dispatchEvent(new Event('change', { bubbles: true })) }
    return !!base
  })
  if (!set) throw new Error('baseline select not found')
  await sleep(300)
  await fillInput('input[placeholder^="如："]', 'verify://accuracy-v2-samples')
  await clickText('开始离线评估')
  await sleep(1500); await shot('27-rules-eval-compare')
})
await step('feedback:triage', async () => {
  await goto('/feedback'); await sleep(600)
  await clickText('分诊', true); await sleep(500)
  await page.evaluate(() => {
    const modal = document.querySelector('[role="dialog"], .fixed.inset-0') || document
    const sel = modal.querySelector('select')
    if (sel) { sel.value = 'resolved'; sel.dispatchEvent(new Event('change', { bubbles: true })) }
    const ta = modal.querySelector('textarea')
    if (ta) {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, '验收脚本：补充材料已核对，关闭。')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await clickText('确认分诊', false, true)
  await sleep(900); await shot('28-feedback-triaged')
})
await step('knowledge:query', async () => {
  await goto('/knowledge'); await sleep(500)
  await clickText('FID 偏高')
  await clickText('检索', true).catch(() => clickText('检索'))
  await sleep(1400); await shot('29-knowledge-hits')
})
await step('integrations:notebook', async () => {
  await goto('/integrations'); await sleep(700)
  const picked = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const out = []
    for (const s of sels) {
      const opt = [...s.options].find((o) => o.textContent.includes('ResNet') || o.textContent.includes('ipynb'))
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); out.push(opt.textContent) }
    }
    return out
  })
  await sleep(1200)
  const picked2 = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const out = []
    for (const s of sels) {
      const opt = [...s.options].find((o) => o.textContent.includes('ipynb') || o.textContent.includes('notebook'))
      if (opt) { s.value = opt.value; s.dispatchEvent(new Event('change', { bubbles: true })); out.push(opt.textContent) }
    }
    return out
  })
  await sleep(1400); await shot('30-integrations-notebook')
  report.steps.push({ name: 'notebook-selects', ok: true, error: JSON.stringify([...picked, ...picked2]) })
})
await step('tokens:create+logs', async () => {
  await goto('/api-tokens'); await sleep(900); await shot('31-token-logs')
  await clickText('创建令牌'); await sleep(500)
  await fillInput('#token-name', '验收临时令牌')
  await clickText('创建令牌', true, true)
  await sleep(1000); await shot('32-token-plaintext-once')
  await page.keyboard.press('Escape'); await sleep(400)
})
await step('governance:export', async () => {
  await goto('/governance'); await sleep(600)
  await clickText('数据导出'); await sleep(500)
  await clickText('请求导出'); await sleep(1500); await shot('33-governance-export')
  await clickText('保留策略'); await sleep(800); await shot('34-governance-retention')
})

/* ---------- 移动视口 ---------- */
await step('mobile:viewport', async () => {
  await page.setViewport({ width: 390, height: 844 })
  for (const [name, route] of [['40-mobile-dashboard', '/'], ['41-mobile-benchmark', '/benchmark'], ['42-mobile-rules', '/rules'], ['43-mobile-orgs', '/orgs']]) {
    await goto(route, 1000); await shot(name); await overflowCheck(name)
  }
})

await browser.close()
fs.writeFileSync('.verify-report.json', JSON.stringify(report, null, 2))
const failed = report.steps.filter((s) => !s.ok)
console.log(`STEPS ${report.steps.length - failed.length}/${report.steps.length} ok`)
failed.forEach((f) => console.log('FAIL', f.name, f.error))
console.log('consoleErrors', report.consoleErrors.length, 'pageErrors', report.pageErrors.length, 'failedRequests', report.failedRequests.length)
report.consoleErrors.slice(0, 10).forEach((e) => console.log('CE:', e))
report.pageErrors.slice(0, 10).forEach((e) => console.log('PE:', e))
report.failedRequests.slice(0, 10).forEach((e) => console.log('FR:', e))