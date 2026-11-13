import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react'
import {ArrowDown, ArrowUp, CalendarDays, ChevronLeft, ChevronRight, Copy, Ellipsis, ExternalLink, Heart, MapPin, Mic, Minus, Pencil, Plus, RotateCcw, Sparkles, Square, X} from 'lucide-react'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {PhotoRail} from '../components/PhotoRail.jsx'
import {AgentProgress, Button, Dialog} from '../components/UI.jsx'
import {freshnessLabel, request, travelData} from '../api.mjs'
import {money} from '../planner.mjs'
import TripConnectionCheck from './TripConnectionCheck.jsx'
import {AgentMessage, AgentToolStatus} from './AgentMessage.jsx'
import {AgentOptions} from './AgentOptions.jsx'
import {GroqResearchResult} from './GroqResearch.jsx'
import {useVoiceInput} from './useVoiceInput.mjs'
import {JourneyMap, draftMapData} from './JourneyMap.jsx'
import {PlaceDetails, placeMapUrl} from './PlaceDetails.jsx'
import {TripWorkspace} from './TripWorkspace.jsx'
import {draftSchedule, visitTime} from './draftSchedule.mjs'
import {TravelProviderSources} from './TransportSources.jsx'
import {discoveryPlaceKey, isSaveableDiscoveryPlace, toggleDiscoverySaved, useSavedDiscoveryPlaces} from './discoveryPlaces.mjs'
import './JourneyChat.css'

const stages = ['Transport', 'Stay', 'Activities', 'Food', 'Local transport', 'Weather', 'Review']
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
const sourceTools = ['Place search', 'More places', 'Images', 'Videos', 'Public research', 'Weather', 'Local transport', 'Groq research', 'Destination guide', 'Travel providers']
const choiceBounds = {days: [1, 5], people: [1, 8], budget: [1000, 10000000]}

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
  let href
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') href = parsed.href
  } catch { /* Source may be temporarily unavailable. */ }
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

function PlaceAnswer({result, images, onUseStay, activeStay, busy, onPlace, onAdd, shortlist}) {
  const {query, category, places = [], error} = result
  const topic = {attractions: 'Places to visit', food: 'Food spots', stays: 'Places to stay', hotels: 'Places to stay'}[category]
  const liked = useSavedDiscoveryPlaces()
  const rail = useRef(null)
  const illustrated = places.filter(place => place.photo?.url || place.photo?.originalUrl)
  const other = places.filter(place => !illustrated.includes(place))
  const nudge = direction => rail.current?.scrollBy({left: direction * rail.current.clientWidth * .8, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'})
  const renderPlace = (record, index, card) => {
    const item = mapPlace(record)
    const map = placeMapUrl(item)
    const added = shortlist?.some(entry => entry.url === item.url)
    const saveable = isSaveableDiscoveryPlace(item)
    const likedPlace = liked.some(place => discoveryPlaceKey(place) === discoveryPlaceKey(item))
    return <li key={item.id || `${item.url || item.name}-${index}`} className={card ? 'journey-place-card' : 'journey-place-row'}>
      {card && <div className="journey-card-media">
        <PlacePhoto place={item} hideUnavailable/>
        <div className="journey-card-actions">
          {saveable && <button type="button" aria-pressed={likedPlace} aria-label={`${likedPlace ? 'Unsave' : 'Save'} ${item.name}`} onClick={() => toggleDiscoverySaved(item, result.location)}><Heart size={17} fill={likedPlace ? 'currentColor' : 'none'}/></button>}
          {map && onAdd && item.category && <button type="button" aria-pressed={Boolean(added)} aria-label={`${added ? 'Remove' : 'Add'} ${item.name} ${added ? 'from' : 'to'} trip shortlist`} onClick={() => onAdd(item)}>{added ? <Minus size={18}/> : <Plus size={18}/>}</button>}
        </div>
      </div>}
      <h4>{onPlace ? <button type="button" onClick={() => onPlace(item)}>{item.name}</button> : item.name}</h4>
      <div className="journey-card-meta"><small>{item.category || (images ? 'Photo' : 'Place')}{Number.isFinite(item.distanceMetres) ? ` · ${(item.distanceMetres / 1000).toFixed(1)} km from centre` : ''}</small>{Number.isFinite(item.rating) && <small title={item.source}>★ {item.rating.toFixed(1)}{item.reviewCount > 0 ? ` (${item.reviewCount})` : ''}</small>}</div>
      {(item.description || item.address) && <p>{item.description || item.address}</p>}
      {item.openingHours && <small>{item.openingHours}</small>}
      {item.publishedPrice && <small>{item.publishedPrice} · published by the source</small>}
      <div className="agent-place-links">
        <SourceLink url={item.url}>{item.source || 'Place source'}<span className="yatra-sr-only"> for {item.name}</span></SourceLink>
        {map && !onPlace && <SourceLink url={map}>Map<span className="yatra-sr-only"> for {item.name}</span></SourceLink>}
        {!card && saveable && <Button aria-pressed={likedPlace} onClick={() => toggleDiscoverySaved(item, result.location)}>{likedPlace ? 'Unsave' : 'Save'}</Button>}
        {!card && map && onAdd && item.category && <Button aria-pressed={Boolean(added)} onClick={() => onAdd(item)}>{added ? 'Remove from shortlist' : 'Add to shortlist'}</Button>}
        {onUseStay && category === 'stays' && <Button disabled={busy || activeStay === item.url} onClick={() => onUseStay(item)}>{activeStay === item.url ? 'In your plan' : 'Use this stay'}</Button>}
      </div>
    </li>
  }
  return <section className="agent-source-answer">
    <div className="journey-answer-head"><h3>{images ? `Images${query ? ` of ${query}` : ''}` : topic && query ? `${topic} in ${query}` : 'Places from public sources'}</h3>
      {illustrated.length > 1 && <div className="journey-rail-actions"><button type="button" aria-label="Previous place photos" onClick={() => nudge(-1)}><ChevronLeft size={18}/></button><button type="button" aria-label="Next place photos" onClick={() => nudge(1)}><ChevronRight size={18}/></button></div>}
    </div>
    <small className="agent-source-status">{['live', 'cached'].includes(result.status) ? (result.status === 'live' ? 'Public references' : 'Cached references') : resultStatus(result)}</small>
    {category === 'stays' && places.length > 0 && <p>Check the property for current rates and availability. If you add a stay from these results, the trip total excludes its unconfirmed cost.</p>}
    {illustrated.length > 0 && <ul className="journey-place-strip" ref={rail} aria-label="Place photos" tabIndex={0}>{illustrated.map((record, index) => renderPlace(record, index, true))}</ul>}
    {other.length > 0 && (illustrated.length > 0 ? <details className="journey-more-places"><summary>More places ({other.length})</summary><ul>{other.map((record, index) => renderPlace(record, index, false))}</ul></details>
      : <ul className="journey-place-list">{other.map((record, index) => renderPlace(record, index, false))}</ul>)}
    {!places.length && <p>{error || 'No matching places came back from the public sources. Try another location or search.'}</p>}
  </section>
}

function mapPlace(place) {
  return {...place, lat: place.lat ?? place.latitude, lon: place.lon ?? place.longitude}
}

function PlannerTimeline({draft, onPlace, onSave, onEdit, saved, onAdd, shortlist}) {
  const illustrated = [...new Map([draft.stay, ...draft.days.flat()].filter(place => place?.photo).map(place => [place.url, place])).values()]
  return <section className="journey-timeline" aria-label="Suggested itinerary">
    <header><CalendarDays size={19}/><strong>{draft.name} itinerary</strong><span>{draft.days.length} days</span></header>
    <div className="journey-timeline-actions journey-timeline-top">
      <Button variant="primary" onClick={onSave}>{saved ? 'Open saved trip' : 'Save trip'}</Button>
      <Button onClick={onEdit}>Edit stops and preferences</Button>
    </div>
    {draft.stay && <p>Suggested base: <button type="button" className="journey-inline" onClick={() => onPlace(draft.stay)}>{draft.stay.name}</button></p>}
    {illustrated.length > 0 && <PlaceAnswer result={{places:illustrated,status:'live'}} onPlace={onPlace} onAdd={onAdd} shortlist={shortlist}/>}
    {draft.days.map((stops, index) => <details key={index}>
      <summary>Day {index + 1}<small>{stops.length ? `${stops.length} ${stops.length===1?'stop':'stops'} · ${stops.map(place => place.name).slice(0, 2).join(' · ')}` : 'Free time'}</small></summary>
      <ol>{draftSchedule(draft, index).map(({place, leg, start, end}) => {
        return <li key={place.url}>
          {leg && <small>{leg.kilometres} km · {leg.minutes} min {leg.method === 'road' ? 'driving' : 'approx.'}</small>}
          <button type="button" onClick={() => onPlace(place)}><MapPin size={15}/>{place.name}</button>
          <small>{visitTime(start)} – {visitTime(end)} suggested{place.openingHours ? ` · ${place.openingHours} published hours` : ''}</small>
          <small>{place.publishedPrice || 'Check the source for current prices'}</small>
        </li>
      })}</ol>
    </details>)}
  </section>
}

function GuideAnswer({result}) {
  return <section className="agent-source-answer journey-guide">
    <h3>{result.query ? `${result.query} travel guide` : 'Travel guide'}</h3>
    {result.error ? <p>{result.error}</p> : <>
      <small className="agent-source-status">{resultStatus(result)} · Wikivoyage</small>
      {result.sections?.map((entry, index) => <details key={entry.title} open={index < 2}>
        <summary>{entry.title}</summary><p>{entry.text}</p><SourceLink url={entry.sourceUrl}>Read on Wikivoyage</SourceLink>
      </details>)}
    </>}
  </section>
}

function SourceAnswer({tool, onRetry, ...actions}) {
  const {name, result} = tool
  if (name === 'Groq research') return <GroqResearchResult result={result}/>
  if (name === 'Public research') return <section className="agent-source-answer journey-guide">
    <h3>{result.query ? `What the sources say about ${result.query}` : 'Public travel references'}</h3>
    {result.error ? <p>{result.error}</p> : <><small className="agent-source-status">{resultStatus(result)}</small>{result.findings?.map(item => <article className="journey-research-result" key={item.url}>
      <h4>{item.title}</h4><p>{item.excerpt}</p><SourceLink url={item.url}>Read on {item.publisher}</SourceLink>
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
  if (name === 'Travel providers') return <TravelProviderSources result={result}/>
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
    {Number.isFinite(draft.total) && <p>{money(draft.total)} estimated for the group{draft.unpriced?.length ? `, excluding ${draft.unpriced.join(' and ').toLowerCase()}` : ''}.</p>}
    {Array.isArray(draft.unverifiedPreferences) && draft.unverifiedPreferences.length > 0 && <p>Check separately: {draft.unverifiedPreferences.join(', ')}.</p>}
    {onSave && <div className="agent-pills">
      <Button variant="primary" disabled={busy} onClick={onSave}>Save this draft</Button>
      <Button disabled={busy} onClick={onReview}>Review and customize</Button>
    </div>}
  </section>
}

export function PlanningAgent({catalog, initialQuery, voiceRequested, onSave, onOpenTrip, ready, contextTrip, contextId, contextDraft, newConversation, trips, drafts, onSaveDraft, onOpenDraft, onProfile, profile, onBuild}) {
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
  const [pendingMessage, setPendingMessage] = useState('')
  const [pendingNotice, setPendingNotice] = useState('')
  const [pendingAnswer, setPendingAnswer] = useState(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [selectedPlace, setSelectedPlace] = useState(null)
  const [shortlist, setShortlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem(sessionKey + '.shortlist')) || [] } catch { return [] }
  })
  const [savedMedia, setSavedMedia] = useState(() => {
    try { return JSON.parse(localStorage.getItem(sessionKey + '.media')) || [] } catch { return [] }
  })
  const [roomOpen, setRoomOpen] = useState(false)
  const [roomDraftId, setRoomDraftId] = useState(null)
  const transcript = useRef(null)
  const followLatest = useRef(true)
  const sidebarToggle = useRef(null)
  const chatMenu = useRef(null)
  const replyHeading = useRef(null)
  const focusNextReply = useRef(false)
  const revealNextReply = useRef(false)
  const composer = useRef(null)
  const active = useRef(null)
  const lock = useRef(false)
  const initialSent = useRef(false)
  const voice = useVoiceInput({onTranscript: text => setQuery(text)})
  const ownsFocus = target => target === document.body || target.closest?.('.agent-workspace')

  function jumpToLatest() {
    followLatest.current = true
    setJumpVisible(false)
    const node = transcript.current
    if (node) node.scrollTop = node.scrollHeight
  }

  function updateScroll() {
    const node = transcript.current
    const nearLatest = node.scrollHeight - node.scrollTop - node.clientHeight < 96
    followLatest.current = nearLatest
    setJumpVisible(!nearLatest)
  }

  useLayoutEffect(() => {
    if (followLatest.current) jumpToLatest()
  }, [model?.version, busy, error, tools, pendingAnswer, sidebarOpen, resumePlanning])

  useEffect(() => {
    function onShortcut(event) {
      if (event.key === 'Escape') {
        if (chatMenu.current?.open) {
          chatMenu.current.open = false
          chatMenu.current.querySelector('summary')?.focus()
        } else if (sidebarOpen && (event.target === sidebarToggle.current || event.target.closest?.('.agent-sidebar'))) {
          setSidebarOpen(false)
          sidebarToggle.current?.focus()
        }
      }
      if ((event.key !== '/' && event.code !== 'Slash') || !ownsFocus(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.target.matches?.('textarea,input,select,[contenteditable="true"]')) return
      event.preventDefault()
      composer.current?.focus()
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [sidebarOpen])

  useEffect(() => {
    if (!voiceRequested) return
    composer.current?.focus()
  }, [voiceRequested])
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
    followLatest.current = true
    revealNextReply.current = true
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError('')
    setResumePlanning(false)
    setFeedback('')
    setTools([])
    setPendingNotice('')
    setPendingAnswer(null)
    setPendingMessage(action.text || action.label || '')
    try {
      let session = token
      let version = model?.version || 0
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
            travelGroup:profile.travelGroup, stayPreferences:profile.stayPreferences, notes:profile.notes} : undefined, ...action}),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
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
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        buffer += value
        let end
        while ((end = buffer.indexOf('\n')) !== -1) {
          const event = JSON.parse(buffer.slice(0, end))
          buffer = buffer.slice(end + 1)
          if (event.type === 'tool' && typeof event.name === 'string') setTools(current => [...current.filter(tool => (tool.id || tool.name) !== (event.id || event.name)), event])
          if (event.type === 'notice' && typeof event.message === 'string') setPendingNotice(event.message)
          if (event.type === 'answer' && typeof event.text === 'string') setPendingAnswer({text: event.text, kind: event.answerKind})
          if (event.type === 'delta' && typeof event.text === 'string') setPendingAnswer(previous => ({
            text: (previous?.text || '') + event.text, kind: event.answerKind || previous?.kind,
          }))
          if (event.type === 'error') throw new Error(event.message)
          if (event.type === 'done') {
            setModel(validateSession(event))
            finished = true
            setPendingMessage('')
            setPendingNotice('')
            setPendingAnswer(null)
            setTools([])
            if ((event.syncPlan || ['save', 'save_draft'].includes(action.kind)) && event.state.plan) {
              if (contextId) localStorage.setItem(revisionKey, contextRevision(session, event.state.plan))
              onSave(event.state.plan)
            }
          }
        }
      }
      if (!finished) throw new Error('The turn ended before it was saved. Try again.')
      return true
    } catch (failure) {
      if (!controller.signal.aborted) {
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
      lock.current = false
      setBusy(false)
      setPendingMessage('')
      setPendingNotice('')
      setPendingAnswer(null)
      setTools([])
      active.current = null
    }
  }

  async function remove() {
    if (!token || busy || !window.confirm('Delete this planning conversation?')) return
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
    } catch (failure) {setError(plannerError(failure))}
    finally {setBusy(false)}
  }

  const brief = model?.state.brief || {}
  const missing = model?.missing?.[0]
  const step = model?.state.step || 0
  const stage = stages[step]
  const recent = model?.events.at(-1)
  const itineraryRequest = model?.currentItinerary?.request
  const chatDraft = model?.currentItinerary?.draft || contextDraft
  const libraryDraft = drafts?.find(item => item.id === chatDraft?.id)
  const liveDraft = libraryDraft && libraryDraft.updated >= chatDraft.updated ? libraryDraft : chatDraft
  const mapData = useMemo(() => {
    const itinerary = liveDraft ? draftMapData(liveDraft) : {places: [], routes: []}
    const lookup = [...(model?.events || []).flatMap(event => event.tools || []), ...tools].filter(tool => tool.result?.places?.length)
    const latestLookup = lookup.at(-1)?.result
    const center = latestLookup?.location || itineraryRequest?.location || itinerary.center
    const sameArea = !liveDraft || !latestLookup?.location || latestLookup.location.id === liveDraft.cityId
    const places = new Map([
      ...(latestLookup?.places || []).map(mapPlace),
      ...shortlist,
      ...(sameArea ? itinerary.places : []),
      ...(selectedPlace ? [selectedPlace] : []),
    ].filter(place => placeMapUrl(place)).map(place => [place.url || place.name, place]))
    return {center, places: [...places.values()], routes: sameArea ? itinerary.routes : []}
  }, [itineraryRequest, liveDraft, model, selectedPlace, shortlist, tools])
  const [preferenceField, setPreferenceField] = useState(null)
  const [party, setParty] = useState(null)
  const latestIntake = itineraryRequest || (contextDraft ? {destination: contextDraft.name, days: contextDraft.days.length, people: contextDraft.travelers, date: contextDraft.departure, budget: contextDraft.budget, diet: contextDraft.mealPreference, pace: contextDraft.pace, party:contextDraft.party} : {})
  const hasMap = Boolean(!contextId && (mapData.places.length || mapData.center || selectedPlace))
  const validDraft = drafts?.some(item => item.id === liveDraft?.id)
  const roomDraft = drafts?.find(item => item.id === roomDraftId) || (liveDraft?.id === roomDraftId ? liveDraft : null)
  const editableMessage = recent?.kind === 'message' && recent.text?.trim() ? recent.text : ''
  const options = recent?.options || []
  const preview = model?.state.preview
  const ledger = preview?.ledger || model?.ledger || {}
  const total = Object.values(ledger).reduce((sum, amount) => sum + amount, 0)
  const saved = model?.state.plan
  const choices = model?.state.choices || {}
  const unpriced = preview?.unpriced || Object.keys(choices).filter(key => choices[key].unpriced)
  const stayCity = ({goa:'Palolem', kerala:'Varkala', kutch:'Bhuj'})[brief.destination] || catalog.find(item => item.id === brief.destination)?.name
  const inMyTrips = saved && trips.some(trip => trip.id === saved.id)
  const resolvedSources = tools.filter(tool => sourceTools.includes(tool.name) && tool.result)
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
    setMapOpen(true)
    setSelectedPlace(mapPlace(item))
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
    if (!drafts?.some(item => item.id === draft.id)) onSaveDraft?.(draft, {stayInChat:true})
    setRoomDraftId(draft.id)
    setSelectedPlace(null)
    setRoomOpen(true)
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
    setQuery('')
    void send({kind:'message', text})
  }
  const fieldLabel = (field, value) => field === 'destination'
    ? catalog.find(item => item.id === value)?.name || value
    : field === 'budget' ? money(Number(value)) : String(value)
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
  useEffect(() => {
    if (busy || !model?.version) return
    const heading=replyHeading.current
    const thread=transcript.current
    if(revealNextReply.current&&heading&&thread){
      const y=heading.getBoundingClientRect().top-thread.getBoundingClientRect().top+thread.scrollTop-9
      thread.scrollTo({top:Math.max(0,y),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
      setJumpVisible(false)
    }
    revealNextReply.current=false
    if (focusNextReply.current || document.activeElement === document.body) {
      replyHeading.current?.focus({preventScroll: true})
    }
    focusNextReply.current = false
  }, [model?.version, busy])

  async function checkExchange() {
    setExchangePending(true)
    try {setExchange(await travelData('yatra/exchange?currency=SGD'))}
    catch {setExchange({error: 'Exchange rate unavailable.'})}
    finally {setExchangePending(false)}
  }
  const sendMessage = async event => {
    event.preventDefault()
    if (!query.trim() || lock.current || busy || resuming || missingContext) return
    if (messageEdit && messageEdit.version !== model?.version) {
      setMessageEdit(null)
      setError('The conversation changed. Review your message before sending it again.')
      return
    }
    const ordinal = /^(?:(?:select|choose|pick|take) (?:the )?|the )(first|second|third|fourth|fifth)(?: (?:one|option))?[.!]?$/i.exec(query.trim())
    const option = showPlanning && ordinal && options[['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal[1].toLowerCase())]
    setQuery('')
    const action = messageEdit ? {kind: 'message', text: query.trim(), replace: true}
      : option ? {kind: 'select', value: option.id, label: option.name}
        : /^(go back|undo|\/undo)$/i.test(query.trim()) ? {kind: 'undo'} : {kind: 'message', text: query.trim()}
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

  async function copyMessage(node) {
    const text = node?.innerText?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setFeedback('Copied to clipboard.')
    } catch {
      setFeedback('Could not copy. Select the text and copy it manually.')
    }
  }

  useEffect(() => {
    if (!feedback) return
    const timeout = window.setTimeout(() => setFeedback(''), 3000)
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

  const composerForm = <form className="agent-composer" onSubmit={sendMessage}>
    {messageEdit && <div className="agent-compose-edit"><span>Editing your last message</span><button type="button" className="agent-action" aria-label="Cancel editing" onClick={() => {
      setQuery(messageEdit.draft); setMessageEdit(null); composer.current?.focus()
    }}><X size={17}/></button></div>}
    <label className="agent-composer-input"><span className="yatra-sr-only">Message YatraBuddy</span><textarea ref={composer} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
        event.preventDefault()
        event.currentTarget.form.requestSubmit()
      }
    }} maxLength={600} rows={1} placeholder="Message YatraBuddy…"/></label>
    <div className="agent-composer-actions">
      {voice.browserSupported && <button type="button" className="agent-round" aria-label={voice.phase === 'idle' ? 'Dictate a message' : 'Stop microphone'} title="Dictate a message" onClick={voice.phase === 'idle' ? voice.startBrowser : voice.stop}><Mic size={19}/></button>}
      {busy ? <button type="button" className="agent-round agent-send" onClick={() => active.current?.abort()} aria-label="Stop response"><Square size={15}/></button>
        : <button type="submit" className="agent-round agent-send" disabled={!query.trim() || resuming || missingContext} aria-label={messageEdit ? 'Send edited message' : 'Send message'}
          onClick={() => {focusNextReply.current = true}}><ArrowUp size={20}/></button>}
    </div>
    {voice.error && <small role="status">{voice.error}</small>}
  </form>

  const preferenceLabels = {date: 'Dates', people: 'Travellers', budget: 'Budget', diet: 'Food', preferences:'Preferences'}
  const preferenceValues = {
    date: [latestIntake.date,latestIntake.endDate].filter(Boolean).join(' to '), people: latestIntake.people && latestIntake.people + ' travellers',
    budget: latestIntake.budget && money(latestIntake.budget), diet: latestIntake.diet,
  }
  return <div className="page inner-page agent-workspace journey-chat">
    <div className="agent-header"><div className="journey-chat-heading"><span><Sparkles size={14}/> YatraBuddy trip assistant</span><h1>{contextTrip ? `Discuss ${catalog.find(item => item.id === contextTrip.brief.destination)?.name || 'this trip'}` : latestIntake.destination ? `Trip to ${latestIntake.location?.name||liveDraft?.name||latestIntake.destination}` : 'Travel Assistant'}</h1></div>
      <div className="agent-header-controls">
        {hasMap && <Button icon="map" aria-expanded={mapOpen && !roomOpen} onClick={() => {setSelectedPlace(null);setMapOpen(open => roomOpen || !open);setRoomOpen(false)}}>{mapOpen && !roomOpen ? 'Hide map' : 'Show map'}</Button>}
        {validDraft && <Button aria-expanded={roomOpen} onClick={() => roomOpen ? setRoomOpen(false) : openRoom(liveDraft)}>Trip workspace</Button>}
        <Button icon="trip" onClick={() => openBuilder(liveDraft)}>Build itinerary{shortlist.length ? ' · ' + shortlist.length : ''}</Button>
        {hasTripPanel && <Button ref={sidebarToggle} aria-expanded={sidebarOpen} aria-controls="agent-trip-panel" onClick={() => setSidebarOpen(open => !open)}>{sidebarOpen ? 'Hide trip details' : 'Trip details'}</Button>}
        <details className="agent-chat-menu" ref={chatMenu}><summary title="Conversation settings"><Ellipsis size={21}/><span className="yatra-sr-only">Conversation settings</span></summary>
          <div>
            <label className="agent-offline"><input type="checkbox" checked={offline} onChange={event => setOffline(event.target.checked)}/> Pause online lookups</label>
            {model && <>
              <Button disabled={busy || (contextId ? model.version === 0 : !model.canUndoItinerary)} onClick={() => send({kind: 'undo'})}>Undo last change</Button>
              <Button disabled={busy || (contextId ? model.version === 0 : !model.canRedoItinerary)} onClick={() => send({kind: 'redo'})}>Redo last change</Button>
              <Button disabled={busy} onClick={remove}>Delete planning conversation</Button>
            </>}
          </div>
        </details>
      </div>
    </div>
    <div className={'agent-grid' + (hasTripPanel && sidebarOpen ? ' agent-with-panel' : '') + (roomOpen && roomDraft || hasMap && mapOpen ? ' journey-map-open' : '') + (roomOpen && roomDraft ? ' journey-room-open' : '')}>
      {roomOpen && roomDraft ? <div className="journey-side journey-room-side"><TripWorkspace key={roomDraft.id} draft={roomDraft} ideas={roomIdeas} media={roomMedia}
        onDraftUpdate={next => onSaveDraft?.(next, {stayInChat:true,silent:true})}
        onOpenTrip={() => onOpenDraft?.(roomDraft.id)} onAsk={askFollowUp}
        onClose={() => setRoomOpen(false)} onPlaceSelect={openPlace} onEdit={() => openBuilder(roomDraft)}/></div>
      : hasMap && mapOpen && <div className="journey-side">
        {selectedPlace ? <PlaceDetails key={selectedPlace.url || selectedPlace.name} place={selectedPlace}
          onClose={() => setSelectedPlace(null)} onShowMap={() => setSelectedPlace(null)}
          onAdd={selectedPlace.category && placeMapUrl(selectedPlace) ? toggleShortlist : undefined}
          added={shortlist.some(item => item.url === selectedPlace.url)} onSaveMedia={saveMedia} savedMedia={savedMedia}/>
          : <JourneyMap {...mapData} onSelect={openPlace} onClose={() => setMapOpen(false)}/>}
      </div>}
      <section className="agent-chat" aria-label="Travel conversation">
        <div className="agent-thread" ref={transcript} onScroll={updateScroll} tabIndex={0} aria-label="Conversation messages">
        {missingContext && <section className="agent-welcome"><h2>Trip unavailable</h2><a className="btn secondary" href="#trips">Open My Trips</a></section>}
        {!model && !resuming && !missingContext && <section className="agent-welcome">
          <span className="agent-avatar"><Sparkles size={22}/></span>
          <h2>Where are we going?</h2>
          <p>Tell me where you want to go. Explore places, compare stays, and build a trip around the stops you like.</p>
          <div className="agent-pills">{[
            ['Plan a trip', 'Plan a trip to '], ['Find stays', 'Find hotels in '],
            ['Explore places', 'What can I see in '], ['Find photos', 'Show photos of '], ['Find videos', 'Show videos of '],
          ].map(([label, prompt]) => <Button key={label} onClick={() => {setQuery(prompt);composer.current?.focus()}}>{label}</Button>)}
          {onProfile && <Button onClick={onProfile}>{profile ? 'Edit travel profile' : 'Personalize my trips'}</Button>}</div>
        </section>}
        {resuming && !error && <p className="agent-tool" role="status">Opening your conversation…</p>}
        {model?.events.map((event, index, events) => {
          const label = event.text || event.label
          const notice = typeof event.notice === 'string' ? event.notice : event.notice?.message
          const sources = (event.tools || []).filter(tool => sourceTools.includes(tool.name) && tool.result)
          const response = typeof event.answer === 'string' ? event.answer : ''
          const isLast = index === events.length - 1
          const isLatestAnswer = isLast && !showPlanning && !showQuestion
          const canReplace = isLast && Boolean(editableMessage)
          return <React.Fragment key={event.id || `${index}-${event.kind}-${label || ''}`}>
            {label && <div className="agent-user-message"><p className="agent-user-turn">{label}</p>
              {canReplace && <button type="button" className="agent-action" aria-label="Edit last message" title="Edit last message" disabled={busy} onClick={editLastMessage}><Pencil size={17}/></button>}
            </div>}
            {(response || notice || sources.length > 0 || event.liveDraft || (contextId && event.draftPreview)) && <section className="agent-reply" aria-label="YatraBuddy’s answer" aria-live={isLast ? 'polite' : undefined}>
              <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
              <div className="agent-answer" ref={isLatestAnswer ? replyHeading : undefined} tabIndex={isLatestAnswer ? -1 : undefined}>
                <div className="agent-answer-content">
                  {response && <AgentMessage text={response} kind={event.answerKind}/>}
                  {event.liveDraft && <PlannerTimeline draft={event.liveDraft} onPlace={openPlace}
                    saved={drafts?.some(item => item.id === event.liveDraft.id)}
                    onSave={() => liveDraft?.id === event.liveDraft.id ? openRoom(event.liveDraft) : onSaveDraft(event.liveDraft)}
                    onEdit={() => openBuilder(event.liveDraft)} onAdd={toggleShortlist} shortlist={shortlist}/>}
                  {notice && notice !== response && <p>{notice}</p>}
                  {isLast&&!busy&&event.intakeQuestion&&<div className="agent-pills journey-intake-actions">
                    {event.intakeQuestion.choices?.map(text=><Button key={text} onClick={()=>askFollowUp(text)}>{text}</Button>)}
                    {event.intakeQuestion.field==='date'&&<Button icon="calendar" onClick={()=>setPreferenceField('date')}>Choose travel dates</Button>}
                  </div>}
                  {!!event.destinationChoices?.length&&<div className="journey-destination-choices" aria-label="Verified starting cities">
                    {event.destinationChoices.map(city=><div key={city.id||city.name}><Button icon="pin" disabled={busy||!isLast} onClick={()=>askFollowUp([city.name,city.region||city.country].filter(Boolean).join(', '))}>{city.name}</Button>
                      <SourceLink url={city.sourceUrl}>Location source</SourceLink></div>)}
                  </div>}
                  {contextId && <DraftPreview draft={event.draftPreview} busy={busy || !ready || resuming}
                    onSave={isLast && !saved && step !== 6 ? () => send({kind: 'save_draft'}) : undefined}
                    onReview={() => send({kind: 'review_draft'})}/>}
                  {sources.map(tool => <SourceAnswer key={tool.id || tool.name} tool={tool} busy={busy} activeStay={choices.Stay?.sourced?.url}
                    onPlace={contextId ? undefined : openPlace} onAdd={contextId ? undefined : item => toggleShortlist({...item,locationId:tool.result.location?.id})} shortlist={shortlist}
                    onRetry={canReplace && !offline && tool.result.error ? () => send({kind: 'message', text: editableMessage, replace: true}) : undefined}
                    onUseStay={!missing && choices.Transport && tool.result.query?.toLowerCase() === stayCity?.toLowerCase()
                      ? item => send({kind: 'use_stay', value: item.url, label: 'Use ' + item.name}) : undefined}/>)}
                  {isLast&&!busy&&sources.some(tool=>['Place search','More places'].includes(tool.name)&&tool.result.places?.length)&&<div className="agent-pills journey-intake-actions" aria-label="Refine recommendations">
                    <Button icon="heart" onClick={()=>askFollowUp('More like these')}>More like these</Button>
                    <Button icon="edit" onClick={()=>{setQuery('Show me ');composer.current?.focus()}}>Refine search</Button>
                  </div>}
                  {isLast&&!busy&&event.liveDraft&&<div className="agent-pills journey-intake-actions" aria-label="Refine itinerary">
                    <Button icon="check" onClick={()=>openRoom(event.liveDraft)}>I like this plan</Button>
                    <Button icon="edit" onClick={()=>setPreferenceField('preferences')}>Change the mix</Button>
                  </div>}
                </div>
                <AgentToolStatus tools={event.tools || []}/>
                <div className="agent-message-actions">
                  <button type="button" className="agent-action" aria-label="Copy answer" title="Copy answer" onClick={event => copyMessage(event.currentTarget.closest('.agent-answer').querySelector('.agent-answer-content'))}><Copy size={17}/></button>
                  {canReplace && <button type="button" className="agent-action" aria-label="Regenerate answer" title="Regenerate answer" disabled={busy || Boolean(messageEdit)} onClick={() => send({kind: 'message', text: editableMessage, replace: true})}><RotateCcw size={17}/></button>}
                </div>
              </div>
            </section>}
          </React.Fragment>
        })}
        {pendingMessage && <div className="agent-user-message"><p className="agent-user-turn">{pendingMessage}</p></div>}
        {error && <div className="agent-error">
          <p className="form-error" role="alert">{error}</p>
          {resuming && <Button onClick={() => {setError(''); setResumeAttempt(value => value + 1)}}>Retry opening conversation</Button>}
        </div>}
        {busy && <section className="agent-reply agent-pending" aria-label="YatraBuddy’s response in progress">
          <span className="agent-avatar" aria-hidden="true"><Sparkles size={18}/></span>
          <div className="agent-answer">
            {!pendingAnswer && <AgentProgress label={tools.find(tool => tool.status === 'running')?.name || 'Preparing a reply'}/>}
            {tools.some(tool => tool.status === 'running' && /photos|Images|Place search|Videos/i.test(tool.name)) && <div className="journey-media-loading" aria-hidden="true"><i/><i/><i/></div>}
            {pendingAnswer?.text && <AgentMessage text={pendingAnswer.text} kind={pendingAnswer.kind} pending/>}
            {pendingNotice && pendingNotice !== pendingAnswer?.text && <p>{pendingNotice}</p>}
            {resolvedSources.map(tool => <SourceAnswer key={tool.id || tool.name} tool={tool} busy/>)}
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
        {!contextId && latestIntake.destination && !busy && <details className="journey-trip-tools"><summary>Trip tools <ChevronRight size={15}/></summary><div className="journey-trip-pills" aria-label="Trip preferences and follow-ups" onClick={event=>{if(event.target.closest('button'))event.currentTarget.parentElement.open=false}}>
          {Object.entries(preferenceLabels).map(([field, label]) => <Button key={field} onClick={() => {
            if (field === 'people') setParty(latestIntake.party || {adults:latestIntake.people || 1, children:0, infants:0, pets:0})
            setPreferenceField(field)
          }}>{preferenceValues[field] || label}</Button>)}
          <Button onClick={() => askFollowUp(`Find hotels in ${latestIntake.destination}`)}>Stays</Button>
          <Button onClick={() => askFollowUp(`Find ${latestIntake.diet && !['No restrictions','No preference'].includes(latestIntake.diet) ? latestIntake.diet + ' ' : ''}restaurants in ${latestIntake.destination}`)}>Restaurants</Button>
          <Button onClick={() => askFollowUp(`Things to do in ${latestIntake.destination}`)}>Things to do</Button>
          <Button onClick={() => askFollowUp(`Transport options for ${latestIntake.destination}`)}>Transport</Button>
          <Button onClick={() => askFollowUp(`Travel guide for ${latestIntake.destination}`)}>Guide</Button>
          <Button onClick={() => askFollowUp(`What should I watch out for in ${latestIntake.destination}?`)}>Safety tips</Button>
        </div></details>}
        {jumpVisible && <Button className="agent-jump" onClick={jumpToLatest}><ArrowDown size={16}/> Jump to latest</Button>}
        {interrupted && hasTrip && !busy && !messageEdit && <div className="agent-follow-ups">
          <Button onClick={() => {followLatest.current = true; setResumePlanning(true)}}>Continue trip planning</Button>
        </div>}
        {editableMessage && !busy && !messageEdit && (showPlanning || showQuestion) && !recent.answer && !recent.notice &&
          !(recent.tools || []).some(tool => sourceTools.includes(tool.name) && tool.result) &&
          <button type="button" className="agent-action agent-regenerate" title="Regenerate answer" aria-label="Regenerate answer" onClick={() => send({kind: 'message', text: editableMessage, replace: true})}><RotateCcw size={17}/></button>}
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
    {preferenceField && <Dialog label={preferenceLabels[preferenceField]} onClose={() => setPreferenceField(null)}>
      <form className="stack journey-preference-form" onSubmit={event => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        const value = fields.get('value')
        const end = fields.get('end')
        const text = {date:value ? `Travel on ${value}${end ? ` through ${end}` : ''}` : `${fields.get('days')} days with flexible dates`,
          people:party && `${party.adults} adults, ${party.children} children, ${party.infants} infants, ${party.pets} pets`,
          budget:`Budget ₹${value}`, diet:value, preferences:`Trip preferences: ${value}`}[preferenceField]
        setPreferenceField(null)
        askFollowUp(text)
      }}>
        <h2>{preferenceLabels[preferenceField]}</h2>
        {preferenceField === 'people' && party ? <div className="journey-party">
          {[['adults','Adults','Ages 13 and up'],['children','Children','Ages 2–12'],['infants','Infants','Under 2'],['pets','Pets','Check provider policies']].map(([key,label,description]) => <div key={key}>
            <span><strong>{label}</strong><small>{description}</small></span>
            <Button aria-label={`Remove ${key}`} disabled={party[key] <= (key==='adults'?1:0)} onClick={() => setParty({...party,[key]:party[key]-1})}><Minus size={16}/></Button>
            <output aria-label={label}>{party[key]}</output>
            <Button aria-label={`Add ${key}`} disabled={key==='pets' ? party.pets >= 8 : party.adults + party.children + party.infants >= 8} onClick={() => setParty({...party,[key]:party[key]+1})}><Plus size={16}/></Button>
          </div>)}
        </div> : <label>{preferenceField === 'date' ? 'Departure date (optional)' : preferenceField === 'budget' ? 'Total budget in INR' : preferenceLabels[preferenceField]}
          {preferenceField === 'diet' ? <select name="value" defaultValue={latestIntake.diet || 'No preference'}>
            {['No preference','Vegetarian','Non-vegetarian','Vegan','Jain','Halal'].map(diet => <option key={diet}>{diet}</option>)}
          </select> : preferenceField === 'preferences' ? <textarea name="value" required maxLength={450} rows={3} defaultValue={latestIntake.notes || ''} placeholder="For example: relaxed pace, museums, vegan meals"/>
            : <input name="value" required={preferenceField !== 'date'} defaultValue={latestIntake[preferenceField] || ''} type={preferenceField === 'date' ? 'date' : 'number'}
              min={preferenceField === 'budget' ? 1000 : undefined} max={preferenceField === 'budget' ? 10000000 : undefined}/>}
        </label>}
        {preferenceField === 'date' && <><label>Last day (optional)<input name="end" type="date" defaultValue={latestIntake.endDate || ''}/></label><label>Duration when dates are flexible<select name="days" defaultValue={latestIntake.days || 2}>{[1,2,3,4,5].map(day => <option key={day} value={day}>{day} {day === 1 ? 'day' : 'days'}</option>)}</select></label></>}
        <Button variant="primary" type="submit">Update trip</Button>
      </form>
    </Dialog>}
  </div>
}
