/* Bloom 展开视觉取证：静止态 / 展开中途（点击后 ~120ms）/ 展开完成 三张截图。
 * 用法：node scripts/v3-bloom-visual.mjs <tag>
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const TAG = process.argv[2] || 'run'
const HEADFUL = process.argv.includes('--headful')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: HEADFUL ? false : 'new',
  args: HEADFUL
    ? ['--no-sandbox', '--window-size=1440,940', '--window-position=0,0']
    : ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

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

await goto(`/projects/${PID}/workbench`, 2600)
await page.screenshot({ path: path.join(OUT, `final-bloom-${TAG}-rest.png`) })

// 展开中途：点击后立刻等待 120ms 截图（动画中段）
await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
await sleep(120)
await page.screenshot({ path: path.join(OUT, `final-bloom-${TAG}-mid.png`) })

await sleep(1600)
await page.screenshot({ path: path.join(OUT, `final-bloom-${TAG}-open.png`) })

// 展开后关键内容是否真的挂载（真实数据）
const facts = await page.evaluate(() => {
  const open = document.querySelector('.bloom-card.is-open')
  return {
    openUnit: open?.getAttribute('data-unit') || null,
    detailTextLen: (open?.querySelector('.bloom-detail')?.textContent || '').trim().length,
    hasRegion: !!open?.querySelector('[role="region"]'),
  }
})

console.log(JSON.stringify({ tag: TAG, facts, errors }, null, 2))
await browser.close()
