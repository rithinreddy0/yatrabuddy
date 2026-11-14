import React, {useEffect, useId, useMemo, useRef, useState} from 'react'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import {Icon, IconButton} from '../components/UI.jsx'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {icon} from '../icons.mjs'
import 'maplibre-gl/dist/maplibre-gl.css'
import './JourneyMap.css'
import {usePopoverDismiss} from '../components/usePopoverDismiss.mjs'

const empty = []
const dayColors = ['#75baff', '#62d6bc', '#eab969', '#b9a0ff', '#f29cb3']
const lightStyle = 'https://tiles.openfreemap.org/styles/liberty'
const mapCredit = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const streetTile = import.meta.env.VITE_MAP_TILE_URL
const rasterStyle = {
  version: 8,
  sources: {streets: {type: 'raster', tiles: [streetTile || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
    tileSize: 256, maxzoom: 19, attribution: mapCredit}},
  layers: [{id: 'streets', type: 'raster', source: 'streets'}],
}
const satelliteStyle = {
  version: 8,
  sources: {satellite: {type: 'raster',
    tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/{z}/{y}/{x}.jpg'],
    tileSize: 256, maxzoom: 14,
    attribution: '<a href="https://cloudless.eox.at">EOxCloudless</a> by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 &amp; 2017)'}},
  layers: [{id: 'satellite', type: 'raster', source: 'satellite'}],
}

function validPoint(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon) &&
    Math.abs(point.lat) <= 90 && Math.abs(point.lon) <= 180
}

function lngLat(point) {
  return [point.lon, Math.min(85, Math.max(-85, point.lat))]
}

function coordinates(points) {
  return points.filter(pair => Array.isArray(pair) && validPoint({lat: pair[0], lon: pair[1]}))
    .map(([lat, lon]) => lngLat({lat, lon}))
}

export function mapPlaceId(place) {
  return String(place.url || place.id || [place.name, place.lat, place.lon].join('|'))
}

export function draftMapData(draft) {
  const days = draft?.days || []
  const stay = validPoint(draft?.stay) ? draft.stay : null
  const places = [
    ...(stay ? [{...stay, category: 'Stay'}] : []),
    ...days.flatMap((stops, index) => stops.map((stop, stopIndex) => ({
      ...stop, day: index + 1, stop: stopIndex + 1,
    }))),
  ]
  const routes = days.map((stops, index) => {
    const shape = draft.routeGeometry?.[index]
    const approximate = !(Array.isArray(shape) && shape.length >= 2)
    const points = approximate ? [stay, ...stops].filter(validPoint).map(({lat, lon}) => [lat, lon]) : shape
    return {day: index + 1, points, approximate}
  }).filter(route => route.points.length > 1)
  return {center: draft, places, routes}
}

function colorForDay(day) {
  return dayColors[((day || 1) - 1) % dayColors.length]
}

function routeFeatures(routes) {
  return {
    type: 'FeatureCollection',
    features: routes.flatMap(route => {
      const line = coordinates(route.points || empty)
      return line.length < 2 ? [] : [{
        type: 'Feature',
        properties: {color: colorForDay(route.day), approximate: Boolean(route.approximate)},
        geometry: {type: 'LineString', coordinates: line},
      }]
    }),
  }
}

function fitMap(map, places, center) {
  const points = places.map(lngLat)
  if (!points.length && validPoint(center)) points.push(lngLat(center))
  if (!points.length) return
  if (points.length === 1) {
    map.jumpTo({center: points[0], zoom: center?.kind === 'region' && !places.length ? 8 : 13})
    return
  }
  const anchor = points[0][0]
  const longitudes = points.map(([lon]) => anchor + ((lon - anchor + 540) % 360) - 180)
  const latitudes = points.map(([, lat]) => lat)
  const inset = Math.min(62, Math.floor(map.getContainer().clientWidth / 5))
  map.fitBounds([
    [Math.min(...longitudes), Math.min(...latitudes)],
    [Math.max(...longitudes), Math.max(...latitudes)],
  ], {padding: {top: 58, right: inset, bottom: 68, left: inset}, maxZoom: 15, duration: 0})
}

const categoryIcon = {Stay: 'bed', Food: 'fork', Nature: 'compass', Airport: 'plane', Shopping: 'trip'}

function pinElement(place, select, showPreview, clearPreview) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'journey-map-pin'
  button.style.setProperty('--pin-color', colorForDay(place.day))
  button.setAttribute('aria-label', place.name)
  button.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')showPreview(place,button)})
  button.addEventListener('pointerleave',()=>clearPreview(place))
  button.addEventListener('focus',()=>showPreview(place,button))
  button.addEventListener('blur',()=>clearPreview(place))
  const symbol = document.createElement('span')
  symbol.className = 'journey-pin-symbol'
  if (place.pinLabel || place.stop) {
    symbol.textContent = place.pinLabel || place.stop
    if (place.pinLabel) symbol.classList.add('journey-pin-wide')
  } else {
    symbol.innerHTML = icon(categoryIcon[place.category] || 'pin', 17)
  }
  const thumbnail = place.photo?.url || place.photo?.originalUrl
  button.append(symbol)
  if (place.photo?.kind !== 'nearby' && /^https:\/\//i.test(thumbnail || '')) {
    const image = document.createElement('img')
    image.src = thumbnail
    image.alt = ''
    image.referrerPolicy = 'no-referrer'
    image.className = 'journey-pin-thumbnail'
    image.addEventListener('error', () => image.remove(), {once:true})
    if (!place.pinLabel) symbol.append(image)
  }
  const name = document.createElement('span')
  name.className = 'journey-pin-name'
  name.textContent = place.name
  button.append(name)
  button.addEventListener('click', event => {
    event.stopPropagation()
    showPreview(place, button)
    if (select(place)) clearPreview(place, true)
  })
  return button
}

export function JourneyMap({
  center, places = empty, routes = empty, selectedId, onSelect, onClose, className = '', compactControls = false,
}) {
  const container = useRef(null)
  const map = useRef(null)
  const markerClass = useRef(null)
  const markers = useRef([])
  const select = useRef(onSelect)
  const [day, setDay] = useState(null)
  const [satellite, setSatellite] = useState(true)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [ready, setReady] = useState(false)
  const [styleVersion, setStyleVersion] = useState(0)
  const [fallback, setFallback] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [tilesUnavailable, setTilesUnavailable] = useState(false)
  const [preview,setPreview]=useState(null)
  const previewTimer = useRef(null)
  const searchId = useId()
  const searchPanel = useRef(null)
  const searchTrigger = useRef(null)
  usePopoverDismiss({open:searchOpen,panel:searchPanel,trigger:searchTrigger,onDismiss:()=>setSearchOpen(false)})
  const mappable = useMemo(() => places.filter(validPoint), [places])
  const dayNumbers = useMemo(() => [...new Set(mappable.map(place => place.day).filter(Boolean))].sort((a,b) => a-b), [mappable])
  const selection = mappable.find(place => mapPlaceId(place) === String(selectedId))
  const visibleDay = dayNumbers.includes(day) ? day : null
  const visiblePlaces = useMemo(() => mappable.filter(place => !visibleDay || !place.day || place.day === visibleDay), [mappable, visibleDay])
  const visibleRoutes = useMemo(() => routes.filter(route => !visibleDay || !route.day || route.day === visibleDay), [routes, visibleDay])
  const matches = visiblePlaces.filter(place => place.name?.toLowerCase().includes(query.trim().toLowerCase()))
  const placePositions = JSON.stringify(visiblePlaces.map(lngLat))
  const centerPosition = validPoint(center) ? lngLat(center).join(',') : ''
  const requestedStyle = satellite ? satelliteStyle : streetTile ? rasterStyle : lightStyle
  const mapName = center?.name || 'Trip'

  useEffect(() => { select.current = onSelect }, [onSelect])

  useEffect(() => {
    let instance
    let observer
    let timer
    let hasStyle = false
    let hasTiles = false
    let triedRaster = requestedStyle === rasterStyle
    let closed = false
    setReady(false)
    setFallback(false)
    setUnavailable(false)
    setTilesUnavailable(false)
    const tryRaster = () => {
      if (hasTiles) return
      if (triedRaster) {
        if (hasStyle) setTilesUnavailable(true)
        else setUnavailable(true)
        return
      }
      triedRaster = true
      hasStyle = false
      setReady(false)
      setFallback(true)
      instance.setStyle(rasterStyle)
      timer = window.setTimeout(() => {
        if (!hasStyle) setUnavailable(true)
        else if (!hasTiles) setTilesUnavailable(true)
      }, 6000)
    }
    import('maplibre-gl').then(({Map: VectorMap, Marker, NavigationControl, setWorkerUrl}) => {
      if (closed) return
      setWorkerUrl(workerUrl)
      markerClass.current = Marker
      instance = new VectorMap({
        container: container.current, style: requestedStyle, center: [0, 18], zoom: 1.3,
        minZoom: 1, maxZoom: 19, maxPitch: 0, dragRotate: false, pitchWithRotate: false,
        touchPitch: false, scrollZoom: false, cooperativeGestures: true, attributionControl: {compact: true},
      })
      map.current = instance
      instance.touchZoomRotate.disableRotation()
      instance.addControl(new NavigationControl({showCompass: false}), 'bottom-right')
      instance.on('style.load', () => {
        hasStyle = true
        setUnavailable(false)
        setReady(true)
        setStyleVersion(version => version + 1)
      })
      instance.on('sourcedata', ({sourceId, tile}) => {
        const basemapId = triedRaster ? 'streets' : satellite ? 'satellite' : 'openmaptiles'
        if (sourceId === basemapId && tile?.state === 'loaded') {
          hasTiles = true
          window.clearTimeout(timer)
          setTilesUnavailable(false)
        }
      })
      instance.on('error', ({sourceId}) => {
        if (!sourceId && !hasStyle && !triedRaster) {
          window.clearTimeout(timer)
          tryRaster()
        }
      })
      timer = window.setTimeout(tryRaster, 9000)
      observer = new ResizeObserver(() => instance.resize())
      observer.observe(container.current)
    }).catch(() => {
      if (!closed) setUnavailable(true)
    })
    return () => {
      closed = true
      window.clearTimeout(timer)
      observer?.disconnect()
      instance?.remove()
      map.current = null
    }
  }, [requestedStyle])

  useEffect(() => {
    if (!ready || !map.current) return
    const instance = map.current
    const source = instance.getSource('yatra-trip-route')
    const data = routeFeatures(visibleRoutes)
    if (source) {
      source.setData(data)
      return
    }
    instance.addSource('yatra-trip-route', {type: 'geojson', data})
    for (const approximate of [false, true]) {
      instance.addLayer({
        id: approximate ? 'yatra-stop-order' : 'yatra-road-route',
        type: 'line',
        source: 'yatra-trip-route',
        filter: ['==', ['get', 'approximate'], approximate],
        layout: {'line-cap': 'round', 'line-join': 'round'},
        paint: {'line-width': 3.5, 'line-color': ['get', 'color'], 'line-opacity': 0.93,
          ...(approximate ? {'line-dasharray': [1, 2]} : {})},
      })
    }
  }, [ready, styleVersion, visibleRoutes])

  useEffect(() => {
    if (!ready || !map.current) return
    const instance = map.current
    const clear=()=>setPreview(null)
    instance.on('movestart',clear)
    instance.on('click',clear)
    markers.current = visiblePlaces.map(place => {
      const element = pinElement(place, item => {
        if (!select.current) return false
        select.current(item)
        return true
      },(item,button)=>{
        window.clearTimeout(previewTimer.current)
        const mapBox=container.current?.getBoundingClientRect()
        if(!mapBox)return
        const pin=button.getBoundingClientRect()
        const width=Math.min(275,mapBox.width-18)
        const x=Math.max(9,Math.min(mapBox.width-width-9,pin.left-mapBox.left-12))
        const above=pin.top-mapBox.top
        const below=mapBox.bottom-pin.bottom
        const showBelow=below>above
        const edge=showBelow ? pin.bottom-mapBox.top : mapBox.bottom-pin.top
        const room=Math.max(85,(showBelow ? below : above)-16)
        setPreview({item,x,width,edge,room,showBelow})
      }, (item, now)=>{
        window.clearTimeout(previewTimer.current)
        const clearItem=()=>setPreview(current=>current?.item===item?null:current)
        if(now) clearItem()
        else previewTimer.current=window.setTimeout(clearItem,220)
      })
      const marker = new markerClass.current({element}).setLngLat(lngLat(place)).addTo(instance)
      return {element, marker, place}
    })
    return () => {
      instance.off('movestart',clear)
      instance.off('click',clear)
      window.clearTimeout(previewTimer.current)
      markers.current.forEach(({marker}) => marker.remove())
      markers.current = []
    }
  }, [ready, visiblePlaces])

  useEffect(() => {
    if (ready && map.current) fitMap(map.current, visiblePlaces, center)
    // Coordinate changes refit the map. Updates to photos and descriptions leave the view in place.
  }, [ready, styleVersion, placePositions, centerPosition])

  useEffect(() => {
    if (!ready || !map.current) return
    for (const {element, place} of markers.current) {
      element.setAttribute('aria-pressed', String(mapPlaceId(place) === String(selectedId)))
    }
  }, [ready, selectedId, visiblePlaces])

  useEffect(() => {
    if (!selection) return
    if (selection.day && visibleDay && selection.day !== visibleDay) {
      setDay(selection.day)
      return
    }
    if (ready && map.current) map.current.panTo(lngLat(selection))
  }, [ready, styleVersion, selectedId, selection?.lat, selection?.lon])

  function focusPlace(place) {
    if (ready && map.current) {
      map.current.easeTo({center: lngLat(place), zoom: Math.max(14, map.current.getZoom())})
    }
    if (onSelect) onSelect(place)
    else markers.current.find(marker => marker.place === place)?.element.focus({preventScroll:true})
    setSearchOpen(false)
  }

  function toggleSearch() {
    setQuery('')
    setSearchOpen(open => !open)
  }

  const hover=ready&&preview&&visiblePlaces.includes(preview.item)?preview:null
  const previewItem = hover?.item
  const previewKind = previewItem && [previewItem.category, previewItem.day && `Day ${previewItem.day}`,
    Number.isFinite(previewItem.rating) && `★ ${previewItem.rating}${previewItem.reviewCount ? ` (${previewItem.reviewCount} reviews)` : ''}`].filter(Boolean).join(' · ')

  return <section className={'journey-map ' + className} data-compact-controls={compactControls || undefined}
    aria-label={mapName + ' map'} onKeyDown={event => {
      if (event.key === 'Escape' && preview) { event.stopPropagation(); setPreview(null) }
    }}>
    <div className="journey-map-canvas" ref={container}/>
    {previewItem && <aside className="journey-pin-preview" aria-label={previewItem.name + ' preview'}
      style={{left:hover.x,width:hover.width,maxHeight:hover.room,[hover.showBelow?'top':'bottom']:Math.max(8,hover.edge)}}
      onPointerEnter={()=>window.clearTimeout(previewTimer.current)}
      onPointerLeave={()=>setPreview(null)}>
      <PlacePhoto key={mapPlaceId(previewItem)} place={previewItem} lookup hideUnavailable/>
      <div className="journey-pin-preview-copy">
        <strong>{previewItem.name}</strong>
        {previewKind && <small>{previewKind}</small>}
        {(previewItem.description || previewItem.overview) && <p>{previewItem.description || previewItem.overview}</p>}
        {previewItem.address && <p>{previewItem.address}</p>}
        {previewItem.openingHours && <p>Hours · {previewItem.openingHours}</p>}
        {previewItem.publishedPrice && <p>Price · {previewItem.publishedPrice}</p>}
      </div>
    </aside>}
    <div className="journey-map-top">
      {!compactControls && <div className="journey-map-title"><Icon name="map" size={18}/><div>
        <strong>{mapName}</strong><small>{visiblePlaces.length ? visiblePlaces.length + (visiblePlaces.length === 1 ? ' place' : ' places') : 'Map'}</small>
      </div></div>}
      <div className="journey-map-controls">
        {!!mappable.length && <IconButton ref={searchTrigger} icon="search" label="Find a place on the map" aria-expanded={searchOpen} aria-controls={searchOpen ? searchId : undefined} onClick={toggleSearch}/>}
        <button type="button" className="journey-map-basemap" aria-label={satellite ? 'Switch to street map' : 'Switch to satellite map'}
          onClick={() => {setPreview(null);setSatellite(value => !value)}}>
          {satellite ? 'Street map' : 'Satellite'}
        </button>
        {onClose && <IconButton icon="close" label="Close map" onClick={onClose}/>}
      </div>
    </div>
    {dayNumbers.length > 1 && <div className="journey-map-days" role="group" aria-label="Map itinerary days">
      <button type="button" aria-pressed={!visibleDay} onClick={() => setDay(null)}>All days</button>
      {dayNumbers.map(number => <button type="button" key={number} aria-pressed={visibleDay === number}
        onClick={() => {setDay(number); if (selection?.day && selection.day !== number) onSelect?.(null)}}>
        <span style={{backgroundColor: colorForDay(number)}}/>Day {number}
      </button>)}
    </div>}
    {searchOpen && <div ref={searchPanel} className="journey-map-search" id={searchId}>
      <label className="journey-map-search-field"><Icon name="search" size={16}/>
        <input autoFocus type="search" placeholder="Find a place" aria-label="Find a place" value={query}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => {
            if (event.key === 'Enter' && matches.length) focusPlace(matches[0])
          }}/>
      </label>
      <div className="journey-map-search-results">
        {matches.length ? matches.map((place, index) => <button key={mapPlaceId(place) + ':' + index} type="button" onClick={() => focusPlace(place)}>
          <Icon name={categoryIcon[place.category] || 'pin'} size={17}/>
          <span>{place.name}<small>{place.day ? 'Day ' + place.day : place.category}</small></span>
        </button>) : <p>No matching places on the map.</p>}
      </div>
    </div>}
    {!ready && !unavailable && <div className="journey-map-loading" role="status"><span/>Loading map</div>}
    {unavailable && <div className="journey-map-unavailable">
      <Icon name="map" size={26}/><strong>The interactive map could not load</strong>
      {!!visiblePlaces.length && <button type="button" onClick={toggleSearch}>Browse map places</button>}
    </div>}
    {ready && <div className="journey-map-bottom">
      {visibleRoutes.some(route => !route.approximate) && <span>Driving route · <a href="https://project-osrm.org/" target="_blank" rel="noreferrer">OSRM</a></span>}
      {visibleRoutes.some(route => route.approximate && route.points?.length > 1) && <span className="journey-map-estimate">
        {visibleRoutes.find(route => route.approximate && route.label)?.label || 'Visit order'}</span>}
      {tilesUnavailable && <span>Map tiles unavailable</span>}
      {fallback && !tilesUnavailable && <span>{satellite ? 'Satellite unavailable · Street map' : 'Street map'}</span>}
    </div>}
    {ready && <IconButton className="journey-map-fit" icon="compass" label="Fit map to places" onClick={() => fitMap(map.current, visiblePlaces, center)}/>}
  </section>
}
