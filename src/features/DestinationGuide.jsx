import {useMapPanel} from './useMapPanel.mjs'
import React, {useEffect, useRef, useState} from 'react'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {TravelHighlights} from '../components/TravelHighlights.jsx'
import {GoogleMapsLink} from '../components/GoogleMapsLink.jsx'
import {revealMapCard} from '../components/revealMapPlace.mjs'
import {Button, Dialog, Icon, Pill, SourcePill} from '../components/UI.jsx'
import {PlaceDetails} from './PlaceDetails.jsx'
import {JourneyMap, mapPlaceId} from './JourneyMap.jsx'
import {useNearbyDiscovery} from './DiscoveryFeed.jsx'
import {fetchResearch, researchTopics} from '../research.mjs'
import {request} from '../api.mjs'

const updateTopics = {routes:'transport', events:'events', stays:'highlights', food:'highlights', experiences:'highlights', overview:'highlights'}

export function DestinationGuide({catalog, initialDestination, profile, initialTopic, onPlan, onAsk}) {
  const [place, setPlace] = useState(() => initialDestination?.id ? initialDestination :
    catalog.find(item => item.id === initialDestination) || catalog[0])
  const [topic, setTopic] = useState(() => [ 'overview', ...researchTopics.map(([id]) => id)].includes(initialTopic) ? initialTopic : 'overview')
  const [attempt, setAttempt] = useState(0)
  const [research, setResearch] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [loading, setLoading] = useState(true)
  const [resolved, setResolved] = useState(null)
  const [selected, setSelected] = useState(null)
  const [pin, setPin] = useState(null)
  const placeCards = useRef(null)
  const [mapOpen, setMapOpen] = useMapPanel()
  const mapToggle = useRef(null)
  const cityId = place.id.startsWith('geo:') ? place.id.slice(4) : resolved?.key === place.id ? resolved.id : null
  const {report, photosPending} = useNearbyDiscovery(cityId)

  useEffect(() => {
    if (place.id.startsWith('geo:')) return
    const controller = new AbortController()
    request('locations?q=' + encodeURIComponent(place.name), {signal:controller.signal}).then(rows => {
      const regions = [place.region, ...(place.region || '').split(',').map(part => part.trim())]
      const match = rows.find(row => row.name.toLowerCase() === place.name.toLowerCase() &&
        (!place.region || [row.region, row.country].some(region => region && regions.includes(region))))
      if (!controller.signal.aborted) setResolved({key:place.id, id:match?.id})
    }).catch(() => {})
    return () => controller.abort()
  }, [place.id, place.name, place.region])

  useEffect(() => {
    const controller = new AbortController()
    const {signal} = controller
    const params = new URLSearchParams({topic:updateTopics[topic], days:'14'})
    if (place.id.startsWith('geo:')) params.set('location_id', place.id.slice(4))
    else params.set('destination', place.id)
    setResearch(null)
    setUpdates(null)
    setLoading(true)
    Promise.allSettled([
      fetchResearch(place, {topic, profile, refresh:attempt > 0, signal}).then(data => {if (!signal.aborted) setResearch(data)}),
      request('news?' + params, {signal}).then(data => {if (!signal.aborted) setUpdates(data)}),
    ]).then(() => {if (!signal.aborted) setLoading(false)})
    return () => controller.abort()
  }, [place, topic, profile, attempt])

  const stories = (updates?.articles || []).slice().sort((a, b) => Boolean(b.images?.length) - Boolean(a.images?.length)).slice(0, 3)
  const categories = {stays:['Stay'], food:['Food'], experiences:['Sight','Nature','Activity','Shopping']}
  const places = (report?.places || []).filter(item => !categories[topic] || categories[topic].includes(item.category))
  const featured = [...places].sort((a,b) => Number(Boolean(b.photo?.url && b.photo.kind !== 'nearby')) -
    Number(Boolean(a.photo?.url && a.photo.kind !== 'nearby'))).slice(0, 8)
  const remaining = places.filter(item => !featured.includes(item))
  const collections = [
    ['Sights and culture', ['Sight', 'Shopping']],
    ['Nature and outdoors', ['Nature']],
    ['Activities', ['Activity']],
    ['Food and drink', ['Food']],
  ].map(([title, kinds]) => [title, places.filter(item => kinds.includes(item.category)).slice(0, 3)])
  const point = report?.location || place.places?.[0] || place
  const center = {...point, name:place.name}
  const canMap = Number.isFinite(center.lat) && Number.isFinite(center.lon)
  return <div className="page inner-page destination-guide">
    <header className="guide-heading"><div><h1>Destination guide</h1><p>Local highlights, practical details, and recent changes for your trip.</p></div>
      <DestinationSearch catalog={catalog} selected={place} onSelect={setPlace} global label="Choose a destination"/>
    </header>
    <div className="guide-actions">
      <GoogleMapsLink place={place} region={place.region || place.country}/>
      {onPlan && <Button variant="primary" icon="chat" onClick={() => onPlan('', place.id, place)}>Plan {place.name}</Button>}
      {onAsk && <Button icon="sparkle" onClick={() => onAsk(`What should I know before a trip to ${place.name}? Include how to get there, a realistic budget, and what to do first.`)}>Ask about {place.name}</Button>}
    </div>
    <div className="filters" aria-label="Guide topics">
      {[['overview', 'compass', 'At a glance'], ...researchTopics].map(([id, icon, label]) =>
        <Pill key={id} active={id === topic} icon={icon} onClick={() => setTopic(id)}>{label}</Pill>)}
    </div>
    {place.image && <div className="guide-cover"><img src={`/images/${place.image}.jpg`} alt=""/><strong>{place.name}</strong></div>}
    <DestinationBrief location={place} topic={topic} destination attempt={attempt}/>
    {research?.weather && <p className="guide-weather"><Icon name="globe" size={17}/> {research.weather.temperature}°C · {research.weather.conditions}{research.airQuality && ` · US AQI ${research.airQuality.index}`}</p>}
    {['overview','experiences'].includes(topic) && collections.some(([, items]) => items.length) && <section className="panel guide-panel">
      <h2>Places to consider</h2><div className="guide-quick-places">
        {collections.filter(([, items]) => items.length).map(([title, items]) => <div key={title}>
          <h3>{title}</h3><ul>{items.map(item => <li key={item.url}>
            <button type="button" className="guide-place-name" onClick={() => setSelected(item)}>{item.name}</button>
            {item.publishedPrice && <small className="travel-price">{item.publishedPrice}</small>}
          </li>)}</ul>
        </div>)}
      </div>
    </section>}
    {!places.length && !!place.places?.length && topic === 'overview' && <section className="panel guide-panel"><h2>Places to consider</h2>
      <ul>{place.places.slice(0, 4).map(item => <li key={item.name}>
        <strong>{item.name}</strong>{item.category && ` · ${item.category}`}
      </li>)}</ul></section>}
    {!!research?.findings?.length && <details className="panel guide-panel"><summary>More sources to check</summary>
      <ul>{research.findings.slice(0, 4).map(item => <li key={item.url}><strong>{item.title}</strong>
        <SourcePill url={item.url} label={item.provider}/></li>)}</ul>
    </details>}
    <section className="guide-updates">
      <div className="section-heading"><h2>Recent updates</h2><Button icon="refresh" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Refresh</Button></div>
      {loading && <p role="status">Checking for recent updates…</p>}
      {!loading && !stories.length && <p className="form-note">{updates && updates.status !== 'unavailable' ? 'No recent updates for this topic.' : 'Recent updates are temporarily unavailable.'}</p>}
      {!!stories.length && <div className="guide-stories">{stories.map(story => <article className="panel" key={story.url}>
        {story.images?.[0] && <a className="place-photo-open" href={story.url} target="_blank" rel="noreferrer" aria-label={`Read ${story.title}`}><img alt="" src={story.images[0]} loading="lazy" referrerPolicy="no-referrer" onError={event => {event.currentTarget.parentElement.hidden = true}}/></a>}
        <div><small>{[story.publisher, story.date && new Date(story.date).toLocaleDateString()].filter(Boolean).join(' · ')}</small>
          <h3>{story.title}</h3><SourcePill url={story.url} label="Read update"/></div>
      </article>)}</div>}
    </section>
    <div className={'discovery-layout' + (canMap && mapOpen ? ' discovery-with-map' : '')}>
    <section ref={placeCards} className="guide-places" aria-label="Place photos and details">
      <div className="world-list-heading"><h2>Places in {place.name}</h2>
        {canMap && <Button ref={mapToggle} icon="map" aria-expanded={mapOpen} onClick={() => setMapOpen(value => !value)}>{mapOpen ? 'Hide map' : 'Show map'}</Button>}
      </div>
      <div className="guide-stories">{featured.map(item => <article className="panel" key={item.url} data-map-place={mapPlaceId(item)} tabIndex={-1}>
        <PlacePhoto place={item} lookup hideUnavailable onOpen={() => setSelected(item)}/>
        <div><small>{item.category}{Number.isFinite(item.rating) ? ` · ★ ${item.rating}` : ''}</small>
          <h3><button type="button" className="guide-place-name" onClick={() => setSelected(item)}>{item.name}</button></h3>
          {item.publishedPrice && <p><strong className="travel-price">{item.publishedPrice}</strong></p>}
          {item.description && <TravelHighlights text={item.description} limit={1}/>}
          <GoogleMapsLink place={item} region={place.name}/>
        </div>
      </article>)}</div>
      {!featured.length && <p className="form-note">{photosPending ? 'Checking place photos…' : 'No listings available for this view.'}</p>}
      {!!remaining.length && <details><summary>More places and details</summary><div className="guide-stories">
        {remaining.map(item => <article className="panel" key={item.url} data-map-place={mapPlaceId(item)} tabIndex={-1}>
          <PlacePhoto place={item} lookup hideUnavailable onOpen={() => setSelected(item)}/>
          <div><small>{item.category}</small><h3><button type="button" className="guide-place-name" onClick={() => setSelected(item)}>{item.name}</button></h3>
            {item.publishedPrice && <p><strong className="travel-price">{item.publishedPrice}</strong></p>}
            {item.description && <TravelHighlights text={item.description} limit={1}/>}
            <GoogleMapsLink place={item} region={place.name}/></div>
        </article>)}
      </div></details>}
    </section>
    {canMap && mapOpen && <div className="discovery-map-panel"><JourneyMap key={place.id} center={center}
      places={places} selectedId={pin} onSelect={item => {
        if (!item) return
        const id = mapPlaceId(item)
        setPin(id)
        if (!revealMapCard(placeCards.current,id)) setSelected(item)
      }} onClose={() => {setMapOpen(false);mapToggle.current?.focus()}}/></div>}
    </div>
    {selected && <Dialog label={selected.name} className="discovery-details-dialog" onClose={() => setSelected(null)}>
      <PlaceDetails key={selected.url} place={selected} initialTab="media"/>
    </Dialog>}
  </div>
}
