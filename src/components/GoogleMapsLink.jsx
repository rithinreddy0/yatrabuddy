import React from 'react'
import {ExternalLink, MapPin} from 'lucide-react'
import './TravelHighlights.css'

export function GoogleMapsLink({origin, destination, mode, place, region, href, label = 'Google Maps'}) {
  const params = new URLSearchParams({api:'1'})
  if (destination) {
    params.set('destination', destination)
    if (origin) params.set('origin', origin)
    if (mode) params.set('travelmode', mode)
  } else if (place) {
    const point = Number.isFinite(place.lat) && Number.isFinite(place.lon) ? `${place.lat},${place.lon}` : ''
    const query = [place.name, place.address || region || point].filter(Boolean).join(', ') || point
    if (!query) return null
    params.set('query', query)
    if (place.source === 'Google Maps' && place.id) params.set('query_place_id', place.id)
  }
  if (!href && !destination && !place) return null
  const url = href || `https://www.google.com/maps/${destination ? 'dir' : 'search'}/?${params}`
  return <a className="source-pill google-maps-link" href={url} target="_blank" rel="noreferrer">
    <span className="google-maps-mark" aria-hidden="true"><MapPin size={17}/><img width="18" height="18" alt=""
      src="https://www.google.com/s2/favicons?domain=maps.google.com&sz=32" onError={event=>{event.currentTarget.hidden=true}}/></span>
    {label}<ExternalLink size={13} aria-hidden="true"/>
  </a>
}
