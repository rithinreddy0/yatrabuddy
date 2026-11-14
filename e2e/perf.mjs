// Measures load metrics of one or more production builds on throttled mobile conditions.
// Usage: GPU=1 node e2e/perf.mjs [label=baseURL ...]
//   default: after=http://localhost:3010 (vite preview of this build)
// Builds are measured alternately in one warmed-up browser so they see the same conditions.
// Reports medians of 5 runs per page: first paint, largest paint, layout shift, and "app ready"
// (when the startup splash is removed and the app can be used).
import {launch} from './browser.mjs'
import {seedGuest, TRIP_ID} from './fixtures.mjs'

const targets = (process.argv.slice(2).length ? process.argv.slice(2) : ['after=http://localhost:3010'])
  .map(item => item.includes('=') ? item.split('=') : ['build', item])
const pages = [['home', '#home'], ['chat', '#chat'], ['trip', `#draft/${TRIP_ID}`]].filter(([name]) => !process.env.PAGES || process.env.PAGES.split(',').includes(name))
const networks = [['slow-4g', {latency:150, download:1.6e6 / 8, upload:750e3 / 8}], ['fast-4g', {latency:60, download:9e6 / 8, upload:9e6 / 8}]]
  .filter(([name]) => !process.env.NETWORKS || process.env.NETWORKS.split(',').includes(name))
const browser = await launch()

async function measure(base, hash, conditions) {
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
    const watch = () => {
      if (window.__ready) return
      if (document.readyState !== 'loading' && !document.querySelector('.startup-status')) window.__ready = performance.now()
      else requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  })
  await page.goto(base + '/' + hash, {waitUntil:'domcontentloaded', timeout:90_000})
  await page.waitForFunction(() => window.__ready, null, {timeout:90_000}).catch(() => {})
  await page.waitForTimeout(2500)
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const bytes = performance.getEntriesByType('resource').reduce((sum, item) => sum + (item.transferSize || 0), nav.transferSize || 0)
    return {fcp:performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? NaN, lcp:window.__lcp, cls:window.__cls,
      ready:window.__ready ?? NaN, kb:bytes / 1024}
  })
  await context.close()
  return metrics
}

// Warm up the browser (GPU process, shader and font caches) before anything is recorded.
for (const [, base] of targets) for (let index = 0; index < 2; index++) await measure(base, '#home', networks[1][1])

const median = (runs, key) => runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor(runs.length / 2)]
for (const [network, conditions] of networks) {
  for (const [name, hash] of pages) {
    const results = Object.fromEntries(targets.map(([label]) => [label, []]))
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const [label, base] of attempt % 2 ? [...targets].reverse() : targets) results[label].push(await measure(base, hash, conditions))
    }
    for (const [label] of targets) {
      const runs = results[label]
      console.log(`${network.padEnd(8)} ${name.padEnd(5)} ${label.padEnd(7)} first paint ${String(Math.round(median(runs, 'fcp'))).padStart(5)} ms · ` +
        `largest paint ${String(Math.round(median(runs, 'lcp'))).padStart(5)} ms · app ready ${String(Math.round(median(runs, 'ready'))).padStart(5)} ms · ` +
        `CLS ${median(runs, 'cls').toFixed(3)} · ${Math.round(median(runs, 'kb'))} KB`)
    }
  }
}
await browser.close()
