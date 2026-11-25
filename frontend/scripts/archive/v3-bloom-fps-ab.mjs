/* A/B 复核：当前代码（已修复） vs 用注入样式还原旧行为（legacy）。
 * 同一浏览器会话内交错多轮，避免机器负载漂移造成的假结论。
 * 采集：rAF 帧率 + CDP 累计 Layout/Recalc/Script/Task 时长。
 * 用法：node scripts/v3-bloom-fps-ab.mjs [--headful]
 *   --headful = 真实窗口 + 启用 GPU（真机参考），否则 headless + --disable-gpu（纯 CPU 参考）。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const HEADFUL = process.argv.includes('--headful')
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const ROUNDS = HEADFUL ? 3 : 4
const TAG = HEADFUL ? 'gpu' : 'cpu'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LEGACY_CSS = `
.bloom-card{transition-property:transform,width,height,opacity,filter !important}
.bloom-card.is-open .bloom-card__surface{will-change:clip-path !important;backdrop-filter:blur(12px) saturate(1.12) !important;-webkit-backdrop-filter:blur(12px) saturate(1.12) !important}
.bloom-card.is-open .bloom-card__underlay{will-change:clip-path,transform !important}
`

const VARIANTS = [
  { key: 'current', css: '' },
  { key: 'legacy', css: LEGACY_CSS },
]

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: HEADFUL ? false : 'new',
  args: HEADFUL
    ? ['--no-sandbox', '--window-size=1440,940', '--window-position=0,0']
    : ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const session = await page.createCDPSession()
await session.send('Performance.enable')

async function metrics() {
  const { metrics: list } = await session.send('Performance.getMetrics')
  return Object.fromEntries(list.map((m) => [m.name, m.value]))
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

const KEYS = ['TaskDuration', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'LayoutCount']
const rows = []
// 第 -1 轮作为预热（真实窗口首帧含窗口激活/合成器缓存冷启动），只跑不记录。
for (let round = -1; round < ROUNDS; round += 1) {
  const order = Math.abs(round) % 2 === 0 ? VARIANTS : [...VARIANTS].reverse()
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
    await sleep(250)
    const before = await metrics()
    await page.evaluate(() => {
      window.__f = 0
      const tick = () => {
        window.__f++
        window.__r = requestAnimationFrame(tick)
      }
      window.__r = requestAnimationFrame(tick)
    })
    const t0 = Date.now()
    await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
    await sleep(2000)
    const { frames } = await page.evaluate(() => {
      cancelAnimationFrame(window.__r)
      return { frames: window.__f }
    })
    const after = await metrics()
    const seconds = (Date.now() - t0) / 1000
    const delta = Object.fromEntries(KEYS.map((k) => [k, +((after[k] ?? 0) - (before[k] ?? 0)).toFixed(4)]))
    if (round >= 0) {
      rows.push({ variant: v.key, round, frames, seconds: +seconds.toFixed(2), fps: +(frames / seconds).toFixed(1), ...delta })
    }
    await page.evaluate(() => document.getElementById('probe-style')?.remove())
  }
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : +(((s[mid - 1] + s[mid]) / 2).toFixed(2))
}
const summary = VARIANTS.map((v) => {
  const rs = rows.filter((r) => r.variant === v.key)
  const pick = (k) => median(rs.map((r) => r[k]))
  return {
    variant: v.key,
    fps: rs.map((r) => r.fps),
    medianFps: pick('fps'),
    medianTaskDuration_s: pick('TaskDuration'),
    medianLayoutDuration_s: pick('LayoutDuration'),
    medianRecalcStyleDuration_s: pick('RecalcStyleDuration'),
  }
})

const out = {
  note: HEADFUL
    ? '真实窗口 + GPU 合成的 rAF 帧率（真机参考）。'
    : 'headless Edge + --disable-gpu；当前代码 vs 注入还原旧行为，4 轮交错，取中位数。',
  mode: TAG,
  legacyCss: LEGACY_CSS,
  rows, summary,
}
fs.writeFileSync(path.join(OUT, `final-bloom-fps-ab-${TAG}.json`), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify({ summary }, null, 2))
await browser.close()
