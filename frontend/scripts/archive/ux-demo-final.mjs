/* 真实浏览器演示录屏：首次引导 → 任务工作台 → 四步复现 → API 五步真实失败 → 中文手册。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const VIDEO_DIR = path.resolve('../.screenshots/usability/round2/video')
fs.rmSync(VIDEO_DIR, { recursive: true, force: true })
fs.mkdirSync(VIDEO_DIR, { recursive: true })

const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()
const token = auth?.data?.token || auth?.data?.access_token
const user = auth?.data?.user
const projects = await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()
const project = projects?.data?.items?.[0]
if (!token || !project) throw new Error('login or project failed')

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  locale: 'zh-CN',
})
const page = await context.newPage()
page.setDefaultTimeout(20000)
await page.addInitScript(([t, u]) => {
  localStorage.setItem('rc_token', t)
  localStorage.setItem('rc_user', JSON.stringify(u))
}, [token, user])
const wait = (ms = 900) => page.waitForTimeout(ms)

// 1. 首次进入：不是图标墙，而是先问“你要做什么”。
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await wait(1600)
await page.getByRole('button', { name: /下一步：选择我想做的事/ }).click()
await wait(1400)
await page.getByRole('button', { name: /我想复现一篇论文/ }).click()
await wait(1800)

// 2. 返回用户工作台：9 个任务入口 + 花瓣二级卡。
await page.evaluate(() => localStorage.setItem('rc:onboarding:v1', 'done'))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await wait(1500)
await page.locator('.rc-entry').first().click()
await wait(1300)
await page.keyboard.press('Escape')
await wait(700)
await page.getByRole('button', { name: '我想做什么' }).first().click()
await wait(1300)
await page.keyboard.press('Escape')
await wait(700)

// 3. 四步复现：项目已选、第 4 步按真实材料给出下一步。
await page.goto(`${BASE}/start/reproduce?project=${project.id}&step=1`, { waitUntil: 'domcontentloaded' })
await wait(1500)
await page.getByRole('button', { name: /保存草稿，下一步/ }).click()
await wait(1200)
await page.getByRole('button', { name: /保存草稿，下一步/ }).click()
await wait(1500)
await page.getByRole('button', { name: /保存草稿，下一步/ }).click()
await wait(1800)

// 4. API 五步：空密钥校验 → 真实失败 → 失败时不出现保存。
await page.goto(BASE + '/settings/models?tab=setup', { waitUntil: 'domcontentloaded' })
await wait(1200)
await page.locator('.ux-provider-card', { hasText: 'DeepSeek' }).first().click()
await wait(800)
await page.getByRole('button', { name: /下一步：选择模型/ }).click()
await wait(700)
await page.locator('input[type="password"]').fill('sk-invalid-demo-key-not-real')
await wait(500)
await page.getByRole('button', { name: /下一步：选择模型/ }).click()
await wait(1000)
await page.getByRole('button', { name: /下一步：测试连接/ }).click()
await wait(900)
await page.getByRole('button', { name: /开始真实测试/ }).click()
await page.waitForResponse((r) => r.url().includes('/model-credentials/test-draft'))
await wait(1600)

// 5. 中文手册：章节筛选。
await page.goto(BASE + '/manual', { waitUntil: 'domcontentloaded' })
await wait(1400)
await page.getByPlaceholder('例如：API、报告、证据').fill('API')
await wait(1300)

// 6. 390 窄屏：首次引导与四步复现不横向溢出。
await page.setViewportSize({ width: 390, height: 844 })
await page.goto(BASE + '/start/reproduce?project=' + project.id + '&step=4', { waitUntil: 'domcontentloaded' })
await wait(1600)
await page.evaluate(() => window.scrollTo({ top: 620, behavior: 'smooth' }))
await wait(1400)

await context.close()
await browser.close()
const files = fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
console.log(JSON.stringify({ videos: files, project: project.name }, null, 2))
