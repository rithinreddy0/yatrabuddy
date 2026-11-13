import {useSyncExternalStore} from 'react'

const empty = Object.freeze([])
const emptyShortlists = Object.freeze({})
const savedKey = 'yatra.saved-discovery.v1'
const shortlistKey = 'yatra.discovery-shortlists.v1'

function read(key, fallback) {
  try { return JSON.parse(globalThis.localStorage.getItem(key)) ?? fallback }
  catch { return fallback }
}

function placeStore(key, fallback, valid) {
  const load = () => {
    const value = read(key, fallback)
    return valid(value) ? value : fallback
  }
  let value = load()
  const listeners = new Set()
  function notify() {
    for (const listener of listeners) listener()
  }
  globalThis.addEventListener?.('storage', event => {
    if (event.key === key || event.key === null) {
      value = load()
      notify()
    }
  })
  return {
    get: () => value,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    write(next) {
      value = next
      try { globalThis.localStorage.setItem(key, JSON.stringify(next)) }
      catch { /* The session keeps the selection when storage is unavailable. */ }
      notify()
    },
  }
}

const saved = placeStore(savedKey, empty, Array.isArray)
const shortlists = placeStore(shortlistKey, emptyShortlists, value => value && typeof value === 'object' && !Array.isArray(value))
const publicSources = new Set(['Wikipedia', 'Wikivoyage', 'OpenStreetMap'])

export function discoveryPlaceKey(place) {
  return place?.url || place?.id || ''
}

export function isSaveableDiscoveryPlace(place) {
  if (!publicSources.has(place?.source) || !place?.name) return false
  try {
    const {protocol, hostname} = new URL(place.url)
    return protocol === 'https:' && ['en.wikipedia.org', 'en.wikivoyage.org', 'www.openstreetmap.org'].includes(hostname)
  } catch { return false }
}

export function useSavedDiscoveryPlaces() {
  return useSyncExternalStore(saved.subscribe, saved.get, () => empty)
}

export function toggleDiscoverySaved(place, city) {
  if (!isSaveableDiscoveryPlace(place)) return false
  const key = discoveryPlaceKey(place)
  const current = saved.get()
  const exists = current.some(item => discoveryPlaceKey(item) === key)
  const location = city?.id ? {id: city.id, name: city.name, region: city.region, country: city.country, lat: city.lat, lon: city.lon} : place.discoveryCity
  const next = exists ? current.filter(item => discoveryPlaceKey(item) !== key)
    : [{...place, discoveryCity: location}, ...current].slice(0, 100)
  saved.write(next)
  return !exists
}

function cityKey(cityId) {
  const key = String(cityId ?? '').replace(/^geo:/, '')
  return /^\d+$/.test(key) ? key : null
}

export function useDiscoveryShortlist(cityId) {
  const lists = useSyncExternalStore(shortlists.subscribe, shortlists.get, () => emptyShortlists)
  const list = lists[cityKey(cityId)]
  return Array.isArray(list) ? list : empty
}

export function toggleDiscoveryShortlist(cityId, place) {
  const key = cityKey(cityId)
  if (!key || !isSaveableDiscoveryPlace(place)) return false
  const current = shortlists.get()
  const places = Array.isArray(current[key]) ? current[key] : []
  const id = discoveryPlaceKey(place)
  const exists = places.some(item => discoveryPlaceKey(item) === id)
  const candidates = places.filter(item => discoveryPlaceKey(item) !== id && (place.category !== 'Stay' || item.category !== 'Stay'))
  const next = exists ? places.filter(item => discoveryPlaceKey(item) !== id) : [place, ...candidates].slice(0, 26)
  const otherCities = Object.entries(current).filter(([item]) => item !== key).slice(-24)
  shortlists.write({...Object.fromEntries(otherCities), [key]: next})
  return !exists
}

const categoryScores = {
  Nature: {Nature: 5, Culture: 0, Adventure: 1},
  Sight: {Nature: 0, Culture: 4, Adventure: 0},
  Activity: {Nature: 1, Culture: 1, Adventure: 4},
  Food: {Nature: 0, Culture: 1, Adventure: 0},
  Shopping: {Nature: 0, Culture: 2, Adventure: 0},
}

export function placeInterestScores(place) {
  const words = [place.name, place.description, place.overview, place.category].filter(Boolean).join(' ')
  const category = categoryScores[place.category] || {}
  return {
    Nature: /\b(?:national park|wildlife|forest|waterfall|beach|mountain|lake|garden|nature|bird sanctuary)\b/i.test(words) ? 5 : category.Nature || 0,
    Culture: /\b(?:heritage|historic|museum|temple|art gallery|palace|fort|monument|old town|cathedral|mosque|shrine)\b/i.test(words) ? 5 : category.Culture || 0,
    Adventure: /\b(?:trek|hiking|climbing|rafting|kayaking|surfing|diving|zipline|caving|paragliding|safari)\b/i.test(words) ? 5 : category.Adventure || 0,
  }
}

const profileCategories = {
  'Arts & design': ['Sight'], 'Food': ['Food'], 'Nightlife': ['Food', 'Activity'],
  'Relaxation': ['Nature', 'Stay'], 'Shopping': ['Shopping'],
}

export function rankDiscoveryPlaces(places, sort, interests = []) {
  const score = place => {
    const scores = placeInterestScores(place)
    return interests.reduce((sum, theme) => sum + (scores[theme] ?? (profileCategories[theme]?.includes(place.category) ? 5 : 0)), 0)
  }
  const distance = place => Number.isFinite(place.distanceMetres) ? place.distanceMetres : Infinity
  const rating = place => Number.isFinite(place.rating) ? place.rating : -1
  return [...places].sort((a, b) => {
    if (sort === 'Rating') return rating(b) - rating(a) || distance(a) - distance(b)
    if (sort === 'Nearest') return distance(a) - distance(b)
    const match = sort === 'For you' ? score(b) - score(a) : placeInterestScores(b)[sort] - placeInterestScores(a)[sort]
    return match || Number(Boolean(b.photo?.url)) - Number(Boolean(a.photo?.url)) || distance(a) - distance(b)
  })
}
