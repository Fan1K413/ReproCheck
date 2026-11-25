/* 第二轮交互录屏：静止 → 6 瓣 → 切换 3 瓣 → ESC → 2 瓣 → 收起。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots/workbench-round2')
const TMP = path.join(OUT, 'video-tmp')
fs.mkdirSync(TMP, { recursive: true })

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: TMP, size: { width: 1440, height: 900 } },
})
const page = await context.newPage()
await page.addInitScript(() => {
  localStorage.setItem('rc_token', 'demo-token-video')
  localStorage.setItem(
    'rc_user',
    JSON.stringify({ id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' }),
  )
})
await page.route('**/api/v1/auth/me', (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      user: { id: 'u1', email: 'lead@reprocheck.demo', display_name: '林晚晴' },
      organizations: [],
    }),
  }),
)
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1800)

/* 录屏专用光标：让观看者看清点击与 hover 的位置，不进入项目代码。 */
await page.evaluate(() => {
  const ring = document.createElement('div')
  ring.id = 'rec-cursor'
  ring.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:18px',
    'height:18px',
    'margin:-9px 0 0 -9px',
    'border:1px solid rgba(255,255,255,.72)',
    'border-radius:50%',
    'box-shadow:0 0 0 1px rgba(124,47,208,.36),0 0 18px rgba(196,132,252,.42)',
    'background:rgba(233,213,255,.08)',
    'pointer-events:none',
    'z-index:99999',
    'transition:transform 90ms ease, background 90ms ease',
  ].join(';')
  document.body.appendChild(ring)
  const move = (e) => {
    ring.style.left = `${e.clientX}px`
    ring.style.top = `${e.clientY}px`
  }
  window.addEventListener('mousemove', move)
  window.addEventListener('mousedown', () => {
    ring.style.transform = 'scale(.72)'
    ring.style.background = 'rgba(233,213,255,.34)'
  })
  window.addEventListener('mouseup', () => {
    ring.style.transform = 'scale(1)'
    ring.style.background = 'rgba(233,213,255,.08)'
  })
})

const box = await page.locator('.rc-disc-shell').boundingBox()
const cx = box.x + box.width / 2
const cy = box.y + box.height / 2

const move = async (x, y, steps = 18) => {
  await page.mouse.move(x, y, { steps })
  await page.waitForTimeout(260)
}

/* 1. 静止：悬停上/右/下三个入口 */
await page.waitForTimeout(1200)
await move(cx, cy - box.height * 0.39)
await move(cx + box.width * 0.33, cy + box.height * 0.16)
await move(cx - box.width * 0.2, cy + box.height * 0.35)

/* 2. 打开复现验证 6 瓣 */
await page.locator('.rc-entry').nth(3).click()
await page.waitForTimeout(1100)
const petals = page.locator('.rc-petal')
for (let i = 0; i < 6; i += 1) {
  const p = await petals.nth(i).boundingBox()
  await move(p.x + p.width / 2, p.y + p.height / 2)
}
await page.waitForTimeout(800)

/* 3. 收起 → 打开规则与字段 3 瓣 */
await page.locator('.rc-petal-close').click()
await page.waitForTimeout(800)
await page.locator('.rc-entry').nth(4).click()
await page.waitForTimeout(900)
const p0 = await page.locator('.rc-petal').nth(0).boundingBox()
await move(p0.x + p0.width / 2, p0.y + p0.height / 2)
await page.waitForTimeout(900)

/* 4. ESC 关闭 → 模型服务 2 瓣直接切换 */
await page.keyboard.press('Escape')
await page.waitForTimeout(700)
await page.locator('.rc-entry').nth(8).click()
await page.waitForTimeout(900)
const p2 = await page.locator('.rc-petal').nth(1).boundingBox()
await move(p2.x + p2.width / 2, p2.y + p2.height / 2)
await page.waitForTimeout(900)

/* 5. 点空白关闭 → 回到静止 */
await page.locator('.rc-petal-scrim').click({ position: { x: 22, y: 22 }, force: true })
await page.waitForTimeout(1200)
await move(cx + box.width * 0.18, cy - box.height * 0.35)
await page.waitForTimeout(1400)

const video = page.video()
await page.close()
await video?.saveAs(path.join(OUT, 'workbench-round2-1440.webm'))
await context.close()
await browser.close()

console.log(JSON.stringify({ video: path.join(OUT, 'workbench-round2-1440.webm') }))
