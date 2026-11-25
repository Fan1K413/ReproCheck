// 检查一级工作台「功能空间」浮层（FeatureFan）卡片是否重叠、中文化现状
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1000)
await page.getByText('林晚晴', { exact: true }).last().click({ force: true })
await page.waitForTimeout(250)
await page.getByText('登录工作台', { exact: true }).last().click({ force: true })
await page.waitForTimeout(900)
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2200)

// 点「项目档案」入口（9 个环绕入口里的第二个）
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('.rc-entry')]
  const target = buttons.find((b) => b.getAttribute('aria-label')?.includes('项目档案'))
  target?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(700)
await page.screenshot({ path: path.join(OUT, 'v4-l2-fan-1440.png') })

const metrics = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.rc-fan-card, .fan-card, .rc-feature-card')]
  const boxes = cards.map((c) => {
    const r = c.getBoundingClientRect()
    return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
  })
  let overlaps = 0
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
      if (ix > 0 && iy > 0) overlaps += 1
    }
  }
  return {
    cardCount: boxes.length,
    boxes,
    overlaps,
    texts: [...document.querySelectorAll('.rc-fan-head, .rc-fan__title, .rc-fan-sub')].map((n) => n.textContent?.trim()),
  }
})
fs.writeFileSync(path.join(OUT, 'v4-fan-metrics.json'), JSON.stringify({ metrics, errors }, null, 2))
console.log(JSON.stringify({ metrics, errors }))
await browser.close()
