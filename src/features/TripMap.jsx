import React, {useEffect, useState} from 'react'
import {request} from '../api.mjs'
import {Icon, IconButton, Pill, SourcePill} from '../components/UI.jsx'
import {modes, money, routesFor, schedule} from '../planner.mjs'
import {JourneyMap, mapPlaceId} from './JourneyMap.jsx'
import './TripOverview.css'

const layerIcons = ['map', 'pin', 'bed', 'fork', 'plane']
const layers = ['Overview', ...modes]
const categories = {Culture: 'Sight', Adventure: 'Activity'}

function mappedStops(stops, day) {
  return stops.map((place, index) => ({...place, id: `${day}-${index}`,
    category: categories[place.theme] || place.theme, day, stop: index + 1}))
}

function itineraryRoute(stops, day, road) {
  const geometry = road?.geometry
  return {day, approximate: !geometry?.length,
    points: geometry?.length ? geometry : stops.map(stop => [stop.lat, stop.lon])}
}

export function TripMap({trip, place, eligible, stops, activeStop, setActiveStop, layer, setLayer,
  onUpdate, onToggleFood, onOverviewStop, onClose, day, routeForDay}) {
  const [focus, setFocus] = useState(null)
  const [maxRate, setMaxRate] = useState(null)
  const [prices, setPrices] = useState(true)
  const [origin, setOrigin] = useState(null)
  const originName = trip.brief.origin
  useEffect(() => {
    if (layer !== 'Routes' || originName.toLowerCase() === place.name.toLowerCase()) return
    const controller = new AbortController()
    request('locations?' + new URLSearchParams({q: originName}), {signal: controller.signal})
      .then(results => {
        const records = Array.isArray(results) ? results : results.locations || []
        const best = records.find(item => item.name?.toLowerCase() === originName.toLowerCase()) || records[0]
        if (!controller.signal.aborted && best) setOrigin({query: originName, ...best})
      })
      .catch(() => {})
    return () => controller.abort()
  }, [layer, originName, place.name])
  const rateLimit = Math.max(...place.stays.map(item => item.price))
  const stays = place.stays.map((item, index) => ({...item, index, category: 'Stay', pinLabel: prices ? money(item.price) : null}))
    .filter(item => item.price <= (maxRate ?? rateLimit))
  const food = eligible.filter(item => item.theme === 'Food').map(item => ({...item, category: 'Food'}))
  const allDays = trip.days.map((_, index) => mappedStops(schedule(trip, index, routeForDay(index)?.legMinutes), index + 1))
  const today = mappedStops(stops, day + 1)
  const destination = {...place.places[0], name: place.name}
  const intercity = origin?.query === originName ? [origin, destination] : [destination]
  const points = {Stays: stays, Food: food, Overview: allDays.flat(), Itinerary: today, Routes: intercity}[layer] || today
  const routes = layer === 'Overview' ? allDays.map((items, index) => itineraryRoute(items, index + 1, routeForDay(index)))
    : layer === 'Itinerary' ? [itineraryRoute(today, day + 1, routeForDay(day))]
      : layer === 'Routes' && intercity.length > 1 ? [{...itineraryRoute(intercity, 1), label: 'City-to-city overview'}] : []
  const details = layer === 'Itinerary' ? today[activeStop] : points.find(item => mapPlaceId(item) === focus)
  const directions = today.length > 1 ? new URLSearchParams({
    api: '1', origin: today[0].lat + ',' + today[0].lon,
    destination: today.at(-1).lat + ',' + today.at(-1).lon,
    ...(today.length > 2 && {waypoints: today.slice(1, 10).map(item => item.lat + ',' + item.lon).join('|')}),
  }) : null

  function select(item) {
    if (!item) return
    if (layer === 'Itinerary') setActiveStop(item.stop - 1)
    else if (layer === 'Overview') onOverviewStop(item.day - 1, item.stop - 1)
    else setFocus(mapPlaceId(item))
  }

  return <section className="panel map-panel legacy-trip-map">
    <div className="panel-top"><h2>Trip map</h2><IconButton icon="close" label="Hide trip map" onClick={onClose}/></div>
    <div className="map-tabs" aria-label="Map layers">
      {layers.map((mode, index) => <Pill key={mode} active={mode === layer} icon={layerIcons[index]} onClick={() => {
        setLayer(mode)
        setFocus(null)
      }}>{mode}</Pill>)}
    </div>
    <div className="legacy-trip-map-canvas">
      <JourneyMap center={destination} places={points} routes={routes}
        selectedId={details && mapPlaceId(details)} onSelect={select} onClose={onClose}/>
    </div>
    {details && <div className="map-help selected-place">
      <div><strong>{details.name}</strong>{details.hours && <span>{details.hours}</span>}</div>
      <SourcePill label="View location" url={`https://www.openstreetmap.org/?mlat=${details.lat}&mlon=${details.lon}#map=16/${details.lat}/${details.lon}`}/>
    </div>}
    {layer === 'Itinerary' && directions && <div className="map-help">
      <SourcePill label="Open directions" url={'https://www.google.com/maps/dir/?' + directions}/>
    </div>}
    {layer === 'Stays' && <div className="layer-list">
      <div className="price-filter">
        <label>Maximum nightly rate · {money(maxRate ?? rateLimit)}
          <input type="range" min={0} max={rateLimit} step={100} value={maxRate ?? rateLimit}
            onChange={event => setMaxRate(Number(event.target.value))}/>
        </label>
        <Pill active={prices} onClick={() => setPrices(value => !value)}>Price pins</Pill>
      </div>
      {stays.length ? stays.map(item => {
        const selected = !trip.sourcedStay && trip.stay === item.index
        return <button className={'layer-option' + (selected ? ' selected' : '')} key={item.name} aria-pressed={selected}
          onClick={() => {setFocus(mapPlaceId(item)); onUpdate({...trip, stay: item.index, sourcedStay: null})}}>
          <span><Icon name="bed"/><span><strong>{item.name}</strong><small>{item.area} · {money(item.price)} simulated per night</small></span></span>
          <Icon name={selected ? 'check' : 'plus'}/>
        </button>
      }) : <p className="form-note">Raise the nightly rate to show more stays.</p>}
    </div>}
    {layer === 'Routes' && <div className="layer-list">
      {trip.agentRoute ? <div className="layer-option selected">
        <span><Icon name="plane"/><span><strong>{trip.agentRoute.name}{!trip.agentRoute.unpriced && ' · ' + money(trip.agentRoute.price) + ' each'}</strong>
          <small>{trip.agentRoute.unpriced ? 'Price to confirm' : 'Simulated'} · {trip.brief.origin} to {place.name}</small>
          <small>{trip.agentRoute.reason}</small></span></span><Icon name="check"/>
      </div> : routesFor(trip.brief).map((item, index) => <button className={'layer-option' + (trip.route === index ? ' selected' : '')}
        key={item.name} aria-pressed={trip.route === index} onClick={() => onUpdate({...trip, route: index})}>
        <span><Icon name="plane"/><span><strong>{item.name} · {money(item.price)} simulated</strong>
          <small>{item.path} · {item.hours}</small><small>{item.note}</small></span></span>
        <Icon name={trip.route === index ? 'check' : 'plus'}/>
      </button>)}
    </div>}
    {layer === 'Food' && <div className="layer-list">
      {food.length ? food.map(item => {
        const added = stops.some(stop => stop.name === item.name)
        return <div className="layer-option" key={item.name}>
          <span><Icon name="fork"/><span><strong>{item.name}</strong><small>{item.hours} · {money(item.price)} est.</small></span></span>
          <IconButton icon={added ? 'minus' : 'plus'} label={(added ? 'Remove ' : 'Add ') + item.name}
            aria-pressed={added} disabled={!added && stops.length >= 12} onClick={() => onToggleFood(item.name)}/>
        </div>
      }) : <p className="form-note">No catalog food stops match this preference.</p>}
    </div>}
  </section>
}
