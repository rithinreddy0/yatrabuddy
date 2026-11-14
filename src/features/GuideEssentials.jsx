import React, {useEffect, useState} from 'react'
import {request} from '../api.mjs'
import {Button, Icon, SourcePill} from '../components/UI.jsx'
import {GoogleMapsLink} from '../components/GoogleMapsLink.jsx'
import {money} from '../planner.mjs'
import {suggestedLength} from './guideFacts.mjs'

const climateCache = new Map()

function useClimate(point) {
  const key = point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? `${point.lat.toFixed(1)},${point.lon.toFixed(1)}` : ''
  const [state, setState] = useState({key:'', data:null})
  useEffect(() => {
    if (!key) return
    if (climateCache.has(key)) { setState({key, data:climateCache.get(key)}); return }
    const controller = new AbortController()
    setState({key, loading:true})
    request('climate?' + new URLSearchParams({lat:point.lat, lon:point.lon}), {signal:AbortSignal.any([controller.signal, AbortSignal.timeout(12000)])})
      .then(data => { climateCache.set(key, data); if (!controller.signal.aborted) setState({key, data}) })
      .catch(error => { if (!controller.signal.aborted) setState({key, error:error.message}) })
    return () => controller.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state.key === key ? state : {loading:Boolean(key)}
}

function ClimateStrip({months, best}) {
  const rainMax = Math.max(50, ...months.map(month => month.rainfall || 0))
  return <ol className="guide-climate" aria-label="Average temperature and rainfall by month">
    {months.map(month => <li key={month.month} data-best={best.includes(month.month) || undefined}
      title={month.temperature == null ? month.month + ': no data' : `${month.month}: ${month.temperature} °C average, ${month.rainfall} mm rain, ${month.wetDays} wet days`}>
      <span className="guide-climate-bar" style={{'--rain': Math.round(100 * (month.rainfall || 0) / rainMax) + '%'}}/>
      <strong>{month.temperature == null ? '–' : Math.round(month.temperature) + '°'}</strong>
      <small>{month.month}</small>
      <span className="yatra-sr-only">{month.rainfall ?? 'no'} mm rain</span>
    </li>)}
  </ol>
}

/** Practical facts that answer "when, how long, how much, how do I get there" before the long guide text. */
export function GuideEssentials({place, point, report, profile, onAsk}) {
  const climate = useClimate(point)
  const [from, setFrom] = useState(profile?.homeCity || '')
  const listed = (report?.places || []).filter(item => ['Sight', 'Nature', 'Activity'].includes(item.category))
  const length = suggestedLength(listed.length)
  const stays = (place.stays || []).map(stay => stay.price).filter(Number.isFinite)
  const data = climate.data
  return <section className="panel guide-essentials" aria-label={`Trip essentials for ${place.name}`}>
    <h2>Trip essentials</h2>
    <div className="guide-essentials-grid">
      <article>
        <h3><Icon name="calendar" size={17}/> Best time to visit</h3>
        {climate.loading && <p role="status">Reading recent weather records…</p>}
        {climate.error && <p>{place.season ? `Usually recommended: ${place.season}.` : 'Seasonal weather is unavailable right now.'}</p>}
        {data?.bestMonths?.length > 0 && <p><strong>{data.bestMonths.join(', ')}</strong></p>}
        {data?.summary && <p>{data.summary}</p>}
        {data?.months?.length === 12 && <ClimateStrip months={data.months} best={data.bestMonths || []}/>}
        {data?.basis && <small>{data.basis} Bars show monthly rainfall.</small>}
        {data?.sourceUrl && <SourcePill url={data.sourceUrl} label={data.source}/>}
        {!point && <p>{place.season ? `Usually recommended: ${place.season}.` : 'Choose a place on the map to see seasonal weather.'}</p>}
      </article>
      <article>
        <h3><Icon name="clock" size={17}/> How long to stay</h3>
        {length ? <><p><strong>{length.label}</strong></p>
          <small>YatraBuddy suggestion from {listed.length} sights, nature spots and activities listed nearby. Not a rule.</small></>
          : <p>{report ? 'Too few listings nearby to suggest a length.' : 'Checking nearby listings…'}</p>}
      </article>
      <article>
        <h3><Icon name="wallet" size={17}/> Budget</h3>
        {stays.length ? <><p>Sample stays <strong>{money(Math.min(...stays))}–{money(Math.max(...stays))}</strong> a night</p>
          <small>Sample planning estimates, not live rates.</small></>
          : <p>No verified price data for this destination yet.</p>}
        {onAsk && <Button variant="text-btn" icon="sparkle" onClick={() => onAsk(`Estimate a realistic budget for ${length?.days || 3} days in ${place.name}${from ? ` from ${from}` : ''}, split by transport, stay, food and activities. Say which figures are estimates.`)}>Estimate my budget</Button>}
      </article>
      <article>
        <h3><Icon name="plane" size={17}/> Getting there</h3>
        <form className="guide-from" onSubmit={event => {
          event.preventDefault()
          if (from.trim() && onAsk) onAsk(`How do I get from ${from.trim()} to ${place.name}? Compare flights, trains, buses and driving.`)
        }}>
          <label>From<input value={from} maxLength={80} onChange={event => setFrom(event.target.value)} placeholder="Your city"/></label>
          {onAsk && <Button type="submit" variant="primary" icon="search" disabled={!from.trim()}>Compare</Button>}
        </form>
        {from.trim() && <GoogleMapsLink origin={from.trim()} destination={[place.name, place.region || place.country].filter(Boolean).join(', ')} mode="transit" label="Routes in Google Maps"/>}
        <small>Fares and schedules come from providers when they are available. Nothing is booked for you.</small>
      </article>
    </div>
  </section>
}
