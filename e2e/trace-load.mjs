// Breaks the home page load down by browser task type (layout, style, paint, script). Usage: [GPU=1] node e2e/trace-load.mjs [baseURL]
import {launch} from './browser.mjs'
const browser = await launch()
const context = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', {rate:4})
const events = []
cdp.on('Tracing.dataCollected', ({value}) => events.push(...value))
const done = new Promise(resolve => cdp.once('Tracing.tracingComplete', resolve))
await cdp.send('Tracing.start', {categories:'devtools.timeline,disabled-by-default-devtools.timeline', transferMode:'ReportEvents'})
await page.goto((process.argv[2] || 'http://localhost:3010') + '/#home', {waitUntil:'domcontentloaded', timeout:60_000})
await page.waitForFunction(() => !document.querySelector('.startup-status'), null, {timeout:60_000}).catch(() => {})
await page.waitForTimeout(1000)
await cdp.send('Tracing.end')
await done
const totals = new Map()
const longest = []
for (const event of events) {
  if (event.ph !== 'X' || !event.dur) continue
  if (!/^(UpdateLayoutTree|Layout|Paint|ParseAuthorStyleSheet|EvaluateScript|FunctionCall|v8\.compile|Decode Image|ImageDecodeTask|RecalculateStyles|PrePaint|Commit|Layerize|ParseHTML|TimerFire|EventDispatch|RunMicrotasks|v8\.run|HitTest|ScheduleStyleRecalculation|UpdateLayer|CompositeLayers|RasterTask|GPUTask)$/.test(event.name)) continue
  totals.set(event.name, (totals.get(event.name) || 0) + event.dur / 1000)
  longest.push([event.dur / 1000, event.name, JSON.stringify(event.args?.data || event.args?.beginData || {}).slice(0, 400)])
}
for (const [name, ms] of [...totals].sort((a, b) => b[1] - a[1])) console.log(Math.round(ms).toString().padStart(7), name)
console.log('--- longest')
for (const row of longest.sort((a, b) => b[0] - a[0]).slice(0, 12)) console.log(Math.round(row[0]).toString().padStart(7), row[1], row[2])
await browser.close()
