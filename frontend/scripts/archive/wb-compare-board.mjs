import { chromium } from 'playwright-core'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const HTML = pathToFileURL(path.resolve('../docs/workbench-round2-compare.html')).href
const OUT = path.resolve('../.screenshots/workbench-round2/workbench-round2-compare.png')
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1640, height: 1240 }, deviceScaleFactor: 1 })
page.on('console', (m) => { if (m.type() === 'error') console.log(m.text()) })
await page.goto(HTML, { waitUntil: 'load' })
await page.waitForTimeout(500)
await page.screenshot({ path: OUT, fullPage: true })
console.log(OUT)
await browser.close()
