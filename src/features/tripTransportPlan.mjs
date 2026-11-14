// Pure helpers for the trip Transport screen. Nothing here invents fares or schedules:
// links open provider searches, and estimates are labelled with their assumptions.

const point = place => place && Number.isFinite(place.lat) && Number.isFinite(place.lon) ? place : null

/** Where the traveller is heading: the stay, else the first planned stop. */
export function arrivalPoint(draft) {
  const stay = point(draft?.stay)
  if (stay) return {name:stay.name, lat:stay.lat, lon:stay.lon, isStay:true}
  const first = (draft?.days || []).flat().find(point)
  return first ? {name:first.name, lat:first.lat, lon:first.lon, isStay:false} : null
}

export const coords = place => point(place) ? `${place.lat},${place.lon}` : null

export function mapsDirections(origin, destination, travelmode = 'driving') {
  return 'https://www.google.com/maps/dir/?' + new URLSearchParams({api:'1', origin, destination, travelmode})
}

export function flightsSearch(from, to, date) {
  const text = `Flights from ${from} to ${to}${date ? ' on ' + date : ''} one way`
  return 'https://www.google.com/travel/flights?' + new URLSearchParams({q:text})
}

const slug = value => String(value).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-')

/** erail.in lists every train between two Indian Railways station codes, with timings and running days. */
export function trainSchedule(from, to) {
  if (!from?.code || !to?.code) return null
  return `https://erail.in/trains-between-stations/${slug(from.name)}-${from.code}/${slug(to.name)}-${to.code}`
}

/** General guidance by distance, not a claim about this route's services. */
export function distanceAdvice(airKm, roadKm) {
  const distance = roadKm ?? airKm
  if (!Number.isFinite(distance)) return null
  if (distance < 60) return 'Close enough for a cab, bus or your own vehicle.'
  if (distance < 300) return 'Usually simplest by road or a day train. Flying rarely saves time at this distance.'
  if (distance < 700) return 'An overnight train or bus saves a hotel night; flying is quicker once airport time is added.'
  return 'Flying usually saves the most time. Trains and buses take a day or more.'
}

export function hours(minutes) {
  if (!Number.isFinite(minutes)) return ''
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return h ? `${h} h${m ? ' ' + m + ' min' : ''}` : `${m} min`
}

/** Fuel for one vehicle, one way, from the traveller's own mileage and fuel price. */
export function fuelEstimate(kilometres, kmPerLitre, pricePerLitre, travelers = 1) {
  if (!(kilometres > 0 && kmPerLitre > 0 && pricePerLitre > 0)) return null
  const litres = kilometres / kmPerLitre
  const cost = Math.round(litres * pricePerLitre)
  return {litres:Math.round(litres), cost, perPerson:Math.round(cost / Math.max(1, travelers))}
}

const LOCAL_TRANSIT = new Set(['Bus', 'Metro'])

/** Suggested way to cover one itinerary leg, honouring the trip's preferred local modes. */
export function legMode(leg, preferred = []) {
  const km = leg?.kilometres
  if (!Number.isFinite(km)) return {label:'Check route', travelmode:'driving'}
  if (km <= 1.2 && (!preferred.length || preferred.includes('Walk'))) return {label:'Walk', travelmode:'walking'}
  if (preferred.some(mode => LOCAL_TRANSIT.has(mode)) && km > 1.2) return {label:'Bus or metro', travelmode:'transit'}
  if (km <= 8) return {label:preferred.includes('Cab') && !preferred.includes('Auto') ? 'Cab' : 'Auto or cab', travelmode:'driving'}
  return {label:'Cab', travelmode:'driving'}
}

/** Every leg of the itinerary grouped by day, with the stored road estimate where present. */
export function dayLegs(draft) {
  return (draft?.days || []).map((day, dayIndex) => {
    const stops = point(draft.stay) && day.length ? [draft.stay, ...day] : day
    const stored = draft.routes?.[dayIndex] || []
    const legs = []
    for (let index = 1; index < stops.length; index++) {
      const from = stops[index - 1]
      const to = stops[index]
      if (!point(from) || !point(to)) continue
      const estimate = stored[index - 1]
      legs.push({from, to, kilometres:estimate?.kilometres, minutes:estimate?.minutes, method:estimate?.method})
    }
    const known = legs.filter(leg => Number.isFinite(leg.kilometres))
    return {day:dayIndex + 1, legs,
      kilometres:Math.round(known.reduce((sum, leg) => sum + leg.kilometres, 0) * 10) / 10,
      minutes:known.reduce((sum, leg) => sum + (leg.minutes || 0), 0)}
  })
}
