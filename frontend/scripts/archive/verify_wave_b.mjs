/* Wave B · 材料解析系 6 页验收截图（桌面 1440×900 / 移动 390×844） */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = 'C:\\Users\\ASUS\\Desktop\\科研复现审计官\\.screenshots'
fs.mkdirSync(OUT, { recursive: true })

const PID = 'proj-209c77cd39f94212'
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

async function goto(route, waitMs = 1600) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 40000 })
  await sleep(waitMs)
}
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `v2-waveB-${name}.png`), fullPage: true })
}
async function overflow(name) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    body: document.body.scrollWidth,
  }))
  const ok = o.sw <= o.iw + 2 && o.body <= o.iw + 2
  report.steps.push({ name: `overflow:${name}`, ok, error: JSON.stringify(o) })
  return ok
}
async function clickText(text, exact = false) {
  const handle = await page.evaluateHandle((text, exact) => {
    const els = [...document.querySelectorAll('button, a, [role="tab"], [role="button"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      return exact ? t === text : t.includes(text)
    }) || null
  }, text, exact)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(700)
}

/* ---------------- 登录 ---------------- */
await goto('/login')
await clickText('林晚晴')
await clickText('登录工作台', true)
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1500)
report.steps.push({ name: 'login', ok: true })

/* ---------------- 桌面 1440×900 ---------------- */
const desktopRoutes = [
  ['materials', `/projects/${PID}/materials`],
  ['material-detail', `/materials/mat-e305657ae1924224`],
  ['tasks', `/projects/${PID}/tasks`],
  ['facts', `/projects/${PID}/facts`],
  ['evidence-graph', `/projects/${PID}/evidence-graph`],
  ['overview', `/projects/${PID}/overview`],
]
for (const [name, route] of desktopRoutes) {
  try {
    await goto(route, 2000)
    await shot(`desktop-${name}`)
    await overflow(`desktop-${name}`)
  } catch (e) {
    report.steps.push({ name: `visit:${name}`, ok: false, error: String(e).slice(0, 240) })
  }
}

/* ---------------- 交互验收 ---------------- */
// 材料页：点击层叠卡 → 详情抽屉
try {
  await goto(`/projects/${PID}/materials`, 1800)
  await page.evaluate(() => {
    const card = document.querySelector('.mb-stack__card')
    if (card) card.click()
  })
  await sleep(900)
  await shot('desktop-materials-drawer')
  const drawer = await page.evaluate(() => !!document.querySelector('.mb-drawer__panel'))
  report.steps.push({ name: 'materials:drawer-open', ok: drawer })
  await page.keyboard.press('Escape')
  await sleep(500)
} catch (e) {
  report.steps.push({ name: 'materials:drawer-open', ok: false, error: String(e).slice(0, 240) })
}

// 事实页：点击结构透视条分段 → 切换筛选
try {
  await goto(`/projects/${PID}/facts`, 2000)
  const before = await page.evaluate(() => document.querySelector('.mb-ribbon__seg--on')?.textContent || '')
  await page.evaluate(() => {
    const segs = [...document.querySelectorAll('.mb-ribbon__seg')]
    if (segs[1]) segs[1].click()
  })
  await sleep(700)
  const after = await page.evaluate(() => document.querySelector('.mb-ribbon__seg--on')?.textContent || '')
  report.steps.push({ name: 'facts:ribbon-filter', ok: before !== after, error: `${before} -> ${after}` })
  await shot('desktop-facts-ribbon')
} catch (e) {
  report.steps.push({ name: 'facts:ribbon-filter', ok: false, error: String(e).slice(0, 240) })
}

// 证据图谱：点击事实节点 → 放射展开
try {
  await goto(`/projects/${PID}/evidence-graph`, 2000)
  await page.evaluate(() => {
    const node = document.querySelector('.mb-fan__node--fact')
    if (node) node.click()
  })
  await sleep(900)
  const opened = await page.evaluate(() => {
    const on = document.querySelectorAll('.mb-fan__node--fact[aria-expanded="true"]').length
    const hidden = document.querySelectorAll('.mb-fan__node--hidden').length
    return { on, hidden }
  })
  report.steps.push({ name: 'evidence:expand', ok: opened.on > 0, error: JSON.stringify(opened) })
  await shot('desktop-evidence-expanded')
} catch (e) {
  report.steps.push({ name: 'evidence:expand', ok: false, error: String(e).slice(0, 240) })
}

// 解析任务：点击流水轨节点 → 展开详情
try {
  await goto(`/projects/${PID}/tasks`, 2000)
  await page.evaluate(() => {
    const node = document.querySelector('.mb-rail__node')
    if (node) node.click()
  })
  await sleep(900)
  const detail = await page.evaluate(() => !!document.querySelector('.mb-steps'))
  report.steps.push({ name: 'tasks:rail-select', ok: detail })
  await shot('desktop-tasks-selected')
} catch (e) {
  report.steps.push({ name: 'tasks:rail-select', ok: false, error: String(e).slice(0, 240) })
}

/* ---------------- 移动 390×844 ---------------- */
await page.setViewport({ width: 390, height: 844 })
for (const [name, route] of desktopRoutes) {
  try {
    await goto(route, 2000)
    await shot(`mobile-${name}`)
    await overflow(`mobile-${name}`)
  } catch (e) {
    report.steps.push({ name: `visit-mobile:${name}`, ok: false, error: String(e).slice(0, 240) })
  }
}

/* ---------------- 汇总 ---------------- */
await browser.close()
const failed = report.steps.filter((s) => !s.ok)
console.log(`STEPS ${report.steps.length - failed.length}/${report.steps.length} ok`)
failed.forEach((f) => console.log('FAIL', f.name, f.error || ''))
console.log('consoleErrors', report.consoleErrors.length, 'pageErrors', report.pageErrors.length)
report.consoleErrors.slice(0, 12).forEach((e) => console.log('CE:', e))
report.pageErrors.slice(0, 12).forEach((e) => console.log('PE:', e))
fs.writeFileSync(path.join(OUT, 'v2-waveB-report.json'), JSON.stringify(report, null, 2))
