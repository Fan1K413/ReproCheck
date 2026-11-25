/* 针对全量巡检中 3 处启发式误判 + 双皮肤断言的聚焦复核（qa-verifier） */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const R = {}

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
async function goto(route, wait = 1400) {
  const resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(wait)
  return resp?.status()
}
async function clickText(text, exact = false) {
  const h = await page.evaluateHandle((t, e) => [...document.querySelectorAll('button,a,[role="tab"]')].find((x) => e ? x.textContent.trim() === t : x.textContent.includes(t)) || null, text, exact)
  const el = h.asElement(); if (!el) throw new Error('not found: ' + text); await el.click(); await sleep(500)
}

// 登录
await goto('/login', 1200)
await clickText('林晚晴'); await clickText('登录工作台', true)
await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
await sleep(1200)

// 1) '/' 工作台真实渲染（canvas + 9 入口 + 偏差波形）
await goto('/', 1600)
R.workbench = await page.evaluate(() => {
  const diff = document.querySelector('.rc-app--diff svg')
  return {
    path: location.pathname,
    canvasCount: document.querySelectorAll('canvas').length,
    entryButtons: document.querySelectorAll('[class*="rc-app-icon"]').length,
    diffPaths: diff ? diff.querySelectorAll('path').length : 0,
    rootChildren: document.getElementById('root')?.children.length ?? -1,
    textSample: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 120),
  }
})
R.workbench.pass = R.workbench.canvasCount > 0 && R.workbench.entryButtons >= 5 && R.workbench.diffPaths === 3

// 2) 登录页在「已登录」时重定向到工作台；独立无痕页能渲染登录表单
await goto('/login', 1400)
R.loginRedirect = await page.evaluate(() => ({ path: location.pathname, text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 80) }))
const incognito = await browser.createBrowserContext()
const p2 = await incognito.newPage()
await p2.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 })
await sleep(1400)
R.loginFresh = await p2.evaluate(() => ({
  hasLoginButton: [...document.querySelectorAll('button')].some((b) => b.textContent.includes('登录工作台')),
  hasDemoUser: document.body.innerText.includes('林晚晴'),
  textSample: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 150),
}))
R.loginFresh.pass = R.loginFresh.hasLoginButton && R.loginFresh.hasDemoUser
await incognito.close()

// 3) 双皮肤：页面级 data-rc-skin="light" + 计算背景色对比
await goto('/', 1300)
const dark = await page.evaluate(() => {
  const el = document.querySelector('main, #root > div') || document.body
  return { skin: document.querySelector('[data-rc-skin]')?.getAttribute('data-rc-skin') || null, bg: getComputedStyle(el).backgroundColor }
})
await goto('/orgs', 1400)
const light = await page.evaluate(() => {
  const el = document.querySelector('[data-rc-skin="light"]')
  const wrapper = el || document.querySelector('main, #root > div') || document.body
  return { skin: el?.getAttribute('data-rc-skin') || null, bg: getComputedStyle(wrapper).backgroundColor, cls: wrapper.className }
})
await goto(`/projects/${'proj-209c77cd39f94212'}/reproduction/reports`, 1500)
const archiveReport = await page.evaluate(() => ({ skin: document.querySelector('[data-rc-skin="light"]')?.getAttribute('data-rc-skin') || null }))
R.dualSkin = { dark, light, archiveReport, pass: dark.skin !== 'light' && light.skin === 'light' && archiveReport.skin === 'light' }

// 4) 反馈泳道真实名称与筛选（历史断言写错了泳道名）
await goto('/feedback', 1600)
const fb = await page.evaluate(() => {
  const txt = document.body.innerText.replace(/\s+/g, ' ')
  const lanes = ['待处理', '已分诊', '处理中', '已解决', ' disputed', '争议'].filter((l) => txt.includes(l.trim()))
  const heads = [...document.querySelectorAll('h2,h3,[class*="lane"]')].map((e) => e.textContent.trim()).filter((t) => t && t.length < 24).slice(0, 20)
  return { lanesFound: lanes, headSamples: heads, hasLaneHint: txt.includes('分诊泳道') }
})
const beforeFilter = await page.evaluate(() => document.body.innerText.includes('确认无误'))
try { await clickText('已分诊', true) } catch {}
const afterFilter = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 500))
R.feedbackLanes = { ...fb, beforeFilter, afterSample: afterFilter, pass: fb.lanesFound.length >= 2 && fb.hasLaneHint }

// 5) 304 是浏览器缓存命中（禁用缓存后应为 200），不是失败
await page.setCacheEnabled(false)
const s1 = await goto('/governance', 1000)
const s2 = await goto('/governance', 1000)
const s3 = await goto('/governance', 1000)
await page.setCacheEnabled(true)
R.cache304 = { codes: [s1, s2, s3], pass: [s1, s2, s3].every((c) => c === 200) }

// 6) 路由兜底：应重定向到 '/' 并渲染工作台
await goto('/__qa_nonexistent_route__', 1600)
R.fallback = await page.evaluate(() => ({
  path: location.pathname,
  canvas: document.querySelectorAll('canvas').length,
  entries: document.querySelectorAll('[class*="rc-app-icon"]').length,
}))
R.fallback.pass = R.fallback.path === '/' && R.fallback.canvas > 0 && R.fallback.entries >= 5

await browser.close()
fs.writeFileSync(path.join(OUT, 'v2-final-recheck.json'), JSON.stringify(R, null, 2), 'utf8')
console.log(JSON.stringify(R, null, 2))
