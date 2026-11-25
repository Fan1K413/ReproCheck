/* V3 性能验收：真实 rAF 采样（headless Edge 禁用 GPU）
 * 注意：该结果用于同一环境下的相对回归判断，不等同于真机 GPU 帧率。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = process.env.VERIFY_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8000'
const OUT = path.resolve(process.env.VERIFY_OUT || '../.screenshots')
const PID = process.env.VERIFY_PID || 'proj-209c77cd39f94212'
const RUN = process.env.VERIFY_RUN || 'run-5acdb8cd27d946'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (error) => console.error('PAGEERROR', error.message))

async function login() {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
  })
  const payload = await response.json()
  if (!response.ok || !payload?.data?.token) throw new Error(payload?.error?.message || `HTTP ${response.status}`)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate((data) => {
    localStorage.setItem('rc_token', data.token)
    localStorage.setItem('rc_user', JSON.stringify(data.user))
  }, payload.data)
}
async function goto(route, wait = 1500) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(wait)
}
async function sample(label, seconds = 2) {
  await page.evaluate(() => {
    window.__fpsFrames = 0
    if (window.__fpsRaf) cancelAnimationFrame(window.__fpsRaf)
    const tick = () => {
      window.__fpsFrames += 1
      window.__fpsRaf = requestAnimationFrame(tick)
    }
    window.__fpsRaf = requestAnimationFrame(tick)
  })
  const started = Date.now()
  await sleep(seconds * 1000)
  const result = await page.evaluate(() => {
    if (window.__fpsRaf) cancelAnimationFrame(window.__fpsRaf)
    return {
      frames: window.__fpsFrames,
      domNodes: document.querySelectorAll('*').length,
      memory: performance.memory ? {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
      } : null,
    }
  })
  const elapsed = (Date.now() - started) / 1000
  return { label, seconds: +elapsed.toFixed(2), ...result, fps: +(result.frames / elapsed).toFixed(1) }
}

await login()
const samples = []
const routes = [
  ['主工作台 /', '/'],
  ['项目档案 /projects', '/projects'],
  ['材料管理', `/projects/${PID}/materials`],
  ['执行控制台', `/reproductions/runs/${RUN}`],
  ['Bloom 项目舞台', `/projects/${PID}/workbench`],
  ['Bloom 工坊', `/projects/${PID}/workbench?view=atelier`],
  ['证据织机', `/projects/${PID}/workbench?view=loom`],
]
for (const [label, route] of routes) {
  await goto(route, route.includes('workbench') ? 2200 : 1500)
  samples.push(await sample(`${label} · 待机`))
}

/* Bloom 瓣卡展开动画单独采样，覆盖动画窗口。 */
await goto(`/projects/${PID}/workbench`, 2400)
const expandStart = Date.now()
await page.evaluate(() => {
  window.__fpsFrames = 0
  if (window.__fpsRaf) cancelAnimationFrame(window.__fpsRaf)
  const tick = () => {
    window.__fpsFrames += 1
    window.__fpsRaf = requestAnimationFrame(tick)
  }
  window.__fpsRaf = requestAnimationFrame(tick)
  document.querySelector('.bloom-card .bloom-compact')?.click()
})
await sleep(2200)
const expand = await page.evaluate(() => {
  if (window.__fpsRaf) cancelAnimationFrame(window.__fpsRaf)
  return { frames: window.__fpsFrames, domNodes: document.querySelectorAll('*').length }
})
samples.push({ label: 'Bloom 瓣卡展开动画', seconds:+((Date.now()-expandStart)/1000).toFixed(2), ...expand, fps:+(expand.frames/((Date.now()-expandStart)/1000)).toFixed(1) })
await sleep(800)
samples.push(await sample('Bloom 展开后静止'))

const report = {
  note: 'headless Edge + --disable-gpu 的 rAF 参考帧率；仅用于同环境相对回归，真机 GPU 帧率需人工复测。',
  sampledAt: new Date().toISOString(),
  samples,
}
fs.writeFileSync(path.join(OUT, 'v3-performance-report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log(JSON.stringify(report, null, 2))
await browser.close()
