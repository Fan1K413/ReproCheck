/* CDP 性能计数器探针：用 Performance.getMetrics 的累计计数差值，量化展开动画期间的
 * LayoutDuration / RecalcStyleDuration / ScriptDuration / TaskDuration，
 * 用于区分"布局开销"与"绘制/滤镜开销"。仅诊断，不改源码。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const ROUNDS = 2
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const VARIANTS = [
  { key: 'full', css: '' },
  { key: 'no-filter', css: '.bloom-card{transition-property:transform,width,height,opacity !important;filter:none !important}' },
  { key: 'no-width-height', css: '.bloom-card{transition-property:transform,opacity,filter !important}' },
  { key: 'no-layout-no-filter', css: '.bloom-card{transition-property:transform,opacity !important;filter:none !important}' },
]

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const session = await page.createCDPSession()
await session.send('Performance.enable')

async function metrics() {
  const { metrics: list } = await session.send('Performance.getMetrics')
  return Object.fromEntries(list.map((m) => [m.name, m.value]))
}
function diff(a, b, keys) {
  return Object.fromEntries(keys.map((k) => [k, +((b[k] ?? 0) - (a[k] ?? 0)).toFixed(4)]))
}

async function goto(route, wait = 1600) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(wait)
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

await goto('/login', 1200)
await clickText('林晚晴')
await clickText('登录工作台')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1200)

const KEYS = ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']
const rows = []
for (let round = 0; round < ROUNDS; round += 1) {
  for (const v of VARIANTS) {
    await goto(`/projects/${PID}/workbench`, 2400)
    if (v.css) {
      await page.evaluate((css) => {
        const style = document.createElement('style')
        style.id = 'probe-style'
        style.textContent = css
        document.head.appendChild(style)
      }, v.css)
    }
    await sleep(300)
    const before = await metrics()
    await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
    await sleep(1500)
    const after = await metrics()
    rows.push({ variant: v.key, round, ...diff(before, after, KEYS) })
    await page.evaluate(() => document.getElementById('probe-style')?.remove())
  }
}

const avg = (arr) => +(arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(4)
const summary = VARIANTS.map((v) => {
  const rs = rows.filter((r) => r.variant === v.key)
  const pick = (k) => avg(rs.map((r) => r[k]))
  return {
    variant: v.key,
    TaskDuration_s: pick('TaskDuration'),
    ScriptDuration_s: pick('ScriptDuration'),
    LayoutDuration_s: pick('LayoutDuration'),
    RecalcStyleDuration_s: pick('RecalcStyleDuration'),
    LayoutCount: pick('LayoutCount'),
    RecalcStyleCount: pick('RecalcStyleCount'),
  }
})

const out = {
  note: 'headless Edge + --disable-gpu；1.5s 展开窗口内的 CDP 累计指标差值，每变体 2 轮取均值。',
  rows,
  summary,
}
fs.writeFileSync(path.join(OUT, 'final-bloom-perf-metrics.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(summary, null, 2))
await browser.close()
