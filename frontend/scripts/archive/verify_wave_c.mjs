/**
 * Wave C 验收脚本：8 个验证交付与项目系页面的桌面/移动截图 + 控制台错误 + 横向溢出巡检。
 * 运行：node scripts/verify_wave_c.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
fs.mkdirSync(OUT, { recursive: true })

const PID = 'proj-209c77cd39f94212'
const ROUTES = [
  ['01-projects', '/projects'],
  ['02-project-new', '/projects/new'],
  ['03-verification', `/projects/${PID}/verification`],
  ['04-handoff', `/projects/${PID}/handoff`],
  ['05-experiment-diff', `/projects/${PID}/experiments/diff`],
  ['06-change-monitor', `/projects/${PID}/change-monitor`],
  ['07-data-audit', `/projects/${PID}/data-audit`],
  ['08-stats-audit', '/stats-audit'],
]

const report = { steps: [], consoleErrors: [], pageErrors: [] }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('console', (m) => {
  if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => report.pageErrors.push(String(e).slice(0, 300)))

async function step(name, fn) {
  try {
    await fn()
    report.steps.push({ name, ok: true })
  } catch (e) {
    report.steps.push({ name, ok: false, error: String(e).slice(0, 240) })
  }
}

async function clickText(text, exact = false) {
  const handle = await page.evaluateHandle(
    (t, ex) => {
      const els = [...document.querySelectorAll('button, a, [role="tab"]')]
      return (
        els.find((e) => {
          const s = (e.textContent || '').trim()
          return ex ? s === t : s.includes(t)
        }) || null
      )
    },
    text,
    exact,
  )
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(600)
}

async function goto(route, waitMs = 1600) {
  await page.goto(BASE + route, { waitUntil: 'networkidle2', timeout: 45000 })
  await sleep(waitMs)
}

async function overflowCheck(name) {
  const o = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
    bodySw: document.body.scrollWidth,
  }))
  if (o.sw > o.iw + 2 || o.bodySw > o.iw + 2) {
    report.steps.push({
      name: `overflow:${name}`,
      ok: false,
      error: JSON.stringify(o),
    })
  } else {
    report.steps.push({ name: `overflow:${name}`, ok: true })
  }
}

/* ---------- 登录 ---------- */
await step('login', async () => {
  await goto('/login', 1400)
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
  await sleep(1400)
})

/* ---------- 桌面 1440×900 ---------- */
for (const [name, route] of ROUTES) {
  await step(`desktop:${name}`, async () => {
    await page.setViewport({ width: 1440, height: 900 })
    await goto(route, 2200)
    await page.screenshot({ path: path.join(OUT, `v2-waveC-${name}-desktop.png`), fullPage: true })
    await overflowCheck(name)
  })
}

/* ---------- 移动 390×844 ---------- */
for (const [name, route] of ROUTES) {
  await step(`mobile:${name}`, async () => {
    await page.setViewport({ width: 390, height: 844 })
    await goto(route, 2000)
    await page.screenshot({ path: path.join(OUT, `v2-waveC-${name}-mobile.png`), fullPage: true })
    await overflowCheck(`m-${name}`)
  })
}

/* ---------- 关键交互 ---------- */
await step('interaction:projects-relation', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto('/projects', 2000)
  await clickText('展开关联')
  await sleep(2200)
  await page.screenshot({ path: path.join(OUT, 'v2-waveC-09-projects-relation.png'), fullPage: true })
})

await step('interaction:verification-verdict-focus', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto(`/projects/${PID}/verification`, 2200)
  await clickText('已验证')
  await sleep(900)
  await page.screenshot({
    path: path.join(OUT, 'v2-waveC-10-verification-focus.png'),
    fullPage: true,
  })
})

await step('interaction:data-audit-ribbon', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto(`/projects/${PID}/data-audit`, 2600)
  await page.screenshot({ path: path.join(OUT, 'v2-waveC-11-data-audit-ribbon.png'), fullPage: true })
})

await step('interaction:experiment-diff-run', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto(`/projects/${PID}/experiments/diff`, 2000)
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('.rc4-rail__item')].map((e) => e.textContent || ''),
  )
  if (ids.length < 2) throw new Error(`run options not found: ${JSON.stringify(ids)}`)
  await page.evaluate(() => {
    const items = [...document.querySelectorAll('.rc4-rail__item')]
    items[0]?.click()
    items[1]?.click()
  })
  await sleep(700)
  await clickText('生成差异报告')
  await page.waitForFunction(() => !!document.querySelector('.rc4-wave'), { timeout: 25000 })
  await sleep(2200)
  await page.screenshot({
    path: path.join(OUT, 'v2-waveC-12-experiment-diff-report.png'),
    fullPage: true,
  })
})

await step('interaction:stats-audit-run', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto('/stats-audit', 1800)
  await clickText('运行审计')
  await page.waitForFunction(() => !!document.querySelector('.rc4-table-wrap'), { timeout: 30000 })
  await sleep(2600)
  await page.screenshot({ path: path.join(OUT, 'v2-waveC-13-stats-audit-report.png'), fullPage: true })
  const hasTable = await page.evaluate(() => !!document.querySelector('.rc4-table-wrap'))
  if (!hasTable) throw new Error('stats table not rendered')
})

await step('interaction:project-new-draft', async () => {
  await page.setViewport({ width: 1440, height: 900 })
  await goto('/projects/new', 1400)

  // 1) 防抖写入 sessionStorage
  await page.type('#project-name', '草稿防抖验证项目')
  await page.type('#project-domain', '计算机视觉')
  await sleep(900)
  const saved = await page.evaluate(() =>
    window.sessionStorage.getItem('rc:project-new:draft:v1'),
  )
  if (!saved || !saved.includes('草稿防抖验证项目')) {
    throw new Error(`draft not persisted: ${JSON.stringify(saved)}`)
  }

  // 2) 清空表单 → 草稿应被清除（此时无未保存内容，可安全 reload）
  await page.evaluate(() => {
    for (const id of ['#project-name', '#project-domain']) {
      const el = document.querySelector(id)
      const proto = window.HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, '')
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
  })
  await sleep(800)
  const cleared = await page.evaluate(() =>
    window.sessionStorage.getItem('rc:project-new:draft:v1'),
  )
  if (cleared !== null) throw new Error(`draft should be cleared: ${JSON.stringify(cleared)}`)

  // 3) 预置草稿后刷新，验证恢复
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      'rc:project-new:draft:v1',
      JSON.stringify({
        fields: { name: '草稿防抖验证项目', domain: '计算机视觉' },
        savedAt: new Date().toISOString(),
      }),
    )
  })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 })
  await sleep(1600)
  const restored = await page.evaluate(() => {
    const el = document.querySelector('#project-name')
    return el ? el.value : null
  })
  if (restored !== '草稿防抖验证项目') {
    throw new Error(`draft not restored: ${JSON.stringify(restored)}`)
  }
  await page.screenshot({
    path: path.join(OUT, 'v2-waveC-14-project-new-draft.png'),
    fullPage: true,
  })
})

await browser.close()

fs.writeFileSync(
  path.join(OUT, 'v2-waveC-verify-report.json'),
  JSON.stringify(report, null, 2),
  'utf8',
)

const failed = report.steps.filter((s) => !s.ok)
console.log(JSON.stringify({ steps: report.steps.length, failed, consoleErrors: report.consoleErrors, pageErrors: report.pageErrors }, null, 2))
