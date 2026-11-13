export function draftBudget(draft) {
  const dayCosts = draft.days.map(stops => {
    const amounts = stops.map(stop => draft.stopCosts?.[stop.url]).filter(Number.isFinite)
    return {total: amounts.reduce((sum, amount) => sum + amount, 0), priced: amounts.length}
  })
  const entered = dayCosts.reduce((sum, day) => sum + day.total, 0)
  const unpriced = draft.days.reduce((sum, day, index) => sum + day.length - dayCosts[index].priced, 0)
  return {dayCosts, entered, unpriced}
}

export function draftPreferences(draft, fields) {
  const origin = fields.origin.trim() || null
  const departure = fields.departure || null
  const travelers = Number(fields.travelers)
  const budget = fields.budget ? Number(fields.budget) : null
  // A named party must still describe the group after the traveler count changes.
  const party = travelers === draft.travelers ? draft.party : null
  return {...draft, origin, departure, travelers, budget, party, pace: fields.pace,
    mealPreference: fields.mealPreference, localModes: fields.localModes,
    routeAdvice: null, updated: Math.max(Date.now(), draft.updated + 1)}
}

function calendarDate(departure, offset) {
  const date = new Date(departure + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10).replaceAll('-', '')
}

function calendarText(value) {
  return String(value).replaceAll('\\', '\\\\').replace(/\r?\n|\r/g, '\\n')
    .replaceAll(',', '\\,').replaceAll(';', '\\;')
}

function foldLine(line) {
  const encoder = new TextEncoder()
  const lines = []
  let part = ''
  let bytes = 0
  for (const character of line) {
    const width = encoder.encode(character).length
    if (bytes + width > 75) {
      lines.push(part)
      part = ' '
      bytes = 1
    }
    part += character
    bytes += width
  }
  return [...lines, part].join('\r\n')
}

export function tripCalendar(draft, now = new Date()) {
  if (!draft.departure) return null
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const events = draft.days.flatMap((day, index) => day.length ? [
    'BEGIN:VEVENT',
    'UID:' + draft.id + '-day-' + (index + 1) + '@yatrabuddy',
    'DTSTAMP:' + stamp,
    'DTSTART;VALUE=DATE:' + calendarDate(draft.departure, index),
    'DTEND;VALUE=DATE:' + calendarDate(draft.departure, index + 1),
    'SUMMARY:' + calendarText(draft.name + ' · Day ' + (index + 1)),
    'DESCRIPTION:' + calendarText(day.map(stop => stop.name).join('\n')),
    'END:VEVENT',
  ] : [])
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//YatraBuddy//Trip itinerary//EN',
    'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].map(foldLine).join('\r\n')
}
