/* 第二轮六档验收：静止图 + 6 项花瓣 + 几何/边界/焦点/画布缓冲。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const VIEWPORTS = [
  [1920, 1080],
  [1600, 900],
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [390, 844],
]
const OUT = path.resolve('../.screenshots/workbench-round2/after')
fs.mkdirSync(OUT, { recursive: true })

function overlaps(a, b) {
  return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y
}

const rows = []
for (const [width, height] of VIEWPORTS) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('rc_token', 'demo-token-round2')
    localStorage.setItem(
      'rc_user',
      JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }),
    )
  })
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
  const pageErrors = []
  const badResponses = []
  page.on('pageerror', (err) => pageErrors.push(String(err)))
  page.on('response', (res) => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`)
  })
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1700)

  const tag = `${width}x${height}`
  await page.screenshot({ path: path.join(OUT, `${tag}-idle.png`) })

  const read = () =>
    page.evaluate(() => {
      const disc = document.querySelector('.rc-disc-shell')?.getBoundingClientRect()
      const core = document.querySelector('.rc-core')?.getBoundingClientRect()
      const canvas = document.querySelector('.rc-field canvas')
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
      return {
        disc: disc ? { x: +disc.x.toFixed(1), y: +disc.y.toFixed(1), w: +disc.width.toFixed(1), h: +disc.height.toFixed(1) } : null,
        core: core ? { w: +core.width.toFixed(1), h: +core.height.toFixed(1) } : null,
        buffer: canvas ? `${canvas.width}×${canvas.height}` : null,
        canvasFrames: Number(canvas?.dataset.frameCount ?? -1),
        fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan') === 'true',
        mode: document.querySelector('.rc-petal-stage')?.getAttribute('data-mode') || null,
        columns: document.querySelector('.rc-petal-stage')?.getAttribute('data-columns') || null,
        panels,
        focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.className || null,
        tooltip: document.querySelector('.rc-tooltip')?.textContent?.trim() || null,
      }
    })

  const idle = await read()
  await page.locator('.rc-entry').nth(3).click()
  await page.waitForTimeout(800)
  await page.screenshot({ path: path.join(OUT, `${tag}-petals.png`) })
  const fan = await read()
  const overflow = fan.panels.filter(
    (p) => p.x < 8 || p.y < 8 || p.right > width - 8 || p.bottom > height - 8,
  )
  const collisions = []
  for (let i = 0; i < fan.panels.length; i += 1) {
    for (let j = i + 1; j < fan.panels.length; j += 1) {
      if (overlaps(fan.panels[i], fan.panels[j])) collisions.push([i, j])
    }
  }
  rows.push({
    viewport: `${width}×${height}`,
    idle,
    fan: {
      mode: fan.mode,
      columns: fan.columns,
      count: fan.panels.length,
      panels: fan.panels,
      overflow,
      collisions,
      focus: fan.focus,
    },
    pageErrors,
    badResponses: [...new Set(badResponses)],
  })
  await context.close()
  await browser.close()
}

fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(rows, null, 2), 'utf8')
console.log(JSON.stringify(rows.map((r) => ({
  viewport: r.viewport,
  disc: r.idle.disc,
  buffer: r.idle.buffer,
  panels: r.fan.count,
  mode: r.fan.mode,
  overflow: r.fan.overflow.length,
  collisions: r.fan.collisions.length,
  pageErrors: r.pageErrors.length,
  badResponses: r.badResponses,
})), null, 2))
