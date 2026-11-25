import puppeteer from 'puppeteer-core'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://localhost:5173'
const PID = 'proj-209c77cd39f94212'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'], defaultViewport: { width: 1440, height: 900 } })
const page = await browser.newPage()
page.on('console', (m) => console.log('CONSOLE', m.type(), m.text().slice(0, 200)))
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 300)))
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' })
await sleep(800)
for (const t of ['林晚晴', '登录工作台']) {
  const h = await page.evaluateHandle((text) => [...document.querySelectorAll('button,a')].find((e) => (e.textContent || '').trim().includes(text)) || null, t)
  const el = h.asElement(); if (el) { await el.click(); await sleep(600) }
}
await page.goto(`${BASE}/reproductions/plans/plan-b4bbf8748a2d41`, { waitUntil: 'networkidle2' })
await sleep(2000)
const info = await page.evaluate(() => {
  const svg = document.querySelector('.rc-wa-dag svg')
  const nodes = document.querySelectorAll('.rc-wa-dag__node')
  return {
    hasSvg: !!svg,
    svgW: svg?.getAttribute('width'),
    svgH: svg?.getAttribute('height'),
    viewBox: svg?.getAttribute('viewBox'),
    nodeCount: nodes.length,
    rects: [...nodes].map((g) => {
      const r = g.querySelector('rect')
      const b = r?.getBoundingClientRect()
      return { id: g.querySelector('title')?.textContent?.slice(0, 20), x: r?.getAttribute('x'), y: r?.getAttribute('y'), bbox: b ? [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)] : null }
    }),
    containerW: document.querySelector('.rc-wa-dag')?.getBoundingClientRect().width,
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
