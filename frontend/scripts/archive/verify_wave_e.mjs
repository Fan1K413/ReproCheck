/* Wave E 验收脚本：模型设置 / 演示 / 报告 / 登录 / Bloom 舞台
 * 桌面 1440×900 + 移动 390×844，采集控制台错误与横向溢出。
 * 用法：node scripts/verify_wave_e.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = 'C:/Users/ASUS/Desktop/科研复现审计官/.screenshots'
fs.mkdirSync(OUT, { recursive: true })

const PID = 'proj-209c77cd39f94212'
const report = { steps: [], consoleErrors: [], pageErrors: [], overflow: [] }
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
    const els = [...document.querySelectorAll('button, a, [role="tab"], [role="treeitem"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      return exact ? t === text : t.includes(text)
    }) || null
  }, text, exact)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(600)
}
async function goto(route, waitMs = 1400) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 40000 })
  await sleep(waitMs)
}
async function shot(name, full = true) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full })
}
async function overflowCheck(name) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    body: document.body.scrollWidth,
  }))
  if (o.sw > o.iw + 2) report.overflow.push({ name, ...o })
}

/* ---------------- 登录 ---------------- */
await step('login', async () => {
  await goto('/login', 1500)
  await shot('v2-waveE-01-login-desktop')
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
  await sleep(1500)
})

/* ---------------- 桌面路由 ---------------- */
const routes = [
  ['v2-waveE-02-llm-settings', '/settings/llm'],
  ['v2-waveE-03-model-center', '/settings/models'],
  ['v2-waveE-04-demo-audit', '/demo/audit'],
  ['v2-waveE-05-reports', `/projects/${PID}/reproduction/reports`],
  ['v2-waveE-06-bloom-stage', `/projects/${PID}/workbench`],
  ['v2-waveE-07-bloom-atelier', `/projects/${PID}/workbench?view=atelier`],
  ['v2-waveE-08-bloom-loom', `/projects/${PID}/workbench?view=loom`],
]
for (const [name, route] of routes) {
  await step(`visit:${name}`, async () => { await goto(route, 1800); await shot(name); await overflowCheck(name) })
}

/* ---------------- 模型中心交互：分区 + 透视卡 ---------------- */
await step('model-center: sections + deck', async () => {
  await goto('/settings/models', 1600)
  await clickText('我的模型')
  await sleep(700)
  await shot('v2-waveE-03b-model-center-deck')
  await clickText('默认模型')
  await sleep(600)
  await clickText('使用统计')
  await sleep(800)
  await shot('v2-waveE-03c-model-center-stats')
  await clickText('API 凭据')
  await sleep(700)
  await shot('v2-waveE-03d-model-center-credentials')
  await overflowCheck('model-center-interaction')
})

/* ---------------- 演示页交互：运行 + 方案切换 ---------------- */
await step('demo-audit: run + schemes', async () => {
  await goto('/demo/audit', 1200)
  await clickText('开始分析')
  await sleep(9000)
  await shot('v2-waveE-04b-demo-audit-result')
  await clickText('方案二')
  await sleep(900)
  await shot('v2-waveE-04c-demo-audit-scheme2')
  await clickText('方案三')
  await sleep(900)
  await shot('v2-waveE-04d-demo-audit-scheme3')
  await overflowCheck('demo-audit')
})

/* ---------------- 报告页交互：选报告 + 三栏联动 ---------------- */
await step('reports: select + chapters', async () => {
  await goto(`/projects/${PID}/reproduction/reports`, 2200)
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.className.includes('rc-we-report__linkbtn'))
    if (!btn) return false
    btn.click()
    return true
  })
  if (!clicked) throw new Error('报告列表未找到可点击的标题按钮')
  await sleep(2200)
  await shot('v2-waveE-05b-reports-detail')
  const tocCount = await page.evaluate(() => document.querySelectorAll('[role="treeitem"]').length)
  report.steps.push({ name: 'reports:toc-items', ok: tocCount > 0, error: `treeitem=${tocCount}` })
  // 点击目录第二项
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('[role="treeitem"]')]
    if (items[1]) items[1].click()
  })
  await sleep(1200)
  await shot('v2-waveE-05c-reports-toc')
  // 点击正文里的证据 chip
  const chip = await page.evaluate(() => {
    const c = document.querySelector('.rc-we-report__chip')
    if (!c) return false
    c.click()
    return true
  })
  await sleep(900)
  await shot('v2-waveE-05d-reports-evidence')
  report.steps.push({ name: 'reports:evidence-chip', ok: chip, error: '' })
  await overflowCheck('reports')
})

/* ---------------- Bloom 舞台交互：展开瓣卡 ---------------- */
await step('bloom: open petal + views', async () => {
  await goto(`/projects/${PID}/workbench`, 2200)
  const opened = await page.evaluate(() => {
    const btn = document.querySelector('.bloom-card .bloom-compact')
    if (!btn) return false
    btn.click()
    return true
  })
  await sleep(1600)
  await shot('v2-waveE-06b-bloom-open')
  report.steps.push({ name: 'bloom:open-petal', ok: opened, error: '' })
  await overflowCheck('bloom')
  await goto(`/projects/${PID}/workbench?view=loom`, 2400)
  await shot('v2-waveE-08b-bloom-loom-detail')
  await overflowCheck('bloom-loom')
  await goto(`/projects/${PID}/workbench?view=atelier`, 2400)
  await shot('v2-waveE-07b-bloom-atelier-detail')
  await overflowCheck('bloom-atelier')
})

/* ---------------- 移动视口 ---------------- */
await step('mobile:viewport', async () => {
  await page.setViewport({ width: 390, height: 844 })
  await goto('/login', 1200)
  await shot('v2-waveE-10-login-mobile')
  await overflowCheck('login-mobile')
  await goto('/settings/llm', 1600)
  await shot('v2-waveE-11-llm-mobile')
  await overflowCheck('llm-mobile')
  await goto('/settings/models', 1800)
  await shot('v2-waveE-12-model-mobile')
  await overflowCheck('model-mobile')
  await goto('/demo/audit', 1400)
  await shot('v2-waveE-13-demo-mobile')
  await overflowCheck('demo-mobile')
  await goto(`/projects/${PID}/reproduction/reports`, 2200)
  await shot('v2-waveE-14-reports-mobile')
  await overflowCheck('reports-mobile')
  await goto(`/projects/${PID}/workbench`, 2200)
  await shot('v2-waveE-15-bloom-mobile')
  await overflowCheck('bloom-mobile')
})

await browser.close()
fs.writeFileSync(path.join(OUT, 'v2-waveE-report.json'), JSON.stringify(report, null, 2))
const failed = report.steps.filter((s) => !s.ok)
console.log(`STEPS ${report.steps.length - failed.length}/${report.steps.length} ok`)
failed.forEach((f) => console.log('FAIL', f.name, f.error))
console.log('consoleErrors', report.consoleErrors.length, 'pageErrors', report.pageErrors.length)
report.consoleErrors.slice(0, 12).forEach((e) => console.log('CE:', e))
report.pageErrors.slice(0, 12).forEach((e) => console.log('PE:', e))
console.log('OVERFLOW', JSON.stringify(report.overflow))
