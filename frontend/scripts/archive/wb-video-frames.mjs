import { chromium } from 'playwright-core'
import path from 'node:path'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VIDEO = 'file:///C:/Users/ASUS/Desktop/科研复现审计官/.screenshots/workbench-round2/workbench-round2-1440.webm'
const OUT = path.resolve('../.screenshots/workbench-round2')
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(VIDEO)
await page.waitForTimeout(600)
for (const t of [4, 5, 6, 7, 7.5, 8, 8.5, 9, 10, 11, 12, 13]) {
  await page.evaluate((time) => {
    const v = document.querySelector('video')
    v.currentTime = time
    v.pause()
  }, t)
  await page.waitForTimeout(350)
  await page.screenshot({ path: path.join(OUT, `vframe-${t}.png`) })
}
await browser.close()
