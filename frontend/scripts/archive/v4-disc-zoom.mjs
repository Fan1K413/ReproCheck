import { chromium } from 'playwright'
const BASE='http://127.0.0.1:5173'
const b=await chromium.launch({channel:'msedge',headless:true})
const c=await b.newContext({viewport:{width:1440,height:900},deviceScaleFactor:2})
const p=await c.newPage()
await p.goto(`${BASE}/login`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1000)
await p.getByText('林晚晴',{exact:true}).last().click({force:true}); await p.waitForTimeout(300)
await p.getByText('登录工作台',{exact:true}).last().click({force:true}); await p.waitForTimeout(1200)
await p.goto(`${BASE}/`,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2500)
const box=await p.evaluate(()=>{const d=document.querySelector('.rc-disc-shell').getBoundingClientRect(); return {x:d.x,y:d.y,width:d.width,height:d.height}})
await p.screenshot({path:'../.screenshots/v4-l1-disc-2x.png', clip:{x:Math.max(0,box.x-40),y:Math.max(0,box.y-40),width:Math.min(1440,box.width+80),height:Math.min(900,box.height+80)}})
console.log(JSON.stringify(box))
await b.close()
