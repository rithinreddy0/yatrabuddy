export function visitTime(minutes) {
  const hour = Math.floor(minutes / 60) % 24
  return `${hour % 12 || 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'am' : 'pm'}${minutes >= 1440 ? ' (+1 day)' : ''}`
}

function earliestVisit(place) {
  if (/\b(?:night (?:cruise|market|tour|walk)|dinner)\b/i.test(place.name)) return 18 * 60 + 30
  if (/\b(?:sunset|evening)\b/i.test(place.name)) return 17 * 60
  if (/\blunch\b/i.test(place.name)) return 12 * 60
  return 0
}

export function draftSchedule(draft, dayIndex) {
  let cursor = draft.pace === 'Relaxed' ? 630 : 570
  const stops = draft.days[dayIndex]
  const legs = draft.routes?.[dayIndex] || []
  return stops.map((place, index) => {
    const leg = legs[index - (draft.stay ? 0 : 1)]
    const from = stops[index - 1] || draft.stay
    const duration = place.category === 'Sight' ? 75 : place.category === 'Food' ? 45 : 60
    const start = Math.max(cursor + (leg?.minutes || 0), earliestVisit(place), place.category === 'Food' && index > 0 ? 720 : 0)
    const end = start + duration
    cursor = end + 15
    return {place, from, leg, duration, start, end}
  })
}
