import test from 'node:test'
import assert from 'node:assert/strict'
import {journeyCost, journeyEvents, journeyTemplate, legSteps, transferPairs} from './journey.mjs'

const home = {name:'Hyderabad', lat:17.38, lon:78.48}
const stay = {name:'Hotel Satyaheera', lat:15.59, lon:73.81}
const flight = {mode:'flight', date:'2026-12-10', departTime:'06:05', arriveTime:'07:30', service:'6E 512',
  fromHub:{name:'Rajiv Gandhi International Airport', code:'HYD', lat:17.23, lon:78.43},
  toHub:{name:'Manohar International Airport', code:'GOX', lat:15.73, lon:73.86},
  firstTransfer:{kilometres:31.5, minutes:45}, lastTransfer:{kilometres:22, minutes:35}}

test('an early flight works back to a leave-home time', () => {
  const steps = legSteps(flight, {direction:'outbound', home, stay})
  const leave = steps.find(step => step.kind === 'leave')
  // 06:05 - 120 min buffer - 45 min transfer = 03:20 the same day
  assert.equal(leave.minute, 200)
  assert.equal(leave.date, '2026-12-10')
  assert.equal(leave.suggested, true)
  const door = steps.at(-1)
  assert.equal(door.title, 'Arrive at Hotel Satyaheera')
  assert.equal(door.minute, 450 + 30 + 35)
})

test('an overnight return train lands on the next day', () => {
  const train = {mode:'train', date:'2026-12-12', departTime:'22:10', arriveTime:'13:40', service:'Goa Express',
    fromHub:{name:'Thivim', code:'THVM'}, toHub:{name:'Hyderabad Deccan', code:'HYB'}, lastTransfer:{kilometres:3, minutes:12}}
  const steps = legSteps(train, {direction:'return', home, stay})
  assert.match(steps[0].title, /Check out and leave Hotel Satyaheera/)
  assert.equal(steps[0].minute, null) // no transfer estimate from the stay, so no "leave by" guess
  const arriveHub = steps.find(step => step.kind === 'arrive-hub')
  assert.equal(arriveHub.date, '2026-12-13')
  assert.equal(steps.at(-1).title, 'Home at Hyderabad')
  assert.equal(steps.at(-1).date, '2026-12-13')
})

test('a drive without an arrival time is estimated and labelled', () => {
  const steps = legSteps({mode:'drive', date:'2026-12-10', departTime:'05:00', mainKilometres:658, mainMinutes:509}, {direction:'outbound', home, stay})
  assert.equal(steps.length, 3)
  assert.equal(steps.at(-1).minute, 809) // 05:00 + 8 h 29 min = 13:29
  assert.equal(steps.at(-1).suggested, true)
})

test('template picks coded hubs and sets the return on the last trip day', () => {
  const plan = {origin:home, road:{kilometres:658, minutes:509}, hubs:{
    origin:{airports:[{name:'RGIA', code:'HYD', lat:17.2, lon:78.4}], stations:[{name:'Halt', code:null}, {name:'Hyderabad Deccan', code:'HYB', lat:17.39, lon:78.47}]},
    destination:{airports:[{name:'Mopa', code:'GOX', lat:15.7, lon:73.8}], stations:[{name:'Thivim', code:'THVM', lat:15.6, lon:73.8}]}}}
  const draft = {departure:'2026-12-10', days:[[], [], []], origin:'Hyderabad'}
  const journey = journeyTemplate('train', {draft, plan})
  assert.equal(journey.outbound.fromHub.code, 'HYB')
  assert.equal(journey.returnLeg.toHub.code, 'HYB')
  assert.equal(journey.returnLeg.date, '2026-12-12')
  const drive = journeyTemplate('drive', {draft, plan})
  assert.equal(drive.outbound.mainMinutes, 509)
  assert.equal(drive.outbound.fromHub, null)
  assert.deepEqual(transferPairs(journey, stay).map(([key, field]) => key + '.' + field),
    ['outbound.firstTransfer', 'outbound.lastTransfer', 'returnLeg.firstTransfer', 'returnLeg.lastTransfer'])
})

test('costs and calendar events cover both directions', () => {
  const journey = {home, outbound:{...flight, estimatedCost:9000}, returnLeg:{mode:'bus', date:'2026-12-12', estimatedCost:1800}}
  assert.equal(journeyCost(journey), 10800)
  const [out, back] = journeyEvents(journey)
  assert.equal(out.start, 365)
  assert.equal(out.end, 450)
  assert.match(out.title, /Journey out: Flight 6E 512 HYD → GOX/)
  assert.equal(back.start, null)
})

test('travel mode shows journey steps on the trip days', async () => {
  const {travelTimeline} = await import('./travelTimeline.mjs')
  const draft = {departure:'2026-12-10', days:[[], [], []], stay, journey:{home, outbound:flight,
    returnLeg:{mode:'train', date:'2026-12-12', departTime:'22:10', arriveTime:'13:40', arriveNextDay:true, fromHub:{name:'Thivim', code:'THVM'}, toHub:{name:'Hyderabad Deccan', code:'HYB'}}}}
  const first = travelTimeline(draft, [], 0)
  assert.ok(first.events.some(event => event.title === 'Leave Hyderabad' && event.minute === 200))
  const last = travelTimeline(draft, [], 3)
  assert.ok(last.events.some(event => /Arrive at Hyderabad Deccan/.test(event.title)))
  assert.equal(last.dayCount, 4)
})

test('calendar export includes timed journey events', async () => {
  const {tripCalendar} = await import('./tripOverview.mjs')
  const text = tripCalendar({id:'x', name:'Goa', departure:'2026-12-10', days:[[]], journey:{home, outbound:flight}}, new Date('2026-11-14T00:00:00Z'))
  assert.match(text, /DTSTART:20261210T060500/)
  assert.match(text, /DTEND:20261210T073000/)
  assert.match(text, /SUMMARY:Journey out: Flight 6E 512 HYD → GOX/)
})

test('date checks compare the journey with the trip days', async () => {
  const {journeyChecks, arrivalDate} = await import('./journey.mjs')
  const overnight = {mode:'train', date:'2026-12-10', departTime:'17:40', arriveTime:'08:50', arriveNextDay:true}
  const journey = {home, outbound:overnight, returnLeg:{mode:'train', date:'2026-12-12'}}
  assert.equal(arrivalDate(journey, stay), '2026-12-11')
  const issues = journeyChecks({departure:'2026-12-11', days:[[], [], []]}, journey)
  assert.equal(issues.length, 1)
  assert.match(issues[0], /before Day 3/)
  assert.deepEqual(journeyChecks({departure:'2026-12-11', days:[[], []]}, journey), [])
  assert.match(journeyChecks({departure:'2026-12-10', days:[[], []]}, journey)[0], /after Day 1/)
})

test('travel mode adds a travel day when you leave the day before Day 1', async () => {
  const {travelTimeline} = await import('./travelTimeline.mjs')
  const draft = {departure:'2026-12-11', days:[[], []], stay, journey:{home,
    outbound:{mode:'train', date:'2026-12-10', departTime:'17:40', arriveTime:'08:50', arriveNextDay:true,
      fromHub:{name:'Hyderabad Deccan', code:'HYB', lat:17.39, lon:78.47}, firstTransfer:{kilometres:3, minutes:6}}}}
  const timeline = travelTimeline(draft, [], -1)
  assert.equal(timeline.firstDay, -1)
  assert.ok(timeline.events.some(event => event.title === 'Leave Hyderabad'))
})
