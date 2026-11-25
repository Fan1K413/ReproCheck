/* 展开过程逐帧取证：点击后每 70ms 截一帧，观察形变是否连续、有无突变。 */
import puppeteer from 'puppeteer-core'
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
await goto(`/projects/${PID}/workbench`, 2600)

await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
const t0 = Date.now()
for (let i = 0; i < 8; i += 1) {
  const el = await page.evaluate(() => {
    const open = document.querySelector('.bloom-card.is-open')
    if (!open) return null
    const r = open.getBoundingClientRect()
    return { w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  })
  await page.screenshot({ path: path.join(OUT, `final-bloom-seq-${i}.png`) })
  console.log(i, JSON.stringify(el), `${Date.now() - t0}ms`)
  await sleep(70)
}
await browser.close()
