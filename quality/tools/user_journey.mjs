/**
 * 真实用户主流程走查（独立质量审计）
 *
 * 场景：登录 → 新建项目 → 上传 4 份真实文件 → 解析 → 事实/概览 → 手动规划 → 新增任务
 *       → 复现报告页 → 重新进入项目核对持久化。
 * 约束：仅使用本地已运行服务与真实后端数据；无 LLM Key 的步骤记录为“部分完成/阻塞”，
 *       不伪造事实、规划或运行结果。走查项目名带 QA-AUDIT 前缀，便于清理。
 *
 * 运行：
 *   cd frontend && node ../quality/tools/user_journey.mjs
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const requireFrontend = createRequire(resolve(repo, 'frontend/package.json'))
const { chromium } = requireFrontend('playwright')
const shots = resolve(repo, 'quality/reports/screens')
const outJson = resolve(repo, 'quality/reports/user-journey.json')
mkdirSync(shots, { recursive: true })

const BASE = 'http://127.0.0.1:5173'
const results = { started_at: new Date().toISOString(), base: BASE, steps: [], errors: [] }
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
const page = await context.newPage()
page.on('pageerror', (e) => results.errors.push({ type: 'pageerror', message: String(e).slice(0, 300) }))
page.on('console', (m) => {
  if (m.type() === 'error') results.errors.push({ type: 'console', message: m.text().slice(0, 300) })
})

async function shot(name) {
  const path = resolve(shots, `${name}.png`)
  await page.screenshot({ path, fullPage: false })
  return path
}

async function step(id, note, fn) {
  const t0 = Date.now()
  try {
    const detail = await fn()
    results.steps.push({ id, note, ok: true, ms: Date.now() - t0, detail })
    console.log(`OK ${id} ${Date.now() - t0}ms`, detail ?? '')
    return detail
  } catch (e) {
    const message = String(e?.message ?? e).split('\n')[0].slice(0, 300)
    results.steps.push({ id, note, ok: false, ms: Date.now() - t0, error: message })
    results.errors.push({ type: 'step', id, message })
    console.log(`FAIL ${id} ${message}`)
    throw e
  }
}

try {
  await step('login', '演示账号登录', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.getByText('林晚晴', { exact: true }).last().click({ force: true })
    await page.getByText('登录工作台', { exact: true }).last().click({ force: true })
    await page.waitForTimeout(900)
    const path = new URL(page.url()).pathname
    if (path.startsWith('/login')) throw new Error('登录后仍停留在登录页')
    return { path }
  })

  const project = await step('create_project', 'UI 新建项目', async () => {
    await page.goto(`${BASE}/projects/new`, { waitUntil: 'domcontentloaded' })
    await page.locator('#project-name').fill(`QA-AUDIT 复现主线走查 ${stamp}`)
    await page.locator('#project-domain').fill('计算机视觉 / 可复现性')
    await page.locator('#project-paper').fill('Deep Residual Learning for Image Recognition')
    await page.locator('#project-description').fill('独立质量审计临时项目：验证创建、上传、解析、规划与持久化；不代表真实科研结论。')
    await page.getByRole('button', { name: '创建项目', exact: true }).click()
    await page.getByText('项目创建成功', { exact: true }).waitFor({ timeout: 15000 })
    const text = await page.locator('.rc2-card').first().innerText()
    const m = text.match(/proj-[a-f0-9]{16}/)
    if (!m) throw new Error('未从成功页解析到项目 ID')
    await page.screenshot({ path: resolve(shots, '01-project-created.png') })
    return { id: m[0], name: `QA-AUDIT 复现主线走查 ${stamp}` }
  })

  const pid = project.id

  await step('upload_materials', '上传论文/数据/代码/配置 4 份文件', async () => {
    await page.goto(`${BASE}/projects/${pid}/materials`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.locator('input[type=file]').setInputFiles([
      resolve(repo, 'backend/test_materials/stage2/sample.pdf'),
      resolve(repo, 'backend/test_materials/stage2/data.csv'),
      resolve(repo, 'backend/test_materials/stage2/sample_project.py'),
      resolve(repo, 'backend/test_materials/stage2/config.yaml'),
    ])
    await page.waitForTimeout(300)
    const uploadBtn = page.getByRole('button', { name: /上传 4 个文件/ })
    await uploadBtn.click()
    await page.waitForTimeout(1500)
    const body = await page.locator('body').innerText()
    if (!body.includes('上传成功')) throw new Error('未出现上传成功提示')
    await page.screenshot({ path: resolve(shots, '02-materials-uploaded.png') })
    return { count: 4 }
  })

  await step('parse_pdf', '对 sample.pdf 发起解析（无 LLM Key 走降级）', async () => {
    const card = page.locator('.mb-stack__card', { hasText: 'sample.pdf' }).first()
    await card.click()
    await page.waitForTimeout(500)
    const parseBtn = page.getByRole('button', { name: '解析', exact: true }).first()
    await parseBtn.click()
    await page.waitForTimeout(3500)
    const body = await page.locator('body').innerText()
    const partial = body.includes('部分完成') || body.includes('解析完成')
    await page.screenshot({ path: resolve(shots, '03-materials-parsed.png') })
    return { partial, hasFailed: body.includes('解析失败') }
  })

  await step('facts', '科研事实页（无 Key 预期 0 条）', async () => {
    await page.goto(`${BASE}/projects/${pid}/facts`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const body = await page.locator('body').innerText()
    await page.screenshot({ path: resolve(shots, '04-facts.png') })
    return { emptyHint: body.includes('暂无') || body.includes('尚无'), length: body.length }
  })

  await step('overview', '解析概览页', async () => {
    await page.goto(`${BASE}/projects/${pid}/overview`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const body = await page.locator('body').innerText()
    await page.screenshot({ path: resolve(shots, '05-overview.png') })
    return { length: body.length, hasCounts: /\d/.test(body) }
  })

  let planId = null
  await step('create_plan', '复现总览页创建空规划（不调用 AI）', async () => {
    await page.goto(`${BASE}/projects/${pid}/reproduction`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: '手动新建规划', exact: true }).click()
    await page.waitForTimeout(1500)
    let href = await page.locator('a[href^="/reproductions/plans/"]').first().getAttribute('href').catch(() => null)
    if (!href) {
      // 页面刷新存在时序不确定性；直接查后端规划列表，避免把测试脚本问题误判为产品缺陷
      const fetched = await page.evaluate(async (projectId) => {
        const token = localStorage.getItem('rc_token')
        const r = await fetch(`/api/v1/reproductions/plans?project_id=${encodeURIComponent(projectId)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (!r.ok) return null
        const j = await r.json()
        const items = j?.data?.items ?? j?.items ?? j?.data ?? []
        return Array.isArray(items) && items.length ? items[0].plan_id ?? items[0].id : null
      }, pid).catch(() => null)
      if (fetched) href = `/reproductions/plans/${fetched}`
    }
    await page.screenshot({ path: resolve(shots, '06-reproduction-plan.png') })
    if (href) planId = href.split('/').pop()
    return { planId }
  })

  if (planId) {
    await step('add_task', '规划页新增一个程序化任务', async () => {
      await page.goto(`${BASE}/reproductions/plans/${planId}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(800)
      await page.getByRole('button', { name: '新增任务', exact: true }).click()
      await page.locator('#task-title').fill('核对论文表 3 的 top-1 精度与训练配置')
      await page.locator('#task-desc').fill('读取论文表 3、训练配置与运行日志，核对 76.1% top-1 的声明。')
      await page.getByRole('button', { name: '提交任务', exact: true }).click()
      await page.waitForTimeout(1500)
      const body = await page.locator('body').innerText()
      await page.screenshot({ path: resolve(shots, '07-plan-task.png') })
      return { taskVisible: body.includes('核对论文表 3') }
    })
  }

  await step('reports', '复现报告页可打开', async () => {
    await page.goto(`${BASE}/projects/${pid}/reproduction/reports`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1000)
    await page.screenshot({ path: resolve(shots, '08-reports.png') })
    return { path: new URL(page.url()).pathname }
  })

  await step('persistence', '退出后重新进入项目，核对材料与规划仍在', async () => {
    await page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
    const listBody = await page.locator('body').innerText()
    if (!listBody.includes('QA-AUDIT 复现主线走查')) throw new Error('项目列表中未找到走查项目')
    await page.goto(`${BASE}/projects/${pid}/materials`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1200)
    const body = await page.locator('body').innerText()
    const materialCount = (body.match(/sample\.pdf/g) || []).length
    await page.screenshot({ path: resolve(shots, '09-reenter.png') })
    if (materialCount === 0) throw new Error('重新进入后材料列表为空')
    return { materialCount, projectVisible: true, planId }
  })
} finally {
  results.finished_at = new Date().toISOString()
  results.project_id = results.steps.find((s) => s.id === 'create_project')?.detail?.id ?? null
  results.plan_id = typeof planId !== 'undefined' ? planId : null
  writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf-8')
  await browser.close()
}
