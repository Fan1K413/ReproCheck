import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = 'C:\\Users\\ASUS\\Desktop\\科研复现审计官\\.screenshots'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await sleep(1400)
for (const t of ['林晚晴', '登录工作台']) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button,a')].find((e) => e.textContent.includes(x)) || null,
    t,
  )
  const el = h.asElement()
  if (el) await el.click()
  await sleep(800)
}
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1000)

for (const route of ['/orgs', '/projects']) {
  await page.goto(BASE + route, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.rc-l2-header')
  await sleep(900)
  await page.evaluate(() => document.querySelector('button[aria-label="打开功能目录"]')?.click())
  await sleep(600)
  const rows = await page.evaluate(() => {
    const links = [...document.querySelectorAll('[data-rc-drawer] nav a')].slice(0, 8)
    return links.map((a) => ({
      text: a.textContent.trim(),
      current: a.getAttribute('aria-current'),
      bg: getComputedStyle(a).backgroundColor,
      color: getComputedStyle(a).color,
    }))
  })
  console.log(route, JSON.stringify(rows, null, 1))
  await page.screenshot({ path: `${OUT}/dbg-drawer-${route === '/orgs' ? 'light' : 'dark'}.png` })
  await page.keyboard.press('Escape')
  await sleep(300)
}
await browser.close()
