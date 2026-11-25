import puppeteer from 'puppeteer-core'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200))
})

await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' })
await sleep(1500)
for (const t of ['林晚晴', '登录工作台']) {
  const h = await page.evaluateHandle(
    (x) => [...document.querySelectorAll('button,a')].find((e) => e.textContent.includes(x)) || null,
    t,
  )
  const el = h.asElement()
  console.log('click', t, !!el)
  if (el) await el.click()
  await sleep(900)
}
await sleep(1500)
console.log('after login path', await page.evaluate(() => location.pathname), 'header?', await page.evaluate(() => !!document.querySelector('.rc-l2-header')))

await page.goto(BASE + '/orgs', { waitUntil: 'domcontentloaded' })
for (let i = 0; i < 8; i += 1) {
  await sleep(1000)
  const s = await page.evaluate(() => ({
    path: location.pathname,
    header: !!document.querySelector('.rc-l2-header'),
    rootSkin: document.querySelector('.min-h-screen')?.getAttribute('data-rc-skin') ?? null,
    body: document.body.textContent.trim().slice(0, 60),
  }))
  console.log(i, JSON.stringify(s))
}
await browser.close()
