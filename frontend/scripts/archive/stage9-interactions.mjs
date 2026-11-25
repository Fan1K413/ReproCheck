/* 第九阶段：根工作台与全局导航的真实交互回归。 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, '.screenshots', 'stage9', 'interactions')
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'zh-CN' })
const page = await context.newPage()
const results = []
const runtimeErrors = []
page.on('pageerror', (error) => runtimeErrors.push(String(error)))
page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()) })

async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    results.push({ name, status: 'passed', durationMs: Date.now() - started, detail: detail ?? null })
    console.log(`PASS ${name}`)
  } catch (error) {
    const shot = path.join(OUT, `FAIL-${results.length + 1}.png`)
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {})
    results.push({ name, status: 'failed', durationMs: Date.now() - started, error: String(error), url: page.url(), screenshot: path.basename(shot) })
    console.log(`FAIL ${name}: ${String(error).slice(0, 220)}`)
  }
}
async function root() {
  if (new URL(page.url()).pathname !== '/') {
    const back = page.getByRole('button', { name: '返回工作台', exact: true })
    if (await back.count()) await back.click()
    else await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  }
  await page.waitForURL(`${BASE}/`)
  await page.locator('.rc-disc-shell').waitFor({ state: 'visible' })
  await page.waitForTimeout(450)
}
async function openEntry(pattern) {
  await page.getByRole('menuitem', { name: pattern }).click()
  await page.getByRole('dialog').waitFor({ state: 'visible' })
  await page.waitForTimeout(420)
}

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`)

  await check('根工作台 9 个真实入口', async () => {
    const count = await page.getByRole('menuitem').count()
    if (count !== 9) throw new Error(`expected 9, got ${count}`)
    return { count }
  })

  await check('hover 更新中央文案并在离开后复位', async () => {
    const entry = page.getByRole('menuitem', { name: /智能审计/ })
    await entry.hover()
    await page.waitForTimeout(100)
    const activeText = await page.locator('.rc-core__live').innerText()
    if (!activeText.includes('智能审计')) throw new Error(activeText)
    await page.mouse.move(10, 10)
    await page.waitForTimeout(100)
    const resetText = await page.locator('.rc-core__live').innerText()
    if (!resetText.includes('Release to Select')) throw new Error(resetText)
  })

  await check('点击项目档案展开 3 张真实路由卡，背景点击返回', async () => {
    await openEntry(/项目档案/)
    const cards = page.locator('.rc-fan-card')
    if (await cards.count() !== 3) throw new Error(`cards=${await cards.count()}`)
    await page.screenshot({ path: path.join(OUT, 'desktop-projects-fan.png'), fullPage: true })
    await page.mouse.click(12, 12)
    await page.getByRole('dialog').waitFor({ state: 'detached' })
  })

  await check('Esc 优先关闭功能卡组', async () => {
    await openEntry(/项目档案/)
    await page.keyboard.press('Escape')
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    if (!page.url().endsWith('/')) throw new Error(page.url())
  })

  await check('键盘方向键与 Enter 打开入口', async () => {
    const first = page.getByRole('menuitem', { name: /智能审计/ })
    await first.focus()
    await page.keyboard.press('ArrowRight')
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
    if (!focused?.includes('项目档案')) throw new Error(focused || 'no focus')
    await page.keyboard.press('Enter')
    await page.getByRole('dialog', { name: /项目档案/ }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
  })

  await check('中心拖动释放选择项目档案', async () => {
    await page.getByRole('dialog').count().then(async (count) => { if (count) await page.keyboard.press('Escape') })
    const core = await page.locator('.rc-core').boundingBox()
    const target = await page.getByRole('menuitem', { name: /项目档案/ }).boundingBox()
    if (!core || !target) throw new Error('missing drag geometry')
    await page.mouse.move(core.x + core.width / 2, core.y + core.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 16 })
    const phase = await page.locator('.rc-disc-shell').getAttribute('data-phase')
    if (phase !== 'S3') throw new Error(`phase=${phase}`)
    await page.mouse.up()
    await page.getByRole('dialog', { name: /项目档案/ }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
  })

  await check('功能卡跳转到真实项目列表', async () => {
    await openEntry(/项目档案/)
    await page.locator('.rc-fan-card').filter({ hasText: '项目列表' }).click()
    await page.waitForURL(`${BASE}/projects`)
    await page.getByText('项目档案', { exact: true }).first().waitFor()
  })

  await check('无项目上下文时材料卡降级并显示明确提示', async () => {
    await root()
    const clear = page.getByRole('button', { name: '清除', exact: true })
    if (await clear.count()) await clear.click()
    await openEntry(/材料解析/)
    await page.locator('.rc-fan-card').filter({ hasText: '材料管理' }).click()
    await page.waitForURL(`${BASE}/projects`)
    await page.getByRole('status').filter({ hasText: '请先选择一个项目' }).waitFor({ state: 'visible' })
  })

  await check('真实项目上下文下功能卡进入材料管理', async () => {
    await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
    const materialLink = page.getByRole('link', { name: /管理材料/ }).first()
    await materialLink.waitFor({ state: 'visible' })
    await Promise.all([
      page.waitForURL(/\/projects\/proj-[^/]+\/materials/, { timeout: 10000 }),
      materialLink.click(),
    ])
    await page.locator('.mb-head__title').waitFor({ state: 'visible' })
    await root()
    await openEntry(/材料解析/)
    await page.locator('.rc-fan-card').filter({ hasText: '科研事实' }).click()
    await page.waitForURL(/\/projects\/proj-[^/]+\/facts/)
  })

  await check('目录抽屉打开、Esc 关闭', async () => {
    await page.getByRole('button', { name: '打开功能目录' }).click()
    await page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'detached' })
  })

  await check('全部功能弹层打开与关闭', async () => {
    await page.getByRole('button', { name: '打开全部功能' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await dialog.waitFor({ state: 'detached' })
  })

  await check('二级页 Esc 返回根工作台', async () => {
    if (!page.url().includes('/facts')) await page.goto(`${BASE}/projects/proj-209c77cd39f94212/facts`)
    await page.locator('h1').first().waitFor()
    await page.keyboard.press('Escape')
    await page.waitForURL(`${BASE}/`)
  })

  await check('移动端项目卡组为底部 sheet 且路由可点击', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await root()
    await openEntry(/项目档案/)
    const box = await page.locator('.rc-fan-deck').boundingBox()
    if (!box || box.y < 300 || box.y + box.height > 845 || box.width > 391 || box.x < 0) throw new Error(JSON.stringify(box))
    const cards = page.locator('.rc-fan-card')
    for (let i = 0; i < await cards.count(); i += 1) {
      const r = await cards.nth(i).boundingBox()
      if (!r || r.x < 0 || r.x + r.width > 391 || r.y + r.height > 845) throw new Error(`card ${i} ${JSON.stringify(r)}`)
    }
    await page.screenshot({ path: path.join(OUT, 'mobile-projects-fan.png'), fullPage: true })
    await cards.filter({ hasText: '新建项目' }).click()
    await page.waitForURL(`${BASE}/projects/new`)
  })

  await check('移动端无横向溢出，目录可打开关闭', async () => {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2)
    if (overflow) throw new Error('horizontal overflow')
    await page.getByRole('button', { name: '打开功能目录' }).click()
    await page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: '关闭功能目录' }).last().click()
    await page.getByRole('dialog', { name: '功能目录' }).waitFor({ state: 'detached' })
  })
} finally {
  const report = { startedAt: new Date().toISOString(), results, runtimeErrors, passed: results.filter((r) => r.status === 'passed').length, failed: results.filter((r) => r.status === 'failed').length }
  fs.writeFileSync(path.join(OUT, 'interaction-report.json'), JSON.stringify(report, null, 2))
  await browser.close()
  console.log(`REPORT ${path.join(OUT, 'interaction-report.json')}`)
}
