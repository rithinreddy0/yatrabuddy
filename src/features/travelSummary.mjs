import {placeInterestScores} from './discoveryPlaces.mjs'

const groupLabels = {
  Sight: ['sight', 'sights'],
  Nature: ['outdoor spot', 'outdoor spots'],
  Food: ['food spot', 'food spots'],
  Stay: ['stay', 'stays'],
  Activity: ['activity', 'activities'],
  Shopping: ['shopping spot', 'shopping spots'],
  Other: ['other place', 'other places'],
}

const extraInterests = {
  Food: ['Food'],
  Relaxation: ['Nature', 'Stay'],
  Shopping: ['Shopping'],
  'Arts & design': ['Sight'],
  Nightlife: ['Activity'],
}

export function travelSourceUrl(value) {
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function hasRating(place) {
  return Number.isFinite(place.rating) && place.rating > 0 && place.rating <= 5
}

function hasPrice(place) {
  return Boolean(place.publishedPrice?.trim() || place.priceRange?.start || place.priceRange?.end || (
    place.priceLevel && place.priceLevel !== 'PRICE_LEVEL_UNSPECIFIED'
  ))
}

function sharedLocation(places) {
  const city = places[0]?.discoveryCity
  const id = String(city?.id || '').replace(/^geo:/, '')
  return city?.name && Number(id) > 0 && places.every(place =>
    String(place.discoveryCity?.id || '').replace(/^geo:/, '') === id
  ) ? {...city, id} : null
}

export function summarizePlaces(places, {profile} = {}) {
  const unique = new Map()
  for (const place of places || []) {
    if (!place?.name) continue
    const source = travelSourceUrl(place.url)
    const key = source || place.id || place.name
    if (!unique.has(key)) unique.set(key, {...place, sourceUrl:source})
  }
  const records = [...unique.values()]
  const mix = new Map()
  const themes = [...new Set([...(profile?.interests || []), profile?.style].filter(Boolean))]
  const ranked = records.map(place => {
    const category = Object.hasOwn(groupLabels, place.category) ? place.category : 'Other'
    mix.set(category, (mix.get(category) || 0) + 1)
    const scores = placeInterestScores(place)
    const matches = themes.filter(theme => (scores[theme] ?? 0) >= 3 || extraInterests[theme]?.includes(category))
    return {...place, category, matches}
  })
  ranked.sort((first, second) => second.matches.length - first.matches.length
    || Number(Boolean(second.description || second.overview)) - Number(Boolean(first.description || first.overview))
    || Number(Boolean(second.photo?.url)) - Number(Boolean(first.photo?.url)))
  const varied = new Map()
  for (const place of ranked) {
    if (!varied.has(place.category)) varied.set(place.category, place)
  }
  const picks = [...new Set([...varied.values(), ...ranked])].slice(0, 3)
  const rated = records.filter(hasRating).length
  const priced = records.filter(hasPrice).length
  const coverage = []
  if (records.length) {
    coverage.push(rated ? `${rated} of ${records.length} with source ratings` : 'Sources list no traveler ratings')
    coverage.push(priced ? `${priced} of ${records.length} with price information` : 'Sources list no prices')
    if (mix.has('Stay')) coverage.push('Confirm room availability and current rates with the property')
  }
  return {
    count: records.length,
    mix: [...mix].map(([category, count]) => `${count} ${groupLabels[category][count === 1 ? 0 : 1]}`),
    picks,
    coverage,
    location: sharedLocation(records),
  }
}
