/* 第二轮 · 图标墨迹测量：把 9 个入口 SVG 放大到 96px 画到 canvas，量 alpha bbox / 墨量中心。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const outDir = path.resolve('../.screenshots/workbench-round2')
fs.mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const table = await page.evaluate(async () => {
  const entries = [...document.querySelectorAll('.rc-entry')]
  const canvas = document.createElement('canvas')
  canvas.width = 96
  canvas.height = 96
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const rows = []
  for (const entry of entries) {
    const id = entry.querySelector('.rc-glyph')?.className || ''
    const svg = entry.querySelector('.rc-entry__bead svg')
    if (!svg) continue
    const clone = svg.cloneNode(true)
    clone.setAttribute('width', '96')
    clone.setAttribute('height', '96')
    clone.style.color = '#000'
    clone.style.display = 'block'
    const markup = new XMLSerializer().serializeToString(clone)
    const img = new Image()
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup)
    await new Promise((resolve, reject) => {
      img.onload = resolve
      img.onerror = reject
      img.src = url
    })
    ctx.clearRect(0, 0, 96, 96)
    ctx.drawImage(img, 0, 0, 96, 96)
    const data = ctx.getImageData(0, 0, 96, 96).data
    let minX = 96, minY = 96, maxX = -1, maxY = -1, mass = 0
    for (let y = 0; y < 96; y++) {
      for (let x = 0; x < 96; x++) {
        const alpha = data[(y * 96 + x) * 4 + 3]
        if (alpha > 26) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
          mass += alpha / 255
        }
      }
    }
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    rows.push({
      key: entry.getAttribute('aria-label') || id,
      boxPx: { x: minX, y: minY, w, h },
      boxUnits: { w: +(w / 4).toFixed(2), h: +(h / 4).toFixed(2) },
      centerPx: { x: +((minX + maxX + 1) / 2).toFixed(2), y: +((minY + maxY + 1) / 2).toFixed(2) },
      offsetUnits: {
        dx: +(((minX + maxX + 1) / 2 - 48) / 4).toFixed(2),
        dy: +(((minY + maxY + 1) / 2 - 48) / 4).toFixed(2),
      },
      extentUnits: +(Math.max(w, h) / 4).toFixed(2),
      inkMass: +mass.toFixed(1),
    })
  }
  return rows
})

fs.writeFileSync(path.join(outDir, 'icon-ink.json'), JSON.stringify(table, null, 2))
console.log(JSON.stringify(table, null, 2))
await browser.close()
