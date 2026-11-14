import test from 'node:test'
import assert from 'node:assert/strict'
import {balances, ledgerCsv, settlement, summarizeBudget} from './budgetLedger.mjs'

const stop = url => ({url, name:url, category:'Sight'})
const draft = (ledger, extra = {}) => ({name:'Goa', budget:20000, days:[[stop('a'), stop('b')]], stopCosts:{a:500, gone:900}, ledger, ...extra})
const expense = (id, fields) => ({id, kind:'expense', category:'Food', amount:100, split:[], ...fields})

test('budget dashboard separates spent, committed and expected costs', () => {
  const ledger = {categoryBudgets:{Food:3000, Stay:6000}, contingency:2000, members:[], expenses:[
    expense('1', {amount:1200}),
    expense('2', {category:'Stay', amount:5000, bookingId:'hotel'}),
    expense('3', {category:'Stay', kind:'refund', amount:500}),
  ]}
  const bookings = [
    {id:'hotel', status:'confirmed', bookingType:'Stay', amount:5000}, // already paid via expense 2
    {id:'train', status:'confirmed', bookingType:'Train', amount:2400},
    {id:'bus', status:'link_opened', bookingType:'Bus', amount:900}, // not confirmed, not counted
  ]
  const summary = summarizeBudget(draft(ledger), bookings)
  const row = name => summary.categories.find(item => item.category === name)
  assert.equal(summary.spent, 5700)
  assert.equal(row('Stay').spent, 4500)
  assert.equal(row('Transport').committed, 2400)
  assert.equal(row('Attractions').estimate, 500) // the stop that left the itinerary is ignored
  assert.equal(summary.committed, 2400)
  // Food 3000 - 1200 left, Stay 6000 - 4500, Transport 2400 committed, Attractions 500 estimate.
  assert.equal(summary.remainingCosts, 1800 + 1500 + 2400 + 500)
  assert.equal(summary.remainingBudget, 14300)
  assert.equal(summary.finalBalance, 14300 - 6200)
  assert.equal(summary.pendingBookings, 1)
  assert.deepEqual(summary.warnings, [])
})

test('overspending and over-allocation produce warnings', () => {
  const ledger = {categoryBudgets:{Food:1000, Stay:19000}, contingency:2000, members:[], expenses:[expense('1', {amount:1500})]}
  const summary = summarizeBudget(draft(ledger))
  assert.ok(summary.categories.find(item => item.category === 'Food').over)
  assert.ok(summary.warnings.some(text => text.includes('more than the total budget')))
  assert.ok(summary.warnings.some(text => text.startsWith('Food')))
})

test('uneven splits settle to the exact paisa', () => {
  const ledger = {members:['Asha', 'Ravi', 'Meena'], expenses:[
    expense('1', {amount:100, payer:'Asha'}),
    expense('2', {amount:60, payer:'Ravi', split:['Ravi', 'Meena']}),
  ]}
  const net = balances(ledger)
  assert.equal(Object.values(net).reduce((a, b) => a + b, 0), 0)
  assert.equal(net.Asha, 10000 - 3334)
  const transfers = settlement(ledger)
  const after = {...net}
  for (const item of transfers) { after[item.from] += item.paise; after[item.to] -= item.paise }
  assert.ok(Object.values(after).every(value => value === 0))
  assert.ok(transfers.length <= 2)
})

test('refunds reduce what the payer is owed', () => {
  const ledger = {members:['A', 'B'], expenses:[expense('1', {amount:1000, payer:'A'}), expense('2', {kind:'refund', amount:400, payer:'A'})]}
  assert.deepEqual(settlement(ledger), [{from:'B', to:'A', paise:30000}])
})

test('CSV export neutralises spreadsheet formulas', () => {
  const text = ledgerCsv(draft({members:['A'], expenses:[expense('1', {note:'=HYPERLINK("x")', payer:'A'})]}))
  assert.match(text, /"'=HYPERLINK\(""x""\)"/)
})
