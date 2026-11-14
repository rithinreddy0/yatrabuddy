import React, {useEffect, useState} from 'react'
import {Button, Icon, SourcePill} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {visitTime} from './draftSchedule.mjs'
import {travelTimeline, tripClock, tripDate} from './travelTimeline.mjs'

const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
const timeZones = [...new Set([localZone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])]

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) }
  catch { return null }
}

function TimelineItem({event, current, checked, onCheck}) {
  const {place, leg, location, attachment, url, booking} = event
  const directions = place ? `${place.lat},${place.lon}` : location
  return <li className="travel-event" data-current={current || undefined}>
    <span className="travel-event-time">{event.minute == null ? 'Any time' : visitTime(event.minute)}</span>
    <div>
      <h3>{event.title}</h3>
      <p>{[location, place?.category, leg && `${leg.kilometres.toFixed(1)} km · ~${leg.minutes} min`,
        Number.isFinite(place?.rating) && `★ ${place.rating.toFixed(1)}${place.reviewCount ? ` (${place.reviewCount})` : ''}`,
        place?.publishedPrice, event.amount != null && money(event.amount)].filter(Boolean).join(' · ')}</p>
      {booking && event.notes && <p>{event.notes}</p>}
      <div className="travel-actions">
        {attachment && <a className="source-pill" href={attachment} target="_blank" rel="noreferrer">Open ticket</a>}
        {url && <SourcePill url={url} label="Booking link"/>}
        {directions && <SourcePill url={'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(directions)} label="Directions"/>}
        {!booking && <label className="travel-check"><input type="checkbox" checked={checked} onChange={onCheck}/> Visited</label>}
      </div>
    </div>
  </li>
}

export function TravelMode({draft, bookings, onTabChange}) {
  const key = `yatra.travel-mode.${draft.id}`
  const [settings, setSettings] = useState(() => read(key) || {})
  const zone = timeZones.includes(settings.zone) ? settings.zone : localZone
  const [now, setNow] = useState(Date.now)
  const clock = tripClock(now, zone)
  const [selected, setSelected] = useState(null)
  const today = draft.departure ? Math.round((Date.parse(clock.date) - Date.parse(draft.departure)) / 86_400_000) : 0
  const day = selected ?? Math.max(0, Math.min(today, draft.days.length - 1))
  const {events, otherTickets, reminders, dayCount} = travelTimeline(draft, bookings, day)
  const checked = settings.checked || []
  const next = reminders.filter(item => (item.date > clock.date || (item.date === clock.date && item.minute >= clock.minute)) && !checked.includes(item.id))
    .sort((a, b) => a.date.localeCompare(b.date) || a.minute - b.minute)[0]
  const due = reminders.filter(item => item.date === clock.date && item.minute >= clock.minute - 2 && item.minute <= clock.minute + 15 && !checked.includes(item.id))
  const reminder = settings.alerts && due.length ? due.map(item => `${visitTime(item.minute)} · ${item.title}`).join('  •  ') : ''
  const weather = draft.weather?.find(item => item.date === tripDate(draft.departure, day))

  useEffect(() => {
    const refresh = () => setNow(Date.now())
    const timer = window.setInterval(refresh, 15_000)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  function change(updates) {
    const value = {...settings, ...updates}
    setSettings(value)
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  }

  return <div className="travel-mode">
    <section className="travel-now">
      <div><p className="travel-label"><Icon name="compass" size={15}/> Travel Mode · {visitTime(clock.minute)}</p>
        <h2>{next ? next.title : draft.departure ? 'You’re caught up' : 'Your trip schedule'}</h2>
        {next && <p>Up next · {next.date === clock.date ? 'Today' : next.date} · {visitTime(next.minute)}{next.location && ` · ${next.location}`}</p>}
        {!draft.departure && <p>Set a departure date to get day-by-day reminders.</p>}
      </div>
      <div className="travel-settings">
        <label>Schedule time zone<select value={zone} onChange={event => change({zone:event.target.value})}>
          {timeZones.map(item => <option key={item}>{item}</option>)}
        </select></label>
        <label className="travel-check"><input type="checkbox" checked={Boolean(settings.alerts)} onChange={event => change({alerts:event.target.checked})}/> Remind me here 15 min before</label>
      </div>
    </section>
    {settings.alerts && <p className="form-note">Reminders appear while Travel Mode is open. Schedule times use the selected time zone.</p>}
    <div role="status" aria-live="polite">{reminder && <p className="travel-reminder"><Icon name="calendar" size={18}/> {reminder}</p>}</div>
    <div className="travel-daybar">
      <label>Trip day<select value={day} onChange={event => setSelected(Number(event.target.value))}>
        {Array.from({length:dayCount}, (_, index) => <option key={index} value={index}>Day {index + 1}{draft.departure ? ` · ${tripDate(draft.departure, index)}` : ''}</option>)}
      </select></label>
      {weather && <span>{Math.round(weather.low)}–{Math.round(weather.high)}°C{weather.rainProbability != null && ` · ${weather.rainProbability}% chance of rain`}</span>}
    </div>
    {events.length ? <ol className="travel-events">{events.map(event => <TimelineItem key={event.id} event={event}
      checked={checked.includes(event.id)} current={event.id === next?.id}
      onCheck={() => change({checked:checked.includes(event.id) ? checked.filter(id => id !== event.id) : [...checked, event.id]})}/>)}</ol>
      : <p className="form-note">Nothing scheduled for this day.</p>}
    {!!otherTickets.length && <details className="travel-other"><summary>Tickets outside the itinerary · {otherTickets.length}</summary>
      <ul className="travel-events">{[...otherTickets].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.minute ?? 1440) - (b.minute ?? 1440))
        .map(ticket => <TimelineItem key={ticket.id} event={{...ticket, location:[ticket.date, ticket.location].filter(Boolean).join(' · ')}}/>)}</ul>
    </details>}
    <div className="travel-actions">
      <Button icon="trip" onClick={() => onTabChange('bookings')}>Manage tickets</Button>
      <Button icon="chat" onClick={() => onTabChange('chat')}>Group chat</Button>
      <Button icon="calendar" onClick={() => onTabChange('calendar')}>Calendar</Button>
    </div>
  </div>
}
