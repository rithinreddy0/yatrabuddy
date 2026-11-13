/**
 * DS6: Plan solver — pure functions for reactive plan recomputation.
 * Detects conflicts, suggests fixes, computes diffs.
 */
import {schedule, costs, estimateLeg} from '../planner.mjs'

/**
 * Validate a plan and return conflicts.
 * @param {Object} trip
 * @param {Object} place - destination catalog entry
 * @param {Object} weatherByDay - { [dayIndex]: { weathercode, ... } }
 * @returns {{ conflicts: Array, totalCost: Object }}
 */
export function validatePlan(trip, place, weatherByDay = {}) {
  const conflicts = []
  if (!trip?.days?.length || !place?.places) return { conflicts, totalCost: null }

  const tripCosts = costs(trip)

  for (let dayIndex = 0; dayIndex < trip.days.length; dayIndex++) {
    const dayStops = schedule(trip, dayIndex)
    const dayWeather = weatherByDay[dayIndex]

    for (let stopIndex = 0; stopIndex < dayStops.length; stopIndex++) {
      const stop = dayStops[stopIndex]

      // Hours conflict
      if (stop.hoursConflict) {
        conflicts.push({
          type: 'hours',
          dayIndex,
          stopIndex,
          stopName: stop.name,
          message: `${stop.name} visit overlaps listed hours (${stop.hours}).`,
          fix: { action: 'move_time', label: `Move to fit ${stop.hours}`, dayIndex, stopIndex },
        })
      }

      // Weather conflict
      if (dayWeather && [51,53,55,61,63,65,80,81,82,95,96,99].includes(dayWeather.weathercode)) {
        const outdoorThemes = ['Nature', 'Adventure']
        if (outdoorThemes.includes(stop.theme)) {
          conflicts.push({
            type: 'weather',
            dayIndex,
            stopIndex,
            stopName: stop.name,
            message: `Rain forecast on Day ${dayIndex + 1} — ${stop.name} is outdoors.`,
            fix: { action: 'swap_day', label: 'Move to another day', dayIndex, stopIndex, stopName: stop.name },
          })
        }
      }

      // Travel time gap
      if (stop.eta > 90) {
        conflicts.push({
          type: 'travel_time',
          dayIndex,
          stopIndex,
          stopName: stop.name,
          message: `${stop.eta} min travel to ${stop.name} — consider reordering.`,
          fix: { action: 'reorder', label: 'Optimize stop order', dayIndex },
        })
      }
    }
  }

  // Budget conflict
  if (tripCosts.total > trip.brief.budget) {
    conflicts.push({
      type: 'budget',
      message: `Estimated total exceeds budget by ₹${(tripCosts.total - trip.brief.budget).toLocaleString('en-IN')}.`,
      fix: { action: 'reduce_cost', label: 'Find cheaper alternatives' },
    })
  }

  return { conflicts, totalCost: tripCosts }
}

/**
 * Compute a diff between two trip states.
 * @returns {{ added: [], removed: [], moved: [], changed: [] }}
 */
export function computeDiff(before, after) {
  if (!before || !after) return { added: [], removed: [], moved: [], changed: [] }

  const diff = { added: [], removed: [], moved: [], changed: [] }

  for (let dayIndex = 0; dayIndex < Math.max(before.days.length, after.days.length); dayIndex++) {
    const beforeStops = before.days[dayIndex]?.stops || []
    const afterStops = after.days[dayIndex]?.stops || []

    for (const name of afterStops) {
      if (!beforeStops.includes(name)) {
        // Check if it moved from another day
        const fromDay = before.days.findIndex(d => d.stops.includes(name))
        if (fromDay >= 0 && fromDay !== dayIndex) {
          diff.moved.push({ name, fromDay, toDay: dayIndex })
        } else if (fromDay < 0) {
          diff.added.push({ name, dayIndex })
        }
      }
    }

    for (const name of beforeStops) {
      if (!afterStops.includes(name) && !after.days.some(d => d.stops.includes(name))) {
        diff.removed.push({ name, dayIndex })
      }
    }

    // Check reorder within same day
    if (beforeStops.length === afterStops.length && beforeStops.every(n => afterStops.includes(n))) {
      for (let i = 0; i < beforeStops.length; i++) {
        if (beforeStops[i] !== afterStops[i]) {
          diff.changed.push({ type: 'reorder', dayIndex })
          break
        }
      }
    }
  }

  // Brief changes
  const briefFields = ['budget', 'days', 'people', 'date', 'pace', 'diet', 'style']
  for (const field of briefFields) {
    if (before.brief[field] !== after.brief[field]) {
      diff.changed.push({ type: 'brief', field, from: before.brief[field], to: after.brief[field] })
    }
  }

  return diff
}

/**
 * Apply a quick fix to a trip.
 * Returns the modified trip (or null if fix not applicable).
 */
export function applyFix(trip, fix, place) {
  if (!trip || !fix) return null

  switch (fix.action) {
    case 'move_time': {
      // Try to find the best position in the day
      const day = trip.days[fix.dayIndex]
      if (!day) return null
      const stops = [...day.stops]
      // Move the conflicting stop to the end where it might fit better
      const [moved] = stops.splice(fix.stopIndex, 1)
      stops.push(moved)
      return {
        ...trip,
        days: trip.days.map((d, i) => i === fix.dayIndex ? { ...d, stops } : d),
      }
    }

    case 'swap_day': {
      // Move outdoor stop from rainy day to first clear day
      const sourceDay = fix.dayIndex
      const targetDay = trip.days.findIndex((_, i) => i !== sourceDay)
      if (targetDay < 0) return null
      const sourceDayStops = trip.days[sourceDay].stops.filter(n => n !== fix.stopName)
      const targetDayStops = [...trip.days[targetDay].stops, fix.stopName]
      return {
        ...trip,
        days: trip.days.map((d, i) => {
          if (i === sourceDay) return { ...d, stops: sourceDayStops }
          if (i === targetDay) return { ...d, stops: targetDayStops }
          return d
        }),
      }
    }

    case 'reorder': {
      // Sort stops by proximity (greedy nearest-neighbor)
      const day = trip.days[fix.dayIndex]
      if (!day || day.stops.length < 2) return null
      const items = day.stops.map(name => place.places.find(p => p.name === name)).filter(Boolean)
      if (items.length !== day.stops.length) return null
      const ordered = [items[0]]
      const remaining = items.slice(1)
      while (remaining.length) {
        const last = ordered[ordered.length - 1]
        let bestIdx = 0, bestDist = Infinity
        for (let i = 0; i < remaining.length; i++) {
          const d = estimateLeg(last, remaining[i])
          if (d < bestDist) { bestDist = d; bestIdx = i }
        }
        ordered.push(remaining.splice(bestIdx, 1)[0])
      }
      return {
        ...trip,
        days: trip.days.map((d, i) => i === fix.dayIndex ? { ...d, stops: ordered.map(p => p.name) } : d),
      }
    }

    default:
      return null
  }
}

/**
 * Parse a chat command that modifies the plan.
 * Returns { action, params } or null.
 */
export function parsePlanCommand(text, trip, place) {
  if (!text || !trip) return null
  const clean = text.toLowerCase().trim()

  // "make day N relaxed"
  const relaxMatch = clean.match(/make day (\d+) relaxed/)
  if (relaxMatch) {
    const dayIndex = parseInt(relaxMatch[1]) - 1
    if (dayIndex >= 0 && dayIndex < trip.days.length) {
      return { action: 'set_relaxed', params: { dayIndex, relaxed: true } }
    }
  }

  // "swap X for Y"
  const swapMatch = clean.match(/swap (?:the )?(.+?) for (?:a )?(.+)/)
  if (swapMatch && place) {
    const oldName = swapMatch[1].trim()
    const newName = swapMatch[2].trim()
    const oldStop = place.places.find(p => p.name.toLowerCase().includes(oldName))
    const newStop = place.places.find(p => p.name.toLowerCase().includes(newName))
    if (oldStop && newStop) {
      return { action: 'swap_stop', params: { oldName: oldStop.name, newName: newStop.name } }
    }
  }

  // "add X near the hotel" / "add a cafe"
  const addMatch = clean.match(/add (?:a )?(.+?)(?:\s+near\b|\s+to\b|$)/)
  if (addMatch && place) {
    const query = addMatch[1].trim()
    const found = place.places.find(p => p.name.toLowerCase().includes(query) || p.theme.toLowerCase() === query)
    if (found) {
      return { action: 'add_stop', params: { name: found.name } }
    }
  }

  // "remove X"
  const removeMatch = clean.match(/remove (?:the )?(.+)/)
  if (removeMatch) {
    const query = removeMatch[1].trim()
    for (const day of trip.days) {
      const found = day.stops.find(n => n.toLowerCase().includes(query))
      if (found) return { action: 'remove_stop', params: { name: found } }
    }
  }

  return null
}

/**
 * Apply a parsed plan command to a trip.
 * Returns { trip, description } or null.
 */
export function applyPlanCommand(command, trip) {
  if (!command || !trip) return null

  switch (command.action) {
    case 'set_relaxed': {
      const { dayIndex, relaxed } = command.params
      return {
        trip: { ...trip, days: trip.days.map((d, i) => i === dayIndex ? { ...d, relaxed } : d) },
        description: `Made Day ${dayIndex + 1} ${relaxed ? 'relaxed (start at 10:30)' : 'packed (start at 09:30)'}.`,
      }
    }

    case 'swap_stop': {
      const { oldName, newName } = command.params
      const newDays = trip.days.map(d => ({
        ...d,
        stops: d.stops.map(s => s === oldName ? newName : s),
      }))
      return {
        trip: { ...trip, days: newDays },
        description: `Swapped ${oldName} for ${newName}.`,
      }
    }

    case 'add_stop': {
      const { name } = command.params
      // Add to the day with fewest stops
      const targetDay = trip.days.reduce((best, d, i) => d.stops.length < trip.days[best].stops.length ? i : best, 0)
      return {
        trip: { ...trip, days: trip.days.map((d, i) => i === targetDay ? { ...d, stops: [...d.stops, name] } : d) },
        description: `Added ${name} to Day ${targetDay + 1}.`,
      }
    }

    case 'remove_stop': {
      const { name } = command.params
      return {
        trip: { ...trip, days: trip.days.map(d => ({ ...d, stops: d.stops.filter(s => s !== name) })) },
        description: `Removed ${name} from the itinerary.`,
      }
    }

    default:
      return null
  }
}
