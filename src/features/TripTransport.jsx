import React, {useEffect, useId, useState} from 'react'
import {MapPin, Plane, TrainFront} from 'lucide-react'
import {request} from '../api.mjs'
import {Button, SourcePill, TravelArtwork} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {TransportQuotes} from './TransportSources.jsx'
import './TripTransport.css'

const dateFormat = new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeZone: 'UTC'})
const passSource = 'https://www.tgsrtc.telangana.gov.in/reservation-marketing-schemes'
const intercityModes = [['Flights', 'Flights'], ['Rail', 'Trains'], ['Intercity bus', 'Buses']]

function RouteSearch({draft, result, onSearch, onAsk, quotes, searching}) {
  const [mode, setMode] = useState('All')
  const [pinned, setPinned] = useState([])
  const providers = result?.data?.arrival?.providers || []
  const picks = providers.filter(provider => pinned.includes(provider.url))
  const modes = intercityModes.filter(([value]) => mode === 'All' || mode === value)
  return <section className="trip-transport-search">
    <form className="trip-transport-fields" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const date = form.get('departure')
      const time = form.get('departureTime')
      onSearch({origin:form.get('origin').trim(), name:form.get('destination').trim(),
        departure:date, departAt:date&&time?new Date(date+'T'+time).toISOString():'', travelers:Number(form.get('travelers'))})
    }}>
      <label>From<input name="origin" defaultValue={draft.origin || ''} required maxLength={120} placeholder="City or airport code"/></label>
      <label>To<input name="destination" defaultValue={draft.name} required maxLength={120} placeholder="City or airport code"/></label>
      <label>Date<input name="departure" type="date" defaultValue={draft.departure || ''}/></label>
      <label>Time (device time)<input name="departureTime" type="time"/></label>
      <label>Travelers<input name="travelers" type="number" defaultValue={draft.travelers || 1} min={1} max={99} required/></label>
      <Button type="submit" variant="primary" icon="search">Compare routes</Button>
    </form>
    <div className="filters" aria-label="Transport mode">
      {[['All','All modes'], ...intercityModes].map(([value, label]) =>
        <Button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{label}</Button>)}
    </div>
    {searching && <p role="status">Checking schedules and fares…</p>}
    {quotes?.unavailable && <p role="status">Timed options are temporarily unavailable.</p>}
    <TransportQuotes quotes={quotes?.data?.quotes} kind={mode==='All'?undefined:mode==='Flights'?'flights':'transit'}/>
    {result?.unavailable && <p role="status">Operator links are temporarily unavailable. Submit the route to retry.</p>}
    {result?.data && <div className="trip-transport-comparison">{modes.map(([value, label]) => {
      const options = providers.filter(provider => provider.mode === value)
      return <article className="trip-transport-card" key={value}>
        <h3>{label}</h3>
        {options.length ? options.map(option => <div key={option.url}>
          <strong>{option.name}</strong><p>{option.summary}</p><SourcePill url={option.url} label={option.action}/>
          <Button variant="text-btn" icon="pin" aria-pressed={pinned.includes(option.url)} onClick={() =>
            setPinned(previous => previous.includes(option.url) ? previous.filter(url => url !== option.url) : [...previous, option.url])}>
            {pinned.includes(option.url) ? 'Unpin' : 'Pin to compare'}
          </Button>
        </div>) : <p>No provider found for this route.</p>}
      </article>
    })}</div>}
    {!!picks.length && <section className="trip-transport-card" aria-label="Pinned operators">
      <h3>Pinned operators</h3>
      {picks.map(option => <div key={option.url}><strong>{option.name}</strong> · {option.mode} <SourcePill url={option.url} label={option.action}/></div>)}
    </section>}
    {onAsk && <Button icon="chat" onClick={onAsk}>Discuss this route in chat</Button>}
  </section>
}

function destinationQuery(draft) {
  return [draft.name, draft.country].filter(Boolean).join(', ')
}

function mapsUrl(action, parameters) {
  return 'https://www.google.com/maps/' + action + '/?' + new URLSearchParams({api: '1', ...parameters})
}

function coordinates(place) {
  return place && Number.isFinite(place.lat) && Number.isFinite(place.lon) ? `${place.lat},${place.lon}` : null
}

function itineraryLegs(draft) {
  const legs = []
  for (const [dayIndex, day] of (draft.days || []).entries()) {
    for (const [index, place] of day.entries()) {
      const from = day[index - 1] || draft.stay
      const origin = coordinates(from)
      const destination = coordinates(place)
      if (origin && destination && origin !== destination) {
        legs.push({origin, destination, from: from.name, to: place.name, day: dayIndex+1,
          leg: draft.routes?.[dayIndex]?.[index - (draft.stay ? 0 : 1)]})
      }
    }
  }
  return legs
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
  const [search, setSearch] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [localIndex,setLocalIndex] = useState(0)
  const [localLookup,setLocalLookup] = useState(null)
  const {name, country, cityId, origin, departure, travelers, localModes} = draft || {}
  const hyderabad = country === 'India' && /^(?:hyderabad|secunderabad)$/i.test(name || '')
  const route = search || {origin, name, departure, travelers}
  const routeCountry = route.name === name ? country : null
  const resourceKey = JSON.stringify([route.name, routeCountry, route.origin, route.departure, route.travelers, attempt])
  const requestQuery = new URLSearchParams({destination:route.name || ''})
  if (routeCountry) requestQuery.set('country', routeCountry)
  if (route.origin) requestQuery.set('origin', route.origin)
  if (route.departure) requestQuery.set('departure', route.departure)
  if (route.travelers) requestQuery.set('travelers', String(route.travelers))
  const providerQuery = requestQuery.toString()
  const timetableQuery = new URLSearchParams(providerQuery)
  if (route.departAt) timetableQuery.set('depart_at',route.departAt)
  const timetablePath = 'travel-providers?timetable=true&' + timetableQuery

  useEffect(() => {
    if (!name || !route.name) return
    const controller = new AbortController()
    openResource(resourceKey, 'providers', 'travel-providers?' + providerQuery, controller.signal, setResources)
    return () => controller.abort()
  }, [resourceKey, providerQuery, name, route.name])

  useEffect(() => {
    if (!search?.origin || !search.name) return
    const controller = new AbortController()
    openResource(resourceKey, 'quotes', timetablePath, controller.signal, setResources)
    return () => controller.abort()
  }, [resourceKey, timetablePath, search])

  useEffect(() => {
    if (!localLookup) return
    const controller = new AbortController()
    openResource(localLookup, 'localQuotes', 'travel-providers?' + localLookup, controller.signal, setResources)
    return () => controller.abort()
  }, [localLookup])

  useEffect(() => {
    if (!cityId) return
    const controller = new AbortController()
    const {signal} = controller
    openResource(cityId, 'guide', `locations/${cityId}/guide`, signal, setResources)
    if (hyderabad) openResource(cityId, 'fares', `locations/${cityId}/local-transport`, signal, setResources)
    return () => controller.abort()
  }, [cityId, hyderabad])

  if (!name) return null
  const providers = resources.providers?.state === resourceKey ? resources.providers : null
  const searching = Boolean(search && resources.quotes?.state !== resourceKey)
  const guide = resources.guide?.state === cityId ? resources.guide?.data : null
  const fares = resources.fares?.state === cityId ? resources.fares?.data : null
  const legs = itineraryLegs(draft)
  const preview = legs[localIndex] || legs[0]
  const localRoute = preview ? {origin: preview.origin, destination: preview.destination} : null
  const city = destinationQuery(draft)
  const arrivalDate = departure ? new Date(departure + 'T12:00:00Z') : null
  const tripDate = arrivalDate && Number.isFinite(arrivalDate.valueOf()) ? dateFormat.format(arrivalDate) : null
  const datePrompt = tripDate ? ` on ${departure}` : ''
  const travelersPrompt = travelers ? ` for ${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}` : ''
  const arrivalPrompt = `Compare ways to get ${origin ? `from ${origin} ` : ''}to ${city}${datePrompt}${travelersPrompt}.`
  const localPrompt = preview
    ? `Compare public transport and cab fares from ${preview.from}, ${city} to ${preview.to}, ${city}${localLookup && new URLSearchParams(localLookup).get('depart_at') ? ' on ' + new URLSearchParams(localLookup).get('depart_at') : datePrompt}.`
    : `Compare public transport and cab fares in ${city}${datePrompt}.`

  return <section className="trip-transport" aria-labelledby={heading}>
    <header className="trip-transport-heading">
      <h2 id={heading}>Intercity transport</h2>
      <TravelArtwork name="transport-plane" animated={!providers || searching} className="transport-plane-art" width={210} height={160}/>
    </header>
    <RouteSearch key={draft.id || name} draft={draft} result={providers} searching={searching}
      quotes={resources.quotes?.state===resourceKey?resources.quotes:null} onSearch={next => {
      setSearch(next)
      setAttempt(value => value + 1)
    }} onAsk={onAsk && (() => onAsk(route.origin ? `Compare flights, trains and buses from ${route.origin} to ${route.name}${route.departAt ? ' on ' + route.departAt : route.departure ? ' on ' + route.departure : ''} for ${route.travelers || 1} travelers.` : arrivalPrompt))}/>
    {!providers && <p role="status">Checking route providers…</p>}
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
            {!search && providerButtons(providers?.data?.arrival?.providers, provider => !intercityModes.some(([mode]) => mode === provider.mode))}
            {providers?.unavailable && <SourcePill label="Find travel routes" url={mapsUrl('dir', {origin, destination: city})}/>}
          </div>
        </>}
        {guidePoint(guide, 'Getting there')}
        {onAsk && <Button className="trip-transport-action" icon="arrow" onClick={() => onAsk(arrivalPrompt)}>Compare with YatraBuddy</Button>}
      </article>
      <article className="trip-transport-card">
        <h3><TrainFront aria-hidden="true" size={18}/> Local transport</h3>
        {localModes?.length > 0 && <p className="trip-transport-meta">Preferred modes · {localModes.join(', ')}</p>}
        {preview && <p className="trip-transport-route">
          <MapPin aria-hidden="true" size={15}/><span>{preview.from} to {preview.to}</span>
        </p>}
        {preview?.leg && <p className="trip-transport-meta">
          {preview.leg.kilometres} km · about {preview.leg.minutes} min {preview.leg.method === 'road' ? 'by road' : 'estimated'}
        </p>}
        {preview && <form className="trip-transport-fields" onSubmit={event=>{
          event.preventDefault()
          const value=new FormData(event.currentTarget).get('depart')
          const query=new URLSearchParams({...localRoute,timetable:'true',local:'true'})
          if(value)query.set('depart_at',new Date(value).toISOString())
          setLocalLookup(query.toString())
        }}>
          <label>Itinerary leg<select value={legs.indexOf(preview)} onChange={event=>{setLocalIndex(Number(event.target.value));setLocalLookup(null)}}>
            {legs.map((leg,index)=><option key={index} value={index}>Day {leg.day} · {leg.from} → {leg.to}</option>)}</select></label>
          <label>Depart at (device time)<input name="depart" type="datetime-local"/></label>
          <Button type="submit" icon="search">Check local schedules</Button>
        </form>}
        {localLookup && resources.localQuotes?.state!==localLookup && <p role="status">Checking local schedules…</p>}
        {localLookup && resources.localQuotes?.state===localLookup && (resources.localQuotes.unavailable
          ? <p>Local schedules are temporarily unavailable.</p> : <TransportQuotes quotes={resources.localQuotes.data.quotes}/>)}
        <div className="trip-transport-links">
          <SourcePill label={localRoute ? 'Transit directions' : 'Find local transit'} url={localRoute ?
            mapsUrl('dir', {...localRoute, travelmode: 'transit'}) : mapsUrl('search', {query: `Public transit in ${city}`})}/>
          {localRoute && <SourcePill label="Walking directions" url={mapsUrl('dir', {...localRoute, travelmode: 'walking'})}/>}
          {route.name === name && providerButtons(providers?.data?.local?.providers, provider => provider.name !== 'Google Maps')}
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
