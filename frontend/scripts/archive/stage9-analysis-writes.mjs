import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const OUT = path.join(ROOT, '.screenshots', 'stage9', 'analysis-writes')
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const latest = JSON.parse(fs.readFileSync(path.join(ROOT, '.screenshots', 'stage9', 'research-path', 'latest-ids.json'), 'utf8'))
const pid = latest.ids.projectId
const runId = latest.ids.runId
fs.mkdirSync(OUT, { recursive: true })
const results = []
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
page.setDefaultTimeout(25000)
async function step(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? null })
    console.log(`PASS ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error), url: page.url() })
    console.error(`FAIL ${name}: ${error}`)
  }
  await page.screenshot({ path: path.join(OUT, `${String(results.length).padStart(2, '0')}-${name}.png`), fullPage: true, animations: 'disabled' })
}
try {
  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`)

  await step('统计学完整审计', async () => {
    await page.goto(`${BASE}/stats-audit`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '载入示例', exact: true }).click()
    const responsePromise = page.waitForResponse((r) => r.url().includes('/stats-audit/run') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '运行审计', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await page.getByText('审计发现', { exact: true }).last().waitFor()
    const envelope = await response.json()
    const body = envelope.data ?? envelope
    return { auditId: body.report_id ?? body.audit_id ?? body.id ?? null, findingCount: body.findings?.length ?? null }
  })

  await step('数据质量与代码审计', async () => {
    await page.goto(`${BASE}/projects/${pid}/data-audit`, { waitUntil: 'domcontentloaded' })
    const responsePromise = page.waitForResponse((r) => r.url().includes(`/projects/${pid}/data-audits`) && r.request().method() === 'POST')
    await page.getByRole('button', { name: '运行数据审计', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await page.getByText('规则执行概览', { exact: false }).first().waitFor()
    const envelope = await response.json()
    const body = envelope.data ?? envelope
    assert.ok(body.audit_id)
    assert.ok((body.findings?.length ?? 0) >= 1)
    await page.getByText(/扫描文件\s*1\s*个/).first().waitFor()
    return { auditId: body.audit_id, stats: body.stats ?? null, scope: body.scope ?? null, findingCount: body.findings?.length ?? null }
  })

  await step('确定性失败诊断', async () => {
    await page.goto(`${BASE}/projects/${pid}/reproduction/diagnostics`, { waitUntil: 'domcontentloaded' })
    const panel = page.getByRole('region', { name: '确定性失败诊断' })
    await panel.getByPlaceholder(/粘贴运行日志/).fill('Traceback (most recent call last):\nModuleNotFoundError: No module named \'stage9_missing_dependency\'')
    const responsePromise = page.waitForResponse((r) => r.url().includes('/diagnosis/classify') && r.request().method() === 'POST')
    await panel.getByRole('button', { name: '推断候选原因', exact: true }).click()
    const response = await responsePromise
    assert.equal(response.status(), 200)
    await panel.getByText('候选', { exact: false }).last().waitFor()
    const envelope = await response.json()
    const body = envelope.data ?? envelope
    return { category: body.category ?? body.failure_category ?? null, isConfirmed: body.is_confirmed ?? null }
  })

  await step('无密钥AI诊断诚实失败', async () => {
    await page.locator('#diagnostic-run').selectOption(runId)
    const responsePromise = page.waitForResponse((r) => r.url().includes('/reproductions/diagnostics') && r.request().method() === 'POST')
    await page.getByRole('button', { name: '发起 AI 诊断', exact: true }).click()
    const response = await responsePromise
    assert.ok(response.status() >= 400)
    await page.getByText('AI 诊断不可用', { exact: true }).waitFor()
    await page.getByText('LLM_KEY_NOT_CONFIGURED', { exact: false }).waitFor()
    return { expectedStatus: response.status(), code: 'LLM_KEY_NOT_CONFIGURED' }
  })
} finally {
  const report = { meta: { projectId: pid, runId }, summary: { passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, total: results.length }, results }
  fs.writeFileSync(path.join(OUT, 'analysis-writes-report.json'), JSON.stringify(report, null, 2))
  console.log(`REPORT ${path.join(OUT, 'analysis-writes-report.json')}`)
  await browser.close()
}
