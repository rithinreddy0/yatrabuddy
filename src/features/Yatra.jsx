import React, {useEffect, useRef, useState} from 'react'
import {ArrowDownToLine, ArrowRight, ArrowUpRight, BedDouble, Car, ChartNoAxesColumn, Check, ChevronRight, CloudSun, Globe, Luggage, Map, MapPin, Plane, Plus, Receipt, Route, Ship, Sparkles, TrainFront, Users, Wallet, X} from 'lucide-react'
import seed from '../../backend/goa-escape.json'
import catalog from '../../backend/catalog.json'
import {freshnessLabel, request, travelData} from '../api.mjs'
import {askTravel} from '../conversation.mjs'
import {JourneyMap} from './JourneyMap.jsx'
import './Yatra.css'

const sourceIcons = {flight: Plane, weather: CloudSun, map: MapPin}
const money = amount => 'Rs ' + amount.toLocaleString('en-IN')
const duration = minutes => Math.floor(minutes / 60) + 'h ' + minutes % 60 + 'm'
const sampleLabel = 'SIMULATED DATA'
const tripDates = dates => new Intl.DateTimeFormat('en-GB', {day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'}).formatRange(dates[0], dates.at(-1))

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem('yatra.' + key)) ?? fallback } catch { return fallback }
}

function save(key, value) {
  try { localStorage.setItem('yatra.' + key, JSON.stringify(value)) } catch { /* in-memory state remains available */ }
}

function datesFor(trip) {
  const start = new Date(trip.date + 'T12:00:00Z')
  return trip.days.map((_, index) => new Date(start.getTime() + index * 86400000))
}

function download(name, rows) {
  const url = URL.createObjectURL(new Blob([rows.join('\n')], {type: 'text/plain;charset=utf-8'}))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function IconButton({icon: Icon, label, onClick}) {
  return <button className="yt-icon" type="button" aria-label={label} title={label} onClick={onClick}><Icon size={20}/></button>
}

function PillButton({children, onClick, primary = false, type = 'button', disabled = false, ...props}) {
  return <button {...props} type={type} className={'yt-pill-button' + (primary ? ' yt-primary' : '')} onClick={onClick} disabled={disabled}>{children}</button>
}

function Gauge({percent, needle = false}) {
  const angle = Math.PI * (1 - Math.min(percent, 100) / 100)
  const x = 130 + 89 * Math.cos(angle)
  const y = 117 - 89 * Math.sin(angle)
  return <div className={'yt-gauge' + (needle ? ' yt-needle' : '')}>
    <svg viewBox="0 0 260 140" aria-hidden="true">
      <path className="yt-gauge-track" d="M 20 117 A 110 110 0 0 1 240 117" pathLength="100"/>
      <path className="yt-gauge-fill" d="M 20 117 A 110 110 0 0 1 240 117" pathLength="100" strokeDasharray={Math.min(percent, 100) + ' 100'}/>
      {!needle && <path className="yt-gauge-ticks" d="M 37 117 A 93 93 0 0 1 223 117" pathLength="100"/>}
      {needle && <><line className="yt-gauge-hand" x1="130" y1="117" x2={x} y2={y}/><circle className="yt-gauge-hub" cx="130" cy="117" r="10"/></>}
    </svg>
    {!needle && <div className="yt-gauge-center"><span className="yt-orb yt-small-orb"><Sparkles size={17}/></span><strong>{percent}%</strong><span>of budget used</span></div>}
  </div>
}

function Chart({dates, spending, selected, onSelect}) {
  const highest = Math.max(...spending, 1)
  return <div className="yt-chart" aria-label="Daily spending">
    {dates.map((date, i) => <button key={date.toISOString()} type="button" aria-pressed={selected === i} onClick={() => onSelect(i)} title={money(spending[i])} aria-label={date.toLocaleDateString('en-GB', {day: 'numeric', month: 'long', timeZone: 'UTC'}) + ', ' + money(spending[i])}>
      <span className="yt-chart-bar" style={{height: Math.max(8, Math.round(spending[i] / highest * 73))}}/>
      <small>{date.getUTCDate()}</small>
    </button>)}
  </div>
}

function Sheet({title, close, children}) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog className={'yt-sheet' + (title === 'Compare routes' ? ' yt-wide-sheet' : '')} ref={ref} aria-label={title}
    onCancel={event => {event.preventDefault(); close()}}
    onClick={event => {if (event.target === event.currentTarget) close()}}>
    <div className="yt-sheet-inner">
      <header><h2>{title}</h2><IconButton icon={X} label="Close sheet" onClick={close}/></header>
      {children}
    </div>
  </dialog>
}

function Sources({sources, ready = sources.length}) {
  return <ul className="yt-sources" aria-label="Sources">{sources.map((source, index) => {
    const fetched = index < ready
    const Icon = sourceIcons[source.kind] || MapPin
    return <li className={fetched ? 'yt-fetched' : 'yt-searching'} key={source.name}>
      <Icon size={17}/><span>{source.name}</span>
      {fetched ? <><Check size={15}/><small>Fetched</small><i/></> : <small>Searching</small>}
    </li>
  })}</ul>
}

function Assistant({trip, profile, openOnline}) {
  const [ready, setReady] = useState(0)
  const [sourceNote, setSourceNote] = useState('')
  const [query, setQuery] = useState('')
  const [reply, setReply] = useState(null)
  const [pending, setPending] = useState(false)
  const controller = useRef(null)
  const history = useRef([])
  useEffect(() => {
    const lookup = new AbortController()
    const timers = []
    request('yatra/sample', {signal: AbortSignal.any([lookup.signal, AbortSignal.timeout(1800)])})
      .catch(() => {if (!lookup.signal.aborted) setSourceNote('Showing bundled sample records.')})
      .then(() => {
        if (lookup.signal.aborted) return
        trip.sources.forEach((_, index) => {
          timers.push(setTimeout(() => setReady(index + 1), 260 + index * 230))
        })
      })
    return () => {
      lookup.abort()
      controller.current?.abort()
      timers.forEach(clearTimeout)
    }
  }, [trip.sources])

  async function ask(event) {
    event.preventDefault()
    const question = query.trim()
    if (!question || pending) return
    if (/budget|spent|spend|left|balance|expense|split/i.test(question)) {
      setReply({answer: trip.name + ' has ' + money(trip.spent) + ' recorded against a ' + money(trip.budget) + ' budget. ' + money(Math.abs(trip.remaining)) + (trip.remaining < 0 ? ' over budget.' : ' left.')})
      return
    }
    const run = new AbortController()
    controller.current = run
    setPending(true)
    setReply(null)
    try {
      const answer = await askTravel(question, {destination: {id: 'goa'}, profile, history: history.current, signal: AbortSignal.any([run.signal, AbortSignal.timeout(8500)])})
      if (run.signal.aborted) return
      if (!answer?.answer) throw new Error('Empty reply')
      history.current = [...history.current, {role: 'user', content: question}, {role: 'assistant', content: answer.answer}].slice(-8)
      setReply(answer)
    } catch {
      if (!run.signal.aborted) setReply({answer: 'Source lookup is unavailable. The sample itinerary includes a Palolem beach walk, lunch in Ponda and a sunset stop at Cabo de Rama.'})
    } finally {
      if (!run.signal.aborted) setPending(false)
    }
  }

  return <div className="yt-stack">
    <div className="yt-assistant-header"><span className="yt-orb"><Sparkles size={24}/></span><div><h3>Gathering sources</h3><p role="status">{ready === trip.sources.length ? 'Sample sources ready' : 'Searching sample sources'}</p></div></div>
    <Sources sources={trip.sources} ready={ready}/>
    <small>{sourceNote || 'These three chips show simulated records.'}</small>
    <PillButton onClick={openOnline}><Globe size={17}/> Open online travel sources <ChevronRight size={17}/></PillButton>
    <form className="yt-assistant-form" onSubmit={ask}>
      <label htmlFor="yt-query">Ask about Goa</label>
      <input id="yt-query" value={query} onChange={event => setQuery(event.target.value)} maxLength={260} placeholder="What can I do in Palolem?" required/>
      <PillButton type="submit" primary disabled={pending}>{pending ? 'Checking travel sources' : 'Ask YatraBuddy'}<ArrowRight size={17}/></PillButton>
    </form>
    <div aria-live="polite">{reply && <div className="yt-reply"><p>{reply.answer}</p>{reply.citations?.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title}<ArrowUpRight size={13}/></a>)}</div>}</div>
  </div>
}
const goaMapPlaces = [
  {...seed.goaHubs[0], category: 'Airport'},
  ...catalog.find(place => place.image === 'goa').places
    .filter(place => ['Cabo de Rama Fort', 'Palolem Beach'].includes(place.name))
    .map(place => ({...place, category: place.theme, address: place.area, openingHours: place.hours})),
]

function GoaMap({initiallyOpen = false}) {
  const [road, setRoad] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mapOpen, setMapOpen] = useState(initiallyOpen)
  async function compareRoad() {
    setLoading(true)
    try {
      setRoad(await travelData('road-route', {method: 'POST', body: {
        destination: 'goa', stops: ['Palolem Beach', 'Cabo de Rama Fort'],
      }}))
    } catch {setRoad({freshness: 'simulated'})}
    finally {setLoading(false)}
  }
  return <div className="yt-stack yt-compare-map">
    <PillButton onClick={() => setMapOpen(open => !open)} aria-expanded={mapOpen}>{mapOpen ? 'Hide map' : 'Show map'}</PillButton>
    {mapOpen && <JourneyMap center={{name:'South Goa'}} places={goaMapPlaces} onClose={() => setMapOpen(false)}/>}
    <div className="yt-detail-row"><strong>South Goa stops</strong><p>Goa International Airport / Cabo de Rama Fort / Palolem Beach</p></div>
    <PillButton onClick={compareRoad} disabled={loading}>{loading ? 'Checking road estimate' : 'Compare local road estimates'}</PillButton>
    {road && <div className="yt-detail-row" role="status">
      <strong>Palolem Beach to Cabo de Rama Fort</strong>
      <p>SIMULATED · 24 km / 45 min</p>
      {road.legMinutes ? <p>{freshnessLabel(road)} · {road.kilometres} km / {duration(road.legMinutes[0])} via OSRM</p> : <p>Online road estimate unavailable.</p>}
    </div>}
    <a className="yt-pill-button" href="https://www.openstreetmap.org/#map=10/15.13/73.99" target="_blank" rel="noreferrer">Open full map <ArrowUpRight size={16}/></a>
  </div>
}

function Journeys({trip, code, setCode, rehan}) {
  const [group, setGroup] = useState(null)
  const [journeyIndex, setJourneyIndex] = useState(0)
  const [token, setToken] = useState(() => stored('member.' + code, ''))
  const [name, setName] = useState(() => stored('traveller', {}).name || (rehan && !code ? 'Rehan' : ''))
  const [home, setHome] = useState(() => stored('traveller', {}).home || trip.origin)
  const [style, setStyle] = useState(() => stored('traveller', {}).style || 'Balanced')
  const [crowds, setCrowds] = useState(() => stored('traveller', {}).crowds || 'Flexible')
  const [interests, setInterests] = useState(() => stored('traveller', {}).interests || [])
  const [budget, setBudget] = useState(trip.budget / trip.travellers)
  const [priority, setPriority] = useState(() => stored('priority', 'explore'))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState('')
  const [delay, setDelay] = useState(rehan ? 95 : 70)
  const [recovery, setRecovery] = useState(null)
  const [accepted, setAccepted] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [remaining, setRemaining] = useState(() => Math.floor(Math.max(0, trip.remaining) / trip.travellers))
  const [notification, setNotification] = useState(() => globalThis.Notification?.permission)
  const inFlight = useRef(false)

  useEffect(() => {
    if (!code) return
    const controller = new AbortController()
    const refresh = async () => {
      if (inFlight.current) return
      try {
        const next = await request('yatra/groups/' + code, {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4000)])})
        if (!controller.signal.aborted && !inFlight.current) setGroup(next)
      } catch {
        if (!controller.signal.aborted && !inFlight.current) setError('Could not refresh the group. Sample options are available.')
      }
    }
    refresh()
    const timer = setInterval(refresh, 5000)
    return () => {controller.abort(); clearInterval(timer)}
  }, [code])

  async function perform(action) {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    try { await action() } catch (failure) { setError(failure.message) }
    finally { inFlight.current = false; setBusy(false) }
  }

  function join(event) {
    event.preventDefault()
    perform(async () => {
      const preferences = {name: name.trim(), home: home.trim(), style, crowds, interests}
      const next = await request(code ? 'yatra/groups/' + code + '/join' : 'yatra/groups', {
        method: 'POST', body: {...preferences, budget: Number(budget), priority, journey: journeyIndex}
      })
      save('traveller', preferences)
      save('member.' + (next.code || code), next.token)
      setGroup(next)
      setToken(next.token)
      if (next.code) setCode(next.code)
    })
  }

  async function copy() {
    const url = new URL(location.href)
    url.searchParams.set('group', code)
    try { await navigator.clipboard.writeText(url.href); setCopyStatus('Invite link copied.') }
    catch { setCopyStatus(url.href) }
  }

  const [weights, setWeights] = useState(() => stored('weights', {}))
  function feedback(route, delta) {
    const next = {...weights, [route.theme]: Math.min(16, Math.max(-16, (weights[route.theme] || 0) + delta))}
    setWeights(next)
    save('weights', next)
    setCopyStatus(delta > 0 ? 'Similar routes will rank higher in your next comparison.' : 'Similar routes will rank lower in your next comparison.')
  }
  const journey = seed.journeys[group?.journey ?? journeyIndex]
  const availableRoutes = trip.routes.map((route, index) => ({
    ...route, price: journey.prices[index], minutes: journey.minutes[index],
    ...(index === 2 && (group?.journey ?? journeyIndex) !== 0
      ? {name: 'Rail + flexible transfer', reason: 'The longest connection buffer gives you more time to change vehicles.'}
      : {}),
  }))
  const options = group?.options ?? availableRoutes.filter(route => route.price <= budget)
    .map(route => ({...route, risk: route.buffer < 60 ? 'Moderate' : 'Low', score: Math.round(
      40 * (1 - route.price / budget) + 25 * (1 - route.minutes / 1800) + 20 * Math.min(route.buffer / 100, 1) +
      15 * (route.theme === priority || (priority === 'safe' && route.buffer >= 90)) + (weights[route.theme] || 0)
    )})).sort((a, b) => b.score - a.score)
  const active = options.find(route => route.id === selected) || options[0]
  const connection = active?.id === 'flight' ? ['Flight to ' + journey.airport, 'Airport shuttle'] :
    ['Train to ' + journey.railStop, active?.id === 'coast' ? 'Local transfer' : 'Local bus']

  async function enableNotifications() {
    if (!globalThis.Notification) return
    try { setNotification(await Notification.requestPermission()) }
    catch { setCopyStatus('Browser notifications are unavailable.') }
  }

  function simulate() {
    perform(async () => {
      const localBuffer = active.buffer - delay
      const replacement = delay <= 120 && remaining >= 450
        ? {name: 'Next scheduled local shuttle', amount: 450, wait: 90}
        : remaining >= 1100 ? {name: 'On-demand local transfer', amount: 1100, wait: 35} : null
      setAccepted('')
      let result
      try {
        result = await request('yatra/recover', {method: 'POST', body: {route: active.id, minutes: delay, remaining}, signal: AbortSignal.timeout(2200)})
      } catch {
        result = {buffer: localBuffer, missed: localBuffer < 30, replacement, extraBudget: (delay <= 120 ? 450 : 1100) - remaining}
      }
      setRecovery(result)
      if (result.missed && notification === 'granted') {
        const title = 'YatraBuddy · Simulated connection missed'
        const options = {body: delay + ' minute simulated delay on ' + active.name}
        try {
          const worker = await navigator.serviceWorker?.getRegistration()
          if (worker?.active) await worker.showNotification(title, options)
          else new Notification(title, options)
        } catch { setCopyStatus('The delay alert is shown here. Browser notification delivery failed.') }
      }
    })
  }

  return <div className="yt-compare-layout"><div className="yt-stack">
    <p className="yt-sample">{sampleLabel}</p>
    <div className="yt-route-banner"><Plane size={20}/><strong>{journey.origin}</strong><Route size={20}/><strong>{journey.destination}</strong></div>
    {!code && <label className="yt-assistant-form">Search sample journeys
      <select value={journeyIndex} onChange={event => {
        setJourneyIndex(Number(event.target.value)); setSelected(''); setRecovery(null); setAccepted('')
      }}>{seed.journeys.map((pair, index) => <option key={index} value={index}>{pair.origin} to {pair.destination}</option>)}</select>
    </label>}
    {rehan && <p>Rehan and four friends / {money(15000)} each / December 2026</p>}
    {group && <div className="yt-group-status"><strong>{group.members.length} in your trip group</strong><p>{group.members.map(member => member.name + (member.voted ? ' voted' : ' has yet to vote')).join(', ')}</p><p>Group fare limit {money(group.budget)} per traveller</p>{group.crowdConflict && <p>The group has mixed preferences for quiet and lively places.</p>}{options[0]?.votes > 0 && <p>Consensus pick: {options[0].name}</p>}</div>}
    {!token && <PillButton primary onClick={() => document.getElementById('yt-group-name')?.focus()}>{code ? 'Join this trip group' : 'Create a trip group'} <Users size={17}/></PillButton>}
    {token && <PillButton onClick={copy}>Copy group invite <ArrowUpRight size={16}/></PillButton>}
    <p role="status" className="yt-feedback">{error || copyStatus}</p>
    {options.length === 0 && <p>No route fits this budget. The cheapest sample fare is {money(Math.min(...journey.prices))} per traveller.</p>}
    {options.map(route => <article className="yt-detail-row yt-route-option" key={route.id}>
      <strong>{route.name}</strong><p>{money(route.price)} per traveller / {duration(route.minutes)}</p><small>{route.transfers} transfer / {route.risk} connection risk / Score {route.score}</small><p>{route.reason}</p>
      <div className="yt-inline">
        <PillButton onClick={() => {setSelected(route.id); setRecovery(null); setAccepted('')}}>{active?.id === route.id ? 'Selected' : 'Select route'}</PillButton>
        {token && <PillButton disabled={busy} onClick={() => perform(async () => setGroup(await request('yatra/groups/' + code + '/vote', {method: 'PUT', body: {token, route: route.id}})))}>Vote ({route.votes || 0})</PillButton>}
        <PillButton onClick={() => feedback(route, 4)}>More like this</PillButton><PillButton onClick={() => feedback(route, -4)}>Less like this</PillButton>
      </div>
    </article>)}
    {active && <div className="yt-detail-row yt-recovery">
      <h3>Simulate a delay</h3>
      <ol className="yt-legs">
        <li><strong>{connection[0]}</strong><small>First leg</small></li>
        <li><small>{active.buffer}-minute connection buffer</small></li>
        <li><strong>{accepted && recovery?.replacement ? recovery.replacement.name : connection[1]}</strong><small>{accepted ? 'Accepted replacement' : 'Next leg'}</small></li>
      </ol>
      <label>Remaining budget per traveller<input type="number" min="0" max="100000" value={remaining} onChange={event => {setRemaining(Math.min(100000, Math.max(0, Number(event.target.value)))); setRecovery(null); setAccepted('')}}/></label>
      <label>Delay of {delay} minutes<input type="range" min="0" max="240" step="5" value={delay} onChange={event => {setDelay(Number(event.target.value)); setRecovery(null); setAccepted('')}}/></label>
      <div className="yt-inline"><PillButton onClick={simulate} disabled={busy}>Test connection</PillButton>{recovery && <PillButton onClick={() => {setRecovery(null); setAccepted(''); setDelay(rehan ? 95 : 70)}}>Reset</PillButton>}</div>
      {notification === 'default' && <PillButton onClick={enableNotifications}>Enable browser delay alerts</PillButton>}
      <div aria-live="polite">{recovery && (recovery.missed ? <><strong>Connection missed</strong>{recovery.replacement ? <><p>{recovery.replacement.name}, {money(recovery.replacement.amount)} each, about {recovery.replacement.wait} min wait.</p>{accepted ? <p>{accepted}</p> : <PillButton onClick={() => setAccepted('Replacement accepted for this simulation.')}>Accept replacement</PillButton>}</> : <p>No replacement fits the remaining budget. Add {money(recovery.extraBudget)} per traveller to unlock an alternative.</p>}</> : <p>Connection holds with {recovery.buffer} minutes of buffer.</p>)}</div>
    </div>}
    {!token &&
      <form className="yt-assistant-form" onSubmit={join}>
        <h3>{code ? 'Join this trip group' : 'Plan with your group'}</h3>
        <div className="yt-stop-grid">
          <label>Your name<input id="yt-group-name" value={name} onChange={event => setName(event.target.value)} maxLength={32} required/></label>
          <label>Home city<input value={home} onChange={event => setHome(event.target.value)} maxLength={60} required/></label>
          <label>Travel style<select value={style} onChange={event => setStyle(event.target.value)}>{['Budget', 'Balanced', 'Comfort'].map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Crowd preference<select value={crowds} onChange={event => setCrowds(event.target.value)}>{['Prefer quiet', 'Flexible', 'Like lively places'].map(value => <option key={value}>{value}</option>)}</select></label>
        </div>
        <fieldset className="yt-interests"><legend>Interests</legend>{['Beach', 'Forest trek', 'Culture', 'Food'].map(interest => <label key={interest}><input type="checkbox" checked={interests.includes(interest)} onChange={() => setInterests(current => current.includes(interest) ? current.filter(item => item !== interest) : [...current, interest])}/>{interest}</label>)}</fieldset>
        <div className="yt-detail-row"><strong>What we learned about you</strong><p>{home || 'Your home city'} / {style} travel / {crowds}{interests.length ? ' / ' + interests.join(', ') : ''}</p></div>
        <label>Fare budget per traveller<input type="number" min="1000" max="100000" value={budget} onChange={event => setBudget(event.target.value)} required/></label>
        <label>Travel priority<select value={priority} onChange={event => {setPriority(event.target.value); save('priority', event.target.value)}}><option value="explore">Most unique</option><option value="value">Cheapest</option><option value="comfort">Fastest</option><option value="safe">Safest connection</option></select></label>
        <PillButton primary type="submit" disabled={busy || !name.trim()}>{code ? 'Join group' : 'Create group'}</PillButton>
      </form>}
    {active && <form className="yt-assistant-form yt-detail-row" onSubmit={event => {
      event.preventDefault()
      feedback(active, Number(new FormData(event.currentTarget).get('rating')))
    }}>
      <h3>Post-trip feedback</h3>
      <label>How was this journey?<select name="rating" defaultValue="4"><option value="4">I would take it again</option><option value="-4">I would choose a different route</option></select></label>
      <PillButton type="submit">Save feedback</PillButton>
    </form>}
  </div>{journey.destination === 'Goa' ? <GoaMap/> : <a className="yt-pill-button" href={'https://www.openstreetmap.org/search?query=' + encodeURIComponent(journey.destination)} target="_blank" rel="noreferrer">Open destination map <ArrowUpRight size={16}/></a>}</div>
}

function Itinerary({trip, dates, selected, setSelected, open, exportPlan}) {
  const day = trip.days[selected]
  return <>
    <div className="yt-dates" aria-label="Trip dates">
      {dates.map((date, i) => <button type="button" key={date.toISOString()} onClick={() => setSelected(i)} aria-pressed={i === selected}><b>{date.getUTCDate()}</b><span>{date.toLocaleDateString('en-IN', {weekday: 'short', timeZone: 'UTC'})}</span></button>)}
    </div>
    <div className="yt-stop-grid">{day.stops.map(stop => <article className="yt-tile yt-stop" key={stop.name}>
      <span className="yt-symbol">{stop.name === 'Land GOI' ? <Plane size={17}/> : <MapPin size={17}/>}</span><h3>{stop.name}</h3><div><span className="yt-time">{stop.day !== undefined && stop.day !== selected ? dates[stop.day].toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'}) + ' / ' : ''}{stop.time}</span><IconButton icon={ArrowUpRight} label={stop.name + ' details'} onClick={() => open('Stop details', {...stop, day: stop.day ?? selected})}/></div>
    </article>)}</div>
    <div className="yt-quick">{[['Bookings', Luggage, () => open('Bookings')], ['Map', Map, () => open('Trip map')], ['Download', ArrowDownToLine, exportPlan]].map(([label, Icon, action]) => <button type="button" key={label} onClick={action}><Icon size={20}/><span>{label}</span></button>)}</div>
    <section className="yt-card yt-spend-card"><div className="yt-card-heading"><span className="yt-symbol"><ChartNoAxesColumn size={19}/></span><div><h3>Day {(selected + 1) + ': ' + day.title}</h3><p>Daily spend</p></div></div>
      <Chart dates={dates} spending={trip.spending} selected={selected} onSelect={setSelected}/>
    </section>
  </>
}

function Budget({trip, open, section, setSection}) {
  return <>
    <div className="yt-segments" aria-label="Budget view">{['Spending', 'Sources'].map(tab => <button type="button" key={tab} aria-pressed={tab === section} onClick={() => setSection(tab)}>{tab}</button>)}</div>
    {section === 'Sources' ? <section className="yt-card yt-stack"><h2>Budget sources</h2><p>Sample expenses for {trip.name}.</p><PillButton onClick={() => open('Online travel sources')}>Check provider prices <ArrowUpRight size={17}/></PillButton></section> : <>
      <section className="yt-card yt-budget-main">
        <div className="yt-card-heading"><span className="yt-symbol"><Receipt size={20}/></span><div><h2>Trip spend tracked</h2><p>{trip.name} / {money(trip.budget)} budget</p></div></div>
        <Gauge percent={trip.percent} needle/>
        <div className="yt-budget-total"><span>Spent so far: {trip.percent}%</span><strong className="yt-number">{money(trip.spent)}</strong></div>
        <PillButton primary onClick={() => open('Expenses')}>View all expenses <ChevronRight size={18}/></PillButton>
      </section>
      <div className="yt-stop-grid yt-budget-tiles">
        <section className="yt-tile"><span className="yt-symbol"><Users size={18}/></span><strong>{money(trip.spent / trip.travellers)} each</strong><p>Split {trip.travellers}</p></section>
        <section className="yt-tile"><span className="yt-symbol"><Wallet size={18}/></span><strong>{money(Math.abs(trip.remaining))} {trip.remaining < 0 ? 'over' : 'left'}</strong><p className={trip.remaining < 0 ? 'yt-warning' : ''}>{trip.remaining < 0 ? 'Over budget' : 'On track'}</p></section>
      </div>
      <PillButton onClick={() => open('Add expense')}><Plus size={17}/> Add expense</PillButton>
    </>}
  </>
}
function ExpenseForm({trip, onAdd}) {
  const [error, setError] = useState('')
  function submit(event) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    const name = String(fields.get('name')).trim()
    if (!name) {setError('Enter an expense name.'); return}
    onAdd({name, amount: Number(fields.get('amount')), day: Number(fields.get('day'))})
  }
  return <form className="yt-assistant-form" onSubmit={submit}>
    <label>Expense name<input name="name" maxLength={70} required placeholder="Taxi to Palolem"/></label>
    <label>Amount in rupees<input name="amount" type="number" min="1" max="1000000" required/></label>
    <label>Trip day<select name="day">{trip.days.map((day, i) => <option key={day.title} value={i}>Day {i + 1} / {day.title}</option>)}</select></label>
    <p role="status">{error}</p><PillButton type="submit" primary>Save sample expense <Check size={17}/></PillButton>
  </form>
}

export function Yatra({view, scenario, libraryState, navigate}) {
  const rehan = scenario === 'rehan'
  const [day, setDay] = useState(2)
  const [section, setSection] = useState('Spending')
  const [base, setBase] = useState(seed)
  const [panel, setPanel] = useState(() => view === 'itinerary' && (rehan || new URLSearchParams(location.search).has('group')) ? {name: 'Compare routes'} : null)
  const [code, setCode] = useState(() => {
    const value = new URLSearchParams(location.search).get('group') || stored('group', '')
    return /^[\w-]{16}$/.test(value) ? value : ''
  })
  const [sourceStatus, setSourceStatus] = useState('')
  const [onlineWeather, setOnlineWeather] = useState(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const [notice, setNotice] = useState('')
  const accountExpenses = libraryState.library.sampleExpenses
  const demo = rehan ? {...base, name: 'Rehan’s December trip', date: '2026-12-12', travellers: 5, budget: 75000} : base
  const dates = datesFor(demo)
  const expenses = [...demo.expenses, ...(rehan ? [] : accountExpenses)]
  const spending = dates.map((_, i) => expenses.filter(item => item.day === i).reduce((sum, item) => sum + item.amount, 0))
  const spent = spending.reduce((sum, amount) => sum + amount, 0)
  const trip = {...demo, expenses, spending, spent, onlineWeather, remaining: demo.budget - spent, percent: Math.round(spent / demo.budget * 100)}
  const close = () => setPanel(null)
  const open = (name, details) => setPanel({name, details})

  useEffect(() => {
    const controller = new AbortController()
    request('yatra/sample', {signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2500)])})
      .then(data => {if (data?.days?.length) setBase(data); else setSourceStatus('Offline sample available')})
      .catch(() => {if (!controller.signal.aborted) setSourceStatus('Offline sample available')})
    function loadWeather() {
      travelData('yatra/weather?departure=' + demo.date, {signal: controller.signal})
        .then(data => {if (!controller.signal.aborted) setOnlineWeather(data)})
        .catch(() => {
          if (!controller.signal.aborted) setOnlineWeather({
            temperature: seed.weather, conditions: 'Sample weather', forecast: [], freshness: 'simulated',
          })
        })
    }
    function connectionChanged() {
      setOnline(navigator.onLine)
      loadWeather()
    }
    if (view !== 'sources') loadWeather()
    window.addEventListener('online', connectionChanged)
    window.addEventListener('offline', connectionChanged)
    return () => {
      controller.abort()
      window.removeEventListener('online', connectionChanged)
      window.removeEventListener('offline', connectionChanged)
    }
  }, [demo.date, view])

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(timer)
  }, [notice])

  function changeCode(value) {
    save('group', value)
    setCode(value)
  }

  function exportPlan() {
    download('goa-itinerary.txt', [sampleLabel, trip.name, trip.origin + ' to ' + trip.destination + ', ' + tripDates(dates), trip.stay,
      ...trip.days.flatMap((day, i) => [dates[i].toISOString().slice(0, 10) + ' ' + day.title, ...day.stops.filter(stop => stop.day === undefined).map(stop => stop.time + ' ' + stop.name)])])
    setNotice('Itinerary downloaded.')
  }

  function exportExpenses() {
    download('goa-escape-expenses.csv', ['Data,Expense,Amount INR', ...trip.expenses.map(item => sampleLabel + ',"' +
      (/^[=+@-]/.test(item.name) ? "'" : '') + item.name.replaceAll('"', '""') + '",' + item.amount)])
    setNotice('Expense report downloaded.')
  }

  function addExpense(expense) {
    if (!libraryState.ready) {setNotice('Your library is still loading. Try again in a moment.'); return}
    if (accountExpenses.length >= 100) {setNotice('The sample supports up to 100 added expenses.'); return}
    libraryState.change(data => ({...data, sampleExpenses: [...data.sampleExpenses, expense]}))
    close()
    setNotice('Sample expense saved.')
  }

  let content
  switch (panel?.name) {
    case 'Ask YatraBuddy': content = <Assistant trip={trip} profile={libraryState.library.profile} openOnline={() => open('Online travel sources')}/>; break
    case 'Compare routes': content = <Journeys trip={trip} code={code} setCode={changeCode} rehan={rehan}/>; break
    case 'Add expense': content = <ExpenseForm trip={trip} onAdd={addExpense}/>; break
    case 'Expenses': content = <div className="yt-stack"><p className="yt-sample">{sampleLabel}</p>{trip.expenses.map((item, index) => <div key={index} className="yt-detail-row yt-expense"><span>{item.name}</span><strong>{money(item.amount)}</strong></div>)}<PillButton onClick={exportExpenses}><ArrowDownToLine size={17}/> Download CSV</PillButton></div>; break
    case 'Stop details': content = <div className="yt-stack"><p className="yt-sample">{sampleLabel}</p><h3>{panel.details.name}</h3><p>{panel.details.time} / {dates[panel.details.day].toLocaleDateString('en-GB', {day: 'numeric', month: 'long', timeZone: 'UTC'})}</p><p>{panel.details.place}</p></div>; break
    case 'Bookings': content = <div className="yt-stack"><p className="yt-sample">{sampleLabel}</p>{[trip.stay, 'Delhi to Goa flight', 'Palolem transfer'].map(name => <div className="yt-detail-row yt-expense" key={name}><span>{name}</span><Check size={18}/></div>)}</div>; break
    case 'Trip map': content = <GoaMap initiallyOpen/>; break
    case 'Weather': content = <WeatherDetails weather={onlineWeather}/>; break
    case 'Online travel sources': content = <OnlineTravel trip={trip} dates={dates}/>; break

  }

  const titles = {itinerary: 'Your itinerary', budget: 'Trip budget', sources: 'Online travel sources'}
  return <div className="page inner-page yt-desktop">
    <header className="yt-desktop-heading">
      <div><h1>{titles[view]}</h1>{view !== 'sources' && <p>{trip.name} / {trip.origin} to {trip.destination} / {tripDates(dates)}</p>}</div>
      {view === 'itinerary' && <PillButton primary onClick={() => open('Compare routes')}>Compare routes and vote <ArrowRight size={17}/></PillButton>}
      {view === 'budget' && <PillButton onClick={exportExpenses}><ArrowDownToLine size={17}/> Download expenses</PillButton>}
    </header>
    {!online && <p role="status">Offline. Saved results and the trip simulation are available.</p>}
    {view !== 'sources' && <p className="yt-sample"><i/>{sampleLabel}{sourceStatus ? ' / ' + sourceStatus : ''}</p>}
    {view === 'sources' ? <OnlineTravel trip={trip} dates={dates}/> : <div className="yt-desktop-layout">
      <div className={'yt-desktop-content yt-desktop-' + view}>
        {view === 'itinerary' ? <Itinerary trip={trip} dates={dates} selected={day} setSelected={setDay} open={open} exportPlan={exportPlan}/> :
          <Budget trip={trip} open={open} section={section} setSection={setSection}/>}
      </div>
      <aside className="yt-desktop-aside">
        <div className="yt-destination-photo"><img src="/images/goa.jpg" alt="Goa coastline"/><div><h2>{trip.name}</h2><p>{trip.stay}</p></div></div>
        <section className="yt-card yt-stack"><h2>Trip details</h2><p>{trip.travellers} travellers / {trip.days.length} days</p>
          <PillButton onClick={() => open('Weather')}><CloudSun size={18}/> {onlineWeather ? 'Palolem ' + Math.round(onlineWeather.temperature) + '°C' : 'Palolem forecast'} <ChevronRight size={17}/></PillButton>
          {onlineWeather && <small className="yt-freshness">{freshnessLabel(onlineWeather)} · {onlineWeather.freshness === 'simulated' ? 'Sample weather' : 'Open-Meteo'}</small>}
          <PillButton onClick={() => navigate('sources')}><Globe size={18}/> Check online providers <ChevronRight size={17}/></PillButton>
          <PillButton onClick={() => open('Ask YatraBuddy')}><Sparkles size={18}/> Ask about this trip <ChevronRight size={17}/></PillButton>
        </section>
      </aside>
    </div>}
    {notice && <div className="yt-toast" role="status">{notice}</div>}
    {panel && <Sheet key={panel.name} title={panel.name} close={close}>{content}</Sheet>}
  </div>
}

function WeatherDetails({weather}) {
  return <div className="yt-stack">
    {weather ? <>
      <h3>Palolem {Math.round(weather.temperature)}°C</h3>
      <p className="yt-freshness">{freshnessLabel(weather)}</p>
      <p>{weather.conditions}{weather.time && ' / Model time ' + weather.time.replace('T', ' ') + ' (' + weather.timezone + ')'}</p>
      {weather.freshness !== 'simulated' && !weather.forecast.length && <p>Forecasts for these trip dates are unavailable.</p>}
      {weather.forecast.map(day => <div className="yt-detail-row yt-expense" key={day.date}><span>{day.date}</span><strong>{Math.round(day.min)} to {Math.round(day.max)}°C</strong></div>)}
    </> : <p>Online weather is unavailable. Open the forecast to check current conditions.</p>}
    <a className="yt-pill-button" href={weather?.url || 'https://open-meteo.com/en/docs?latitude=15.008889&longitude=74.022778'} target="_blank" rel="noreferrer">Open-Meteo <ArrowUpRight size={17}/></a>
  </div>
}

function OnlineTravel({trip, dates}) {
  const [available, setAvailable] = useState(false)
  const [arrival, setArrival] = useState(trip.date)
  const [departure, setDeparture] = useState(dates.at(-1).toISOString().slice(0, 10))
  const [stays, setStays] = useState(null)
  const [road, setRoad] = useState(null)
  const [hotelStatus, setHotelStatus] = useState('')
  const [roadStatus, setRoadStatus] = useState('')
  const [pending, setPending] = useState(false)
  const [routing, setRouting] = useState(false)
  const [nearby, setNearby] = useState(null)
  const [locationStatus, setLocationStatus] = useState('')
  const bookingQuery = new URLSearchParams({ss: 'Palolem, Goa', checkin: arrival, checkout: departure,
    group_adults: String(trip.travellers), no_rooms: String(Math.ceil(trip.travellers / 2))})
  const uberQuery = new URLSearchParams({action: 'setPickup', pickup: 'my_location',
    'dropoff[latitude]': '15.008889', 'dropoff[longitude]': '74.022778', 'dropoff[nickname]': 'Palolem Beach'})

  useEffect(() => {
    const controller = new AbortController()
    request('partners', {signal: controller.signal}).then(data => setAvailable(Boolean(data?.bookingSearch))).catch(() => {})
    return () => controller.abort()
  }, [])

  async function findStays(event) {
    event.preventDefault()
    setPending(true)
    setHotelStatus('')
    setStays(null)
    try {
      const result = await request('stays/search', {method: 'POST', body: {destination: 'goa', checkin: arrival, checkout: departure, adults: trip.travellers}})
      setStays(result.stays)
      if (!result.stays.length) setHotelStatus('No stays were returned for these dates.')
    } catch (error) {setHotelStatus(error.message)}
    finally {setPending(false)}
  }

  async function findRoad() {
    setRouting(true)
    setRoadStatus('')
    try {
      const result = await travelData('road-route', {method: 'POST', body: {destination: 'goa', stops: ['Palolem Beach', 'Cabo de Rama Fort']}})
      if (!result?.legMinutes?.length) throw new Error('No route returned')
      setRoad(result)
    } catch {
      setRoad({kilometres: 24, legMinutes: [45], freshness: 'simulated'})
      setRoadStatus('Online routing is unavailable. This sample is for the demo.')
    }
    finally {setRouting(false)}
  }

  function useLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('Location is unavailable in this browser.')
      return
    }
    setLocationStatus('Waiting for your location…')
    navigator.geolocation.getCurrentPosition(({coords}) => {
      const radians = degrees => degrees * Math.PI / 180
      const distance = hub => {
        const lat = radians(hub.lat - coords.latitude)
        const lon = radians(hub.lon - coords.longitude)
        const a = Math.sin(lat / 2) ** 2 + Math.cos(radians(coords.latitude)) *
          Math.cos(radians(hub.lat)) * Math.sin(lon / 2) ** 2
        return 12742 * Math.asin(Math.sqrt(Math.min(1, a)))
      }
      const ranked = seed.goaHubs.map(hub => ({...hub, distance: distance(hub)})).sort((a, b) => a.distance - b.distance)
      setNearby({lat: coords.latitude, lon: coords.longitude, hubs: ['Airport', 'Rail station'].map(kind => ranked.find(hub => hub.kind === kind))})
      setLocationStatus('')
    }, error => {
      setLocationStatus(error.code === 1 ? 'Location permission is off. You can still open the Goa map.' : 'Could not get your location.')
    }, {timeout: 8000, maximumAge: 60000})
  }

  const sources = [
    ['Flights', Plane, 'IndiGo', 'Check flight prices and availability for Delhi to Goa.', 'https://www.goindigo.in/'],
    ['Trains', TrainFront, 'IRCTC', 'Check train times, availability and fares.', 'https://www.irctc.co.in/nget/train-search'],
    ['Ride-hailing', Car, 'Uber', 'Set your pickup to see the current fare to Palolem.', 'https://m.uber.com/ul/?' + uberQuery],
    ['Bus', Route, 'redBus', 'Check bus fares and schedules for your dates.', 'https://www.redbus.in/'],
    ['Ferries', Ship, 'Goa River Navigation Department', 'The department lists free ferry service for public commuters. Check routes and vehicle charges with the department.', 'https://rnd.goa.gov.in/'],
    ['River cruises', Ship, 'Goa Tourism', 'Check Mandovi cruise schedules and activity prices.', 'https://bookings.goa-tourism.com/Appln/UIL/ActivitiesHome'],
    ['Ocean cruises', Ship, 'Cordelia Cruises', 'Check Goa sailings and cabin prices.', 'https://www.cordeliacruises.com/'],
    ['Destination guide', Globe, 'Wikivoyage', 'Find places to visit and practical information for Palolem.', 'https://en.wikivoyage.org/wiki/Palolem'],
  ]
  return <div className="yt-stack">
    <p>Current fares and availability come from the provider. Choose your travel dates and check the quote on its site.</p>
    <form className="yt-detail-row yt-assistant-form" onSubmit={findStays}>
      <h3 className="yt-inline"><BedDouble size={18}/> Hotels</h3>
      <div className="yt-stop-grid"><label>Check-in<input type="date" value={arrival} onChange={event => setArrival(event.target.value)} required/></label><label>Check-out<input type="date" min={arrival} value={departure} onChange={event => setDeparture(event.target.value)} required/></label></div>
      {available && <PillButton type="submit" primary disabled={pending}>{pending ? 'Checking Booking.com' : 'Search live hotel prices'}</PillButton>}
      <a className="yt-pill-button" href={'https://www.booking.com/searchresults.html?' + bookingQuery} target="_blank" rel="noreferrer">Check Booking.com prices <ArrowUpRight size={17}/></a>
      {hotelStatus && <p role="status">{hotelStatus}</p>}
      {stays?.map(stay => <a className="yt-pill-button" href={stay.url} target="_blank" rel="noreferrer" key={stay.id}>{stay.name} / {stay.amount === null ? 'View price' : money(stay.amount)}<ArrowUpRight size={17}/></a>)}
    </form>
    <section className="yt-detail-row yt-stack">
      <h3 className="yt-inline"><Map size={18}/> Road and maps</h3>
      <p>Palolem Beach to Cabo de Rama Fort.</p>
      <PillButton onClick={findRoad} disabled={routing}>{routing ? 'Checking road route' : 'Calculate route with OSRM'}</PillButton>
      {road && <p role="status"><strong>{freshnessLabel(road)}</strong> · {road.kilometres} km / {duration(road.legMinutes[0])}{road.freshness !== 'simulated' && ' / OSRM estimate without live traffic'}</p>}
      {roadStatus && <p role="status">{roadStatus}</p>}
      <a className="yt-pill-button" href="https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=15.008889%2C74.022778%3B15.0889%2C73.9204" target="_blank" rel="noreferrer">Open OpenStreetMap route <ArrowUpRight size={17}/></a>
    </section>
    <section className="yt-detail-row yt-stack">
      <h3 className="yt-inline"><MapPin size={18}/> Goa transport near you</h3>
      <PillButton onClick={useLocation}>Use my location</PillButton>
      {locationStatus && <p role="status">{locationStatus}</p>}
      {nearby && <>
        <p><strong>LIVE</strong> · Device location</p>
        <p>Closest among the listed Goa hubs, measured in a straight line.</p>
        {nearby.hubs.map(hub => <a className="yt-pill-button" key={hub.name} href={'https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=' + encodeURIComponent(nearby.lat + ',' + nearby.lon + ';' + hub.lat + ',' + hub.lon)} target="_blank" rel="noreferrer">{hub.name} · {Math.round(hub.distance)} km <ArrowUpRight size={16}/></a>)}
      </>}
    </section>
    {sources.map(([category, Icon, provider, detail, url]) => <a className="yt-detail-row yt-provider" href={url} target="_blank" rel="noreferrer" key={category}><span className="yt-provider-icon"><Icon size={18}/></span><span><strong>{category} / {provider}</strong><small>{detail}</small></span><ArrowUpRight size={17}/></a>)}
  </div>
}
