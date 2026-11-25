/* 审计演示链路取证：在无 LLM Key 的情况下，确认后端如实返回 503 + 错误码，
 * 前端如实提示、不出现伪造的分析结果与方案 tab。有 Key 时本脚本可直接用于端到端验收。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
const captured = []
page.on('response', async (res) => {
  if (res.url().includes('/demo/audit')) {
    let body = null
    try {
      body = await res.text()
    } catch {
      body = '<unreadable>'
    }
    captured.push({ url: res.url(), status: res.status(), body: body.slice(0, 600) })
  }
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))

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
await sleep(800)

await page.goto(BASE + '/demo/audit', { waitUntil: 'domcontentloaded' })
await page.waitForSelector('.rc-l2-header', { timeout: 15000 }).catch(() => {})
await sleep(1500)

await page.screenshot({ path: path.join(OUT, 'final-demo-audit-idle.png') })

// 点击「开始分析」
const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('开始分析'))
  if (!btn) return false
  btn.click()
  return true
})
await sleep(400)
await page.screenshot({ path: path.join(OUT, 'final-demo-audit-loading.png') })

let settled = false
for (let i = 0; i < 40; i += 1) {
  await sleep(500)
  const done = await page.evaluate(() => {
    const busy = [...document.querySelectorAll('button')].some(
      (b) => b.disabled && b.textContent.includes('分析'),
    )
    return !busy
  })
  if (done && captured.length) {
    settled = true
    break
  }
}
await sleep(600)
await page.screenshot({ path: path.join(OUT, 'final-demo-audit-result.png') })

const ui = await page.evaluate(() => {
  const text = document.body.innerText
  const tabLike = [...document.querySelectorAll('[role="tab"], .rc-demo-scheme, button')]
    .map((el) => el.textContent.trim())
    .filter((t) => t.startsWith('方案'))
  return {
    hasSchemeTabs: tabLike.length,
    schemeTitles: tabLike.slice(0, 6),
    mentionsNotConfigured: /未配置|NOT_CONFIGURED|密钥/.test(text),
    toastText: [...document.querySelectorAll('[role="status"], .rc-toast, [data-sonner-toast]')]
      .map((el) => el.textContent.trim())
      .join(' | ')
      .slice(0, 300),
    resultBlocks: text.includes('结构化参数') || text.includes('参数一致性'),
  }
})

const out = { clicked, settled, captured, ui, errors }
fs.writeFileSync(path.join(OUT, 'final-demo-audit-check.json'), JSON.stringify(out, null, 2), 'utf8')
console.log(JSON.stringify(out, null, 2))
await browser.close()
