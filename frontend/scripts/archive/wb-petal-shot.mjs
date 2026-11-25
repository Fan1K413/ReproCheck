/* 快速检查二级花瓣：打开第 N 个入口，截图 + 几何/控制台报告。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const width = Number(process.argv[2] || 1440)
const height = Number(process.argv[3] || 900)
const entryIndex = Number(process.argv[4] || 0)
const outDir = path.resolve('../.screenshots/workbench-round2')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width, height } })
const page = await context.newPage()
const messages = []
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') messages.push(`${msg.type()}: ${msg.text()}`)
})
page.on('pageerror', (error) => messages.push(`pageerror: ${error.message}`))
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
await page.locator('.rc-entry').nth(entryIndex).click()
await page.waitForTimeout(1000)

const report = await page.evaluate(() => {
  const stage = document.querySelector('.rc-petal-stage')
  const stageRect = stage?.getBoundingClientRect()
  const panels = [...document.querySelectorAll('.rc-petal')].map((el) => {
    const r = el.getBoundingClientRect()
    return {
      text: el.querySelector('.rc-petal__label')?.textContent,
      x: +r.x.toFixed(1),
      y: +r.y.toFixed(1),
      w: +r.width.toFixed(1),
      h: +r.height.toFixed(1),
      right: +r.right.toFixed(1),
      bottom: +r.bottom.toFixed(1),
      opacity: getComputedStyle(el).opacity,
    }
  })
  let overlaps = 0
  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      const a = panels[i]
      const b = panels[j]
      if (a.x < b.right && b.x < a.x + a.w && a.y < b.bottom && b.y < a.y + a.h) overlaps++
    }
  }
  const overflow = panels.filter((p) => p.x < 0 || p.y < 0 || p.right > innerWidth || p.bottom > innerHeight)
  const active = document.querySelector('.rc-entry[data-active="true"]')?.getBoundingClientRect()
  const othersOpacity = [...document.querySelectorAll('.rc-entry')]
    .filter((el) => el.getAttribute('data-active') !== 'true')
    .map((el) => getComputedStyle(el).opacity)
  return {
    stage: stageRect ? { x: stageRect.x, y: stageRect.y, w: stageRect.width, h: stageRect.height } : null,
    mode: stage?.getAttribute('data-mode'),
    panels,
    overlaps,
    overflow,
    focus: document.activeElement?.className,
    activeEntry: active ? { x: +active.x.toFixed(1), y: +active.y.toFixed(1) } : null,
    otherEntryOpacities: [...new Set(othersOpacity)],
    disc: (() => {
      const r = document.querySelector('.rc-disc-shell').getBoundingClientRect()
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
    })(),
    core: (() => {
      const r = document.querySelector('.rc-core').getBoundingClientRect()
      return { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }
    })(),
  }
})

await page.screenshot({ path: path.join(outDir, `petal-${width}x${height}-${entryIndex}.png`) })
console.log(JSON.stringify({ report, messages }, null, 2))
await browser.close()
