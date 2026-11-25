import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = 'C:\\Users\\ASUS\\Desktop\\科研复现审计官\\.screenshots'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 2 },
})
const page = await browser.newPage()
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await sleep(1200)
for (const t of ['林晚晴', '登录工作台']) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button,a')].find((e) => e.textContent.includes(x)) || null,
    t,
  )
  const el = h.asElement()
  if (el) await el.click()
  await sleep(700)
}
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1000)
for (const route of ['/orgs', '/projects']) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rc-l2-header', { timeout: 15000 })
  await sleep(900)
  const tag = route === '/projects' ? 'dark' : 'light'
  await page.screenshot({ path: `${OUT}/zoom-header-${tag}.png`, clip: { x: 0, y: 0, width: 460, height: 90 } })
  const geo = await page.evaluate(() => {
    const h = document.querySelector('.rc-l2-header')
    const b = [...h.querySelectorAll('button')].map((x) => {
      const r = x.getBoundingClientRect()
      return { aria: x.getAttribute('aria-label'), x: +r.x.toFixed(1), w: +r.width.toFixed(1) }
    })
    const title = document.querySelector('header h1')?.getBoundingClientRect()
    return { headerW: h.getBoundingClientRect().width, buttons: b, title: title ? { x: +title.x.toFixed(1), y: +title.y.toFixed(1) } : null }
  })
  console.log(tag, JSON.stringify(geo))
}
await browser.close()
