import React, {useState} from 'react'
import {PRIORITIES, comparable, rankTransport} from './transportRanking.mjs'
import {ExternalLink} from 'lucide-react'
import {TravelHighlights} from '../components/TravelHighlights.jsx'
import {GoogleMapsLink} from '../components/GoogleMapsLink.jsx'

function ExternalSource({url, children}) {
  let href
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) href = parsed.href
  } catch {
    return null
  }
  return href ? <a className="agent-source-link" href={href} target="_blank" rel="noreferrer">
    {children}<ExternalLink size={13} aria-hidden="true"/>
  </a> : null
}

function dateLabel(value) {
  if (!value) return ''
  const date = new Date(value + 'T00:00:00Z')
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeZone: 'UTC',
  }).format(date)
}

const quoteStatus = {
  need_airports:'Enter departure and arrival airport codes and a date to look up flight offers.',
  need_date:'Choose a departure date to check flight offers.',
  need_group_search:'Check fares for groups of this size directly with the airline.',
  need_time:'Choose a future departure date or time to check schedules.',
  empty:'The provider returned no options for this search.',
  unavailable:'Live options couldn’t be checked. Use the operator links below.',
}

function displayTime(value, timeZone) {
  if (!value) return ''
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat(undefined,{timeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(value))
    } catch {}
  }
  return value.replace('T', ' ').replace(/(\d\d:\d\d):\d\d(?:\.\d+)?/, '$1').replace(/Z$/, ' UTC')
}

function displayDuration(value) {
  if (!value) return ''
  const seconds = /^(\d+)s$/.exec(value)
  if (seconds) {
    const minutes = Math.round(Number(seconds[1]) / 60)
    return [Math.floor(minutes / 60) && Math.floor(minutes / 60) + ' h', minutes % 60 && minutes % 60 + ' min'].filter(Boolean).join(' ') || '< 1 min'
  }
  return value.replace(/^PT/, '').replace(/(\d+)H/, '$1 h ').replace(/(\d+)M/, '$1 min').trim()
}

function TransportComparison({quotes}) {
  const [priority, setPriority] = useState('value')
  const rows = comparable(quotes)
  if (rows.length < 2) return null
  const ranked = rankTransport(rows, priority)
  return <section className="trip-transport-card transport-compare" aria-label="Compare options">
    <h4>Compare {rows.length} options</h4>
    <div className="filters" role="group" aria-label="Rank by">{PRIORITIES.map(([id, label]) =>
      <button type="button" key={id} className={'pill ' + (priority === id ? 'on' : '')} aria-pressed={priority === id} onClick={() => setPriority(id)}>{label}</button>)}</div>
    <ol>{ranked.slice(0, 6).map(row => <li key={row.id}>
      <strong>{row.group === 'flights' ? 'Flight' : row.modes.map(mode => mode.replaceAll('_', ' ').toLowerCase()).join(' + ') || 'Transit'}
        {' · '}{row.fare != null ? `${row.currency} ${Math.round(row.fare).toLocaleString()}${row.option.partyTotal ? ' total' : ''}` : 'fare unavailable'}
        {row.minutes != null && ` · ${displayDuration(row.option.duration)}`}</strong>
      <small>{row.reason} · {row.source === 'Google Routes' ? 'Google Maps' : row.source}</small>
    </li>)}</ol>
    <small>Ranked only on fares, times and changes the providers returned. Seats and prices are not held.</small>
  </section>
}

export function TransportQuotes({quotes, kind}) {
  if (!quotes) return null
  const groups = Object.entries(quotes).filter(([id,group]) => id !== 'driving' && group.status !== 'unconfigured' && (!kind || id === kind))
  if (!groups.length) return null
  return <div className="transport-quote-list"><TransportComparison quotes={Object.fromEntries(groups)}/>{groups.map(([id, group])=>
    <section key={id} className="trip-transport-card">
      <h4>{id==='flights'?'Flight offers':'Scheduled transit'} · {group.source==='Google Routes'?'Google Maps':group.source}</h4>
      {group.searchedAt && <small>Search departure · {displayTime(group.searchedAt)}</small>}
      {group.checkedAt && <small>Checked · {new Date(group.checkedAt).toLocaleString()}</small>}
      {group.status!=='ready' && <p>{quoteStatus[group.status]}</p>}
      {(group.options||[]).map((option,index)=><article className="transport-quote" key={index}>
        <div className="transport-quote-summary"><strong className={option.price ? 'travel-price' : undefined}>{option.price
          ? `${option.price.currency} ${option.price.amount}${option.partyTotal?' total for the group':''}`
          : 'Fare unavailable'}</strong>
          <small>{[displayDuration(option.duration), option.metres!=null&&`${(option.metres/1000).toFixed(1)} km`].filter(Boolean).join(' · ')}</small></div>
        <ol>{option.legs.map((leg,j)=><li key={j}>
          <strong>{[leg.operator,leg.service,leg.vehicle?.replaceAll('_',' ')].filter(Boolean).join(' · ')}</strong>
          {leg.direction && <small>Direction · {leg.direction}</small>}
          <div>Board · {leg.board.name||'Stop unavailable'}{leg.board.terminal&&` · Terminal ${leg.board.terminal}`} {displayTime(leg.board.time,leg.board.timeZone)}</div>
          <div>Arrive · {leg.alight.name||'Stop unavailable'}{leg.alight.terminal&&` · Terminal ${leg.alight.terminal}`} {displayTime(leg.alight.time,leg.alight.timeZone)}</div>
          {leg.operatorUrl && <ExternalSource url={leg.operatorUrl}>Operator</ExternalSource>}
        </li>)}</ol>
      </article>)}
      {group.options?.length>0 && <small>{id==='flights'?'Prices and terminals can change. Confirm with the airline before booking.':'Scheduled times and published fares can change. Confirm with the operator before travel.'}</small>}
    </section>)}</div>
}

export function TravelProviderSources({result, answerFirst = false}) {
  if (!result) return null
  const {title = 'Travel providers', route, origin, destination, date, checkout, travelers, notes = [], providers = [], detail, guide, error, arrivalTips = {}} = result
  const guideSections = guide?.sections || []
  const dates = [dateLabel(date), dateLabel(checkout)].filter(Boolean).join(' – ')
  const context = [route, dates, travelers && `${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}`].filter(Boolean).join(' · ')
  const primaryProviders = providers.filter(provider => provider.name !== 'Google Maps' && provider.name !== 'Rome2Rio')
  const providerList = <ul className="agent-place-results transport-provider-list">
      {primaryProviders.map(({name, mode, url, sourceUrl, summary, action}) => <li key={`${name}-${mode}`}>
        <h4>{name} <small>· {mode}</small></h4>
        <p>{arrivalTips[mode] || summary}</p>
        <div className="agent-place-links">
          <ExternalSource url={url}>{action || `Open ${name}`}</ExternalSource>
          {sourceUrl !== url && <ExternalSource url={sourceUrl}>
            Source<span className="yatra-sr-only"> for {name}</span>
          </ExternalSource>}
        </div>
      </li>)}
    </ul>
  return <section className="agent-source-answer" aria-label={title}>
    <h3>{title === 'Transport sources' ? 'Transport options' : title}</h3>
    {context && <strong>{context}</strong>}
    {error && <p>{error}</p>}
    {result.lookupPrompt && <p>{result.lookupPrompt}</p>}
    {result.kind === 'transport' && destination && <div className="transport-map-links">
      {origin && <GoogleMapsLink origin={origin} destination={destination} mode="driving" label="Driving in Google Maps"/>}
      {origin ? <GoogleMapsLink origin={origin} destination={destination} mode="transit" label="Transit in Google Maps"/> :
        <GoogleMapsLink place={{name:destination}}/>}
    </div>}
    {result.quotes?.driving?.status === 'ready' ? <p><strong>{(result.quotes.driving.metres / 1000).toLocaleString(undefined,{maximumFractionDigits:1})} km</strong> · {displayDuration(result.quotes.driving.duration)} by car · Google Maps traffic estimate</p>
      : result.road && <p><strong>{result.road.kilometres.toLocaleString()} km</strong>
      {result.road.minutes != null && ` · about ${Math.floor(result.road.minutes / 60)} h ${result.road.minutes % 60} min by car`} · {result.road.estimated}</p>}
    <TransportQuotes quotes={result.quotes}/>
    {!!result.passes?.length && <div><h4>Published transit passes</h4><ul>{result.passes.map(pass => <li key={pass.name}>{pass.name} · <strong className="travel-price">₹{pass.amount}</strong> <ExternalSource url={pass.url}>Operator details</ExternalSource></li>)}</ul></div>}
    {answerFirst && result.local && !result.passes?.length && <p>A day pass price could not be verified for this city.</p>}
    {primaryProviders.length > 0 && <><h4>Check fares and availability</h4>{providerList}</>}
    {guideSections.map(section => <article className="journey-research-result" key={section.title}>
      <h4>{section.title}</h4>
      <TravelHighlights text={section.text} points={section.points} limit={answerFirst ? 3 : 1} preferPrices/>
      <ExternalSource url={section.sourceUrl}>{section.source || 'Destination guide'}</ExternalSource>
    </article>)}
    {!!guideSections.length && <small className="travel-source-note">Guide fares can change. Confirm with the operator.</small>}
    {answerFirst && !error && !result.lookupPrompt && !result.places && !guideSections.length && !result.road && !Object.values(result.quotes || {}).some(group=>group.status==='ready') && <p>Route details and schedules could not be verified from the available sources.</p>}
    {!error && detail && <p><small>{detail}</small></p>}
    {notes.map(note => <p key={note}><small>{note}</small></p>)}
    {providers.find(item=>item.name==='Rome2Rio') && <ExternalSource url={providers.find(item=>item.name==='Rome2Rio').url}>Compare routes on Rome2Rio</ExternalSource>}
  </section>
}
