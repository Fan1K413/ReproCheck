import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.resolve(process.env.WRITE_OUT || path.join(ROOT, '.screenshots', 'stage9', 'write-paths'))
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const latest = JSON.parse(fs.readFileSync(path.join(ROOT, '.screenshots', 'stage9', 'research-path', 'latest-ids.json'), 'utf8'))
const projectName = latest.projectName
const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const runId = String(Date.now())
const results = []
const runtime = { consoleErrors: [], pageErrors: [], badResponses: [] }
fs.mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', acceptDownloads: true })
const page = await context.newPage()
page.setDefaultTimeout(20000)
page.on('console', (m) => { if (m.type() === 'error') runtime.consoleErrors.push({ url: page.url(), text: m.text().slice(0, 500) }) })
page.on('pageerror', (e) => runtime.pageErrors.push({ url: page.url(), text: String(e).slice(0, 500) }))
page.on('response', (r) => { if (r.status() >= 400) runtime.badResponses.push({ url: r.url(), status: r.status(), method: r.request().method() }) })

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${String(results.length + 1).padStart(2, '0')}-${name}.png`), fullPage: true, animations: 'disabled' })
}
async function step(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, durationMs: Date.now() - started, detail: detail ?? null })
    console.log(`PASS ${name}`)
    await shot(name)
  } catch (error) {
    results.push({ name, ok: false, durationMs: Date.now() - started, error: String(error).slice(0, 1000), url: page.url() })
    console.error(`FAIL ${name}: ${error}`)
    await shot(`FAIL-${name}`)
  }
}
async function goto(route) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)
}
async function toast(text) {
  await page.getByText(text, { exact: false }).last().waitFor({ state: 'visible', timeout: 25000 })
}

try {
  await goto('/login')
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`)

  const ruleKey = `stage9_lr_${runId}`
  const sample = JSON.stringify([{ label: 'consistent_case', input: { a: { learning_rate: 0.001 }, b: { learning_rate: 0.001 } }, expected: { status: 'consistent', conflict_fields: [] } }], null, 2)
  await goto('/rules')
  await step('规则创建', async () => {
    await page.getByRole('button', { name: '新建规则', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '新建审计规则' })
    await dialog.getByPlaceholder('accuracy_tolerance_0p1').fill(ruleKey)
    await dialog.getByPlaceholder('准确率容差校验（0.1%）').fill('Stage9 学习率一致性规则')
    await dialog.getByPlaceholder('机器学习').fill('科研审计回归')
    await dialog.getByPlaceholder('learning_rate, batch_size, epochs').fill('learning_rate')
    await dialog.locator('textarea[rows="6"]').fill(sample)
    await dialog.getByRole('button', { name: '创建规则', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast(`规则 ${ruleKey} 已创建`)
    await page.getByText(ruleKey, { exact: true }).first().waitFor()
    return { ruleKey }
  })
  await step('规则样本测试', async () => {
    await page.getByRole('tab', { name: /测试样本/ }).click()
    await page.getByRole('button', { name: '运行样本测试', exact: true }).click()
    await toast('样本测试完成：1/1 通过')
  })
  await step('规则离线评估', async () => {
    await page.getByRole('tab', { name: /离线评估/ }).click()
    await page.getByRole('button', { name: '从测试样本载入', exact: true }).click()
    await page.getByRole('button', { name: '开始离线评估', exact: true }).click()
    await toast('离线评估完成，指标已落库留痕')
    await page.getByText('单版本评估 v1', { exact: false }).first().waitFor()
  })
  await step('规则停用与恢复', async () => {
    await page.getByRole('button', { name: '停用规则', exact: true }).click()
    await toast('规则已停用')
    await page.getByRole('button', { name: '启用规则', exact: true }).click()
    await toast('规则已启用')
  })

  const note = `Stage9 合成反馈 ${runId}：用于验证人工分诊，不触发规则自动修改。`
  const resolution = `Stage9 分诊结论 ${runId}：测试样本与证据引用完整，转入已分诊。`
  await goto('/feedback')
  await page.locator('#fb-project').selectOption({ label: projectName })
  await step('反馈提交', async () => {
    await page.getByRole('button', { name: '提交反馈', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '提交审计反馈' })
    await dialog.getByPlaceholder(/描述你对该审计发现/).fill(note)
    await dialog.getByPlaceholder('如：chunk_p_012 / 论文第 5 页').fill('stage9://evidence/manual-regression')
    await dialog.getByRole('button', { name: '提交反馈', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast('反馈已提交')
    await page.getByText(note, { exact: true }).waitFor()
  })
  await step('反馈人工分诊', async () => {
    const card = page.locator('article').filter({ hasText: note })
    await card.getByRole('button', { name: '分诊', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '反馈分诊' })
    await dialog.getByPlaceholder(/记录分诊依据/).fill(resolution)
    await dialog.getByRole('button', { name: '确认分诊', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast('分诊完成：已分诊')
    await page.getByText(resolution, { exact: true }).waitFor()
  })

  const tokenName = `Stage9 临时令牌 ${runId}`
  await goto('/api-tokens')
  await step('API令牌创建', async () => {
    await page.getByRole('button', { name: '创建令牌', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '创建 API Token' })
    await dialog.locator('#token-name').fill(tokenName)
    await dialog.locator('#token-rate').fill('30')
    await dialog.getByRole('button', { name: '创建令牌', exact: true }).click()
    const created = page.getByRole('dialog', { name: '令牌已创建 · 明文仅此一次' })
    await created.waitFor()
    await created.getByRole('button', { name: '我已保存，关闭', exact: true }).click()
    await created.waitFor({ state: 'hidden' })
    await page.getByText(tokenName, { exact: true }).waitFor()
  })
  await step('API令牌撤销', async () => {
    const card = page.locator('article').filter({ hasText: tokenName })
    await card.getByRole('button', { name: '撤销', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '撤销 API Token' })
    await dialog.getByRole('button', { name: '确认撤销', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast(`令牌「${tokenName}」已撤销`)
  })

  const account = `stage9-audit-${runId}`
  await goto('/integrations')
  await step('无凭据仓库连接', async () => {
    await page.getByRole('button', { name: '连接仓库', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: '连接仓库' })
    await dialog.locator('#conn-account').fill(account)
    await dialog.locator('#conn-allowlist').fill('stage9/audit-only')
    await dialog.getByRole('button', { name: '创建连接', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast(`已连接 GitHub 账户「${account}」`)
  })
  await step('仓库同步真实阻断', async () => {
    await page.locator('#sync-repo').fill('stage9/audit-only')
    await page.locator('#sync-ref').fill('main')
    await page.getByRole('button', { name: '同步快照', exact: true }).click()
    await toast('同步被阻断：未配置凭据')
    await page.getByText('未获取到真实 commit，不伪造版本号', { exact: false }).first().waitFor()
  })
  await step('仓库连接撤销', async () => {
    const card = page.locator('article').filter({ hasText: account })
    await card.getByRole('button', { name: '撤销', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '撤销仓库连接' })
    await dialog.getByRole('button', { name: '确认撤销', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await toast('连接已撤销，后端加密凭据已清空')
  })

  await goto('/governance')
  await page.getByRole('tab', { name: /AI 授权/ }).click()
  await page.locator('#consent-project').selectOption({ label: projectName })
  await step('AI授权拒绝与恢复', async () => {
    await page.getByRole('button', { name: '拒绝', exact: true }).click()
    await page.getByRole('button', { name: '提交授权决定', exact: true }).click()
    await toast('已拒绝：该项目的外部 LLM 调用将被阻断')
    await page.getByRole('button', { name: '授权', exact: true }).click()
    await page.getByRole('button', { name: '提交授权决定', exact: true }).click()
    await toast('已授权：该项目可调用外部 LLM')
  })
  await step('本人数据导出与下载', async () => {
    await page.getByRole('tab', { name: /数据导出/ }).click()
    await page.getByRole('button', { name: '请求导出', exact: true }).click()
    await toast('本人数据导出已同步构建完成')
    const downloadButton = page.getByRole('button', { name: /下载/ }).last()
    await downloadButton.waitFor()
    const downloadPromise = page.waitForEvent('download')
    await downloadButton.click()
    const download = await downloadPromise
    const target = path.join(OUT, 'stage9-personal-export.zip')
    await download.saveAs(target)
    assert.ok(fs.statSync(target).size > 0)
    return { bytes: fs.statSync(target).size }
  })
  await step('保留策略读取', async () => {
    await page.getByRole('tab', { name: /保留策略/ }).click()
    await page.waitForTimeout(700)
    const text = await page.locator('main').innerText()
    assert.ok(/保留规则|保留策略仅组织管理员可见|暂无保留策略/.test(text))
    assert.ok(!/Unhandled|Something went wrong/i.test(text))
  })
} finally {
  const report = { meta: { startedAt: stamp, base: BASE, projectName }, summary: { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length }, results, runtime }
  fs.writeFileSync(path.join(OUT, 'write-paths-report.json'), JSON.stringify(report, null, 2))
  console.log(`REPORT ${path.join(OUT, 'write-paths-report.json')}`)
  await browser.close()
}
