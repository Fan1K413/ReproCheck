/* 易用性改造真实浏览器验收：首次引导、工作台、下一步、API 向导、四步引导、手册、帮助抽屉。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const OUT = path.resolve('../.screenshots/usability')
fs.mkdirSync(OUT, { recursive: true })

const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()
const token = auth?.data?.token
const user = auth?.data?.user
if (!token) throw new Error('login failed ' + JSON.stringify(auth))
const projects = await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()
const project = projects?.data?.items?.[0]
if (!project) throw new Error('no project')
const materials = await (await fetch(`${API}/materials?project_id=${project.id}`, { headers: { Authorization: `Bearer ${token}` } })).json()

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const errors = []
const bad = []
const report = []

async function makePage(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('rc_token', t)
    localStorage.setItem('rc_user', JSON.stringify(u))
  }, [token, user])
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`) })
  return { context, page }
}

// 1. 首次进入
{
  const { context, page } = await makePage()
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, '01-onboarding-welcome-1440.png') })
  await page.getByRole('button', { name: /下一步：选择我想做的事/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, '02-onboarding-goals-1440.png') })
  report.push({ screen: 'onboarding', heading: await page.locator('h1').first().innerText(), body: (await page.locator('body').innerText()).slice(0, 1000) })
  await context.close()
}

// 2. 返回工作台（已完成引导）
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, '03-workbench-usability-1440.png') })
  const top = await page.locator('.rc-utility-bar').innerText().catch(() => '')
  report.push({ screen: 'workbench', top })
  await context.close()
}

// 3. 项目页 + 下一步
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(BASE + '/projects', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, '04-projects-next-step-1440.png') })
  report.push({ screen: 'projects', next: await page.locator('.ux-next-step').innerText().catch(() => '') })
  await context.close()
}

// 4. 项目内下一步
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(`${BASE}/projects/${project.id}/materials`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, '05-material-next-step-1440.png') })
  report.push({ screen: 'materials', next: await page.locator('.ux-next-step').innerText().catch(() => '') })
  await context.close()
}

// 5. API 向导
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(BASE + '/settings/models?tab=setup', { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, '06-api-setup-step1-1440.png') })
  const providers = await page.locator('.ux-provider-card').count()
  await page.locator('.ux-provider-card').first().click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, '07-api-setup-step2-1440.png') })
  report.push({ screen: 'api', providerCards: providers, body: (await page.locator('.ux-model-wizard').innerText()).slice(0, 1200) })
  await context.close()
}

// 6. 四步复现引导
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(`${BASE}/start/reproduce?project=${project.id}&step=1`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, '08-guided-paper-1440.png') })
  await page.goto(`${BASE}/start/reproduce?project=${project.id}&step=4`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, '09-guided-ready-1440.png') })
  report.push({ screen: 'guided', body: (await page.locator('.ux-guided-card').innerText()).slice(0, 1200) })
  await context.close()
}

// 7. 手册
{
  const { context, page } = await makePage()
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(BASE + '/manual', { waitUntil: 'networkidle' })
  await page.waitForTimeout(700)
  await page.screenshot({ path: path.join(OUT, '10-manual-1440.png'), fullPage: false })
  report.push({ screen: 'manual', h1: await page.locator('h1').first().innerText(), sections: await page.locator('.ux-manual-section').count() })
  await context.close()
}

// 8. 帮助抽屉
{
  const { context, page } = await makePage({ width: 390, height: 844 })
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'done'))
  await page.goto(`${BASE}/projects/${project.id}/materials`, { waitUntil: 'networkidle' })
  await page.waitForTimeout(900)
  await page.getByRole('button', { name: /打开.*使用帮助/ }).click()
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(OUT, '11-help-drawer-390.png') })
  report.push({ screen: 'help-390', drawer: (await page.locator('.ux-help-drawer').innerText()).slice(0, 1200) })
  await context.close()
}

await browser.close()
fs.writeFileSync(path.join(OUT, 'usability-verify.json'), JSON.stringify({ report, errors, bad: [...new Set(bad)], project, materials: materials?.data?.total }, null, 2))
console.log(JSON.stringify({ errors: [...new Set(errors)], bad: [...new Set(bad)], report: report.map((r) => r.screen), project: project.name }, null, 2))
