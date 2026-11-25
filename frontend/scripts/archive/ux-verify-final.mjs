/* 最终验收（生产式 5173 + 8000）：无加密密钥下真实测试、术语标题、390 首次引导与项目全名。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const OUT = path.resolve('../.screenshots/usability/round2')
fs.mkdirSync(OUT, { recursive: true })

const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()
const token = auth?.data?.token || auth?.data?.access_token
const user = auth?.data?.user
if (!token) throw new Error('login failed')
const headers = { Authorization: `Bearer ${token}` }
const projects = await (await fetch(`${API}/projects`, { headers })).json()
const project = projects?.data?.items?.[0]
if (!project) throw new Error('no project')

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const errors = []
const unexpected = []
const report = []

async function pageFor(viewport, onboarding) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem('rc_token', t)
    localStorage.setItem('rc_user', JSON.stringify(u))
    if (o) localStorage.setItem('rc:onboarding:v1', o)
  }, [token, user, onboarding])
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/model-credentials/test-draft')) unexpected.push(`${r.status()} ${r.url()}`)
  })
  return { context, page }
}

// A. 真实五步 API：5173 → 8000，无 MODEL_CREDENTIAL_KEY 时测试仍能真实调用。
{
  const { context, page } = await pageFor({ width: 1440, height: 900 }, 'done')
  await page.goto(BASE + '/settings/models?tab=setup', { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(900)
  await page.locator('.ux-provider-card', { hasText: 'DeepSeek' }).first().click()
  await page.waitForTimeout(250)
  await page.locator('input[type="password"]').fill('sk-invalid-final-usability-test')
  await page.getByRole('button', { name: /下一步：选择模型/ }).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: /下一步：测试连接/ }).click()
  await page.waitForTimeout(250)
  const testWait = page.waitForResponse((r) => r.url().includes('/model-credentials/test-draft'))
  await page.getByRole('button', { name: /开始真实测试/ }).click()
  const testResponse = await testWait
  const testJson = await testResponse.json().catch(() => null)
  await page.waitForTimeout(600)
  const failureText = await page.locator('.ux-test-result').innerText().catch(() => '')
  const canSave = await page.getByRole('button', { name: /保存为默认 AI 助手/ }).count()
  await page.screenshot({ path: path.join(OUT, '14-api-final-no-key-real-failure-1440.png') })
  report.push({
    name: 'final-api-no-key',
    steps: await page.locator('.ux-model-progress li').count(),
    testHttpStatus: testResponse.status(),
    testResult: testJson?.data,
    failureText: failureText.slice(0, 400),
    canSave,
  })
  await context.close()
}

// B. 术语统一后的页面 H1 与唯一性。
{
  const { context, page } = await pageFor({ width: 1440, height: 900 }, 'done')
  const routes = [
    ['projects', '/projects'],
    ['tasks', `/projects/${project.id}/tasks`],
    ['reproduction', `/projects/${project.id}/reproduction`],
    ['reports', `/projects/${project.id}/reproduction/reports`],
  ]
  const results = []
  for (const [name, url] of routes) {
    await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 20000 })
    await page.waitForTimeout(900)
    results.push({
      name,
      h1: await page.locator('h1').first().innerText().catch(() => ''),
      h1Count: await page.locator('h1').count(),
      body: (await page.locator('body').innerText()).slice(0, 160),
    })
  }
  report.push({ name: 'final-headings', results })
  await context.close()
}

// C. 390 首次引导：不显示图标墙、无横向溢出、目标页可读。
{
  const { context, page } = await pageFor({ width: 390, height: 844 }, null)
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(800)
  const iconWall = await page.locator('.rc-entry').count()
  const h1 = await page.locator('h1').first().innerText()
  const startOverflow = await page.evaluate(() => ({
    innerWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
  }))
  await page.screenshot({ path: path.join(OUT, '15-onboarding-390.png') })
  await page.getByRole('button', { name: /下一步：选择我想做的事/ }).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, '16-onboarding-goals-390.png') })
  const goalsOverflow = await page.evaluate(() => ({
    innerWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth,
  }))
  report.push({ name: 'final-onboarding-390', iconWall, h1, startOverflow, goalsOverflow })
  await context.close()
}

// D. 390 四步引导项目卡：项目全名可换行，不省略。
{
  const { context, page } = await pageFor({ width: 390, height: 844 }, 'done')
  await page.goto(`${BASE}/start/reproduce?project=${project.id}&step=4`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.waitForTimeout(900)
  const projectText = await page.locator('.ux-guided-rail__project strong').innerText()
  const projectBox = await page.locator('.ux-guided-rail__project strong').boundingBox()
  const lineHeight = await page.locator('.ux-guided-rail__project strong').evaluate((el) => getComputedStyle(el).lineHeight)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  await page.screenshot({ path: path.join(OUT, '17-guided-390-full-project.png') })
  report.push({ name: 'final-guided-390', projectText, projectBox, lineHeight, overflow, expected: project.name })
  await context.close()
}

await browser.close()
const file = path.join(OUT, 'usability-verify-final.json')
fs.writeFileSync(file, JSON.stringify({ report, errors, unexpected: [...new Set(unexpected)] }, null, 2))
console.log(JSON.stringify({ errors, unexpected: [...new Set(unexpected)], report: report.map((r) => r.name) }, null, 2))
