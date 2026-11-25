import { chromium } from 'playwright'
const B='http://127.0.0.1:5173'
const b=await chromium.launch({channel:'msedge',headless:true})
const c=await b.newContext({viewport:{width:1440,height:900}})
const p=await c.newPage()
await p.goto(`${B}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1000)
await p.getByText('林晚晴',{exact:true}).last().click({force:true}); await p.waitForTimeout(250)
await p.getByText('登录工作台',{exact:true}).last().click({force:true}); await p.waitForTimeout(900)
async function openFan(){ await p.evaluate(()=>{const t=[...document.querySelectorAll('.rc-entry')].find(e=>e.getAttribute('aria-label')?.includes('项目档案')); t?.dispatchEvent(new MouseEvent('click',{bubbles:true}))}); await p.waitForTimeout(600) }
const out=[]
for (const idx of [0,1,2]) {
  await p.goto(`${B}/`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1400); await openFan()
  const cards=await p.locator('.rc-fan-card').count()
  await p.locator('.rc-fan-card').nth(idx).click(); await p.waitForTimeout(900)
  out.push({idx, cards, path: await p.evaluate(()=>location.pathname), notice: await p.evaluate(()=>{const n=document.querySelector('.rc-route-notice'); return n?n.textContent?.trim():null})})
}
console.log(JSON.stringify(out))
await b.close()
