/* 第二轮真实浏览器验收：五步 API 向导、四步引导、首次/返回入口、帮助抽屉、窄屏、旧路由回归。 */
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = 'http://127.0.0.1:5174'
const API = 'http://127.0.0.1:8001/api/v1'
const OUT = path.resolve('../.screenshots/usability/round2')
fs.mkdirSync(OUT, { recursive: true })

const auth = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'lead@reprocheck.demo', password: 'ReproCheck#2026' }),
})).json()
const token = auth?.data?.token || auth?.data?.access_token
const user = auth?.data?.user
if (!token) throw new Error('login failed ' + JSON.stringify(auth))
const headers = { Authorization: `Bearer ${token}` }
const projects = await (await fetch(`${API}/projects`, { headers })).json()
const project = projects?.data?.items?.[0]
if (!project) throw new Error('no project')
const materials = await (await fetch(`${API}/materials?project_id=${project.id}`, { headers })).json()

const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox'] })
const errors = []
const unexpectedResponses = []
const apiCalls = []
const report = []
const repoCreated = []

async function makePage(viewport = { width: 1440, height: 900 }, onboarding = 'done') {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.addInitScript(([t, u, o]) => {
    localStorage.setItem('rc_token', t)
    localStorage.setItem('rc_user', JSON.stringify(u))
    if (o) localStorage.setItem('rc:onboarding:v1', o)
    else localStorage.removeItem('rc:onboarding:v1')
  }, [token, user, onboarding])
  page.on('pageerror', (e) => errors.push(`${page.url()} :: ${String(e)}`))
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) errors.push(`${page.url()} :: console: ${msg.text()}`)
  })
  page.on('response', (response) => {
    const url = response.url()
    if (response.status() >= 400 && !url.includes('/model-credentials/test-draft')) {
      unexpectedResponses.push(`${response.status()} ${url}`)
    }
    if (url.includes('/api/v1/')) {
      apiCalls.push({ method: response.request().method(), status: response.status(), url: url.replace(API, '/api/v1') })
    }
  })
  return { context, page }
}

function add(name, data) { report.push({ name, ...data }) }

async function overflow(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    documentOverflow: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    bodyOverflow: Math.max(0, document.body.scrollWidth - window.innerWidth),
  }))
}

// 1. 首次进入：不显示图标墙，先看到任务式介绍与目标。
{
  const { context, page } = await makePage({ width: 1440, height: 900 }, null)
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(500)
  const welcome = await page.locator('h1').first().innerText()
  const iconWallCount = await page.locator('.rc-entry').count()
  await page.screenshot({ path: path.join(OUT, '01-onboarding-welcome-1440.png') })
  await page.getByRole('button', { name: /下一步：选择我想做的事/ }).click()
  await page.waitForTimeout(250)
  const goals = await page.locator('h1').first().innerText()
  await page.screenshot({ path: path.join(OUT, '02-onboarding-goals-1440.png') })
  await page.getByRole('button', { name: /我想复现一篇论文/ }).click()
  await page.waitForTimeout(900)
  const afterGoal = page.url()
  const pickerHeading = await page.locator('h1').first().innerText().catch(() => '')
  add('onboarding', { welcome, iconWallCount, goals, afterGoal, pickerHeading, onboardingState: await page.evaluate(() => localStorage.getItem('rc:onboarding:v1')) })
  await context.close()
}

// 2. 跳过引导 → 回到径向工作台；刷新后不再强制引导。
{
  const { context, page } = await makePage({ width: 1440, height: 900 }, null)
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /先跳过，直接进入工作台/ }).click()
  await page.waitForTimeout(700)
  const entries = await page.locator('.rc-entry').count()
  const utility = await page.locator('.rc-utility-bar').innerText().catch(() => '')
  const stateAfterSkip = await page.evaluate(() => localStorage.getItem('rc:onboarding:v1'))
  // 原 context 的 init script 每次导航都会清空 onboarding，这里补一条仅用于“刷新后仍在工作台”的持久化断言。
  await page.addInitScript(() => localStorage.setItem('rc:onboarding:v1', 'skipped'))
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(700)
  const entriesAfterReload = await page.locator('.rc-entry').count()
  await page.screenshot({ path: path.join(OUT, '03-workbench-done-1440.png') })
  add('skip-workbench', { entries, utility, stateAfterSkip, entriesAfterReload })
  await context.close()
}

// 3. 返回用户：保留径向工作台；顶栏可重开“我想做什么”，且直接到目标页而非介绍页。
{
  const { context, page } = await makePage()
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /我想做什么/ }).click()
  await page.waitForTimeout(250)
  const h1 = await page.locator('h1').first().innerText()
  const hasWelcomeButton = await page.getByRole('button', { name: /下一步：选择我想做的事/ }).count()
  const navLink = await page.locator('a[href="/manual"]').count()
  add('reopen-guide', { h1, hasWelcomeButton, manualLinks: navLink })
  await page.getByRole('button', { name: /先跳过，直接进入工作台/ }).click()
  await page.waitForTimeout(500)
  // 花瓣回归：打开第一个入口 → ESC 关闭。
  await page.locator('.rc-entry').first().click()
  await page.waitForTimeout(500)
  const petalsOpen = await page.locator('.rc-petal-stage').isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, '04-workbench-petals-1440.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(350)
  const petalsClosed = await page.locator('.rc-petal-stage').count() === 0
  // 工作台内帮助抽屉：ESC 关闭并回焦触发按钮。
  const helpBtn = page.getByRole('button', { name: /打开.*使用帮助/ }).first()
  await helpBtn.click()
  await page.waitForTimeout(250)
  const helpVisible = await page.locator('.ux-help-drawer').isVisible().catch(() => false)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const helpClosed = await page.locator('.ux-help-drawer').count() === 0
  const focusReturned = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'dialog')
  add('workbench-regression', { petalsOpen, petalsClosed, helpVisible, helpClosed, focusReturned })
  await context.close()
}

// 4. 四步引导：项目选择、代码仓库真实登记 → 第 4 步真实就绪。
{
  const { context, page } = await makePage()
  const uniqueName = `自动验收仓库-${Date.now()}`
  await page.goto(`${BASE}/start/reproduce`, { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const picker = await page.locator('h1').first().innerText()
  const projectsShown = await page.locator('.ux-guided-project').count()
  await page.getByRole('button', { name: /新建一个项目/ }).click()
  const createFormVisible = await page.locator('input[placeholder*="ResNet"]').isVisible().catch(() => false)
  await page.screenshot({ path: path.join(OUT, '05-guided-project-picker-1440.png') })
  await page.locator('.ux-guided-project').first().click()
  await page.waitForTimeout(700)
  await page.goto(`${BASE}/start/reproduce?project=${project.id}&step=3`, { waitUntil: 'load' })
  await page.waitForTimeout(700)
  await page.locator('input[placeholder*="github.com"]').fill('https://github.com/octocat/Hello-World')
  await page.locator('input[placeholder*="作者官方实现"]').fill(uniqueName)
  await page.screenshot({ path: path.join(OUT, '06-guided-repo-step3-1440.png') })
  const responsePromise = page.waitForResponse((r) => r.url().includes('/materials/link-repository'))
  await page.getByRole('button', { name: /登记仓库地址/ }).click()
  const linkResponse = await responsePromise
  const linkJson = await linkResponse.json().catch(() => null)
  if (linkJson?.data?.material_id) repoCreated.push(linkJson.data.material_id)
  await page.waitForTimeout(900)
  const step4 = await page.locator('h1').first().innerText()
  const realReady = await page.locator('.ux-guided-card--ready').innerText().catch(() => '')
  await page.screenshot({ path: path.join(OUT, '07-guided-ready-step4-1440.png') })
  const aiOptional = await page.locator('.ux-ai-optional').innerText().catch(() => '')
  add('guided-flow', { picker, projectsShown, createFormVisible, linkStatus: linkResponse.status(), step4, readyExcerpt: realReady.slice(0, 500), aiOptional })
  // 材料页应显示“打开仓库”，不能显示“解析”。
  await page.goto(`${BASE}/projects/${project.id}/materials`, { waitUntil: 'load' })
  await page.waitForTimeout(800)
  const repoCard = page.locator('.mb-stack__card', { hasText: uniqueName }).first()
  await repoCard.click()
  await page.waitForTimeout(300)
  const drawer = page.locator('#mb-material-detail')
  const repoText = await drawer.innerText().catch(() => '')
  const openRepo = await drawer.getByRole('link', { name: /打开仓库/ }).count().catch(() => 0)
  const parseRepo = await drawer.getByRole('button', { name: /^解析$/ }).count().catch(() => 0)
  await page.screenshot({ path: path.join(OUT, '08-material-repository-1440.png') })
  add('repository-material', { repoText: repoText.slice(0, 300), openRepo, parseRepo })
  await page.screenshot({ path: path.join(OUT, '08-material-repository-1440.png') })
}

// 5. API 五步向导：真实 invalid-key 调用，验证第 4 步失败提示、不能保存、可回退。
{
  const { context, page } = await makePage()
  await page.goto(BASE + '/settings/models?tab=setup', { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const step1 = await page.locator('.ux-model-panel h3').first().innerText()
  await page.locator('.ux-provider-card', { hasText: 'DeepSeek' }).first().click()
  await page.waitForTimeout(250)
  const step2 = await page.locator('.ux-model-panel h3').first().innerText()
  // 空密钥校验：停在第 2 步并给中文提示。
  await page.getByRole('button', { name: /下一步：选择模型/ }).click()
  const keyError = await page.locator('.ux-callout--danger').innerText().catch(() => '')
  await page.locator('input[type="password"]').fill('sk-invalid-usability-test-not-a-real-key')
  await page.screenshot({ path: path.join(OUT, '09-api-step2-key-1440.png') })
  await page.getByRole('button', { name: /下一步：选择模型/ }).click()
  await page.waitForTimeout(250)
  const step3 = await page.locator('.ux-model-panel h3').first().innerText()
  const modelOptions = await page.locator('.ux-model-option').count()
  await page.screenshot({ path: path.join(OUT, '10-api-step3-model-1440.png') })
  await page.getByRole('button', { name: /下一步：测试连接/ }).click()
  await page.waitForTimeout(250)
  const step4 = await page.locator('.ux-model-panel h3').first().innerText()
  const testRequest = page.waitForResponse((r) => r.url().includes('/model-credentials/test-draft'))
  await page.getByRole('button', { name: /开始真实测试/ }).click()
  const testResponse = await testRequest
  const testStatus = testResponse.status()
  const testJson = await testResponse.json().catch(() => null)
  await page.waitForTimeout(700)
  const failureText = await page.locator('.ux-test-result').innerText().catch(() => '')
  const canSave = await page.getByRole('button', { name: /保存为默认 AI 助手/ }).count()
  await page.screenshot({ path: path.join(OUT, '11-api-step4-real-failure-1440.png') })
  add('api-five-steps', {
    step1, step2, step3, step4, keyError, modelOptions,
    testHttpStatus: testStatus, testResult: testJson?.data,
    failureText: failureText.slice(0, 500), canSave,
  })
  // 回退：失败后只能改模型/密钥，不能越过测试保存。
  await page.getByRole('button', { name: /修改模型/ }).click()
  await page.waitForTimeout(200)
  const stepBack = await page.locator('.ux-model-panel h3').first().innerText()
  add('api-backtrack', { stepBack, canSaveAfterBack: await page.getByRole('button', { name: /保存为默认 AI 助手/ }).count() })
  await context.close()
}

// 6. 手册：11 章、筛选、真实搜索状态说明。
{
  const { context, page } = await makePage()
  await page.goto(BASE + '/manual', { waitUntil: 'load' })
  await page.waitForTimeout(500)
  const h1 = await page.locator('h1').first().innerText()
  const sections = await page.locator('.ux-manual-section').count()
  const tocBefore = await page.locator('.ux-manual-toc nav a').count()
  await page.locator('.ux-manual-search input').fill('报告')
  await page.waitForTimeout(200)
  const tocAfter = await page.locator('.ux-manual-toc nav a').count()
  const filterNote = await page.locator('.ux-manual-filter').innerText().catch(() => '')
  await page.locator('.ux-manual-search input').fill('')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(OUT, '12-manual-1440.png') })
  add('manual', { h1, sections, tocBefore, tocAfter, filterNote })
  await context.close()
}

// 7. 帮助抽屉 390：打开、ESC、回焦。
{
  const { context, page } = await makePage({ width: 390, height: 844 })
  await page.goto(`${BASE}/projects/${project.id}/materials`, { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const trigger = page.getByRole('button', { name: /打开.*使用帮助/ }).first()
  await trigger.click()
  await page.waitForTimeout(300)
  const drawerTitle = await page.locator('.ux-help-drawer h2').innerText()
  await page.screenshot({ path: path.join(OUT, '13-help-drawer-390.png') })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(250)
  const closed = await page.locator('.ux-help-drawer').count() === 0
  const focusReturned = await page.evaluate(() => document.activeElement?.getAttribute('aria-haspopup') === 'dialog')
  add('help-390', { drawerTitle, closed, focusReturned, overflow: await overflow(page) })
  await context.close()
}

// 8. 390 / 768 / 1920 多分辨率布局与横向溢出。
{
  const sizes = [[390, 844], [768, 1024], [1920, 1080]]
  for (const [width, height] of sizes) {
    const { context, page } = await makePage({ width, height })
    const pages = [
      ['workbench', '/'],
      ['guided', `/start/reproduce?project=${project.id}&step=4`],
      ['api', '/settings/models?tab=setup'],
      ['manual', '/manual'],
    ]
    for (const [name, url] of pages) {
      await page.goto(BASE + url, { waitUntil: 'load' })
      await page.waitForTimeout(650)
      const layout = await overflow(page)
      const heading = await page.locator('h1').first().innerText().catch(() => '')
      await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`) })
      add(`layout-${name}-${width}`, { heading, ...layout })
    }
    await context.close()
  }
}

// 9. 旧核心路由回归：页面能渲染、无脚本错误、无意外 4xx/5xx。
{
  const { context, page } = await makePage()
  const routes = [
    ['projects', '/projects'],
    ['project-workbench', `/projects/${project.id}/workbench`],
    ['materials', `/projects/${project.id}/materials`],
    ['tasks', `/projects/${project.id}/tasks`],
    ['facts', `/projects/${project.id}/facts`],
    ['overview', `/projects/${project.id}/overview`],
    ['reproduction', `/projects/${project.id}/reproduction`],
    ['comparison', `/projects/${project.id}/reproduction/comparison`],
    ['reports', `/projects/${project.id}/reproduction/reports`],
    ['llm-status', '/settings/llm'],
    ['demo', '/demo/audit'],
    ['knowledge', '/knowledge'],
  ]
  const routeResults = []
  for (const [name, url] of routes) {
    await page.goto(BASE + url, { waitUntil: 'load' })
    await page.waitForTimeout(600)
    routeResults.push({
      name, url,
      h1: await page.locator('h1').first().innerText().catch(() => ''),
      bodyChars: (await page.locator('body').innerText().catch(() => '')).length,
      nextStep: await page.locator('.ux-next-step').innerText().catch(() => '').then((t) => t.slice(0, 160)),
      helpButton: await page.getByRole('button', { name: /打开.*使用帮助/ }).count(),
      layout: await overflow(page),
    })
  }
  add('route-regression', { routeResults })
  await context.close()
}

// 清理测试仓库登记，避免污染用户项目。
for (const id of repoCreated) {
  const res = await fetch(`${API}/materials/${id}`, { method: 'DELETE', headers })
  const body = await res.json().catch(() => null)
  if (!body?.success) errors.push(`cleanup failed for ${id}: ${res.status}`)
}

await browser.close()
const uniqueApi = [...new Map(apiCalls.map((c) => [`${c.method} ${c.status} ${c.url.split('?')[0]}`, c])).values()]
fs.writeFileSync(path.join(OUT, 'usability-verify-round2.json'), JSON.stringify({
  report, errors, unexpectedResponses: [...new Set(unexpectedResponses)], apiCalls: uniqueApi,
  project: { id: project.id, name: project.name }, materialsTotal: materials?.data?.total,
  repoCreated, cleanup: repoCreated.length,
}, null, 2))
console.log(JSON.stringify({
  errors: [...new Set(errors)],
  unexpectedResponses: [...new Set(unexpectedResponses)],
  apiCalls: uniqueApi.length,
  report: report.map((r) => r.name),
  project: project.name,
  cleanup: repoCreated.length,
}, null, 2))
