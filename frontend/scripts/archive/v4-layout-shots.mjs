// 章节验收截图：L1 工作台 / L2 项目档案 / L3 单项目页，宽屏 + 窄屏（Playwright + Edge）
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const PID = 'proj-209c77cd39f94212'
const OUT = path.resolve('../.screenshots')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1200)
const clickText = async (text) => {
  const loc = page.getByText(text, { exact: true }).last()
  if (await loc.count()) await loc.click({ force: true })
}
await clickText('林晚晴')
await page.waitForTimeout(300)
await clickText('登录工作台')
await page.waitForTimeout(1200)

const shots = []
async function shot(name) {
  await page.screenshot({ path: path.join(OUT, name) })
  shots.push(name)
}
async function goto(url, wait = 1800) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(wait)
}

await goto('/')
await shot('v4-l1-workbench-1440.png')

await goto('/projects')
await shot('v4-l2-projects-1440.png')

await goto(`/projects/${PID}/overview`)
await shot('v4-l3-project-overview-1440.png')
await goto(`/projects/${PID}/materials`)
await shot('v4-l3-materials-1440.png')

await page.setViewportSize({ width: 1180, height: 820 })
await goto('/projects')
await shot('v4-l2-projects-1180.png')
await page.setViewportSize({ width: 1440, height: 900 })

const report = { shots, errors }
fs.writeFileSync(path.join(OUT, 'v4-layout-shots.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report))
await browser.close()
