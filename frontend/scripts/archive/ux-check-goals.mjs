/* 首次引导 5 个目标的真实路由验收。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()
const token = auth?.data?.token || auth?.data?.access_token
const user = auth?.data?.user
const browser = await chromium.launch({ executablePath: EDGE, headless: true })
const report = []
const errors = []

for (const label of ['我想复现一篇论文', '我想管理已有项目', '我想检查一次实验结果', '我想生成或查看报告', '我还不知道怎么用，带我看看']) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('rc_token', t)
    localStorage.setItem('rc_user', JSON.stringify(u))
  }, [token, user])
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /下一步：选择我想做的事/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: new RegExp(label) }).click()
  await page.waitForTimeout(1000)
  let heading = await page.locator('h1').first().innerText().catch(() => '')
  let url = page.url()
  let selectedProject = ''
  if (heading === '要处理哪个项目？') {
    selectedProject = await page.locator('.ux-project-choice strong').first().innerText()
    await page.locator('.ux-project-choice').first().click()
    await page.waitForTimeout(1000)
    heading = await page.locator('h1').first().innerText().catch(() => '')
    url = page.url()
  }
  report.push({ goal: label, selectedProject, finalUrl: url.replace(BASE, ''), finalHeading: heading })
  await context.close()
}

await browser.close()
const dir = path.resolve('../.screenshots/usability/round2')
fs.writeFileSync(path.join(dir, 'usability-goals-verify.json'), JSON.stringify({ report, errors }, null, 2))
console.log(JSON.stringify({ report, errors }, null, 2))
