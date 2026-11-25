/* 性能归因：同一页面内依次测量「现状 / 关闭盘面 backdrop-filter / 关闭背景 canvas」的 rAF 帧率 */
import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-perf')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const sample = () =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const t0 = performance.now()
        let last = t0
        const deltas = []
        const tick = (now) => {
          frames += 1
          deltas.push(now - last)
          last = now
          if (performance.now() - t0 < 2500) requestAnimationFrame(tick)
          else {
            const sorted = [...deltas].sort((a, b) => a - b)
            resolve({
              fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
              avg: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
              p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
            })
          }
        }
        requestAnimationFrame(tick)
      }),
  )

const result = {}
result.current = await sample()

await page.evaluate(() => {
  document.querySelector('.rc-disc').style.backdropFilter = 'none'
  document.querySelector('.rc-disc').style.webkitBackdropFilter = 'none'
})
await page.waitForTimeout(600)
result.noDiscBlur = await sample()

await page.evaluate(() => {
  const field = document.querySelector('.rc-field')
  if (field) field.style.display = 'none'
})
await page.waitForTimeout(600)
result.noBackground = await sample()

console.log(JSON.stringify(result, null, 2))
await browser.close()
