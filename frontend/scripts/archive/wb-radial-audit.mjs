/*
 * 一级主工作台 · 圆形布局与交互审计
 *
 * 用法：node scripts/wb-radial-audit.mjs --phase before|after
 *
 * 覆盖：
 *   - 5 档分辨率截图（1920×1080 / 1600×900 / 1440×900 / 1366×768 / 390×844）
 *   - 圆盘是否为正圆、图标是否等距等角、是否越界、核心文字是否溢出
 *   - 图标视觉尺寸是否一致
 *   - 点击 → 卡组 → 真实路由；中心拖动 → 命中方位对应入口
 *   - 帧率采样（真实浏览器 rAF）
 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const PHASE = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1]
  : 'before'
const OUT = path.resolve('../.screenshots/workbench-radial', PHASE)
fs.mkdirSync(OUT, { recursive: true })

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1600x900', width: 1600, height: 900 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
]

const DEMO_USER = {
  id: 'u-demo-radial',
  email: 'lead@reprocheck.demo',
  display_name: '林晚晴',
  is_platform_admin: false,
  created_at: '2026-01-01T00:00:00Z',
  last_login_at: null,
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function openPage(browser, viewport, reducedMotion = false) {
  const context = await browser.newContext({ viewport, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 200)))
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  await page.addInitScript((user) => {
    localStorage.setItem('rc_token', 'demo-token-radial')
    localStorage.setItem('rc_user', JSON.stringify(user))
  }, DEMO_USER)
  await page.route('**/api/v1/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: DEMO_USER, organizations: [] }),
    }),
  )
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(1500)
  return { page, context, errors }
}

async function geometry(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('.rc-disc-shell')
    const core = document.querySelector('.rc-core')
    const shellRect = shell.getBoundingClientRect()
    const coreRect = core.getBoundingClientRect()
    const cx = shellRect.x + shellRect.width / 2
    const cy = shellRect.y + shellRect.height / 2

    const entries = [...document.querySelectorAll('.rc-entry')].map((el, index) => {
      const r = el.getBoundingClientRect()
      const bead = el.querySelector('.rc-entry__bead')?.getBoundingClientRect()
      const icon = el.querySelector('.rc-glyph svg')?.getBoundingClientRect()
      const ecx = r.x + r.width / 2
      const ecy = r.y + r.height / 2
      const rawAngle = (((Math.atan2(ecx - cx, -(ecy - cy)) * 180) / Math.PI + 360) % 360)
      const angle = rawAngle > 359.995 ? 0 : rawAngle
      return {
        index,
        name: el.querySelector('.rc-tooltip')?.childNodes[0]?.textContent?.trim(),
        hot: { w: +r.width.toFixed(2), h: +r.height.toFixed(2), x: +r.x.toFixed(1), y: +r.y.toFixed(1) },
        bead: bead ? { w: +bead.width.toFixed(2), h: +bead.height.toFixed(2) } : null,
        icon: icon ? { w: +icon.width.toFixed(2), h: +icon.height.toFixed(2) } : null,
        distance: +Math.hypot(ecx - cx, ecy - cy).toFixed(2),
        angle: +angle.toFixed(2),
        overflow: {
          left: r.left < 0,
          right: r.right > window.innerWidth,
          top: r.top < 0,
          bottom: r.bottom > window.innerHeight,
        },
      }
    })

    const textOverflow = [...document.querySelectorAll('.rc-core *')]
      .filter((el) => el.children.length === 0 && el.textContent.trim())
      .map((el) => ({
        text: el.textContent.trim().slice(0, 24),
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      }))
      .filter((t) => t.scrollW > t.clientW + 1)

    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      disc: {
        x: +shellRect.x.toFixed(1),
        y: +shellRect.y.toFixed(1),
        w: +shellRect.width.toFixed(2),
        h: +shellRect.height.toFixed(2),
        roundnessDelta: +Math.abs(shellRect.width - shellRect.height).toFixed(2),
        centerOffset: {
          x: +(cx - window.innerWidth / 2).toFixed(2),
          y: +(cy - window.innerHeight / 2).toFixed(2),
        },
      },
      core: {
        w: +coreRect.width.toFixed(1),
        h: +coreRect.height.toFixed(1),
        roundnessDelta: +Math.abs(coreRect.width - coreRect.height).toFixed(2),
      },
      entries,
      distanceSpread: +(Math.max(...entries.map((e) => e.distance)) - Math.min(...entries.map((e) => e.distance))).toFixed(2),
      textOverflow,
    }
  })
}

async function sampleFps(page, seconds = 2) {
  return page.evaluate(
    (seconds) =>
      new Promise((resolve) => {
        let frames = 0
        const t0 = performance.now()
        let last = t0
        const deltas = []
        const tick = (now) => {
          frames += 1
          deltas.push(now - last)
          last = now
          if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(tick)
          else {
            const sorted = [...deltas].sort((a, b) => a - b)
            resolve({
              fps: +(frames / ((performance.now() - t0) / 1000)).toFixed(1),
              avgFrameMs: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(2),
              p95FrameMs: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
              longFrames: deltas.filter((d) => d > 20).length,
            })
          }
        }
        requestAnimationFrame(tick)
      }),
    seconds,
  )
}

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-sandbox', '--hide-scrollbars'],
})

const report = { phase: PHASE, layouts: [], interaction: {}, reducedMotion: {}, errors: [] }

for (const vp of VIEWPORTS) {
  const { page, context, errors } = await openPage(browser, { width: vp.width, height: vp.height })
  await page.screenshot({ path: path.join(OUT, `${vp.name}.png`) })
  const geo = await geometry(page)
  const fps = await sampleFps(page, 2)
  report.layouts.push({ viewport: vp.name, ...geo, fps })
  report.errors.push(...errors.map((e) => `${vp.name}: ${e}`))
  await context.close()
}

/* ---------- 交互：点击每个入口 → 卡组 → 真实路由 ---------- */
{
  const { page, context, errors } = await openPage(browser, { width: 1440, height: 900 })
  const entries = await page.evaluate(() =>
    [...document.querySelectorAll('.rc-entry')].map((el) => el.querySelector('.rc-tooltip')?.textContent?.trim()),
  )

  const clickResults = []
  for (let i = 0; i < entries.length; i += 1) {
    await page.locator('.rc-entry').nth(i).click()
    await sleep(350)
    const fan = await page.evaluate(() => {
      const section = document.querySelector('.rc-fan')
      if (!section) return null
      return {
        title: section.querySelector('.rc-fan-title span:nth-child(2)')?.textContent?.trim(),
        count: section.querySelectorAll('.rc-fan-card').length,
        labels: [...section.querySelectorAll('.rc-fan-card__label')].map((el) => el.textContent.trim()),
      }
    })
    clickResults.push({ index: i, entry: entries[i], fan })
    await page.keyboard.press('Escape')
    await sleep(250)
  }

  /* 每个入口的第一张卡都点进去，校验真实路由 */
  const routeResults = []
  for (let i = 0; i < entries.length; i += 1) {
    await page.locator('.rc-entry').nth(i).click()
    await sleep(320)
    const before = page.url()
    await page.locator('.rc-fan-card').first().click()
    await sleep(700)
    routeResults.push({
      index: i,
      entry: entries[i],
      from: '/',
      to: new URL(page.url()).pathname,
      changed: page.url() !== before,
    })
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
    await sleep(900)
  }

  /* 中心拖动 → 命中方位对应入口 */
  const dragResults = []
  for (const targetIndex of [0, 2, 4, 6, 8]) {
    const box = await page.locator('.rc-disc-shell').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const R = box.width / 2
    const angle = (targetIndex * 360) / entries.length
    const rad = (angle * Math.PI) / 180
    const tx = cx + Math.sin(rad) * R * 0.62
    const ty = cy - Math.cos(rad) * R * 0.62
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx + Math.sin(rad) * 12, cy - Math.cos(rad) * 12, { steps: 3 })
    await page.mouse.move(tx, ty, { steps: 12 })
    await sleep(120)
    const activeDuringDrag = await page.evaluate(
      () => document.querySelector('.rc-entry[data-active="true"] .rc-tooltip')?.textContent?.trim() ?? null,
    )
    await page.mouse.up()
    await sleep(400)
    const fanTitle = await page.evaluate(
      () => document.querySelector('.rc-fan-title span:nth-child(2)')?.textContent?.trim() ?? null,
    )
    dragResults.push({ targetIndex, expected: entries[targetIndex], activeDuringDrag, fanTitle })
    await page.keyboard.press('Escape')
    await sleep(300)
  }

  /* 悬停帧率：鼠标沿轨道移动一圈 */
  const hoverFps = await (async () => {
    const box = await page.locator('.rc-disc-shell').boundingBox()
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const R = box.width / 2
    const start = Date.now()
    let i = 0
    const framesPromise = sampleFps(page, 2.5)
    while (Date.now() - start < 2000) {
      const a = (i / 180) * Math.PI
      await page.mouse.move(cx + Math.sin(a) * R * 0.66, cy - Math.cos(a) * R * 0.66)
      i += 1
      await sleep(12)
    }
    return framesPromise
  })()

  report.interaction = { clickResults, routeResults, dragResults, hoverFps }
  report.errors.push(...errors.map((e) => `interaction: ${e}`))
  await page.screenshot({ path: path.join(OUT, 'interaction-fan.png') })
  await context.close()
}

/* ---------- prefers-reduced-motion ---------- */
{
  const { page, context } = await openPage(browser, { width: 1440, height: 900 }, true)
  await page.screenshot({ path: path.join(OUT, 'reduced-motion.png') })
  report.reducedMotion = await geometry(page)
  await context.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 2), 'utf8')

const summary = {
  phase: report.phase,
  layouts: report.layouts.map((l) => ({
    viewport: l.viewport,
    disc: `${l.disc.w}×${l.disc.h} Δ${l.disc.roundnessDelta}`,
    centerOffset: l.disc.centerOffset,
    distanceSpread: l.distanceSpread,
    angles: l.entries.map((e) => e.angle),
    distances: l.entries.map((e) => e.distance),
    textOverflow: l.textOverflow.length,
    overflow: l.entries.some((e) => Object.values(e.overflow).some(Boolean)),
    fps: l.fps,
  })),
  click: report.interaction.clickResults?.map((c) => `${c.entry}=${c.fan?.title}#${c.fan?.count}`),
  routes: report.interaction.routeResults?.map((r) => `${r.entry} → ${r.to}`),
  drag: report.interaction.dragResults?.map((d) => `${d.expected}: active=${d.activeDuringDrag} fan=${d.fanTitle}`),
  hoverFps: report.interaction.hoverFps,
  errors: report.errors,
}
console.log(JSON.stringify(summary, null, 2))
