/* 快速视觉回归：单尺寸截图 + 核心文字溢出检查。用法 node scripts/wb-shot.mjs 1440 900 [out.png] */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const width = Number(process.argv[2] || 1440)
const height = Number(process.argv[3] || 900)
const BASE_DIR = path.resolve('../.screenshots/workbench-radial')
fs.mkdirSync(BASE_DIR, { recursive: true })
const name = process.argv[4] || `shot-${width}x${height}.png`
const out = path.join(BASE_DIR, name)

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width, height } })
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
await page.screenshot({ path: out })

const report = await page.evaluate(() => {
  const shell = document.querySelector('.rc-disc-shell').getBoundingClientRect()
  const core = document.querySelector('.rc-core').getBoundingClientRect()
  const lines = [...document.querySelectorAll('.rc-core__live *, .rc-core__meta *')]
    .filter((el) => el.textContent.trim() && el.children.length === 0)
    .map((el) => {
      const r = el.getBoundingClientRect()
      return { text: el.textContent.trim(), w: +r.width.toFixed(1), left: +r.left.toFixed(1), right: +r.right.toFixed(1) }
    })
  return {
    disc: { w: +shell.width.toFixed(2), h: +shell.height.toFixed(2), x: +shell.x.toFixed(1), y: +shell.y.toFixed(1) },
    core: { w: +core.width.toFixed(2), h: +core.height.toFixed(2) },
    lines,
    coreRight: +(core.right).toFixed(1),
    coreLeft: +(core.left).toFixed(1),
    tracks: ['.rc-track--entry', '.rc-track--guide', '.rc-tick', '.rc-disc', '.rc-entry__bead'].map((sel) => {
      const el = document.querySelector(sel)
      if (!el) return { sel, missing: true }
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        sel,
        rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) },
        z: cs.zIndex,
        opacity: cs.opacity,
        border: `${cs.borderTopWidth} ${cs.borderTopColor}`,
        bg: cs.backgroundColor,
        transform: cs.transform,
      }
    }),
    tickCount: document.querySelectorAll('.rc-tick').length,
  }
})
console.log(JSON.stringify(report, null, 2))
await browser.close()
