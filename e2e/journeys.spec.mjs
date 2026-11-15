import {expect, test} from '@playwright/test'
import {TRIP_ID, seedGuest} from './fixtures.mjs'

const noSideScroll = async page => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0)

test.beforeEach(async ({page}) => {
  await seedGuest(page)
})

test('home leads straight into planning', async ({page}) => {
  await page.goto('/#home')
  const prompt = page.getByLabel('Describe your trip')
  await expect(prompt).toBeVisible()
  // The planner is usable without scrolling on a phone.
  const box = await prompt.boundingBox()
  expect(box.y + box.height).toBeLessThan(page.viewportSize().height)
  await noSideScroll(page)
  await prompt.fill('2 days in Hyderabad for 2 people from Bengaluru, budget 15000 rupees')
  await page.getByRole('button', {name:'Plan', exact:true}).click()
  await expect(page).toHaveURL(/#chat/)
  await expect(page.getByText('2 days in Hyderabad for 2 people from Bengaluru', {exact:false}).first()).toBeVisible()
})

test('empty plan button focuses the trip box instead of doing nothing', async ({page}) => {
  await page.goto('/#home')
  await page.getByRole('button', {name:'Plan', exact:true}).click()
  await expect(page.getByLabel('Describe your trip')).toBeFocused()
})

test('saved trip shows the journey from home and back', async ({page}) => {
  await page.goto(`/#draft/${TRIP_ID}`)
  await expect(page.getByRole('region', {name:'Journey there'})).toContainText('Leave Hyderabad')
  await expect(page.getByRole('region', {name:'Journey there'})).toContainText('HYB → THVM')
  await expect(page.getByRole('region', {name:'Journey home'})).toContainText('Home at Hyderabad')
  await noSideScroll(page)
})

test('budget totals and settlement come from the trip ledger', async ({page}) => {
  await page.goto(`/#draft/${TRIP_ID}/budget`)
  const budget = page.getByRole('region', {name:'Trip budget'})
  await expect(budget).toContainText('₹6,200')
  await expect(budget).toContainText('Asha pays Ravi ₹1,900')
  await noSideScroll(page)
})

test('transport tab offers real arrival points and switches modes', async ({page}) => {
  await page.goto(`/#draft/${TRIP_ID}/transport`)
  await expect(page.getByRole('heading', {name:'Getting there'})).toBeVisible()
  await expect(page.getByText('Home to home')).toBeVisible()
  const tabs = page.getByRole('group', {name:'Ways to get there'})
  await expect(tabs).toBeVisible({timeout:20_000})
  await tabs.getByRole('button', {name:/Fly/}).click()
  await expect(page.locator('#tt-fly')).toBeVisible()
  await noSideScroll(page)
})

test('chat failure shows a clear error with retry', async ({page}) => {
  await page.route('**/api/planning-agent/**', route => route.abort('connectionfailed'))
  await page.goto('/#chat')
  const box = page.getByPlaceholder(/Where do you want to go|Ask or change this trip/)
  await box.fill('3 days in Goa')
  await box.press('Enter')
  await expect(page.locator('.agent-error')).toBeVisible()
  await expect(page.locator('.agent-error').getByRole('button', {name:/Retry/})).toBeVisible()
})

test('back and forward navigation and refresh keep the app usable', async ({page}) => {
  await page.goto('/#home')
  await page.goto('/#trips')
  await expect(page.getByRole('heading', {name:'My trips'})).toBeVisible()
  await page.goBack()
  await expect(page.getByLabel('Describe your trip')).toBeVisible()
  await page.goForward()
  await expect(page.getByRole('heading', {name:'My trips'})).toBeVisible()
  await page.reload()
  await expect(page.getByText('Mapusa').first()).toBeVisible()
})

test('very long input is capped, not broken', async ({page}) => {
  await page.goto('/#home')
  const prompt = page.getByLabel('Describe your trip')
  await prompt.fill('Goa '.repeat(200))
  expect((await prompt.inputValue()).length).toBeLessThanOrEqual(260)
  await noSideScroll(page)
})

for (const width of [320, 360, 768]) {
  test(`key pages fit a ${width}px screen`, async ({page}) => {
    test.skip(test.info().project.name !== 'mobile', 'width sweep runs once')
    await page.setViewportSize({width, height:800})
    for (const hash of ['#home', '#chat', '#discover', '#guide', `#draft/${TRIP_ID}`, `#draft/${TRIP_ID}/budget`, `#draft/${TRIP_ID}/transport`]) {
      await page.goto('/' + hash)
      await page.waitForLoadState('networkidle').catch(() => {})
      await noSideScroll(page)
    }
  })
}
