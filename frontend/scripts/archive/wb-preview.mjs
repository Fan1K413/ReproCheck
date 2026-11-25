/* 单档视觉预览：idle + 6 瓣。仅用于迭代检查。 */
import { chromium } from 'playwright-core'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots/workbench-round2')
const width = Number(process.argv[2] || 1440)
const height = Number(process.argv[3] || 900)
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width, height } })
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-preview')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }),
}))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)
await page.screenshot({ path: path.join(OUT, `preview-${width}x${height}-idle.png`) })
await page.locator('.rc-entry').nth(3).click()
await page.waitForTimeout(1000)
await page.screenshot({ path: path.join(OUT, `preview-${width}x${height}-petals.png`) })
await browser.close()
