/* 将真实路由截图整理成可逐页复核的联系表，不生成或替换任何产品画面。 */
import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const CHROMIUM = process.env.CHROMIUM_PATH || 'C:\\Users\\ASUS\\AppData\\Local\\ms-playwright\\chromium-1254\\chrome-win64\\chrome.exe'
const browser = await chromium.launch({ executablePath: CHROMIUM, headless: true, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
for (const mode of ['desktop', 'mobile']) {
  const dir = path.join(ROOT, '.screenshots', 'stage9', mode === 'desktop' ? 'playwright' : 'mobile')
  const report = JSON.parse(fs.readFileSync(path.join(dir, 'route-report.json'), 'utf8'))
  const perSheet = mode === 'desktop' ? 10 : 12
  for (let start = 0; start < report.routes.length; start += perSheet) {
    const items = report.routes.slice(start, start + perSheet)
    const number = Math.floor(start / perSheet) + 1
    const htmlPath = path.join(dir, `contact-${mode}-${number}.html`)
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;background:#0d0913;color:#f5efff;font:14px system-ui;padding:18px}
      h1{font-size:20px;margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(${mode === 'desktop' ? 2 : 4},1fr);gap:14px}
      figure{margin:0;background:#181020;border:1px solid #443353;border-radius:10px;overflow:hidden}
      figcaption{padding:9px 11px;font-weight:650;display:flex;justify-content:space-between;gap:8px}.num{opacity:.55}
      .shot{height:${mode === 'desktop' ? '390px' : '470px'};overflow:hidden;background:#08050d}
      img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
    </style></head><body><h1>Stage 9 · ${mode} · ${start + 1}–${start + items.length}</h1><div class="grid">${items.map((item, index) => `<figure><figcaption><span>${item.slug}</span><span class="num">${String(start + index + 1).padStart(2, '0')}</span></figcaption><div class="shot"><img src="${pathToFileURL(path.join(dir, item.screenshot)).href}"></div></figure>`).join('')}</div></body></html>`
    fs.writeFileSync(htmlPath, html)
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve }))))
    await page.screenshot({ path: path.join(dir, `contact-${mode}-${number}.png`), fullPage: true })
    fs.unlinkSync(htmlPath)
  }
}
await browser.close()
console.log('Contact sheets regenerated from current route screenshots.')
