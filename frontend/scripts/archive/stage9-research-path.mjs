/* 第九阶段：创建项目到报告与返回工作台的完整真实科研路径。 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, '.screenshots', 'stage9', 'research-path')
const FIXTURES = path.join(ROOT, 'frontend', 'scripts', 'fixtures', 'stage9')
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const projectName = `Stage9 科研路径回归 ${stamp.slice(0, 19)}`
const files = ['stage9-paper.md', 'stage9-metrics.csv', 'stage9-reproduce.py', 'requirements.txt']
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true })
const page = await context.newPage()
const results = []
const runtimeErrors = []
const ids = { projectId: null, materialIds: {}, planId: null, runId: null, reportId: null }
const snapshots = {}
let shotIndex = 0
page.on('pageerror', (error) => runtimeErrors.push({ type: 'pageerror', text: String(error) }))
page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push({ type: 'console', text: message.text() }) })
page.on('response', (response) => {
  if (response.status() >= 400) runtimeErrors.push({ type: 'http', status: response.status(), url: response.url() })
})

async function capture(slug) {
  shotIndex += 1
  const file = `${String(shotIndex).padStart(2, '0')}-${slug}.png`
  await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: 'disabled' })
  return file
}
async function check(name, run) {
  const started = Date.now()
  try {
    const detail = await run()
    const screenshot = await capture(name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 46))
    results.push({ name, status: 'passed', durationMs: Date.now() - started, detail: detail ?? null, screenshot })
    console.log(`PASS ${name}`)
  } catch (error) {
    const screenshot = await capture(`FAIL-${results.length + 1}`)
    results.push({ name, status: 'failed', durationMs: Date.now() - started, error: String(error), url: page.url(), screenshot })
    console.log(`FAIL ${name}: ${String(error).slice(0, 300)}`)
  }
}
async function apiGet(route) {
  const envelope = await page.evaluate(async (route) => {
    const token = localStorage.getItem('rc_token')
    const response = await fetch(`/api/v1${route}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    return { status: response.status, body: await response.json() }
  }, route)
  if (envelope.status >= 400 || envelope.body?.success !== true) throw new Error(`GET ${route} → ${JSON.stringify(envelope).slice(0, 500)}`)
  return envelope.body.data
}
async function postThroughUi(route, action) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'POST' && url.pathname === `/api/v1${route}`
  }, { timeout: 30000 })
  const [response] = await Promise.all([responsePromise, action()])
  const payload = await response.json()
  if (!response.ok() || payload?.success !== true) throw new Error(`POST ${route} → ${response.status()} ${JSON.stringify(payload).slice(0, 600)}`)
  return payload.data
}
async function goto(route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
}

try {
  await goto('/login')
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`)

  await check('创建全新科研项目', async () => {
    await goto('/projects/new')
    await page.locator('#project-name').fill(projectName)
    await page.locator('#project-domain').fill('可复现性工程审计')
    await page.locator('#project-paper').fill('Stage 9 Synthetic Reproduction Audit Fixture')
    await page.locator('#project-description').fill('第九阶段自动化端到端回归专用合成数据；不代表真实科研结论。')
    const created = await postThroughUi('/projects', () => page.getByRole('button', { name: '创建项目', exact: true }).click())
    ids.projectId = created.id
    await page.getByText('项目创建成功', { exact: true }).waitFor()
    return { id: created.id, name: created.name }
  })
  if (!ids.projectId) throw new Error('项目创建失败，无法继续依赖项目 ID 的路径。')

  await check('上传论文数据代码与环境文件', async () => {
    await goto(`/projects/${ids.projectId}/materials`)
    await page.getByLabel('选择材料文件').setInputFiles(files.map((file) => path.join(FIXTURES, file)))
    await page.getByRole('button', { name: `上传 ${files.length} 个文件`, exact: true }).click()
    await page.getByRole('status').filter({ hasText: '上传成功' }).waitFor({ timeout: 30000 })
    const materials = await apiGet(`/materials?project_id=${encodeURIComponent(ids.projectId)}`)
    for (const file of files) {
      const material = materials.items.find((item) => item.filename === file)
      if (!material) throw new Error(`后端材料列表缺少 ${file}`)
      ids.materialIds[file] = material.material_id
    }
    snapshots.materials = materials.items.map((item) => ({ id: item.material_id, filename: item.filename, type: item.material_type, status: item.parse_status, size: item.size_bytes }))
    return snapshots.materials
  })

  for (const file of files) {
    await check(`发起解析-${file}`, async () => {
      const card = page.locator('.mb-stack__card').filter({ hasText: file })
      await card.waitFor({ state: 'visible' })
      await card.click()
      const dialog = page.getByRole('dialog', { name: `材料详情 ${file}` })
      await dialog.waitFor({ state: 'visible' })
      const parseButton = dialog.getByRole('button', { name: '解析', exact: true })
      if (await parseButton.isDisabled()) {
        await page.keyboard.press('Escape')
        return { status: 'already-active', materialId: ids.materialIds[file] }
      }
      const parsed = await postThroughUi(`/materials/${ids.materialIds[file]}/parse`, () => parseButton.click())
      await page.keyboard.press('Escape')
      return parsed
    })
  }

  await check('解析任务到达真实终态', async () => {
    const started = Date.now()
    let tasks
    while (Date.now() - started < 60000) {
      tasks = await apiGet(`/parse-tasks?project_id=${encodeURIComponent(ids.projectId)}`)
      const active = tasks.items.filter((item) => ['queued', 'pending', 'running', 'parsing', 'extracting'].includes(item.status))
      if (active.length === 0) break
      await page.waitForTimeout(1200)
    }
    snapshots.parseTasks = tasks.items.map((item) => ({ id: item.task_id, materialId: item.material_id, status: item.status, error: item.error_message || null }))
    const unfinished = snapshots.parseTasks.filter((item) => ['queued', 'pending', 'running', 'parsing', 'extracting'].includes(item.status))
    const failed = snapshots.parseTasks.filter((item) => item.status === 'failed')
    if (unfinished.length || failed.length) throw new Error(JSON.stringify({ unfinished, failed }))
    await goto(`/projects/${ids.projectId}/tasks`)
    return snapshots.parseTasks
  })

  await check('论文事实与证据页面读取', async () => {
    const facts = await apiGet(`/facts?project_id=${encodeURIComponent(ids.projectId)}`)
    snapshots.facts = { total: facts.total ?? facts.items.length, items: facts.items.slice(0, 20).map((item) => ({ id: item.fact_id, type: item.fact_type, value: item.value, status: item.extraction_status, evidenceCount: item.evidence?.length ?? 0 })) }
    if (snapshots.facts.total > 0 && snapshots.facts.items.every((item) => item.evidenceCount === 0)) throw new Error('supported 程序事实缺少证据链')
    await goto(`/projects/${ids.projectId}/facts`)
    await page.locator('.mb-head__title').waitFor({ state: 'visible' })
    return snapshots.facts
  })

  await check('证据图谱与解析概览', async () => {
    await goto(`/projects/${ids.projectId}/evidence-graph`)
    await page.waitForTimeout(500)
    await goto(`/projects/${ids.projectId}/overview`)
    return { url: page.url() }
  })

  await check('代码环境读取', async () => {
    const environments = await apiGet(`/reproductions/environments?project_id=${encodeURIComponent(ids.projectId)}`)
    snapshots.environments = environments
    await goto(`/projects/${ids.projectId}/reproduction/environment`)
    return { total: environments.total ?? environments.items?.length ?? 0, items: environments.items ?? [] }
  })

  await check('从空总览创建首份复现规划', async () => {
    await goto(`/projects/${ids.projectId}/reproduction`)
    const created = await postThroughUi('/reproductions/plans', () => page.getByRole('button', { name: '手动新建规划', exact: true }).click())
    ids.planId = created.plan_id
    await page.waitForURL(new RegExp(`/reproductions/plans/${ids.planId}$`))
    await page.waitForTimeout(900)
    return created
  })

  if (ids.planId) {
    await check('确保规划具有可执行任务', async () => {
      let detail = await apiGet(`/reproductions/plans/${ids.planId}`)
      if ((detail.tasks?.length ?? 0) === 0) {
        await page.getByRole('button', { name: '新增任务', exact: true }).click()
        await page.locator('#task-title').fill('Stage9 确定性复现核验')
        await page.locator('#task-desc').fill('验证合成 CSV 与 Python  fixture 的输入、输出和指标口径。')
        await page.locator('#task-action').fill('python stage9-reproduce.py')
        await page.locator('#task-expected').fill('输出 samples=8 与 accuracy=0.875')
        await page.locator('#task-accept').fill('后端保存任务；无安全沙箱时明确阻塞，不伪造执行。')
        await postThroughUi(`/reproductions/plans/${ids.planId}/tasks`, () => page.getByRole('button', { name: '提交任务', exact: true }).click())
        detail = await apiGet(`/reproductions/plans/${ids.planId}`)
      }
      snapshots.plan = { id: detail.plan_id, status: detail.status, taskCount: detail.tasks?.length ?? 0, tasks: detail.tasks?.map((task) => ({ id: task.task_id, key: task.task_key, status: task.status, feasibility: task.feasibility })) }
      return snapshots.plan
    })

    await check('从规划创建真实复现运行', async () => {
      await page.getByRole('button', { name: '发起运行', exact: true }).last().click()
      await page.locator('#requested-by').fill('Stage9 Playwright Audit')
      const run = await postThroughUi('/reproductions/runs', () => page.locator('#requested-by').locator('xpath=../..').getByRole('button', { name: '发起运行', exact: true }).click())
      ids.runId = run.run_id
      await page.waitForURL(new RegExp(`/reproductions/runs/${ids.runId}$`))
      await page.waitForTimeout(1000)
      snapshots.run = run
      return { id: run.run_id, status: run.status, executionEnabled: run.execution_enabled, error: run.error_message || null }
    })
  }

  if (ids.runId) {
    await check('执行控制台与真实日志', async () => {
      const [run, logs] = await Promise.all([apiGet(`/reproductions/runs/${ids.runId}`), apiGet(`/reproductions/runs/${ids.runId}/logs`)])
      snapshots.console = { status: run.status, executionEnabled: run.execution_enabled, securityReason: run.security_reason || run.security_check?.reason || null, logCount: logs.items.length, logs: logs.items.slice(0, 20) }
      await page.getByRole('button', { name: '刷新数据', exact: true }).click()
      return snapshots.console
    })

    await check('执行后环境实体回读', async () => {
      const environments = await apiGet(`/reproductions/environments?project_id=${encodeURIComponent(ids.projectId)}`)
      if (!environments.items.some((item) => item.environment_id === snapshots.run.environment_id)) throw new Error('运行关联的环境未出现在环境列表')
      snapshots.environmentsAfterRun = environments
      await goto(`/projects/${ids.projectId}/reproduction/environment`)
      return { total: environments.total ?? environments.items.length, environmentId: snapshots.run.environment_id }
    })

    await check('结果对照页面与数据', async () => {
      await goto(`/projects/${ids.projectId}/reproduction/comparison`)
      const comparisons = await apiGet(`/reproductions/metric-comparisons?project_id=${encodeURIComponent(ids.projectId)}`)
      snapshots.comparisons = comparisons
      return { total: comparisons.total ?? comparisons.items.length, items: comparisons.items }
    })

    await check('生成并查看复现报告', async () => {
      await goto(`/projects/${ids.projectId}/reproduction/reports`)
      await page.locator('#report-plan').selectOption(ids.planId)
      await page.locator('.rc-we-report__runrow').filter({ hasText: ids.runId }).locator('input[type="checkbox"]').check()
      const report = await postThroughUi('/reproductions/reports', () => page.getByRole('button', { name: '生成报告', exact: true }).click())
      ids.reportId = report.report_id
      const detail = await apiGet(`/reproductions/reports/${ids.reportId}`)
      snapshots.report = { id: detail.report_id, sectionCount: detail.sections?.length ?? report.section_count, title: detail.title || null }
      await page.waitForTimeout(600)
      return snapshots.report
    })

    await check('历史列表重新打开报告', async () => {
      const reports = await apiGet(`/reproductions/reports?project_id=${encodeURIComponent(ids.projectId)}`)
      const item = reports.items.find((report) => report.report_id === ids.reportId)
      if (!item) throw new Error('生成报告未出现在历史列表')
      await goto(`/projects/${ids.projectId}/reproduction/reports`)
      await page.locator('tr').filter({ hasText: ids.reportId }).locator('.rc-we-report__linkbtn').click()
      await page.waitForTimeout(500)
      return { historyTotal: reports.total ?? reports.items.length, reopened: ids.reportId }
    })
  }

  await check('返回根工作台并保留项目上下文', async () => {
    await page.getByRole('button', { name: '返回工作台', exact: true }).click()
    await page.waitForURL(`${BASE}/`)
    await page.locator('.rc-disc-shell').waitFor({ state: 'visible' })
    const text = await page.locator('.rc-stage').innerText()
    if (!text.includes(ids.projectId.slice(0, 8))) throw new Error('根工作台未显示最近项目上下文')
    return { url: page.url(), contextVisible: true }
  })
} catch (error) {
  results.push({ name: '路径中断', status: 'failed', error: String(error), url: page.url() })
  console.log(`ABORT ${String(error)}`)
} finally {
  const report = { startedAt: stamp, projectName, ids, results, snapshots, runtimeErrors, passed: results.filter((item) => item.status === 'passed').length, failed: results.filter((item) => item.status === 'failed').length }
  fs.writeFileSync(path.join(OUT, 'research-path-report.json'), JSON.stringify(report, null, 2))
  fs.writeFileSync(path.join(OUT, 'latest-ids.json'), JSON.stringify({ projectName, ids }, null, 2))
  await browser.close()
  console.log(`REPORT ${path.join(OUT, 'research-path-report.json')}`)
}
