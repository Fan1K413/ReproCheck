/* Wave D · stage6 协作治理系 12 页视觉验收（桌面 + 移动） */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = 'C:/Users/ASUS/Desktop/科研复现审计官/.screenshots'
fs.mkdirSync(OUT, { recursive: true })

const report = { steps: [], consoleErrors: [], pageErrors: [] }
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

async function step(name, fn) {
  try { await fn(); report.steps.push({ name, ok: true }) }
  catch (e) { report.steps.push({ name, ok: false, error: String(e).slice(0, 240) }) }
}
async function clickText(text, exact = false) {
  const handle = await page.evaluateHandle((text, exact) => {
    const els = [...document.querySelectorAll('button, a, [role="tab"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      if (!t) return false
      if (exact) return t === text
      return t.includes(text)
    }) || null
  }, text, exact)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.evaluate((node) => (node.scrollIntoView({ block: 'center' }), node))
  await sleep(120)
  await el.click()
  await sleep(500)
}
async function clickTab(text) {
  const handle = await page.evaluateHandle((text) => {
    const tabs = [...document.querySelectorAll('[role="tab"]')]
    return tabs.find((e) => (e.textContent || '').trim().startsWith(text)) || null
  }, text)
  const el = handle.asElement()
  if (!el) throw new Error(`tab not found: ${text}`)
  await el.evaluate((node) => (node.scrollIntoView({ block: 'center' }), node))
  await sleep(120)
  await el.click()
  await sleep(600)
}
async function goto(route, waitMs = 1400) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(waitMs)
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(250)
}
async function shot(name) {
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(200)
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
}
async function overflow(name) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
  if (o.sw > o.iw + 2) report.steps.push({ name: `overflow:${name}`, ok: false, error: JSON.stringify(o) })
  else report.steps.push({ name: `overflow:${name}`, ok: true })
}

/* ---------- 登录 ---------- */
await step('login', async () => {
  await goto('/login')
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 })
  await sleep(1500)
})

const PID = 'proj-209c77cd39f94212'
const CASE = 'case-c3d8a5d22038455c'
const routes = [
  ['v2-waveD-01-orgs', '/orgs'],
  ['v2-waveD-02-roles', '/roles'],
  ['v2-waveD-03-team', `/projects/${PID}/team`],
  ['v2-waveD-04-benchmark', '/benchmark'],
  ['v2-waveD-05-case', `/benchmark/${CASE}`],
  ['v2-waveD-06-fact-schema', '/fact-schema'],
  ['v2-waveD-07-rules', '/rules'],
  ['v2-waveD-08-feedback', '/feedback'],
  ['v2-waveD-09-knowledge', '/knowledge'],
  ['v2-waveD-10-integrations', '/integrations'],
  ['v2-waveD-11-api-tokens', '/api-tokens'],
  ['v2-waveD-12-governance', '/governance'],
]
for (const [name, route] of routes) {
  await step(`visit:${name}`, async () => { await goto(route); await shot(name); await overflow(name) })
}

/* ---------- 特色交互 ---------- */
await step('orgs:tabs', async () => {
  await goto('/orgs')
  await clickTab('邀请'); await sleep(600); await shot('v2-waveD-13-orgs-invitations')
  await clickTab('团队'); await sleep(600); await shot('v2-waveD-14-orgs-teams')
})
await step('fact-schema:fan', async () => {
  await goto('/fact-schema'); await sleep(600)
  const hit = await page.evaluate(() => {
    const p = document.querySelector('.rcw-wheel-sector')
    if (!p) return false
    p.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
  })
  if (!hit) throw new Error('fan sector not found')
  await sleep(700); await shot('v2-waveD-15-factschema-fan')
})
await step('knowledge:query', async () => {
  await goto('/knowledge'); await sleep(500)
  await clickText('FID 偏高')
  await clickText('开始检索')
  await sleep(1600); await shot('v2-waveD-16-knowledge-network')
})
await step('benchmark:search', async () => {
  await goto('/benchmark'); await sleep(600)
  await clickText('语义检索')
  await page.evaluate(() => {
    const ta = document.querySelector('textarea')
    if (!ta) return
    const proto = window.HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(ta, 'ResNet-50 复现 学习率 warmup')
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await clickText('检索', true)
  await sleep(1600); await shot('v2-waveD-17-benchmark-search')
})
await step('case:tabs', async () => {
  await goto(`/benchmark/${CASE}`); await sleep(600)
  await clickTab('验证记录'); await sleep(800); await shot('v2-waveD-18-case-verifications')
  await clickTab('质量评估'); await sleep(600); await shot('v2-waveD-19-case-quality')
})
await step('rules:sort+eval', async () => {
  await goto('/rules'); await sleep(700)
  await clickText('优先级'); await sleep(400); await shot('v2-waveD-20-rules-priority')
  await clickTab('离线评估'); await sleep(500); await shot('v2-waveD-21-rules-eval')
})
await step('feedback:lanes', async () => {
  await goto('/feedback'); await sleep(900); await shot('v2-waveD-22-feedback-lanes')
})
await step('governance:tiers', async () => {
  await goto('/governance'); await sleep(700); await shot('v2-waveD-23-governance-tiers')
  await clickText('AI 授权'); await sleep(800); await shot('v2-waveD-24-governance-consent')
})
await step('integrations:notebook', async () => {
  await goto('/integrations'); await sleep(1000); await shot('v2-waveD-25-integrations')
})
await step('tokens:cards', async () => {
  await goto('/api-tokens'); await sleep(1000); await shot('v2-waveD-26-tokens')
})

/* ---------- 移动视口 ---------- */
await step('mobile', async () => {
  await page.setViewport({ width: 390, height: 844 })
  for (const [name, route] of [
    ['v2-waveD-30-m-orgs', '/orgs'],
    ['v2-waveD-31-m-roles', '/roles'],
    ['v2-waveD-32-m-team', `/projects/${PID}/team`],
    ['v2-waveD-33-m-benchmark', '/benchmark'],
    ['v2-waveD-34-m-case', `/benchmark/${CASE}`],
    ['v2-waveD-35-m-factschema', '/fact-schema'],
    ['v2-waveD-36-m-rules', '/rules'],
    ['v2-waveD-37-m-feedback', '/feedback'],
    ['v2-waveD-38-m-knowledge', '/knowledge'],
    ['v2-waveD-39-m-integrations', '/integrations'],
    ['v2-waveD-40-m-tokens', '/api-tokens'],
    ['v2-waveD-41-m-governance', '/governance'],
  ]) {
    await goto(route, 1100); await shot(name); await overflow(name)
  }
})

await browser.close()
fs.writeFileSync(path.join(OUT, 'v2-waveD-report.json'), JSON.stringify(report, null, 2))
const failed = report.steps.filter((s) => !s.ok)
console.log(`STEPS ${report.steps.length - failed.length}/${report.steps.length} ok`)
failed.forEach((f) => console.log('FAIL', f.name, f.error))
console.log('consoleErrors', report.consoleErrors.length, 'pageErrors', report.pageErrors.length)
report.consoleErrors.slice(0, 12).forEach((e) => console.log('CE:', e))
report.pageErrors.slice(0, 12).forEach((e) => console.log('PE:', e))
