/* 易用性改造前基线：登录、关键页面截图与控制台/失败请求记录。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:8000/api/v1'
const OUT = path.resolve('../.screenshots/usability')
fs.mkdirSync(OUT, { recursive: true })

const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()

const token = auth?.data?.token
const user = auth?.data?.user
if (!token) {
  console.error('login failed', JSON.stringify(auth))
  process.exit(1)
}

const pages = [
  ['workbench', '/'],
  ['projects', '/projects'],
  ['project-new', '/projects/new'],
  ['llm', '/settings/llm'],
  ['models', '/settings/models'],
  ['reproduction', '/projects/p1/reproduction'],
  ['reports', '/projects/p1/reproduction/reports'],
  ['knowledge', '/knowledge'],
]

const rows = []
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
for (const [tag, route] of pages) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  await page.addInitScript(([t, u]) => {
    localStorage.setItem('rc_token', t)
    localStorage.setItem('rc_user', JSON.stringify(u))
  }, [token, user])
  const errors = []
  const bad = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`)
  })
  await page.goto(BASE + route, { waitUntil: 'networkidle' }).catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(OUT, `${tag}-1440.png`), fullPage: false })
  const body = await page.evaluate(() => document.body.innerText.slice(0, 5000))
  rows.push({ tag, route, url: page.url(), errors, bad: [...new Set(bad)], body })
  await context.close()
}
await browser.close()
fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(rows, null, 2))
console.log(JSON.stringify(rows.map((r) => ({ tag: r.tag, url: r.url, errors: r.errors.length, bad: r.bad })), null, 2))
