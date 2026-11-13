/**
 * DS3: Pure scoring functions for instant what-if re-ranking.
 * No network calls, no LLM — deterministic and fast.
 */

/**
 * Score and rank options based on weights and budget.
 * @param {Array} options - [{id, name, total, price, buffer, theme, ...}]
 * @param {Object} weights - { budget: 0-1, time: 0-1, safety: 0-1, unique: 0-1 }
 * @param {number} budget - total group budget
 * @param {number} otherCosts - costs from other stages
 * @param {Object} learned - { tags: { tagName: weight } }
 * @returns {Array} ranked options with score and rank metadata
 */
export function scoreAndRank(options, weights = {}, budget = Infinity, otherCosts = 0, learned = {}) {
  const w = {
    budget: weights.budget ?? 0.4,
    time: weights.time ?? 0.25,
    safety: weights.safety ?? 0.2,
    unique: weights.unique ?? 0.15,
  }

  const maxPrice = Math.max(1, ...options.filter(o => !o.unpriced).map(o => o.total))
  const maxBuffer = Math.max(1, ...options.filter(o => o.buffer != null).map(o => o.buffer))

  const scored = options.map((item, originalIndex) => {
    const fits = item.unpriced || (otherCosts + item.total) <= budget
    const priceFactor = item.unpriced ? 0.5 : 1 - (item.total / maxPrice)
    const bufferFactor = item.buffer != null ? Math.min(item.buffer / maxBuffer, 1) : 0.5
    const uniqueFactor = item.theme === 'explore' || item.transfers > 1 ? 0.8 : 0.4
    const learnedBonus = (learned.tags?.[item.theme] || 0) * 0.02

    const score = Math.round(
      (w.budget * priceFactor * 100) +
      (w.time * (1 - (item.minutes || 0) / 1800) * 100) +
      (w.safety * bufferFactor * 100) +
      (w.unique * uniqueFactor * 100) +
      learnedBonus * 100
    )

    return {
      ...item,
      score,
      fits,
      originalIndex,
      reasons: buildReasons(item, fits, budget, otherCosts, w),
    }
  })

  // Sort: fitting items first, then by score descending
  scored.sort((a, b) => {
    if (a.fits !== b.fits) return a.fits ? -1 : 1
    return b.score - a.score
  })

  return scored.map((item, rank) => ({
    ...item,
    rank,
    rankChange: item.originalIndex - rank,
    movedUp: rank < item.originalIndex,
    movedDown: rank > item.originalIndex,
  }))
}

function buildReasons(item, fits, budget, otherCosts, weights) {
  const reasons = []
  if (!fits) reasons.push('Exceeds the remaining budget')
  if (item.buffer != null && item.buffer < 30) reasons.push('Tight connection buffer')
  if (item.buffer != null && item.buffer >= 90) reasons.push('Comfortable transfer time')
  if (item.unpriced) reasons.push('Price not confirmed by provider')

  // Dominant weight reason
  const dominant = Object.entries(weights).sort((a, b) => b[1] - a[1])[0]
  if (dominant) {
    const labels = { budget: 'budget fit', time: 'travel time', safety: 'connection safety', unique: 'uniqueness' }
    reasons.push('Ranked primarily by ' + labels[dominant[0]])
  }
  return reasons
}

/**
 * Apply priority preset to weights.
 */
export function priorityWeights(priority) {
  switch (priority) {
    case 'cheapest': return { budget: 0.7, time: 0.1, safety: 0.1, unique: 0.1 }
    case 'fastest': return { budget: 0.1, time: 0.7, safety: 0.1, unique: 0.1 }
    case 'safest': return { budget: 0.1, time: 0.1, safety: 0.7, unique: 0.1 }
    case 'unique': return { budget: 0.1, time: 0.1, safety: 0.1, unique: 0.7 }
    default: return { budget: 0.4, time: 0.25, safety: 0.2, unique: 0.15 }
  }
}

/**
 * Check which options become infeasible at a given budget.
 * Returns { feasible: [], dropped: [], replacing: [] }
 */
export function budgetFeasibility(options, budget, otherCosts = 0) {
  const feasible = []
  const dropped = []
  for (const item of options) {
    if (item.unpriced || (otherCosts + item.total) <= budget) {
      feasible.push(item)
    } else {
      dropped.push(item)
    }
  }
  // Suggest cheapest feasible as replacement for each dropped
  const cheapestFeasible = feasible.length ? feasible.reduce((a, b) => a.total < b.total ? a : b) : null
  const replacing = dropped.map(item => ({
    dropped: item,
    replacement: cheapestFeasible,
    savings: cheapestFeasible ? item.total - cheapestFeasible.total : 0,
  }))
  return { feasible, dropped, replacing }
}

/**
 * Build a comparison table for selected options.
 * @param {Array} options - full options list
 * @param {Array} selectedIds - ids to compare
 * @param {number} otherCosts
 * @returns {Object} { rows, bestPerRow }
 */
export function compareOptions(options, selectedIds, otherCosts = 0) {
  const selected = selectedIds.map(id => options.find(o => o.id === id)).filter(Boolean)
  if (selected.length < 2) return null

  const rows = [
    { label: 'Group total', values: selected.map(o => o.unpriced ? 'Unconfirmed' : otherCosts + o.total), unit: 'currency', bestIs: 'lowest' },
    { label: 'Transfer buffer', values: selected.map(o => o.buffer ?? '—'), unit: 'minutes', bestIs: 'highest' },
    { label: 'Travel time', values: selected.map(o => o.minutes ?? '—'), unit: 'minutes', bestIs: 'lowest' },
  ]

  // Mark best value per row
  const bestPerRow = rows.map(row => {
    const nums = row.values.map((v, i) => typeof v === 'number' ? { v, i } : null).filter(Boolean)
    if (!nums.length) return -1
    const best = row.bestIs === 'lowest'
      ? nums.reduce((a, b) => a.v < b.v ? a : b)
      : nums.reduce((a, b) => a.v > b.v ? a : b)
    return best.i
  })

  return { items: selected, rows, bestPerRow }
}
