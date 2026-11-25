import { chromium } from 'playwright-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const DEMO_USER = { id: 'u', email: 'lead@reprocheck.demo', display_name: '林晚晴', is_platform_admin: false, created_at: '', last_login_at: null }

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
await page.addInitScript((user) => {
  localStorage.setItem('rc_token', 'demo-token-bg')
  localStorage.setItem('rc_user', JSON.stringify(user))
}, DEMO_USER)
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: DEMO_USER, organizations: [] }) }),
)
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' })
await new Promise((r) => setTimeout(r, 2000))

const nodes = await page.evaluate(() => {
  const out = []
  const walker = document.createTreeWalker(document.querySelector('.rc-stage'), NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const t = walker.currentNode.textContent.trim()
    if (!t) continue
    const parent = walker.currentNode.parentElement
    const r = parent.getBoundingClientRect()
    out.push({ text: t.slice(0, 30), cls: parent.className?.toString().slice(0, 60), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) })
  }
  return out
})
console.log(JSON.stringify(nodes, null, 1))

// 图标几何：中心距、角度
const geo = await page.evaluate(() => {
  const disc = document.querySelector('.rc-disc-shell').getBoundingClientRect()
  const entries = [...document.querySelectorAll('.rc-entry')].map((el) => {
    const r = el.getBoundingClientRect()
    return { id: el.querySelector('.rc-tooltip')?.textContent, cx: r.x + r.width / 2, cy: r.y + r.height / 2, w: r.width, h: r.height }
  })
  const ccx = disc.x + disc.width / 2
  const ccy = disc.y + disc.height / 2
  return {
    disc: { x: Math.round(disc.x), y: Math.round(disc.y), w: Math.round(disc.width), h: Math.round(disc.height), cx: ccx, cy: ccy },
    entries: entries.map((e, i) => ({
      ...e,
      dist: +Math.hypot(e.cx - ccx, e.cy - ccy).toFixed(1),
      angle: +(((Math.atan2(e.cx - ccx, -(e.cy - ccy)) * 180) / Math.PI + 360) % 360).toFixed(1),
    })),
  }
})
console.log('GEO', JSON.stringify(geo, null, 1))
await browser.close()
