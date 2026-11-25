/* Wave A · 复现执行系 6 页验收：桌面 1440×900 + 移动 390×844 + 关键交互 + 控制台错误 + 横向溢出 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://localhost:5173'
const OUT = path.resolve('../.screenshots')
fs.mkdirSync(OUT, { recursive: true })

const PID = 'proj-209c77cd39f94212'
const report = { shots: [], consoleErrors: [], pageErrors: [], failedRequests: [], overflow: [], steps: [] }
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
async function clickText(text, exact = false) {
  const handle = await page.evaluateHandle((text, exact) => {
    const els = [...document.querySelectorAll('button, a, [role="tab"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      return exact ? t === text : t.includes(text)
    }) || null
  }, text, exact)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(500)
}
async function goto(route, waitMs = 1400) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 30000 })
  await sleep(waitMs)
}
async function shot(name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  report.shots.push(file)
  console.log('SHOT', file)
}
async function shotViewport(name) {
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file, fullPage: false })
  report.shots.push(file)
  console.log('SHOT', file)
}
async function overflowCheck(name) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    body: document.body.scrollWidth,
  }))
  if (o.sw > o.iw + 2) {
    report.overflow.push({ name, ...o })
    console.log('OVERFLOW', name, JSON.stringify(o))
  }
}

/* ---------- 登录 ---------- */
await step('login', async () => {
  await goto('/login')
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 15000 })
  await sleep(1200)
})

/* ---------- 发现真实 plan / run id ---------- */
let planId = 'plan-b4bbf8748a2d41'
let runId = 'run-5acdb8cd27d946'
await step('discover-ids', async () => {
  await goto(`/projects/${PID}/reproduction`)
  const planHref = await page.evaluate(() => document.querySelector('a[href*="/reproductions/plans/"]')?.getAttribute('href') || null)
  if (planHref) planId = planHref.split('/').pop()
  const runHref = await page.evaluate(() => document.querySelector('a[href*="/reproductions/runs/"]')?.getAttribute('href') || null)
  if (runHref) runId = runHref.split('/').pop()
  console.log('DISCOVERED plan=%s run=%s', planId, runId)
})

const routes = [
  ['v2-waveA-01-overview', `/projects/${PID}/reproduction`],
  ['v2-waveA-02-plan', `/reproductions/plans/${planId}`],
  ['v2-waveA-03-environment', `/projects/${PID}/reproduction/environment`],
  ['v2-waveA-04-console', `/reproductions/runs/${runId}`],
  ['v2-waveA-05-comparison', `/projects/${PID}/reproduction/comparison`],
  ['v2-waveA-06-diagnostics', `/projects/${PID}/reproduction/diagnostics`],
]

/* ---------- 桌面 1440×900 ---------- */
for (const [name, route] of routes) {
  await step(`desktop:${name}`, async () => {
    await goto(route, 1600)
    await shot(name)
    await shotViewport(`${name}-vp`)
    await overflowCheck(name)
  })
}

/* ---------- 关键交互 ---------- */
await step('interaction:overview-perspective', async () => {
  await goto(`/projects/${PID}/reproduction`, 1500)
  await clickText('运行', true).catch(() => clickText('运行'))
  await sleep(900)
  await shot('v2-waveA-01b-overview-run-stack')
  const picked = await page.$('.rc-wa-pick')
  if (picked) { await picked.click(); await sleep(900) }
  await shot('v2-waveA-01c-overview-perspective-move')
})

await step('interaction:plan-timeline', async () => {
  await goto(`/reproductions/plans/${planId}`, 1500)
  const rail = await page.$('.rc-wa-rail__item')
  if (rail) { await rail.click(); await sleep(700) }
  await shot('v2-waveA-02b-plan-timeline-selected')
  const tree = await page.$('.rc-wa-tree__item')
  if (tree) { await tree.click(); await sleep(700) }
  await shot('v2-waveA-02c-plan-tree-selected')
})

await step('interaction:environment-focus', async () => {
  await goto(`/projects/${PID}/reproduction/environment`, 1500)
  const dep = await page.$('.rc-wa-dep')
  if (dep) { await dep.hover(); await sleep(600) }
  await shot('v2-waveA-03b-environment-dep-focus')
})

await step('interaction:console-wave', async () => {
  await goto(`/reproductions/runs/${runId}`, 1800)
  const pt = await page.$('.rc-wa-wave__pt')
  if (pt) { await pt.hover(); await sleep(600); await pt.click(); await sleep(600) }
  await shot('v2-waveA-04b-console-wave-active')
  const log = await page.$('.rc-wa-log__row')
  if (log) { await log.hover(); await sleep(600) }
  await shot('v2-waveA-04c-console-log-linked')
})

await step('interaction:comparison-dual', async () => {
  await goto(`/projects/${PID}/reproduction/comparison`, 1500)
  const picks = await page.$$('.rc-wa-pick')
  if (picks.length > 1) { await picks[1].click(); await sleep(900) }
  await shot('v2-waveA-05b-comparison-switched')
  const row = await page.$('.rc-wa-rowbtn')
  if (row) { await row.click(); await sleep(700) }
  await shot('v2-waveA-05c-comparison-expanded')
})

await step('interaction:diagnostics-decision', async () => {
  await goto(`/projects/${PID}/reproduction/diagnostics`, 1500)
  const btn = await page.$('.rc-wa-decision__btn')
  if (btn) { await btn.click(); await sleep(500) }
  await shot('v2-waveA-06b-diagnostics-decision')
})

/* ---------- 移动 390×844 ---------- */
await step('mobile:viewport', async () => {
  await page.setViewport({ width: 390, height: 844 })
  for (const [name, route] of routes) {
    await goto(route, 1600)
    await shot(`${name}-m`)
    await shotViewport(`${name}-m-vp`)
    await overflowCheck(`${name}-m`)
  }
})

await browser.close()
fs.writeFileSync(path.join(OUT, 'v2-waveA-report.json'), JSON.stringify(report, null, 2))
const failed = report.steps.filter((s) => !s.ok)
console.log(`\nSTEPS ${report.steps.length - failed.length}/${report.steps.length} ok`)
failed.forEach((f) => console.log('FAIL', f.name, f.error))
console.log('consoleErrors', report.consoleErrors.length, 'pageErrors', report.pageErrors.length, 'failedRequests', report.failedRequests.length, 'overflow', report.overflow.length)
report.consoleErrors.slice(0, 12).forEach((e) => console.log('CE:', e))
report.pageErrors.slice(0, 12).forEach((e) => console.log('PE:', e))
report.failedRequests.slice(0, 12).forEach((e) => console.log('FR:', e))
report.overflow.forEach((o) => console.log('OV:', o.name, JSON.stringify(o)))
