import {useMapPanel} from './useMapPanel.mjs'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {Camera, ClipboardList, NotebookPen} from 'lucide-react'
import {request} from '../api.mjs'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {PhotoRail} from '../components/PhotoRail.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {revealResult} from '../components/revealResult.mjs'
import {AgentProgress, Button, Dialog, Icon, IconButton, Pill, SourcePill, TravelArtwork} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {draftSchedule, visitTime} from './draftSchedule.mjs'
import {draftMapData, JourneyMap, mapPlaceId} from './JourneyMap.jsx'
import {PlaceDetails} from './PlaceDetails.jsx'
import {TripTransport} from './TripTransport.jsx'
import {TripWorkspace} from './TripWorkspace.jsx'
import {draftBudget, draftPreferences, tripCalendar} from './tripOverview.mjs'
import './TripOverview.css'
import {DictationControl} from './DictationControl.jsx'
import {useVoiceInput} from './useVoiceInput.mjs'

const workspaceTabs = new Set(['travel', 'ideas', 'itinerary', 'bookings', 'media', 'calendar', 'chat'])
const dateFormat = new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'})
const mealOptions = ['No preference', 'Vegetarian', 'Non-vegetarian', 'Vegan', 'Jain', 'Halal']
const paceOptions = ['Relaxed', 'Balanced', 'Packed']
const transportModes = ['Walk', 'Bus', 'Metro', 'Auto', 'Cab']
const shortcuts = [
  ['overview', 'Overview', 'trip'],
  ['itinerary', 'Itinerary', 'map'],
  ['bookings', 'Bookings', 'trip'],
  ['chat', 'Group chat', 'chat'],
  ['media', 'Memories', Camera],
  ['ideas', 'Ideas', 'heart'],
  ['calendar', 'Calendar', 'calendar'],
  ['transport', 'Transport', 'plane'],
  ['stays', 'Find a stay', 'bed'],
  ['packing', 'Packing list', ClipboardList],
  ['journal', 'Trip journal', NotebookPen],
  ['preferences', 'Trip preferences', 'settings'],
]

function formatDate(value) {
  return value ? dateFormat.format(new Date(value + 'T12:00:00Z')) : 'Flexible dates'
}

function exportCalendar(draft) {
  const contents = tripCalendar(draft)
  if (!contents) return
  const url = URL.createObjectURL(new Blob([contents], {type: 'text/calendar;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = url
  link.download = (draft.name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'trip') + '.ics'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function TravelBudget({draft}) {
  const {dayCosts, entered, unpriced} = draftBudget(draft)
  const scale = Math.max(1, ...dayCosts.map(day => day.total))
  const [selected, setSelected] = useState(0)
  const active = Math.min(selected, dayCosts.length - 1)
  const balance = draft.budget == null ? null : draft.budget - entered
  return <section className="trip-overview-glass trip-overview-budget" aria-label="Trip budget">
    <div className="trip-overview-section-head">
      <div><h2>Trip budget</h2><p>Entered costs for the group</p></div>
      <Icon name="wallet" size={23}/>
    </div>
    <div className="trip-overview-budget-total">
      <strong>{money(entered)}</strong>
      {draft.budget != null && <span>of {money(draft.budget)}</span>}
    </div>
    {balance != null && <>
      <progress max={draft.budget} value={Math.min(entered, draft.budget)} aria-label="Group budget used"/>
      <p className={balance < 0 ? 'trip-overview-over-budget' : ''}>
        {balance < 0 ? `${money(-balance)} above budget` : `${money(balance)} left before unpriced items`}
      </p>
    </>}
    <div className="trip-overview-chart" role="group" aria-label="Entered stop costs by day">
      {dayCosts.map((day, index) => <button key={index} type="button"
        aria-pressed={active === index} onClick={() => setSelected(index)}
        aria-label={`Day ${index + 1}, ${day.priced ? money(day.total) : 'no entered stop costs'}`}>
        <span className="trip-overview-bar-track"><span style={{'--day-cost': Math.round(day.total / scale * 100) + '%'}}/></span>
        <small>Day {index + 1}</small>
      </button>)}
    </div>
    <p>Day {active + 1} · {dayCosts[active].priced ? money(dayCosts[active].total) : 'No entered costs'}</p>
    <p>{unpriced ? `${unpriced} ${unpriced === 1 ? 'stop still needs a price' : 'stops still need prices'}. ` : ''}
      Stays and transfers are tracked separately.</p>
  </section>
}

function TripPhotoReferences({draft, stops, onSelect}) {
  const places = [draft.stay,...stops].filter(place=>place?.photo?.url && place.photo.kind !== 'nearby')
  const [failed,setFailed]=useState(()=>new Set())
  const illustrated=places.filter(place=>!failed.has(place.url))
  if(!illustrated.length)return null
  return <PhotoRail title="Your stops in photos" description="Select a place to open its photos, videos and visit details." count={illustrated.length}>
    {illustrated.map(place=><article className="photo-rail-tile" key={place.url}>
      <PlacePhoto place={place} hideUnavailable onOpen={()=>onSelect(place)} onUnavailable={()=>setFailed(current=>new Set([...current,place.url]))}/>
      <Button variant="text-btn" onClick={()=>onSelect(place)}>{place.name}</Button>
    </article>)}
  </PhotoRail>
}

function PreferencesEditor({draft, save, onClose}) {
  const [modes, setModes] = useState(draft.localModes || [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    const values = Object.fromEntries(new FormData(event.currentTarget))
    setError('')
    setBusy(true)
    try {
      await save(draftPreferences(draft, {...values, localModes: modes}))
    } catch (failure) {
      setError(failure.message)
    } finally {
      setBusy(false)
    }
  }
  return <section className="trip-overview-glass trip-overview-section">
    <div className="trip-overview-section-head">
      <div><h2>Trip preferences</h2><p>Dates, budget, and how you want to travel.</p></div>
      <IconButton icon="close" label="Close trip preferences" onClick={onClose}/>
    </div>
    <form className="trip-overview-preferences" onSubmit={submit}>
      <label>Departure city<input name="origin" maxLength={100} defaultValue={draft.origin || ''}/></label>
      <label>Departure date<input name="departure" type="date" defaultValue={draft.departure || ''}/></label>
      <label>Travelers<input name="travelers" type="number" required min={1} max={8} defaultValue={draft.travelers}/></label>
      <label>Group budget (₹)<input name="budget" type="number" min={1000} max={10000000} step={1} defaultValue={draft.budget ?? ''}/></label>
      <label>Food preference<select name="mealPreference" defaultValue={draft.mealPreference}>{mealOptions.map(option => <option key={option}>{option}</option>)}</select></label>
      <label>Travel pace<select name="pace" defaultValue={draft.pace}>{paceOptions.map(option => <option key={option}>{option}</option>)}</select></label>
      <fieldset><legend>Preferred transport</legend>
        <div className="trip-overview-pills">{transportModes.map(mode => <Pill key={mode} active={modes.includes(mode)} onClick={() =>
          setModes(previous => previous.includes(mode) ? previous.filter(item => item !== mode) : [...previous, mode])}>{mode}</Pill>)}</div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <Button type="submit" variant="primary" icon="check" disabled={busy}>{busy ? 'Saving…' : 'Save preferences'}</Button>
    </form>
  </section>
}

function PersonalList({tripId, kind}) {
  const packing = kind === 'packing'
  const label = packing ? 'Packing list' : 'Trip journal'
  const storageKey = 'yatra.trip.' + tripId + '.' + kind
  const [entries, setEntries] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return Array.isArray(saved) ? saved : []
    } catch { return [] }
  })
  const [value, setValue] = useState('')
  const [status, setStatus] = useState('')

  function persist(next) {
    setEntries(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setStatus('')
    } catch {
      setStatus('This browser could not save the change for your next visit.')
    }
  }
  function add(event) {
    event.preventDefault()
    const text = value.trim()
    if (!text || entries.length >= 100) return
    persist([...entries, {id: crypto.randomUUID(), text, checked: false, date: new Date().toISOString()}])
    setValue('')
  }
  return <section className="trip-overview-glass trip-overview-section trip-overview-personal">
    <div className="trip-overview-section-head">
      <div><h2>{label}</h2><p>Private to this browser.</p></div>
      {packing ? <TravelArtwork name="packing-traveler" className="packing-heading-art" width={190} height={190}/> : <NotebookPen size={23} aria-hidden="true"/>}
    </div>
    {packing && entries.length > 0 && <p>{entries.filter(entry => entry.checked).length} of {entries.length} packed</p>}
    <form className="trip-overview-entry-form" onSubmit={add}>
      {packing ? <input aria-label="Packing item" value={value} onChange={event => setValue(event.target.value)}
        maxLength={120} placeholder="Add something to pack"/> :
        <textarea aria-label="Journal note" value={value} onChange={event => setValue(event.target.value)}
          maxLength={1800} rows={3} placeholder="Write a trip note"/>}
      <Button type="submit" variant="primary" icon="plus" disabled={!value.trim() || entries.length >= 100}>{packing ? 'Add item' : 'Save note'}</Button>
    </form>
    {entries.length === 100 && <p>Remove an entry to add another.</p>}
    {status && <p role="status">{status}</p>}
    {entries.length > 0 && <ul className="trip-overview-entries">
      {entries.map(entry => <li key={entry.id}>
        {packing ? <label><input type="checkbox" checked={entry.checked} onChange={() => persist(entries.map(item =>
          item.id === entry.id ? {...item, checked: !item.checked} : item))}/><span>{entry.text}</span></label> :
          <div><time dateTime={entry.date}>{formatDate(entry.date.slice(0, 10))}</time><p>{entry.text}</p></div>}
        <IconButton icon="trash" label={packing ? 'Remove ' + entry.text : 'Remove journal note'} onClick={() => persist(entries.filter(item => item.id !== entry.id))}/>
      </li>)}
    </ul>}
  </section>
}

function StayOptions({draft, nearby, onSelect, onEdit, retry}) {
  const stays = (nearby.data?.places || []).filter(place => place.category === 'Stay' && place.url !== draft.stay?.url)
  return <section className="trip-overview-glass trip-overview-section">
    <div className="trip-overview-section-head">
      <div><h2>Find a stay</h2><p>Check dates and rates with the property.</p></div>
      <Icon name="bed" size={23}/>
    </div>
    {draft.stay && <article className="trip-overview-current-stay">
      <div><small>Planned stay</small><h3>{draft.stay.name}</h3></div>
      <PlacePhoto key={draft.stay.url} place={draft.stay} lookup hideUnavailable className="trip-overview-current-stay-photo"/>
      <Button icon="map" onClick={() => onSelect(draft.stay)}>Show on map</Button>
    </article>}
    {nearby.loading && <AgentProgress label="Looking up nearby stays and photos"/>}
    {nearby.error && <p role="status">{nearby.error} <Button onClick={retry}>Retry</Button></p>}
    {!nearby.loading && !nearby.error && !stays.length && <p>Open the trip planner to search for other accommodation.</p>}
    <div className="trip-overview-stays">
      {stays.slice(0, 8).map(place => <article key={place.url}>
        <PlacePhoto place={place} lookup hideUnavailable/>
        <div><h3>{place.name}</h3><p>{place.address || place.source}</p>
          {place.publishedPrice && <p>Published price · {place.publishedPrice}</p>}
          <div className="trip-overview-pills">
            <Button icon="pin" onClick={() => onSelect(place)}>Map & details</Button>
            <SourcePill url={place.website || place.url} label={place.website ? 'Property website' : place.source}/>
          </div>
        </div>
      </article>)}
    </div>
    {onEdit && <Button icon="edit" onClick={onEdit}>{draft.stay ? 'Change stay in planner' : 'Choose a stay in planner'}</Button>}
  </section>
}

function PrintItinerary({draft}) {
  return <section className="trip-overview-print">
    <h1>Trip to {draft.name}</h1>
    <p>{formatDate(draft.departure)} · {draft.travelers} {draft.travelers === 1 ? 'traveler' : 'travelers'}</p>
    {draft.stay && <p>Staying at {draft.stay.name}</p>}
    {draft.days.map((_, index) => <section key={index}>
      <h2>Day {index + 1}</h2>
      <ol>{draftSchedule(draft, index).map(({place, start, end}) => <li key={place.url}>
        {visitTime(start)}–{visitTime(end)} · {place.name}
      </li>)}</ol>
      {!draft.days[index].length && <p>Free time</p>}
    </section>)}
  </section>
}

export function TripOverview({draft, initialSection, onEdit, onAsk, onPreferences, onBack}) {
  const modeKey = `yatra.travel-active.${draft.id}`
  const [section, setSection] = useState(() => {
    if (initialSection === 'invite') return 'chat'
    if (initialSection === 'travel' || shortcuts.some(([id]) => id === initialSection)) return initialSection
    try { if (localStorage.getItem(modeKey)) return 'travel' } catch {}
    return 'overview'
  })
  const [invite, setInvite] = useState(initialSection === 'invite' ? 1 : 0)
  const [mapOpen, setMapOpen] = useMapPanel()
  const [selection, setSelection] = useState(null)
  const [query, setQuery] = useState('')
  const voice = useVoiceInput({continuous:false, onTranscript:text => setQuery(current => [current.trim(), text].filter(Boolean).join(' ').slice(0,600))})
  const [status, setStatus] = useState('')
  const [nearby, setNearby] = useState({})
  const [attempt, setAttempt] = useState(0)
  const [savedMedia, setSavedMedia] = useState([])
  const [roomDraft, setRoomDraft] = useState(null)
  const mediaSaving = useRef(new Set())
  const sectionHeading = useRef(null)
  const mapToggle = useRef(null)
  const active = roomDraft?.updated > draft.updated ? roomDraft : draft
  const stops = active.days.flat()
  const cover = [active.stay, ...stops].find(place => place?.photo?.url) || stops[0]
  const title = section === 'travel' ? 'Travel Mode' : shortcuts.find(([id]) => id === section)?.[1]
  const mapVisible = mapOpen && (['overview', 'itinerary'].includes(section) || Boolean(selection))
  const findPlaces = section === 'stays' || section === 'ideas'
  const map = useMemo(() => draftMapData(active), [active])
  const pin = selection ? map.places.find(place => place.url === selection.url) || selection : null
  const mapPlaces = pin && !map.places.some(place => mapPlaceId(place) === mapPlaceId(pin)) ? [...map.places, pin] : map.places

  useEffect(() => {
    if (!findPlaces) return
    const controller = new AbortController()
    setNearby({loading: true})
    request(`locations/${active.cityId}/nearby?` + new URLSearchParams({meal: active.mealPreference || 'No preference'}), {signal: controller.signal})
      .then(data => {
        if (!controller.signal.aborted) setNearby(data.status === 'unavailable' && !data.places?.length
          ? {error: 'Nearby sources are temporarily unavailable.'} : {data})
      })
      .catch(error => { if (!controller.signal.aborted) setNearby({error: error.message}) })
    return () => controller.abort()
  }, [active.cityId, active.mealPreference, attempt, findPlaces])

  function open(next, showInvite = false) {
    setSection(next)
    if (showInvite) setInvite(value => value + 1)
    setSelection(null)
    setStatus('')
    try {
      if (next === 'travel') localStorage.setItem(modeKey, '1')
      else localStorage.removeItem(modeKey)
    } catch {}
    revealResult(()=>sectionHeading.current,{focus:true})
  }

  function select(place) {
    setSelection(place)
  }

  function sync(next) {
    setRoomDraft(previous => previous && previous.updated >= next.updated ? previous : next)
    if (next.updated > draft.updated) onPreferences?.(next)
  }

  async function updatePreferences(next) {
    const room = await request('trip-workspaces', {method: 'POST', body: active})
    const {origin, departure, travelers, budget, mealPreference, pace, localModes} = next
    try {
      const result = await request(`trip-workspaces/${room.id}/preferences`, {method: 'PATCH', body: {
        expectedUpdated: active.updated, origin, departure, travelers, budget, mealPreference, pace, localModes,
      }})
      sync(result.draft)
      setStatus('Trip preferences saved.')
    } catch (failure) {
      if (failure.status === 409) {
        const latest = await request(`trip-workspaces/${room.id}`).catch(() => null)
        if (latest) {
          sync(latest.draft)
          setStatus(failure.message)
        }
      }
      throw failure
    }
  }

  async function saveMedia(item) {
    if (!selection || mediaSaving.current.has(item.sourceUrl)) return
    const place = selection.name
    mediaSaving.current.add(item.sourceUrl)
    try {
      const room = await request('trip-workspaces', {method: 'POST', body: active})
      if (!room.entries.some(entry => entry.kind === 'media' && entry.sourceUrl === item.sourceUrl)) {
        await request(`trip-workspaces/${room.id}/entries`, {method: 'POST', body: {
          kind: 'media', title: item.title.slice(0, 220), url: item.url, place,
          thumbnail: item.thumbnail, sourceUrl: item.sourceUrl, license: item.license,
          licenseUrl: item.licenseUrl, credit: item.author || item.credit || '',
        }})
      }
      setSavedMedia(previous => [...previous, item])
      setStatus('Saved to trip photos and videos.')
    } catch (failure) {
      setStatus(failure.message)
    } finally {
      mediaSaving.current.delete(item.sourceUrl)
    }
  }

  const suggestedIdeas = (nearby.data?.places || []).filter(place =>
    place.category !== 'Stay' && !stops.some(stop => stop.url === place.url))

  return <article className="page trip-overview" data-section={section}>
    <header className="trip-overview-header trip-overview-glass">
      <div className="trip-overview-heading">
        {cover && <PlacePhoto place={cover} compact lookup className="trip-overview-cover"/>}
        <div>
        {onBack && <Button variant="text-btn" icon="back" onClick={onBack}>My trips</Button>}
        <h1>Trip to {active.name}</h1>
        <p>{[active.region !== active.name && active.region, active.country].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div className="trip-overview-actions">
        {section !== 'travel' && <Button ref={mapToggle} icon="map" aria-pressed={mapVisible} onClick={() => {
          if (!mapVisible && !selection && !['overview', 'itinerary'].includes(section)) open('itinerary')
          setMapOpen(!mapVisible)
        }}>{mapVisible ? 'Hide map' : 'Show map'}</Button>}
        <Button icon="download" onClick={() => window.print()}>Print / PDF</Button>
        {section !== 'travel' && <Button icon="users" onClick={() => open('chat', true)}>Invite teammates</Button>}
        <Button icon="compass" variant="primary" aria-pressed={section === 'travel'} onClick={() => open(section === 'travel' ? 'overview' : 'travel')}>
          {section === 'travel' ? 'Exit Travel Mode' : 'Travel Mode'}
        </Button>
      </div>
    </header>
    <div className="trip-overview-layout" data-map-open={mapVisible}>
      {section !== 'travel' && <nav className="trip-overview-shortcuts" aria-label="Trip sections">
        {shortcuts.map(([id, label, glyph]) => <button key={id} type="button" aria-pressed={section === id} onClick={() => open(id)}>
          {typeof glyph === 'string' ? <Icon name={glyph} size={17}/> : React.createElement(glyph, {size:17, 'aria-hidden':true})}
          <span>{label}</span>{id === 'itinerary' && <small>{stops.length}</small>}
        </button>)}
      </nav>}
      <section className="trip-overview-main" aria-label="Trip planning tools">
        {!['travel', 'itinerary'].includes(section) && <header className="trip-section-title" key={section} tabIndex={-1} ref={sectionHeading}>
          <h2>{section === 'media' ? 'Photos, videos & memories' : title}</h2>
          {section === 'calendar' && <Button icon="download" disabled={!active.departure}
            title={!active.departure ? 'Set a departure date in trip preferences' : undefined} onClick={() => exportCalendar(active)}>Export calendar</Button>}
        </header>}
        {section === 'overview' && <>
          <section className="trip-overview-glass trip-overview-intro">
            <h2>{active.days.length} {active.days.length === 1 ? 'day' : 'days'} in {active.name}</h2>
            <p>{stops.length} planned {stops.length === 1 ? 'stop' : 'stops'}{active.origin ? ' · Departing from ' + active.origin : ''}</p>
            {active.stay && <button type="button" className="trip-overview-stay-preview" onClick={() => select(active.stay)}>
              <PlacePhoto place={active.stay} compact lookup className="trip-overview-stay-thumb"/>
              <span><small>Suggested stay</small><strong>{active.stay.name}</strong>
                {Number.isFinite(active.stay.rating) && <small>★ {active.stay.rating.toFixed(1)} / 5{active.stay.reviewCount ? ` · ${active.stay.reviewCount} reviews` : ''}</small>}
                {active.stay.publishedPrice && <small>{active.stay.publishedPrice}</small>}</span>
            </button>}
            <div className="trip-overview-actions">
              <Button variant="primary" icon="map" onClick={() => open('itinerary')}>View itinerary</Button>
              <Button icon="heart" onClick={() => open('ideas')}>Find more ideas</Button>
              {onEdit && <Button icon="edit" onClick={onEdit}>Edit plan</Button>}
            </div>
          </section>
          <TravelBudget draft={active}/>
          <DestinationBrief location={active} compact/>
          <TripPhotoReferences key={active.id} draft={active} stops={stops} onSelect={select}/>
        </>}
        {section === 'preferences' && <PreferencesEditor key={active.id + ':' + active.updated} draft={active} save={updatePreferences} onClose={() => open('overview')}/>}
        {section === 'transport' && <div className="trip-overview-glass trip-overview-section"><TripTransport draft={active} onAsk={onAsk && (text => onAsk(text, active.id))}/></div>}
        {section === 'stays' && <StayOptions draft={active} nearby={nearby} onSelect={select} onEdit={onEdit} retry={() => setAttempt(value => value + 1)}/>}
        {['packing', 'journal'].includes(section) && <PersonalList key={section} kind={section} tripId={active.id}/>}
        <div className="trip-overview-content"
          ref={['itinerary','travel'].includes(section) ? sectionHeading : undefined} tabIndex={['itinerary','travel'].includes(section) ? -1 : undefined}>
        {workspaceTabs.has(section) && <div className="trip-overview-room" aria-label={title}>
          {section === 'ideas' && nearby.loading && <AgentProgress label="Finding places and photos for this trip"/>}
          {section === 'ideas' && nearby.error && <p role="status">{nearby.error} <Button onClick={() => setAttempt(value => value + 1)}>Retry</Button></p>}
          <TripWorkspace draft={active} initialTab={section} initialInvite={section === 'chat' ? invite : 0} embedded onTabChange={next => open(next)}
            onInviteClose={() => setInvite(0)}
            ideas={suggestedIdeas} onPlaceSelect={select} onEdit={onEdit} onDraftUpdate={sync}/>
        </div>}
        </div>
        {onAsk && ['overview','itinerary'].includes(section) && <form className="trip-overview-composer" onSubmit={event => {
          event.preventDefault()
          const text = query.trim()
          if (text) {voice.stop();onAsk(text, active.id)}
        }}>
          <Icon name="sparkle" size={21}/>
          <input aria-label="Ask about this trip" placeholder="Ask about this trip…" maxLength={600} value={query}
            onChange={event => setQuery(event.target.value)}/>
          <DictationControl voice={voice}/>
          <IconButton type="submit" icon="up" label="Ask YatraBuddy" disabled={!query.trim()}/>
        </form>}
        {voice.error && <p className="form-note" role="status">{voice.error}</p>}
        {status && <p className="trip-overview-status" role="status">{status}</p>}
      </section>
      {mapVisible && <aside className="trip-overview-context" aria-label="Trip map panel">
        <div className="trip-overview-map-frame">
          <JourneyMap center={map.center} places={mapPlaces} routes={map.routes} selectedId={pin && mapPlaceId(pin)}
            compactControls onSelect={select} onClose={() => {setMapOpen(false);mapToggle.current?.focus({preventScroll:true})}}/>
        </div>
      </aside>}
    </div>
    {selection && <Dialog label={selection.name} className="discovery-details-dialog" onClose={() => setSelection(null)}>
      <PlaceDetails key={mapPlaceId(selection)} place={selection}
        onShowMap={() => {if (!['overview', 'itinerary'].includes(section)) open('itinerary'); setMapOpen(true); setSelection(null)}}
        onSaveMedia={saveMedia} savedMedia={savedMedia}/>
    </Dialog>}
    <PrintItinerary draft={active}/>
  </article>
}
