// Trip budget arithmetic. Every amount is whole rupees on input; shares are worked out in
// paise so splitting ₹100 three ways still adds back up to exactly ₹100.

export const LEDGER_CATEGORIES = ['Transport', 'Stay', 'Food', 'Attractions', 'Shopping', 'Local travel', 'Miscellaneous']

export const BOOKING_STATUSES = [
  ['suggested', 'Suggested option'],
  ['link_opened', 'Booking link opened'],
  ['pending', 'Pending confirmation'],
  ['confirmed', 'Confirmed'],
  ['cancelled', 'Cancelled'],
  ['refunded', 'Refunded'],
]
export const BOOKING_TYPES = ['Flight', 'Train', 'Bus', 'Stay', 'Activity', 'Car or cab', 'Other']

const typeCategory = {Flight:'Transport', Train:'Transport', Bus:'Transport', Stay:'Stay',
  Activity:'Attractions', 'Car or cab':'Local travel', Other:'Miscellaneous'}

export function bookingCategory(booking) {
  return typeCategory[booking?.bookingType] || 'Miscellaneous'
}

export function statusLabel(status) {
  return BOOKING_STATUSES.find(([id]) => id === status)?.[1] || 'Status not set'
}

export function emptyLedger() {
  return {categoryBudgets:{}, contingency:0, members:[], expenses:[]}
}

const blank = () => Object.fromEntries(LEDGER_CATEGORIES.map(category => [category, 0]))

/** Ledger totals for the Costs dashboard. Pure: the same inputs always give the same numbers. */
export function summarizeBudget(draft, bookings = []) {
  const ledger = {...emptyLedger(), ...(draft.ledger || {})}
  const stopUrls = new Set(draft.days.flat().map(stop => stop.url))
  const estimate = blank()
  for (const [url, amount] of Object.entries(draft.stopCosts || {})) {
    if (stopUrls.has(url) && Number.isFinite(amount)) estimate.Attractions += amount
  }
  const actual = blank()
  const refunds = blank()
  for (const expense of ledger.expenses) {
    if (!LEDGER_CATEGORIES.includes(expense.category)) continue
    if (expense.kind === 'refund') refunds[expense.category] += expense.amount
    else actual[expense.category] += expense.amount
  }
  // A confirmed booking is money the group owes even before anyone logs paying it. Once an
  // expense is linked to it, the expense is the record, so the booking is not counted twice.
  const paidBookings = new Set(ledger.expenses.map(expense => expense.bookingId).filter(Boolean))
  const committed = blank()
  const confirmed = bookings.filter(booking => booking.status === 'confirmed')
  for (const booking of confirmed) {
    if (Number.isFinite(booking.amount) && !paidBookings.has(booking.id)) committed[bookingCategory(booking)] += booking.amount
  }
  const categories = LEDGER_CATEGORIES.map(category => {
    const budget = Number.isFinite(ledger.categoryBudgets[category]) ? ledger.categoryBudgets[category] : null
    const spent = actual[category] - refunds[category]
    const plan = budget ?? estimate[category]
    const expected = Math.max(plan, spent + committed[category])
    return {category, budget, estimate:estimate[category], spent, refunds:refunds[category],
      committed:committed[category], expected, remaining:Math.max(0, expected - spent),
      over:budget != null && spent + committed[category] > budget}
  })
  const sum = key => categories.reduce((total, row) => total + row[key], 0)
  const spent = sum('spent')
  const expected = sum('expected')
  const remainingCosts = sum('remaining')
  const allocated = categories.reduce((total, row) => total + (row.budget || 0), 0) + (ledger.contingency || 0)
  const total = draft.budget ?? null
  const warnings = []
  if (total != null && allocated > total) warnings.push(`Category budgets and the reserve add up to more than the total budget.`)
  for (const row of categories) if (row.over) warnings.push(`${row.category} is above its budget.`)
  if (total != null && expected > total - (ledger.contingency || 0)) warnings.push('The expected cost is eating into your reserve or above budget.')
  const unknown = bookings.filter(booking => !booking.status).length
  return {
    total, contingency:ledger.contingency || 0, categories, spent, committed:sum('committed'), expected,
    remainingCosts, remainingBudget:total == null ? null : total - spent,
    finalBalance:total == null ? null : total - spent - remainingCosts,
    allocated, warnings, unknownBookings:unknown,
    pendingBookings:bookings.filter(booking => ['suggested', 'link_opened', 'pending'].includes(booking.status)).length,
  }
}

/** Per-person net balance in paise: positive means the group owes them money. */
export function balances(ledger) {
  const members = ledger?.members || []
  const net = Object.fromEntries(members.map(name => [name, 0]))
  for (const expense of ledger?.expenses || []) {
    if (!expense.payer || !(expense.payer in net)) continue
    const sharers = (expense.split?.length ? expense.split : members).filter(name => name in net)
    if (!sharers.length) continue
    const paise = expense.amount * 100 * (expense.kind === 'refund' ? -1 : 1)
    net[expense.payer] += paise
    const base = Math.trunc(paise / sharers.length)
    let left = paise - base * sharers.length
    for (const name of sharers) {
      const step = Math.sign(left)
      net[name] -= base + step
      left -= step
    }
  }
  return net
}

/** Fewest simple transfers that settle the group, largest debts first. */
export function settlement(ledger) {
  const net = balances(ledger)
  const owed = Object.entries(net).filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const owing = Object.entries(net).filter(([, value]) => value < 0).map(([name, value]) => [name, -value])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const transfers = []
  let i = 0
  let j = 0
  while (i < owing.length && j < owed.length) {
    const amount = Math.min(owing[i][1], owed[j][1])
    if (amount > 0) transfers.push({from:owing[i][0], to:owed[j][0], paise:amount})
    owing[i][1] -= amount
    owed[j][1] -= amount
    if (!owing[i][1]) i++
    if (!owed[j][1]) j++
  }
  return transfers
}

export function rupees(paise) {
  return new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', minimumFractionDigits:paise % 100 ? 2 : 0,
    maximumFractionDigits:2}).format(paise / 100)
}

const csvCell = value => {
  const text = String(value ?? '')
  // Leading = + - @ would run as a formula in spreadsheet apps.
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text
  return /[",\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe
}

export function ledgerCsv(draft) {
  const rows = [['Date', 'Type', 'Category', 'Amount (INR)', 'Paid by', 'Shared by', 'Note']]
  for (const expense of draft.ledger?.expenses || []) {
    rows.push([expense.date || '', expense.kind === 'refund' ? 'Refund' : 'Expense', expense.category,
      expense.kind === 'refund' ? -expense.amount : expense.amount, expense.payer || '',
      (expense.split?.length ? expense.split : draft.ledger.members || []).join('; '), expense.note || ''])
  }
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

export function budgetSummaryText(draft, summary, transfers, format) {
  const lines = [`${draft.name} trip budget`]
  if (summary.total != null) lines.push(`Budget: ${format(summary.total)}`)
  lines.push(`Spent: ${format(summary.spent)}`, `Expected total: ${format(summary.spent + summary.remainingCosts)}`)
  if (summary.finalBalance != null) lines.push(`Expected balance: ${format(summary.finalBalance)}`)
  lines.push('', 'By category')
  for (const row of summary.categories) if (row.spent || row.budget || row.committed) {
    lines.push(`${row.category}: ${format(row.spent)} spent${row.budget != null ? ' of ' + format(row.budget) : ''}`)
  }
  if (transfers.length) {
    lines.push('', 'To settle up')
    for (const item of transfers) lines.push(`${item.from} pays ${item.to} ${rupees(item.paise)}`)
  }
  return lines.join('\n')
}
