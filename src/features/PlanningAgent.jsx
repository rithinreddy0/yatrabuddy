import {useMapPanel} from './useMapPanel.mjs'
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {ArrowDown, ArrowUp, Bookmark, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, Ellipsis, ExternalLink, Heart, MapPin, Minus, Pencil, Plus, RotateCcw, Sparkles, Square, Trash2, Volume2, X} from 'lucide-react'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {HighlightPrice, TravelHighlights} from '../components/TravelHighlights.jsx'
import {GoogleMapsLink} from '../components/GoogleMapsLink.jsx'
import {revealMapCard} from '../components/revealMapPlace.mjs'
import {PhotoRail} from '../components/PhotoRail.jsx'
import {AgentProgress, Button, Dialog, Pill, TravelArtwork, WikivoyageSource} from '../components/UI.jsx'
import {usePopoverDismiss} from '../components/usePopoverDismiss.mjs'
import {freshnessLabel, request, travelData} from '../api.mjs'
import {money} from '../planner.mjs'
import TripConnectionCheck from './TripConnectionCheck.jsx'
import {AgentMessage, AgentToolStatus, RevealingAnswer} from './AgentMessage.jsx'
import {AgentOptions} from './AgentOptions.jsx'
import {GroqResearchResult} from './GroqResearch.jsx'
import {useVoiceInput} from './useVoiceInput.mjs'
import {DictationControl} from './DictationControl.jsx'
import {JourneyMap, draftMapData, mapPlaceId} from './JourneyMap.jsx'
import {PlaceDetails, placeMapUrl} from './PlaceDetails.jsx'
import {TripWorkspace} from './TripWorkspace.jsx'
import {draftSchedule, visitTime} from './draftSchedule.mjs'
import {draftBudget} from './tripOverview.mjs'
import {isWikivoyage, visibleSource} from '../components/sourceUrl.mjs'
import {TravelProviderSources} from './TransportSources.jsx'
import {TripSettingsDialog} from './TripSettingsDialog.jsx'
import {discoveryPlaceKey, isSaveableDiscoveryPlace, toggleDiscoverySaved, useSavedDiscoveryPlaces} from './discoveryPlaces.mjs'
import './JourneyChat.css'

const stages = ['Transport', 'Stay', 'Activities', 'Food', 'Local transport', 'Weather', 'Review']
const liveBuildStages = ['Researching verified places', 'Checking date weather', 'Ranking for fit', 'Grouping and timing days']
const questions = {
  destination: 'Where would you like to go?', origin: 'Where are you leaving from?',
  days: 'How many days are you travelling?', people: 'How many people are going?',
  budget: 'What is the total budget in INR?',
}
const fields = [
  ['destination', 'Destination'], ['origin', 'Departure city'], ['days', 'Days'],
  ['people', 'Travellers'], ['budget', 'Total budget in INR'], ['date', 'Departure date'],
  ['pace', 'Pace'], ['diet', 'Diet'],
]
const stagePrompts = [
  'How would you like to get there?', 'Where would you like to stay?',
  'What would you like to do?', 'Any food stops you want to include?',
  'How would you like to get around?', 'Check current weather before reviewing your trip.',
  'Here’s your trip so far. Take a look before you save.',
]
const sessionRoot = 'yatra.agent.session'
const promptTemplates = [
  ['/trip', 'Plan a trip'],
  ['/summary', 'Summarize the itinerary'],
  ['/translate', 'Translate common travel phrases'],
  ['/code', 'Create a trip cost calculator'],
  ['/budget', 'Break down trip costs'],
  ['/pack', 'Build a packing checklist'],
  ['/save', 'Save and open the trip'],
  ['/undo', 'Undo the last itinerary change'],
]
const saveRequest = /^(?:\/save|(?:please\s+)?(?:(?:can|could) you\s+)?(?:build (?:my |the |this )?(?:trip|itinerary) and )?save(?: (?:my |our |the |this )?(?:trip|itinerary|plan)| it)?(?: now)?(?: please)?)[.!? ]*$/i
const sourceTools = ['Place search', 'More places', 'Images', 'Videos', 'Public research', 'Weather', 'Local transport', 'Groq research', 'Destination guide', 'Travel providers']
const choiceBounds = {days: [1, 5], people: [1, 8], budget: [1000, 10000000]}
const STREAM_IDLE_MS = 30000
const STREAM_MAX_MS = 120000

function validChoiceValue(field, value, catalog) {
  if (typeof value !== 'string' && typeof value !== 'number') return false
  if (field === 'destination') return catalog.some(place => place.id === value)
  if (field === 'origin') return typeof value === 'string' && /^[\p{L}][\p{L} .'’\-]{1,59}$/u.test(value)
  const bounds = choiceBounds[field]
  const number = Number(value)
  return Boolean(bounds && Number.isSafeInteger(number) && number >= bounds[0] && number <= bounds[1])
}

function plannerError(error) {
  if (error.status === 404) return 'The planner is unavailable in this preview. Try again after the backend restarts.'
  if (error.status === 429) return 'The planner is getting too many requests. Try again in a moment.'
  if (error.name === 'TimeoutError') return 'The planner took too long to respond. Try again.'
  if (error instanceof TypeError || error.status >= 500) return 'Could not reach the planner. Check your connection and try again.'
  return error.message || 'Something went wrong. Try again.'
}

function sessionUnavailable(error) {
  return error.status === 404 && error.message === 'Planning session unavailable.'
}

function validateSession(session) {
  if (!Number.isInteger(session?.version) || !session.state || !Array.isArray(session.events)) {
    throw Object.assign(new Error('Invalid planner response'), {status: 503})
  }
  return session
}

async function createSession(signal) {
  const session = validateSession(await request('planning-agent/sessions', {method: 'POST', signal}))
  if (typeof session.token !== 'string') throw new Error('The planner did not open a conversation. Try again.')
  return session
}

const contextRevision = (token, trip) => `${token}:${trip.id}:${trip.updated}`

function SourceLink({url, children}) {
  if (isWikivoyage(url)) return <WikivoyageSource url={url} label={typeof children === 'string' ? children : undefined}/>
  const href = visibleSource(url)?.href
  return href ? <a className="agent-source-link" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={13} aria-hidden="true"/></a> : null
}

function resultStatus(result) {
  if (result.status === 'empty') return 'No matches'
  if (result.status === 'unavailable' || result.error) return 'Source unavailable'
  const freshness = result.freshness || result.status
  const retrievedAt = result.retrievedAt || result.updatedAt
  if (freshness === 'cached' && !Number.isFinite(Date.parse(retrievedAt))) return 'Cached'
  return freshnessLabel({freshness, retrievedAt})
}

function JourneyPlacePhoto({place, onPlace}) {
  return <div className="journey-place-photo">
    <PlacePhoto key={place.url || place.name} place={place} lookup hideUnavailable onOpen={onPlace ? () => onPlace(place) : undefined}/>
  </div>
}

function PlaceAnswer({result, images, onUseStay, activeStay, busy, onPlace, onAdd, shortlist}) {
  const {query, category, places = [], error} = result
  const topic = {attractions: 'Places to visit', food: 'Food spots', stays: 'Places to stay', hotels: 'Places to stay'}[category]
  const liked = useSavedDiscoveryPlaces()
  const rail = useRef(null)
  const illustrated = images ? places.filter(place => place.photo?.kind !== 'nearby' && (place.photo?.url || place.photo?.originalUrl)) : []
  const other = illustrated.length ? places.filter(place => !illustrated.includes(place)) : places
  const nudge = direction => rail.current?.scrollBy({left: direction * rail.current.clientWidth * .8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'})
  const renderPlace = (record, index, card) => {
    const item = mapPlace(record)
    const map = placeMapUrl(item)
    const added = shortlist?.some(entry => entry.url === item.url)
    const saveable = isSaveableDiscoveryPlace(item)
    const likedPlace = liked.some(place => discoveryPlaceKey(place) === discoveryPlaceKey(item))
    return <li key={item.id || `${item.url || item.name}-${index}`} data-map-place={mapPlaceId(item)} tabIndex={-1} className={card ? 'journey-place-card' : 'journey-place-row'}>
      {card && <div className="journey-card-media"><PlacePhoto place={item} lookup hideUnavailable onOpen={onPlace ? () => onPlace(item) : undefined}/></div>}
      {!card && <JourneyPlacePhoto place={item} onPlace={onPlace}/>}
      {(saveable || map && onAdd && item.category) && <div className="journey-card-actions">
          {saveable && <button type="button" aria-pressed={likedPlace} aria-label={`${likedPlace ? 'Unsave' : 'Save'} ${item.name}`} onClick={() => toggleDiscoverySaved(item, result.location)}><Heart size={17} fill={likedPlace ? 'currentColor' : 'none'}/></button>}
          {map && onAdd && item.category && <button type="button" aria-pressed={Boolean(added)} aria-label={`${added ? 'Remove' : 'Add'} ${item.name} ${added ? 'from' : 'to'} trip shortlist`} onClick={() => onAdd(item)}>{added ? <Minus size={18}/> : <Plus size={18}/>}</button>}
      </div>}
      <h4>{onPlace ? <button type="button" onClick={() => onPlace(item)}>{item.name}</button> : item.name}</h4>
      <div className="journey-card-meta"><small>{item.category || (images ? 'Photo' : 'Place')}{Number.isFinite(item.distanceMetres) ? ` · ${(item.distanceMetres / 1000).toFixed(1)} km from centre` : ''}</small>{Number.isFinite(item.rating) && <small title={item.source}>★ {item.rating.toFixed(1)}{item.reviewCount > 0 ? ` (${item.reviewCount})` : ''}</small>}</div>
      {(item.description || item.address) && <p>{item.description || item.address}</p>}
      {item.openingHours && <small>{item.openingHours}</small>}
      {item.publishedPrice && <small><strong className="travel-price">{item.publishedPrice}</strong> · published by the source</small>}
      {item.website && <SourceLink url={item.website}>Official website</SourceLink>}
      <div className="agent-place-links">
        <GoogleMapsLink place={item} region={result.location?.name || query}/>
        <SourceLink url={item.url}>{item.source || 'Place source'}<span className="yatra-sr-only"> for {item.name}</span></SourceLink>
        {onUseStay && category === 'stays' && <Button disabled={busy || activeStay === item.url} onClick={() => onUseStay(item)}>{activeStay === item.url ? 'In your plan' : 'Use this stay'}</Button>}
      </div>
    </li>
  }
  return <section className="agent-source-answer">
    <div className="journey-answer-head"><h3>{images ? `Images${query ? ` of ${query}` : ''}` : topic && query ? `${topic} in ${query}` : 'Places from public sources'}</h3>
      {illustrated.length > 1 && <div className="journey-rail-actions"><button type="button" aria-label="Previous place photos" onClick={() => nudge(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label="Next place photos" onClick={() => nudge(1)}><ChevronRight size={18}/></button></div>}
    </div>
    <small className="agent-source-status">{['live', 'cached'].includes(result.status) ? (result.status === 'live' ? 'Public references' : 'Cached references') : resultStatus(result)}</small>
    {['stays', 'hotels'].includes(category) && places.length > 0 && <p>Compare locations, available reviews and published rates. Check the property for a quote for your dates.</p>}
    {illustrated.length > 0 && <ul className="journey-place-strip" ref={rail} aria-label="Place photos" tabIndex={0}>{illustrated.map((record, index) => renderPlace(record, index, true))}</ul>}
    {other.length > 0 && (illustrated.length > 0 ? <details className="journey-more-places"><summary>More places ({other.length})</summary><ul>{other.map((record, index) => renderPlace(record, index, false))}</ul></details>
      : <ul className="journey-place-list">{other.map((record, index) => renderPlace(record, index, false))}</ul>)}
    {!places.length && <p>{error || 'No matching places came back from the public sources. Try another location or search.'}</p>}
  </section>
}

// The ranker records why each stop was chosen. Show the reasons that help a traveller decide,
// not bookkeeping such as "has a photo".
const UNHELPFUL_REASONS = new Set(['Has a sourced photo', 'A nearby verified option from the available sources'])
function stopReasons(place) {
  return (Array.isArray(place?.fitReasons) ? place.fitReasons : [])
    .filter(reason => typeof reason === 'string' && !UNHELPFUL_REASONS.has(reason)).slice(0, 2)
}

// "Mapusa, Goa" keeps the region the traveller asked for visible after they pick a base town.
function placeTitle(location) {
  if (!location?.name) return ''
  const region = location.region && location.region.toLowerCase() !== location.name.toLowerCase() ? location.region : ''
  return region ? `${location.name}, ${region}` : location.name
}

function mapPlace(place) {
  return {...place, lat: place.lat ?? place.latitude, lon: place.lon ?? place.longitude}
}

function placeToolResult(tool) {
  const result = tool.result
  return Array.isArray(result?.places) ? result : Array.isArray(result?.places?.places) ? result.places : null
}

function replyTextFor(event) {
  if (!event) return ''
  const answer = event.answer || ''
  const notice = typeof event.notice === 'string' ? event.notice : event.notice?.message
  const lead = !answer && !notice && event.tools?.some(tool => sourceTools.includes(tool.name) &&
    tool.status === 'done' && tool.result && !tool.result.error) ? 'Here’s what I found.' : ''
  return [answer || lead, notice !== answer ? notice : ''].filter(Boolean).join('\n\n')
}

function PlannerTimeline({draft, catalog, onPlace, onSave, onEdit, saved, onAdd, shortlist}) {
  const illustrated = [...new Map([draft.stay, ...draft.days.flat()].filter(place => place?.photo).map(place => [place.url, place])).values()]
  const destination = catalog.find(place => place.name.toLowerCase() === draft.name.toLowerCase())
  const cover = illustrated.find(place => place.photo?.kind !== 'nearby' && (place.photo.url || place.photo.originalUrl))
  const {entered, unpriced} = draftBudget(draft)
  const stopCount = draft.days.flat().length
  const dateLabel = index => {
    if (!draft.departure) return ''
    const date = new Date(draft.departure + 'T00:00:00Z')
    date.setUTCDate(date.getUTCDate() + index)
    return date.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', timeZone:'UTC'})
  }
  return <section className="journey-timeline" aria-label="Suggested itinerary">
    <header className="journey-itinerary-head">
      <span className="journey-itinerary-icon"><CalendarDays size={21}/></span>
      <div><h3>{draft.name} itinerary</h3><p>{draft.days.length} {draft.days.length === 1 ? 'day' : 'days'} · {stopCount} {stopCount === 1 ? 'stop' : 'stops'} · {draft.departure ? dateLabel(0) : 'Flexible dates'}</p></div>
      <div className="journey-timeline-actions">
        {onSave && <Button variant="primary" onClick={onSave}>{saved ? 'Open saved trip' : 'Save trip'}</Button>}
        {onEdit && <Button onClick={onEdit}>Edit stops</Button>}
      </div>
    </header>
    {(cover || destination?.image) && <div className="journey-itinerary-cover">
      {cover ? <JourneyPlacePhoto place={cover} onPlace={onPlace}/> : <figure>
        <img src={`/images/${destination.image}.jpg`} loading="lazy" decoding="async" alt="" width="640" height="420"/>
        <figcaption>Regional photo: {destination.region}</figcaption>
      </figure>}
    </div>}
    <div className="journey-itinerary-facts">
      <div><small>Group budget</small><strong>{draft.budget == null ? 'Undecided' : money(draft.budget)}</strong><small>{entered ? `${money(entered)} entered` : 'No costs entered'}{unpriced > 0 && ` · ${unpriced} unpriced ${unpriced === 1 ? 'stop' : 'stops'}`}</small></div>
      {draft.stay && <div className="journey-stay-fact" data-map-place={mapPlaceId(draft.stay)} tabIndex={-1}><div><small>Suggested stay</small><button type="button" className="journey-inline journey-stop-title" onClick={() => onPlace(draft.stay)}>
        {draft.stay.name}</button><small>Check rates and availability</small></div><JourneyPlacePhoto place={draft.stay} onPlace={onPlace}/></div>}
    </div>
    <div className="journey-itinerary-days">
      {draft.days.map((stops, index) => <details className="journey-itinerary-day" key={index} open={index === 0 ? true : undefined}>
        <summary><div><strong>Day {index + 1}{dateLabel(index) && ` · ${dateLabel(index)}`}</strong><small>{stops.length ? stops.map(place => place.name).slice(0, 2).join(' · ') : 'Free time'}</small></div><span>{stops.length} {stops.length === 1 ? 'stop' : 'stops'}</span><ChevronDown size={16}/></summary>
        {stops.length > 0 && <ol>{draftSchedule(draft, index).map(({place, leg, start, end}) => <li key={place.url} className="journey-itinerary-stop" data-map-place={mapPlaceId(place)} data-map-day={index+1} tabIndex={-1}>
          <div className="journey-stop-time"><small>{visitTime(start)} – {visitTime(end)}</small></div>
          <div className="journey-stop-info">
            {leg && <small className="journey-stop-leg">{leg.kilometres} km · {leg.minutes} min {leg.method === 'road' ? 'by road' : 'estimated'}</small>}
            <button type="button" className="journey-stop-title" onClick={() => onPlace(place)}>{place.name}</button>
            <div className="journey-stop-meta"><span>{place.category}</span>{Number.isFinite(place.rating) && <span className="trip-room-rating">★ {place.rating.toFixed(1)} / 5{place.reviewCount ? ` · ${place.reviewCount} reviews` : ''}</span>}{place.publishedPrice && <strong className="travel-price">{place.publishedPrice}</strong>}<SourceLink url={place.url}>{place.source || 'Source'}</SourceLink></div>
            <GoogleMapsLink place={place} region={draft.name}/>
            {place.openingHours && <small>Published hours · {place.openingHours}</small>}
            {stopReasons(place).length > 0 && <small className="journey-stop-why">Why this stop: {stopReasons(place).join(' · ')}</small>}
          </div>
          <JourneyPlacePhoto place={place} onPlace={onPlace}/>
        </li>)}</ol>}
      </details>)}
    </div>
    <p className="journey-itinerary-note">Visit times are suggested. Check venue hours and current prices before you go.</p>
    {illustrated.length > 0 && <details className="journey-itinerary-photos"><summary>Trip photos</summary><PlaceAnswer images result={{places:illustrated,status:'live'}} onPlace={onPlace} onAdd={onAdd} shortlist={shortlist}/></details>}
  </section>
}

function GuideAnswer({result}) {
  const sections = result.sections || []
  const preferred = ['Overview', 'Why visit', 'What to plan around', 'Festivals and traditions', 'Nature and outdoors', 'Adventure and activities', 'Getting around']
  const ordered = preferred.flatMap(title => sections.filter(entry => entry.title === title))
  ordered.push(...sections.filter(entry => !preferred.includes(entry.title)))
  const renderNote = entry => <><TravelHighlights text={entry.text} points={entry.points} limit={2} preferPrices/>
    <SourceLink url={entry.sourceUrl}>Wikivoyage</SourceLink></>
  return <section className="agent-source-answer journey-guide">
    <h3>{result.query ? `${result.query} travel guide` : 'Travel guide'}</h3>
    {result.error ? <p>{result.error}</p> : <>
      {result.location && <JourneyPlacePhoto place={{...result.location, category:'Sight'}}/>}
      {result.location && <GoogleMapsLink place={result.location} region={result.location.region || result.location.country}/>}
      {ordered.slice(0, 3).map(entry => <article key={entry.title} className="journey-research-result">
        <h4>{entry.title}</h4>{renderNote(entry)}
      </article>)}
      {ordered.length > 3 && <details><summary>More guide highlights</summary>
        {ordered.slice(3).map(entry => <article key={entry.title} className="journey-research-result">
          <h4>{entry.title}</h4>{renderNote(entry)}
        </article>)}
      </details>}
      {!!ordered.length && <small className="travel-source-note">Confirm published prices and hours before you go.</small>}
    </>}
  </section>
}

function SourceAnswer({tool, onRetry, ...actions}) {
  const {name, result} = tool
  if (name === 'Groq research') return <GroqResearchResult result={result}/>
  if (name === 'Public research') return <section className="agent-source-answer journey-guide">
    <h3>{result.query ? `What the sources say about ${result.query}` : 'Public travel references'}</h3>
    {result.error ? <p>{result.error}</p> : <>
      {result.location && <JourneyPlacePhoto place={{...result.location, category:'Sight'}}/>}
      <small className="agent-source-status">{resultStatus(result)}</small>{result.findings?.map(item => <article className="journey-research-result" key={item.url}>
      <h4>{item.title}</h4><TravelHighlights text={item.excerpt} limit={2} preferPrices/><SourceLink url={item.url}>Read on {item.publisher}</SourceLink>
    </article>)}</>}
    {result.error && onRetry && <Button onClick={onRetry} disabled={actions.busy}>Retry lookup</Button>}
  </section>
  if (name === 'Videos') return <section className="agent-source-answer">
    <h3>Videos{result.query ? ` · ${result.query}` : ''}</h3>
    {result.error ? <p>{result.error}</p> : <><small className="agent-source-status">Wikimedia Commons · {result.status === 'cached' ? 'cached references' : 'public references'}</small><PhotoRail title="Video references" count={result.items?.length} className="place-detail-rail">
      {result.items?.map(item => <article className="journey-media-item" key={item.sourceUrl}>
        <video controls preload="none" playsInline poster={item.thumbnail || undefined} aria-label={item.title}><source src={item.url} type={item.mime}/></video>
        <strong>{item.title}</strong><p>{item.credit || item.author}{item.nearby ? ' · Nearby footage' : ''}</p>
        <SourceLink url={item.sourceUrl}>Source and license</SourceLink>
      </article>)}
    </PhotoRail></>}
  </section>
  if (name === 'Destination guide') return <GuideAnswer result={result}/>
  if (name === 'Travel providers') return <>
    <TravelProviderSources result={result} answerFirst/>
    {result.places?.places?.length > 0 && <PlaceAnswer result={result.places} {...actions}/>}
  </>
  if (name === 'Place search' || name === 'More places' || name === 'Images') return <>
    <PlaceAnswer result={result} images={name === 'Images'} {...actions}/>
    {result.error && onRetry && <Button className="agent-source-retry" onClick={onRetry} disabled={actions.busy}>Retry lookup</Button>}
  </>
  return <section className="agent-source-answer">
    <h3>{name === 'Weather' ? `Current conditions${result.location ? ' in ' + result.location : ''}` : 'Driving estimate'}</h3>
    <small className="agent-source-status">{resultStatus(result)}</small>
    {result.error ? <p>{result.error}</p> : name === 'Weather' ? <>
      <p>{result.temperature}°C · {result.conditions}</p>
      {result.time && <small>As of <time dateTime={result.time}>{result.time.replace('T', ' ')}{result.timezone ? ` (${result.timezone})` : ''}</time></small>}
      <SourceLink url={result.url}>Open-Meteo</SourceLink>
    </> : <>
      <p>{result.stops?.join(' to ')} · {result.kilometres} km · {result.legMinutes?.[0]} min</p>
      <SourceLink url={result.url}>OSRM</SourceLink>
    </>}
    {result.error && onRetry && <Button className="agent-source-retry" onClick={onRetry} disabled={actions.busy}>Retry lookup</Button>}
  </section>
}

function DraftPreview({draft, busy, onReview, onSave}) {
  if (!draft?.provisional || !Array.isArray(draft.days) || !draft.days.length) return null
  return <section className="agent-draft agent-review" aria-label="Provisional itinerary">
    <div><h3>Draft itinerary</h3><small>SIMULATED · based on your current trip details</small></div>
    <ol>{draft.days.map((day, index) => <li key={index}><strong>Day {index + 1}</strong><span>{day.stops.join(' · ') || 'Free time'}</span></li>)}</ol>
    {Number.isFinite(draft.total) && <p><HighlightPrice text={money(draft.total)}/> estimated for the group{draft.unpriced?.length ? `, excluding ${draft.unpriced.join(' and ').toLowerCase()}` : ''}.</p>}
    {Array.isArray(draft.unverifiedPreferences) && draft.unverifiedPreferences.length > 0 && <p>Check separately: {draft.unverifiedPreferences.join(', ')}.</p>}
    {onSave && <div className="agent-pills">
      <Button variant="primary" disabled={busy} onClick={onSave}>Save this draft</Button>
      <Button disabled={busy} onClick={onReview}>Review and customize</Button>
    </div>}
  </section>
}

export function PlanningAgent({catalog, initialQuery, onSave, onOpenTrip, ready, contextTrip, contextId, contextDraft, newConversation, trips, drafts, onSaveDraft, onOpenDraft, onProfile, profile, onBuild}) {
  const sessionKey = contextId ? `${sessionRoot}.${contextId}` : contextDraft ? `${sessionRoot}.draft.${contextDraft.id}` : newConversation ? `${sessionRoot}.new${typeof newConversation === 'string' ? '.' + newConversation : ''}` : sessionRoot
  const revisionKey = `${sessionKey}.revision`
  const canLoadContext = !contextId || ready
  const [token, setToken] = useState(() => localStorage.getItem(sessionKey) || '')
  const [model, setModel] = useState(null)
  const [contextReady, setContextReady] = useState(false)
  const [query, setQuery] = useState(initialQuery || '')
  const [tools, setTools] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resumeAttempt, setResumeAttempt] = useState(0)
  const [offline, setOffline] = useState(() => !navigator.onLine)
  const [exchange, setExchange] = useState(null)
  const [exchangePending, setExchangePending] = useState(false)
  const [editing, setEditing] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [resumePlanning, setResumePlanning] = useState(false)
  const [messageEdit, setMessageEdit] = useState(null)
  const [jumpVisible, setJumpVisible] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [copied, setCopied] = useState(null)
  const [promptMenu, setPromptMenu] = useState(false)
  const [connected, setConnected] = useState(() => navigator.onLine)
  const [pendingMessage, setPendingMessage] = useState('')
  const [pendingAnswer, setPendingAnswer] = useState(null)
  const [revealVersion, setRevealVersion] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [pinnedPlace, setPinnedPlace] = useState(null)
  const [tripToolsOpen, setTripToolsOpen] = useState(false)
  const [mapOpen, setMapOpen] = useMapPanel()
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [shortlist, setShortlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem(sessionKey + '.shortlist')) || [] } catch { return [] }
  })
  const [savedMedia, setSavedMedia] = useState(() => {
    try { return JSON.parse(localStorage.getItem(sessionKey + '.media')) || [] } catch { return [] }
  })
  const [roomOpen, setRoomOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [roomDraftId, setRoomDraftId] = useState(null)
  const transcript = useRef(null)
  const pendingReply = useRef(null)
  const replyScroll = useRef(null)
  const openedTranscript = useRef(false)
  const sidebarToggle = useRef(null)
  const mapToggle = useRef(null)
  const chatMenu = useRef(null)
  const settingsTrigger = useRef(null)
  const tripTools = useRef(null)
  const tripToolsTrigger = useRef(null)
  const promptList = useRef(null)
  const promptTrigger = useRef(null)
  const replyHeading = useRef(null)
  const focusNextReply = useRef(false)
  const composer = useRef(null)
  const active = useRef(null)
  const lock = useRef(false)
  const stoppedByUser = useRef(false)
  const [retryAction, setRetryAction] = useState(null)
  const initialSent = useRef(false)
  const voice = useVoiceInput({continuous:false, onTranscript: text => setQuery(current => [current.trim(), text].filter(Boolean).join(' ').slice(0,600))})
  const ownsFocus = target => target === document.body || target.closest?.('.agent-workspace')
  usePopoverDismiss({open:settingsOpen,panel:chatMenu,trigger:settingsTrigger,onDismiss:()=>setSettingsOpen(false)})
  usePopoverDismiss({open:tripToolsOpen,panel:tripTools,trigger:tripToolsTrigger,onDismiss:()=>setTripToolsOpen(false)})
  usePopoverDismiss({open:promptMenu,panel:promptList,trigger:promptTrigger,onDismiss:()=>setPromptMenu(false)})

  function jumpToLatest(smooth = false) {
    replyScroll.current = null
    setJumpVisible(false)
    const node = transcript.current
    if (node) node.scrollTo({top:node.scrollHeight, behavior:smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant'})
  }

  function updateScroll() {
    const node = transcript.current
    const nearLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 96
    setJumpVisible(!nearLatest)
  }

  useEffect(() => {
    const update = () => setConnected(navigator.onLine)
    window.addEventListener('offline', update)
    window.addEventListener('online', update)
    return () => {window.removeEventListener('offline', update);window.removeEventListener('online', update)}
  }, [])

  useEffect(() => {
    function onShortcut(event) {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('dialog[open]')) {
        if (sidebarOpen && (event.target === sidebarToggle.current || event.target.closest?.('.agent-sidebar'))) {
          setSidebarOpen(false)
          sidebarToggle.current?.focus()
        }
      }
      if ((event.key !== '/' && event.code !== 'Slash') || !ownsFocus(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target.matches?.('textarea,input,select,[contenteditable="true"]')) return
      event.preventDefault()
      composer.current?.focus()
      setQuery(value=>value.trim() ? value : '/')
      setPromptMenu(true)
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [sidebarOpen])

  useEffect(() => () => active.current?.abort(), [])
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  useEffect(() => {
    if (!canLoadContext || (contextId && !contextTrip)) return
    let savedToken = localStorage.getItem(sessionKey)
    if (!savedToken && !contextTrip) return
    const controller = new AbortController()
    if (contextTrip) setContextReady(false)
    async function openConversation() {
      try {
        let result
        if (savedToken) {
          try { result = validateSession(await request('planning-agent/sessions/' + savedToken, {signal: controller.signal})) }
          catch (failure) { if (!contextTrip || !sessionUnavailable(failure)) throw failure }
        }
        if (!result) {
          result = await createSession(controller.signal)
          savedToken = result.token
          localStorage.setItem(sessionKey, savedToken)
          setToken(savedToken)
        }
        if (contextTrip) {
          const revision = contextRevision(savedToken, contextTrip)
          if (localStorage.getItem(revisionKey) !== revision) {
            result = validateSession(await request(`planning-agent/sessions/${savedToken}/context`, {
              method: 'POST', body: {version: result.version, trip: contextTrip}, signal: controller.signal,
            }))
            localStorage.setItem(revisionKey, revision)
          }
        }
        if (!controller.signal.aborted) {
          setModel(result)
          setContextReady(true)
        }
      } catch (failure) {
        if (controller.signal.aborted) return
        if (sessionUnavailable(failure)) {
          localStorage.removeItem(sessionKey)
          setToken('')
          setError('This conversation has expired. Send a message to start a new one.')
        } else setError(plannerError(failure))
      }
    }
    void openConversation()
    return () => controller.abort()
  }, [canLoadContext, contextId, contextTrip, resumeAttempt, revisionKey, sessionKey])

  async function send(action) {
    if (lock.current || (token && !model) || (contextId && !contextReady)) return false
    lock.current = true
    replyScroll.current = {version:model?.version, start:null}
    stoppedByUser.current = false
    const controller = new AbortController()
    active.current = controller
    // The turn is cancelled only when the stream goes quiet, not because a long, healthy answer
    // (research plus a full itinerary) takes more than a fixed number of seconds overall.
    const idle = new AbortController()
    let idleTimer = 0
    const keepAlive = () => {
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(() => idle.abort(new DOMException('The planner stopped responding.', 'TimeoutError')), STREAM_IDLE_MS)
    }
    keepAlive()
    const streamSignal = AbortSignal.any([controller.signal, idle.signal, AbortSignal.timeout(STREAM_MAX_MS)])
    setRetryAction(null)
    setBusy(true)
    setRevealVersion(null)
    setPromptMenu(false)
    setTripToolsOpen(false)
    setError('')
    setResumePlanning(false)
    setFeedback('')
    setTools([])
    setPendingAnswer(null)
    setPendingMessage(action.text || action.label || '')
    let session = token
    let version = model?.version || 0
    try {
      if (!session) {
        const created = await createSession(controller.signal)
        session = created.token
        version = created.version
        setToken(session)
        setModel(created)
        localStorage.setItem(sessionKey, session)
      }
      const response = await fetch('/api/planning-agent/sessions/' + session + '/turn', {
        method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({version, offline, live_only: !contextId, live_context: contextDraft,
          preferences: profile ? {interests:profile.interests, style:profile.style, diet:profile.diet,
            pace:profile.pace, transport:profile.transport, mobility:profile.mobility, homeCity:profile.homeCity,
            travelGroup:profile.travelGroup, stayPreferences:profile.stayPreferences, notes:profile.notes,
            tripDays:profile.tripDays, budget:profile.budget, travelers:profile.travelers} : undefined, ...action}),
        signal: streamSignal,
      })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => null)
        if (response.status === 409) setModel(validateSession(await request('planning-agent/sessions/' + session, {signal: controller.signal})))
        throw Object.assign(new Error(typeof data?.detail === 'string' ? data.detail : 'Could not send this message. Try again.'), {status: response.status})
      }
      if (!response.headers.get('content-type')?.includes('application/x-ndjson')) {
        throw Object.assign(new Error('Invalid planner response'), {status: 503})
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      let finished = false
      let streamed = false
      let saveRequested
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        keepAlive()
        buffer += value
        let end
        while ((end = buffer.indexOf('\n')) !== -1) {
          const event = JSON.parse(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          if (event.type === 'tool' && typeof event.name === 'string') setTools(current => [...current.filter(tool => (tool.id || tool.name) !== (event.id || event.name)), event])
          if (event.type === 'delta' && typeof event.text === 'string') {
            streamed = true
            setPendingAnswer(previous => ({
              text: (previous?.text || '') + event.text, kind: event.answerKind || previous?.kind,
            }))
          }
          if (event.type === 'error') throw new Error(event.message)
          if (event.type === 'done') {
            setModel(validateSession(event))
            const reply = event.events.at(-1)
            if (!streamed && replyTextFor(reply) && !reply.tools?.some(tool => tool.result) && !reply.liveDraft &&
                !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
              setRevealVersion(event.version)
            }
            finished = true
            setPendingMessage('')
            setPendingAnswer(null)
            setTools([])
            if (event.events.at(-1)?.saveRequested) saveRequested = event.currentItinerary?.draft
            if (!contextId && (event.events.at(-1)?.liveDraft || event.events.at(-1)?.tools?.some(tool => placeToolResult(tool)?.places?.length))) {
              setSelectedPlace(null)
              setRoomOpen(false)
            }
            if ((event.syncPlan || ['save', 'save_draft'].includes(action.kind)) && event.state.plan) {
              if (contextId) localStorage.setItem(revisionKey, contextRevision(session, event.state.plan))
              onSave(event.state.plan)
            }
          }
        }
      }
      if (!finished) throw new Error('The turn ended before it was saved. Try again.')
      if (saveRequested) await persistTripAndExit(saveRequested, session)
      return true
    } catch (failure) {
      const retryable = action.kind === 'message' && typeof action.text === 'string' && action.text.trim()
      if (controller.signal.aborted) {
        if (stoppedByUser.current && session) {
          // The server may have finished the turn before the stop reached it. Reload the conversation
          // so the thread shows what was actually saved and a retry is not rejected as stale.
          let saved = false
          try {
            const latest = validateSession(await request('planning-agent/sessions/' + session, {signal: AbortSignal.timeout(8000)}))
            setModel(latest)
            saved = latest.version > version
          } catch { /* keep the current thread; the next send reports any conflict */ }
          if (!saved) {
            setError('Response stopped before it finished. Nothing from it was saved.')
            if (retryable) setRetryAction(action)
          }
        }
      } else {
        if (retryable && !sessionUnavailable(failure)) setRetryAction(action)
        if (sessionUnavailable(failure)) {
          localStorage.removeItem(sessionKey)
          localStorage.removeItem(revisionKey)
          setToken('')
          setModel(null)
          if (contextId) {
            setContextReady(false)
            setResumeAttempt(value => value + 1)
            setError('This conversation expired. The saved trip will reopen so you can resend your message.')
          } else setError('This conversation has expired. Send your message again to start a new one.')
        } else setError(plannerError(failure))
      }
      return false
    } finally {
      window.clearTimeout(idleTimer)
      lock.current = false
      setBusy(false)
      setPendingMessage('')
      setPendingAnswer(null)
      setTools([])
      active.current = null
    }
  }

  async function remove() {
    if (!token || lock.current || busy) return
    lock.current = true
    setDeleteError('')
    setBusy(true)
    try {
      await request('planning-agent/sessions/' + token, {method: 'DELETE'})
      localStorage.removeItem(sessionKey)
      localStorage.removeItem(revisionKey)
      localStorage.removeItem(sessionKey + '.shortlist')
      localStorage.removeItem(sessionKey + '.media')
      setShortlist([])
      setSavedMedia([])
      setRoomOpen(false)
      setShortlist([])
      setSelectedPlace(null)
      setPinnedPlace(null)
      setDeleteOpen(false)
      openedTranscript.current = false
      setToken('')
      setModel(null)
      setTools([])
      setError('')
      setMessageEdit(null)
      setSidebarOpen(false)
      if (contextId) {
        setContextReady(false)
        setResumeAttempt(value => value + 1)
      }
    } catch (failure) {setDeleteError(plannerError(failure))}
    finally {lock.current = false; setBusy(false)}
  }

  const brief = model?.state.brief || {}
  const missing = model?.missing?.[0]
  const step = model?.state.step || 0
  const stage = stages[step]
  const recent = model?.events.at(-1)
  const itineraryRequest = model?.currentItinerary?.request
  const activeIntake = model?.currentItinerary
  const chatDraft = model?.currentItinerary ? model.currentItinerary.draft : contextDraft
  const libraryDraft = drafts?.find(item => item.id === chatDraft?.id)
  const liveDraft = libraryDraft && libraryDraft.updated >= chatDraft.updated ? libraryDraft : chatDraft
  const mapData = useMemo(() => {
    const itinerary = liveDraft ? draftMapData(liveDraft) : {places: [], routes: []}
    let lookup = tools.map(placeToolResult).findLast(result => result?.places?.some(place => placeMapUrl(mapPlace(place))))
    if (!lookup) {
      for (const event of [...(model?.events || [])].reverse()) {
        if (event.liveDraft?.id === liveDraft?.id && event.liveDraft) break
        lookup = event.tools?.map(placeToolResult).findLast(result => result?.places?.some(place => placeMapUrl(mapPlace(place))))
        if (lookup) break
      }
    }
    const topic = {food:'Food', hotels:'Stays', stays:'Stays', attractions:'Places to visit'}[lookup?.category]
    const center = lookup ? {...lookup.location, name: [topic, lookup.location?.name || lookup.query].filter(Boolean).join(' · ')}
      : itineraryRequest?.location || itinerary.center
    const places = new Map([...(lookup ? lookup.places.map(mapPlace) : [...itinerary.places, ...shortlist]),
      ...(selectedPlace ? [selectedPlace] : [])].filter(place => placeMapUrl(place)).map(place => [place.url || place.name, place]))
    return {center, places: [...places.values()], routes: lookup ? [] : itinerary.routes}
  }, [itineraryRequest, liveDraft, model, selectedPlace, shortlist, tools])
  const [preferenceField, setPreferenceField] = useState(null)
  const latestIntake = itineraryRequest || (contextDraft ? {destination:contextDraft.name, origin:contextDraft.origin, localStart:!contextDraft.origin,
    days:contextDraft.days.length, people:contextDraft.travelers, date:contextDraft.departure, flexibleDates:!contextDraft.departure,
    budget:contextDraft.budget, budgetOpen:contextDraft.budget==null, diet:contextDraft.mealPreference, pace:contextDraft.pace,
    party:contextDraft.party, mobility:contextDraft.mobility, interests:contextDraft.interests,
    notes:contextDraft.notes, transport:contextDraft.transportPreference, stayPreferences:contextDraft.stayPreferences} : {})
  const hasMap = Boolean(!contextId && (mapData.places.length || mapData.center || selectedPlace))
  const plannerLabel = liveDraft && !activeIntake?.needsBuild ? 'Edit itinerary' : activeIntake ? 'Continue planning' : 'Plan a trip'
  const validDraft = drafts?.some(item => item.id === liveDraft?.id)
  const roomDraft = drafts?.find(item => item.id === roomDraftId) || (liveDraft?.id === roomDraftId ? liveDraft : null)
  const editableMessage = recent?.kind === 'message' && !recent.settingsChange && recent.text?.trim() ? recent.text : ''
  const revealing = revealVersion !== null && revealVersion === model?.version
  const recentResults = (recent?.tools || []).map(placeToolResult).findLast(result => result?.places?.length)
  const followUpCity = recentResults?.location?.name || recentResults?.query || liveDraft?.name || itineraryRequest?.destination ||
    recent?.tools?.find(tool => tool.name === 'Destination guide' && !tool.result?.error)?.result?.query
  const options = recent?.options || []
  const preview = model?.state.preview
  const ledger = preview?.ledger || model?.ledger || {}
  const total = Object.values(ledger).reduce((sum, amount) => sum + amount, 0)
  const saved = model?.state.plan
  const choices = model?.state.choices || {}
  const unpriced = preview?.unpriced || Object.keys(choices).filter(key => choices[key].unpriced)
  const stayCity = ({goa:'Palolem', kerala:'Varkala', kutch:'Bhuj'})[brief.destination] || catalog.find(item => item.id === brief.destination)?.name
  const inMyTrips = saved && trips.some(trip => trip.id === saved.id)
  const missingContext = contextId && ready && !contextTrip
  const resuming = Boolean((token && !model) || (contextId && !contextReady && !missingContext))
  const hasTrip = Object.keys(brief).length > 0
  const activeQuestion = missing && recent?.question?.field === missing && typeof recent.question.prompt === 'string' && recent.question.prompt.length <= 120 && recent.question.prompt.trim()
    ? recent.question.prompt : ''
  const interrupted = Boolean(recent?.interruption) && !resumePlanning
  const showQuestion = contextId && !busy && !interrupted && missing && (activeQuestion || ((resumePlanning || (recent && !recent.answer && !recent.notice)) && questions[missing]))
  const showPlanning = contextId && model && !missing && !interrupted
  const hasTripPanel = hasTrip || Boolean(contextTrip)
  const place = catalog.find(item => item.id === brief.destination)
  function openPlace(item) {
    setRoomOpen(false)
    setSelectedPlace(mapPlace(item))
  }

  function revealMapPlace(item) {
    if (!item) return
    const id = mapPlaceId(item)
    setPinnedPlace(id)
    replyScroll.current = null
    if (!revealMapCard(transcript.current, id, item.day)) openPlace(item)
  }

  function saveMedia(item) {
    if (savedMedia.some(entry => entry.sourceUrl === item.sourceUrl)) return
    const next = [...savedMedia, {...item, place:selectedPlace?.name, locationId:latestIntake.location?.id}].slice(-40)
    setSavedMedia(next)
    try { localStorage.setItem(sessionKey + '.media', JSON.stringify(next)) } catch { /* Still available in this session. */ }
    setFeedback('Media saved for this trip.')
  }

  const roomIdeas = useMemo(() => shortlist, [shortlist])
  const roomMedia = useMemo(() => savedMedia, [savedMedia])
  function openRoom(draft) {
    const stored = drafts?.find(item => item.id === draft.id)
    if (!stored || draft.updated > stored.updated) onSaveDraft?.(draft, {stayInChat:true})
    setRoomDraftId(draft.id)
    setSelectedPlace(null)
    setRoomOpen(true)
  }

  async function persistTripAndExit(draft, session) {
    await onSaveDraft(draft, {stayInChat:true, requirePersistence:true})
    if (session) {
      try { await request('planning-agent/sessions/' + session, {method:'DELETE', signal:AbortSignal.timeout(5000)}) }
      catch { /* The trip is already saved. Open it even if the old session could not be removed. */ }
    }
    try {
      for (const key of [sessionKey, revisionKey, sessionKey + '.shortlist', sessionKey + '.media']) localStorage.removeItem(key)
    } catch { /* Storage settings must not block access to a saved trip. */ }
    onOpenDraft(draft.id)
  }

  async function saveTripAndExit(draft) {
    if (!draft || !ready || lock.current || busy || activeIntake?.needsBuild) return false
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await persistTripAndExit(draft, token)
      return true
    } catch (failure) {
      setError(plannerError(failure))
      return false
    } finally {
      lock.current = false
      setBusy(false)
    }
  }

  function toggleShortlist(item) {
    const updated = shortlist.some(entry => entry.url === item.url)
      ? shortlist.filter(entry => entry.url !== item.url)
      : [...shortlist, item].slice(-25)
    setShortlist(updated)
    try { localStorage.setItem(sessionKey + '.shortlist', JSON.stringify(updated)) } catch { /* Keep the current shortlist in memory. */ }
    setFeedback(updated.some(entry => entry.url === item.url) ? `${item.name} added to your shortlist.` : `${item.name} removed from your shortlist.`)
  }

  function openBuilder(draft) {
    const city = latestIntake.location || mapData.center
    const matching = shortlist.filter(item => !city || !item.locationId || city.id === item.locationId)
    onBuild('', city ? 'geo:' + city.id : latestIntake.destination ? undefined : brief.destination,
      city ? {...city, id:'geo:' + city.id} : undefined, false,
      {...latestIntake, selected: matching, initialDraft: draft})
  }

  function askFollowUp(text) {
    if (!connected || busy || resuming || missingContext) return
    void send({kind:'message', text}).then(ok => {
      if (!ok) setQuery(current => current || text)
    })
  }
  function continueTrip() {
    if (!activeIntake) askFollowUp('Plan a trip')
    else if (activeIntake.question || activeIntake.awaitingDestination) composer.current?.focus()
    else askFollowUp('Build my trip')
  }
  const fieldLabel = (field, value) => field === 'destination'
    ? catalog.find(item => item.id === value)?.name || value
    : field === 'budget' ? money(Number(value)) : String(value)
  function editIntakeField(field) {
    setPreferenceField(field)
  }
  const edit = (field, value) => {
    setEditing('')
    return send({kind: 'edit', field, value: String(value), label: fieldLabel(field, value)})
  }
  const defaultChoices = {
    destination: catalog.slice(0, 5).map(item => [item.id, item.name]),
    origin: ['Delhi', 'Mumbai', 'Bengaluru', 'Hyderabad'].map(city => [city, city]),
    days: [2, 3, 4, 5].map(value => [value, value + ' days']),
    people: [1, 2, 4, 5].map(value => [value, value === 1 ? 'Solo' : value + ' travellers']),
    budget: [15000, 30000, 50000, 75000].map(value => [value, money(value)]),
  }[missing] || []
  const questionOptions = recent?.question?.options
  const hasDynamicChoices = activeQuestion && Array.isArray(questionOptions) && questionOptions.length >= 3 && questionOptions.length <= 6 && questionOptions.every(item =>
    typeof item?.label === 'string' && item.label.trim() && item.label.length <= 90 && validChoiceValue(missing, item.value, catalog) &&
    typeof item.reason === 'string' && item.reason.length <= 140) &&
    new Set(questionOptions.map(item => String(item.value))).size === questionOptions.length
  const quick = hasDynamicChoices ? questionOptions : defaultChoices.map(([value, label]) => ({value, label}))
  const liveBuildTools = tools.filter(tool => liveBuildStages.includes(tool.name))
  const runningBuildTool = liveBuildTools.find(tool => tool.status === 'running')
  const latestBuildTool = liveBuildTools.at(-1)
  const latestBuildIndex = latestBuildTool ? liveBuildStages.indexOf(latestBuildTool.name) : -1
  const buildProgressStep = runningBuildTool ? liveBuildStages.indexOf(runningBuildTool.name)
    : latestBuildIndex >= 0 && ['done','fallback'].includes(latestBuildTool.status) ? latestBuildIndex + 1 : null
  useLayoutEffect(() => {
    const thread = transcript.current
    if (!thread) return
    const anchor = node => {
      if (node) thread.scrollTo({top:thread.scrollTop + node.getBoundingClientRect().top -
        thread.getBoundingClientRect().top - 9, behavior:'instant'})
    }
    const turn = replyScroll.current
    if (busy && turn && turn.start === null && pendingReply.current) {
      anchor(pendingReply.current)
      turn.start = thread.scrollTop
    } else if (!busy && turn) {
      const answered = model?.version > (turn.version ?? 0)
      const stillReadingReply = turn.start === null || Math.abs(turn.start - thread.scrollTop) < 2
      if (answered && stillReadingReply) anchor(replyHeading.current)
      if (answered && stillReadingReply && focusNextReply.current) replyHeading.current?.focus({preventScroll:true})
      replyScroll.current = null
      focusNextReply.current = false
      openedTranscript.current ||= Boolean(model?.version)
    } else if (!busy && model && !openedTranscript.current) {
      openedTranscript.current = true
      anchor(replyHeading.current)
    }
    setJumpVisible(thread.scrollHeight - thread.scrollTop - thread.clientHeight >= 96)
  }, [model, busy, pendingAnswer, error, tools, revealVersion])

  useLayoutEffect(() => {
    if (resumePlanning) replyHeading.current?.focus()
  }, [resumePlanning])

  async function checkExchange() {
    setExchangePending(true)
    try {setExchange(await travelData('yatra/exchange?currency=SGD'))}
    catch {setExchange({error: 'Exchange rate unavailable.'})}
    finally {setExchangePending(false)}
  }
  const sendMessage = async event => {
    event.preventDefault()
    const text = query.trim()
    if (!text || lock.current || busy || resuming || missingContext || !connected) return
    if (voice.phase !== 'idle') voice.stop()
    setPromptMenu(false)
    if (!messageEdit && saveRequest.test(text)) {
      if (liveDraft && !activeIntake?.needsBuild) {
        if (await saveTripAndExit(liveDraft)) setQuery('')
        return
      }
      if (contextTrip) {
        onOpenTrip(contextTrip.id)
        return
      }
      if (!activeIntake?.needsBuild || !/^(?:please\s+)?build\b/i.test(text)) {
        setError(activeIntake?.needsBuild ? 'Finish updating the itinerary before saving it.' : 'Build an itinerary first, then ask me to save it.')
        return
      }
    }
    if (messageEdit && messageEdit.version !== model?.version) {
      setMessageEdit(null)
      setError('The conversation changed. Review your message before sending it again.')
      return
    }
    const ordinal = /^(?:(?:select|choose|pick|take) (?:the )?|the )(first|second|third|fourth|fifth)(?: (?:one|option))?[.!]?$/i.exec(query.trim())
    const option = showPlanning && ordinal && options[['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal[1].toLowerCase())]
    setQuery('')
    const action = messageEdit ? {kind: 'message', text, replace: true}
      : option ? {kind: 'select', value: option.id, label: option.name}
        : /^(go back|undo|\/undo)$/i.test(text) ? {kind: 'undo'} : {kind: 'message', text}
    if (await send(action)) setMessageEdit(null)
    else {
      setQuery(current => current || query)
      composer.current?.focus()
    }
  }

  useEffect(() => {
    const text = initialQuery?.trim()
    if (!text || initialSent.current || resuming || missingContext || lock.current || (contextId && !contextReady)) return
    initialSent.current = true
    setQuery('')
    void send({kind: 'message', text}).then(ok => {
      if (!ok) setQuery(current => current || text)
    })
  }, [initialQuery, resuming, missingContext, contextId, contextReady])

  function editLastMessage() {
    setMessageEdit({version: model.version, draft: query})
    setQuery(editableMessage)
    composer.current?.focus()
  }

  async function copyMessage(node, id) {
    const text = node?.innerText?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(id)
      setFeedback('Copied to clipboard.')
    } catch {
      setFeedback('Could not copy. Select the text and copy it manually.')
    }
  }

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => {setFeedback('');setCopied(null)}, 3000)
    return () => window.clearTimeout(timeout)
  }, [feedback])

  function fieldControl(field) {
    const options = {
      destination: catalog.map(place => [place.id, place.name]),
      pace: ['Relaxed', 'Balanced', 'Packed'].map(value => [value, value]),
      diet: ['No restrictions', 'Vegetarian', 'Vegan', 'Jain', 'Halal'].map(value => [value, value]),
    }[field]
    if (options) return <select name={field} defaultValue={brief[field] || ''}>
      <option value="" disabled>Choose {field}</option>{options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    return <input name={field} defaultValue={brief[field] || ''} type={field === 'date' ? 'date' : ['days', 'people', 'budget'].includes(field) ? 'number' : 'text'}
      min={field === 'budget' ? 1000 : 1} max={field === 'days' ? 5 : field === 'people' ? 8 : undefined} required={field !== 'date'}/>
  }

  const matchingPrompts = promptTemplates.filter(([command]) => !query.startsWith('/') || command.startsWith(query.toLowerCase().trim()))
  const showPrompts = promptMenu && matchingPrompts.length > 0
  function fillPrompt(text) {
    setQuery(text)
    setPromptMenu(false)
    composer.current?.focus()
  }

  function exportConversation(format) {
    const events = model?.events || []
    const content = format === 'json' ? JSON.stringify(events.map(({text, label, answer}) => ({text:text || label, answer})), null, 2)
      : ['# YatraBuddy conversation', ...events.flatMap(({text, label, answer}) => [
        ...(text || label ? ['## You', text || label] : []), ...(answer ? ['## YatraBuddy', answer] : []),
      ])].join('\n\n')
    const url = URL.createObjectURL(new Blob([content], {type:format === 'json' ? 'application/json' : 'text/markdown'}))
    const link = document.createElement('a')
    link.href = url
    link.download = 'yatrabuddy-conversation.' + format
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const composerForm = <form className="agent-composer" onSubmit={sendMessage}>
    {showPrompts && <div ref={promptList} className="agent-prompt-list" id="agent-prompt-list" aria-label="Prompt templates">
      {matchingPrompts.map(([command, label]) => <Button key={command} onClick={() => fillPrompt(command)}>{label} <small>{command}</small></Button>)}
    </div>}
    {messageEdit && <div className="agent-compose-edit"><span>Editing your last message</span><button type="button" className="agent-action" aria-label="Cancel editing" onClick={() => {
      setQuery(messageEdit.draft); setMessageEdit(null); composer.current?.focus()
    }}><X size={17}/></button></div>}
    <label className="agent-composer-input"><span className="yatra-sr-only">Message YatraBuddy</span><textarea ref={composer} value={query} onChange={event => {
      setQuery(event.target.value)
      setPromptMenu(event.target.value.startsWith('/'))
    }} onKeyDown={event => {
      if (event.key === 'Escape' && showPrompts) {
        event.stopPropagation()
        setPromptMenu(false)
        if (query.startsWith('/')) setQuery('')
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        const partial = showPrompts && matchingPrompts.length === 1 && matchingPrompts[0][0] !== query.trim().toLowerCase()
        if (partial) fillPrompt(matchingPrompts[0][0])
        else event.currentTarget.form.requestSubmit()
      }
    }} maxLength={600} rows={1} placeholder={liveDraft ? 'Ask or change this trip…' : activeIntake?.question?.field === 'destination' ? 'Enter a city or region…' : 'Where do you want to go?'}/></label>
    <div className="agent-composer-actions">
      <button ref={promptTrigger} type="button" className="agent-round" aria-label="Prompt templates" aria-expanded={showPrompts} aria-controls={showPrompts ? 'agent-prompt-list' : undefined} onClick={() => setPromptMenu(value => !value)}><Plus size={18}/></button>
      {!contextId && liveDraft && <Button className="journey-composer-save" disabled={busy || !ready || activeIntake?.needsBuild} onClick={() => saveTripAndExit(liveDraft)} aria-label="Save trip and open itinerary"><Bookmark size={16}/><span>Save trip</span></Button>}
      <DictationControl voice={voice} disabled={busy}/>
      {busy ? <button type="button" className="agent-round agent-send" onClick={() => {stoppedByUser.current = true; active.current?.abort()}} aria-label="Stop response"><Square size={15}/></button>
        : <button type="submit" className="agent-round agent-send" disabled={!query.trim() || resuming || missingContext || !connected} aria-label={messageEdit ? 'Send edited message' : 'Send message'}
          onClick={() => {focusNextReply.current = true}}><ArrowUp size={20}/></button>}
    </div>
    {query.length >= 450 && <small className="agent-character-count">{query.length} / 600 characters</small>}
    {voice.error && <small role="status">{voice.error}</small>}
  </form>

  const preferenceLabels = {destination:'Destination', origin:'Departure city', days:'Trip length', date:'Travel dates', people:'Travellers', budget:'Budget',
    diet:'Food', pace:'Pace', interests:'Interests', transport:'Transport', stayPreferences:'Stays', mobility:'Accessibility', notes:'Trip notes'}
  const preferenceValues = {
    destination: latestIntake.location?.name || latestIntake.destination,
    origin: latestIntake.localStart ? 'Starting at destination' : latestIntake.origin || 'Choose departure city',
    days: latestIntake.days ? `${latestIntake.days} ${latestIntake.days === 1 ? 'day' : 'days'}` : 'Choose trip length',
    date: latestIntake.flexibleDates ? 'Flexible dates' : [latestIntake.date,latestIntake.endDate].filter(Boolean).join(' to ') || 'Choose dates',
    people: latestIntake.people ? `${latestIntake.people} ${latestIntake.people === 1 ? 'traveller' : 'travellers'}` : 'Choose travellers',
    budget: latestIntake.budgetOpen ? 'Undecided' : latestIntake.budget ? money(latestIntake.budget) : 'Choose budget',
    diet: latestIntake.diet || 'No food preference', pace: latestIntake.pace || 'Choose pace',
    interests: latestIntake.interests?.length ? latestIntake.interests.join(' · ') : 'Choose interests',
    transport: latestIntake.transport || 'Any mode', mobility: latestIntake.mobility || 'No preference',
    stayPreferences: latestIntake.stayPreferences?.join(' · ') || 'Any stay type',
    notes: latestIntake.notes ? 'View or edit notes' : 'Add a note',
  }
  const showMapPanel = hasMap && mapOpen && !(roomOpen && roomDraft)
  const tripDetails = latestIntake.destination && <div className="journey-trip-chips">
    {Object.entries(preferenceLabels).filter(([field]) => preferenceValues[field]).map(([field, label]) =>
      <button type="button" className="journey-trip-chip" key={field} disabled={busy || !ready} onClick={() => {
        setDetailsOpen(false)
        editIntakeField(field)
      }}><small>{label}</small><strong>{preferenceValues[field]}</strong><Pencil size={12} aria-hidden="true"/></button>)}
  </div>
  return <div className="page inner-page agent-workspace journey-chat" data-network-offline={!connected || undefined}>
    <div className="agent-header"><div className="journey-chat-heading"><h1>{contextTrip ? `Discuss ${catalog.find(item => item.id === contextTrip.brief.destination)?.name || 'this trip'}` : latestIntake.destination ? `Trip to ${placeTitle(latestIntake.location) || liveDraft?.name || latestIntake.destination}` : 'AI Assistant'}</h1></div>
      <div className="agent-header-controls">
        {hasMap && <Button ref={mapToggle} icon="map" aria-label={mapOpen && !roomOpen ? 'Hide map' : 'Show map'} aria-expanded={mapOpen && !roomOpen} onClick={() => {setSelectedPlace(null);setMapOpen(open => roomOpen || !open);setRoomOpen(false)}}><span className="agent-header-label">{mapOpen && !roomOpen ? 'Hide map' : 'Show map'}</span></Button>}
        {validDraft && <Button icon="users" aria-label="Trip workspace" aria-expanded={roomOpen} onClick={() => roomOpen ? setRoomOpen(false) : openRoom(liveDraft)}><span className="agent-header-label">Trip workspace</span></Button>}
        {!contextId && <Button icon="calendar" disabled={busy || resuming || !ready} aria-label={plannerLabel}
          onClick={liveDraft && !activeIntake?.needsBuild ? () => openBuilder(liveDraft) : continueTrip}>
          <span className="agent-header-label">{plannerLabel}</span>
        </Button>}
        {tripDetails && <Button className={showMapPanel ? 'journey-details-mobile-toggle' : ''} icon="info" aria-label="Trip details" onClick={() => setDetailsOpen(true)}><span className="agent-header-label">Trip details</span></Button>}
        {hasTripPanel && <Button ref={sidebarToggle} icon="wallet" aria-label={sidebarOpen ? 'Hide trip budget' : 'Trip budget'} aria-expanded={sidebarOpen} aria-controls="agent-trip-panel" onClick={() => setSidebarOpen(open => !open)}><span className="agent-header-label">{sidebarOpen ? 'Hide trip budget' : 'Trip budget'}</span></Button>}
      {token && model && <Button className="agent-delete" aria-label="Delete chat" title="Delete chat" disabled={busy}
          onClick={() => {setDeleteError('');setDeleteOpen(true)}}><Trash2 size={17}/><span className="agent-header-label">Delete chat</span></Button>}
        <details className="agent-chat-menu" ref={chatMenu} open={settingsOpen}>
          <summary ref={settingsTrigger} title="Conversation settings" onClick={event=>{event.preventDefault();setSettingsOpen(open=>!open)}}><Ellipsis size={21}/><span className="yatra-sr-only">Conversation settings</span></summary>
          <div onClick={event=>{if(event.target.closest('button'))setSettingsOpen(false)}}>
            <label className="agent-offline"><input type="checkbox" checked={offline} onChange={event => setOffline(event.target.checked)}/> Pause online lookups</label>
            {model && <>
              {model.events.length > 0 && <><Button onClick={() => exportConversation('md')}>Download Markdown</Button>
                <Button onClick={() => exportConversation('json')}>Download JSON</Button></>}
              <Button disabled={busy || (contextId ? model.version === 0 : !model.canUndoItinerary)} onClick={() => send({kind: 'undo'})}>Undo last change</Button>
              <Button disabled={busy || (contextId ? model.version === 0 : !model.canRedoItinerary)} onClick={() => send({kind: 'redo'})}>Redo last change</Button>
            </>}
          </div>
        </details>
      </div>
    </div>
    {!connected && <p className="agent-network-status" role="status">You’re offline. Reconnect to send messages or check live travel data.</p>}
    <div className={'agent-grid' + (hasTripPanel && sidebarOpen ? ' agent-with-panel' : '') + (roomOpen && roomDraft || hasMap && mapOpen ? ' journey-map-open' : '') + (roomOpen && roomDraft ? ' journey-room-open' : '')}>
      {roomOpen && roomDraft ? <div className="journey-side journey-room-side"><TripWorkspace key={roomDraft.id} draft={roomDraft} ideas={roomIdeas} media={roomMedia}
        onDraftUpdate={next => onSaveDraft?.(next, {stayInChat:true,silent:true})}
        onOpenTrip={() => onOpenDraft?.(roomDraft.id)} onAsk={askFollowUp}
        onClose={() => setRoomOpen(false)} onPlaceSelect={openPlace} onEdit={() => openBuilder(roomDraft)}/></div>
      : showMapPanel && <aside className="journey-side journey-map-side" aria-label="Trip map panel">
        <JourneyMap key={mapData.center?.name} {...mapData} selectedId={pinnedPlace} compactControls onSelect={revealMapPlace} onClose={() => {setMapOpen(false);mapToggle.current?.focus()}}/>
        {tripDetails && <section className="journey-trip-summary" aria-label="Your trip so far">
          <h2>Your trip so far</h2>
          {tripDetails}
        </section>}
      </aside>}
      {detailsOpen && tripDetails && <Dialog label="Your trip so far" className="journey-trip-details-dialog" onClose={() => setDetailsOpen(false)}>
        <div className="dialog-content"><h2>Your trip so far</h2>{tripDetails}</div>
      </Dialog>}
      {selectedPlace && <Dialog label={selectedPlace.name} className="discovery-details-dialog" onClose={() => setSelectedPlace(null)}>
        <PlaceDetails key={selectedPlace.url || selectedPlace.name} place={selectedPlace}
          onShowMap={() => {setMapOpen(true);setSelectedPlace(null)}}
          onAdd={selectedPlace.category && placeMapUrl(selectedPlace) ? toggleShortlist : undefined}
          added={shortlist.some(item => item.url === selectedPlace.url)} onSaveMedia={saveMedia} savedMedia={savedMedia}/>
      </Dialog>}
      <section className="agent-chat" aria-label="Travel conversation">
        <div className="agent-thread" ref={transcript} onScroll={updateScroll} tabIndex={0} aria-label="Conversation messages">
        {missingContext && <section className="agent-welcome"><h2>Trip unavailable</h2><a className="btn secondary" href="#trips">Open My Trips</a></section>}
        {!model?.events.length && !busy && !resuming && !missingContext && <section className="agent-welcome">
          <TravelArtwork name="cabin-window" animated className="journey-welcome-photo" width={320} height={320}/>
          <h2>Where are we going?</h2>
          <p>Share a destination, dates, or budget to start planning.</p>
          <Button className="journey-example-prompt" onClick={() => {setQuery('Plan 3 days in Varkala from Mumbai for 2 people under ₹25,000');composer.current?.focus()}}>Try a three-day Varkala trip</Button>
          <div className="agent-pills"><Button variant="primary" disabled={!ready || !connected} onClick={continueTrip}>Start planning</Button>{[
            ['Find stays', 'Find hotels in '],
            ['Explore places', 'What can I see in '], ['Find photos', 'Show photos of '], ['Find videos', 'Show videos of '],
          ].map(([label, prompt]) => <Button key={label} onClick={() => {setQuery(prompt);composer.current?.focus()}}>{label}</Button>)}
          {onProfile && <Button onClick={onProfile}>{profile ? 'Edit travel profile' : 'Personalize my trips'}</Button>}</div>
        </section>}
        {resuming && !error && <p className="agent-tool" role="status">Opening your conversation…</p>}
        {model?.events.map((event, index, events) => {
          const label = event.text || event.label
          const notice = typeof event.notice === 'string' ? event.notice : event.notice?.message
          const sources = (event.tools || []).filter(tool => sourceTools.includes(tool.name) && tool.result)
          const response = typeof event.answer === 'string' ? event.answer : !notice ? replyTextFor(event) : ''
          const isLast = index === events.length - 1
          const isLatestAnswer = isLast && !showPlanning && !showQuestion
          const canReplace = isLast && Boolean(editableMessage)
          const animate = isLast && revealing
          const replyText = replyTextFor(event)
          return <React.Fragment key={event.id || `${index}-${event.kind}-${label || ''}`}>
            {label && <div className="agent-user-message"><p className="agent-user-turn">{label}</p>
              {canReplace && <button type="button" className="agent-action" aria-label="Edit last message" title="Edit last message" disabled={busy} onClick={editLastMessage}><Pencil size={17}/></button>}
            </div>}
            {(response || notice || sources.length > 0 || event.liveDraft || event.buildConfirmation || (contextId && event.draftPreview)) && <section className="agent-reply" aria-label="YatraBuddy’s answer" aria-live={isLast ? 'polite' : undefined}>
              <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
              <div className="agent-answer" ref={isLatestAnswer ? replyHeading : undefined} tabIndex={isLatestAnswer ? -1 : undefined}>
                <div className="agent-answer-content">
                  {animate ? <RevealingAnswer key={model.version} text={replyText} onComplete={()=>setRevealVersion(null)}/> : <>
                  {response && <AgentMessage text={response} kind={event.answerKind}/>}
                  {event.liveDraft && (event.liveDraft.id === chatDraft?.id && event.liveDraft.updated === chatDraft.updated ? <PlannerTimeline draft={liveDraft} catalog={catalog} onPlace={openPlace}
                    saved={drafts?.some(item => item.id === event.liveDraft.id && item.updated >= event.liveDraft.updated)}
                    onSave={ready && !busy && !activeIntake?.needsBuild ? () => saveTripAndExit(liveDraft) : undefined}
                    onEdit={liveDraft?.id === event.liveDraft.id ? () => openBuilder(liveDraft) : undefined}
                    onAdd={toggleShortlist} shortlist={shortlist}/>
                    : <details className="journey-previous-plan"><summary>Earlier {event.liveDraft.name} itinerary</summary>
                      <PlannerTimeline draft={event.liveDraft} catalog={catalog} onPlace={openPlace} onAdd={toggleShortlist} shortlist={shortlist}/>
                    </details>)}
                  {notice && notice !== response && <p>{notice}</p>}
                  {contextId && <DraftPreview draft={event.draftPreview} busy={busy || !ready || resuming}
                    onSave={isLast && !saved && step !== 6 ? () => send({kind: 'save_draft'}) : undefined}
                    onReview={() => send({kind: 'review_draft'})}/>}
                  {sources.map(tool => <SourceAnswer key={tool.id || tool.name} tool={tool} busy={busy} activeStay={choices.Stay?.sourced?.url}
                    onPlace={contextId ? undefined : openPlace} onAdd={contextId ? undefined : item => toggleShortlist({...item,locationId:tool.result.location?.id})} shortlist={shortlist}
                    onRetry={canReplace && !offline && tool.result.error ? () => send({kind: 'message', text: editableMessage, replace: true}) : undefined}
                    onUseStay={!missing && choices.Transport && tool.result.query?.toLowerCase() === stayCity?.toLowerCase()
                      ? item => send({kind: 'use_stay', value: item.url, label: 'Use ' + item.name}) : undefined}/>)}
                  </>}
                </div>
                {!animate && <><AgentToolStatus tools={event.tools || []}/>
                <div className="agent-message-actions">
                  <button type="button" className="agent-action" aria-label={copied === index ? 'Answer copied' : 'Copy answer'} title="Copy answer"
                    onClick={click => copyMessage(click.currentTarget.closest('.agent-answer').querySelector('.agent-answer-content'), index)}>
                    {copied === index ? <Check size={17}/> : <Copy size={17}/>}</button>
                  {response && 'speechSynthesis' in window && <button type="button" className="agent-action" aria-label="Read answer aloud" title="Read answer aloud" onClick={() => {
                    window.speechSynthesis.cancel()
                    window.speechSynthesis.speak(new SpeechSynthesisUtterance(response))
                  }}><Volume2 size={17}/></button>}
                  {canReplace && <button type="button" className="agent-action" aria-label="Regenerate answer" title="Regenerate answer" disabled={busy || Boolean(messageEdit)} onClick={() => send({kind: 'message', text: editableMessage, replace: true})}><RotateCcw size={17}/></button>}
                </div></>}
              </div>
            </section>}
          </React.Fragment>
        })}
        {pendingMessage && <div className="agent-user-message"><p className="agent-user-turn">{pendingMessage}</p></div>}
        {error && <div className="agent-error">
          <p className="form-error" role="alert">{error}</p>
          {resuming && <Button onClick={() => {setError(''); setResumeAttempt(value => value + 1)}}>Retry opening conversation</Button>}
          {!resuming && retryAction && !busy && <Button disabled={offline} onClick={() => {setError(''); void send(retryAction)}}>Retry</Button>}
        </div>}
        {busy && <section className="agent-reply agent-pending" ref={pendingReply} aria-label="YatraBuddy’s response in progress">
          <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
          <div className="agent-answer">
            {!pendingAnswer && <AgentProgress assistant
              label={runningBuildTool?.name || tools.find(tool => tool.status === 'running')?.name || 'Preparing a reply'}
              steps={liveBuildTools.length ? ['Research places', latestIntake.date ? 'Check weather' : 'Weather optional', 'Rank for fit', 'Group and schedule'] : []}
              activeStep={liveBuildTools.length ? buildProgressStep : null}
              skippedSteps={!latestIntake.date ? [1] : []}
              className={liveBuildTools.length ? 'journey-agent-progress' : ''}/>}
            {tools.some(tool => tool.status === 'running' && /photos|Images|Place search|Videos/i.test(tool.name)) && <div className="journey-media-loading" aria-hidden="true"><i/><i/><i/></div>}
            {pendingAnswer?.text && <AgentMessage text={pendingAnswer.text} kind={pendingAnswer.kind} pending/>}
            <AgentToolStatus tools={tools} running/>
          </div>
        </section>}
        {showQuestion && <section className="agent-reply" aria-live="polite">
          <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
          <div><h2 tabIndex={-1} ref={replyHeading}>{showQuestion}</h2>
            <div className={hasDynamicChoices ? 'agent-question-cards' : 'agent-pills'}>{quick.map(({value, label, reason}) => <Button key={value} disabled={busy} onClick={() => edit(missing, value)}>
              <span><strong>{label}</strong>{reason && <small>{reason}</small>}</span>
            </Button>)}</div>
            {hasDynamicChoices && <div className="agent-pills agent-question-escape">
              <Button variant="text-btn" onClick={() => composer.current?.focus()}>Type another answer</Button>
              <Button variant="text-btn" onClick={() => edit(missing, quick[0].value)}>Use the first suggestion</Button>
            </div>}
          </div>
        </section>}
        {showPlanning && <section className="agent-reply" aria-live="polite">
          <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
          <div className="agent-stage">
          <nav className="agent-stepper" aria-label="Planning progress">{stages.map((label, index) => <span key={label} aria-current={index === step ? 'step' : undefined}>{label}</span>)}</nav>
          <h2 tabIndex={-1} ref={replyHeading}>{saved ? 'Your itinerary is ready.' : stagePrompts[step]}</h2>
          {place?.image && [1, 6].includes(step) && <figure className="agent-destination-photo">
            <img src={'/images/' + place.image + '.jpg'} alt={'Destination view of ' + place.name} loading="lazy"/>
            <figcaption>{place.name} · destination photo</figcaption>
          </figure>}
          {options.length > 0 && <AgentOptions key={stage} options={options} budget={brief.budget} otherCosts={total - (ledger[stage] || 0)}
            stay={step === 1 ? {rooms: Math.ceil(brief.people / 2), nights: Math.max(0, brief.days - 1)} : undefined}
            selectedId={choices[stage]?.id} busy={busy} onBudget={amount => edit('budget', amount)}
            onSelect={item => send({kind: 'select', value: item.id, label: item.name})}/>}
          {step === 1 && stayCity && !offline && <div className="agent-pills">
            <Button icon="search" disabled={busy} onClick={() => send({kind:'message', text:'Find hotels in ' + stayCity})}>Find real stays in {stayCity}</Button>
            <small>See property details, photos where available, and source links.</small>
          </div>}
          {[2, 3].includes(step) && place && !offline && <div className="agent-pills">
            <Button icon="search" onClick={() => send({kind: 'message', text: step === 2 ? 'What can I see?' : 'Where can I eat?'})} disabled={busy}>
              {step === 2 ? 'Look up places online' : 'Look up food spots online'}
            </Button>
          </div>}
          {step > 1 && step < 6 && <Button disabled={busy} onClick={() => send({kind: 'continue'})}>{step === 5 ? 'Review trip' : 'Skip for now'}</Button>}
          {step === 6 && <div className="agent-review">
            <div className="agent-review-bookings">
              {['Transport','Stay'].filter(key => choices[key]).map(key => <div key={key}>
                <small>{key}</small><strong>{choices[key].name}</strong>
                {choices[key].sourced && <SourceLink url={choices[key].sourced.url}>{choices[key].sourced.source}</SourceLink>}
                {choices[key].unpriced && <small>Price not confirmed</small>}
              </div>)}
            </div>
            <ol>{preview?.days?.map((day, index) => <li key={index}><strong>Day {index + 1}</strong><span>{day.stops.join(' · ') || 'Free time'}</span></li>)}</ol>
            {model.state.previewError && <p role="status">{model.state.previewError}</p>}
          </div>}
          {step === 6 && (inMyTrips ? <Button variant="primary" disabled={!ready} onClick={() => onOpenTrip(saved.id)}>Open editable itinerary</Button> :
            <Button variant="primary" disabled={busy || !ready || (!saved && !preview)} onClick={() => saved ? onSave(saved) : send({kind: 'save'})}>
              {saved ? 'Save to My Trips' : 'Save itinerary'}
            </Button>)}
          {saved && !unpriced.length && <TripConnectionCheck key={saved.id} plan={saved} plannedTotal={preview?.total}/>}
          </div>
        </section>}
        </div>
        <div className="agent-composer-dock">
        {!contextId && latestIntake.destination && !busy && <details ref={tripTools} className="journey-trip-tools" open={tripToolsOpen}>
          <summary ref={tripToolsTrigger} onClick={event=>{event.preventDefault();setTripToolsOpen(open=>!open)}}>Trip tools <ChevronRight size={15}/></summary><div className="journey-trip-pills" aria-label="Trip preferences and follow-ups" onClick={event=>{if(event.target.closest('button'))setTripToolsOpen(false)}}>
          {Object.entries(preferenceLabels).map(([field, label]) => <Button key={field} onClick={() => editIntakeField(field)}>{label}</Button>)}
          <Button onClick={() => askFollowUp(`Find hotels in ${latestIntake.destination}`)}>Stays</Button>
          <Button onClick={() => askFollowUp(`Find ${latestIntake.diet && !['No restrictions','No preference'].includes(latestIntake.diet) ? latestIntake.diet + ' ' : ''}restaurants in ${latestIntake.destination}`)}>Restaurants</Button>
          <Button onClick={() => askFollowUp(`Things to do in ${latestIntake.destination}`)}>Things to do</Button>
          <Button onClick={() => askFollowUp(`Transport options for ${latestIntake.destination}`)}>Transport</Button>
          <Button onClick={() => askFollowUp(`Travel guide for ${latestIntake.destination}`)}>Guide</Button>
          <Button onClick={() => askFollowUp(`What should I watch out for in ${latestIntake.destination}?`)}>Safety tips</Button>
        </div></details>}
        {jumpVisible && <Button className="agent-jump" onClick={() => jumpToLatest(true)}><ArrowDown size={16}/> Jump to latest</Button>}
        {interrupted && hasTrip && !busy && !messageEdit && <div className="agent-follow-ups">
          <Button onClick={() => setResumePlanning(true)}>Continue trip planning</Button>
        </div>}
        {editableMessage && !busy && !messageEdit && (showPlanning || showQuestion) && !recent.answer && !recent.notice &&
          !(recent.tools || []).some(tool => sourceTools.includes(tool.name) && tool.result) &&
          <button type="button" className="agent-action agent-regenerate" title="Regenerate answer" aria-label="Regenerate answer" onClick={() => send({kind: 'message', text: editableMessage, replace: true})}><RotateCcw size={17}/></button>}
        {recent && !busy && !revealing && !messageEdit && !contextId && connected && <div className="journey-next" aria-label="Suggested next steps">
          {activeIntake?.question && recent?.intakeQuestion?.field !== activeIntake.question.field &&
            <p className="journey-next-question">{activeIntake.question.prompt}</p>}
          <div className="journey-next-actions">
            {activeIntake?.question?.choices.map(text=><Button key={text} onClick={()=>askFollowUp(text)}>{text}</Button>)}
            {activeIntake?.awaitingDestination && activeIntake.destinationChoices?.map(city=><div className="journey-next-city" key={city.id || city.name}>
              <Button icon="pin" onClick={()=>askFollowUp([city.name, city.region || city.country].filter(Boolean).join(', '))}>{city.name}</Button>
              <SourceLink url={city.sourceUrl}>Location source</SourceLink>
            </div>)}
            {activeIntake?.needsBuild && !activeIntake.question && !activeIntake.awaitingDestination &&
              <Button disabled={offline} onClick={continueTrip}>Retry itinerary</Button>}
            {!activeIntake?.question && !activeIntake?.needsBuild && !activeIntake?.awaitingDestination && <>
              {liveDraft ? <>
                <Button onClick={()=>askFollowUp('Make a packing checklist for my trip.')}>Packing checklist</Button>
                <Button onClick={()=>askFollowUp(`Find hotels in ${liveDraft.name}`)}>Find stays</Button>
                <Button onClick={()=>askFollowUp(liveDraft.origin ? `Transport options from ${liveDraft.origin} to ${liveDraft.name}` : `Getting around ${liveDraft.name}`)}>Travel options</Button>
                <Button icon="edit" onClick={()=>editIntakeField('interests')}>Change interests</Button>
              </> : <>
                <Button onClick={()=>askFollowUp(followUpCity ? `Plan a trip to ${followUpCity}` : 'Plan a trip')}>{followUpCity ? 'Plan a trip here' : 'Start planning'}</Button>
                {recentResults?.places?.length > 0 && <Button onClick={()=>askFollowUp('More like these')}>More like these</Button>}
                {followUpCity && recentResults?.category !== 'food' && <Button onClick={()=>askFollowUp(`Find restaurants in ${followUpCity}`)}>Find food</Button>}
              </>}
            </>}
            <Button className="journey-next-write" onClick={()=>composer.current?.focus()}>{activeIntake?.question || activeIntake?.awaitingDestination ? 'Type your answer' : 'Ask a follow-up'}</Button>
          </div>
        </div>}
        {composerForm}
        <p className={'agent-chat-feedback' + (!feedback ? ' yatra-sr-only' : '')} role="status">{feedback}</p>
        </div>
      </section>
      {hasTripPanel && sidebarOpen && <aside id="agent-trip-panel" className="agent-sidebar" aria-label="Trip details">
        <section className="panel stack"><h2>Trip budget</h2><small>SIMULATED · {preview ? 'itinerary estimate' : 'selected items'}</small>
          <dl className="agent-budget-lines">{Object.entries(ledger).map(([key, amount]) => <div key={key}><dt>{key}</dt><dd>{unpriced.includes(key) ? 'Unpriced' : money(amount)}</dd></div>)}</dl>
          <strong>{money(total)} {unpriced.length ? 'partial estimate' : preview ? 'estimated' : 'selected'}</strong>
          {unpriced.length ? <p>Excludes {unpriced.join(' and ').toLowerCase()}.</p> : brief.budget && <p>{money(brief.budget - total)} left</p>}
          {brief.destination === 'singapore' && <Button onClick={checkExchange} disabled={exchangePending}>{exchangePending ? 'Checking exchange rate' : 'Convert budget to SGD'}</Button>}
          {brief.destination === 'singapore' && exchange && <p role="status">{exchange.error || <>{freshnessLabel(exchange)} · {((brief.budget || total) * exchange.rate).toFixed(2)} SGD · Rate dated {exchange.date} · <a href="https://frankfurter.dev/" target="_blank" rel="noreferrer">Frankfurter</a></>}</p>}
        </section>
        {contextTrip && <section className="panel stack"><h2>Current itinerary</h2><p>{contextTrip.days.map(day => day.stops.join(', ')).filter(Boolean).join(' / ') || 'No stops selected.'}</p></section>}
        {hasTrip && <section className="panel stack agent-trip-summary"><h2>Trip details</h2>
          <div className="agent-pills">{fields.map(([field, label]) => <button key={field} type="button" className="agent-detail-pill" disabled={busy} onClick={() => setEditing(editing === field ? '' : field)} aria-pressed={editing === field}>
            <span>{label}</span>{brief[field] != null && <strong>{fieldLabel(field, brief[field])}</strong>}
          </button>)}</div>
          {editing && <form className="stack agent-field" key={editing} ref={node => node?.querySelector('input, select')?.focus()} onSubmit={event => {
            event.preventDefault()
            edit(editing, new FormData(event.currentTarget).get(editing))
          }}><label>{fields.find(([field]) => field === editing)[1]}{fieldControl(editing)}</label><Button type="submit" disabled={busy}>Save</Button></form>}
        </section>}
      </aside>}
    </div>
    {deleteOpen && <Dialog label="Delete this chat?" className="journey-editor-dialog" onClose={() => !busy && setDeleteOpen(false)}>
      <div className="journey-editor">
        <div className="journey-editor-heading"><span><Trash2 size={20}/></span><div><h2>Delete this chat?</h2><p>This removes the conversation. Trips you’ve already saved stay in My Trips.</p></div></div>
        {deleteError && <p className="form-error" role="alert">{deleteError}</p>}
        <div className="journey-editor-actions"><Button disabled={busy} onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button className="journey-delete-confirm" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'OK, delete chat'}</Button></div>
      </div>
    </Dialog>}
    {preferenceField && <TripSettingsDialog key={preferenceField} field={preferenceField} label={preferenceLabels[preferenceField]}
      intake={latestIntake} catalog={catalog} valueLabel={preferenceValues[preferenceField]} onClose={() => setPreferenceField(null)}
      onSave={patch => send({kind:'message',text:`Update ${preferenceLabels[preferenceField].toLowerCase()}`,trip_settings:patch})}/>}

  </div>
}
