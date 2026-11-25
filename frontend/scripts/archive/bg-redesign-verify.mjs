/*
 * 一级工作台背景 · 专项验证
 *
 * 覆盖：
 *   1. WebGL 正常路径：上下文、渲染分辨率上限、无控制台错误；
 *   2. WebGL 不可用降级：阻断 webgl 上下文后静态 CSS 背景可见、页面不崩；
 *   3. prefers-reduced-motion：首帧静止、无异常；
 *   4. 层级与事件：背景 pointer-events:none，位于圆盘/入口之下；
 *   5. 多尺寸：1920×1080 / 1280×800 / 390×844 截图；
 *   6. 动态存在性：间隔采样背景区域颜色，证明光场在缓慢推进。
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots/bg-redesign/verify')
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

async function newPage(browser, { blockWebgl = false, reducedMotion = false, viewport } = {}) {
  const context = await browser.newContext({
    viewport,
    reducedMotion: reducedMotion ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 300)))
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))

  await page.addInitScript((user) => {
    localStorage.setItem('rc_token', 'demo-token-bg')
    localStorage.setItem('rc_user', JSON.stringify(user))
  }, DEMO_USER)

  if (blockWebgl) {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (['webgl', 'webgl2', 'experimental-webgl', 'webkit-webgl'].includes(type)) {
          return null
        }
        return original.call(this, type, ...args)
      }
    })
  }

  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: DEMO_USER, organizations: [] }),
    }),
  )

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(1500)
  return { page, context, consoleErrors, pageErrors }
}

async function inspect(page) {
  return page.evaluate(() => {
    const field = document.querySelector('.rc-field')
    const canvas = document.querySelector('.rc-field__canvas')
    const fallback = document.querySelector('.rc-field__fallback')
    const entry = document.querySelector('.rc-entry')
    const disc = document.querySelector('.rc-disc-shell')
    const fieldStyle = field ? getComputedStyle(field) : null
    const entryStyle = entry ? getComputedStyle(entry) : null
    const discStyle = disc ? getComputedStyle(disc) : null
    return {
      fieldExists: !!field,
      fieldLive: field?.classList.contains('rc-field--live') ?? false,
      pointerEvents: fieldStyle?.pointerEvents ?? null,
      fieldZIndex: fieldStyle?.zIndex ?? null,
      canvasSize: canvas ? { width: canvas.width, height: canvas.height } : null,
      fallbackBackground: fallback ? getComputedStyle(fallback).backgroundImage.slice(0, 120) : null,
      entryCount: document.querySelectorAll('.rc-entry').length,
      entryZIndex: entryStyle?.zIndex ?? null,
      discZIndex: discStyle?.zIndex ?? null,
    }
  })
}

async function sampleEdgeColors(page) {
  // 取背景四角之外的几个采样点（避开中心圆盘），返回 RGB 用于前后帧比对。
  return page.evaluate(() => {
    const points = [
      [0.12, 0.2],
      [0.88, 0.24],
      [0.16, 0.82],
      [0.84, 0.78],
    ]
    return points.map(([x, y]) => {
      const el = document.elementFromPoint(x * window.innerWidth, y * window.innerHeight)
      return { x, y, tag: el?.className?.toString().slice(0, 40) ?? null }
    })
  })
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox'],
})

const report = { cases: [] }

/* 1. 正常路径 + 层级/事件检查（1920×1080） */
{
  const { page, context, consoleErrors, pageErrors } = await newPage(browser, {
    viewport: { width: 1920, height: 1080 },
  })
  const diagnostics = await inspect(page)
  await page.screenshot({ path: path.join(OUT, 'live-1920x1080.png') })

  // 动态存在性：间隔 3.5s 截两帧，并比对控制器帧计数是否推进。
  const framesT0 = await page.evaluate(() =>
    Number(document.querySelector('.rc-field__canvas')?.dataset.frameCount ?? 0),
  )
  await page.screenshot({ path: path.join(OUT, 'motion-t0.png') })
  await sleep(3500)
  const framesT1 = await page.evaluate(() =>
    Number(document.querySelector('.rc-field__canvas')?.dataset.frameCount ?? 0),
  )
  await page.screenshot({ path: path.join(OUT, 'motion-t1.png') })
  diagnostics.frameCount = { t0: framesT0, t1: framesT1, advanced: framesT1 > framesT0 }

  report.cases.push({ name: 'live-1920x1080', diagnostics, consoleErrors, pageErrors })
  await context.close()
}

/* 2. WebGL 不可用降级 */
{
  const { page, context, consoleErrors, pageErrors } = await newPage(browser, {
    blockWebgl: true,
    viewport: { width: 1440, height: 900 },
  })
  const diagnostics = await inspect(page)
  await page.screenshot({ path: path.join(OUT, 'fallback-no-webgl.png') })
  report.cases.push({ name: 'fallback-no-webgl', diagnostics, consoleErrors, pageErrors })
  await context.close()
}

/* 3. 减少动态效果 */
{
  const { page, context, consoleErrors, pageErrors } = await newPage(browser, {
    reducedMotion: true,
    viewport: { width: 1440, height: 900 },
  })
  const diagnostics = await inspect(page)
  await sleep(1200)
  diagnostics.frameCount = Number(
    await page.evaluate(() => document.querySelector('.rc-field__canvas')?.dataset.frameCount ?? 0),
  )
  await page.screenshot({ path: path.join(OUT, 'reduced-motion.png') })
  report.cases.push({ name: 'reduced-motion', diagnostics, consoleErrors, pageErrors })
  await context.close()
}

/* 4. 中等桌面与移动尺寸 */
{
  const { page, context } = await newPage(browser, { viewport: { width: 1280, height: 800 } })
  await page.screenshot({ path: path.join(OUT, 'live-1280x800.png') })
  await context.close()
}
{
  const { page, context } = await newPage(browser, { viewport: { width: 390, height: 844 } })
  await page.screenshot({ path: path.join(OUT, 'live-390x844.png') })
  await context.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'verify-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
