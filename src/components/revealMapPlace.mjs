export function revealMapCard(container, id, day) {
  const rows = [...(container?.querySelectorAll('[data-map-place]') || [])].filter(node => node.dataset.mapPlace === id)
  if (!rows.length) return false
  const card = (day && rows.findLast(node => Number(node.dataset.mapDay) === day)) ||
    rows.findLast(node => node.offsetWidth && !node.closest('.journey-itinerary-photos')) || rows.at(-1)
  for (let parent = card.parentElement; parent && parent !== container; parent = parent.parentElement) {
    if (parent.tagName === 'DETAILS') parent.open = true
  }
  card.focus({preventScroll:true})
  card.scrollIntoView({block:'start',inline:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'})
  return true
}
