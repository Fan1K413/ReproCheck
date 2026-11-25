/* V3 NO LEGACY UI · 独立全站验收
 * 目的：用当前真实代码证明 40 条可访问路由均为原生 React/CSS/SVG/Canvas 界面。
 * 关键修正：/login 使用独立未登录上下文；其余业务路由使用真实登录态，不再复用旧验收脚本的错误口径。
 * 输出：../.screenshots/v3-final-report.json + 每路由桌面/移动截图。
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = process.env.VERIFY_EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const API = process.env.VERIFY_API || 'http://127.0.0.1:8000'
const OUT = path.resolve(process.env.VERIFY_OUT || '../.screenshots/v3-final')
fs.mkdirSync(OUT, { recursive: true })

const PID = process.env.VERIFY_PID || 'proj-209c77cd39f94212'
const CASE = process.env.VERIFY_CASE || 'case-c3d8a5d22038455c'
const MATERIAL = process.env.VERIFY_MATERIAL || 'mat-e305657ae1924224'
const EMAIL = process.env.VERIFY_EMAIL || 'lead@reprocheck.demo'
const PASSWORD = process.env.VERIFY_PASSWORD || 'ReproCheck#2026'
let PLAN = process.env.VERIFY_PLAN || 'plan-b4bbf8748a2d41'
let RUN = process.env.VERIFY_RUN || 'run-5acdb8cd27d946'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const report = {
  meta: { startedAt: new Date().toISOString(), base: BASE, api: API, pid: PID },
  login: null,
  drawer: null,
  routes: [],
  bloom: [],
  oldUiScan: null,
  interactions: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const context = browser.defaultBrowserContext()
const page = await context.newPage()
page.on('console', (message) => {
  if (message.type() === 'error') report.consoleErrors.push({ at: page.url(), text: message.text().slice(0, 500) })
})
page.on('pageerror', (error) => report.pageErrors.push({ at: page.url(), text: String(error).slice(0, 500) }))
page.on('requestfailed', (request) => {
  report.failedRequests.push({ at: page.url(), url: request.url(), error: request.failure()?.errorText })
})

function slug(name) {
  return name.replace(/[^0-9A-Za-z\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '')
}
async function goto(route, wait = 1050) {
  try {
    const response = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await sleep(wait)
    return { http: response?.status() ?? 0 }
  } catch (error) {
    return { http: 0, navError: String(error).slice(0, 300) }
  }
}
async function clickText(text, exact = false, targetPage = page) {
  const handle = await targetPage.evaluateHandle((needle, exactMatch) => {
    const elements = [...document.querySelectorAll('button, a, [role="tab"], [role="menuitem"]')]
    return elements.find((element) => {
      const value = (element.textContent || '').trim()
      return exactMatch ? value === needle : value.includes(needle)
    }) || null
  }, text, exact)
  const element = handle.asElement()
  if (!element) throw new Error(`click target not found: ${text}`)
  await element.click()
  await sleep(350)
}
async function inspect(name, route, viewport, expected = []) {
  await page.setViewport(viewport.size)
  const nav = await goto(route, viewport.wait ?? 1050)
  const dom = await page.evaluate(() => {
    const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
    const root = document.getElementById('root')
    const universe = document.querySelector('.rc-app-universe')
    const stage = document.querySelector('.rc-stage')
    const bloom = document.querySelector('.bloom-layout')
    const lightSkin = document.querySelector('[data-rc-skin="light"]')
    const images = [...document.querySelectorAll('img')].map((img) => ({ src: img.currentSrc || img.src, alt: img.alt }))
    const iframes = document.querySelectorAll('iframe').length
    const videos = document.querySelectorAll('video').length
    const canvases = document.querySelectorAll('canvas').length
    const buttons = [...document.querySelectorAll('button')].map((button) => ({
      text: (button.textContent || '').trim(),
      disabled: button.disabled,
      hasClick: button.onclick !== null || button.getAttribute('type') === 'submit',
    }))
    return {
      title: document.title,
      h1: document.querySelector('h1')?.textContent?.trim() || '',
      textLen: bodyText.length,
      textSample: bodyText.slice(0, 420),
      rendered: !!root && root.children.length > 0 && bodyText.length > 30,
      crash: /something went wrong|minified react error|unhandled runtime error|application error/i.test(bodyText),
      overflow: {
        hasOverflow: document.documentElement.scrollWidth > window.innerWidth + 2,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      },
      shell: {
        appUniverse: !!universe,
        workbenchStage: !!stage,
        bloomLayout: !!bloom,
        lightSkin: !!lightSkin,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        appBg: universe ? getComputedStyle(universe).backgroundColor : null,
      },
      nativeMedia: { images, iframes, videos, canvases },
      buttonCount: buttons.length,
      deadButtonCandidates: buttons.filter((button) => !button.hasClick && !button.disabled && !button.text).length,
    }
  })
  const fullText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim())
  const expectedMatched = expected.filter((item) => fullText.includes(item) || dom.textSample.includes(item))
  const screenshot = path.join(OUT, `${slug(name)}-${viewport.tag}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  const nativeOk = dom.nativeMedia.iframes === 0 && dom.nativeMedia.videos === 0 && dom.nativeMedia.images.length === 0
  return {
    name,
    route,
    viewport: viewport.tag,
    http: nav.http,
    navError: nav.navError || null,
    ...dom,
    expected,
    expectedMatched,
    expectedOk: expected.length === 0 || expectedMatched.length > 0,
    nativeOk,
    unifiedShell: dom.shell.appUniverse || dom.shell.workbenchStage || dom.shell.bloomLayout,
    noLightSkin: !dom.shell.lightSkin,
    screenshot: path.basename(screenshot),
  }
}

/* ---------- 登录页：独立未登录上下文 ---------- */
try {
  const loginContext = await browser.createBrowserContext()
  const loginPage = await loginContext.newPage()
  await loginPage.setViewport({ width: 1440, height: 900 })
  await loginPage.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(900)
  const before = await loginPage.evaluate(() => ({
    path: location.pathname,
    inputs: document.querySelectorAll('input').length,
    buttons: [...document.querySelectorAll('button')].map((button) => (button.textContent || '').trim()).filter(Boolean),
    svg: document.querySelectorAll('svg').length,
    images: document.querySelectorAll('img').length,
    text: document.body.innerText.replace(/\s+/g, ' ').trim().slice(0, 260),
  }))
  await loginPage.screenshot({ path: path.join(OUT, '00-login-desktop.png'), fullPage: true })
  await clickText('林晚晴', false, loginPage)
  await clickText('登录工作台', true, loginPage)
  await loginPage.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
  report.login = { ok: true, before, afterPath: loginPage.url() }
  await loginContext.close()
} catch (error) {
  report.login = { ok: false, error: String(error).slice(0, 500) }
}

/* ---------- 获取真实登录 token，并进入业务上下文 ---------- */
try {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  })
  const payload = await response.json()
  if (!response.ok || !payload?.data?.token) throw new Error(payload?.error?.message || `HTTP ${response.status}`)
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.evaluate((data) => {
    localStorage.setItem('rc_token', data.token)
    localStorage.setItem('rc_user', JSON.stringify(data.user))
  }, payload.data)
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(1200)
  report.meta.loginUser = payload.data.user.email
} catch (error) {
  report.meta.loginError = String(error).slice(0, 500)
}

/* ---------- 发现当前真实 plan / run ---------- */
try {
  await goto(`/projects/${PID}/reproduction`, 1400)
  const ids = await page.evaluate(() => ({
    plan: document.querySelector('a[href*="/reproductions/plans/"]')?.getAttribute('href')?.split('/').pop() || null,
    run: document.querySelector('a[href*="/reproductions/runs/"]')?.getAttribute('href')?.split('/').pop() || null,
  }))
  if (ids.plan) PLAN = ids.plan
  if (ids.run) RUN = ids.run
} catch { /* 使用兜底 ID */ }
report.meta.plan = PLAN
report.meta.run = RUN

const DESKTOP = { tag: 'desktop', size: { width: 1440, height: 900 }, wait: 1050 }
const MOBILE = { tag: 'mobile', size: { width: 390, height: 844 }, wait: 950 }
const ROUTES = [
  ['01-中央工作台', '/', ['ReproCheck', 'AUDIT WORKBENCH']],
  ['02-项目列表', '/projects', ['ResNet', PID]],
  ['03-新建项目', '/projects/new', ['项目名称', '创建项目']],
  ['04-Bloom项目工作台', `/projects/${PID}/workbench`, ['材料', '事实', '验证']],
  ['05-AI模型服务', '/settings/llm', ['模型', 'API']],
  ['06-模型管理中心', '/settings/models', ['我的模型', '默认模型']],
  ['07-审计演示', '/demo/audit', ['审计演示', '开始分析']],
  ['08-材料管理', `/projects/${PID}/materials`, ['paper_excerpt.md', 'resnet50_repro.ipynb']],
  ['09-材料详情', `/materials/${MATERIAL}`, ['paper_excerpt.md', '事实']],
  ['10-解析任务', `/projects/${PID}/tasks`, ['解析', '任务']],
  ['11-科研事实', `/projects/${PID}/facts`, ['learning_rate', 'batch_size']],
  ['12-证据图谱', `/projects/${PID}/evidence-graph`, ['证据', '材料', '事实']],
  ['13-解析概览', `/projects/${PID}/overview`, ['材料', '事实', '证据']],
  ['14-项目验证', `/projects/${PID}/verification`, ['验证', '证据']],
  ['15-交接包', `/projects/${PID}/handoff`, ['交接', '材料']],
  ['16-实验差异分析', `/projects/${PID}/experiments/diff`, ['差异', '偏差波形']],
  ['17-变化监控', `/projects/${PID}/change-monitor`, ['变化', '监控']],
  ['18-数据质量审计', `/projects/${PID}/data-audit`, ['结构', '字段']],
  ['19-统计审计', '/stats-audit', ['统计', '审计']],
  ['20-复现总览', `/projects/${PID}/reproduction`, ['复现', PLAN]],
  ['21-复现规划DAG', `/reproductions/plans/${PLAN}`, ['规划', PLAN]],
  ['22-复现环境', `/projects/${PID}/reproduction/environment`, ['依赖', '环境']],
  ['23-执行控制台', `/reproductions/runs/${RUN}`, [RUN, '日志', '运行']],
  ['24-结果对照', `/projects/${PID}/reproduction/comparison`, ['对照', '指标']],
  ['25-AI诊断', `/projects/${PID}/reproduction/diagnostics`, ['诊断', '风险']],
  ['26-报告中心', `/projects/${PID}/reproduction/reports`, ['报告', '章节']],
  ['27-组织与成员', '/orgs', ['林晚晴', '组织']],
  ['28-角色权限', '/roles', ['角色', '权限']],
  ['29-项目团队', `/projects/${PID}/team`, ['评论', '活动']],
  ['30-基准案例库', '/benchmark', ['ResNet', '案例']],
  ['31-案例详情', `/benchmark/${CASE}`, [CASE, '质量', '验证']],
  ['32-事实字段目录', '/fact-schema', ['字段', '学习率']],
  ['33-审计规则', '/rules', ['规则', '离线评估']],
  ['34-反馈治理', '/feedback', ['分诊', '反馈']],
  ['35-知识检索', '/knowledge', ['知识', '检索']],
  ['36-外部集成', '/integrations', ['集成', '仓库']],
  ['37-API令牌', '/api-tokens', ['令牌', '创建']],
  ['38-数据治理', '/governance', ['分类', '导出']],
  ['39-路由兜底', '/__v3_nonexistent__', ['ReproCheck', 'AUDIT WORKBENCH']],
]

console.log(`V3 巡检开始：${ROUTES.length} 条业务路由 + 独立登录页`)
for (const [name, route, expected] of ROUTES) {
  const desktop = await inspect(name, route, DESKTOP, expected)
  const mobile = await inspect(name, route, MOBILE, expected)
  const status = desktop.rendered && mobile.rendered && !desktop.crash && !mobile.crash && !desktop.overflow.hasOverflow && !mobile.overflow.hasOverflow && desktop.nativeOk && mobile.nativeOk && desktop.noLightSkin && mobile.noLightSkin
    ? 'PASS'
    : 'FAIL'
  report.routes.push({ name, route, status, desktop, mobile })
  console.log(`[${report.routes.length}/${ROUTES.length}] ${name}: ${status} D=${desktop.textLen}/${desktop.shell.appUniverse ? 'universe' : desktop.shell.workbenchStage ? 'stage' : desktop.shell.bloomLayout ? 'bloom' : 'other'} M=${mobile.textLen}`)
}

/* ---------- Bloom 三级视图 ---------- */
const BLOOM = [
  ['B1-绽放舞台', `/projects/${PID}/workbench`, ['.bloom-card', '材料']],
  ['B2-工坊', `/projects/${PID}/workbench?view=atelier`, ['工坊', '模块']],
  ['B3-证据织机', `/projects/${PID}/workbench?view=loom`, ['证据', '阶段']],
]
for (const [name, route, expected] of BLOOM) {
  const desktop = await inspect(name, route, DESKTOP, expected)
  const mobile = await inspect(name, route, MOBILE, expected)
  const status = desktop.rendered && mobile.rendered && desktop.nativeOk && mobile.nativeOk ? 'PASS' : 'FAIL'
  report.bloom.push({ name, route, status, desktop, mobile })
  console.log(`[${name}] ${status}`)
}

/* ---------- 真实交互：抽屉、项目关系、页面入口 ---------- */
try {
  await page.setViewport(DESKTOP.size)
  await goto('/orgs', 1100)
  const drawerBefore = await page.evaluate(() => !!document.querySelector('#rc-feature-drawer'))
  await page.click('[aria-label="打开功能目录"]')
  await sleep(300)
  await sleep(300)
  const drawerOpen = await page.evaluate(() => ({
    exists: !!document.querySelector('#rc-feature-drawer'),
    role: document.querySelector('#rc-feature-drawer')?.getAttribute('role'),
    modal: document.querySelector('#rc-feature-drawer')?.getAttribute('aria-modal'),
  }))
  await page.keyboard.press('Escape')
  await sleep(300)
  const drawerClosed = await page.evaluate(() => !!document.querySelector('#rc-feature-drawer'))
  report.drawer = { before: drawerBefore, open: drawerOpen, closed: !drawerClosed, pass: !drawerBefore && drawerOpen.exists && drawerOpen.role === 'dialog' && drawerOpen.modal === 'true' && !drawerClosed }
} catch (error) {
  report.drawer = { pass: false, error: String(error).slice(0, 500) }
}

try {
  await goto('/projects', 1200)
  const beforeText = await page.evaluate(() => document.body.innerText)
  const buttons = await page.$$('button')
  let target = null
  for (const button of buttons) {
    const text = await button.evaluate((node) => node.textContent || '')
    if (text.includes('展开关联')) { target = button; break }
  }
  if (!target) throw new Error('未找到“展开关联”按钮')
  await target.click()
  await sleep(650)
  const afterText = await page.evaluate(() => document.body.innerText)
  report.interactions.projectRelations = {
    pass: afterText.includes('关联关系') && afterText !== beforeText,
    beforeLength: beforeText.length,
    afterLength: afterText.length,
  }
} catch (error) {
  report.interactions.projectRelations = { pass: false, error: String(error).slice(0, 500) }
}

try {
  await goto(`/projects/${PID}/materials`, 1300)
  const before = await page.evaluate(() => document.body.innerText)
  const filter = await page.$('button[aria-pressed]')
  if (!filter) throw new Error('未找到筛选按钮')
  await filter.click()
  await sleep(500)
  const pressed = await filter.evaluate((node) => node.getAttribute('aria-pressed'))
  await filter.click()
  await sleep(350)
  const released = await filter.evaluate((node) => node.getAttribute('aria-pressed'))
  report.interactions.materialFilter = { pass: pressed === 'true' && released === 'false', before: before.length, pressed, released }
} catch (error) {
  report.interactions.materialFilter = { pass: false, error: String(error).slice(0, 500) }
}

/* ---------- 静态反截图扫描（运行产物 + 源码关键模式） ---------- */
try {
  const srcRoot = path.resolve('src')
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(full) : [full]
  })
  const files = walk(srcRoot).filter((file) => /\.(tsx|ts|css|html)$/.test(file))
  const risky = []
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8')
    const patterns = [
      { key: 'img', regex: /<img\b/g },
      { key: 'background-url', regex: /background(?:-image)?\s*:\s*[^;]*url\(/g },
      { key: 'data-image', regex: /data:image\//g },
      { key: 'iframe', regex: /<iframe\b/g },
      { key: 'video', regex: /<video\b/g },
    ]
    for (const pattern of patterns) {
      const matches = text.match(pattern.regex) || []
      if (matches.length > 0 && !file.endsWith('rc-unified.css')) {
        risky.push({ file: path.relative(srcRoot, file), pattern: pattern.key, count: matches.length })
      }
    }
  }
  report.oldUiScan = { filesScanned: files.length, risky, pass: risky.length === 0 }
} catch (error) {
  report.oldUiScan = { pass: false, error: String(error).slice(0, 500) }
}

report.meta.finishedAt = new Date().toISOString()
const routePass = report.routes.filter((route) => route.status === 'PASS').length
const bloomPass = report.bloom.filter((route) => route.status === 'PASS').length
report.summary = {
  businessRoutes: `${routePass}/${report.routes.length}`,
  bloomViews: `${bloomPass}/${report.bloom.length}`,
  login: report.login?.ok === true,
  drawer: report.drawer?.pass === true,
  oldUiScan: report.oldUiScan?.pass === true,
  consoleErrors: report.consoleErrors.length,
  pageErrors: report.pageErrors.length,
  failedRequests: report.failedRequests.length,
}
const reportPath = path.resolve('../.screenshots/v3-final-report.json')
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
await browser.close()
console.log(JSON.stringify(report.summary, null, 2))
console.log(`报告：${reportPath}`)
if (routePass !== report.routes.length || bloomPass !== report.bloom.length || !report.login?.ok || !report.oldUiScan?.pass || report.pageErrors.length > 0) {
  process.exitCode = 1
}
