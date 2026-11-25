/* 花瓣二级交互回归：开关、遮罩、切换、键盘、路由、reduced-motion。
   用法 node scripts/wb-petal-interaction.mjs [1440 900] */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const width = Number(process.argv[2] || 1440)
const height = Number(process.argv[3] || 900)
const OUT = path.resolve('../.screenshots/workbench-round2')
fs.mkdirSync(OUT, { recursive: true })

const authScript = () => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem(
    'rc_user',
    JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }),
  )
}

async function mockAuth(page) {
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' },
        organizations: [],
      }),
    }),
  )
  await page.route(/\/api\/v1\/rag\/documents/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [], total: 0 }),
    }),
  )
}

function boxReport(box, W, H) {
  return {
    x: Number(box.x.toFixed(1)),
    y: Number(box.y.toFixed(1)),
    w: Number(box.width.toFixed(1)),
    h: Number(box.height.toFixed(1)),
    right: Number((box.x + box.width).toFixed(1)),
    bottom: Number((box.y + box.height).toFixed(1)),
    inside: box.x >= 0 && box.y >= 0 && box.x + box.width <= W && box.y + box.height <= H,
  }
}

function overlaps(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
}

async function pantGeometry(page, W, H) {
  return page.evaluate(
    ({ W, H }) => {
      const panels = [...document.querySelectorAll('.rc-petal')].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          text: el.querySelector('.rc-petal__label')?.textContent?.trim() || '',
          x: +r.x.toFixed(1),
          y: +r.y.toFixed(1),
          w: +r.width.toFixed(1),
          h: +r.height.toFixed(1),
          right: +(r.x + r.width).toFixed(1),
          bottom: +(r.y + r.height).toFixed(1),
        }
      })
      const disc = document.querySelector('.rc-disc-shell')?.getBoundingClientRect()
      return {
        W,
        H,
        panels,
        stage: {
          mode: document.querySelector('.rc-petal-stage')?.getAttribute('data-mode') || null,
          columns: document.querySelector('.rc-petal-stage')?.getAttribute('data-columns') || null,
        },
        fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan') === 'true',
        disc: disc ? { x: +disc.x.toFixed(1), y: +disc.y.toFixed(1), w: +disc.width.toFixed(1), h: +disc.height.toFixed(1) } : null,
        focus: {
          cls: document.activeElement?.className || null,
          label: document.activeElement?.getAttribute('aria-label') || null,
        },
        scrim: !!document.querySelector('.rc-petal-scrim'),
        close: !!document.querySelector('.rc-petal-close'),
      }
    },
    { W, H },
  )
}

function auditGeometry(report) {
  const overflow = report.panels.filter(
    (p) => p.x < 8 || p.y < 8 || p.right > report.W - 8 || p.bottom > report.H - 8,
  )
  const collisions = []
  for (let i = 0; i < report.panels.length; i += 1) {
    for (let j = i + 1; j < report.panels.length; j += 1) {
      if (overlaps(report.panels[i], report.panels[j])) collisions.push([i, j])
    }
  }
  let discHits = 0
  if (report.disc) {
    const cx = report.disc.x + report.disc.w / 2
    const cy = report.disc.y + report.disc.h / 2
    const r = report.disc.w / 2
    for (const p of report.panels) {
      const nx = Math.max(p.x, Math.min(cx, p.right))
      const ny = Math.max(p.y, Math.min(cy, p.bottom))
      if (Math.hypot(nx - cx, ny - cy) < r) discHits += 1
    }
  }
  return { ...report, overflow, collisions, discHits }
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width, height } })
const page = await context.newPage()
await page.addInitScript(authScript)
await mockAuth(page)
const errors = []
page.on('pageerror', (err) => errors.push(String(err)))
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()} [main]`)
})
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const results = { width, height, steps: [] }
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
const open = async (index) => {
  await page.locator('.rc-entry').nth(index).click()
  await page.waitForTimeout(700)
}
const report = async (name) => {
  const g = auditGeometry(await pantGeometry(page, width, height))
  results.steps.push({ name, ...g })
  return g
}

/* 1. 6 项打开 */
await open(3)
await shot('petal-1440x900-3')
await report('open-6')

/* 1b. 展开后悬停其他入口：核心必须保持当前功能，不得被 hover 重置。 */
const otherEntry = await page.locator('.rc-entry').nth(4).boundingBox()
await page.mouse.move(otherEntry.x + otherEntry.width / 2, otherEntry.y + otherEntry.height / 2, { steps: 5 })
await page.waitForTimeout(160)
const hoverOther = await page.evaluate(() => ({
  coreTitle: document.querySelector('.rc-core__title')?.textContent?.trim() || null,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
  activeCount: document.querySelectorAll('.rc-entry[data-active="true"]').length,
}))
await page.mouse.move(12, 12, { steps: 5 })
await page.waitForTimeout(200)
const hoverLeave = await page.evaluate(() => ({
  coreTitle: document.querySelector('.rc-core__title')?.textContent?.trim() || null,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
  activeCount: document.querySelectorAll('.rc-entry[data-active="true"]').length,
}))
results.steps.push({ name: 'hover-other-entry', hoverOther, hoverLeave })

/* 2. 键盘：ArrowRight x2 / End / Home */
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(120)
const k1 = await page.evaluate(() => ({
  cls: document.activeElement?.className,
  label: document.activeElement?.getAttribute('aria-label'),
}))
await page.keyboard.press('End')
await page.waitForTimeout(120)
const k2 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
await page.keyboard.press('Home')
await page.waitForTimeout(120)
const k3 = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
results.steps.push({ name: 'keyboard', k1, k2, k3 })

/* 3. Tab 从第一片进入第二片 */
await page.keyboard.press('Tab')
await page.waitForTimeout(100)
const tabLabel = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
results.steps.push({ name: 'tab', tabLabel })

/* 4. ESC 关闭，焦点回锚点 */
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
const closedEsc = await page.evaluate(() => ({
  stage: document.querySelectorAll('.rc-petal-stage').length,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
  focus: document.activeElement?.getAttribute('data-index'),
  activeCls: document.activeElement?.className,
}))
results.steps.push({ name: 'esc-close', ...closedEsc })

/* 5. 再开，点右上收起 */
await open(3)
await page.locator('.rc-petal-close').click()
await page.waitForTimeout(500)
const closedButton = await page.evaluate(() => ({
  stage: document.querySelectorAll('.rc-petal-stage').length,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
  focus: document.activeElement?.getAttribute('data-index'),
  activeCls: document.activeElement?.className,
}))
results.steps.push({ name: 'button-close', ...closedButton })

/* 6. 再开，点空白遮罩 */
await open(3)
await page.locator('.rc-petal-scrim').click({ position: { x: 18, y: 18 }, force: true })
await page.waitForTimeout(500)
const closedScrim = await page.evaluate(() => ({
  stage: document.querySelectorAll('.rc-petal-stage').length,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
}))
results.steps.push({ name: 'scrim-close', ...closedScrim })

/* 7. 再开，点同一锚点 */
await open(3)
await page.locator('.rc-entry').nth(3).click({ force: true })
await page.waitForTimeout(500)
const closedAnchor = await page.evaluate(() => ({
  stage: document.querySelectorAll('.rc-petal-stage').length,
  fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
}))
results.steps.push({ name: 'anchor-close', ...closedAnchor })

/* 8. 展开 6 项后点另一个入口，直接切换为 3 项 */
await open(3)
await page.locator('.rc-entry').nth(4).click({ force: true })
await page.waitForTimeout(700)
await shot('state-switch-3item')
const switched = await report('switch-to-3')
results.steps.push({ name: 'switch-labels', labels: switched.panels.map((p) => p.text) })

/* 9. 3 项 + 4 项静态图 */
await open(0)
await shot('state-arc-3item')
await report('arc-3')
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await open(5)
await shot('state-arc-4item')
await report('arc-4')

/* 10. 真实路由：智能审计 → 知识检索（无参数路由） */
await page.keyboard.press('Escape')
await page.waitForTimeout(500)
await open(0)
await page.locator('.rc-petal').filter({ hasText: '知识检索' }).click()
await page.waitForTimeout(900)
const route = {
  path: new URL(page.url()).pathname,
  stage: await page.locator('.rc-petal-stage').count(),
}
results.steps.push({ name: 'route-launch', ...route })
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)

/* 11. reduced-motion 新上下文 */
const rmContext = await browser.newContext({
  viewport: { width, height },
  reducedMotion: 'reduce',
})
const rmPage = await rmContext.newPage()
await rmPage.addInitScript(authScript)
await mockAuth(rmPage)
rmPage.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()} [reduced-motion]`)
})
await rmPage.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await rmPage.waitForTimeout(1400)
await rmPage.locator('.rc-entry').nth(3).click()
await rmPage.waitForTimeout(600)
await rmPage.screenshot({ path: path.join(OUT, 'state-reduced-motion.png') })
const reduced = await rmPage.evaluate(() => {
  const panel = document.querySelector('.rc-petal')
  const style = panel ? getComputedStyle(panel) : null
  return {
    media: matchMedia('(prefers-reduced-motion: reduce)').matches,
    animationName: style?.animationName || null,
    animationDuration: style?.animationDuration || null,
    transition: getComputedStyle(document.querySelector('.rc-disc-shell')).transition,
  }
})
results.steps.push({ name: 'reduced-motion', ...reduced })
await rmContext.close()

results.errors = errors
results.ok =
  errors.length === 0 &&
  results.steps.find((s) => s.name === 'open-6')?.collisions.length === 0 &&
  results.steps.find((s) => s.name === 'open-6')?.overflow.length === 0 &&
  results.steps.find((s) => s.name === 'hover-other-entry')?.hoverOther.coreTitle === '复现验证' &&
  results.steps.find((s) => s.name === 'hover-other-entry')?.hoverOther.fan === 'true' &&
  results.steps.find((s) => s.name === 'hover-other-entry')?.hoverLeave.coreTitle === '复现验证' &&
  results.steps.find((s) => s.name === 'hover-other-entry')?.hoverLeave.fan === 'true' &&
  results.steps.find((s) => s.name === 'esc-close')?.stage === 0 &&
  results.steps.find((s) => s.name === 'button-close')?.stage === 0 &&
  results.steps.find((s) => s.name === 'scrim-close')?.stage === 0 &&
  results.steps.find((s) => s.name === 'anchor-close')?.stage === 0 &&
  results.steps.find((s) => s.name === 'switch-to-3')?.panels.length === 3 &&
  route.path === '/knowledge'

console.log(JSON.stringify(results, null, 2))
await browser.close()
