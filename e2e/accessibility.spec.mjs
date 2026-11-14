import {expect, test} from '@playwright/test'
import {TRIP_ID, seedGuest} from './fixtures.mjs'

// Basic, dependency-free accessibility checks on the main screens.
const screens = ['#home', '#chat', '#discover', '#guide', '#trips', '#preferences', `#draft/${TRIP_ID}`,
  `#draft/${TRIP_ID}/budget`, `#draft/${TRIP_ID}/transport`, `#draft/${TRIP_ID}/bookings`]

test.beforeEach(async ({page}) => {
  await seedGuest(page)
})

for (const hash of screens) {
  test(`accessible names and labels on ${hash}`, async ({page}) => {
    await page.goto('/' + hash)
    await page.waitForTimeout(2500)
    const problems = await page.evaluate(() => {
      const visible = element => {
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && !element.closest('[hidden],[aria-hidden="true"],[inert]')
      }
      const name = element => (element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') && document.getElementById(element.getAttribute('aria-labelledby'))?.textContent
        || element.textContent || element.getAttribute('title') || element.querySelector('img[alt]')?.getAttribute('alt') || '').trim()
      const issues = []
      for (const element of document.querySelectorAll('main button, main a[href], nav button, nav a[href]')) {
        if (visible(element) && !name(element)) issues.push('unnamed control: ' + element.outerHTML.slice(0, 100))
      }
      for (const image of document.querySelectorAll('main img')) {
        if (visible(image) && !image.hasAttribute('alt')) issues.push('image without alt: ' + image.src.slice(0, 80))
      }
      for (const field of document.querySelectorAll('main input:not([type=hidden]), main select, main textarea')) {
        if (!visible(field)) continue
        const labelled = field.getAttribute('aria-label') || field.getAttribute('aria-labelledby') || field.closest('label')
          || (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)) || field.getAttribute('title')
        if (!labelled) issues.push('unlabelled field: ' + field.outerHTML.slice(0, 100))
      }
      if (!document.querySelector('main h1')) issues.push('no h1 heading')
      return issues
    })
    expect(problems, problems.join('\n')).toEqual([])
  })
}
