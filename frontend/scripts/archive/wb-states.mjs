/* 交互态视觉取证：hover 上/下半区、拖动中、卡组展开。用法 node scripts/wb-states.mjs [1440 900] */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const width = Number(process.argv[2] || 1440)
const height = Number(process.argv[3] || 900)
const OUT = path.resolve('../.screenshots/workbench-radial/states')
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width, height } })
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-radial')
  localStorage.setItem('rc_user', JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }))
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }, organizations: [] }) }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1600)

const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) })
const tag = `${width}x${height}`

await page.locator('.rc-entry').nth(0).hover()
await page.waitForTimeout(320)
await shot(`${tag}-hover-top`)

await page.locator('.rc-entry').nth(5).hover()
await page.waitForTimeout(320)
await shot(`${tag}-hover-bottom`)

/* 拖动：从中心向 240° 推，保持按住截屏 */
const box = await page.locator('.rc-disc-shell').boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2
const rad = (240 * Math.PI) / 180
await page.mouse.move(cx, cy)
await page.mouse.down()
await page.mouse.move(cx + Math.sin(rad) * 20, cy - Math.cos(rad) * 20, { steps: 3 })
await page.mouse.move(cx + Math.sin(rad) * box.width * 0.35, cy - Math.cos(rad) * box.height * 0.35, { steps: 10 })
await page.waitForTimeout(260)
await shot(`${tag}-dragging`)
await page.mouse.up()
await page.waitForTimeout(420)
await shot(`${tag}-fan`)
await page.keyboard.press('Escape')
await page.waitForTimeout(260)

/* 键盘焦点 */
await page.locator('.rc-entry').nth(3).focus()
await page.waitForTimeout(260)
await shot(`${tag}-focus`)

/* 键盘导航：焦点在第 3 枚时按两次 ArrowRight */
await page.keyboard.press('ArrowRight')
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(220)
const keyboard = await page.evaluate(() => {
  const el = document.activeElement
  return {
    tag: el?.tagName ?? null,
    index: el?.getAttribute('data-index') ?? null,
    label: el?.getAttribute('aria-label') ?? null,
    tip: el?.querySelector('.rc-tooltip')?.textContent?.trim() ?? null,
  }
})

/* 点击空白遮罩关闭卡组 */
await page.locator('.rc-entry').nth(0).click()
await page.waitForTimeout(420)
const fanOpen = await page.locator('.rc-fan').count()
await page.locator('.rc-fan-backdrop').click({ position: { x: 8, y: 8 }, force: true })
await page.waitForTimeout(300)
const fanClosed = await page.locator('.rc-fan').count()
const activeAfterClose = await page.locator('.rc-disc-shell[data-fan=\"true\"]').count()

const checks = await page.evaluate(() => {
  const core = document.querySelector('.rc-core').getBoundingClientRect()
  const tips = [...document.querySelectorAll('.rc-tooltip')].map((el) => {
    const r = el.getBoundingClientRect()
    return { text: el.textContent.trim(), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), left: +r.left.toFixed(1) }
  })
  return {
    coreBox: { top: +core.top.toFixed(1), bottom: +core.bottom.toFixed(1), left: +core.left.toFixed(1), right: +core.right.toFixed(1) },
    tooltips: tips,
  }
})
console.log(JSON.stringify({ keyboard, fanOpen, fanClosed, activeAfterClose, ...checks }, null, 2))
await browser.close()

