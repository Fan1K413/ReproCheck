import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, '.screenshots', 'stage9', 'auth-fallback')
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const results = []
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })

async function runViewport(name, viewport) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN' })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const runtime = { consoleErrors: [], pageErrors: [], badResponses: [] }
  page.on('console', (m) => { if (m.type() === 'error') runtime.consoleErrors.push(m.text()) })
  page.on('pageerror', (e) => runtime.pageErrors.push(String(e)))
  page.on('response', (r) => { if (r.status() >= 400) runtime.badResponses.push({ status: r.status(), url: r.url(), method: r.request().method() }) })
  async function step(label, fn) {
    try {
      const detail = await fn()
      results.push({ viewport: name, label, ok: true, detail: detail ?? null })
      console.log(`PASS [${name}] ${label}`)
    } catch (error) {
      results.push({ viewport: name, label, ok: false, error: String(error), url: page.url() })
      console.error(`FAIL [${name}] ${label}: ${error}`)
    }
    await page.screenshot({ path: path.join(OUT, `${name}-${String(results.filter((r) => r.viewport === name).length).padStart(2, '0')}-${label}.png`), fullPage: true, animations: 'disabled' })
  }

  await step('未登录访问项目页', async () => {
    const response = await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/login/)
    assert.ok((response?.status() ?? 0) < 400)
    assert.equal(new URL(page.url()).pathname, '/login')
    return { requested: '/projects', landed: page.url() }
  })

  await step('错误密码真实拒绝', async () => {
    await page.getByRole('button', { name: /林晚晴/ }).click()
    await page.locator('#auth-password').fill('WrongPass#Stage9')
    const responsePromise = page.waitForResponse((r) => r.url().includes('/auth/login') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '登录工作台', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 401)
    await page.getByText(/邮箱或密码错误|账号或密码错误/).first().waitFor()
    return { status: response.status() }
  })

  await step('正确登录与目标恢复', async () => {
    await page.getByRole('button', { name: /林晚晴/ }).click()
    await page.getByRole('button', { name: '登录工作台', exact: true }).click()
    await page.waitForURL(/\/projects$/)
    assert.equal(new URL(page.url()).pathname, '/projects')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    assert.equal(overflow, false)
    return { landed: page.url() }
  })

  await step('未知路由不静默重定向', async () => {
    const response = await page.goto(`${BASE}/stage9-route-without-page`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    assert.equal(new URL(page.url()).pathname, '/stage9-route-without-page')
    await page.getByText('没有找到这条审计路径', { exact: true }).waitFor()
    await page.getByText(/ROUTE_NOT_FOUND/).waitFor()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    assert.equal(overflow, false)
    return { httpStatus: response?.status(), path: new URL(page.url()).pathname }
  })

  await step('404出口真实可用', async () => {
    await page.getByRole('link', { name: '返回根工作台', exact: true }).click()
    await page.waitForURL(`${BASE}/`)
    await page.locator('.rc-disc-shell').waitFor()
    return { landed: page.url() }
  })

  await context.close()
  return runtime
}

const desktopRuntime = await runViewport('desktop', { width: 1440, height: 900 })
const mobileRuntime = await runViewport('mobile', { width: 390, height: 844 })

const report = {
  meta: { base: BASE, routes: ['/login', '/stage9-route-without-page'], viewports: ['1440x900', '390x844'] },
  summary: { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length },
  results,
  runtime: { desktop: desktopRuntime, mobile: mobileRuntime },
}
fs.writeFileSync(path.join(OUT, 'auth-fallback-report.json'), JSON.stringify(report, null, 2))
console.log(`REPORT ${path.join(OUT, 'auth-fallback-report.json')}`)
await browser.close()
