import {useMapPanel} from './useMapPanel.mjs'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {BedDouble, CloudSun, Compass, Heart, Landmark, MapPin, Minus, Mountain, Plus, Utensils} from 'lucide-react'
import {AgentProgress, Button, Dialog, Pill} from '../components/UI.jsx'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {request} from '../api.mjs'
import {JourneyMap, mapPlaceId} from './JourneyMap.jsx'
import {PlaceDetails} from './PlaceDetails.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {PlaceSummary} from '../components/PlaceSummary.jsx'
import {summarizePlaces} from './travelSummary.mjs'
import {revealResult} from '../components/revealResult.mjs'
import {
  discoveryPlaceKey, placeInterestScores, rankDiscoveryPlaces, toggleDiscoverySaved,
  toggleDiscoveryShortlist, useDiscoveryShortlist, useSavedDiscoveryPlaces,
} from './discoveryPlaces.mjs'
import './DiscoveryFeed.css'

const collections = [
  {key: 'sights', title: 'Places to visit', filter: 'Sights', icon: Landmark, categories: ['Sight', 'Activity', 'Shopping']},
  {key: 'outdoors', title: 'Nature & outdoors', filter: 'Outdoors', icon: Mountain, categories: ['Nature']},
  {key: 'food', title: 'Cafés & places to eat', filter: 'Food & cafés', icon: Utensils, categories: ['Food']},
  {key: 'stays', title: 'Hotels & stays', filter: 'Stays', icon: BedDouble, categories: ['Stay']},
]

export function DiscoveryCard({place, saved, selected, onOpen, onSave, onSelect}) {
  const distance = Number.isFinite(place.distanceMetres)
    ? `${(place.distanceMetres / 1000).toLocaleString(undefined, {maximumFractionDigits: 1})} km from center` : ''
  const rating = Number.isFinite(place.rating) ? place.rating.toFixed(1) : null
  const [interest, score] = Object.entries(placeInterestScores(place)).sort((a, b) => b[1] - a[1])[0]
  return <article className="discovery-card">
    <div className="discovery-card-media"><PlacePhoto place={place} lookup hideUnavailable onOpen={onOpen}/></div>
    <div className="discovery-card-caption">
      <h4><button type="button" onClick={onOpen}>{place.name}</button></h4>
      {rating && <strong className="discovery-rating" aria-label={`${rating} out of 5 traveler rating`}>★ {rating}</strong>}
      <p>{place.category === 'Stay' ? 'Stay' : place.category}{distance && ` · ${distance}`}</p>
      <p>{place.publishedPrice || (score > 0 ? `${interest} match ${score}/5` : place.discoveryCity?.name)}</p>
    </div>
    {(onSave || onSelect) && (
      <div className="discovery-card-actions">
        {onSave && <button type="button" aria-pressed={saved} className="discovery-card-action discovery-save"
          aria-label={(saved ? 'Unsave ' : 'Save ') + place.name} onClick={onSave}>
          <Heart size={19} fill={saved ? 'currentColor' : 'none'}/>
        </button>}
        {onSelect && <button type="button" aria-pressed={selected} className="discovery-card-action discovery-add"
          aria-label={selected ? `Remove ${place.name} from trip` : `Add ${place.name} to trip`} onClick={onSelect}>
          {selected ? <Minus size={19}/> : <Plus size={19}/>}
        </button>}
      </div>
    )}
  </article>
}

export function DiscoveryLoading({city, photos = false}) {
  return <div className="discovery-loading">
    <AgentProgress label={photos ? 'Matching licensed photos to places' : `Finding places${city ? ` near ${city}` : ''}`}
      steps={photos ? ['Wikimedia Commons'] : ['OpenStreetMap', 'Wikipedia', 'Wikivoyage']}/>
    {!photos && <div className="discovery-skeletons" aria-hidden="true">{Array.from({length: 4}, (_, index) => <i key={index}/>)}</div>}
  </div>
}

export function useNearbyDiscovery(locationId, attempt = 0, meal) {
  const [snapshot, setSnapshot] = useState({id: null, report: null, error: '', photosPending: false})
  useEffect(() => {
    if (!locationId) return
    const controller = new AbortController()
    const {signal} = controller
    const base = `locations/${locationId}/nearby?` + (meal ? `meal=${encodeURIComponent(meal)}&` : '')
    const update = (report, error, photosPending) => {
      if (!signal.aborted) setSnapshot({id: locationId, attempt, meal, report, error, photosPending})
    }
    async function load() {
      try {
        const report = await request(base + 'photos=false', {signal})
        if (signal.aborted) return
        const enrich = report.status !== 'unavailable' && report.places.some(place => !place.photo?.url)
        update(report, '', enrich)
        if (enrich) {
          const enriched = await request(base + 'photos=true', {signal}).catch(() => null)
          const pictures = new Map((enriched?.places || []).map(place => [place.url, place.photo]))
          update({...report, places: report.places.map(place => pictures.get(place.url) ? {...place, photo: pictures.get(place.url)} : place)}, '', false)
        }
      } catch (failure) {
        update(null, failure.message, false)
      }
    }
    load()
    return () => controller.abort()
  }, [locationId, attempt, meal])
  return snapshot.id === locationId && snapshot.attempt === attempt && snapshot.meal === meal
    ? snapshot : {report: null, error: '', photosPending: false}
}

function DiscoveryRail({collection, places, matches, renderCard}) {
  const Icon = collection.icon
  return <section className="discovery-collection" aria-label={collection.title}>
    <header className="discovery-collection-head">
      <h3><Icon size={19}/>{collection.title}</h3>
    </header>
    {!!places.length && <div className="discovery-rail">{places.map(renderCard)}</div>}
    {!!matches.length && <details className="discovery-more" open={places.length ? undefined : true}>
      <summary>{places.length ? 'More listings' : 'Place listings'} <span>{matches.length}</span></summary>
      <div className="discovery-text-list">{matches.map(renderCard)}</div>
    </details>}
  </section>
}

export function DiscoveryWeather({cityId}) {
  const [weather, setWeather] = useState(null)
  useEffect(() => {
    if (!cityId) return
    const controller = new AbortController()
    request(`locations/${cityId}/weather`, {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setWeather(result) })
      .catch(() => {})
    return () => controller.abort()
  }, [cityId])
  if (!Number.isFinite(weather?.temperature)) return null
  return <a className="discovery-weather" href="https://open-meteo.com/" target="_blank" rel="noreferrer" title={`${weather.conditions} · Open-Meteo${weather.freshness === 'cached' ? ' · cached' : ''}`}>
    <CloudSun size={20}/><strong>{Math.round(weather.temperature)}°C</strong><span>{weather.conditions}</span>
  </a>
}

export function DiscoveryFeed({location, profile, onPlan, onAsk, onRequireAccount}) {
  const [attempt, setAttempt] = useState(0)
  const [sort, setSort] = useState('For you')
  const [category, setCategory] = useState('all')
  const [mapOpen, setMapOpen] = useMapPanel()
  const [mapFocus, setMapFocus] = useState(null)
  const [placeKey, setPlaceKey] = useState('')
  const [status, setStatus] = useState('')
  const collectionStart=useRef(null)
  const mapToggle=useRef(null)
  const cityId = String(location.id).replace(/^geo:/, '')
  const {report, error, photosPending} = useNearbyDiscovery(cityId, attempt)
  const saved = useSavedDiscoveryPlaces()
  const shortlist = useDiscoveryShortlist(cityId)
  const places = report?.places || []
  const ranked = useMemo(() => rankDiscoveryPlaces(places, sort, profile?.interests || []), [places, sort, profile?.interests])
  const activePlace = ranked.find(place => discoveryPlaceKey(place) === placeKey)
  const activeCollection = collections.find(item => item.key === category)
  const visible = activeCollection ? ranked.filter(place => activeCollection.categories.includes(place.category)) : ranked
  const hasPhoto = place => place.photo?.url && place.photo.kind !== 'nearby'
  const sorts = ['For you', 'Nearest', 'Nature', 'Culture', 'Adventure', 'Rating']

  function toggle(place) {
    if(onRequireAccount){onRequireAccount();return}
    const added = toggleDiscoveryShortlist(cityId, place)
    setStatus(added ? `${place.name} added to trip shortlist.` : `${place.name} removed from trip shortlist.`)
  }
  function selectPlace(place) {
    setPlaceKey(discoveryPlaceKey(place))
    setMapFocus(place)
  }
  function renderCard(place) {
    const key = discoveryPlaceKey(place)
    return <DiscoveryCard key={key} place={place} onOpen={() => selectPlace(place)}
      saved={!onRequireAccount&&saved.some(item => discoveryPlaceKey(item) === key)} onSave={() => onRequireAccount?onRequireAccount():toggleDiscoverySaved(place, location)}
      selected={shortlist.some(item => discoveryPlaceKey(item) === key)} onSelect={() => toggle(place)}/>
  }
  return <section className="discovery-feed" aria-label={`Places near ${location.name}`}>
    <div className="discovery-feed-controls">
      <div className="discovery-filters" role="group" aria-label="Nearby categories">
        <Pill active={category === 'all'} onClick={() => {setCategory('all');revealResult(collectionStart.current)}}>All places</Pill>
        {collections.map(item => <Pill key={item.key} active={category === item.key} onClick={() => {setCategory(item.key);revealResult(collectionStart.current)}}>{item.filter}</Pill>)}
      </div>
      <div className="discovery-feed-actions">
        <label>Sort <select value={sort} onChange={event => setSort(event.target.value)}>
          {sorts.map(value => <option key={value} disabled={value === 'Rating' && !places.some(place => Number.isFinite(place.rating))}>{value}</option>)}
        </select></label>
        <Button ref={mapToggle} icon="map" aria-expanded={mapOpen} onClick={() => setMapOpen(value => !value)}>{mapOpen ? 'Hide map' : 'Show map'}</Button>
      </div>
    </div>
    {!onRequireAccount && shortlist.length > 0 && <div className="discovery-shortlist" role="region" aria-label="Trip shortlist">
      <details>
        <summary>{shortlist.length} {shortlist.length === 1 ? 'place' : 'places'} for this trip</summary>
        <ul>{shortlist.map(place => <li key={discoveryPlaceKey(place)}>{place.name}<Button icon="minus" variant="text-btn" onClick={() => toggle(place)} aria-label={`Remove ${place.name} from trip shortlist`}>Remove</Button></li>)}</ul>
      </details>
      <Button icon="arrow" variant="primary" onClick={() => onPlan('', location.id, location, false, {selected: shortlist})}>Build itinerary</Button>
    </div>}
    <span className="yatra-sr-only" role="status">{status}</span>
    <div ref={collectionStart} className="result-scroll-anchor"/>
    <div className={'discovery-layout' + (mapOpen ? ' discovery-with-map' : '')}>
      <div className="discovery-content">
        {!report && !error && <DiscoveryLoading city={location.name}/>}
        {(error || report?.status === 'unavailable') && <div className="discovery-message" role="status">
          <p>{error || 'Nearby sources are temporarily unavailable.'}</p><Button onClick={() => setAttempt(value => value + 1)}>Retry search</Button>
        </div>}
        {photosPending && <DiscoveryLoading photos/>}
        {!!visible.length && collections.filter(item => !activeCollection || item.key === category).map(item => {
          const matches = visible.filter(place => item.categories.includes(place.category))
          return matches.length ? <DiscoveryRail key={item.key} collection={item} places={matches.filter(hasPhoto)}
            matches={matches.filter(place => !hasPhoto(place))} renderCard={renderCard}/> : null
        })}
        {report && report.status !== 'unavailable' && !visible.length && <div className="discovery-message" role="status">
          <p>{category === 'all' ? `Public sources returned no listings near ${location.name}.` : 'Public sources returned no listings for this category.'}</p>
          {category !== 'all' && <Button onClick={() => setCategory('all')}>Show all places</Button>}
        </div>}
        {!!places.length && <p className="discovery-source-note">
          {Array.from(new Set(places.map(place => place.source))).join(' · ')}{report.status === 'partial' && ' · Some sources did not respond'}
        </p>}
      </div>
      {mapOpen && <div className="discovery-map-panel"><JourneyMap center={report?.location || location} places={visible} selectedId={mapFocus && mapPlaceId(mapFocus)}
        onSelect={place => place && selectPlace(place)} onClose={() => {setMapOpen(false); mapToggle.current?.focus()}}/></div>}
    </div>
    {category==='all'&&<DestinationBrief location={location} compact/>}
    {activePlace && <Dialog label={activePlace.name} className="discovery-details-dialog" onClose={() => setPlaceKey('')}>
      <PlaceDetails key={placeKey} place={activePlace} initialTab="media" onAdd={toggle} added={shortlist.some(item => discoveryPlaceKey(item) === placeKey)}
        onShowMap={() => {setMapOpen(true);setMapFocus(activePlace);setPlaceKey('')}}/>
      <div className="discovery-details-actions">
        <Button icon="heart" aria-pressed={!onRequireAccount&&saved.some(item => discoveryPlaceKey(item) === placeKey)} onClick={() => onRequireAccount?onRequireAccount():toggleDiscoverySaved(activePlace, location)}>
          {saved.some(item => discoveryPlaceKey(item) === placeKey) ? 'Unsave place' : 'Save place'}
        </Button>
        <Button icon="sparkle" onClick={() => onAsk(`What should I know before visiting ${activePlace.name} in ${location.name}?`)}>Ask about this place</Button>
      </div>
    </Dialog>}
  </section>
}

export function SavedDiscoveryPlaces({onPlan, profile}) {
  const places = useSavedDiscoveryPlaces()
  const [key, setKey] = useState('')
  const active = places.find(place => discoveryPlaceKey(place) === key)
  function plan(place) {
    const city = place.discoveryCity
    const id = 'geo:' + String(city.id).replace(/^geo:/, '')
    onPlan('', id, {...city, id}, false, {selected: [place]})
  }
  if (!places.length) return null
  function renderCard(place) {
    return <DiscoveryCard key={discoveryPlaceKey(place)} place={place} saved
      onOpen={() => setKey(discoveryPlaceKey(place))} onSave={() => toggleDiscoverySaved(place)}
      onSelect={onPlan && place.discoveryCity?.id ? () => plan(place) : undefined}/>
  }
  const summary = summarizePlaces(places, {profile})
  return <section className="discovery-saved" aria-label="Saved places from discovery">
    <PlaceSummary summary={summary} title="Your shortlist at a glance" onSelect={place => setKey(discoveryPlaceKey(place))}/>
    {summary.location && <DestinationBrief location={summary.location} compact/>}
    <DiscoveryRail collection={{title: 'Saved from Explore', icon: Compass}}
      places={places.filter(place => place.photo?.url && place.photo.kind !== 'nearby')}
      matches={places.filter(place => !place.photo?.url || place.photo.kind === 'nearby')} renderCard={renderCard}/>
    {active && <Dialog label={active.name} className="discovery-details-dialog" onClose={() => setKey('')}>
      <PlaceDetails place={active}/>
      <div className="discovery-details-actions">
        <Button icon="heart" onClick={() => toggleDiscoverySaved(active)}>Unsave place</Button>
        {onPlan && active.discoveryCity?.id && <Button variant="primary" icon="plus" onClick={() => plan(active)}>Add to trip</Button>}
      </div>
    </Dialog>}
  </section>
}
