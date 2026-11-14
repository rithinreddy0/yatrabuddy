import test from 'node:test'
import assert from 'node:assert/strict'
import {comparable, durationMinutes, rankTransport} from './transportRanking.mjs'

const leg = vehicle => ({vehicle, board:{}, alight:{}})
const quotes = {
  flights:{status:'ready', source:'Duffel', options:[
    {price:{currency:'INR', amount:'6400'}, duration:'PT1H15M', legs:[leg('Flight')]},
    {price:{currency:'INR', amount:'4900'}, duration:'PT5H10M', legs:[leg('Flight'), leg('Flight')]},
  ]},
  transit:{status:'ready', source:'Google Routes', options:[
    {duration:'43200s', legs:[leg('HEAVY_RAIL')]},
  ]},
  driving:{status:'ready'},
}

test('durations in seconds and ISO 8601 are understood', () => {
  assert.equal(durationMinutes('5400s'), 90)
  assert.equal(durationMinutes('PT2H30M'), 150)
  assert.equal(durationMinutes('P1DT1H'), 1500)
  assert.equal(durationMinutes('soon'), null)
})

test('each priority puts the matching option first and explains why', () => {
  const rows = comparable(quotes)
  assert.equal(rows.length, 3)
  const cheapest = rankTransport(rows, 'cheapest')
  assert.equal(cheapest[0].fare, 4900)
  assert.match(cheapest[0].reason, /lowest fare of 3/)
  assert.match(cheapest.at(-1).reason, /no fare published/)
  const fastest = rankTransport(rows, 'fastest')
  assert.equal(fastest[0].minutes, 75)
  assert.match(fastest[0].reason, /shortest journey · direct/)
  const comfort = rankTransport(rows, 'comfort')
  assert.equal(comfort.at(-1).changes, 1)
  assert.equal(rankTransport(rows, 'value')[0].minutes, 75)
})

test('mixed currencies are not compared on price', () => {
  const rows = comparable({flights:{status:'ready', options:[
    {price:{currency:'INR', amount:'5000'}, duration:'PT2H', legs:[leg('Flight')]},
    {price:{currency:'USD', amount:'50'}, duration:'PT3H', legs:[leg('Flight')]},
  ]}})
  const ranked = rankTransport(rows, 'cheapest')
  assert.match(ranked[0].reason, /fares could not be compared/)
  assert.doesNotMatch(ranked[0].reason, /lowest fare/)
})
