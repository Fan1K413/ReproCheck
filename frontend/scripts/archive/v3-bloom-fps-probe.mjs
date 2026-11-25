/* 逐项消融探针 v2：3 轮交错重复，降低单次抖动。
 * 变体：原样 / 去 width-height 过渡 / 去 filter 过渡 / 两者都去 / 去常驻 will-change
 * 每轮都重新加载页面，只在页面内注入临时样式，不触源码。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const ROUNDS = 3
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const VARIANTS = [
  { key: 'full', css: '' },
  { key: 'no-width-height', css: '.bloom-card{transition-property:transform,opacity,filter !important}' },
  {
    key: 'no-filter',
    css: '.bloom-card{transition-property:transform,width,height,opacity !important;filter:none !important}',
  },
  {
    key: 'no-layout-no-filter',
    css: '.bloom-card{transition-property:transform,opacity !important;filter:none !important}',
  },
  {
    key: 'no-will-change',
    css: '.bloom-card .bloom-card__surface,.bloom-card .bloom-card__underlay{will-change:auto !important}',
  },
]

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()

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

const rows = []
for (let round = 0; round < ROUNDS; round += 1) {
  // 轮次内顺序错开，避免首个变体总是冷启动
  const order = round % 2 === 0 ? VARIANTS : [...VARIANTS].reverse()
  for (const v of order) {
    await goto(`/projects/${PID}/workbench`, 2400)
    if (v.css) {
      await page.evaluate((css) => {
        const style = document.createElement('style')
        style.id = 'probe-style'
        style.textContent = css
        document.head.appendChild(style)
      }, v.css)
    }
    await page.evaluate(() => {
      window.__f = 0
      window.__long = 0
      let last = performance.now()
      const tick = (t) => {
        window.__f++
        if (t - last > 50) window.__long++
        last = t
        window.__r = requestAnimationFrame(tick)
      }
      window.__r = requestAnimationFrame(tick)
    })
    const t0 = Date.now()
    await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
    await sleep(2000)
    const { frames, longFrames } = await page.evaluate(() => {
      cancelAnimationFrame(window.__r)
      return { frames: window.__f, longFrames: window.__long }
    })
    const seconds = (Date.now() - t0) / 1000
    rows.push({
      variant: v.key, round, frames, longFrames,
      seconds: +seconds.toFixed(2), fps: +(frames / seconds).toFixed(1),
    })
    await page.evaluate(() => document.getElementById('probe-style')?.remove())
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : +((s[mid - 1] + s[mid]) / 2).toFixed(2)
}

const summary = VARIANTS.map((v) => {
  const rs = rows.filter((r) => r.variant === v.key)
  return {
    variant: v.key,
    fps: rs.map((r) => r.fps),
    medianFps: median(rs.map((r) => r.fps)),
    longFramesMedian: median(rs.map((r) => r.longFrames)),
  }
})

const out = {
  note: 'headless Edge + --disable-gpu；3 轮交错重复，取中位数。仅用于同环境相对比较。',
  variants: VARIANTS.map((v) => ({ key: v.key, css: v.css || '(源码原样)' })),
  rows, summary,
}
fs.writeFileSync(path.join(OUT, 'final-bloom-fps-probe.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify({ summary }, null, 2))
await browser.close()
