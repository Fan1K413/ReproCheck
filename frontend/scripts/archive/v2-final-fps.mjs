/* v2 FPS 抽样：用 rAF 计数衡量动画期间帧率（headless 参考值，非真机 GPU 数据） */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const PID = 'proj-209c77cd39f94212'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function sample(page, label, trigger) {
  await page.evaluate(() => { window.__fpsFrames = 0; let last = performance.now(); const tick = (t) => { window.__fpsFrames++; requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  if (trigger) await trigger()
  const t0 = Date.now()
  await sleep(2000)
  const frames = await page.evaluate(() => window.__fpsFrames)
  const secs = (Date.now() - t0) / 1000
  return { label, frames, seconds: +secs.toFixed(2), fps: +(frames / secs).toFixed(1) }
}

const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'], defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage()
async function goto(route, wait = 1600) { await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 }); await sleep(wait) }
async function clickText(t) { const h = await page.evaluateHandle((x) => [...document.querySelectorAll('button,a,[role="tab"]')].find((e) => e.textContent.includes(x)) || null, t); const el = h.asElement(); if (el) await el.click(); await sleep(600) }

await goto('/login', 1200); await clickText('林晚晴'); await clickText('登录工作台'); await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 }); await sleep(1200)

const results = []
await goto('/', 1700)
results.push(await sample(page, '工作台 canvas 待机动画'))
await goto(`/projects/${PID}/workbench`, 2200)
results.push(await sample(page, 'Bloom 瓣卡展开动画', async () => { await page.evaluate(() => document.querySelector('.bloom-card .bloom-compact')?.click()) }))
await goto(`/projects/${PID}/workbench?view=loom`, 2300)
results.push(await sample(page, 'EvidenceLoom 织机动画'))
await goto(`/projects/${PID}/reproduction/comparison`, 1700)
results.push(await sample(page, '结果对照透视卡动画', async () => { await page.evaluate(() => document.querySelectorAll('.rc-wa-pick')[1]?.click()) }))

await browser.close()
const out = { note: 'headless Edge 禁用 GPU 的 rAF 参考帧率，仅用于相对比较；真机 GPU 帧率需人工复测。', samples: results }
fs.writeFileSync(path.join(OUT, 'v2-final-fps.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
