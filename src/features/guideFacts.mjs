// Suggested trip length from how much there is to do nearby. A heuristic, labelled as such in the UI.
export function suggestedLength(count) {
  if (!Number.isFinite(count) || count < 3) return null
  if (count < 8) return {label:'1–2 days', days:2}
  if (count < 16) return {label:'2–3 days', days:3}
  return {label:'3–5 days', days:4}
}
