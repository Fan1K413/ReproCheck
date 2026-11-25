/* 背景仍在真实渲染的探针：读取 WebGL 控制器写在 canvas 上的 frameCount。用法 node scripts/wb-field-probe.mjs */
import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-probe')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(900)

const read = () =>
  page.evaluate(() => {
    const canvas = document.querySelector('.rc-field canvas')
    return {
      live: document.querySelector('.rc-field')?.className ?? null,
      frameCount: Number(canvas?.dataset.frameCount ?? -1),
      buffer: canvas ? `${canvas.width}×${canvas.height}` : null,
    }
  })

const t0 = await read()
await page.waitForTimeout(3200)
const t1 = await read()
console.log(JSON.stringify({ t0, t1, framesInWindow: t1.frameCount - t0.frameCount }, null, 2))
await browser.close()
