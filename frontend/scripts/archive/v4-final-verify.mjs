// V4 验收：三级页面结构 / 图标一致性 / 功能卡防重叠 / 导航与抽屉 / 全站路由遍历
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const PID = 'proj-209c77cd39f94212'
const OUT = path.resolve('../.screenshots')
const report = { checks: {}, routes: null, errors: [] }

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e}`))
page.on('console', (m) => {
  if (m.type() === 'error') report.errors.push(`console: ${m.text()}`)
})

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  await page.getByText('林晚晴', { exact: true }).last().click({ force: true })
  await page.waitForTimeout(250)
  await page.getByText('登录工作台', { exact: true }).last().click({ force: true })
  await page.waitForTimeout(900)
}

async function goto(url, wait = 1600) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
}

await login()

/* 1. 一级工作台：9 个入口图标一致 / 无方块底板 / 中文中心文案 */
await goto('/', 2600)
report.checks.workbench = await page.evaluate(() => {
  const entries = [...document.querySelectorAll('.rc-entry')]
  const icons = entries.map((e) => {
    const svg = e.querySelector('.rc-line-icon svg')
    const box = svg?.getBoundingClientRect()
    const visual = e.querySelector('.rc-entry__visual')?.getBoundingClientRect()
    return {
      label: e.getAttribute('aria-label')?.split('，')[0],
      hasSvg: !!svg,
      iconW: box ? +box.width.toFixed(1) : null,
      iconH: box ? +box.height.toFixed(1) : null,
      visualW: visual ? +visual.width.toFixed(1) : null,
      appPlate: !!e.querySelector('.rc-app-icon'),
      textGlyph: !!e.querySelector('.rc-glyph-ai'),
      angle: e.style.left + ' / ' + e.style.top,
    }
  })
  const brand = document.querySelector('.rc-core__brand-sub')?.textContent?.trim()
  const def = document.querySelector('.rc-core__default')?.textContent?.trim()
  const meta = document.querySelector('.rc-core__meta')?.textContent?.replace(/\s+/g, ' ').trim()
  return { count: entries.length, icons, brand, def, meta }
})
await shot('v4-final-l1-1440.png')

/* 2. 功能空间卡组：三卡零重叠 / 中文副文案 / Esc 关闭 */
await page.evaluate(() => {
  const target = [...document.querySelectorAll('.rc-entry')].find((b) =>
    b.getAttribute('aria-label')?.includes('项目档案'),
  )
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(700)
report.checks.fan = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.rc-fan-card')]
  const boxes = cards.map((c) => c.getBoundingClientRect())
  let overlaps = 0
  for (let i = 0; i < boxes.length; i += 1)
    for (let j = i + 1; j < boxes.length; j += 1) {
      const ix = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left)
      const iy = Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top)
      if (ix > 0 && iy > 0) overlaps += 1
    }
  return {
    count: cards.length,
    overlaps,
    gaps: boxes.slice(1).map((b, i) => +(b.top - boxes[i].bottom).toFixed(1)),
    labels: cards.map((c) => c.querySelector('.rc-fan-card__label')?.textContent),
    subs: cards.map((c) => c.querySelector('.rc-fan-card__route')?.textContent),
    eyebrow: document.querySelector('.rc-fan-eyebrow')?.textContent?.trim(),
    deckLabel: document.querySelector('.rc-fan-deck-label')?.textContent?.trim(),
    hasPathText: cards.some((c) => /\//.test(c.textContent ?? '')),
  }
})
await shot('v4-final-l2-fan-1440.png')

// 点第一张卡应真实跳转到 /projects
await page.locator('.rc-fan-card').first().click()
await page.waitForTimeout(1000)
report.checks.fanNavigate = await page.evaluate(() => location.pathname)

/* 3. 项目档案页：KPI 全中文 / 标题与面包屑一致 */
await goto('/projects', 1500)
report.checks.projects = await page.evaluate(() => ({
  title: document.querySelector('.rc-l2-header h1')?.textContent?.trim(),
  crumb: document.querySelector('.rc-l2-header')?.innerText.split('\n').slice(0, 2),
  overline: document.querySelector('.rcw-overline')?.textContent?.trim(),
  kpis: [...document.querySelectorAll('.rc2-kpi__label')].map((n) => n.textContent?.trim()),
  foots: [...document.querySelectorAll('.rc2-kpi__foot')].map((n) => n.textContent?.trim()),
  hasEndpointText: /GET \/|POST \//.test(document.body.innerText),
}))
await shot('v4-final-l3-projects-1440.png')

/* 4. 解析概览：仪表已走紫色体系、字段路径已移除 */
await goto(`/projects/${PID}/overview`, 1600)
report.checks.overview = await page.evaluate(() => {
  const arc = document.querySelector('.ov-arc--info')
  return {
    eyebrow: document.querySelector('.mb-head__eyebrow')?.textContent?.trim(),
    title: document.querySelector('.mb-head__title')?.textContent?.trim(),
    infoStroke: arc ? getComputedStyle(arc).stroke : null,
    fieldPaths: [...document.querySelectorAll('.ov-float__field, .ov-readout__field')].length,
    hasEndpointText: /GET \/|POST \//.test(document.body.innerText),
  }
})
await shot('v4-final-l4-overview-1440.png')

/* 5. 抽屉：开合、焦点、Esc、37 条入口 */
await goto('/projects', 1200)
await page.getByRole('button', { name: '打开功能目录' }).click()
await page.waitForTimeout(400)
report.checks.drawer = await page.evaluate(() => {
  const drawer = document.querySelector('[data-rc-drawer="true"]')
  const links = drawer ? [...drawer.querySelectorAll('a[href]')].length : 0
  return {
    open: !!drawer,
    focusLabel: document.activeElement?.textContent?.trim().slice(0, 12),
    linkCount: links,
    title: drawer?.querySelector('h2, .rc-drawer__title')?.textContent?.trim() ?? null,
  }
})
await shot('v4-final-l3-drawer-1440.png')
await page.keyboard.press('Escape')
await page.waitForTimeout(400)
report.checks.drawerEsc = await page.evaluate(() => ({
  stillOpen: !!document.querySelector('[data-rc-drawer="true"]'),
  path: location.pathname,
}))

/* 6. 窄屏 1180：无横向溢出 */
await page.setViewportSize({ width: 1180, height: 820 })
await goto('/projects', 1200)
report.checks.narrow = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}))
await shot('v4-final-l3-projects-1180.png')
await page.setViewportSize({ width: 1440, height: 900 })

/* 7. 全站路由遍历（含抽屉导航的真实链接） */
const routes = await page.evaluate(() => {
  const drawerLinks = [...document.querySelectorAll('a[href^="/"]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && !h.startsWith('/login'))
  return [...new Set(drawerLinks)].sort()
})
const results = []
for (const route of routes) {
  const url = route.replace(':projectId', PID).replace(':pid', PID).replace(':planId', 'plan-b4bbf8748a2d41').replace(':runId', 'run-5a12abd229444e').replace(':materialId', 'mat-871df978b09448e5').replace(':caseId', 'case-c3d8a5d22038455c')
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    const ok = await page.evaluate(() => {
      const main = document.querySelector('main') ?? document.body
      return {
        path: location.pathname,
        hasContent: main.innerText.trim().length > 40,
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }
    })
    results.push({ route: url, ...ok })
  } catch (e) {
    results.push({ route: url, fail: String(e) })
  }
}
report.routes = {
  total: results.length,
  ok: results.filter((r) => r.hasContent && !r.overflow && !r.fail).length,
  bad: results.filter((r) => !r.hasContent || r.overflow || r.fail),
}

fs.writeFileSync(path.join(OUT, 'v4-final-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ checks: report.checks, routes: { total: report.routes.total, ok: report.routes.ok }, bad: report.routes.bad, errors: report.errors.slice(0, 6) }, null, 2))
await browser.close()
