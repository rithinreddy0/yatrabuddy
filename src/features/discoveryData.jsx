// Lightweight discovery data hooks, kept apart from the full DiscoveryFeed so the home page can use them
// without loading the map, place details and city brief code up front.
import React, {useEffect, useState} from 'react'
import {CloudSun} from 'lucide-react'
import {request} from '../api.mjs'

export function useNearbyDiscovery(locationId, attempt = 0, meal) {
  const [snapshot, setSnapshot] = useState({id: null, report: null, error: '', photosPending: false})
  useEffect(() => {
    if (!locationId) return
    const controller = new AbortController()
    const {signal} = controller
    const base = `locations/${locationId}/nearby?` + (meal ? `meal=${encodeURIComponent(meal)}&` : '')
    const update = (report, error, photosPending) => {
      if (!signal.aborted) setSnapshot({id: locationId, attempt, meal, report, error, photosPending})
    }
    async function load() {
      try {
        const report = await request(base + 'photos=false', {signal})
        if (signal.aborted) return
        const enrich = report.status !== 'unavailable' && report.places.some(place => !place.photo?.url)
        update(report, '', enrich)
        if (enrich) {
          const enriched = await request(base + 'photos=true', {signal}).catch(() => null)
          const pictures = new Map((enriched?.places || []).map(place => [place.url, place.photo]))
          update({...report, places: report.places.map(place => pictures.get(place.url) ? {...place, photo: pictures.get(place.url)} : place)}, '', false)
        }
      } catch (failure) {
        update(null, failure.message, false)
      }
    }
    load()
    return () => controller.abort()
  }, [locationId, attempt, meal])
  return snapshot.id === locationId && snapshot.attempt === attempt && snapshot.meal === meal
    ? snapshot : {report: null, error: '', photosPending: false}
}

export function DiscoveryWeather({cityId}) {
  const [weather, setWeather] = useState(null)
  useEffect(() => {
    if (!cityId) return
    const controller = new AbortController()
    request(`locations/${cityId}/weather`, {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setWeather(result) })
      .catch(() => {})
    return () => controller.abort()
  }, [cityId])
  if (!Number.isFinite(weather?.temperature)) return null
  return <a className="discovery-weather" href="https://open-meteo.com/" target="_blank" rel="noreferrer" title={`${weather.conditions} · Open-Meteo${weather.freshness === 'cached' ? ' · cached' : ''}`}>
    <CloudSun size={20}/><strong>{Math.round(weather.temperature)}°C</strong><span>{weather.conditions}</span>
  </a>
}
