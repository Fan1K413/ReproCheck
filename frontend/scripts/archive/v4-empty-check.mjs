import { chromium } from 'playwright'
const BASE='http://127.0.0.1:5173'
const b=await chromium.launch({channel:'msedge',headless:true})
const c=await b.newContext({viewport:{width:1440,height:900}})
const p=await c.newPage()
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1000)
await p.getByText('林晚晴',{exact:true}).last().click({force:true}); await p.waitForTimeout(250)
await p.getByText('登录工作台',{exact:true}).last().click({force:true}); await p.waitForTimeout(900)
await p.route('**/api/v1/projects**', async (route) => {
  if (route.request().method() !== 'GET') return route.continue()
  return route.fulfill({status:200, contentType:'application/json', body: JSON.stringify({success:true,data:{items:[],total:0},error:null,request_id:'ui-empty-check'})})
})
await p.goto(`${BASE}/projects`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1600)
const info=await p.evaluate(()=>({kpi:[...document.querySelectorAll('.rc2-kpi__value')].map(n=>n.textContent), emptyTitle:document.querySelector('.rc-empty, [class*=empty]')?.textContent?.trim().slice(0,80), createHref:document.querySelector('.rc2-card a[href="/projects/new"]')?.getAttribute('href'), area:document.querySelector('.rc2-card')?.getBoundingClientRect().height}))
await p.screenshot({path:'../.screenshots/v4-final-empty.png'})
console.log(JSON.stringify(info))
await b.close()
