/* 录屏抽帧检查：确认时长与关键阶段画面。 */
import { chromium } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const VIDEO = 'file:///C:/Users/ASUS/Desktop/科研复现审计官/.screenshots/workbench-round2/workbench-round2-1440.webm'
const OUT = path.resolve('../.screenshots/workbench-round2')
const browser = await chromium.launch({ executablePath: EDGE, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(VIDEO)
await page.waitForTimeout(800)
const meta = await page.evaluate(() => {
  const v = document.querySelector('video')
  return v ? { duration: v.duration, width: v.videoWidth, height: v.videoHeight } : null
})
for (const [name, t] of [['video-03s', 3], ['video-08s', 8], ['video-14s', 14], ['video-19s', 19]]) {
  await page.evaluate((time) => {
    const v = document.querySelector('video')
    v.currentTime = time
    v.pause()
  }, t)
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
}
console.log(JSON.stringify(meta))
await browser.close()
