/* Bloom 瓣卡展开 FPS 复核脚本（任务 2）
 * 口径与 v2-final-fps.mjs 一致：headless Edge + --disable-gpu 的 rAF 参考帧率，
 * 只用于"同一环境下改前/改后相对比较"，不等同真机 GPU 帧率。
 * 输出：.screenshots/final-bloom-fps-<tag>.json
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const TAG = process.argv[2] || 'run'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function startFrames(page) {
  await page.evaluate(() => {
    window.__fpsFrames = 0
    if (window.__fpsStop) window.__fpsStop()
    const tick = () => {
      window.__fpsFrames++
      window.__fpsRaf = requestAnimationFrame(tick)
    }
    window.__fpsRaf = requestAnimationFrame(tick)
  })
}
async function stopFrames(page) {
  const frames = await page.evaluate(() => {
    if (window.__fpsRaf) cancelAnimationFrame(window.__fpsRaf)
    return window.__fpsFrames
  })
  return frames
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

async function goto(route, wait = 1600) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(wait)
}
async function clickText(t) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button,a,[role="tab"]')].find((e) => e.textContent.includes(x)) || null,
    t,
  )
  const el = h.asElement()
  if (el) await el.click()
  await sleep(600)
}

await goto('/login', 1200)
await clickText('林晚晴')
await clickText('登录工作台')
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1200)

await goto(`/projects/${PID}/workbench`, 2400)

const samples = []

// 1) 待机基线
const domBefore = await page.evaluate(() => document.querySelectorAll('.bloom-stage *').length)
await startFrames(page)
const t0 = Date.now()
await sleep(2000)
samples.push({ label: 'Bloom 舞台待机', frames: await stopFrames(page), seconds: +((Date.now() - t0) / 1000).toFixed(2) })

// 2) 展开动画（点击第一张瓣卡，采样 2s 覆盖动画窗口）
await startFrames(page)
const t1 = Date.now()
await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click())
await sleep(2000)
const openFrames = await stopFrames(page)
const openSeconds = +((Date.now() - t1) / 1000).toFixed(2)
samples.push({ label: 'Bloom 瓣卡展开动画', frames: openFrames, seconds: openSeconds })

// 3) 展开稳定后（详情树已挂载，无动画）
await sleep(800)
const domAfter = await page.evaluate(() => document.querySelectorAll('.bloom-stage *').length)
await startFrames(page)
const t2 = Date.now()
await sleep(2000)
samples.push({ label: 'Bloom 展开后静止（详情已挂载）', frames: await stopFrames(page), seconds: +((Date.now() - t2) / 1000).toFixed(2) })

const detailNodeCount = await page.evaluate(
 () => document.querySelectorAll('.bloom-card.is-open .bloom-detail *').length,
)

const out = {
  note: 'headless Edge 禁用 GPU 的 rAF 参考帧率，仅用于相对比较；真机 GPU 帧率需人工复测。',
  tag: TAG,
  dom: { stageNodesBeforeOpen: domBefore, stageNodesAfterOpen: domAfter, openDetailNodes: detailNodeCount },
  samples: samples.map((s) => ({ ...s, fps: +(s.frames / s.seconds).toFixed(1) })),
}
fs.writeFileSync(path.join(OUT, `final-bloom-fps-${TAG}.json`), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
await browser.close()
