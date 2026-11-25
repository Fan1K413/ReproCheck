import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text()) })
page.on('response', (r) => { if (r.status() >= 400) console.log('BAD', r.status(), r.url()) })
page.on('requestfailed', (r) => console.log('FAILED', r.url(), r.failure()?.errorText))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
await page.locator('.rc-entry').nth(4).click()
await page.waitForTimeout(1200)
await page.locator('.rc-close').click()
await page.waitForTimeout(1200)
await browser.close()
