import React, {useEffect, useRef, useState} from 'react'
import {ArrowLeft, Camera, ExternalLink, MapPin, Minus, Plus} from 'lucide-react'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {PhotoRail} from '../components/PhotoRail.jsx'
import {GoogleMapsLink} from '../components/GoogleMapsLink.jsx'
import {TravelHighlights} from '../components/TravelHighlights.jsx'
import {AgentProgress, Button, WikivoyageSource} from '../components/UI.jsx'
import {request} from '../api.mjs'
import {placeInterestScores} from './discoveryPlaces.mjs'
import {revealResult} from '../components/revealResult.mjs'
import {isWikivoyage, visibleSource} from '../components/sourceUrl.mjs'

export function PlaceSource({url, children}) {
  if (isWikivoyage(url)) return <WikivoyageSource url={url} label={typeof children === 'string' ? children : undefined}/>
  const href = visibleSource(url)?.href
  if (!href) return null
  return <a className="journey-source" href={href} target="_blank" rel="noreferrer">{children}<ExternalLink size={13}/></a>
}

export function placeMapUrl(place) {
  if (!Number.isFinite(place?.lat) || !Number.isFinite(place?.lon)) return null
  return `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`
}

function MediaItem({item, onSave, saved}) {
  return <article className="journey-media-item">
    {item.type === 'video' ? <video controls preload="none" poster={item.thumbnail || undefined}>
      <source src={item.url} type={item.mime}/>
    </video> : <PlacePhoto place={{name:item.title, photo:{...item, url:item.thumbnail || item.url, credit:item.author || item.credit}}} hideUnavailable/>}
    <strong>{item.title}</strong>
    <div className="journey-links">
      {item.type === 'video' && <PlaceSource url={item.sourceUrl}>{[item.author, item.license].filter(Boolean).join(' · ') || 'Video source'}</PlaceSource>}
      {onSave && item.license && <Button onClick={() => onSave(item)} disabled={saved}> {saved ? 'Saved to trip' : 'Save to trip'} </Button>}
    </div>
  </article>
}

function VisitConsiderations({place}) {
  const scores = placeInterestScores(place)
  const strongest = Object.entries(scores).sort((a,b) => b[1] - a[1])[0]
  const strengths = [
    strongest[1] >= 4 ? `A strong ${strongest[0].toLowerCase()} match based on its listing.` : null,
    place.category === 'Stay' ? 'Can serve as the starting point for your itinerary.' : null,
    Number.isFinite(place.distanceMetres) && place.distanceMetres <= 2000 ? 'Within 2 km of the destination center.' : null,
    place.openingHours ? 'The source lists opening hours.' : null,
  ].filter(Boolean)
  const tradeoffs = [
    Number.isFinite(place.distanceMetres) && place.distanceMetres > 12000 ? 'Allow extra travel time from the destination center.' : null,
    !place.publishedPrice ? (place.category === 'Stay' ? 'Check room rates and cancellation terms for your dates.' : 'Check current prices before budgeting for this stop.') : null,
    !place.openingHours && place.category !== 'Stay' ? 'Opening hours need confirmation.' : null,
  ].filter(Boolean)
  const type = [place.name, place.description, place.overview].filter(Boolean).join(' ')
  const caution = /\b(beach|surfing|diving)\b/i.test(type) ? 'Check local sea conditions, lifeguard advice and warning flags before entering the water.'
    : /\b(trek|hiking|climbing|waterfall|mountain)\b/i.test(type) ? 'Check route conditions and closures before leaving, especially after heavy rain.'
      : place.category === 'Food' ? 'Ask the venue about ingredients and cross-contact if you have dietary restrictions.'
        : 'Check current local notices and access details before you go.'
  return <section className="journey-visit-checks" aria-label="Visit considerations">
    <h3>What to expect</h3>
    <div className="journey-interest-scores" aria-label="Estimated interest matches">
      {Object.entries(scores).map(([interest, score]) => <span key={interest}>{interest} <strong>{score}/5</strong></span>)}
    </div>
    <p className="journey-detail-address">Interest matches use listing categories and descriptions.</p>
    <dl>
      {!!strengths.length && <div><dt>Pros</dt><dd>{strengths.join(' ')}</dd></div>}
      {!!tradeoffs.length && <div><dt>Trade-offs</dt><dd>{tradeoffs.join(' ')}</dd></div>}
      <div><dt>Safety checks</dt><dd>{caution}</dd></div>
    </dl>
  </section>
}

export function PlaceDetails({place, initialTab = 'overview', onClose, onShowMap, onAdd, added, onSaveMedia, savedMedia = []}) {
  const [media, setMedia] = useState(null)
  const map = placeMapUrl(place)
  const [tab, setTab] = useState(map || place.source === 'Google Maps' ? initialTab : 'overview')
  const [attempt, setAttempt] = useState(0)
  const tabContent=useRef(null)
  const show=next=>{setTab(next);revealResult(tabContent.current)}
  useEffect(() => {
    if (tab !== 'media' || (!map && place.source !== 'Google Maps')) return
    const controller = new AbortController()
    const venue = ['Food','Stay'].includes(place.category)
    const params = new URLSearchParams({lat: place.lat, lon: place.lon, q: place.name.slice(0, 120), exact: 'true',
      venue:String(venue), radius:venue ? '80' : '120'})
    const path = place.source === 'Google Maps' && place.id ? 'places/google/' + encodeURIComponent(place.id) + '/photos' : 'places/media?' + params
    request(path, {signal: controller.signal})
      .then(result => { if (!controller.signal.aborted) setMedia(result) })
      .catch(() => { if (!controller.signal.aborted) setMedia({status: 'unavailable', items: []}) })
    return () => controller.abort()
  }, [tab, place.lat, place.lon, place.name, place.id, place.source, place.category, map, attempt])
  const photos = (media?.items || []).filter(item=>item.type==='photo' && item.url !== place.photo?.url)
  const videos = (media?.items || []).filter(item=>item.type==='video')
  const renderMedia = (item, index) => <MediaItem key={item.url + ':' + index} item={{...item, title:item.title || place.name}} onSave={onSaveMedia}
    saved={savedMedia.some(savedItem => savedItem.sourceUrl === item.sourceUrl)}/>
  return <aside className="journey-place-detail" aria-label={place.name + ' details'}>
    <div className="journey-detail-bar">
      {onClose && <button type="button" className="journey-icon" onClick={onClose} aria-label="Close place details"><ArrowLeft size={19}/></button>}
      <span>{place.category || 'Destination'}</span>
      {onShowMap && <Button onClick={onShowMap} icon="map">Map</Button>}
    </div>
    <PlacePhoto place={place} lookup hideUnavailable/>
    <h2>{place.name}</h2>
    {place.address && <p className="journey-detail-address"><MapPin size={15}/>{place.address}</p>}
    <GoogleMapsLink place={place}/>
    <div className="journey-detail-tabs" aria-label="Place views">
      <Button aria-pressed={tab === 'overview'} onClick={() => show('overview')}>Overview</Button>
      {(map || place.source === 'Google Maps') && <Button aria-pressed={tab === 'media'} onClick={() => show('media')}><Camera size={16}/> Photos & videos</Button>}
    </div>
    <div ref={tabContent} className="result-scroll-anchor"/>
    {tab === 'overview' ? <>
      {(place.description || place.overview) && <TravelHighlights text={place.description || place.overview}/>}
      {(place.openingHours || place.publishedPrice || place.rating != null) && <dl className="journey-facts">
        {place.openingHours && <div><dt>Published hours</dt><dd>{place.openingHours}</dd></div>}
        {place.publishedPrice && <div><dt>Published price</dt><dd><strong className="travel-price">{place.publishedPrice}</strong></dd></div>}
        {place.rating != null && <div><dt>Rating</dt><dd>{place.rating} / 5{place.reviewCount ? ` · ${place.reviewCount} reviews` : ''}</dd></div>}
      </dl>}
      <VisitConsiderations place={place}/>
      <div className="journey-links">
        <PlaceSource url={place.url}>{place.source || 'Place source'}</PlaceSource>
        <PlaceSource url={place.website}>Official site</PlaceSource>
      </div>
    </> : !media ? <AgentProgress label={`Checking photos for ${place.name}`}/> : <>
      {photos.length || videos.length ? <>
        <PhotoRail title="Place photos" count={photos.length} className="place-detail-rail">{photos.map(renderMedia)}</PhotoRail>
        <PhotoRail title="Place videos" count={videos.length} className="place-detail-rail">{videos.map(renderMedia)}</PhotoRail>
      </> : <div className="journey-links">
        {media.status === 'unavailable' && <Button onClick={() => {setMedia(null); setAttempt(value => value + 1)}}>Retry media lookup</Button>}
        <PlaceSource url={place.url}>Open place listing</PlaceSource>
      </div>}
    </>}
    {onAdd && <Button className="journey-detail-add" variant="primary" onClick={() => onAdd(place)} aria-pressed={added}>
      {added ? <Minus size={16}/> : <Plus size={16}/>} {added ? 'Remove from trip shortlist' : 'Add to trip shortlist'}
    </Button>}
  </aside>
}
