/* 第九阶段：真实 Chromium 帧间隔、Long Tasks、加载、响应与内存专项。 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.resolve(process.env.PERF_OUT || path.join(ROOT, '.screenshots', 'stage9', 'performance'))
const HEADLESS = process.env.HEADFUL !== '1'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const PID = 'proj-209c77cd39f94212'
const PLAN = 'plan-b4bbf8748a2d41'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: HEADLESS, args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--expose-gc'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
const report = { meta: { startedAt: new Date().toISOString(), base: BASE, viewport: '1440x900', headless: HEADLESS, note: HEADLESS ? '本机原生 Chromium headless 测量；不是远程 Browser Use，也不宣称等同真机 GPU。开发服务器导航数据包含 Vite 模块请求。' : '本机原生 Chromium headful 测量，使用当前机器实际窗口与图形后端；开发服务器导航数据包含 Vite 模块请求。' }, loading: [], interactions: [], animations: [], memory: [], reducedMotion: null, runtimeErrors: [] }
page.on('pageerror', (error) => report.runtimeErrors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') report.runtimeErrors.push(message.text()) })

async function goto(route, wait = 650) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(wait)
}
async function perfMetrics() {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((item) => [item.name, item.value]))
}
const percentile = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : 0
const round = (value, digits = 2) => Number((value ?? 0).toFixed(digits))

async function measureLoading(slug, route) {
  const started = Date.now()
  await goto(route, 500)
  const data = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const resources = performance.getEntriesByType('resource')
    return {
      url: location.pathname + location.search,
      responseEnd: nav?.responseEnd ?? 0,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? 0,
      loadEvent: nav?.loadEventEnd ?? 0,
      duration: nav?.duration ?? 0,
      resourceCount: resources.length,
      transferBytes: resources.reduce((sum, item) => sum + (item.transferSize || 0), 0),
      decodedBytes: resources.reduce((sum, item) => sum + (item.decodedBodySize || 0), 0),
      jsHeap: performance.memory?.usedJSHeapSize ?? null,
    }
  })
  report.loading.push({ slug, wallMs: Date.now() - started, ...Object.fromEntries(Object.entries(data).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])) })
}

async function measureInteraction(name, action, ready) {
  const start = await page.evaluate(() => performance.now())
  await action()
  await ready()
  const end = await page.evaluate(() => performance.now())
  report.interactions.push({ name, durationMs: round(end - start), url: page.url() })
}

async function sampleAnimation(name, trigger, durationMs = 3200) {
  await page.waitForTimeout(500)
  const before = await perfMetrics()
  await page.evaluate(() => {
    const state = { intervals: [], longTasks: [], raf: 0, last: 0, observer: null, running: true }
    window.__stage9Perf = state
    const tick = (time) => {
      if (!state.running) return
      if (state.last) state.intervals.push(time - state.last)
      state.last = time
      state.raf = requestAnimationFrame(tick)
    }
    state.raf = requestAnimationFrame(tick)
    try {
      state.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.longTasks.push({ start: entry.startTime, duration: entry.duration })
      })
      state.observer.observe({ type: 'longtask', buffered: false })
    } catch { state.observer = null }
  })
  if (trigger) await trigger()
  await page.waitForTimeout(durationMs)
  const raw = await page.evaluate(() => {
    const state = window.__stage9Perf
    state.running = false
    cancelAnimationFrame(state.raf)
    state.observer?.disconnect()
    return { intervals: state.intervals, longTasks: state.longTasks }
  })
  const after = await perfMetrics()
  const sorted = [...raw.intervals].sort((a, b) => a - b)
  const total = raw.intervals.reduce((sum, value) => sum + value, 0)
  const mean = total / Math.max(1, raw.intervals.length)
  report.animations.push({
    name,
    sampleDurationMs: round(total),
    frames: raw.intervals.length,
    fps: round(raw.intervals.length / (total / 1000), 1),
    meanFrameMs: round(mean),
    medianFrameMs: round(percentile(sorted, 0.5)),
    p95FrameMs: round(percentile(sorted, 0.95)),
    maxFrameMs: round(sorted.at(-1) ?? 0),
    framesOver25ms: raw.intervals.filter((value) => value > 25).length,
    framesOver50ms: raw.intervals.filter((value) => value > 50).length,
    longTaskCount: raw.longTasks.length,
    longTaskTotalMs: round(raw.longTasks.reduce((sum, item) => sum + item.duration, 0)),
    longestTaskMs: round(Math.max(0, ...raw.longTasks.map((item) => item.duration))),
    taskDurationDeltaMs: round(((after.TaskDuration ?? 0) - (before.TaskDuration ?? 0)) * 1000),
    scriptDurationDeltaMs: round(((after.ScriptDuration ?? 0) - (before.ScriptDuration ?? 0)) * 1000),
    layoutDurationDeltaMs: round(((after.LayoutDuration ?? 0) - (before.LayoutDuration ?? 0)) * 1000),
    recalcStyleDurationDeltaMs: round(((after.RecalcStyleDuration ?? 0) - (before.RecalcStyleDuration ?? 0)) * 1000),
    layoutCountDelta: (after.LayoutCount ?? 0) - (before.LayoutCount ?? 0),
  })
}

async function memoryPoint(label) {
  await cdp.send('HeapProfiler.collectGarbage')
  await page.waitForTimeout(120)
  const [dom, metrics] = await Promise.all([cdp.send('Memory.getDOMCounters'), perfMetrics()])
  report.memory.push({ label, url: page.url(), documents: dom.documents, nodes: dom.nodes, jsEventListeners: dom.jsEventListeners, jsHeapUsedBytes: metrics.JSHeapUsedSize ?? null, jsHeapTotalBytes: metrics.JSHeapTotalSize ?? null })
}
async function navViaDrawer(label) {
  await page.getByRole('button', { name: '打开功能目录' }).click()
  const drawer = page.getByRole('dialog', { name: '功能目录' })
  await drawer.getByRole('link', { name: label, exact: true }).click()
  await page.waitForTimeout(650)
}

try {
  await goto('/login', 300)
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`)
  report.meta.gpu = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl')
    if (!gl) return { webgl: false }
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      webgl: true,
      vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
      renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    }
  })

  await measureLoading('root', '/')
  await measureLoading('projects', '/projects')
  await measureLoading('materials', `/projects/${PID}/materials`)
  await measureLoading('evidence-graph', `/projects/${PID}/evidence-graph`)
  await measureLoading('reproduction-plan', `/reproductions/plans/${PLAN}`)
  await measureLoading('stats-audit', '/stats-audit')

  await goto('/')
  await sampleAnimation('根工作台环境漂移')
  await measureInteraction('根入口到功能卡组可见', () => page.getByRole('menuitem', { name: /项目档案/ }).click(), () => page.getByRole('dialog', { name: /项目档案/ }).waitFor({ state: 'visible' }))
  await sampleAnimation('功能卡组展开与待机动画')
  await measureInteraction('Esc 关闭功能卡组', () => page.keyboard.press('Escape'), () => page.getByRole('dialog', { name: /项目档案/ }).waitFor({ state: 'detached' }))

  for (let round = 1; round <= 3; round += 1) {
    await goto(`/projects/${PID}/workbench`, 1000)
    await sampleAnimation(`Bloom 瓣卡展开 round-${round}`, async () => { await page.locator('.bloom-card .bloom-compact').first().click() })
  }
  await goto(`/projects/${PID}/workbench?view=loom`)
  await sampleAnimation('EvidenceLoom 织机环境动画')
  await goto(`/projects/${PID}/reproduction/comparison`)
  await sampleAnimation('结果对照透视切换', async () => { const picks = page.locator('.rc-wa-pick'); if (await picks.count() > 1) await picks.nth(1).click() })

  await goto('/projects')
  await measureInteraction('目录抽屉打开', () => page.getByRole('button', { name: '打开功能目录' }).click(), () => page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'visible' }))
  await measureInteraction('目录抽屉 Esc 关闭', () => page.keyboard.press('Escape'), () => page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'detached' }))
  await goto(`/projects/${PID}/reproduction`)
  await measureInteraction('规划与运行透视 tab 切换', () => page.getByRole('tab', { name: /运行/ }).click(), async () => { await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.includes('运行')) })

  await page.setViewportSize({ width: 390, height: 844 })
  await goto('/')
  await page.getByRole('menuitem', { name: /项目档案/ }).click()
  await page.getByRole('dialog', { name: /项目档案/ }).waitFor({ state: 'visible' })
  await sampleAnimation('390px 移动功能卡组')
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await goto('/')
  report.reducedMotion = await page.evaluate(() => ({
    matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
    canvasAnimation: getComputedStyle(document.querySelector('.rc-foldfield')).animationName,
    canvasClass: document.querySelector('.rc-foldfield').className,
    discAnimation: getComputedStyle(document.querySelector('.rc-disc-shell')).animationName,
  }))
  await page.emulateMedia({ reducedMotion: 'no-preference' })

  await goto(`/projects/${PID}/reproduction`)
  await memoryPoint('cycle-0-start')
  for (let cycle = 1; cycle <= 2; cycle += 1) {
    for (const label of ['项目', '材料管理', '科研事实', '解析概览', '总览', '环境', '结果对照', '报告中心']) {
      await navViaDrawer(label)
      await memoryPoint(`cycle-${cycle}-${label}`)
    }
  }
} catch (error) {
  report.fatal = String(error)
  console.error(error)
} finally {
  fs.writeFileSync(path.join(OUT, 'performance-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(JSON.stringify({ loading: report.loading.length, interactions: report.interactions, animations: report.animations, memoryPoints: report.memory.length, reducedMotion: report.reducedMotion, fatal: report.fatal || null }, null, 2))
  console.log(`REPORT ${path.join(OUT, 'performance-report.json')}`)
}
