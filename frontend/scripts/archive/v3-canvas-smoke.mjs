// 冒烟：确认 FoldFieldCanvas（/ 径向工作台）仍正常绘制，参数调整未改变绘图结果
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--disable-gpu', '--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
  userDataDir: path.resolve('.puppeteer-cache'),
})
const page = await browser.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
await sleep(1500)
const clickText = async (text) =>
  page.evaluate((t) => {
    const el = [...document.querySelectorAll('button,*[role="button"],a,div,span')]
      .filter((n) => n.textContent?.trim() === t && n.offsetParent !== null)
      .pop()
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return !!el
  }, text)
await clickText('林晚晴')
await sleep(400)
await clickText('登录工作台')
await sleep(1500)

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await sleep(2600)
const canvas = await page.evaluate(() => {
  const c = document.querySelector('canvas')
  if (!c) return { found: false }
  const ctx = c.getContext('2d')
  const { width, height } = c
  const data = ctx.getImageData(0, 0, width, height).data
  let nonEmpty = 0
  for (let i = 3; i < data.length; i += 4) if (data[i] > 8) nonEmpty += 1
  return { found: true, width, height, nonEmptyRatio: +(nonEmpty / (width * height)).toFixed(4) }
})
await page.screenshot({ path: path.join(OUT, 'final-home-canvas.png') })
const out = { canvas, errors }
fs.writeFileSync(path.join(OUT, 'final-canvas-smoke.json'), JSON.stringify(out, null, 2))
console.log(JSON.stringify(out))
await browser.close()
