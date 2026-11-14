// Drives real conversations through the chat UI against the live planner and public data sources.
// Usage: node e2e/live-scenarios.mjs [scenario...]   Output: docs/screenshots/scenarios/*.png and a text log.
import {chromium} from '@playwright/test'
import {mkdir, writeFile} from 'node:fs/promises'

const base = process.env.BASE_URL || 'http://localhost:3000'
const out = 'docs/screenshots/scenarios'
const scenarios = {
  budget:['Plan 3 days in Goa from Hyderabad for 2 people, budget 12000 rupees, cheapest options please', 'Panaji', 'How do I get there cheaply?'],
  family:['We are a family of 4 with two kids going to Kerala for 5 days from Bengaluru, budget 60000 rupees, relaxed pace', 'Kochi', 'Add a rest break in the afternoons'],
  modify:['Plan 3 days in Mapusa, Goa for 2 people from Hyderabad, budget 20000 rupees',
    'Reduce the budget to 15000', 'Add Fort Aguada', 'Remove Miramar Beach', 'Change the dates to 20 December 2026'],
  invalid:['Plan 2 days in Qwertyvillezzz for 2 people from Hyderabad, budget 10000'],
  question:['Where can I stay near Calangute beach?'],
}
const chosen = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios)

await mkdir(out, {recursive:true})
const browser = await chromium.launch({channel:'msedge'})
const log = []
for (const name of chosen) {
  const context = await browser.newContext({viewport:{width:390, height:844}, isMobile:true, hasTouch:true})
  const page = await context.newPage()
  await page.goto(`${base}/#chat/new-${Date.now()}`)
  log.push(`\n## ${name}`)
  for (const [index, message] of scenarios[name].entries()) {
    const box = page.locator('textarea').first()
    await box.waitFor({timeout:20_000})
    const before = await page.locator('.agent-reply, .agent-message').count()
    const started = Date.now()
    await box.fill(message)
    await box.press('Enter')
    // Wait for the reply to finish: a new reply exists and no Stop control is showing.
    await page.waitForFunction(count => document.querySelectorAll('.agent-reply, .agent-message').length > count
      && !document.querySelector('[aria-label="Stop response"]'), before, {timeout:90_000, polling:500}).catch(() => {})
    await page.waitForTimeout(2500)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const reply = await page.evaluate(() => {
      const replies = [...document.querySelectorAll('.agent-reply, .agent-message')]
      return (replies.at(-1)?.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 1400)
    })
    const errors = await page.locator('.agent-error').allInnerTexts()
    log.push(`> ${message}  (${seconds}s)`, reply, ...errors.map(text => 'ERROR: ' + text))
    await page.screenshot({path:`${out}/${name}-${index + 1}.png`, fullPage:false})
  }
  await context.close()
}
await browser.close()
await writeFile(`${out}/transcript.md`, '# Live scenario transcript\n' + log.join('\n') + '\n')
console.log(log.join('\n'))
