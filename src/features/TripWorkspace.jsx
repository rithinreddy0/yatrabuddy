import React, {useEffect, useId, useRef, useState} from 'react'
import {revealResult} from '../components/revealResult.mjs'
import {request} from '../api.mjs'
import {AgentProgress, Button, Dialog, Icon, IconButton, SourcePill} from '../components/UI.jsx'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {money} from '../planner.mjs'
import {draftSchedule, visitTime} from './draftSchedule.mjs'
import {JourneyMap, draftMapData} from './JourneyMap.jsx'
import {TravelMode} from './TravelMode.jsx'
import './TripWorkspace.css'

const path = 'trip-workspaces'
const tabs = [
  ['travel', 'Travel Mode', 'compass'],
  ['itinerary', 'Itinerary', 'map'],
  ['ideas', 'Ideas', 'heart'],
  ['bookings', 'Bookings', 'trip'],
  ['calendar', 'Calendar', 'calendar'],
  ['chat', 'Group chat', 'chat'],
  ['media', 'Memories', 'link'],
]
const mediaTypes = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,application/pdf'
const formatDate = new Intl.DateTimeFormat(undefined, {weekday:'short', month:'short', day:'numeric', timeZone:'UTC'})
const formatTimestamp = new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'})

function dayLabel(departure, index) {
  if (!departure) return `Day ${index + 1}`
  const date = new Date(departure + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + index)
  return formatDate.format(date)
}

function dateForDay(departure, index) {
  if (!departure) return null
  const date = new Date(departure + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + index)
  return date.toISOString().slice(0, 10)
}

function weatherCondition(code) {
  if (code === 0) return 'Clear'
  if (code <= 3) return 'Cloudy'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 86) return 'Showers'
  return 'Thunderstorms'
}

const rainCodes = new Set([51, 53, 55, 61, 63, 65, 80, 81, 82, 95, 96, 99])

function readPinnedDays() {
  try {
    const saved = JSON.parse(localStorage.getItem('yatra.trip-day-pins') || '{}')
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {}
    return Object.fromEntries(Object.entries(saved).map(([id, days]) => [id,
      Array.isArray(days) ? days.filter(day => Number.isInteger(day) && day >= 0 && day < 5) : []]))
  } catch { return {} }
}

function mediaUrl(url) {
  if (!url) return null
  let parsed
  try {parsed = new URL(url)} catch {return null}
  if (parsed.protocol !== 'https:') return null
  if (parsed.hostname === 'upload.wikimedia.org') {
    if (/\.(?:webm|mp4)(?:$|\/)/i.test(parsed.pathname)) return {url, type:'video'}
    if (/\.(?:jpg|jpeg|png|gif|webp)(?:$|\/)/i.test(parsed.pathname)) return {url, type:'image'}
  }
  if (['www.youtube.com', 'youtube.com', 'youtu.be', 'm.youtube.com'].includes(parsed.hostname)) {
    const id = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1)
      : parsed.searchParams.get('v') || parsed.pathname.match(/^\/shorts\/([\w-]{11})\/?$/)?.[1]
    if (/^[\w-]{11}$/.test(id || '')) return {url:'https://www.youtube-nocookie.com/embed/' + id, type:'youtube'}
  }
  return null
}

function MediaPreview({entry}) {
  const [play, setPlay] = useState(false)
  const [imageFailed, setImageFailed] = useState(false)
  const preview = entry.attachment ? {
    url:entry.attachment, type:entry.attachmentType?.split('/')[0],
  } : mediaUrl(entry.url)
  if (preview?.type === 'image' && !imageFailed) {
    return <img className="trip-room-media-preview" src={preview.url} alt={entry.title}
      loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)}/>
  }
  if (preview?.type === 'video') return <video className="trip-room-media-preview" controls preload="none"
    poster={mediaUrl(entry.thumbnail)?.type === 'image' ? entry.thumbnail : undefined} src={preview.url}/>
  if (preview?.type === 'youtube') {
    return play
      ? <iframe className="trip-room-media-preview" title={entry.title} src={preview.url} allow="fullscreen; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin"/>
      : <Button icon="arrow" onClick={() => setPlay(true)}>Play video</Button>
  }
  return null
}

async function upload(workspace, entry, file) {
  const body = new Blob([JSON.stringify(entry), '\n', file], {type:'application/octet-stream'})
  const response = await fetch(`/api/${path}/${workspace}/files`, {
    method:'POST', body, credentials:'same-origin', signal:AbortSignal.timeout(25000),
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail :
    response.status === 413 ? 'This connection rejected the file size. Try a smaller file or add a link.' : 'The upload could not be saved.')
  return data
}

function EntryForm({kind, places, defaultPlace, onSave, onClose, busy, current}) {
  const placeListId = useId()
  const [title, setTitle] = useState(current?.title || '')
  const [file, setFile] = useState(null)
  const isMedia = kind === 'media'
  const isBooking = kind === 'booking'
  function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const amount = form.get('amount')
    const entry = {
      kind, title:title.trim(), place:form.get('place')?.trim() || null,
      url:form.get('url')?.trim() || null, notes:form.get('notes')?.trim() || '',
      date:form.get('date') || null, time:form.get('time') || null, amount:amount ? Number(amount) : null,
    }
    onSave(entry, file)
  }
  return <form className="trip-room-form" onSubmit={submit}>
    <label>{isMedia ? 'Title' : isBooking ? 'Booking name' : 'Place or idea'}
      <input required maxLength={220} value={title} onChange={event => setTitle(event.target.value)}
        placeholder={isMedia ? 'Give it a name' : isBooking ? 'Hotel, train, or activity' : 'A place to visit'}/>
    </label>
    <label>{isMedia ? 'Photo, video, or post link' : 'Source link'}<input type="url" name="url" defaultValue={current?.url || ''} placeholder="https://…" maxLength={2048} required={isMedia && !file}/></label>
    {isMedia && <label>Place<input name="place" maxLength={220} placeholder="Where this belongs"
      list={placeListId} defaultValue={defaultPlace || ''}/><datalist id={placeListId}>
      {places.map(place => <option key={place} value={place}/>)}
    </datalist></label>}
    {isBooking && <div className="trip-room-form-row">
      <label>Booking date<input name="date" type="date" defaultValue={current?.date || ''} onChange={event => {
        if (!event.target.value) event.target.form.elements.time.value = ''
      }}/></label>
      <label>Local time<input name="time" type="time" defaultValue={current?.time?.slice(0, 5) || ''}/></label>
      <label>Location or meeting point<input name="place" defaultValue={current?.place || ''} maxLength={220}/></label>
      <label>Amount (₹)<input name="amount" type="number" defaultValue={current?.amount ?? ''} min={0} max={10000000} step={1}/></label>
    </div>}
    {(isMedia || isBooking) && !current && <label>{isBooking ? 'Receipt or confirmation' : 'Upload a file'} <span className="trip-room-muted">(up to 12 MB)</span>
      <input type="file" accept={isMedia ? mediaTypes : 'image/jpeg,image/png,image/webp,image/gif,application/pdf'}
        onChange={event => {
          const next = event.target.files[0]
          setFile(next || null)
          if (next && !title) setTitle(next.name.slice(0, 220))
        }}/>
    </label>}
    {!isMedia && <label>Notes<textarea name="notes" rows={2} defaultValue={current?.notes || ''} maxLength={2000} placeholder={isBooking ? 'Reference number, check-in details…' : 'What makes it worth a visit?'}/></label>}
    <div className="trip-room-actions">
      <Button onClick={onClose} disabled={busy}>Cancel</Button>
      <Button type="submit" variant="primary" disabled={busy || !title.trim()}>{busy ? 'Saving…' : 'Save'}</Button>
    </div>
  </form>
}

const categoryIcons = {Food:'food', Stay:'bed', Nature:'compass', Activity:'sparkle', Shopping:'trip', Sight:'pin'}
const itinerarySources = new Set(['Wikipedia', 'Wikivoyage', 'OpenStreetMap'])

function StopThumbnail({place}) {
  return <div className="trip-room-stop-thumb"><PlacePhoto place={place} lookup hideUnavailable/></div>
}

function PlacePicker({draft, used, title, onClose, onPick, busy, errorText, excludeUrl}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [onlineResults, setOnlineResults] = useState(null)
  const [looking, setLooking] = useState(false)
  const [onlineError, setOnlineError] = useState('')
  const search = useRef(null)
  useEffect(() => {
    const controller = new AbortController()
    const params = new URLSearchParams({meal: draft.mealPreference || 'No preference'})
    request(`locations/${draft.cityId}/nearby?${params}`, {signal:controller.signal}).then(report => {
      if (controller.signal.aborted) return
      if (report.status === 'unavailable' && !report.places?.length) {
        setError('Nearby sources are temporarily unavailable.')
        return
      }
      setResults(report.places || [])
    }).catch(failure => {
      if (!controller.signal.aborted) setError(failure.message)
    })
    return () => controller.abort()
  }, [draft.cityId, draft.mealPreference, attempt])
  useEffect(() => () => search.current?.abort(), [])

  function updateQuery(value) {
    search.current?.abort()
    setQuery(value)
    setLooking(false)
    setOnlineResults(null)
    setOnlineError('')
  }

  async function searchPlaces(event) {
    event.preventDefault()
    const terms = query.trim()
    if (terms.length < 2 || looking) return
    const controller = new AbortController()
    search.current = controller
    setLooking(true)
    setOnlineError('')
    try {
      const params = new URLSearchParams({q: terms, location_id: draft.cityId, category: 'all'})
      const report = await request(`places/search?${params}`, {signal:controller.signal})
      if (controller.signal.aborted) return
      if (report.status === 'unavailable' && !report.places?.length) {
        setOnlineError('Place sources are temporarily unavailable. Try again shortly.')
        return
      }
      setOnlineResults(report.places || [])
    } catch (failure) {
      if (!controller.signal.aborted) setOnlineError(failure.message)
    } finally {
      if (!controller.signal.aborted) setLooking(false)
    }
  }

  const needle = query.trim().toLocaleLowerCase()
  const localMatches = (results || []).filter(place => !needle || [place.name, place.category, place.address]
    .some(value => value?.toLocaleLowerCase().includes(needle)))
  const matches = new Map([...localMatches, ...(onlineResults || [])].filter(place => place.category !== 'Stay' &&
    itinerarySources.has(place.source) && Number.isFinite(place.lat) && Number.isFinite(place.lon) &&
    place.url !== excludeUrl && !used.has(place.url))
    .map(place => [place.url, place]))
  const candidates = [...matches.values()]
  return <Dialog label={title} className="trip-room-picker" onClose={onClose}>
    <h2>{title}</h2>
    <form className="trip-room-picker-query" onSubmit={searchPlaces}>
      <label className="trip-room-picker-search">Search places in {draft.name}
        <input autoFocus type="search" value={query} onChange={event => updateQuery(event.target.value)} placeholder="Name or category"/>
      </label>
      <Button type="submit" icon="search" disabled={busy || looking || needle.length < 2}>Search sources</Button>
    </form>
    {((!results && !error) || looking) && <AgentProgress label="Finding nearby places and photos"/>}
    {error && <p role="alert">{error} <Button onClick={() => {setError('');setAttempt(value => value + 1)}}>Retry</Button></p>}
    {errorText && <p role="alert" className="form-error">{errorText}</p>}
    {onlineError && <p role="alert" className="form-error">{onlineError}</p>}
    {!looking && (results || onlineResults) && !candidates.length && <p className="trip-room-muted">
      {needle && !onlineResults ? 'Try searching public sources for this place.' : 'No matching places in this search.'}
    </p>}
    <ul className="trip-room-picker-results">{candidates.slice(0, 30).map(place => <li key={place.url}>
      <StopThumbnail place={place}/>
      <span><strong>{place.name}</strong><small>{place.category} · {place.source}</small></span>
      <Button disabled={busy} onClick={() => onPick(place)} icon={excludeUrl ? 'check' : 'plus'}>{busy ? 'Saving…' : excludeUrl ? 'Replace' : 'Add'}</Button>
    </li>)}</ul>
  </Dialog>
}

function Itinerary({draft, onPlaceSelect, onEdit, onAddStop, onRemoveStop, onReplaceStop, busy, ideas, onIdeas, pinnedDays=[], onTogglePinDay}) {
  const [showDistances, setShowDistances] = useState(true)
  const [picker, setPicker] = useState(null)
  const [mapDay, setMapDay] = useState(null)
  const [pickerError, setPickerError] = useState('')
  const [replacing, setReplacing] = useState(false)
  const map = draftMapData(draft)
  const used = new Set(draft.days.flat().map(place => place.url))
  return <div className="trip-room-itinerary">
    <div className="trip-room-section-heading">
      <h2>Itinerary <small>{draft.days.length} {draft.days.length === 1 ? 'day' : 'days'}</small></h2>
      <div className="trip-room-actions">
        <Button aria-pressed={showDistances} onClick={() => setShowDistances(value => !value)}>{showDistances ? 'Hide distances' : 'Show distances'}</Button>
        {onEdit && <Button icon="edit" disabled={busy} onClick={onEdit}>Edit plan</Button>}
      </div>
    </div>
    <p className="trip-room-muted">Visit times are suggested. Confirm opening hours and prices before you go.</p>
    <button className="trip-room-idea-shortcut" onClick={onIdeas} type="button">
      <Icon name="heart" size={20}/><span><strong>Ideas</strong><small>{ideas.length ? `${ideas.length} saved for later` : 'Save places you’re considering'}</small></span>
      <Icon name="chevron" size={16}/>
    </button>
    {draft.days.map((stops, index) => {
      const pinned = pinnedDays.includes(index)
      const schedule = draftSchedule(draft, index)
      const legs = draft.routes?.[index] || []
      const travelMinutes = legs.reduce((total, leg) => total + leg.minutes, 0)
      const travelDistance = legs.reduce((total, leg) => total + leg.kilometres, 0)
      const enteredCost = stops.reduce((total, place) => total + (draft.stopCosts?.[place.url] ?? 0), 0)
      const unpricedStops = stops.filter(place => draft.stopCosts?.[place.url] == null).length
      const timing = schedule.length ? `${visitTime(schedule[0].start)} – ${visitTime(schedule.at(-1).end)}` : 'No visits scheduled'
      const forecast = draft.weather?.find(item => item.date === dateForDay(draft.departure, index))
      const weatherText = forecast
        ? `${weatherCondition(forecast.code)} · ${Math.round(forecast.low)}–${Math.round(forecast.high)}°C${forecast.rainProbability == null ? '' : ` · ${forecast.rainProbability}% rain`}`
        : draft.weatherStatus === 'not_requested' ? 'Weather not checked' : draft.weatherNote || 'Forecast unavailable for this day'
      const rainLikely = Boolean(forecast && (rainCodes.has(forecast.code) || forecast.rainProbability >= 60))
      const outdoorStops = rainLikely ? stops.filter(place => place.category === 'Nature') : []
      return <details key={index} className="trip-room-day" open={index === 0 || pinned || undefined} data-pinned={pinned || undefined}>
      <summary><strong>Day {index + 1}</strong><span>{draft.departure ? dayLabel(draft.departure, index) : 'Date flexible'}</span>
        <small>{stops.length ? stops.slice(0, 2).map(place => place.name).join(' · ') : 'Free time'}</small>
        {pinned && <small className="trip-room-pinned-badge">Pinned on this device</small>}</summary>
      <div className="trip-room-day-summary" aria-label={`Day ${index + 1} timing and totals`}>
        <span><small>Visit window</small><strong>{timing}</strong></span>
        <span><small>Local travel</small><strong>{legs.length ? `${travelDistance.toFixed(1)} km · ${travelMinutes} min` : 'No route estimate'}</strong></span>
        <span><small>Entered costs</small><strong>{money(enteredCost)}{unpricedStops ? ` · ${unpricedStops} unpriced` : ''}</strong></span>
        <span><small>Weather</small><strong>{weatherText}</strong></span>
      </div>
      {outdoorStops.length > 0 && <div className="trip-room-weather-alert" role="note">
        <p>Rain is forecast and may affect {outdoorStops.map(place => place.name).join(', ')}.</p>
        <Button onClick={onIdeas} icon="heart">Review alternatives</Button>
      </div>}
      <div className="trip-room-day-tools">
        <div className="trip-room-day-controls">
          {onTogglePinDay && <Button className="trip-room-pin-day" icon="pin" variant={pinned ? 'primary' : 'secondary'}
            aria-pressed={pinned} disabled={busy} title="This pin is saved in this browser only; it does not lock shared trip changes."
            onClick={() => onTogglePinDay(index)}>{pinned ? 'Pinned' : 'Pin day'}</Button>}
          {stops.length > 0 && <IconButton icon="map" label={`${mapDay === index ? 'Hide' : 'Show'} day ${index + 1} map`}
            aria-expanded={mapDay === index} onClick={() => setMapDay(mapDay === index ? null : index)}/>}
        </div>
      </div>
      {mapDay === index && <div className="trip-room-day-map"><JourneyMap
        places={map.places.filter(place => place.day === index + 1 || place.category === 'Stay')}
        routes={map.routes.filter(route => route.day === index + 1)}
        onSelect={onPlaceSelect} onClose={() => setMapDay(null)}/></div>}
      <ol>{schedule.map(({place, from, leg, start, end, duration}) => <li key={place.url}>
        {showDistances && leg && <div className="trip-room-leg">
          <span>{leg.kilometres} km · {leg.minutes} min {leg.method === 'road' ? 'driving estimate' : 'estimated, straight line'}</span>
          {from && <SourcePill label="Directions" url={`https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lon}&destination=${place.lat},${place.lon}`}/>}
        </div>}
        <div className="trip-room-stop">
          <div className="trip-room-stop-copy">
            <div className="trip-room-stop-title"><Icon name={categoryIcons[place.category] || 'pin'} size={15}/>
              {onPlaceSelect ? <button type="button" className="trip-room-place-button" onClick={() => onPlaceSelect(place)}>{place.name}</button> : <strong>{place.name}</strong>}
              <span className="trip-room-category-badge">{place.category}</span>
              {Number.isFinite(place.rating) && <span className="trip-room-rating">★ {place.rating.toFixed(1)} / 5{place.reviewCount ? ` · ${place.reviewCount} reviews` : ''}</span>}
            </div>
            <small><Icon name="clock" size={13}/> {visitTime(start)} – {visitTime(end)} · {duration} min suggested</small>
            <small>{draft.stopCosts?.[place.url] != null ? `${money(draft.stopCosts[place.url])} entered group cost`
              : place.publishedPrice ? `Published price: ${place.publishedPrice}` : 'Price to confirm'}</small>
            {place.address && <small>{place.address}</small>}
            {place.openingHours && <small>Published hours · {place.openingHours}</small>}
            {place.description && <p>{place.description}</p>}
          </div>
          <StopThumbnail place={place}/>
          <div className="trip-room-stop-actions">
            <SourcePill label={place.source} url={place.url}/>
            {onReplaceStop && <IconButton icon="edit" label={`Swap ${place.name} on day ${index + 1}`}
              disabled={busy || replacing} onClick={() => {setPickerError('');setPicker({day:index, replace:place})}}/>}
            {onRemoveStop && used.size > 1 && <IconButton icon="minus" label={`Remove ${place.name} from day ${index + 1}`}
              disabled={busy || replacing} onClick={() => onRemoveStop(index, place)}/>}
          </div>
        </div>
      </li>)}</ol>
      {!draft.days[index].length && <p className="trip-room-muted">Free time</p>}
        {onAddStop && <Button icon="plus" aria-label={`Add stop to day ${index + 1}`} disabled={busy || replacing || stops.length >= 5}
        onClick={() => {setPickerError('');setPicker({day:index})}}>Add stop</Button>}
    </details>})}
    {picker && <PlacePicker key={`${picker.day}:${picker.replace?.url || 'add'}`} draft={draft} used={used} excludeUrl={picker.replace?.url}
      title={picker.replace ? `Swap ${picker.replace.name} on day ${picker.day + 1}` : `Add a stop to day ${picker.day + 1}`} busy={busy || replacing}
      errorText={pickerError} onClose={() => setPicker(null)} onPick={async place => {
        try {
          setPickerError('')
          if (picker.replace) {
            setReplacing(true)
            await onReplaceStop(picker.day, picker.replace, place)
          } else await onAddStop(picker.day, place)
          setPicker(null)
        } catch (error) {setPickerError(error.message)}
        finally {setReplacing(false)}
      }}/>}
  </div>
}

function Calendar({draft, onPlaceSelect}) {
  return <div className="trip-room-calendar" aria-label="Trip calendar">
    {draft.days.map((_, index) => <section key={index} className="trip-room-calendar-day">
      <h3>{dayLabel(draft.departure, index)}</h3>
      {draftSchedule(draft, index).map(({place, start, end}) => <div key={place.url} className="trip-room-event" data-category={place.category}>
        <small>{visitTime(start)} – {visitTime(end)}</small>
        {onPlaceSelect ? <button type="button" className="trip-room-place-button" onClick={() => onPlaceSelect(place)}>{place.name}</button> : <strong>{place.name}</strong>}
      </div>)}
      {!draft.days[index].length && <p className="trip-room-muted">Free time</p>}
    </section>)}
  </div>
}

function exportMemories(draft, entries) {
  const lines = [`Trip to ${draft.name}`, draft.departure || 'Flexible dates', '']
  draft.days.forEach((day, index) => lines.push(`Day ${index + 1}`, ...day.map(place => `• ${place.name}`), ''))
  if (entries.length) lines.push('Photos and videos', ...entries.flatMap(entry => [
    [entry.title, entry.place, entry.credit, entry.license].filter(Boolean).join(' · '),
    entry.attachment ? new URL(entry.attachment, location.origin).href : entry.sourceUrl || entry.url || '', '',
  ]))
  try {
    const journal = JSON.parse(localStorage.getItem(`yatra.trip.${draft.id}.journal`) || '[]')
    if (journal.length) lines.push('Journal', ...journal.map(note => `${note.date.slice(0, 10)} · ${note.text}`))
  } catch {}
  const url = URL.createObjectURL(new Blob([lines.join('\n')], {type:'text/plain;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = url
  link.download = 'trip-memories.txt'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function WorkspaceEntries({entries, kind, ideas, media, draft, onSave, onUpdate, onRemove, onPlaceSelect, busy}) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [mediaFilter, setMediaFilter] = useState('')
  const knownPlaces = [...new Set([draft.stay?.name, ...draft.days.flat().map(place => place.name),
    ...entries.map(entry => entry.place)].filter(Boolean))].sort((a, b) => a.localeCompare(b))
  const filter = knownPlaces.includes(mediaFilter) ? mediaFilter : ''
  const shown = kind === 'media' && filter ? entries.filter(entry => entry.place === filter) : entries
  const candidates = kind === 'idea' ? ideas.filter(place => place?.name && place.url && !entries.some(entry => entry.url === place.url)) : []
  const mediaCandidates = kind === 'media' ? media.filter(item => item?.url && !entries.some(entry => entry.url === item.url)) : []
  const noun = kind === 'idea' ? 'idea' : kind === 'booking' ? 'booking' : 'media'
  return <>
    <div className="trip-room-section-heading">
      <p className="trip-room-muted">{entries.length} {kind === 'media' ? 'media items' : noun + (entries.length === 1 ? '' : 's')}</p>
      <div className="trip-room-actions">
        {kind === 'media' && <Button icon="download" onClick={() => exportMemories(draft, entries)}>Download recap</Button>}
        {!showForm && <Button icon="plus" variant="primary" onClick={() => setShowForm(true)}>Add {kind === 'media' ? 'photos or videos' : noun}</Button>}
      </div>
    </div>
    {kind === 'media' && !!knownPlaces.length && <label className="trip-room-media-filter">Filter by place
      <select value={filter} onChange={event => setMediaFilter(event.target.value)}><option value="">All places</option>
        {knownPlaces.map(place => <option key={place}>{place}</option>)}
      </select>
    </label>}
    {showForm && <EntryForm kind={kind} places={knownPlaces} defaultPlace={filter} busy={busy} onClose={() => setShowForm(false)}
      onSave={async (entry, file) => {if (await onSave(entry, file)) setShowForm(false)}}/>}
    {!entries.length && !showForm && <div className="trip-room-empty">
      <Icon name={kind === 'idea' ? 'heart' : kind === 'booking' ? 'trip' : 'link'} size={27}/>
      <p>{kind === 'idea' ? 'Keep places you’re considering.' : kind === 'booking' ? 'Keep your confirmations and receipts together.' : 'Save photos, videos, and links for the trip.'}</p>
    </div>}
    {filter && !shown.length && <p className="trip-room-muted">No media saved for {filter}.</p>}
    {shown.length > 0 && <ul className={'trip-room-entries ' + (kind === 'media' ? 'trip-room-media' : '')}>
      {shown.map(entry => <li key={entry.id}>
        <div className="trip-room-entry-heading">
          <div>
            <strong>{entry.title}</strong>
            <small>{[entry.place, entry.category, entry.date, entry.time?.slice(0, 5), entry.amount == null ? null : money(entry.amount)].filter(Boolean).join(' · ')}</small>
          </div>
          {entry.canRemove && <div className="trip-room-actions">
            {kind === 'booking' && <IconButton icon="edit" label={'Edit ' + entry.title} disabled={busy} onClick={() => setEditing(entry.id)}/>}
            <IconButton icon="trash" label={'Remove ' + entry.title} disabled={busy} onClick={() => onRemove(entry.id)}/>
          </div>}
        </div>
        {editing === entry.id && <EntryForm kind={kind} places={knownPlaces} current={entry} busy={busy} onClose={() => setEditing(null)}
          onSave={async data => {if (await onUpdate(entry.id, data)) setEditing(null)}}/>}
        {entry.notes && <p>{entry.notes}</p>}
        {kind === 'media' && <MediaPreview entry={entry}/>}
        {(entry.credit || entry.license) && <small>{entry.credit}{entry.credit && entry.license && ' · '}
          {entry.licenseUrl ? <a href={entry.licenseUrl} target="_blank" rel="noreferrer">{entry.license}</a> : entry.license}</small>}
        <div className="trip-room-actions">
          {entry.sourceUrl && entry.sourceUrl !== entry.url && <SourcePill label="Source and credits" url={entry.sourceUrl}/>}
          {entry.url && <SourcePill label={kind === 'media' ? 'Open original' : 'Open source'} url={entry.url}/>}
          {entry.attachment && <a className="source-pill" href={entry.attachment} target="_blank" rel="noreferrer"><Icon name="download" size={14}/> {kind === 'booking' ? 'Open receipt' : 'Open file'}</a>}
          {kind === 'idea' && onPlaceSelect && entry.lat != null && entry.lon != null &&
            <Button icon="pin" onClick={() => onPlaceSelect({...entry, name:entry.title})}>Show on map</Button>}
        </div>
      </li>)}
    </ul>}
    {candidates.length > 0 && <details className="trip-room-candidates"><summary>Suggestions from your search</summary>
      <ul>{candidates.slice(0, 20).map(place => <li key={place.url}>
        <span><strong>{place.name}</strong><small>{place.category}</small></span>
        <Button icon="heart" disabled={busy} onClick={() => onSave({
          kind:'idea', title:place.name, url:place.url, category:place.category, lat:place.lat, lon:place.lon,
        })}>Save idea</Button>
      </li>)}</ul>
    </details>}
    {mediaCandidates.length > 0 && <div className="trip-room-candidates">
      <h3>From your search</h3>
      <ul>{mediaCandidates.slice(0, 20).map(item => {
        const title = item.title || item.name || item.place || (item.type === 'video' ? 'Travel video' : 'Travel photo')
        return <li key={item.url}>
          <span><strong>{title}</strong><small>{item.place || item.license}</small></span>
          <Button icon="plus" disabled={busy} onClick={() => onSave({
            kind:'media', title:title.slice(0, 220), url:item.url, place:item.place, thumbnail:item.thumbnail,
            sourceUrl:item.sourceUrl, license:item.license, licenseUrl:item.licenseUrl, credit:item.author || item.credit || '',
          })}>Save media</Button>
        </li>
      })}</ul>
    </div>}
  </>
}

function GroupChat({workspace, busy, onSave, onRemove, onNameChange}) {
  const [message, setMessage] = useState('')
  const [editingName, setEditingName] = useState(false)
  const bottom = useRef(null)
  const followMessages = useRef(true)
  const entries = workspace.entries.filter(entry => entry.kind === 'message')
  useEffect(() => {
    const viewport = bottom.current?.parentElement
    if (viewport && followMessages.current) {
      viewport.scrollTop = viewport.scrollHeight
    }
  }, [entries.length])
  return <div className="trip-room-chat">
    <div className="trip-room-section-heading">
      <div className="trip-chat-members" aria-label="Trip members">{workspace.members.map((member, index) => <span key={index}>{member}</span>)}</div>
      <Button icon="edit" onClick={() => setEditingName(value => !value)}>Display name</Button>
    </div>
    {editingName && <form className="trip-room-compose" onSubmit={async event => {
      event.preventDefault()
      const name = new FormData(event.currentTarget).get('name')
      if (await onNameChange(name)) setEditingName(false)
    }}>
      <input aria-label="Display name" name="name" required maxLength={70} placeholder="Your name"/>
      <Button type="submit" disabled={busy}>Save</Button>
    </form>}
    <div className="trip-room-messages" role="log" aria-label="Trip group messages" onScroll={event => {
      const viewport = event.currentTarget
      followMessages.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 130
    }}>
      {!entries.length && <p className="trip-room-muted">Start a conversation with your travel group.</p>}
      {entries.map(entry => <div className={'trip-room-message' + (entry.mine ? ' mine' : '')} key={entry.id}>
        <div><strong>{entry.author}</strong><time dateTime={entry.created}>{formatTimestamp.format(new Date(entry.created))}</time>
          {entry.canRemove && <IconButton icon="trash" label="Remove message" disabled={busy} onClick={() => onRemove(entry.id)}/>}
        </div>
        <p>{entry.notes}</p>
      </div>)}
      <div ref={bottom}/>
    </div>
    <form className="trip-room-compose" onSubmit={async event => {
      event.preventDefault()
      if (await onSave({kind:'message', notes:message.trim()})) {
        setMessage('')
        if (bottom.current?.parentElement) bottom.current.parentElement.scrollTop = bottom.current.parentElement.scrollHeight
      }
    }}>
      <input aria-label="Group message" placeholder="Message the group…" maxLength={2000} value={message} onChange={event => setMessage(event.target.value)}/>
      <Button type="submit" variant="primary" icon="up" disabled={busy || !message.trim()}>Send</Button>
    </form>
  </div>
}

function InviteDialog({workspace, onClose, onRefresh}) {
  const [link, setLink] = useState('')
  const [active, setActive] = useState(workspace.inviteActive)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const linkInput = useRef(null)
  async function change(revoke) {
    setBusy(true)
    setStatus('')
    try {
      const result = await request(`${path}/${workspace.id}/invite`, {method:revoke ? 'DELETE' : 'POST'})
      const url = new URL(location.href)
      url.search = ''
      url.hash = result?.code ? 'join/' + result.code : ''
      setLink(result?.code ? url.href : '')
      setActive(!revoke)
      setStatus(revoke ? 'Link revoked. Existing members keep access.' : 'Link ready to share.')
      onRefresh()
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }
  return <Dialog label="Invite travelers" onClose={onClose} className="trip-room-invite">
    <div className="dialog-content">
      <h2>Invite travelers</h2>
      <p>Anyone with an active link can join this trip and contribute to the workspace.</p>
      {link && <div className="trip-room-compose">
        <input ref={linkInput} readOnly value={link} aria-label="Trip invite link" onFocus={event => event.target.select()}/>
        <Button icon="link" onClick={async () => {
          try {await navigator.clipboard.writeText(link); setStatus('Invite link copied.')}
          catch {linkInput.current?.select(); setStatus('Copy the selected invite link.')}
        }}>Copy</Button>
      </div>}
      <div className="trip-room-actions">
        {active && <Button disabled={busy} onClick={() => change(true)}>Revoke link</Button>}
        <Button variant="primary" disabled={busy} onClick={() => change(false)}>{active ? 'Replace invite link' : 'Create invite link'}</Button>
      </div>
      <p role="status" className="trip-room-muted">{status}</p>
    </div>
  </Dialog>
}

export function TripWorkspace({draft, workspaceId, inviteCode, ideas=[], media=[], initialTab='itinerary', initialInvite=false,
  onPlaceSelect, onShowMap, onEdit, onClose, onJoined, onDraftUpdate, embedded=false, onTabChange, onInviteClose}) {
  const [workspace, setWorkspace] = useState(null)
  const [preview, setPreview] = useState(null)
  const [selectedTab, setTab] = useState(() => tabs.some(([id]) => id === initialTab) ? initialTab : 'itinerary')
  const tab = embedded ? initialTab : selectedTab
  const [error, setError] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const [busy, setBusy] = useState(false)
  const [inviteOpen, setInviteOpen] = useState(initialInvite)
  const [retry, setRetry] = useState(0)
  const [joinName, setJoinName] = useState('')
  const [pinnedDaysByTrip, setPinnedDaysByTrip] = useState(readPinnedDays)
  const mutation = useRef(0)
  const reportedDraft = useRef(null)
  const panelId = useId()
  const tabStrip = useRef(null)
  const currentTripId = workspace?.draft?.id || draft?.id
  const pinnedDays = currentTripId ? pinnedDaysByTrip[currentTripId] || [] : []

  useEffect(() => {
    if (initialInvite) setInviteOpen(true)
  }, [initialInvite])

  useEffect(() => {
    try { localStorage.setItem('yatra.trip-day-pins', JSON.stringify(pinnedDaysByTrip)) }
    catch { /* Pins still show for this open workspace. */ }
  }, [pinnedDaysByTrip])

  function togglePinDay(index) {
    if (!currentTripId) return
    setPinnedDaysByTrip(previous => {
      const days = new Set(previous[currentTripId] || [])
      if (days.has(index)) days.delete(index)
      else days.add(index)
      return {...previous, [currentTripId]: [...days].sort((a, b) => a - b)}
    })
  }

  useEffect(() => {
    const controller = new AbortController()
    const route = inviteCode ? `${path}/invites/${encodeURIComponent(inviteCode)}` : workspaceId ? `${path}/${workspaceId}` : path
    setError('')
    request(route, {
      ...(draft && !workspaceId && !inviteCode ? {method:'POST', body:draft} : {}),
      signal:controller.signal,
    }).then(data => {
      if (!controller.signal.aborted) (inviteCode ? setPreview : setWorkspace)(data)
    }).catch(failure => {if (!controller.signal.aborted) setError(failure.status >= 500
      ? 'The shared workspace couldn’t connect. Your saved itinerary is still available.' : failure.message)})
    return () => controller.abort()
  }, [draft, workspaceId, inviteCode, retry])

  const roomId = workspace?.id
  const pollWorkspace = Boolean(roomId && !busy)
  useEffect(() => {
    const next = workspace?.draft
    if (!draft || !onDraftUpdate || !(next?.updated > draft.updated)) return
    const revision = `${next.id}:${next.updated}`
    if (reportedDraft.current === revision) return
    reportedDraft.current = revision
    onDraftUpdate(next)
  }, [draft, workspace?.draft, onDraftUpdate])

  useEffect(() => {
    if (!pollWorkspace) return
    let controller
    const refresh = async () => {
      if (document.hidden || controller) return
      const current = new AbortController()
      controller = current
      const revision = mutation.current
      try {
        const result = await request(`${path}/${roomId}`, {signal:current.signal})
        if (!current.signal.aborted && revision === mutation.current) {
          setWorkspace(result)
          setConnectionError('')
        }
      } catch (failure) {
        if (!current.signal.aborted && revision === mutation.current) setConnectionError(failure.message)
      } finally {
        controller = null
      }
    }
    const timer = setInterval(refresh, tab === 'chat' ? 4000 : 8000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
      controller?.abort()
    }
  }, [roomId, pollWorkspace, tab])

  async function apply(action, complete, reportError = setError) {
    mutation.current++
    setBusy(true)
    setError('')
    try {
      const result = await action()
      setWorkspace(result)
      setConnectionError('')
      complete?.(result)
      return true
    } catch (failure) {
      if (roomId && failure.status === 409) {
        const latest = await request(`${path}/${roomId}`).catch(() => null)
        if (latest) setWorkspace(latest)
      }
      reportError(failure.message)
      return false
    } finally {
      mutation.current++
      setBusy(false)
    }
  }

  async function save(entry, file) {
    if (file?.size > 12 * 1024 * 1024) {
      setError('Choose a file smaller than 12 MB.')
      return false
    }
    return apply(() => file ? upload(roomId, entry, file) : request(`${path}/${roomId}/entries`, {method:'POST', body:entry}))
  }

  function remove(id) {
    return apply(() => request(`${path}/${roomId}/entries/${id}`, {method:'DELETE'}))
  }

  async function addStop(index, place) {
    let error
    const success = await apply(() => request(`${path}/${roomId}/days/${index + 1}/stops`, {
      method:'POST', body:{url:place.url},
    }), undefined, message => {error = message})
    if (!success) throw new Error(error)
  }

  function removeStop(index, place) {
    return apply(() => request(`${path}/${roomId}/days/${index + 1}/stops`, {
      method:'DELETE', body:{url:place.url},
    }))
  }

  async function replaceStop(index, current, next) {
    const removed = await removeStop(index, current)
    if (!removed) throw new Error('The current stop could not be removed. Try again.')
    try {
      await addStop(index, next)
    } catch (failure) {
      try { await addStop(index, current) }
      catch { throw new Error(`${failure.message} The original stop could not be restored; refresh the itinerary to check its current state.`) }
      throw failure
    }
  }

  const shownDraft = workspace?.draft && (!draft || workspace.draft.updated >= draft.updated) ? workspace.draft : draft
  if (!shownDraft && inviteCode) return <section className="trip-room trip-room-join">
    <Icon name="users" size={28}/>
    <h2>{preview ? `Join the trip to ${preview.name}` : error ? 'Invitation unavailable' : 'Opening the trip invitation…'}</h2>
    {error && <p role="alert" className="form-error">{error}</p>}
    {preview && <form className="trip-room-form" onSubmit={event => {
      event.preventDefault()
      apply(() => request(`${path}/invites/${encodeURIComponent(inviteCode)}`, {method:'POST', body:{name:joinName.trim()}}),
        result => onJoined?.(result.id))
    }}>
      <label>Your display name<input value={joinName} onChange={event => setJoinName(event.target.value)} maxLength={70} required autoComplete="nickname"/></label>
      <Button type="submit" variant="primary" disabled={busy || !joinName.trim()}>{busy ? 'Joining…' : 'Join trip'}</Button>
    </form>}
  </section>

  if (!shownDraft) return <section className="trip-room trip-room-join">
    <p role={error ? 'alert' : 'status'}>{error || 'Opening the trip workspace…'}</p>
    {error && <Button onClick={() => setRetry(value => value + 1)}>Try again</Button>}
  </section>

  const active = tabs.findIndex(([value]) => value === tab)
  const group = workspace?.entries || []
  return <section className="trip-room" aria-label={'Trip to ' + shownDraft.name}>
    {!embedded && <header className="trip-room-header">
      <div>
        <h2>Trip to {shownDraft.name}</h2>
        <div className="trip-room-facts">
          {shownDraft.departure && <span><Icon name="calendar" size={15}/>{dayLabel(shownDraft.departure, 0)}{shownDraft.days.length > 1 && ' – ' + dayLabel(shownDraft.departure, shownDraft.days.length - 1)}</span>}
          <span><Icon name="users" size={15}/>{shownDraft.travelers} {shownDraft.travelers === 1 ? 'traveler' : 'travelers'}</span>
          {shownDraft.budget != null && <span><Icon name="wallet" size={15}/>{money(shownDraft.budget)}</span>}
          {shownDraft.mealPreference !== 'No preference' && <span>{shownDraft.mealPreference}</span>}
        </div>
      </div>
      <div className="trip-room-actions">
        {workspace?.isOwner && <Button icon="users" onClick={() => setInviteOpen(true)}>Invite</Button>}
        {onShowMap && <IconButton icon="map" label="Show trip map" onClick={onShowMap}/>}
        {onClose && <IconButton icon="close" label="Close trip workspace" onClick={onClose}/>}
      </div>
    </header>}
    {!embedded && <div className="trip-room-tabs" role="tablist" aria-label="Trip workspace sections" ref={tabStrip} onKeyDown={event => {
      const next = event.key === 'ArrowRight' ? (active + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (active + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null
      if (next == null) return
      event.preventDefault()
      setTab(tabs[next][0])
      tabStrip.current.children[next].focus()
    }}>
      {tabs.map(([id, label, icon]) => <button key={id} id={panelId + '-' + id} type="button"
        role="tab" aria-selected={id === tab} aria-controls={panelId} tabIndex={id === tab ? 0 : -1}
        onClick={() => {setTab(id); setError(''); revealResult(()=>document.getElementById(panelId))}}><Icon name={icon} size={15}/>{label}</button>)}
    </div>}
    <div className="trip-room-body" role={embedded ? undefined : 'tabpanel'} id={panelId} aria-labelledby={embedded ? undefined : panelId + '-' + tab} tabIndex={0}>
      {error && <p className="form-error" role="alert">{error} {!workspace && <Button onClick={() => setRetry(value => value + 1)}>Retry</Button>}</p>}
      {connectionError && <p className="form-error" role="status">Can’t refresh the workspace. {connectionError}</p>}
      {tab === 'itinerary' && <Itinerary draft={shownDraft} onPlaceSelect={onPlaceSelect}
        onEdit={onEdit} busy={busy} pinnedDays={pinnedDays}
        ideas={group.filter(entry => entry.kind === 'idea')} onIdeas={() => {
          if (onTabChange) onTabChange('ideas')
          else {setTab('ideas'); setError(''); revealResult(()=>document.getElementById(panelId))}
        }}
        onAddStop={workspace?.isOwner ? addStop : undefined}
        onRemoveStop={workspace?.isOwner ? removeStop : undefined}
        onReplaceStop={workspace?.isOwner ? replaceStop : undefined}
        onTogglePinDay={workspace?.isOwner ? togglePinDay : undefined}/>}
      {tab === 'calendar' && <Calendar draft={shownDraft} onPlaceSelect={onPlaceSelect}/>}
      {tab === 'travel' && <TravelMode draft={shownDraft} bookings={group.filter(entry => entry.kind === 'booking')}
        onTabChange={onTabChange || setTab}/>}
      {tab === 'media' && !workspace && <Button icon="download" onClick={() => exportMemories(shownDraft, [])}>Download itinerary and journal</Button>}
      {!workspace && !['itinerary', 'calendar', 'travel'].includes(tab) && !error && <p role="status">Opening the trip workspace…</p>}
      {workspace && tab === 'chat' && <GroupChat workspace={workspace} busy={busy} onSave={save} onRemove={remove}
        onNameChange={name => apply(() => request(`${path}/${roomId}/name`, {method:'PUT', body:{name}}))}/>}
      {workspace && ['ideas', 'bookings', 'media'].includes(tab) && <WorkspaceEntries key={tab} kind={{ideas:'idea', bookings:'booking', media:'media'}[tab]}
        entries={group.filter(entry => entry.kind === {ideas:'idea', bookings:'booking', media:'media'}[tab])}
        ideas={ideas} media={media} draft={shownDraft} onSave={save} onRemove={remove} onPlaceSelect={onPlaceSelect} busy={busy}
        onUpdate={(id, body) => apply(() => request(`${path}/${roomId}/entries/${id}`, {method:'PATCH', body}))}/>}
    </div>
    {inviteOpen && workspace?.isOwner && <InviteDialog workspace={workspace} onClose={() => {
      setInviteOpen(false)
      onInviteClose?.()
    }} onRefresh={() => {
      const revision = mutation.current
      request(`${path}/${roomId}`).then(result => {if (revision === mutation.current) setWorkspace(result)})
        .catch(failure => setError(failure.message))
    }}/>}
  </section>
}

export function TripWorkspaceList({onOpen, userId}) {
  const [rooms, setRooms] = useState([])
  useEffect(() => {
    const controller = new AbortController()
    request(path, {signal:controller.signal}).then(setRooms).catch(() => {})
    return () => controller.abort()
  }, [userId])
  if (!rooms.length) return null
  return <section className="trip-room-list">
    <h2>Group trips</h2>
    {rooms.map(room => <Button key={room.id} icon="users" onClick={() => onOpen(room.id)}>{room.name} <span>{room.isOwner ? 'Organizer' : 'Member'}</span></Button>)}
  </section>
}
