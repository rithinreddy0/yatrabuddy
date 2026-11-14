// Home-to-home journey: turns the traveller's outbound and return legs into a door-to-door timeline.
// Times come from the traveller (or their ticket). Buffers before departure are labelled suggestions.

export const JOURNEY_MODES = {
  flight:{label:'Flight', buffer:120, exit:30, bufferLabel:'Check in, bags and security', hub:'airport'},
  train:{label:'Train', buffer:30, exit:10, bufferLabel:'Find the platform and board', hub:'station'},
  bus:{label:'Bus', buffer:20, exit:5, bufferLabel:'Reach the boarding point', hub:'boarding point'},
  drive:{label:'Drive', buffer:0, exit:0, bufferLabel:'', hub:null},
  cab:{label:'Cab', buffer:0, exit:0, bufferLabel:'', hub:null},
  other:{label:'Other', buffer:30, exit:10, bufferLabel:'Be there before departure', hub:'departure point'},
}

export const usesHubs = mode => Boolean(JOURNEY_MODES[mode]?.hub)

export function toMinutes(clock) {
  const match = /^(\d{2}):(\d{2})$/.exec(clock || '')
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function clockText(minutes) {
  const day = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(day / 60)).padStart(2, '0')}:${String(day % 60).padStart(2, '0')}`
}

export function addDays(date, days) {
  if (!date) return null
  const value = new Date(date + 'T12:00:00Z')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const hasPoint = place => Number.isFinite(place?.lat) && Number.isFinite(place?.lon)
const transferText = transfer => transfer ? `${transfer.kilometres} km · about ${transfer.minutes} min by road` : null

function stamp(leg, minutes) {
  if (minutes == null) return {minute:null, date:null, dayOffset:0}
  const dayOffset = Math.floor(minutes / 1440)
  return {minute:((minutes % 1440) + 1440) % 1440, dayOffset, date:addDays(leg.date, dayOffset)}
}

/**
 * Door-to-door steps for one leg. `direction` is 'outbound' (home → stay) or 'return' (stay → home).
 * Every step has {kind, title, detail, minute, date, dayOffset, suggested}.
 */
export function legSteps(leg, {direction, home, stay}) {
  if (!leg) return []
  const mode = JOURNEY_MODES[leg.mode] || JOURNEY_MODES.other
  const start = direction === 'outbound' ? home : stay
  const end = direction === 'outbound' ? stay : home
  const startName = start?.name || (direction === 'outbound' ? 'home' : 'your stay')
  const endName = end?.name || (direction === 'outbound' ? 'your stay' : 'home')
  const depart = toMinutes(leg.departTime)
  let arrive = toMinutes(leg.arriveTime)
  if (arrive != null && (leg.arriveNextDay || (depart != null && arrive < depart))) arrive += 1440
  const step = (kind, title, minutes, extra = {}) => ({kind, title, ...stamp(leg, minutes), ...extra})
  const label = [mode.label, leg.service].filter(Boolean).join(' ')

  if (!usesHubs(leg.mode)) {
    const driveEnd = arrive ?? (depart != null && leg.mainMinutes != null ? depart + leg.mainMinutes : null)
    return [
      step('leave', direction === 'outbound' ? `Leave ${startName}` : `Check out and leave ${startName}`, depart),
      step('main', `${label} to ${endName}`, depart, {
        detail:[leg.mainKilometres != null && `${Math.round(leg.mainKilometres)} km`, leg.mainMinutes != null && `about ${Math.floor(leg.mainMinutes / 60)} h ${leg.mainMinutes % 60} min without stops or traffic`]
          .filter(Boolean).join(' · ') || null, endMinute:driveEnd}),
      step('arrive', direction === 'outbound' ? `Arrive at ${endName}` : `Home at ${endName}`, driveEnd,
        {suggested:arrive == null && driveEnd != null, detail:arrive == null && driveEnd != null ? 'Estimate; add breaks and traffic' : null}),
    ]
  }

  const boardAt = depart != null ? depart - mode.buffer : null
  const leaveAt = boardAt != null && leg.firstTransfer ? boardAt - leg.firstTransfer.minutes : null
  const exitAt = arrive != null ? arrive + mode.exit : null
  const doorAt = exitAt != null && leg.lastTransfer ? exitAt + leg.lastTransfer.minutes : null
  const from = leg.fromHub?.name ? `${leg.fromHub.name}${leg.fromHub.code ? ` (${leg.fromHub.code})` : ''}` : `the ${mode.hub}`
  const to = leg.toHub?.name ? `${leg.toHub.name}${leg.toHub.code ? ` (${leg.toHub.code})` : ''}` : `the ${mode.hub}`
  return [
    step('leave', direction === 'outbound' ? `Leave ${startName}` : `Check out and leave ${startName}`, leaveAt,
      {suggested:leaveAt != null, detail:leaveAt != null ? `Suggested: ${mode.buffer} min before departure plus the road transfer` : null}),
    step('transfer', `Travel to ${from}`, null, {detail:transferText(leg.firstTransfer)}),
    step('board', mode.bufferLabel, boardAt, {suggested:boardAt != null, detail:boardAt != null ? `Suggested buffer; check your ${mode.label.toLowerCase()} ticket for cut-off times` : null}),
    step('main', `${label}: ${leg.fromHub?.code || from} → ${leg.toHub?.code || to}`, depart, {endMinute:arrive,
      detail:depart == null ? 'Add the departure time from your ticket' : arrive == null ? 'Add the arrival time from your ticket' : null}),
    step('arrive-hub', `Arrive at ${to}`, arrive),
    step('transfer', `Travel to ${endName}`, exitAt, {detail:transferText(leg.lastTransfer)}),
    step('arrive', direction === 'outbound' ? `Arrive at ${endName}` : `Home at ${endName}`, doorAt,
      {suggested:doorAt != null, detail:doorAt != null ? 'Estimate including the road transfer' : null}),
  ]
}

/** A starting journey for a mode, using the nearest hubs that have codes. Times are left for the traveller. */
export function journeyTemplate(mode, {draft, plan}) {
  const origin = plan?.origin
  const home = origin ? {name:origin.name, lat:origin.lat, lon:origin.lon} : {name:draft.origin || 'Home'}
  const pick = (hubs, kind) => {
    const list = kind === 'airport' ? hubs?.airports : kind === 'station' ? hubs?.stations : null
    const hub = list?.find(item => item.code) || list?.[0]
    return hub ? {name:hub.name, code:hub.code || null, lat:hub.lat, lon:hub.lon} : null
  }
  const kind = JOURNEY_MODES[mode]?.hub
  const outFrom = pick(plan?.hubs?.origin, kind)
  const outTo = pick(plan?.hubs?.destination, kind)
  const road = plan?.road
  const base = {mode, departTime:null, arriveTime:null, arriveNextDay:false, service:'', estimatedCost:null, bookingId:null, notes:''}
  const driving = usesHubs(mode) ? {} : {mainKilometres:road?.kilometres ?? null, mainMinutes:road?.minutes ?? null}
  const lastDay = draft.departure ? addDays(draft.departure, Math.max(0, draft.days.length - 1)) : null
  return {
    home,
    outbound:{...base, ...driving, date:draft.departure || null, fromHub:outFrom, toHub:outTo},
    returnLeg:{...base, ...driving, date:lastDay, fromHub:outTo, toHub:outFrom},
  }
}

/** Road transfers to compute: [legKey, field, from, to]. */
export function transferPairs(journey, stay) {
  const pairs = []
  const add = (key, field, a, b) => { if (hasPoint(a) && hasPoint(b)) pairs.push([key, field, a, b]) }
  for (const [key, start, end] of [['outbound', journey.home, stay], ['returnLeg', stay, journey.home]]) {
    const leg = journey[key]
    if (!leg || !usesHubs(leg.mode)) continue
    add(key, 'firstTransfer', start, leg.fromHub)
    add(key, 'lastTransfer', leg.toHub, end)
  }
  return pairs
}

export function journeyCost(journey) {
  return ['outbound', 'returnLeg'].reduce((sum, key) => sum + (journey?.[key]?.estimatedCost || 0), 0)
}

/** Calendar events for the two main legs, with times when known. */
export function journeyEvents(journey) {
  const events = []
  for (const [key, title] of [['outbound', 'Journey out'], ['returnLeg', 'Journey home']]) {
    const leg = journey?.[key]
    if (!leg?.date) continue
    const mode = JOURNEY_MODES[leg.mode] || JOURNEY_MODES.other
    const depart = toMinutes(leg.departTime)
    let arrive = toMinutes(leg.arriveTime)
    if (arrive != null && (leg.arriveNextDay || (depart != null && arrive < depart))) arrive += 1440
    if (arrive == null && depart != null && leg.mainMinutes != null && !usesHubs(leg.mode)) arrive = depart + leg.mainMinutes
    const route = [leg.fromHub?.code || leg.fromHub?.name, leg.toHub?.code || leg.toHub?.name].filter(Boolean).join(' → ')
    events.push({key, date:leg.date, start:depart, end:arrive,
      title:`${title}: ${[mode.label, leg.service].filter(Boolean).join(' ')}${route ? ' ' + route : ''}`})
  }
  return events
}

/** The date the traveller reaches the stay, or null if unknown. */
export function arrivalDate(journey, stay) {
  const leg = journey?.outbound
  if (!leg?.date) return null
  const steps = legSteps(leg, {direction:'outbound', home:journey.home, stay})
  const dated = steps.filter(step => step.date)
  return dated.at(-1)?.date || leg.date
}

/** Plain-language problems between the journey and the trip days. */
export function journeyChecks(draft, journey) {
  const issues = []
  if (!journey) return issues
  const firstDay = draft.departure
  const lastDay = firstDay ? addDays(firstDay, draft.days.length - 1) : null
  const arrive = arrivalDate(journey, draft.stay)
  const leave = journey.returnLeg?.date
  const label = date => new Intl.DateTimeFormat(undefined, {weekday:'short', day:'numeric', month:'short', timeZone:'UTC'}).format(new Date(date + 'T12:00:00Z'))
  if (arrive && firstDay && arrive > firstDay) issues.push(`You arrive on ${label(arrive)}, after Day 1 (${label(firstDay)}). Travel earlier or move the trip dates.`)
  if (arrive && firstDay && arrive < addDays(firstDay, -1)) issues.push(`You arrive on ${label(arrive)}, more than a day before Day 1 (${label(firstDay)}).`)
  if (leave && lastDay && leave < lastDay) issues.push(`The journey home leaves on ${label(leave)}, before Day ${draft.days.length} (${label(lastDay)}). Shorten the trip or travel later.`)
  if (leave && arrive && leave < arrive) issues.push('The journey home is before you arrive.')
  return issues
}
