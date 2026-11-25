import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-debug')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)
const state = () =>
  page.evaluate(() => ({
    fan: document.querySelector('.rc-disc-shell')?.getAttribute('data-fan'),
    phase: document.querySelector('.rc-disc-shell')?.getAttribute('data-phase'),
    core: document.querySelector('.rc-core__live')?.textContent?.trim(),
    active: [...document.querySelectorAll('.rc-entry')].filter((el) => el.getAttribute('data-active') === 'true').map((el) => el.getAttribute('aria-label')),
    dim: [...document.querySelectorAll('.rc-entry')].filter((el) => el.getAttribute('data-dimmed') === 'true').length,
    focus: document.activeElement?.getAttribute('aria-label'),
  }))
await page.locator('.rc-entry').nth(3).click()
await page.waitForTimeout(700)
console.log('after-open', await state())
for (let i = 0; i < 6; i += 1) {
  const p = await page.locator('.rc-petal').nth(i).boundingBox()
  await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2, { steps: 5 })
  await page.waitForTimeout(100)
  console.log('hover', i, await state())
}
const e4 = await page.locator('.rc-entry').nth(4).boundingBox()
await page.mouse.move(e4.x + e4.width / 2, e4.y + e4.height / 2, { steps: 5 })
await page.waitForTimeout(160)
console.log('hover-other-entry', await state())
await page.mouse.move(20, 20, { steps: 5 })
await page.waitForTimeout(220)
console.log('leave-other-entry', await state())
await browser.close()
