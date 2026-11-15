import React, {useEffect, useId, useState} from 'react'
import {Bus, Car, Footprints, Fuel, MapPin, Plane, Route, TrainFront} from 'lucide-react'
import {request} from '../api.mjs'
import {Button, SourcePill} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {TransportQuotes} from './TransportSources.jsx'
import {GroqResearchResult} from './GroqResearch.jsx'
import {JourneyMap} from './JourneyMap.jsx'
import {JourneyPlanner} from './JourneyPlanner.jsx'
import {arrivalPoint, coords, dayLegs, distanceAdvice, flightsSearch, fuelEstimate, hours, legMode, mapsDirections, trainSchedule} from './tripTransportPlan.mjs'
import './TripTransport.css'

const dateFormat = new Intl.DateTimeFormat(undefined, {day:'numeric', month:'short', year:'numeric', timeZone:'UTC'})
const passSource = 'https://www.tgsrtc.telangana.gov.in/reservation-marketing-schemes'
const bookingTypes = {flight:'Flight', train:'Train', bus:'Bus', drive:'Car or cab'}
const FUEL_KEY = 'yatra.fuelAssumptions'
const intercityModes = [
  ['Flights', 'Flights'], ['Rail', 'Trains'], ['Intercity bus', 'Buses'],
  ['Driving', 'Driving'], ['Ride-hail', 'Private rides'],
]

/** Abort outdated lookups and associate each result with its request. */
function useResource(path, attempt = 0) {
  const [state, setState] = useState({path:null})
  useEffect(() => {
    if (!path) return
    const controller = new AbortController()
    setState({path, attempt, loading:true})
    request(path, {signal:controller.signal})
      .then(data => { if (!controller.signal.aborted) setState({path, attempt, data}) })
      .catch(error => { if (!controller.signal.aborted) setState({path, attempt, error:error.message || 'Unavailable'}) })
    return () => controller.abort()
  }, [path, attempt])
  return state.path === path && state.attempt === attempt ? state : {loading:Boolean(path)}
}

function TransportResearch({query, label}) {
  const [attempt, setAttempt] = useState(0)
  const research = useResource(attempt ? 'travel-providers?research=true&' + query : null, attempt)
  return <>
    <div><Button icon="search" disabled={research.loading} onClick={() => setAttempt(value => value + 1)}>{label}</Button></div>
    {research.loading && <p role="status">Searching public transport sources…</p>}
    <GroqResearchResult title="Published transport information" result={research.error
      ? {error:'Web research is temporarily unavailable. Check the operator links.'} : research.data}/>
  </>
}

function missingModes(quotes) {
  const hasTransit = pattern => quotes?.transit?.options?.some(option =>
    option.legs?.some(leg => pattern.test(leg.vehicle || '')))
  return intercityModes.map(([, label]) => label).filter(label => {
    if (label === 'Flights') return quotes?.flights?.status !== 'ready'
    if (label === 'Driving') return quotes?.driving?.status !== 'ready'
    if (label === 'Trains') return !hasTransit(/rail|train/i)
    if (label === 'Buses') return !hasTransit(/bus|coach/i)
    return true
  })
}

function CompareOperators({arrival, loading, error}) {
  const [mode, setMode] = useState('')
  const [pins, setPins] = useState([])
  const operators = (arrival?.providers || []).filter(provider => intercityModes.some(([value]) => value === provider.mode))
  const pinned = operators.filter(provider => pins.includes(provider.url))
  function togglePin(url) {
    setPins(previous => previous.includes(url) ? previous.filter(pin => pin !== url) : [...previous, url])
  }
  return <details className="tt-day">
    <summary><strong>Compare transport operators</strong></summary>
    <div className="trip-transport-card">
      {loading && <p role="status">Checking route providers…</p>}
      {error && <p role="status">Operator links are temporarily unavailable. Submit the route to retry.</p>}
      <label>Transport mode<select value={mode} onChange={event => setMode(event.target.value)}>
        <option value="">All modes</option>
        {intercityModes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      {intercityModes.filter(([value]) => !mode || value === mode).map(([value, label]) =>
        <section key={value}>
          <h4>{label}</h4>
          {operators.some(provider => provider.mode === value) ? operators.filter(provider => provider.mode === value).map(provider =>
            <div key={provider.url}>
              <strong>{provider.name}</strong><p>{arrival.arrivalTips?.[value] || provider.summary}</p>
              <div className="tt-actions">
                <SourcePill url={provider.url} label={provider.action || provider.name}/>
                <Button variant="text-btn" icon="pin" aria-pressed={pins.includes(provider.url)} onClick={() => togglePin(provider.url)}>
                  {pins.includes(provider.url) ? 'Unpin' : 'Pin to compare'}
                </Button>
              </div>
            </div>) : !loading && !error && <p>No provider found for this route.</p>}
        </section>)}
      {pinned.length > 0 && <section aria-label="Pinned operators">
        <h4>Pinned operators</h4>
        {pinned.map(provider => <div className="tt-actions" key={provider.url}>
          <span>{provider.name} · {provider.mode}</span><SourcePill url={provider.url} label={provider.action || provider.name}/>
        </div>)}
      </section>}
    </div>
  </details>
}

function ModeCard({id, active, icon:Glyph, title, lead, children, actions, onSave, saved, onUse}) {
  return <article className="tt-mode" id={id} data-active={active || undefined}>
    <header><span className="tt-mode-icon"><Glyph size={18} aria-hidden="true"/></span>
      <div><h4>{title}</h4>{lead && <p>{lead}</p>}</div></header>
    {children}
    <div className="tt-actions">{actions}
      {onUse && <Button variant="primary" icon="check" onClick={onUse}>Use for my trip</Button>}
      {onSave && <Button variant="text-btn" icon={saved === 'saved' ? 'check' : 'trip'} disabled={['saving', 'saved'].includes(saved)} onClick={onSave}>
        {saved === 'saved' ? 'Saved to bookings' : saved === 'saving' ? 'Saving…' : 'Save as an option'}</Button>}
    </div>
    {saved && !['saving', 'saved'].includes(saved) && <small role="status">{saved}</small>}
  </article>
}

function Hub({hub, to}) {
  return <li>
    <strong>{hub.name}</strong>{hub.code && <span className="tt-code">{hub.code}</span>}
    <small>{hub.distanceKm} km {to ? 'from ' + to : 'away'} (straight line)</small>
  </li>
}

function FuelEstimator({kilometres, travelers}) {
  const [values, setValues] = useState(() => {
    try { return {mileage:15, price:105, ...JSON.parse(localStorage.getItem(FUEL_KEY) || '{}')} } catch { return {mileage:15, price:105} }
  })
  const estimate = fuelEstimate(kilometres, Number(values.mileage), Number(values.price), travelers)
  function update(key, value) {
    const next = {...values, [key]:value}
    setValues(next)
    try { localStorage.setItem(FUEL_KEY, JSON.stringify(next)) } catch {}
  }
  return <div className="tt-fuel">
    <p><Fuel size={15} aria-hidden="true"/> Fuel, one way: <strong>{estimate ? money(estimate.cost) : '—'}</strong>
      {estimate && travelers > 1 && <span> · {money(estimate.perPerson)} each if split {travelers} ways</span>}</p>
    <div className="tt-fuel-inputs">
      <label>Mileage (km/l)<input type="number" min={1} max={60} step={0.5} value={values.mileage} onChange={event => update('mileage', event.target.value)}/></label>
      <label>Fuel price (₹/l)<input type="number" min={1} max={500} step={0.5} value={values.price} onChange={event => update('price', event.target.value)}/></label>
    </div>
    <small>Your assumptions, not a quote. Tolls, parking and driver costs are not included.</small>
  </div>
}

function LocalSchedules({origin, destination, leg, name, country, departure, onAsk}) {
  const [lookup, setLookup] = useState({departAt:'', attempt:0})
  const [showMap, setShowMap] = useState(false)
  const route = {origin, destination}
  const transit = useResource('transit/plan?' + new URLSearchParams({...route,
    ...(lookup.departAt ? {departure:lookup.departAt} : {})}), lookup.attempt)
  const local = useResource('travel-providers?' + new URLSearchParams({...route, timetable:'true', local:'true',
    ...(lookup.departAt ? {depart_at:lookup.departAt} : {})}), lookup.attempt)
  const researchQuery = new URLSearchParams({local:'true',
    origin:[leg.from.name, name].join(', ').slice(0, 120),
    destination:[leg.to.name, name].join(', ').slice(0, 120),
    ...(country ? {country} : {}), ...(departure ? {departure} : {}),
    ...(lookup.departAt ? {depart_at:lookup.departAt} : {})})
  const points = [leg.from, leg.to]
  return <>
    <form className="tt-route-form" onSubmit={event => {
      event.preventDefault()
      const value = new FormData(event.currentTarget).get('depart')
      setLookup(previous => ({departAt:value ? new Date(value).toISOString() : '', attempt:previous.attempt + 1}))
    }}>
      <label>Depart at (device time)<input name="depart" type="datetime-local"/></label>
      <Button type="submit" icon="search">Check local schedules</Button>
    </form>
    <div className="tt-actions">
      <Button aria-expanded={showMap} onClick={() => setShowMap(value => !value)}>{showMap ? 'Hide leg map' : 'Show leg map'}</Button>
      <SourcePill url={mapsDirections(origin, destination, 'transit')} label="Transit directions"/>
      <SourcePill url={mapsDirections(origin, destination, 'walking')} label="Walking directions"/>
      {onAsk && <Button icon="chat" onClick={() => onAsk(`Compare public transport and cab fares from ${leg.from.name} to ${leg.to.name} in ${name}${lookup.departAt || departure ? ' on ' + (lookup.departAt || departure) : ''}.`)}>Ask about local fares</Button>}
    </div>
    {showMap && <JourneyMap center={{name:`${leg.from.name} to ${leg.to.name}`}} places={points}
      routes={[{day:1, approximate:true, label:'Straight-line preview', points:points.map(({lat, lon}) => [lat, lon])}]} compactControls/>}
    {(transit.loading || local.loading) && <p role="status">Checking local schedules…</p>}
    <TransportQuotes quotes={transit.data && {transit:transit.data}}/>
    <TransportQuotes quotes={local.data?.quotes}/>
    {!transit.loading && !local.loading && ![transit.data, local.data?.quotes?.transit].some(group => group?.status === 'ready') && <>
      <p>No confirmed schedule was returned for this leg.</p>
      <TransportResearch key={lookup.attempt} query={researchQuery} label="Research local transport"/>
    </>}
  </>
}

function LegRow({leg, preferred, ...context}) {
  const [showSchedules, setShowSchedules] = useState(false)
  const origin = coords(leg.from)
  const destination = coords(leg.to)
  const mode = legMode(leg, preferred)
  const Glyph = mode.travelmode === 'walking' ? Footprints : mode.travelmode === 'transit' ? Bus : Car
  return <li className="tt-leg">
    <div className="tt-leg-main">
      <span className="tt-leg-mode"><Glyph size={15} aria-hidden="true"/>{mode.label}</span>
      <span className="tt-leg-route">{leg.from.name} <span aria-hidden="true">→</span><span className="yatra-sr-only"> to </span> {leg.to.name}</span>
      <small>{Number.isFinite(leg.kilometres) ? `${leg.kilometres} km · about ${hours(leg.minutes)}${leg.method === 'straight-line' ? ' (straight-line estimate)' : ' by road'}` : 'Distance not estimated'}</small>
    </div>
    <div className="tt-actions">
      <SourcePill url={mapsDirections(origin, destination, mode.travelmode)} label="Directions"/>
      {origin !== destination && <Button variant="text-btn" icon="search" aria-expanded={showSchedules}
        onClick={() => setShowSchedules(value => !value)}>Public transport times</Button>}
    </div>
    {showSchedules && <LocalSchedules leg={leg} origin={origin} destination={destination} {...context}/>}
  </li>
}

function guidePoint(guide, title) {
  const section = guide?.sections?.find(item => item.title === title)
  if (!section?.text || !section.sourceUrl) return null
  const words = section.text.trim().split(/\s+/)
  return <details className="trip-transport-guide">
    <summary>{title} · travel guide</summary>
    <p>{words.slice(0, 45).join(' ')}{words.length > 45 ? '…' : ''}</p>
    <SourcePill url={section.sourceUrl} label="Read on Wikivoyage"/>
  </details>
}

export function TripTransport(props) {
  return <TransportView key={props.draft?.id} {...props}/>
}

function TransportView({draft, onAsk, onSaveDraft}) {
  const heading = useId()
  const {name, country, cityId, departure, travelers = 1, localModes = []} = draft || {}
  const [route, setRoute] = useState({origin:draft?.origin || '', name, departure:departure || '', time:'', departAt:'', travelers})
  const [attempt, setAttempt] = useState(0)
  const [editing, setEditing] = useState(!draft?.origin)
  const [saved, setSaved] = useState({})
  const [chosenMode, setChosenMode] = useState(null)
  const [startMode, setStartMode] = useState(null)
  const arrival = arrivalPoint(draft)
  const draftRoute = route.name === name
  const planOrigin = draftRoute ? route.origin : draft?.origin
  const plan = useResource(arrival ? 'trip-transport?' + new URLSearchParams({lat:arrival.lat, lon:arrival.lon, name:arrival.name,
    ...(planOrigin ? {origin:planOrigin} : {})}) : null, attempt)
  const providerParams = new URLSearchParams({destination:route.name || ''})
  if (draftRoute && country) providerParams.set('country', country)
  if (route.origin) providerParams.set('origin', route.origin)
  if (route.departure) providerParams.set('departure', route.departure)
  if (route.travelers) providerParams.set('travelers', String(route.travelers))
  const providers = useResource(name ? 'travel-providers?' + providerParams : null, attempt)
  const draftProviders = useResource(name && !draftRoute ? 'travel-providers?' + new URLSearchParams({destination:name,
    ...(country ? {country} : {})}) : null)
  const timing = new URLSearchParams(providerParams)
  if (route.departAt) timing.set('depart_at', route.departAt)
  const quotes = useResource(name && route.origin && (route.departure || attempt) ? 'travel-providers?timetable=true&' + timing : null, attempt)
  const guide = useResource(cityId ? `locations/${cityId}/guide` : null)
  const hyderabad = country === 'India' && /^(?:hyderabad|secunderabad)$/i.test(name || '')
  const fares = useResource(hyderabad && cityId ? `locations/${cityId}/local-transport` : null)
  if (!name) return null

  const data = plan.data
  const origin = data?.origin
  const destHubs = data?.hubs?.destination || {airports:[], stations:[]}
  const originHubs = data?.hubs?.origin || {airports:[], stations:[]}
  const stayLabel = arrival?.isStay ? 'your stay' : arrival?.name
  const routeLabel = [route.origin || 'Departure city not set', route.name].join(' → ')
  const date = new Date(route.departure + 'T12:00:00Z')
  const tripDate = Number.isFinite(date.valueOf()) ? dateFormat.format(date) : 'No date'
  const advice = distanceAdvice(data?.airDistanceKm, data?.road?.kilometres)
  const arrivalCoords = coords(arrival)
  const days = dayLegs(draft)
  const localProviders = ((draftRoute ? providers.data : draftProviders.data)?.local?.providers || []).filter(item => item.name !== 'Google Maps')
  const compareProviders = (providers.data?.arrival?.providers || []).filter(item => item.mode === 'Route comparison')
  const hasLiveQuotes = quotes.data?.quotes && Object.values(quotes.data.quotes).some(group => group.status === 'ready')
  const missing = missingModes(quotes.data?.quotes)
  const hasLegs = days.some(day => day.legs.length)
  const nearbyIntercity = data?.airDistanceKm != null && data.airDistanceKm < 60

  async function track(kind, title, url) {
    setSaved(current => ({...current, [kind]:'saving'}))
    try {
      const room = await request('trip-workspaces', {method:'POST', body:draft})
      await request(`trip-workspaces/${room.id}/entries`, {method:'POST', body:{kind:'booking', status:'suggested',
        title:title.slice(0, 220), url, bookingType:bookingTypes[kind], date:route.departure || null,
        notes:'Saved from Transport. Not booked yet.'}})
      setSaved(current => ({...current, [kind]:'saved'}))
    } catch (error) {
      setSaved(current => ({...current, [kind]:error.message || 'Could not save'}))
    }
  }

  const firstAirport = destHubs.airports[0]
  const fromAirport = originHubs.airports[0]
  const fromStation = originHubs.stations.find(station => station.code)
  const toStation = destHubs.stations.find(station => station.code)
  const schedule = trainSchedule(fromStation, toStation)
  const flightFrom = fromAirport?.code || route.origin
  const distance = data?.road?.kilometres ?? data?.airDistanceKm
  const suggestedMode = !Number.isFinite(distance) ? 'fly' : distance > 700 ? 'fly' : distance > 300 ? 'train' : 'drive'
  const mode = chosenMode || suggestedMode
  const tabs = [
    ['fly', 'Fly', Plane, firstAirport ? `${firstAirport.code} · ${Math.round(firstAirport.distanceKm)} km` : 'Airports'],
    ['train', 'Train', TrainFront, toStation ? `${toStation.code} · ${Math.round(toStation.distanceKm)} km` : 'Stations'],
    ['bus', 'Bus', Bus, 'Operators'],
    ['drive', 'Drive', Car, data?.road ? hours(data.road.minutes) : 'Road'],
  ]

  return <section className="trip-transport" aria-labelledby={heading}>
    <header className="tt-route">
      <div>
        <h2 id={heading}>Getting there</h2>
        <p className="tt-route-line">{routeLabel}</p>
        <p className="tt-route-meta">{tripDate} · {route.travelers} {Number(route.travelers) === 1 ? 'traveller' : 'travellers'}
          {!route.departure && !editing && <> · <button type="button" className="tt-inline" onClick={() => setEditing(true)}>Add a date</button></>}</p>
      </div>
      <Button icon="edit" aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Done' : 'Change'}</Button>
    </header>
    {editing && <form className="tt-route-form" onSubmit={event => {
      event.preventDefault()
      const form = new FormData(event.currentTarget)
      const date = form.get('departure')
      const time = form.get('time')
      setRoute({origin:String(form.get('origin')).trim(), name:String(form.get('destination')).trim() || name,
        departure:date, time, departAt:date && time ? new Date(date + 'T' + time).toISOString() : '',
        travelers:Number(form.get('travelers')) || 1})
      setSaved({})
      setAttempt(value => value + 1)
      setEditing(false)
    }}>
      <label>From<input name="origin" defaultValue={route.origin} maxLength={120} placeholder="Your city" required/></label>
      <label>To<input name="destination" defaultValue={route.name} maxLength={120} required/></label>
      <label>Date<input name="departure" type="date" defaultValue={route.departure}/></label>
      <label>Time (device time)<input name="time" type="time" defaultValue={route.time}/></label>
      <label>Travellers<input name="travelers" type="number" min={1} max={20} defaultValue={route.travelers}/></label>
      <Button type="submit" variant="primary" icon="search">Show options</Button>
      <small className="tt-wide">This only changes what you see here. Trip preferences keep your saved details.</small>
    </form>}

    {draftRoute && plan.loading && <p role="status" className="tt-status">Looking up the route, airports and stations…</p>}
    {draftRoute && data?.originStatus === 'not_found' && <p className="tt-status">Couldn’t find “{route.origin}”. Try the city name, for example “Hyderabad”.</p>}
    {draftRoute && plan.error && <p className="tt-status">Route details are unavailable right now. Provider links below still work.</p>}

    {draftRoute && data && origin && <div className="tt-facts" aria-label="Route facts">
      {data.road && <div><Route size={16} aria-hidden="true"/><span><strong>{Math.round(data.road.kilometres)} km by road</strong>
        <small>about {hours(data.road.minutes)} driving, no traffic</small></span></div>}
      {data.airDistanceKm != null && <div><Plane size={16} aria-hidden="true"/><span><strong>{Math.round(data.airDistanceKm)} km</strong><small>straight-line distance</small></span></div>}
      {advice && <p className="tt-advice">{advice} <small>General guidance by distance.</small></p>}
      {!route.departure && <p className="tt-note tt-wide">Add a travel date so flight and train searches open on that day.</p>}
    </div>}

    {onSaveDraft && arrival && <div id="tt-journey"><JourneyPlanner draft={draft} plan={data} startMode={startMode}
      onStarted={() => setStartMode(null)} onSave={onSaveDraft}/></div>}

    {hasLiveQuotes && <section className="tt-live" aria-label="Live options">
      <h3>{route.departure ? 'Live options for ' + tripDate : 'Live options'}</h3>
      <TransportQuotes quotes={quotes.data.quotes}/>
      {quotes.data.quotes.driving?.status === 'ready' && <p>
        Google Maps driving estimate · {Math.round(quotes.data.quotes.driving.metres / 1000)} km · about {hours(Number.parseFloat(quotes.data.quotes.driving.duration) / 60)}
      </p>}
    </section>}
    {quotes.loading && <p role="status">Checking schedules and fares…</p>}
    {quotes.error && <p role="status">Timed options are temporarily unavailable.</p>}
    {route.origin && !quotes.loading && missing.length > 0 && <TransportResearch key={attempt}
      query={new URLSearchParams([...timing, ['research_modes', missing.join(',')]])} label="Research missing options"/>}

    {draftRoute && !nearbyIntercity && <div className="tt-mode-tabs" role="group" aria-label="Ways to get there">
      {tabs.map(([id, label, Glyph, hint]) => <button key={id} type="button" aria-pressed={mode === id} aria-controls={'tt-' + id}
        onClick={() => setChosenMode(id)}><Glyph size={17} aria-hidden="true"/><span><strong>{label}</strong><small>{hint}</small></span></button>)}
    </div>}
    {draftRoute && !nearbyIntercity && <div className="tt-modes">
      <ModeCard id="tt-fly" onUse={onSaveDraft && arrival ? () => {setStartMode('flight'); document.getElementById('tt-journey')?.scrollIntoView({behavior:'smooth', block:'start'})} : null} active={mode === 'fly'} icon={Plane} title="Fly"
        lead={firstAirport ? `Nearest airports to ${stayLabel}` : 'No airport with scheduled-flight codes found within 150 km.'}
        onSave={route.origin ? () => track('flight', `Flight ${flightFrom} → ${firstAirport?.code || name}`, flightsSearch(flightFrom, firstAirport?.code || name, route.departure)) : null}
        saved={saved.flight}
        actions={<>
          {destHubs.airports.slice(0, 2).map(airport => <SourcePill key={airport.code}
            url={flightsSearch(flightFrom || 'your city', airport.code, route.departure)} label={`Flights ${flightFrom ? flightFrom + ' → ' : 'to '}${airport.code}`}/>)}
          {!destHubs.airports.length && <SourcePill url={flightsSearch(route.origin || 'your city', name, route.departure)} label="Search flights"/>}
          {firstAirport && arrivalCoords && <SourcePill url={mapsDirections(coords(firstAirport), arrivalCoords, 'driving')} label={`${firstAirport.code} → ${stayLabel}`}/>}
        </>}>
        {destHubs.airports.length > 0 && <ul className="tt-hubs">{destHubs.airports.slice(0, 2).map(hub => <Hub key={hub.code} hub={hub} to={stayLabel}/>)}</ul>}
        {fromAirport && <p className="tt-note">From {origin?.name}: {fromAirport.name} ({fromAirport.code}), {fromAirport.distanceKm} km from the centre.</p>}
      </ModeCard>

      <ModeCard id="tt-train" onUse={onSaveDraft && arrival ? () => {setStartMode('train'); document.getElementById('tt-journey')?.scrollIntoView({behavior:'smooth', block:'start'})} : null} active={mode === 'train'} icon={TrainFront} title="Train"
        lead={destHubs.stations.length ? `Stations near ${stayLabel}` : 'No mainline station found within 25 km.'}
        onSave={schedule ? () => track('train', `Train ${fromStation.code} → ${toStation.code}`, schedule) : null}
        saved={saved.train}
        actions={<>
          {schedule && <SourcePill url={schedule} label={`Trains ${fromStation.code} → ${toStation.code}`}/>}
          {country === 'India' && <SourcePill url="https://www.irctc.co.in/eticket/train-search" label="Book on IRCTC"/>}
          {country !== 'India' && <SourcePill url="https://www.omio.com/trains" label="Search trains"/>}
        </>}>
        {destHubs.stations.length > 0 && <ul className="tt-hubs">{destHubs.stations.slice(0, 2).map(hub => <Hub key={hub.name} hub={hub} to={stayLabel}/>)}</ul>}
        {originHubs.stations.some(station => station.code) && <p className="tt-note">Stations in {origin?.name}: {originHubs.stations.filter(station => station.code).slice(0, 3)
          .map(station => `${station.name} (${station.code})`).join(', ')}. Check which one your train uses.</p>}
        {schedule && <small>The schedule link lists trains between these two codes. Seats and fares are on IRCTC.</small>}
      </ModeCard>

      <ModeCard id="tt-bus" onUse={onSaveDraft && arrival ? () => {setStartMode('bus'); document.getElementById('tt-journey')?.scrollIntoView({behavior:'smooth', block:'start'})} : null} active={mode === 'bus'} icon={Bus} title="Bus" lead={route.origin ? `Search ${route.origin} to ${name}${draft.region && draft.region !== name ? ' or ' + draft.region : ''}.` : 'Add your departure city to search buses.'}
        onSave={route.origin && country === 'India' ? () => track('bus', `Bus ${route.origin} → ${name}`, 'https://www.redbus.in/') : null}
        saved={saved.bus}
        actions={country === 'India' ? <><SourcePill url="https://www.redbus.in/" label="Search redBus"/><SourcePill url="https://www.abhibus.com/" label="Search AbhiBus"/></>
          : <SourcePill url="https://www.omio.com/buses" label="Search coaches"/>}>
        <small>Bus sites need the cities and date entered on their page. Compare boarding points and seat types there.</small>
      </ModeCard>

      <ModeCard id="tt-drive" onUse={onSaveDraft && arrival ? () => {setStartMode('drive'); document.getElementById('tt-journey')?.scrollIntoView({behavior:'smooth', block:'start'})} : null} active={mode === 'drive'} icon={Car} title="Drive or hire a cab"
        lead={data?.road ? `${Math.round(data.road.kilometres)} km · about ${hours(data.road.minutes)} without traffic` : route.origin ? 'Road distance unavailable right now.' : 'Add your departure city for road distance.'}
        onSave={route.origin && arrivalCoords ? () => track('drive', `Drive ${route.origin} → ${name}`, mapsDirections(route.origin, arrivalCoords, 'driving')) : null}
        saved={saved.drive}
        actions={route.origin && arrivalCoords && <SourcePill url={mapsDirections(route.origin, arrivalCoords, 'driving')} label={`Directions to ${stayLabel}`}/>}>
        {data?.road && <FuelEstimator kilometres={data.road.kilometres} travelers={route.travelers}/>}
      </ModeCard>
    </div>}

    {draftRoute && nearbyIntercity && arrivalCoords && <p className="tt-status">{route.origin} is close to {name}. <SourcePill url={mapsDirections(route.origin, arrivalCoords, 'driving')} label="Directions"/></p>}

    <CompareOperators key={routeLabel} arrival={providers.data?.arrival} loading={providers.loading} error={providers.error}/>

    {(compareProviders.length > 0 || onAsk) && <div className="tt-actions tt-more">
      {compareProviders.map(provider => <SourcePill key={provider.url} url={provider.url} label={provider.action}/>)}
      {onAsk && <Button icon="chat" onClick={() => onAsk(`Compare flights, trains and buses from ${route.origin || 'my city'} to ${route.name}${route.departAt || route.departure ? ' on ' + (route.departAt || route.departure) : ''} for ${route.travelers} travellers.`)}>Ask YatraBuddy to compare</Button>}
    </div>}
    {guidePoint(guide.data, 'Getting there')}
    {data?.sources && <small className="tt-sources">Distances and hubs from {data.sources.map((source, index) => <React.Fragment key={source.url}>{index ? ' and ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.name}</a></React.Fragment>)}. Fares and seats are only shown by providers.</small>}

    <section className="tt-around" aria-label="Getting around">
      <h3><MapPin size={17} aria-hidden="true"/> Getting around, day by day</h3>
      {localModes.length > 0 && <p className="tt-note">Suggestions follow your preferred modes: {localModes.join(', ')}.</p>}
      {!hasLegs && <>
        <p>Add stops to your itinerary to see each day’s journeys.</p>
        <TransportResearch query={new URLSearchParams({destination:name, local:'true',
          ...(country ? {country} : {}), ...(departure ? {departure} : {})})} label="Research local transport"/>
      </>}
      {days.map((day, index) => day.legs.length > 0 && <details key={day.day} className="tt-day" open={index === 0}>
        <summary><strong>Day {day.day}</strong><span>{day.legs.length} {day.legs.length === 1 ? 'journey' : 'journeys'}
          {day.kilometres ? ` · ${day.kilometres} km · about ${hours(day.minutes)}` : ''}</span></summary>
        <ol>{day.legs.map((leg, legIndex) => <LegRow key={`${coords(leg.from)}-${coords(leg.to)}-${legIndex}`}
          leg={leg} preferred={localModes} name={name} country={country} departure={departure} onAsk={onAsk}/>)}</ol>
      </details>)}
      <small>Suggested modes are based on distance: walk up to about 1 km, auto or cab for short hops, cab for longer ones.</small>
      {(localProviders.length > 0 || hyderabad) && <div className="tt-local">
        <h4>Local apps and services</h4>
        <div className="tt-actions">{localProviders.map(provider => <SourcePill key={provider.url} url={provider.url} label={provider.action || provider.name}/>)}</div>
        {hyderabad && <p className="tt-note">{fares.data?.passes?.length ? fares.data.passes.map(pass => `${pass.name} · ${money(pass.amount)} per person for 24 hours`).join(' · ') : 'City bus day passes are available.'}{' '}
          <SourcePill url={passSource} label="TGSRTC passes and fares"/></p>}
      </div>}
      {guidePoint(guide.data, 'Getting around')}
    </section>
  </section>
}
