import React, {useEffect, useState} from 'react'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {ReferencePhotos} from '../components/PhotoRail.jsx'
import {Button, Icon, Pill, SourcePill} from '../components/UI.jsx'
import {fetchResearch, researchTopics} from '../research.mjs'
import {request} from '../api.mjs'

const updateTopics = {routes:'transport', events:'events', stays:'highlights', food:'highlights', experiences:'highlights', overview:'highlights'}

export function DestinationGuide({catalog, initialDestination, profile, initialTopic}) {
  const [place, setPlace] = useState(() => initialDestination?.id ? initialDestination :
    catalog.find(item => item.id === initialDestination) || catalog[0])
  const [topic, setTopic] = useState(() => [ 'overview', ...researchTopics.map(([id]) => id)].includes(initialTopic) ? initialTopic : 'overview')
  const [attempt, setAttempt] = useState(0)
  const [research, setResearch] = useState(null)
  const [updates, setUpdates] = useState(null)
  const [loading, setLoading] = useState(true)

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
  return <div className="page inner-page destination-guide">
    <header className="guide-heading"><div><h1>Destination guide</h1><p>Local highlights, practical details, and recent changes for your trip.</p></div>
      <DestinationSearch catalog={catalog} selected={place} onSelect={setPlace} global label="Choose a destination"/>
    </header>
    <div className="filters" aria-label="Guide topics">
      {[['overview', 'compass', 'At a glance'], ...researchTopics].map(([id, icon, label]) =>
        <Pill key={id} active={id === topic} icon={icon} onClick={() => setTopic(id)}>{label}</Pill>)}
    </div>
    {place.image && <div className="guide-cover"><img src={`/images/${place.image}.jpg`} alt=""/><strong>{place.name}</strong></div>}
    <DestinationBrief key={attempt} location={place} topic={topic} compact/>
    {research?.weather && <p className="guide-weather"><Icon name="globe" size={17}/> {research.weather.temperature}°C · {research.weather.conditions}{research.airQuality && ` · US AQI ${research.airQuality.index}`}</p>}
    {!!place.places?.length && topic === 'overview' && <section className="panel guide-panel"><h2>Places to consider</h2>
      <ul>{place.places.slice(0, 4).map(item => <li key={item.name}>
        <strong>{item.name}</strong>{item.category && ` · ${item.category}`}
      </li>)}</ul></section>}
    {!!research?.findings?.length && <section className="panel guide-panel"><h2>{topic === 'overview' ? 'Useful details' : 'What to check'}</h2>
      <ul>{research.findings.slice(0, 4).map(item => <li key={item.url}><strong>{item.title}</strong>
        <SourcePill url={item.url} label={item.provider}/></li>)}</ul>
    </section>}
    <section className="guide-updates">
      <div className="section-heading"><h2>Recent updates</h2><Button icon="refresh" disabled={loading} onClick={() => setAttempt(value => value + 1)}>Refresh</Button></div>
      {loading && <p role="status">Checking for recent updates…</p>}
      {!loading && !stories.length && <p className="form-note">{updates && updates.status !== 'unavailable' ? 'No recent updates for this topic.' : 'Recent updates are temporarily unavailable.'}</p>}
      {!!stories.length && <div className="guide-stories">{stories.map(story => <article className="panel" key={story.url}>
        {story.images?.[0] && <img alt="" src={story.images[0]} loading="lazy" referrerPolicy="no-referrer" onError={event => {event.currentTarget.hidden = true}}/>}
        <div><small>{[story.publisher, story.date && new Date(story.date).toLocaleDateString()].filter(Boolean).join(' · ')}</small>
          <h3>{story.title}</h3><SourcePill url={story.url} label="Read update"/></div>
      </article>)}</div>}
    </section>
    {!place.image && <ReferencePhotos key={place.id} location={place} limit={4} grid description="Licensed destination photos."/>}
  </div>
}
