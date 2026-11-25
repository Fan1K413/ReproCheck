/* 浅色皮肤覆盖顶栏与抽屉：实测 + 截图取证。
 * 覆盖：浅色页 /orgs、/settings/llm，深色页 /。
 * 逐项校验：抽屉开合、Esc 关闭、焦点进入/归还、全部功能浮层、返回工作台、路由遍历。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

async function goto(route, wait = 1500) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  try {
    await page.waitForSelector('.rc-l2-header', { timeout: 15000 })
  } catch {
    /* Bloom 工作台等沉浸式路由本就没有 L2 顶栏 */
  }
  await sleep(wait)
}
async function clickByAria(label) {
  await page.waitForSelector(`button[aria-label="${label}"]`, { timeout: 15000 })
  await page.evaluate((l) => document.querySelector(`button[aria-label="${l}"]`)?.click(), label)
  await sleep(500)
}
async function clickText(t) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button,a,[role="tab"]')].find((e) => e.textContent.includes(x)) || null,
    t,
  )
  const el = h.asElement()
  if (el) await el.click()
  await sleep(600)
}
const shot = (name) => page.screenshot({ path: path.join(OUT, name) })

const probe = () =>
  page.evaluate(() => {
    const root = document.querySelector('.min-h-screen')
    const header = document.querySelector('.rc-l2-header')
    const drawer = document.querySelector('[data-rc-drawer="true"]')
    const bg = (el) => (el ? getComputedStyle(el).backgroundColor : null)
    const fg = (el) => (el ? getComputedStyle(el).color : null)
    return {
      rootSkin: root?.getAttribute('data-rc-skin') ?? null,
      headerBgImage: header ? getComputedStyle(header).backgroundImage.slice(0, 120) : null,
      headerText: fg(header),
      drawerBg: bg(drawer),
      drawerTranslate: drawer ? getComputedStyle(drawer).transform : null,
      pageSkin: document.querySelector('main [data-rc-skin]')?.getAttribute('data-rc-skin') ?? null,
    }
  })

await goto('/login', 1200)
await clickText('林晚晴')
await clickText('登录工作台')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1200)

const report = {}

/* ---------- 浅色页 1：/orgs ---------- */
await goto('/orgs', 1700)
report.orgsClosed = await probe()
await shot('final-skin-orgs-page.png')

await clickByAria('打开功能目录')
await sleep(450)
report.orgsDrawer = await probe()
report.orgsDrawerFocus = await page.evaluate(() => {
  const active = document.activeElement
  return { tag: active?.tagName, text: (active?.textContent || '').trim().slice(0, 12), inDrawer: !!active?.closest('[data-rc-drawer]') }
})
await shot('final-skin-orgs-drawer.png')

await page.keyboard.press('Escape')
await sleep(400)
report.orgsAfterEsc = await probe()
report.orgsFocusReturn = await page.evaluate(() => {
  const active = document.activeElement
  return { ariaLabel: active?.getAttribute('aria-label') || null }
})

/* ---------- 全部功能浮层（浅色页） ---------- */
await clickByAria('打开全部功能')
await sleep(500)
report.lightAllFeatures = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"]:not([data-rc-drawer])')
  return { open: !!dialog, textLen: (dialog?.textContent || '').trim().length }
})
await shot('final-skin-allfeatures-light.png')
await page.keyboard.press('Escape')
await sleep(350)

/* ---------- 浅色页 2：/settings/llm ---------- */
await goto('/settings/llm', 1700)
report.llmClosed = await probe()
await shot('final-skin-llm-page.png')
await clickByAria('打开功能目录')
await sleep(450)
report.llmDrawer = await probe()
await shot('final-skin-llm-drawer.png')
await page.keyboard.press('Escape')
await sleep(350)

/* ---------- 深色页：/ ---------- */
await goto('/projects', 1700)
report.darkClosed = await probe()
await shot('final-skin-dark-home.png')
await clickByAria('打开功能目录')
await sleep(450)
report.darkDrawer = await probe()
await shot('final-skin-dark-drawer.png')
await page.keyboard.press('Escape')
await sleep(350)

// 用户菜单区域与返回工作台仍在
report.headerControls = await page.evaluate(() => ({
  logout: !!document.querySelector('button[aria-label="退出登录"]'),
  backToWorkbench: !!document.querySelector('.rc-crumb-home'),
  allFeatures: !!document.querySelector('button[aria-label="打开全部功能"]'),
  drawerTrigger: !!document.querySelector('button[aria-label="打开功能目录"]'),
}))

// 返回工作台（crumb）可用
await goto('/orgs', 1500)
await page.evaluate(() => document.querySelector('.rc-crumb-home')?.click())
await sleep(900)
report.backToWorkbench = await page.evaluate(() => location.pathname)

/* ---------- Esc 优先级：浮层 > 抽屉 > 返回 L1 ---------- */
await goto('/orgs', 1500)
await clickByAria('打开功能目录')
await clickByAria('打开全部功能')
report.escStage1 = await page.evaluate(() => ({
  drawerOpen: !!document.querySelector('[data-rc-drawer="true"]')?.getAttribute('role'),
  popoverOpen: !!document.querySelector('[role="dialog"]:not([data-rc-drawer])'),
}))
await page.keyboard.press('Escape')
await sleep(350)
report.escStage2 = await page.evaluate(() => ({
  drawerOpen: !!document.querySelector('[data-rc-drawer="true"]')?.getAttribute('role'),
  popoverOpen: !!document.querySelector('[role="dialog"]:not([data-rc-drawer])'),
}))
await page.keyboard.press('Escape')
await sleep(350)
report.escStage3 = await page.evaluate(() => ({
  path: location.pathname,
  drawerOpen: !!document.querySelector('[data-rc-drawer="true"]')?.getAttribute('role'),
}))

/* ---------- 额外浅色页视觉取证（bleed 布局与表格页各一） ---------- */
for (const [route, name] of [
  [`/projects/${PID}/reproduction/reports`, 'final-skin-reports-page.png'],
  ['/governance', 'final-skin-governance-page.png'],
]) {
  await goto(route, 1600)
  await shot(name)
}

/* ---------- 路由遍历：确认 37 条入口路线全部可访问且皮肤判定稳定 ---------- */
const ROUTES = [
  '/',
  '/projects',
  '/projects/new',
  `/projects/${PID}/workbench`,
  '/settings/llm',
  '/settings/models',
  '/demo/audit',
  `/projects/${PID}/materials`,
  '/materials/mat-871df978b09448e5',
  `/projects/${PID}/tasks`,
  `/projects/${PID}/facts`,
  `/projects/${PID}/evidence-graph`,
  `/projects/${PID}/overview`,
  `/projects/${PID}/verification`,
  `/projects/${PID}/handoff`,
  `/projects/${PID}/experiments/diff`,
  `/projects/${PID}/change-monitor`,
  `/projects/${PID}/reproduction`,
  '/reproductions/plans/plan-b4bbf8748a2d41',
  '/reproductions/runs/run-5a12abd229444e',
  `/projects/${PID}/reproduction/environment`,
  `/projects/${PID}/reproduction/comparison`,
  `/projects/${PID}/reproduction/diagnostics`,
  `/projects/${PID}/reproduction/reports`,
  '/orgs',
  '/roles',
  `/projects/${PID}/team`,
  '/benchmark',
  '/benchmark/case-c3d8a5d22038455c',
  '/fact-schema',
  '/rules',
  '/feedback',
  '/knowledge',
  '/integrations',
  '/api-tokens',
  '/governance',
  '/stats-audit',
  `/projects/${PID}/data-audit`,
]
const routeResult = { total: ROUTES.length, ok: 0, bad: [] }
for (const route of ROUTES) {
  await goto(route, 900)
  const state = await page.evaluate(() => ({
    path: location.pathname,
    hasRoot: !!document.querySelector('#root'),
    bodyLen: (document.body.textContent || '').trim().length,
    err: (document.body.textContent || '').includes('Something went wrong') || (document.body.textContent || '').includes('Unexpected error'),
    skin: document.querySelector('.min-h-screen')?.getAttribute('data-rc-skin') ?? null,
  }))
  if (state.hasRoot && state.bodyLen > 30 && !state.err) routeResult.ok += 1
  else routeResult.bad.push({ route, state })
}
report.routes = routeResult

report.errors = errors.slice(0, 20)
fs.writeFileSync(path.join(OUT, 'final-skin-verify.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
await browser.close()
