/*
 * 一级工作台背景改造 · 真实浏览器采集脚本
 *
 * 用法：
 *   node scripts/bg-redesign-capture.mjs --phase before
 *   node scripts/bg-redesign-capture.mjs --phase after
 *
 * 采集内容：
 *   - 桌面 1440×900：静态帧 / 动态帧（间隔 700ms）/ 帧率与帧时间采样
 *   - 移动 390×844：完整工作台帧
 *   - 运行时诊断：canvas 数量与尺寸、上下文类型、背景 computed 样式、控制台错误
 *
 * 说明：headless 下 GPU 多为软件渲染，帧率仅用于前后相对比较，真机 GPU 数据需人工复测。
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const PHASE = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1]
  : 'before'

const OUT = path.resolve('../.screenshots/bg-redesign', PHASE)
fs.mkdirSync(OUT, { recursive: true })

const DEMO_USER = {
  id: 'u-demo-bg',
  email: 'lead@reprocheck.demo',
  display_name: '林晚晴',
  is_platform_admin: false,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function sampleFps(page, seconds = 2) {
  return page.evaluate(
    ({ seconds }) =>
      new Promise((resolve) => {
        let frames = 0
        const deltas = []
        const t0 = performance.now()
        let last = t0
        const tick = (now) => {
          frames += 1
          deltas.push(now - last)
          last = now
          if (performance.now() - t0 < seconds * 1000) {
            requestAnimationFrame(tick)
          } else {
            const sorted = [...deltas].sort((a, b) => a - b)
            resolve({
              fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
              avgFrameMs: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
              maxFrameMs: +Math.max(...deltas).toFixed(2),
              p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
              frames,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    { seconds },
  )
}

async function collectDiagnostics(page) {
  return page.evaluate(() => {
    const stage = document.querySelector('.rc-stage')
    const canvases = [...document.querySelectorAll('canvas')].map((c) => ({
      className: c.className,
      width: c.width,
      height: c.height,
      cssWidth: c.clientWidth,
      cssHeight: c.clientHeight,
      hasWebGL: !!c.getContext('webgl') || !!c.getContext('webgl2'),
    }))
    const stageStyle = stage ? getComputedStyle(stage) : null
    return {
      route: location.pathname,
      entries: document.querySelectorAll('.rc-entry').length,
      canvases,
      stageBackground: stageStyle ? stageStyle.backgroundImage.slice(0, 240) : null,
      stageBackgroundColor: stageStyle ? stageStyle.backgroundColor : null,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  })
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--disable-window-size-warnings'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()

const consoleErrors = []
const pageErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

// 注入本地会话；/auth/me 用演示数据应答，避免真实后端 401 清掉会话。
await page.addInitScript((user) => {
  localStorage.setItem('rc_token', 'demo-token-bg')
  localStorage.setItem('rc_user', JSON.stringify(user))
}, DEMO_USER)

await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ user: DEMO_USER, organizations: [] }),
  }),
)

const report = { phase: PHASE, base: BASE, samples: [], consoleErrors, pageErrors }

/* ---------- 桌面 ---------- */
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(1600)
await page.screenshot({ path: path.join(OUT, '01-desktop-static.png') })
await sleep(700)
await page.screenshot({ path: path.join(OUT, '02-desktop-dynamic.png') })

const desktopFps = await sampleFps(page, 2)
const diagnostics = await collectDiagnostics(page)
report.samples.push({ viewport: '1440x900', fps: desktopFps, diagnostics })

/* ---------- 移动 ---------- */
await page.setViewportSize({ width: 390, height: 844 })
await sleep(1200)
await page.screenshot({ path: path.join(OUT, '03-mobile-390x844.png') })
const mobileFps = await sampleFps(page, 2)
report.samples.push({ viewport: '390x844', fps: mobileFps })

await browser.close()

fs.writeFileSync(path.join(OUT, 'metrics.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
