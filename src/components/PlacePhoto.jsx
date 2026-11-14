import React,{useEffect,useRef,useState} from 'react'
import {request} from '../api.mjs'

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

export function PlacePhoto({place,hideUnavailable=false,onUnavailable,compact=false,className='',onOpen,lookup=false,placeholder=null}){
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
  if(!hasPhoto && waiting) return <span ref={anchor} className="place-photo-lookup">{placeholder}</span>
  if(!hasPhoto && !source && (hideUnavailable || compact || lookup)) return placeholder
  const license=https(photo?.licenseUrl)
  function imageFailed() {
    setFailed(previous => [...previous, url])
    if (!lookup && !urls.some(candidate=>candidate!==url&&!failed.includes(candidate))) onUnavailable?.()
  }
  if(compact)return hasPhoto ? <img className={className} src={url} alt=""
    loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/> : null
  const picture = hasPhoto && <img src={url} alt={place.name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={imageFailed}/>
  return <figure className={['place-photo',className,!hasPhoto&&hideUnavailable?'place-photo-source-only':''].filter(Boolean).join(' ')}>
    {hasPhoto?<>{onOpen ? <button className="place-photo-open" type="button" aria-label={`Open photos and details for ${place.name}`} onClick={onOpen}>{picture}</button> :
      source ? <a className="place-photo-open" href={source} target="_blank" rel="noreferrer" aria-label={`Open photo source for ${place.name} in a new tab`}>{picture}</a> : picture}
      <figcaption>{photo.credit}{photo.authors?.map((author,index)=><span key={index}>{https(author.url)?<a href={author.url} target="_blank" rel="noreferrer">{author.name}</a>:author.name} · </span>)}{source&&<>{photo.credit&&' · '}<a href={source} target="_blank" rel="noreferrer">{photo.authors?'Photo on Google Maps':'Photo source'}</a></>}
        {photo.license&&<> · {license?<a href={license} target="_blank" rel="noreferrer">{photo.license}</a>:photo.license}</>}
      </figcaption></>:<>
      {source&&<figcaption><a href={source} target="_blank" rel="noreferrer">Open original photo</a></figcaption>}
    </>}
  </figure>
}
