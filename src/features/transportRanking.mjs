// Ranks transport options returned by providers. Only fields the provider supplied are used;
// an option without a fare is never ranked as "cheapest", and the reason says what was compared.

export const PRIORITIES = [
  ['value', 'Best overall'],
  ['cheapest', 'Cheapest'],
  ['fastest', 'Fastest'],
  ['comfort', 'Fewest changes'],
]

export function durationMinutes(value) {
  if (!value) return null
  const seconds = /^(\d+)s$/.exec(value)
  if (seconds) return Math.round(Number(seconds[1]) / 60)
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value)
  if (!iso || value === 'P' || value === 'PT') return null
  const [, days = 0, hours = 0, minutes = 0, secs = 0] = iso.map(part => Number(part || 0))
  return days * 1440 + hours * 60 + minutes + Math.round(secs / 60)
}

function fare(option) {
  const amount = Number(option.price?.amount)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

/** Flatten provider groups into comparable rows. */
export function comparable(quotes) {
  const rows = []
  for (const [group, data] of Object.entries(quotes || {})) {
    if (group === 'driving' || data?.status !== 'ready') continue
    for (const [index, option] of (data.options || []).entries()) {
      const legs = option.legs || []
      rows.push({id:`${group}-${index}`, group, option, source:data.source, fare:fare(option), currency:option.price?.currency || null,
        minutes:durationMinutes(option.duration), changes:Math.max(0, legs.length - 1),
        modes:[...new Set(legs.map(leg => leg.vehicle || (group === 'flights' ? 'Flight' : 'Transit')))]})
    }
  }
  return rows
}

const order = (a, b) => (a == null) - (b == null) || (a ?? 0) - (b ?? 0)

export function rankTransport(rows, priority = 'value') {
  if (!rows.length) return []
  // Mixed currencies cannot be compared on price.
  const currencies = new Set(rows.map(row => row.currency).filter(Boolean))
  const priced = rows.filter(row => row.fare != null)
  const timed = rows.filter(row => row.minutes != null)
  const comparablePrice = currencies.size <= 1 && priced.length > 1
  const minFare = comparablePrice ? Math.min(...priced.map(row => row.fare)) : null
  const minTime = timed.length ? Math.min(...timed.map(row => row.minutes)) : null
  const score = row => {
    if (priority === 'cheapest') return comparablePrice ? row.fare ?? Infinity : 0
    if (priority === 'fastest') return row.minutes ?? Infinity
    if (priority === 'comfort') return row.changes * 1e6 + (row.minutes ?? 1e5)
    // Best overall: how far each option is from the cheapest fare and the shortest time, as ratios,
    // so 10% dearer and 10% slower weigh the same. Each change adds a quarter; a missing fare or
    // time counts as half a "best" over.
    const priceGap = comparablePrice ? (row.fare == null ? 0.5 : row.fare / minFare - 1) : 0
    const timeGap = minTime ? (row.minutes == null ? 0.5 : row.minutes / minTime - 1) : 0
    return priceGap + timeGap + row.changes * 0.25
  }
  const ranked = rows.slice().sort((a, b) => score(a) - score(b) || order(a.minutes, b.minutes) || order(a.fare, b.fare))
  return ranked.map((row, index) => ({...row, reason:reason(row, index, priority, {comparablePrice, minFare, minTime, count:rows.length})}))
}

function hours(minutes) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ' ' + (minutes % 60) + ' min' : ''}` : `${minutes} min`
}

function reason(row, index, priority, {comparablePrice, minFare, minTime, count}) {
  const parts = []
  if (row.fare != null && comparablePrice && row.fare === minFare) parts.push(`lowest fare of ${count}`)
  else if (row.fare != null && comparablePrice) parts.push(`${row.currency || ''} ${Math.round(row.fare - minFare).toLocaleString()} more than the lowest fare`.trim())
  else if (row.fare == null) parts.push('no fare published')
  if (row.minutes != null && row.minutes === minTime) parts.push('shortest journey')
  else if (row.minutes != null && minTime != null) parts.push(`${hours(row.minutes - minTime)} longer than the fastest`)
  parts.push(row.changes ? `${row.changes} change${row.changes === 1 ? '' : 's'}` : 'direct')
  if (index === 0 && priority === 'cheapest' && !comparablePrice) parts.unshift('fares could not be compared')
  return parts.join(' · ')
}
