import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, '.screenshots', 'stage9', 'touch-exemptions')
const BASE = 'http://127.0.0.1:5173'
const PID = 'proj-209c77cd39f94212'
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe', headless: true })
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'zh-CN' })
await page.goto(`${BASE}/login`)
await page.getByRole('button', { name: /林晚晴/ }).click()
await page.getByRole('button', { name: '登录工作台', exact: true }).click()
await page.waitForURL(`${BASE}/`)
const routes = {
  'reproduction-reports': `/projects/${PID}/reproduction/reports`,
  benchmark: '/benchmark',
  knowledge: '/knowledge',
  'data-audit': `/projects/${PID}/data-audit`,
}
const results = []
for (const [slug, route] of Object.entries(routes)) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const items = await page.evaluate(() => {
    const small = [...document.querySelectorAll('input[type="checkbox"], input[type="radio"]')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
    })
    return small.map((el) => {
      const label = el.closest('label')
      const labelRect = label?.getBoundingClientRect()
      const text = (label?.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      return {
        text: text.slice(0, 120),
        control: { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height },
        label: labelRect ? { width: labelRect.width, height: labelRect.height } : null,
        hitAreaPasses: !!(labelRect && labelRect.width >= 24 && labelRect.height >= 24),
      }
    })
  })
  const chartPaths = await page.locator('svg path.rcw-wheel-sector').count()
  results.push({ slug, candidates: items, chartOnlyPaths: slug === 'knowledge' ? chartPaths : 0 })
  await page.screenshot({ path: path.join(OUT, `${slug}.png`), fullPage: false })
}
fs.writeFileSync(path.join(OUT, 'touch-exemptions-report.json'), JSON.stringify({ results }, null, 2))
console.log(JSON.stringify(results, null, 2))
await browser.close()
