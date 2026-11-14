// Measures load metrics for the production build on a throttled mobile connection.
// Usage: node e2e/perf.mjs [baseURL]   (default http://localhost:3010, the `vite preview` server)
import {chromium} from '@playwright/test'
import {seedGuest, TRIP_ID} from './fixtures.mjs'

const base = process.argv[2] || 'http://localhost:3010'
const pages = [['home', '#home'], ['chat', '#chat'], ['trip', `#draft/${TRIP_ID}`]]
const browser = await chromium.launch({channel:'msedge'})
for (const [network, conditions] of [['fast-4g', {latency:60, download:9e6 / 8, upload:9e6 / 8}],
  ['slow-4g', {latency:150, download:1.6e6 / 8, upload:750e3 / 8}]]) {
  for (const [name, hash] of pages) {
    const runs = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const context = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true})
      const page = await context.newPage()
      await seedGuest(page)
      const cdp = await context.newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', {offline:false, latency:conditions.latency,
        downloadThroughput:conditions.download, uploadThroughput:conditions.upload})
      await cdp.send('Emulation.setCPUThrottlingRate', {rate:4})
      await page.addInitScript(() => {
        window.__lcp = 0
        window.__cls = 0
        new PerformanceObserver(list => { for (const entry of list.getEntries()) window.__lcp = entry.startTime }).observe({type:'largest-contentful-paint', buffered:true})
        new PerformanceObserver(list => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value }).observe({type:'layout-shift', buffered:true})
      })
      await page.goto(base + '/' + hash, {waitUntil:'domcontentloaded', timeout:60_000})
      await page.waitForTimeout(6000)
      const metrics = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        const bytes = performance.getEntriesByType('resource').reduce((sum, item) => sum + (item.transferSize || 0), nav.transferSize || 0)
        const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime
        return {fcp, lcp:window.__lcp, cls:window.__cls, load:nav.loadEventEnd || null, dcl:nav.domContentLoadedEventEnd, kb:bytes / 1024}
      })
      runs.push(metrics)
      await context.close()
    }
    const median = key => runs.map(run => run[key]).sort((a, b) => a - b)[1]
    console.log(`${network.padEnd(8)} ${name.padEnd(6)} FCP ${Math.round(median('fcp'))} ms · LCP ${Math.round(median('lcp'))} ms · CLS ${median('cls').toFixed(3)} · DOM ready ${Math.round(median('dcl'))} ms · ${Math.round(median('kb'))} KB`)
  }
}
await browser.close()
