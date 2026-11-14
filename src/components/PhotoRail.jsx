import React,{useEffect,useRef,useState} from 'react'
import {ChevronLeft,ChevronRight} from 'lucide-react'
import {request} from '../api.mjs'
import {PlacePhoto} from './PlacePhoto.jsx'
import './PhotoRail.css'

const PHOTO_CACHE='yatra.area-photos.v1'
const photoKey=(name,lat,lon)=>name&&Number.isFinite(lat)&&Number.isFinite(lon)?`${name.trim().toLocaleLowerCase()}|${lat.toFixed(1)}|${lon.toFixed(1)}`:null

function storedPhotos(){
  try{return JSON.parse(localStorage.getItem(PHOTO_CACHE)||'{}')||{}}catch{return {}}
}

export function rememberAreaPhotos(name,items,lat,lon){
  const key=photoKey(name,lat,lon)
  if(!key||!items.length)return
  try{
    const all=storedPhotos()
    const old=Date.now()-(all[key]?.at||0)<7*86400000?all[key].items||[]:[]
    const combined=[...new Map([...items,...old].map(item=>[item.sourceUrl,item])).values()].slice(0,18)
    const keep=Object.fromEntries(Object.entries(all).filter(([id])=>id!==key).sort((a,b)=>a[1].at-b[1].at).slice(-23))
    localStorage.setItem(PHOTO_CACHE,JSON.stringify({...keep,[key]:{at:Date.now(),items:combined}}))
  }catch{/* Media can still load without browser storage. */}
}

export function PhotoRail({title,description,children,count,className=''}) {
  const rail=useRef(null)
  if(!count)return null
  const move=direction=>{
    if(!rail.current)return
    rail.current.scrollBy({left:direction*rail.current.clientWidth*.83,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'})
  }
  return <section className={'photo-rail '+className} aria-label={title}>
    <div className="photo-rail-header"><div><h3>{title}</h3>{description&&<p>{description}</p>}</div>
      {count>1&&<div className="photo-rail-buttons"><button type="button" aria-label={`Previous ${title.toLowerCase()}`} onClick={()=>move(-1)}><ChevronLeft size={19}/></button><button type="button" aria-label={`Next ${title.toLowerCase()}`} onClick={()=>move(1)}><ChevronRight size={19}/></button></div>}
    </div>
    <div className="photo-rail-track" ref={rail} tabIndex={count>1?0:undefined}>{children}</div>
  </section>
}

function useAreaPhotos(name,lat,lon,cityId,enabled) {
  const [photos,setPhotos]=useState([])
  const [loading,setLoading]=useState(false)
  useEffect(()=>{
    const saved=storedPhotos()[photoKey(name,lat,lon)]
    const recent=saved&&Date.now()-saved.at<7*86400000?saved.items:[]
    setPhotos(recent)
    if(!enabled||!name||!Number.isFinite(lat)||!Number.isFinite(lon)){setLoading(false);return}
    const controller=new AbortController()
    const params=new URLSearchParams({q:name,lat:String(lat),lon:String(lon),radius:'6000',type:'photo'})
    setLoading(true)
    async function load(){
      let items=[]
      try{const result=await request('places/media?'+params,{signal:controller.signal});items=(result.items||[]).filter(item=>item.type==='photo')}catch{/* Try the public place results below. */}
      if(!controller.signal.aborted&&items.length<8){
        try{
          const result=cityId?await request('locations/'+cityId+'/nearby',{signal:controller.signal}):await request('places/search?'+new URLSearchParams({q:name,category:'attractions'}),{signal:controller.signal})
          items=[...items,...(result.places||[]).filter(place=>place.photo?.url&&place.photo?.sourceUrl).map(place=>({...place.photo,title:place.name,nearby:place.photo.kind==='nearby'}))]
        }catch{/* Keep any verified photos from the first source. */}
      }
      if(!controller.signal.aborted){
        rememberAreaPhotos(name,items,lat,lon)
        setPhotos([...new Map([...items,...recent].map(item=>[item.sourceUrl,item])).values()].slice(0,18));setLoading(false)
      }
    }
    void load()
    return ()=>controller.abort()
  },[name,lat,lon,cityId,enabled])
  return {photos,loading}
}

export function ReferencePhotos({location,description,className='',loadingLabel=true,grid=false,limit}) {
  const name=location?.name
  const coordinates=location?.places?.[0]||location||{}
  const rawId=String(location?.cityId||location?.id||'').replace(/^geo:/,'')
  const {photos,loading}=useAreaPhotos(name,coordinates.lat,coordinates.lon,/^\d+$/.test(rawId)?rawId:null,Boolean(location))
  const [broken,setBroken]=useState(()=>new Set())
  const visible=photos.filter(item=>!broken.has(item.sourceUrl)).slice(0,limit)
  if(loading&&loadingLabel&&!visible.length)return <div className="reference-photos-loading" role="status"><span/>Looking for reference photos near {name}</div>
  const title=`${name} in photos`
  const caption=description||'Licensed photos of the area. See each image for its location and credit.'
  const tiles=visible.map(item=><article className="photo-rail-tile" key={item.sourceUrl}>
      <PlacePhoto place={{name:item.title,photo:{...item,kind:item.nearby?'nearby':undefined}}} hideUnavailable onUnavailable={()=>setBroken(current=>new Set([...current,item.sourceUrl]))}/>
      <p>{item.title}</p>
    </article>)
  if(grid&&tiles.length)return <section className={'photo-rail '+className} aria-label={title}>
    <header className="photo-rail-header"><div><h3>{title}</h3><p>{caption}</p></div></header>
    <div className="destination-photo-grid">{tiles}</div>
  </section>
  return <PhotoRail title={title} description={caption} count={visible.length} className={className}>{tiles}</PhotoRail>
}
