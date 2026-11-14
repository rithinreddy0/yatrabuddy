import test from 'node:test'
import assert from 'node:assert/strict'
import {arrivalPoint, dayLegs, distanceAdvice, flightsSearch, fuelEstimate, legMode, trainSchedule} from './tripTransportPlan.mjs'

const place = (name, lat, lon) => ({name, lat, lon, url:'https://example.com/' + name})

test('arrival point prefers the stay, then the first stop', () => {
  const stay = place('Hotel', 15.6, 73.8)
  assert.equal(arrivalPoint({stay, days:[[place('Fort', 15.5, 73.7)]]}).isStay, true)
  assert.equal(arrivalPoint({days:[[{name:'No coords'}], [place('Fort', 15.5, 73.7)]]}).name, 'Fort')
  assert.equal(arrivalPoint({days:[[]]}), null)
})

test('provider links carry the route', () => {
  assert.match(new URL(flightsSearch('HYD', 'GOX', '2026-12-10')).searchParams.get('q'), /Flights from HYD to GOX on 2026-12-10/)
  assert.equal(trainSchedule({name:'Hyderabad Deccan Nampally', code:'HYB'}, {name:'Thivim', code:'THVM'}),
    'https://erail.in/trains-between-stations/hyderabad-deccan-nampally-HYB/thivim-THVM')
  assert.equal(trainSchedule({name:'X'}, {name:'Thivim', code:'THVM'}), null)
})

test('fuel estimate uses the stated assumptions and splits per traveller', () => {
  assert.deepEqual(fuelEstimate(658, 15, 105, 2), {litres:44, cost:4606, perPerson:2303})
  assert.equal(fuelEstimate(658, 0, 105), null)
})

test('distance advice is general and scaled to the trip', () => {
  assert.match(distanceAdvice(534, 658), /overnight/)
  assert.match(distanceAdvice(1200, null), /Flying usually/)
  assert.equal(distanceAdvice(null, null), null)
})

test('leg mode follows distance and the trip preferences', () => {
  assert.equal(legMode({kilometres:0.6}).label, 'Walk')
  assert.equal(legMode({kilometres:4}).label, 'Auto or cab')
  assert.equal(legMode({kilometres:14}).label, 'Cab')
  assert.equal(legMode({kilometres:4}, ['Bus']).travelmode, 'transit')
  assert.equal(legMode({kilometres:0.6}, ['Cab']).label, 'Cab')
})

test('day legs start from the stay and total the stored estimates', () => {
  const stay = place('Hotel', 15.6, 73.8)
  const draft = {stay, days:[[place('A', 15.5, 73.9), place('B', 15.49, 73.82)]],
    routes:[[{kilometres:11.1, minutes:15, method:'road'}, {kilometres:9.4, minutes:20, method:'road'}]]}
  const [day] = dayLegs(draft)
  assert.equal(day.legs.length, 2)
  assert.equal(day.legs[0].from.name, 'Hotel')
  assert.equal(day.kilometres, 20.5)
  assert.equal(day.minutes, 35)
})
