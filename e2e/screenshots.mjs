// Capture screenshots of the running app at several viewport sizes.
// Usage: node e2e/screenshots.mjs <label> [baseURL]
// Writes docs/screenshots/<label>/<width>-<page>.jpg and prints overflow and broken-image checks.
import {launch} from './browser.mjs'
import {mkdir} from 'node:fs/promises'
import {TRIP_ID, seedGuest} from './fixtures.mjs'

const label = process.argv[2] || 'run'
const base = process.argv[3] || 'http://localhost:3000'
const out = `docs/screenshots/${label}`
const widths = [[320, 640], [360, 760], [375, 812], [390, 844], [430, 932], [768, 1024], [1024, 768], [1440, 900]]
const pages = [
  ['home', '#home'],
  ['chat', '#chat'],
  ['explore', '#discover'],
  ['guide', '#guide'],
  ['trips', '#trips'],
  ['trip-itinerary', `#draft/${TRIP_ID}`],
  ['trip-budget', `#draft/${TRIP_ID}/budget`],
  ['trip-transport', `#draft/${TRIP_ID}/transport`],
  ['trip-bookings', `#draft/${TRIP_ID}/bookings`],
  ['trip-calendar', `#draft/${TRIP_ID}/calendar`],
  ['trip-travel-mode', `#draft/${TRIP_ID}/travel`],
  ['stays', '#stays'],
  ['saved', '#saved'],
  ['signin', '#signin'],
  ['preferences', '#preferences'],
]
const only = process.env.PAGES ? new Set(process.env.PAGES.split(',')) : null
const onlyWidths = process.env.WIDTHS ? new Set(process.env.WIDTHS.split(',').map(Number)) : null

await mkdir(out, {recursive:true})
const browser = await launch()
const report = []
for (const [width, height] of widths) {
  if (onlyWidths && !onlyWidths.has(width)) continue
  const context = await browser.newContext({viewport:{width, height}, isMobile:width < 768, hasTouch:width < 768,
    deviceScaleFactor:1, reducedMotion:'reduce'})
  const page = await context.newPage()
  await seedGuest(page)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  for (const [name, hash] of pages) {
    if (only && !only.has(name)) continue
    await page.goto(base + '/' + hash, {waitUntil:'domcontentloaded'})
    await page.waitForTimeout(name.startsWith('trip') || name === 'guide' ? 5000 : 3000)
    const check = await page.evaluate(() => {
      const scroller = element => { for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        if (['auto', 'scroll', 'hidden', 'clip'].includes(getComputedStyle(node).overflowX)) return true } return false }
      const overflow = [...document.querySelectorAll('main *')].filter(element => {
        const box = element.getBoundingClientRect()
        return box.width && (box.right > innerWidth + 1 || box.left < -1) && getComputedStyle(element).position !== 'fixed' && !scroller(element)
      }).length
      const broken = [...document.images].filter(image => image.complete && image.naturalWidth === 0 && image.getBoundingClientRect().width > 0
        && getComputedStyle(image).visibility !== 'hidden' && !image.closest('[hidden]')).map(image => image.src.slice(0, 80))
      return {scroll:document.documentElement.scrollWidth - innerWidth, overflow, broken}
    })
    await page.screenshot({path:`${out}/${width}-${name}.jpg`, type:'jpeg', quality:80, fullPage:width < 768})
    report.push({width, name, ...check, errors:errors.splice(0)})
  }
  await context.close()
}
await browser.close()
for (const row of report) {
  const issues = [row.scroll > 0 && `scroll ${row.scroll}px`, row.overflow && `${row.overflow} overflowing`, row.broken.length && `${row.broken.length} broken images`,
    row.errors.length && `errors: ${row.errors.join(' | ').slice(0, 120)}`].filter(Boolean)
  console.log(`${String(row.width).padStart(4)} ${row.name.padEnd(15)} ${issues.join(', ') || 'ok'}`)
}
