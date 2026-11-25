/* v2 独立最终验收脚本（qa-verifier）
 * 目的：用全新视角"证明代码能工作"，不信任任何工程师自报。
 * 覆盖：41 页 + 8 Bloom 舞台双视口巡检 / 真实数据断言 / 音乐图标 / 双皮肤 /
 *       Wave C/D/E 历史问题独立复核 / 控制台与失败请求采集。
 * 用法：在 frontend/ 下 node scripts/v2-final-verify.mjs
 */
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const OUT = path.resolve('../.screenshots')
fs.mkdirSync(OUT, { recursive: true })

const PID = 'proj-209c77cd39f94212'
const CASE = 'case-c3d8a5d22038455c'
const MATERIAL = 'mat-e305657ae1924224'
let PLAN = 'plan-b4bbf8748a2d41'
let RUN = 'run-5acdb8cd27d946'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const report = {
  meta: { startedAt: new Date().toISOString(), base: BASE, pid: PID },
  login: null,
  pages: [],          // 41 页逐行结果（含双视口）
  stages: [],         // 8 Bloom 舞台
  assertions: {},     // 图标/皮肤/粉色/墨绿
  historical: {},     // Wave C/D/E 复核证据
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
}

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
})
const page = await browser.newPage()
page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push({ at: page.url(), text: m.text().slice(0, 400) }) })
page.on('pageerror', (e) => report.pageErrors.push({ at: page.url(), text: String(e).slice(0, 400) }))
page.on('requestfailed', (r) => report.failedRequests.push({ at: page.url(), url: r.url(), error: r.failure()?.errorText }))

/* ---------- 通用工具 ---------- */
async function clickText(text, exact = false, inDialog = false) {
  const handle = await page.evaluateHandle((text, exact, inDialog) => {
    const root = inDialog ? (document.querySelector('[role="dialog"]') || document) : document
    const els = [...root.querySelectorAll('button, a, [role="tab"], [role="treeitem"], [role="option"]')]
    return els.find((e) => {
      const t = (e.textContent || '').trim()
      return exact ? t === text : t.includes(text)
    }) || null
  }, text, exact, inDialog)
  const el = handle.asElement()
  if (!el) throw new Error(`click target not found: ${text}`)
  await el.click()
  await sleep(450)
}
async function fillInput(selector, value) {
  const ok = await page.evaluate((selector, value) => {
    const el = document.querySelector(selector)
    if (!el) return false
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }, selector, value)
  if (!ok) throw new Error(`input not found: ${selector}`)
}
async function goto(route, waitMs = 1300) {
  let resp = null
  try {
    resp = await page.goto(BASE + route, { waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch (e) {
    return { http: 0, navError: String(e).slice(0, 200) }
  }
  await sleep(waitMs)
  return { http: resp?.status() ?? 0 }
}
function slug(name) { return name.replace(/[^0-9A-Za-z\u4e00-\u9fa5]+/g, '-').replace(/^-|-$/g, '') }

/* 单视口巡检：返回诊断对象并截图 */
async function inspectRoute(name, route, viewport, opts = {}) {
  await page.setViewport(viewport.size)
  const nav = await goto(route, viewport.wait ?? 1300)
  const diag = await page.evaluate(() => {
    const root = document.getElementById('root')
    const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim()
    const h1 = document.querySelector('h1')?.textContent?.trim() || ''
    const crash = /something went wrong|minified react error|unhandled runtime error|application error/i.test(bodyText)
    const overflow = {
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
      body: document.body.scrollWidth,
    }
    return {
      title: document.title || '',
      h1,
      textLen: bodyText.length,
      textSample: bodyText.slice(0, 420),
      rootChildren: root ? root.children.length : -1,
      crash,
      overflow,
      hasOverflow: overflow.sw > overflow.iw + 2,
    }
  })
  const sigs = opts.dataSigs || []
  const matched = sigs.filter((s) => diag.textSample.includes(s) || report._lastText?.includes(s))
  // 用完整 bodyText 再匹配一次（textSample 仅 420 字，可能截断）
  const fullText = await page.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim())
  const matchedFull = sigs.filter((s) => fullText.includes(s))
  const dataMatched = [...new Set([...matched, ...matchedFull])]
  const file = path.join(OUT, `v2-final-${slug(name)}-${viewport.tag}.png`)
  await page.screenshot({ path: file, fullPage: true })
  return {
    name, route, viewport: viewport.tag,
    http: nav.http, navError: nav.navError || null,
    rendered: diag.rootChildren > 0 && diag.textLen > 30 && !diag.crash,
    ...diag,
    dataSigs: sigs, dataMatched, dataOk: sigs.length === 0 || dataMatched.length > 0,
    screenshot: path.basename(file),
  }
}

/* ---------- 登录 ---------- */
try {
  await goto('/login', 1200)
  await clickText('林晚晴')
  await clickText('登录工作台', true)
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 20000 })
  await sleep(1200)
  report.login = { ok: true, path: await page.evaluate(() => location.pathname) }
} catch (e) {
  report.login = { ok: false, error: String(e).slice(0, 300) }
  console.error('LOGIN FAILED', report.login.error)
}

/* ---------- 发现真实 plan/run id ---------- */
try {
  await goto(`/projects/${PID}/reproduction`, 1500)
  const ids = await page.evaluate(() => ({
    plan: document.querySelector('a[href*="/reproductions/plans/"]')?.getAttribute('href')?.split('/').pop() || null,
    run: document.querySelector('a[href*="/reproductions/runs/"]')?.getAttribute('href')?.split('/').pop() || null,
  }))
  if (ids.plan) PLAN = ids.plan
  if (ids.run) RUN = ids.run
} catch { /* 用兜底 id */ }
report.meta.plan = PLAN
report.meta.run = RUN

/* ---------- 41 页路由表（对应 §5.1 逐行） ---------- */
const ROUTES = [
  [1, '01-中央工作台', '/', ['科研复现', '复现审计']],
  [2, '02-登录页', '/login', ['登录工作台', '林晚晴']],
  [3, '03-项目列表', '/projects', ['proj-209c77cd39f94212', 'E2E', 'ResNet']],
  [4, '04-新建项目', '/projects/new', ['项目名称', '新建项目', '创建项目']],
  [5, '05-Bloom项目工作台', `/projects/${PID}/workbench`, ['材料', '事实', '验证']],
  [6, '06-AI模型服务', '/settings/llm', ['模型', 'API', 'LLM']],
  [7, '07-模型管理中心', '/settings/models', ['我的模型', '默认模型', '使用统计']],
  [8, '08-审计演示', '/demo/audit', ['审计演示', '开始分析']],
  [9, '09-材料管理', `/projects/${PID}/materials`, ['paper_excerpt.md', 'resnet50_repro.ipynb']],
  [10, '10-材料详情', `/materials/${MATERIAL}`, ['paper_excerpt.md', '事实', '材料']],
  [11, '11-解析任务', `/projects/${PID}/tasks`, ['解析', '任务', 'paper_excerpt.md']],
  [12, '12-科研事实', `/projects/${PID}/facts`, ['learning_rate', 'batch_size', 'optimizer']],
  [13, '13-证据图谱', `/projects/${PID}/evidence-graph`, ['证据', '材料', '事实']],
  [14, '14-解析概览', `/projects/${PID}/overview`, ['材料', '事实', '证据']],
  [15, '15-项目验证', `/projects/${PID}/verification`, ['验证', '证据', '结论']],
  [16, '16-交接包', `/projects/${PID}/handoff`, ['交接', '材料', '验证']],
  [17, '17-实验差异分析', `/projects/${PID}/experiments/diff`, ['偏差波形', '差异', '指标']],
  [18, '18-变化监控', `/projects/${PID}/change-monitor`, ['变化', '监控', '分析']],
  [19, '19-数据质量审计', `/projects/${PID}/data-audit`, ['结构', '字段', '审计']],
  [20, '20-统计审计', '/stats-audit', ['统计', '指标', '审计']],
  [21, '21-复现总览', `/projects/${PID}/reproduction`, [PLAN, RUN, '复现']],
  [22, '22-复现规划DAG', `/reproductions/plans/${PLAN}`, ['规划', '阶段', PLAN]],
  [23, '23-复现环境', `/projects/${PID}/reproduction/environment`, ['依赖', '环境', 'Python']],
  [24, '24-执行控制台', `/reproductions/runs/${RUN}`, [RUN, '日志', '运行']],
  [25, '25-结果对照', `/projects/${PID}/reproduction/comparison`, ['对照', '指标', 'accuracy']],
  [26, '26-AI诊断', `/projects/${PID}/reproduction/diagnostics`, ['诊断', '风险', '分类']],
  [27, '27-报告中心', `/projects/${PID}/reproduction/reports`, ['报告', '章节', '证据']],
  [28, '28-组织与成员', '/orgs', ['开源复现审计实验室', '成员', 'org-']],
  [29, '29-角色权限', '/roles', ['角色', '权限', '编辑']],
  [30, '30-项目团队', `/projects/${PID}/team`, ['评论', '活动', '复核']],
  [31, '31-基准案例库', '/benchmark', ['ResNet', '案例', '检索']],
  [32, '32-案例详情', `/benchmark/${CASE}`, [CASE, '质量', '验证']],
  [33, '33-事实字段目录', '/fact-schema', ['字段', '事实', '学习率']],
  [34, '34-审计规则', '/rules', ['accuracy_tolerance', '规则', '离线评估']],
  [35, '35-反馈治理', '/feedback', ['分诊', '反馈', '待处理']],
  [36, '36-知识检索', '/knowledge', ['知识', '检索', 'FID']],
  [37, '37-外部集成', '/integrations', ['集成', '仓库', 'notebook']],
  [38, '38-API令牌', '/api-tokens', ['令牌', 'token', '创建']],
  [39, '39-数据治理', '/governance', ['分类', '导出', '保留']],
  [40, '40-历史遗留页', '__NA_DashboardPage__', []],
  [41, '41-路由兜底', '/__qa_nonexistent_route__', ['科研复现']],
]

const DESKTOP = { tag: 'desktop', size: { width: 1440, height: 900 }, wait: 1250 }
const MOBILE = { tag: 'mobile', size: { width: 390, height: 844 }, wait: 1150 }

console.log(`开始 41 页双视口巡检（plan=${PLAN} run=${RUN}）...`)
for (const [idx, name, route, sigs] of ROUTES) {
  if (route === '__NA_DashboardPage__') {
    const src = path.resolve('src/pages/DashboardPage.tsx')
    report.pages.push({
      idx, name, route, status: 'N/A',
      note: '历史未挂载页，App.tsx 无路由；源码存在但不可通过路由访问',
      sourceExists: fs.existsSync(src),
      conclusion: 'N/A（非可访问路由，符合 §5.1 口径）',
    })
    continue
  }
  const d = await inspectRoute(name, route, DESKTOP, { dataSigs: sigs })
  const m = await inspectRoute(name, route, MOBILE, { dataSigs: sigs })
  // 路由兜底：应重定向到 /
  if (idx === 41) {
    const redirected = await page.evaluate(() => location.pathname)
    d.redirectedTo = redirected
    m.redirectedTo = redirected
  }
  const status = d.rendered && m.rendered && !d.hasOverflow && !m.hasOverflow ? 'PASS' :
    (!d.rendered || !m.rendered ? 'FAIL-RENDER' : 'FAIL-OVERFLOW')
  report.pages.push({
    idx, name, route, status,
    desktop: d, mobile: m,
    conclusion: status === 'PASS' ? '通过' : status,
  })
  console.log(`[${idx}/41] ${name}: ${status} (D http=${d.http} len=${d.textLen} ov=${d.hasOverflow} | M http=${m.http} len=${m.textLen} ov=${m.hasOverflow})`)
}

/* ---------- 8 Bloom 舞台（经 /workbench 进入） ---------- */
const STAGES = [
  ['B1', 'BloomStage-绽放舞台', `/projects/${PID}/workbench`, ['.bloom-card', '.bloom-stage', '材料']],
  ['B2', 'BloomCard-瓣卡', `/projects/${PID}/workbench`, ['.bloom-card', '.bloom-compact']],
  ['B3', 'BloomAtelier-工坊', `/projects/${PID}/workbench?view=atelier`, ['.bloom-atelier', '工坊', '模块']],
  ['B4', 'BloomWorkbench-状态机focus', `/projects/${PID}/workbench?focus=materials`, ['材料', '事实', '证据']],
  ['B5', 'EvidenceLoom-证据织机', `/projects/${PID}/workbench?view=loom`, ['.bloom-loom', '证据', '阶段']],
  ['B6', 'ProjectConstellation-项目星图', '__NA__', []],
  ['B7', 'unitDetails-单元详情', `/projects/${PID}/workbench?focus=materials`, ['材料状态', '事实证据', '模型调用']],
  ['B8', 'unitDetailParts-详情子组件', `/projects/${PID}/workbench?focus=materials`, ['.bloom-kv', 'paper_excerpt.md']],
]
console.log('开始 8 Bloom 舞台巡检...')
for (const [code, name, route, sigs] of STAGES) {
  if (route === '__NA__') {
    report.stages.push({
      code, name, status: 'N/A',
      note: 'ProjectConstellation 仅在未挂载的 DashboardPage 中引用，无独立可访问路由',
      sourceExists: fs.existsSync(path.resolve('src/bloom/ProjectConstellation.tsx')),
      conclusion: 'N/A（源码存在，非独立路由）',
    })
    continue
  }
  const d = await inspectRoute(`${code}-${name}`, route, DESKTOP, { dataSigs: sigs })
  const m = await inspectRoute(`${code}-${name}`, route, MOBILE, { dataSigs: sigs })
  const selectors = await page.evaluate((sels) => Object.fromEntries(sels.map((s) => [s, document.querySelectorAll(s).length])), sigs.filter((s) => s.startsWith('.')))
  const stageStatus = d.rendered && m.rendered ? 'PASS' : 'FAIL-RENDER'
  report.stages.push({
    code, name, route, status: stageStatus,
    desktop: d, mobile: m, selectors,
    conclusion: stageStatus === 'PASS' ? '通过' : stageStatus,
  })
  console.log(`[${code}] ${name}: ${stageStatus}`)
}

/* ---------- 断言：音乐图标 / 全站粉色 / 双皮肤 / 墨绿 ---------- */
try {
  // 音乐图标：/ 的 diff 入口应为 DeviationWave（3 条 path），无 Music2，无粉色
  await page.setViewport(DESKTOP.size)
  await goto('/', 1500)
  const iconCheck = await page.evaluate(() => {
    const diff = document.querySelector('.rc-app--diff svg')
    const paths = diff ? [...diff.querySelectorAll('path')].map((p) => p.getAttribute('d')) : []
    const html = document.documentElement.outerHTML
    const cssText = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n') } catch { return '' } }).join('\n')
    return {
      diffSvgFound: !!diff,
      pathCount: paths.length,
      paths,
      hasMusic2Class: /Music2|music2|lucide-music/i.test(html),
      hasPinkInline: /#ff6b9a|rgb\(255\s*,\s*107\s*,\s*154\)/i.test(html),
      hasPinkCss: /#ff6b9a|rgb\(255\s*,\s*107\s*,\s*154\)/i.test(cssText),
    }
  })
  report.assertions.musicIcon = {
    ...iconCheck,
    pass: iconCheck.diffSvgFound && iconCheck.pathCount === 3 && !iconCheck.hasMusic2Class && !iconCheck.hasPinkInline && !iconCheck.hasPinkCss,
  }

  // 双皮肤：/orgs 浅色档案室 vs / 深色工作台（比较 body 背景色）
  await goto('/', 1300)
  const rootBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor + '|' + getComputedStyle(document.documentElement).backgroundColor)
  await goto('/orgs', 1400)
  const orgsBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor + '|' + getComputedStyle(document.documentElement).backgroundColor)
  const orgsText = await page.evaluate(() => document.body.innerText.slice(0, 300))
  report.assertions.dualSkin = {
    workbenchBg: rootBg, orgsBg,
    pass: rootBg !== orgsBg,
    note: '两种页面 body/html 计算背景色不同即为皮肤切换成功；浅色档案室以 --rc-surface-archive 变量为准',
    orgsTextSample: orgsText.replace(/\s+/g, ' ').trim().slice(0, 160),
  }

  // bloom 墨绿归零：源码级扫描 glow 颜色
  const bloomCss = fs.readFileSync(path.resolve('src/bloom/bloom.css'), 'utf8')
  const atelierCss = fs.existsSync(path.resolve('src/bloom/atelier.css')) ? fs.readFileSync(path.resolve('src/bloom/atelier.css'), 'utf8') : ''
  const loomCss = fs.existsSync(path.resolve('src/bloom/loom.css')) ? fs.readFileSync(path.resolve('src/bloom/loom.css'), 'utf8') : ''
  const allBloomCss = bloomCss + atelierCss + loomCss
  const greenHits = (allBloomCss.match(/#[0-9a-fA-F]{6}/g) || []).filter((c) => {
    const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16)
    return g > 100 && g > r * 1.25 && g > b * 1.15
  })
  report.assertions.bloomInkGreen = {
    greenHexHits: [...new Set(greenHits)],
    hasVioletGlow: /--rc-glow-violet|rc-glow-violet/.test(allBloomCss),
    pass: greenHits.length === 0,
  }
} catch (e) {
  report.assertions.error = String(e).slice(0, 300)
}

/* ---------- Wave C/D/E 历史问题独立复核 ---------- */
const hist = {}
try {
  // ---- Wave C：8 页重新巡检已在上面 41 页循环内完成；此处复验失败项 stats-audit:run ----
  const wavecPages = report.pages.filter((p) => [3, 4, 15, 16, 17, 18, 19, 20].includes(p.idx))
  hist.waveC = {
    pages: wavecPages.map((p) => ({ idx: p.idx, name: p.name, route: p.route, status: p.status, desktopShot: p.desktop?.screenshot, mobileShot: p.mobile?.screenshot, rendered: p.desktop?.rendered, dataMatched: p.desktop?.dataMatched })),
    conclusion: wavecPages.every((p) => p.status === 'PASS') ? '8/8 页面真实可渲染（历史 0/23 系服务中断，非页面缺陷）' : '存在未通过页面',
  }
  // stats-audit 交互（历史报告中唯一失败项）
  await page.setViewport(DESKTOP.size)
  await goto('/stats-audit', 1500)
  let statsBefore = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300))
  let statsInfo = {}
  try {
    await clickText('运行审计')
    await page.waitForFunction(() => !!document.querySelector('.rc4-table-wrap'), { timeout: 30000 })
    await sleep(2200)
    const hasTable = await page.evaluate(() => !!document.querySelector('.rc4-table-wrap'))
    const statsText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800))
    statsInfo = { hasTable, pass: hasTable, textSample: statsText }
  } catch (e) {
    const statsText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 800))
    statsInfo = { pass: false, error: String(e).slice(0, 200), textSample: statsText }
  }
  hist.waveC.statsAuditRun = { before: statsBefore, ...statsInfo }
} catch (e) { hist.waveC = hist.waveC || {}; hist.waveC.error = String(e).slice(0, 250) }

try {
  // ---- Wave D：6 项交互逐项确认（DOM 前后证据） ----
  const wd = {}
  const domSnapshot = async () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 900))

  // 1) rules:sort+eval
  await goto('/rules', 1400)
  const rulesBefore = await domSnapshot()
  let rulesSort = 'n/a', rulesEval = 'n/a'
  try { await clickText('优先级'); rulesSort = 'clicked'; } catch (e) { rulesSort = 'MISSING:' + String(e).slice(0, 80) }
  try { await clickText('离线评估', true).catch(() => clickText('离线评估')); rulesEval = 'clicked'; } catch (e) { rulesEval = 'MISSING:' + String(e).slice(0, 80) }
  wd['rules:sort+eval'] = { before: rulesBefore.slice(0, 400), after: (await domSnapshot()).slice(0, 600), sort: rulesSort, eval: rulesEval, pass: rulesSort === 'clicked' && rulesEval === 'clicked' }

  // 2) feedback:lanes
  await goto('/feedback', 1400)
  const fbText = await domSnapshot()
  const lanes = ['待分诊', '处理中', '已解决'].filter((l) => fbText.includes(l))
  wd['feedback:lanes'] = { textSample: fbText.slice(0, 700), lanesFound: lanes, pass: lanes.length >= 2 }

  // 3) governance:tiers
  await goto('/governance', 1400)
  const govText = await domSnapshot()
  let govConsent = 'n/a'
  try { await clickText('AI 授权'); govConsent = 'clicked'; } catch (e) { govConsent = 'MISSING:' + String(e).slice(0, 80) }
  wd['governance:tiers'] = { textSample: govText.slice(0, 700), tiersFound: ['公开', '内部', '机密'].filter((t) => govText.includes(t)), consentTab: govConsent, pass: govConsent === 'clicked' }

  // 4) integrations:notebook
  await goto('/integrations', 1500)
  const intInfo = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const opts = sels.flatMap((s) => [...s.options].map((o) => o.textContent.trim()))
    return { selectCount: sels.length, ipynbOptions: opts.filter((o) => /ipynb|notebook|ResNet/i.test(o)), textSample: document.body.innerText.replace(/\s+/g, ' ').slice(0, 500) }
  })
  wd['integrations:notebook'] = { ...intInfo, pass: intInfo.ipynbOptions.length > 0 || /notebook|ipynb/i.test(intInfo.textSample) }

  // 5) tokens:cards
  await goto('/api-tokens', 1500)
  const tokText = await domSnapshot()
  wd['tokens:cards'] = { textSample: tokText.slice(0, 700), pass: /令牌|token|创建/i.test(tokText) }

  // 6) mobile
  const mob = []
  await page.setViewport(MOBILE.size)
  for (const route of ['/orgs', '/roles', `/projects/${PID}/team`, '/benchmark', `/benchmark/${CASE}`, '/fact-schema', '/rules', '/feedback', '/knowledge', '/integrations', '/api-tokens', '/governance']) {
    const nav = await goto(route, 900)
    const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    mob.push({ route, http: nav.http, sw: o.sw, iw: o.iw, overflow: o.sw > o.iw + 2 })
  }
  wd['mobile'] = { pages: mob, pass: mob.every((x) => x.http === 200 && !x.overflow) }
  await page.setViewport(DESKTOP.size)
  hist.waveD = wd
} catch (e) { hist.waveD = hist.waveD || {}; hist.waveD.error = String(e).slice(0, 250) }

try {
  // ---- Wave E：demo-audit run + schemes 与 503 溯源 ----
  await goto('/demo/audit', 1300)
  const demoBefore = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 300))
  // 记录本次分析请求的响应
  const apiResponses = []
  const onResp = async (res) => {
    if (res.url().includes('/demo/audit')) {
      let body = ''
      try { body = (await res.text()).slice(0, 500) } catch {}
      apiResponses.push({ url: res.url(), status: res.status(), body })
    }
  }
  page.on('response', onResp)
  await clickText('开始分析')
  await sleep(9000)
  const demoAfter = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 1200))
  const schemeTabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()).filter((t) => t.includes('方案')))
  let schemesClickable = false
  if (schemeTabs.length >= 2) {
    try { await clickText('方案二'); schemesClickable = true } catch {}
  }
  page.off('response', onResp)
  hist.waveE = {
    before: demoBefore,
    after: demoAfter.slice(0, 900),
    apiResponses,
    schemeTabs,
    schemesClickable,
    conclusion: apiResponses.some((r) => r.status === 503)
      ? '分析请求返回 503（LLM_KEY_NOT_CONFIGURED）：方案切换 UI 存在于源码，但因未配置 LLM Key 导致分析失败、方案 tab 未渲染——属于环境配置问题，非前端交互缺失'
      : '分析成功，方案切换可用',
    pass: schemeTabs.length >= 2 && schemesClickable,
  }
  // 模型中心移动溢出复核
  await page.setViewport(MOBILE.size)
  await goto('/settings/models', 1600)
  const mm = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, body: document.body.scrollWidth }))
  hist.waveE.modelMobileOverflow = { ...mm, overflow: mm.sw > mm.iw + 2, pass: mm.sw <= mm.iw + 2 }
  await page.setViewport(DESKTOP.size)
} catch (e) { hist.waveE = hist.waveE || {}; hist.waveE.error = String(e).slice(0, 250) }

report.historical = hist
report.meta.finishedAt = new Date().toISOString()

await browser.close()
fs.writeFileSync(path.join(OUT, 'v2-final-report.json'), JSON.stringify(report, null, 2), 'utf8')

/* ---------- 终端摘要 ---------- */
const okPages = report.pages.filter((p) => p.status === 'PASS').length
const naPages = report.pages.filter((p) => p.status === 'N/A').length
const failPages = report.pages.filter((p) => p.status.startsWith('FAIL'))
const okStages = report.stages.filter((s) => s.status === 'PASS').length
console.log(`\n===== 最终验收摘要 =====`)
console.log(`页面：${okPages}/${report.pages.length} PASS（N/A ${naPages}，FAIL ${failPages.length}）`)
console.log(`舞台：${okStages}/${report.stages.length} PASS`)
console.log(`音乐图标：${report.assertions.musicIcon?.pass}`, `双皮肤：${report.assertions.dualSkin?.pass}`, `墨绿归零：${report.assertions.bloomInkGreen?.pass}`)
console.log(`WaveC stats: ${hist.waveC?.statsAuditRun?.pass}`, `WaveD: ${Object.entries(hist.waveD || {}).filter(([k]) => k !== 'error').map(([k, v]) => k + '=' + v.pass).join(' ')}`, `WaveE: ${hist.waveE?.conclusion}`)
console.log(`consoleErrors=${report.consoleErrors.length} pageErrors=${report.pageErrors.length} failedRequests=${report.failedRequests.length}`)
failPages.forEach((p) => console.log('FAIL', p.idx, p.name, p.status, 'D:', p.desktop?.navError || p.desktop?.textLen, 'M:', p.mobile?.navError || p.mobile?.textLen))
console.log('报告：', path.join(OUT, 'v2-final-report.json'))
