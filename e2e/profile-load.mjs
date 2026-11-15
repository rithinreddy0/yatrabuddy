// CPU profile of the home page load (4x CPU slowdown). Usage: [GPU=1] node e2e/profile-load.mjs [baseURL]
import {launch} from './browser.mjs'
const browser = await launch()
const context = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true})
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Emulation.setCPUThrottlingRate', {rate:4})
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', {interval:200})
await cdp.send('Profiler.start')
const started = Date.now()
await page.goto((process.argv[2] || 'http://localhost:3010') + '/#home', {waitUntil:'domcontentloaded', timeout:60_000})
await page.waitForFunction(() => !document.querySelector('.startup-status'), null, {timeout:60_000}).catch(() => {})
const ready = Date.now() - started
await page.waitForTimeout(1500)
const {profile} = await cdp.send('Profiler.stop')
const fcp = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime)
// Self time per function.
const byId = new Map(profile.nodes.map(node => [node.id, node]))
const self = new Map()
const deltas = profile.timeDeltas
profile.samples.forEach((id, index) => {
  const node = byId.get(id)
  const frame = node.callFrame
  const key = `${frame.functionName || '(anon)'} ${frame.url.replace(/^.*\//, '')}:${frame.lineNumber}`
  self.set(key, (self.get(key) || 0) + (deltas[index] || 0) / 1000)
})
console.log('FCP', Math.round(fcp), 'splash gone after', ready, 'ms')
for (const [key, ms] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(Math.round(ms).toString().padStart(6), key)
await browser.close()
