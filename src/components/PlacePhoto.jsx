import React,{useEffect,useRef,useState} from 'react'
import {request} from '../api.mjs'
import {Camera, Coffee, Hotel, Landmark, MapPin, Mountain, ShoppingBag} from 'lucide-react'

const lookups = new Map()
let inFlight = 0
const queue = []

function loadPhoto(path) {
  const cached = lookups.get(path)
  if (cached && cached.expires > Date.now()) return cached.promise
  const promise = new Promise((resolve, reject) => {
    const run = () => {
      inFlight++
      request(path).then(resolve, reject).finally(() => {
        inFlight--
        queue.shift()?.()
      })
    }
    if (inFlight < 3) run()
    else queue.push(run)
  })
  if (lookups.size >= 100) lookups.delete(lookups.keys().next().value)
  lookups.set(path, {promise, expires:Date.now()+300_000})
  promise.then(result => {
    if ((result.status === 'unavailable' || result.items?.some(item => item.authors)) && lookups.get(path)?.promise === promise) lookups.delete(path)
  }, () => {if (lookups.get(path)?.promise === promise) lookups.delete(path)})
  return promise
}

function photoPath(place) {
  if (place.source === 'Google Maps' && place.id) return 'places/google/' + encodeURIComponent(place.id) + '/photos?limit=1'
  if (!place.name || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return ''
  const venue = ['Food','Stay'].includes(place.category)
  return 'places/media?' + new URLSearchParams({q:place.name.slice(0,120), lat:place.lat, lon:place.lon,
    exact:'true', type:'photo', radius:venue ? '80' : '120', venue:String(venue)})
}

function https(value){
  try{return new URL(value).protocol==='https:'?value:null}catch{return null}
}

const illustrations = {Food:Coffee,Stay:Hotel,Sight:Landmark,Nature:Mountain,Activity:Camera,Shopping:ShoppingBag}

export function PlacePhoto({place,onUnavailable,compact=false,className='',onOpen,lookup=false}){
  const anchor = useRef(null)
  const [loaded, setLoaded] = useState(null)
  const [failed,setFailed] = useState([])
  const primary = place.photo?.kind === 'nearby' ? null : place.photo
  const primaryAvailable = [primary?.url, primary?.originalUrl].some(value => https(value) && !failed.includes(value))
  const path = lookup && !primaryAvailable ? photoPath(place) : ''
  const photo = primaryAvailable ? primary : loaded?.path === path ? loaded.photo : primary
  const urls=[...new Set([https(photo?.url),https(photo?.originalUrl)].filter(Boolean))]
  const url=urls.find(candidate=>!failed.includes(candidate))
  const hasPhoto=Boolean(url)
  const source=https(photo?.sourceUrl)
  const waiting = path && loaded?.path !== path
  useEffect(() => {
    if (!waiting || !anchor.current) return
    let visible = true
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      observer.disconnect()
      loadPhoto(path).then(result => {
        if (visible) setLoaded({path, photo:result.items?.find(item => item.type === 'photo')})
      }).catch(() => {if (visible) setLoaded({path, photo:null})})
    }, {rootMargin:'80px'})
    observer.observe(anchor.current)
    return () => {visible = false;observer.disconnect()}
  }, [path, waiting])
  const license=https(photo?.licenseUrl)
  function imageFailed() {
    setFailed(previous => [...previous, url])
    if (!lookup && !urls.some(candidate=>candidate!==url&&!failed.includes(candidate))) onUnavailable?.()
  }
  if(compact)return hasPhoto ? <img className={className} src={url} alt=""
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/> : null
  if (!hasPhoto) {
    const Glyph = illustrations[place.category] || MapPin
    const artwork = <span className="place-illustration" data-category={place.category || 'Place'}>
      <Glyph size={25} aria-hidden="true"/><small>Illustration</small>
    </span>
    return <figure ref={anchor} className={['place-photo','place-photo-illustrated',className].filter(Boolean).join(' ')}>
      {onOpen ? <button className="place-photo-open" type="button" onClick={onOpen} aria-label={`Open details for ${place.name}`}>{artwork}</button> : artwork}
    </figure>
  }
  const picture = <img src={url} alt={place.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/>
  return <figure className={['place-photo',className].filter(Boolean).join(' ')}>
    {onOpen ? <button className="place-photo-open" type="button" aria-label={`Open photos and details for ${place.name}`} onClick={onOpen}>{picture}</button> :
      source ? <a className="place-photo-open" href={source} target="_blank" rel="noreferrer" aria-label={`Open photo source for ${place.name} in a new tab`}>{picture}</a> : picture}
      <figcaption>{photo.credit}{photo.authors?.map((author,index)=><span key={index}>{https(author.url)?<a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>:author.name} · </span>)}{source&&<>{photo.credit&&' · '}<a href={source} target="_blank" rel="noreferrer">{photo.authors?'Photo on Google Maps':'Photo source'}</a></>}
        {photo.license&&<> · {license?<a href={license} target="_blank" rel="noreferrer">{photo.license}</a>:photo.license}</>}
      </figcaption>
  </figure>
}
