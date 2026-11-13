import React, {useEffect, useId, useState} from 'react'
import {MapPin, Plane, TrainFront} from 'lucide-react'
import {request} from '../api.mjs'
import {Button, SourcePill} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import './TripTransport.css'

const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'})
const passSource = 'https://www.tgsrtc.telangana.gov.in/reservation-marketing-schemes'

function destinationQuery(draft) {
  return [draft.name, draft.country].filter(Boolean).join(', ')
}

function mapsUrl(action, parameters) {
  return 'https://www.google.com/maps/' + action + '/?' + new URLSearchParams({api: '1', ...parameters})
}

function coordinates(place) {
  return place && Number.isFinite(place.lat) && Number.isFinite(place.lon) ? `${place.lat},${place.lon}` : null
}

function transportPreview(draft) {
  for (const [dayIndex, day] of (draft.days || []).entries()) {
    for (const [index, place] of day.entries()) {
      const from = day[index - 1] || draft.stay
      const origin = coordinates(from)
      const destination = coordinates(place)
      if (origin && destination && origin !== destination) {
        return {origin, destination, from: from.name, to: place.name,
          leg: draft.routes?.[dayIndex]?.[index - (draft.stay ? 0 : 1)]}
      }
    }
  }
  return null
}

function openResource(state, key, path, signal, update) {
  request(path, {signal}).then(data => {
    if (!signal.aborted) update(previous => ({...previous, [key]: {state, data}}))
  }).catch(() => {
    if (!signal.aborted) update(previous => ({...previous, [key]: {state, unavailable: true}}))
  })
}

function providerButtons(providers, filter = () => true) {
  return providers?.filter(filter).map(provider =>
    <SourcePill key={provider.url} url={provider.url} label={provider.action || provider.name}/>)
}

function guidePoint(guide, title) {
  const section = guide?.sections?.find(item => item.title === title)
  if (!section?.text || !section.sourceUrl) return null
  const words = section.text.trim().split(/\s+/)
  const excerpt = words.slice(0, 25).join(' ') + (words.length > 25 ? '…' : '')
  return <details className="trip-transport-guide">
    <summary>{section.title} in Wikivoyage</summary>
    <p>{excerpt}</p>
    <SourcePill url={section.sourceUrl} label="Read the destination guide"/>
  </details>
}

export function TripTransport({draft, onAsk}) {
  const heading = useId()
  const [resources, setResources] = useState({})
  const {name, country, cityId, origin, departure, travelers, localModes} = draft || {}
  const hyderabad = country === 'India' && /^(?:hyderabad|secunderabad)$/i.test(name || '')
  const resourceKey = JSON.stringify([name, country, cityId, origin, departure, travelers])

  useEffect(() => {
    if (!name) return
    const controller = new AbortController()
    const {signal} = controller
    const query = new URLSearchParams({destination: name})
    if (country) query.set('country', country)
    if (origin) query.set('origin', origin)
    if (departure) query.set('departure', departure)
    if (Number.isInteger(travelers) && travelers > 0) query.set('travelers', String(travelers))
    openResource(resourceKey, 'providers', 'travel-providers?' + query, signal, setResources)
    if (cityId) {
      openResource(cityId, 'guide', `locations/${cityId}/guide`, signal, setResources)
      if (hyderabad) openResource(cityId, 'fares', `locations/${cityId}/local-transport`, signal, setResources)
    }
    return () => controller.abort()
  }, [resourceKey, name, country, cityId, origin, departure, travelers, hyderabad])

  if (!name) return null
  const providers = resources.providers?.state === resourceKey ? resources.providers : null
  const guide = resources.guide?.state === cityId ? resources.guide?.data : null
  const fares = resources.fares?.state === cityId ? resources.fares?.data : null
  const preview = transportPreview(draft)
  const localRoute = preview ? {origin: preview.origin, destination: preview.destination} : null
  const city = destinationQuery(draft)
  const arrivalDate = departure ? new Date(departure + 'T12:00:00Z') : null
  const tripDate = arrivalDate && Number.isFinite(arrivalDate.valueOf()) ? dateFormat.format(arrivalDate) : null
  const datePrompt = tripDate ? ` on ${departure}` : ''
  const travelersPrompt = travelers ? ` for ${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}` : ''
  const arrivalPrompt = `Compare ways to get ${origin ? `from ${origin} ` : ''}to ${city}${datePrompt}${travelersPrompt}.`
  const localPrompt = preview
    ? `Compare public transport and cab fares from ${preview.from}, ${city} to ${preview.to}, ${city}${datePrompt}.`
    : `Compare public transport and cab fares in ${city}${datePrompt}.`

  return <section className="trip-transport" aria-labelledby={heading}>
    <h2 id={heading}>Transport</h2>
    <div className="trip-transport-grid">
      <article className="trip-transport-card">
        <h3><Plane aria-hidden="true" size={18}/> Getting there</h3>
        {origin ? <p className="trip-transport-route"><span>{origin}<span aria-hidden="true"> → </span><span className="yatra-sr-only"> to </span>{name}</span></p>
          : <p>Add a departure city to compare the trip to {name}.</p>}
        {(tripDate || travelers) && <p className="trip-transport-meta">
          {tripDate && <time dateTime={departure}>{tripDate}</time>}
          {tripDate && travelers ? ' · ' : ''}
          {travelers ? `${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}` : ''}
        </p>}
        {origin && <>
          <p>Compare routes, then confirm fares and availability with the provider.</p>
          <div className="trip-transport-links">
            {providerButtons(providers?.data?.arrival?.providers)}
            {providers?.unavailable && <SourcePill label="Find travel routes" url={mapsUrl('dir', {origin, destination: city})}/>}
          </div>
        </>}
        {guidePoint(guide, 'Getting there')}
        {onAsk && <Button className="trip-transport-action" icon="arrow" onClick={() => onAsk(arrivalPrompt)}>Compare with YatraBuddy</Button>}
      </article>
      <article className="trip-transport-card">
        <h3><TrainFront aria-hidden="true" size={18}/> Getting around</h3>
        {localModes?.length > 0 && <p className="trip-transport-meta">Preferred modes · {localModes.join(', ')}</p>}
        {preview && <p className="trip-transport-route">
          <MapPin aria-hidden="true" size={15}/><span>{preview.from} to {preview.to}</span>
        </p>}
        {preview?.leg && <p className="trip-transport-meta">
          {preview.leg.kilometres} km · about {preview.leg.minutes} min {preview.leg.method === 'road' ? 'by road' : 'estimated'}
        </p>}
        <div className="trip-transport-links">
          <SourcePill label={localRoute ? 'Transit directions' : 'Find local transit'} url={localRoute ?
            mapsUrl('dir', {...localRoute, travelmode: 'transit'}) : mapsUrl('search', {query: `Public transit in ${city}`})}/>
          {localRoute && <SourcePill label="Walking directions" url={mapsUrl('dir', {...localRoute, travelmode: 'walking'})}/>}
          {providerButtons(providers?.data?.local?.providers, provider => provider.name !== 'Google Maps')}
          {providers?.unavailable && <SourcePill label="Check Uber prices" url="https://www.uber.com/global/en/price-estimate/"/>}
        </div>
        {hyderabad && <div className="trip-transport-fares">
          <strong>Published bus fares</strong>
          {fares?.passes?.length > 0 && <ul>{fares.passes.map(pass => <li key={pass.name}>
            {pass.name} · {money(pass.amount)} per person for 24 hours
          </li>)}</ul>}
          <SourcePill url={passSource} label="TGSRTC bus pass and fares"/>
        </div>}
        {guidePoint(guide, 'Getting around')}
        {onAsk && <Button className="trip-transport-action" icon="arrow" onClick={() => onAsk(localPrompt)}>Ask about local fares</Button>}
      </article>
    </div>
  </section>
}
