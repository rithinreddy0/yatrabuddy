/**
 * DS5: Proactive trigger detectors — pure functions over state.
 * No network calls, no LLM. LLM is only used to phrase messages (done elsewhere).
 * Each detector returns null or a trigger object.
 */

/**
 * Budget trigger: crossing 80% or 100%.
 */
export function detectBudgetAlert(trip, costs) {
  if (!trip?.brief?.budget || !costs?.total) return null
  const percent = Math.round(100 * costs.total / trip.brief.budget)
  if (percent >= 100) {
    const over = costs.total - trip.brief.budget
    return {
      triggerType: 'budget_over',
      triggerId: `budget_over_${trip.id || 'current'}`,
      message: `Because the estimated total (₹${costs.total.toLocaleString('en-IN')}) exceeds the ₹${trip.brief.budget.toLocaleString('en-IN')} budget by ₹${over.toLocaleString('en-IN')}.`,
      suggestion: { action: 'swap_cheaper', label: 'Find cheaper alternatives' },
      severity: 'high',
    }
  }
  if (percent >= 80) {
    const remaining = trip.brief.budget - costs.total
    return {
      triggerType: 'budget_warning',
      triggerId: `budget_warning_${trip.id || 'current'}`,
      message: `Because ${percent}% of the ₹${trip.brief.budget.toLocaleString('en-IN')} budget is allocated, with ₹${remaining.toLocaleString('en-IN')} remaining.`,
      suggestion: { action: 'review_budget', label: 'Review budget allocation' },
      severity: 'medium',
    }
  }
  return null
}

/**
 * Weather trigger: rain on a day with outdoor items.
 * @param {Array} forecast - [{ date, weathercode, min, max }]
 * @param {Object} trip - trip with days and stops
 * @param {Object} place - destination catalog entry
 */
export function detectWeatherConflict(forecast, trip, place) {
  if (!forecast?.length || !trip?.days?.length || !place?.places) return null
  const outdoorThemes = ['Nature', 'Adventure']
  const rainCodes = [51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99] // WMO rain/thunderstorm

  for (let dayIndex = 0; dayIndex < trip.days.length; dayIndex++) {
    const day = trip.days[dayIndex]
    const dateStr = trip.brief.date
      ? addDays(trip.brief.date, dayIndex)
      : null
    const dayForecast = dateStr ? forecast.find(f => f.date === dateStr) : null
    if (!dayForecast || !rainCodes.includes(dayForecast.weathercode)) continue

    const outdoorStops = day.stops.filter(name => {
      const item = place.places.find(p => p.name === name)
      return item && outdoorThemes.includes(item.theme)
    })
    if (!outdoorStops.length) continue

    return {
      triggerType: 'weather_rain',
      triggerId: `weather_rain_day${dayIndex}_${dateStr}`,
      message: `Because the forecast shows rain on Day ${dayIndex + 1} (${dateStr}), and ${outdoorStops.join(', ')} ${outdoorStops.length === 1 ? 'is' : 'are'} outdoor.`,
      suggestion: {
        action: 'move_outdoor',
        label: 'Move outdoor activities',
        dayIndex,
        stops: outdoorStops,
      },
      severity: 'medium',
    }
  }
  return null
}

/**
 * Timing trigger: connection buffer drops below minimum after edit.
 * @param {Object} route - { buffer }
 * @param {number} minimumBuffer - default 30 minutes
 */
export function detectTimingConflict(route, minimumBuffer = 30) {
  if (!route || route.buffer == null) return null
  if (route.buffer < minimumBuffer) {
    return {
      triggerType: 'timing_tight',
      triggerId: `timing_tight_${route.id || 'route'}`,
      message: `Because the connection buffer is only ${route.buffer} minutes (minimum recommended: ${minimumBuffer} minutes).`,
      suggestion: { action: 'fix_timing', label: 'Choose a safer connection' },
      severity: 'high',
    }
  }
  return null
}

/**
 * Crowd trigger: high seeded crowd level at chosen time.
 * Uses the stop's crowd data if available.
 */
export function detectCrowdAlert(stops, timeOfDay) {
  if (!stops?.length) return null
  for (const stop of stops) {
    if (stop.crowdLevel && stop.crowdLevel >= 8) {
      return {
        triggerType: 'crowd_high',
        triggerId: `crowd_${stop.name}_${timeOfDay || 'day'}`,
        message: `Because ${stop.name} typically has high visitor density around ${timeOfDay || 'this time'}.`,
        suggestion: { action: 'suggest_earlier', label: 'Visit earlier or find a quieter alternative', stopName: stop.name },
        severity: 'low',
      }
    }
  }
  return null
}

/**
 * Delay trigger (simulated): recompute impact after a delay.
 * @param {Object} route - selected route with buffer
 * @param {number} delayMinutes
 * @param {number} headroom - remaining budget
 * @param {number} travellers
 */
export function detectDelayImpact(route, delayMinutes, headroom, travellers) {
  if (!route || !delayMinutes) return null
  const bufferAfter = (route.buffer || 0) - delayMinutes
  const missed = bufferAfter < 30
  if (!missed) return null

  return {
    triggerType: 'delay_missed',
    triggerId: `delay_${route.id}_${delayMinutes}`,
    message: `Because a ${delayMinutes}-minute delay on ${route.name} leaves only ${Math.max(0, bufferAfter)} minutes to connect (minimum: 30 minutes).`,
    suggestion: { action: 'find_replacement', label: 'Find replacement route' },
    severity: 'high',
    data: { bufferAfter, missed, headroom, travellers },
  }
}

/**
 * Idle trigger: suggest next best step after stage completion.
 */
export function detectIdleSuggestion(step, choices, brief) {
  if (step == null || !brief) return null
  const stages = ['Transport', 'Stay', 'Activities', 'Food', 'Local transport', 'Weather', 'Review']
  const nextStep = step + 1
  if (nextStep >= stages.length) return null

  const suggestions = {
    1: { label: 'Choose a stay', chips: ['Find hotels', 'Use sample stays'] },
    2: { label: 'Pick activities', chips: ['Browse places', 'Look up online'] },
    3: { label: 'Add food stops', chips: ['Find restaurants', 'Skip for now'] },
    4: { label: 'Set local transport', chips: ['Check driving times'] },
    5: { label: 'Check weather', chips: ['View forecast'] },
    6: { label: 'Review your trip', chips: ['Save itinerary', 'Edit stops'] },
  }

  return suggestions[nextStep] ? {
    triggerType: 'idle_next',
    triggerId: `idle_step_${nextStep}`,
    message: `Ready for the next step: ${suggestions[nextStep].label}.`,
    suggestion: { action: 'suggest_chips', chips: suggestions[nextStep].chips },
    severity: 'info',
  } : null
}

/**
 * Rate-limit check for proactive messages.
 * Max 1 per minute, never during typing or streaming.
 */
export function canShowProactive(proactiveState, isTyping = false, isStreaming = false) {
  if (isTyping || isStreaming) return false
  if (!proactiveState.pending.length) return false
  if (proactiveState.active) return false
  const elapsed = Date.now() - proactiveState.lastShown
  return elapsed >= 60000 // 1 minute
}

/**
 * Run all detectors and return triggers.
 */
export function runDetectors({ trip, costs, forecast, place, route, delay, stops, step, choices, brief }) {
  const triggers = []
  const budget = detectBudgetAlert(trip, costs)
  if (budget) triggers.push(budget)
  const weather = detectWeatherConflict(forecast, trip, place)
  if (weather) triggers.push(weather)
  const timing = detectTimingConflict(route)
  if (timing) triggers.push(timing)
  const idle = detectIdleSuggestion(step, choices, brief)
  if (idle) triggers.push(idle)
  return triggers
}

// ─── Helpers ───

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
