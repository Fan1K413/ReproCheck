/* ReproCheck 第九阶段：真实路由、截图与运行时错误基线。
 * 运行：node scripts/stage9-audit.mjs
 * 可用 CHROMIUM_PATH / VERIFY_BASE / VERIFY_OUT 覆盖默认环境。
 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const MOBILE = process.env.VERIFY_VIEWPORT === 'mobile'
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 }
const OUT = path.resolve(process.env.VERIFY_OUT || path.join(ROOT, '.screenshots', 'stage9', MOBILE ? 'mobile' : 'playwright'))
const BASE = process.env.VERIFY_BASE || 'http://127.0.0.1:5173'
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const PID = 'proj-209c77cd39f94212'
const MATERIAL = 'mat-e305657ae1924224'
const CASE = 'case-c3d8a5d22038455c'
const PLAN = 'plan-b4bbf8748a2d41'
const RUN = 'run-5acdb8cd27d946'

fs.mkdirSync(OUT, { recursive: true })

const allRoutes = [
  ['root', '/'],
  ['projects', '/projects'],
  ['project-new', '/projects/new'],
  ['project-workbench', `/projects/${PID}/workbench`],
  ['settings-llm', '/settings/llm'],
  ['settings-models', '/settings/models'],
  ['demo-audit', '/demo/audit'],
  ['materials', `/projects/${PID}/materials`],
  ['material-detail', `/materials/${MATERIAL}`],
  ['parse-tasks', `/projects/${PID}/tasks`],
  ['facts', `/projects/${PID}/facts`],
  ['evidence-graph', `/projects/${PID}/evidence-graph`],
  ['overview', `/projects/${PID}/overview`],
  ['verification', `/projects/${PID}/verification`],
  ['handoff', `/projects/${PID}/handoff`],
  ['experiment-diff', `/projects/${PID}/experiments/diff`],
  ['change-monitor', `/projects/${PID}/change-monitor`],
  ['reproduction-overview', `/projects/${PID}/reproduction`],
  ['reproduction-plan', `/reproductions/plans/${PLAN}`],
  ['reproduction-run', `/reproductions/runs/${RUN}`],
  ['reproduction-environment', `/projects/${PID}/reproduction/environment`],
  ['reproduction-comparison', `/projects/${PID}/reproduction/comparison`],
  ['reproduction-diagnostics', `/projects/${PID}/reproduction/diagnostics`],
  ['reproduction-reports', `/projects/${PID}/reproduction/reports`],
  ['orgs', '/orgs'],
  ['roles', '/roles'],
  ['project-team', `/projects/${PID}/team`],
  ['benchmark', '/benchmark'],
  ['case-detail', `/benchmark/${CASE}`],
  ['fact-schema', '/fact-schema'],
  ['rules', '/rules'],
  ['feedback', '/feedback'],
  ['knowledge', '/knowledge'],
  ['integrations', '/integrations'],
  ['api-tokens', '/api-tokens'],
  ['governance', '/governance'],
  ['stats-audit', '/stats-audit'],
  ['data-audit', `/projects/${PID}/data-audit`],
]

const only = (process.env.VERIFY_ONLY || '').split(',').map((item) => item.trim()).filter(Boolean)
const routes = only.length ? allRoutes.filter(([slug, route]) => only.includes(slug) || only.includes(route)) : allRoutes

const report = {
  meta: { startedAt: new Date().toISOString(), base: BASE, executable: CHROMIUM, viewport: `${VIEWPORT.width}x${VIEWPORT.height}@1` },
  login: null,
  timeline: null,
  routes: [],
}

const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})

try {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: MOBILE,
    hasTouch: MOBILE,
    reducedMotion: 'no-preference',
    locale: 'zh-CN',
  })
  const page = await context.newPage()
  const runtime = { consoleErrors: [], pageErrors: [], requestFailures: [], badResponses: [] }
  page.on('console', (message) => {
    if (message.type() === 'error') runtime.consoleErrors.push({ at: page.url(), text: message.text().slice(0, 800) })
  })
  page.on('pageerror', (error) => runtime.pageErrors.push({ at: page.url(), text: String(error).slice(0, 800) }))
  page.on('requestfailed', (request) => runtime.requestFailures.push({ at: page.url(), url: request.url(), error: request.failure()?.errorText }))
  page.on('response', (response) => {
    if (response.status() >= 400) runtime.badResponses.push({ at: page.url(), url: response.url(), status: response.status() })
  })

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /林晚晴/ }).click()
  await page.getByRole('button', { name: '登录工作台', exact: true }).click()
  await page.waitForURL(`${BASE}/`, { timeout: 20000 })
  await page.waitForTimeout(700)
  report.login = { ok: true, url: page.url() }
  await page.screenshot({ path: path.join(OUT, '00-login-success-root.png'), fullPage: true })

  const t1 = await page.evaluate(() => document.timeline.currentTime)
  await page.waitForTimeout(250)
  const t2 = await page.evaluate(() => document.timeline.currentTime)
  report.timeline = { before: t1, after: t2, advancing: t2 > t1 }

  for (const [index, [slug, route]] of routes.entries()) {
    const errorStart = {
      console: runtime.consoleErrors.length,
      page: runtime.pageErrors.length,
      request: runtime.requestFailures.length,
      response: runtime.badResponses.length,
    }
    const started = Date.now()
    let navError = null
    let status = 0
    try {
      const response = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 })
      status = response?.status() || 0
      await page.waitForTimeout(900)
      await page.waitForFunction(() => {
        const pageRoot = document.querySelector('main')?.firstElementChild || document.querySelector('#root > *')
        if (!pageRoot) return false
        return Number.parseFloat(getComputedStyle(pageRoot).opacity || '1') > 0.9
      }, { timeout: 5000 }).catch(() => {})
    } catch (error) {
      navError = String(error).slice(0, 500)
    }
    const dom = await page.evaluate(() => {
      const main = document.querySelector('main')
      const pageRoot = main?.firstElementChild || document.querySelector('#root > *')
      const style = pageRoot ? getComputedStyle(pageRoot) : null
      const rect = pageRoot?.getBoundingClientRect()
      const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim()
      const interactive = [...document.querySelectorAll('button, a, input, select, textarea, [role="button"], [role="tab"], [role="menuitem"]')]
      const smallTargetDetails = interactive.filter((element) => {
        const r = element.getBoundingClientRect()
        const s = getComputedStyle(element)
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && (r.width < 24 || r.height < 24)
      }).map((element) => {
        const r = element.getBoundingClientRect()
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
          className: String(element.getAttribute('class') || '').slice(0, 140),
        }
      })
      const smallTargets = smallTargetDetails.length
      return {
        url: location.pathname + location.search,
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim() || '',
        textLength: text.length,
        textSample: text.slice(0, 300),
        mainOpacity: style?.opacity ?? null,
        mainAnimation: style?.animationName ?? null,
        mainRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        images: [...document.querySelectorAll('img')].map((img) => ({ src: img.currentSrc || img.src, alt: img.alt })),
        iframes: document.querySelectorAll('iframe').length,
        canvases: document.querySelectorAll('canvas').length,
        buttons: document.querySelectorAll('button').length,
        links: document.querySelectorAll('a[href]').length,
        smallTargets,
        smallTargetDetails,
        lightSkin: !!document.querySelector('[data-rc-skin="light"]'),
        crash: /something went wrong|minified react error|unhandled runtime error|application error/i.test(text),
      }
    })
    const file = `${String(index + 1).padStart(2, '0')}-${slug}.png`
    await page.screenshot({ path: path.join(OUT, file), fullPage: true, animations: 'disabled' })
    report.routes.push({
      slug,
      route,
      status,
      navError,
      durationMs: Date.now() - started,
      screenshot: file,
      ...dom,
      errors: {
        console: runtime.consoleErrors.slice(errorStart.console),
        page: runtime.pageErrors.slice(errorStart.page),
        request: runtime.requestFailures.slice(errorStart.request),
        response: runtime.badResponses.slice(errorStart.response),
      },
    })
    console.log(`${file} ${status} opacity=${dom.mainOpacity} overflow=${dom.horizontalOverflow} errors=${report.routes.at(-1).errors.console.length + report.routes.at(-1).errors.page.length}`)
  }
  fs.writeFileSync(path.join(OUT, 'route-report.json'), JSON.stringify(report, null, 2))
  console.log(`REPORT ${path.join(OUT, 'route-report.json')}`)
} finally {
  await browser.close()
}
