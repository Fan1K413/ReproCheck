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
page.on('pageerror', (e) => console.log('ERR', e.message))
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
await sleep(1200)
await page.goto(BASE + '/orgs', { waitUntil: 'domcontentloaded' })
await sleep(2000)
const info = await page.evaluate(() => {
  const header = document.querySelector('.rc-l2-header')
  const btns = [...document.querySelectorAll('header button')].map((b) => ({
    aria: b.getAttribute('aria-label'),
    text: (b.textContent || '').trim().slice(0, 20),
    cls: b.className.slice(0, 60),
  }))
  const root = document.querySelector('.min-h-screen')
  const main = document.querySelector('main')
  return {
    url: location.pathname,
    rootSkin: root?.getAttribute('data-rc-skin') ?? null,
    headerHtml: header ? header.innerHTML.slice(0, 500) : null,
    btns,
    mainFirst: main?.firstElementChild?.className ?? null,
    mainFirstSkin: main?.firstElementChild?.getAttribute('data-rc-skin') ?? null,
    headerHeight: header ? header.getBoundingClientRect().height : null,
    mainTop: main ? main.getBoundingClientRect().top : null,
    headerBg: header ? getComputedStyle(header).backgroundImage.slice(0, 200) : null,
  }
})
console.log(JSON.stringify(info, null, 2))
await browser.close()
