import { chromium } from 'playwright-core'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots/workbench-round2/dark-core-preview.png')
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
await page.waitForTimeout(1400)
await page.addStyleTag({ content: `
  .rc-core {
    background:
      radial-gradient(62% 52% at 32% 22%, rgba(214,184,255,.2), transparent 70%),
      linear-gradient(150deg, rgba(46,25,72,.88), rgba(28,14,45,.8) 58%, rgba(17,9,30,.85)) !important;
    box-shadow: inset 0 1px 0 rgba(255,255,255,.28), inset 0 -10px 24px rgba(0,0,0,.3), 0 8px 22px rgba(8,4,15,.3) !important;
    color: #f8f0ff !important;
  }
  .rc-core__name, .rc-core__title { color: #f8f0ff !important; text-shadow: 0 1px 12px rgba(12,5,24,.7); }
  .rc-core__hint { color: #d9c8ee !important; }
  .rc-core__wordmark { color: #d9c8ee !important; }
  .rc-core__brand-rule { background: linear-gradient(90deg, transparent, rgba(214,184,255,.5), transparent) !important; }
` })
await page.waitForTimeout(250)
await page.screenshot({ path: OUT })
await browser.close()
