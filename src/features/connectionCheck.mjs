import rules from '../../backend/connection-simulation.json' with {type: 'json'}

export const maximumDelay = rules.maximumDelay

export function checkConnection({buffer, minutes, headroom, reserve = 0, travellers}) {
  const remaining = Math.max(0, headroom - reserve)
  const bufferAfterDelay = buffer - minutes
  if (bufferAfterDelay >= rules.minimumConnection) {
    return {missed: false, bufferAfterDelay, remaining, replacement: null, extra: 0}
  }
  const available = rules.alternatives.filter(item => minutes <= item.latestDelay)
  const replacement = available.find(item => item.amount * travellers <= remaining) ?? null
  const extra = replacement ? 0 : Math.min(...available.map(item => item.amount * travellers)) - remaining
  return {missed: true, bufferAfterDelay, remaining, replacement, extra}
}
