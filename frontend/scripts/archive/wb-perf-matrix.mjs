/* 独立性能矩阵：每个分辨率单独启动浏览器，避免多上下文互相干扰。用法 node scripts/wb-perf-matrix.mjs */
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
const OUT = path.resolve('../.screenshots/workbench-round2')
fs.mkdirSync(OUT, { recursive: true })

const rows = []
for (const [width, height] of VIEWPORTS) {
  const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width, height } })
  const page = await context.newPage()
  await page.addInitScript(() => {
    localStorage.setItem('rc_token', 'demo-token-perf')
    localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
  })
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
  )
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)

  /* 悬停态采样：鼠标沿轨道移动，覆盖最费合成的 hover + tooltip */
  const box = await page.locator('.rc-disc-shell').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const sample = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          window.__lt = []
          const obs = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) window.__lt.push(entry.duration)
          })
          try {
            obs.observe({ type: 'longtask', buffered: false })
          } catch {
            /* 不支持 longtask 的环境只报 FPS */
          }
          let frames = 0
          const t0 = performance.now()
          let last = t0
          const deltas = []
          const tick = (now) => {
            frames += 1
            deltas.push(now - last)
            last = now
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick)
            else {
              const sorted = [...deltas].sort((a, b) => a - b)
              obs.disconnect()
              const canvas = document.querySelector('.rc-field canvas')
              resolve({
                fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
                avg: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
                p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
                longFrames: deltas.filter((d) => d > 20).length,
                longTasks: window.__lt.length,
                longestTask: +(Math.max(0, ...window.__lt)).toFixed(1),
                buffer: canvas ? `${canvas.width}×${canvas.height}` : null,
                frames: Number(canvas?.dataset.frameCount ?? -1),
                panels: document.querySelectorAll('.rc-petal').length,
              })
            }
          }
          requestAnimationFrame(tick)
        }),
    )
  const framesPromise = sample()
  const start = Date.now()
  let i = 0
  while (Date.now() - start < 2600) {
    const a = ((i / 200) * 360 * Math.PI) / 180
    await page.mouse.move(cx + Math.sin(a) * box.width * 0.33, cy - Math.cos(a) * box.width * 0.33)
    i += 1
    await page.waitForTimeout(10)
  }
  const rAF = await framesPromise

  /* 花瓣展开态单独采样：6 片 backdrop-filter 玻璃是新一轮最重的合成场景 */
  await page.locator('.rc-entry').nth(3).click()
  await page.waitForTimeout(700)
  const fanRaf = await sample()
  await page.waitForTimeout(120)

  rows.push({ viewport: `${width}×${height}`, idle: rAF, fan: fanRaf })
  await context.close()
  await browser.close()
}

fs.writeFileSync(path.join(OUT, 'perf-matrix.json'), JSON.stringify(rows, null, 2), 'utf8')
console.log(JSON.stringify(rows, null, 2))
