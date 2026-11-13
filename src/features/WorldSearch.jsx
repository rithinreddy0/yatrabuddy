import React, {useEffect,useMemo,useRef,useState} from 'react'
import {freshnessLabel, request, travelData} from '../api.mjs'
import {AgentProgress,Button,Icon,IconButton,Pill,SourcePill} from '../components/UI.jsx'
import {HotelSearch} from './TravelDesk.jsx'
import './WorldSearch.css'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {PhotoRail,ReferencePhotos} from '../components/PhotoRail.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {PlaceSummary} from '../components/PlaceSummary.jsx'
import {revealResult} from '../components/revealResult.mjs'
import {summarizePlaces} from './travelSummary.mjs'

const categories=[
  {id:'all',label:'Explore',icon:'map',title:'Find anywhere'},
  {id:'hotels',label:'Hotels',icon:'bed',title:'Find hotels worldwide'},
  {id:'stays',label:'Stays',icon:'trip',title:'Find a place to stay'},
  {id:'attractions',label:'Places to visit',icon:'pin',title:'Find places to visit'},
  {id:'food',label:'Food',icon:'fork',title:'Find places to eat'},
]
const examples={
  all:['Kyoto, Japan','Barcelona, Spain','Cape Town, South Africa'],
  hotels:['Hotels in Lisbon','Hotels in Tokyo'],
  stays:['Resorts in Bali','Guesthouses in Rome'],
  attractions:['Museums in Paris','Places to visit in Cape Town'],
  food:['Restaurants in Singapore','Cafés in Melbourne'],
}
const interestCategories={
  Adventure:['Activity','Nature'],Culture:['Sight'],Food:['Food'],Nature:['Nature'],Shopping:['Shopping'],
}
const sorts=[
  ['relevance','Relevance'],['personalized','My interests'],['rating','Highest rating'],['reviews','Most reviewed'],['distance','Nearest first'],
]
const TILE_SIZE=256
const TILE_URL=import.meta.env.VITE_MAP_TILE_URL||'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
const clamp=(value,min,max)=>Math.min(max,Math.max(min,value))

function project(lat,lon,zoom){
  const size=TILE_SIZE*2**zoom
  const sin=Math.sin(clamp(lat,-85.0511,85.0511)*Math.PI/180)
  return [(lon+180)/360*size,(0.5-Math.log((1+sin)/(1-sin))/(4*Math.PI))*size]
}
function fitMap(points,width,height){
  const projected=points.map(point=>project(point.lat,point.lon,0))
  const xs=projected.map(point=>point[0])
  const ys=projected.map(point=>point[1])
  const anchor=xs[0]
  const wrapped=xs.map(x=>x-anchor>TILE_SIZE/2?x-TILE_SIZE:anchor-x>TILE_SIZE/2?x+TILE_SIZE:x)
  const bounds=[Math.min(...wrapped),Math.min(...ys),Math.max(...wrapped),Math.max(...ys)]
  const zoom=clamp(Math.floor(Math.log2(Math.min(
    Math.max(1,width-100)/Math.max(0.001,bounds[2]-bounds[0]),
    Math.max(1,height-100)/Math.max(0.001,bounds[3]-bounds[1])
  ))),1,16)
  return {zoom,x:(bounds[0]+bounds[2])/2*2**zoom,y:(bounds[1]+bounds[3])/2*2**zoom}
}

function PlaceMap({places,active,onSelect}){
  const host=useRef(null)
  const drag=useRef(null)
  const dismissPreview=useRef(null)
  const [dimensions,setDimensions]=useState({width:0,height:0})
  const [override,setOverride]=useState(null)
  const [hovered,setHovered]=useState(null)
  const [focused,setFocused]=useState(null)
  const [pinned,setPinned]=useState(null)
  const points=useMemo(()=>places.filter(place=>Number.isFinite(place.lat)&&Number.isFinite(place.lon)),[places])
  useEffect(()=>{
    const node=host.current
    const observer=new ResizeObserver(([entry])=>setDimensions({width:entry.contentRect.width,height:entry.contentRect.height}))
    observer.observe(node)
    return ()=>{observer.disconnect();clearTimeout(dismissPreview.current)}
  },[])
  const {width,height}=dimensions
  const frame=points.length&&width?override||fitMap(points,width,height):null
  const tiles=[]
  const pins=[]
  if(frame){
    const left=frame.x-width/2
    const top=frame.y-height/2
    const count=2**frame.zoom
    const size=TILE_SIZE*count
    for(let x=Math.floor(left/TILE_SIZE);x<=Math.floor((left+width-1)/TILE_SIZE);x++){
      for(let y=Math.floor(top/TILE_SIZE);y<=Math.floor((top+height-1)/TILE_SIZE);y++){
        if(y<0||y>=count)continue
        const url=TILE_URL.replace('{z}',String(frame.zoom)).replace('{x}',String((x%count+count)%count)).replace('{y}',String(y))
        tiles.push({key:x+','+y+':'+frame.zoom,url,x:x*TILE_SIZE-left,y:y*TILE_SIZE-top})
      }
    }
    points.forEach((point,index)=>{
      let [x,y]=project(point.lat,point.lon,frame.zoom)
      x+=Math.round((frame.x-x)/size)*size
      x-=left
      y-=top
      if(x>8&&x<width-8&&y>8&&y<height-8)pins.push({point,index,x,y})
    })
  }
  function zoom(delta){
    if(!frame)return
    const next=clamp(frame.zoom+delta,1,18)
    const scale=2**(next-frame.zoom)
    setOverride({zoom:next,x:frame.x*scale,y:frame.y*scale})
  }
  function startPan(event){
    if(!frame||event.button!==0||event.target.closest('button,a,.world-pin-preview'))return
    setPinned(null)
    drag.current={clientX:event.clientX,clientY:event.clientY,frame}
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function pan(event){
    if(!drag.current)return
    const origin=drag.current
    const size=TILE_SIZE*2**origin.frame.zoom
    setOverride({zoom:origin.frame.zoom,x:(origin.frame.x+origin.clientX-event.clientX)%size,
      y:clamp(origin.frame.y+origin.clientY-event.clientY,0,size)})
  }
  const preview=pins.find(pin=>pin.point.id===(hovered||focused||pinned||active))
  function clearHover(){
    clearTimeout(dismissPreview.current)
    dismissPreview.current=setTimeout(()=>setHovered(null),180)
  }
  return <section className="world-map-frame" aria-label="Map of results" tabIndex={-1}
    onPointerLeave={()=>setHovered(null)}
    onKeyDown={event=>{if(event.key==='Escape'){setHovered(null);setFocused(null);setPinned(null)}}}>
    <div className="world-map" ref={host} onPointerDown={startPan} onPointerMove={pan}
      onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}}>
      {tiles.map(tile=><img className="world-map-tile" aria-hidden="true" alt="" draggable={false} key={tile.key} src={tile.url} width={TILE_SIZE} height={TILE_SIZE}
        style={{left:tile.x,top:tile.y}}/>)}
      {pins.map(({point,index,x,y})=><button type="button" className={'world-pin '+(active===point.id?'active':'')}
        key={point.id} style={{left:x,top:y}} aria-label={'Show '+point.name} aria-expanded={preview?.point.id===point.id}
        onPointerEnter={event=>{if(event.pointerType==='mouse'){clearTimeout(dismissPreview.current);setHovered(point.id)}}}
        onPointerLeave={clearHover}
        onFocus={()=>setFocused(point.id)} onBlur={event=>{if(!event.relatedTarget?.closest('.world-pin-preview'))setFocused(null)}}
        onClick={()=>setPinned(previous=>previous===point.id?null:point.id)}>{index+1}</button>)}
      {preview&&<aside key={preview.point.id} className="world-pin-preview" aria-label={preview.point.name+' preview'}
        onPointerEnter={()=>clearTimeout(dismissPreview.current)} onPointerLeave={clearHover}
        style={{left:clamp(preview.x+18,8,Math.max(8,width-242)),top:clamp(preview.y-70,8,Math.max(8,height-230))}}>
        <PlacePhoto place={preview.point}/>
        <strong>{preview.point.name}</strong>
        <button className="world-preview-action" onClick={()=>onSelect(preview.point.id)}>Show place details</button>
      </aside>}
      {points.length>0&&<div className="world-map-tools">
        <IconButton icon="plus" label="Zoom in" onClick={()=>zoom(1)}/>
        <IconButton icon="minus" label="Zoom out" onClick={()=>zoom(-1)}/>
        <IconButton icon="pin" label="Fit all places" onClick={()=>setOverride(null)}/>
      </div>}
      {!points.length&&<p className="world-map-empty">Map coordinates are unavailable for these results.</p>}
      <a className="world-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>
    </div>
  </section>
}

function safeSource(url){
  try{
    const parsed=new URL(url)
    return ['https:','http:'].includes(parsed.protocol)?parsed.href:null
  }catch{return null}
}
function reviewerPhoto(value){
  const url=safeSource(value)
  if(!url)return null
  const {protocol,hostname}=new URL(url)
  return protocol==='https:'&&/(^|\.)(?:googleusercontent|ggpht)\.com$/.test(hostname)?url:null
}
function money(value){
  if(value?.amount==null||!value.currency)return null
  const amount=Number(value.amount)
  if(!Number.isFinite(amount))return null
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency:value.currency}).format(amount)}
  catch{return null}
}
function listedPrice(place){
  const lower=money(place.priceRange?.start)
  const upper=money(place.priceRange?.end)
  if(lower&&upper)return lower===upper?lower:lower+' – '+upper
  if(lower)return 'From '+lower
  if(upper)return 'Up to '+upper
  return {
    PRICE_LEVEL_FREE:'Free',
    PRICE_LEVEL_INEXPENSIVE:'Budget',
    PRICE_LEVEL_MODERATE:'Moderate',
    PRICE_LEVEL_EXPENSIVE:'Expensive',
    PRICE_LEVEL_VERY_EXPENSIVE:'Premium',
  }[place.priceLevel]||null
}

function ReviewDetails({place}){
  const [open,setOpen]=useState(false)
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    if(!open||data)return
    const controller=new AbortController()
    request('places/google/'+encodeURIComponent(place.id),{signal:controller.signal}).then(setData).catch(failure=>{
      if(!controller.signal.aborted)setError(failure.message)
    })
    return ()=>controller.abort()
  },[open,place.id,revision])
  return <div className="world-reviews">
    <Button variant="text-btn" icon="chat" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'Hide reviews':'Read reviews'}</Button>
    {open&&<div className="world-review-list">
      {!data&&!error&&<p className="form-note" role="status">Loading recent reviews…</p>}
      {error&&<p className="form-note">{error} <button type="button" className="world-inline-link" onClick={()=>{setError('');setRevision(value=>value+1)}}>Retry</button></p>}
      {data&&!data.reviews?.length&&<p className="form-note">This listing has no review excerpts available.</p>}
      {data?.reviews?.map((review,index)=>{
        const authorUrl=safeSource(review.author?.url)
        const reviewUrl=safeSource(review.url)
        const avatar=reviewerPhoto(review.author?.photoUrl)
        const published=review.publishedAt?new Date(review.publishedAt):null
        return <article className="world-review" key={review.url||index}>
          <header>
            <span className="world-review-author">
              {avatar&&<img src={avatar} width="28" height="28" loading="lazy" referrerPolicy="no-referrer" alt=""/>}
              {authorUrl?<a href={authorUrl} target="_blank" rel="noreferrer">{review.author?.name||'Google Maps reviewer'}</a>:<strong>{review.author?.name||'Google Maps reviewer'}</strong>}
            </span>
            {Number.isFinite(review.rating)&&<span aria-label={review.rating+' out of 5 stars'}>★ {review.rating}</span>}
          </header>
          {published&&!Number.isNaN(published.valueOf())&&<time dateTime={published.toISOString()}>{published.toLocaleDateString()}</time>}
          {review.text&&<p>{review.text}</p>}
          {reviewUrl&&<SourcePill label="Review on Google Maps" url={reviewUrl}/>}
        </article>
      })}
    </div>}
  </div>
}

function ResultCard({place,index,active,onMapSelect,mapAvailable}){
  const google=place.source==='Google Maps'
  const price=listedPrice(place)
  const url=safeSource(place.url)
  const distance=Number.isFinite(place.distanceMetres)?(place.distanceMetres/1000).toLocaleString(undefined,{maximumFractionDigits:1})+' km from city center':null
  const rating=Number.isFinite(place.rating)?place.rating.toFixed(1):null
  const mapsLookup='https://www.google.com/maps/search/?api=1&query='+encodeURIComponent([place.name,place.address].filter(Boolean).join(', '))
  return <article id={'world-result-'+index} tabIndex={-1} className={'world-result '+(active?'world-result-active':'')}>
    <div className="world-result-media">
    <PlacePhoto place={place} hideUnavailable/>
    <div className="world-result-top">
      {mapAvailable&&<button className="world-result-number" type="button" aria-label={'Highlight '+place.name+' on map'} onClick={onMapSelect}>{index+1}</button>}
      <div className="world-result-title">
        <p className="world-result-type">{place.category==='Stay'?'Stay':place.category||'Place'}</p>
        <h2>{place.name}</h2>
        {(place.address||distance)&&<p className="world-result-address">{place.address||distance}</p>}
      </div>
      {rating&&<div className="world-rating" aria-label={rating+' out of 5 stars'}><span aria-hidden="true">★</span> {rating}</div>}
    </div>
    </div>
    {(place.description||place.overview)&&<div className="world-about">
      <p className="world-description">{place.description||place.overview}</p>
      {place.overview&&place.description&&place.overview!==place.description&&<details>
        <summary>More about {place.name}</summary><p>{place.overview}</p>
        {safeSource(place.overviewUrl)&&<SourcePill label="Wikipedia overview" url={place.overviewUrl}/>}
      </details>}
    </div>}
    {(place.reviewCount!=null||price)&&<div className="world-result-facts">
      {place.reviewCount!=null&&<span>{place.reviewCount.toLocaleString()} {place.reviewCount===1?'review':'reviews'}</span>}
      {price&&<span>{place.category==='Stay'?'Price level: ':''}{price}</span>}
    </div>}
    <div className="world-result-sources">
      {url&&<SourcePill label={place.source||'Source'} url={url}/>}
      {!place.description&&place.overview&&place.overviewUrl!==place.url&&safeSource(place.overviewUrl)&&<SourcePill label="Wikipedia overview" url={place.overviewUrl}/>}
      {!google&&<SourcePill label="Look up reviews on Google Maps" url={mapsLookup}/>}
      {Array.isArray(place.attributions)&&place.attributions.map((item,index)=>{
        const attributionUrl=safeSource(item.url||item.providerUri)
        const label=item.name||item.provider
        return label&&(attributionUrl?<SourcePill key={index} label={label} url={attributionUrl}/>:<span key={index} className="form-note">{label}</span>)
      })}
    </div>
    {google&&place.reviewCount>0&&<ReviewDetails place={place}/>}
  </article>
}

function searchParams(criteria,pageToken){
  const params=new URLSearchParams({q:criteria.query||criteria.location?.name,category:criteria.category,sort:criteria.sort==='personalized'?'relevance':criteria.sort})
  if(criteria.location)params.set('location_id',String(criteria.location.id))
  if(criteria.minRating)params.set('min_rating',criteria.minRating)
  if(pageToken)params.set('page_token',pageToken)
  return params
}

export function WorldSearch({initialCategory='all',initialQuery='',initialDestination,profile,onPlan}){
  const category=categories.find(item=>item.id===initialCategory)||categories[0]
  const [draft,setDraft]=useState(initialQuery||initialDestination?.name||'')
  const [criteria,setCriteria]=useState(()=>({query:draft,category:category.id,sort:'relevance',minRating:'',
    location:initialDestination?{...initialDestination,id:Number(initialDestination.id.slice(4))}:null,revision:0}))
  const [result,setResult]=useState(null)
  const [loading,setLoading]=useState(false)
  const [moreLoading,setMoreLoading]=useState(false)
  const [error,setError]=useState('')
  const [active,setActive]=useState('')
  const [tab,setTab]=useState('list')
  const [photosOnly,setPhotosOnly]=useState(false)
  const moreRequest=useRef(null)
  const sequence=useRef(0)
  const resultsHeading=useRef(null)
  const resultsWorkspace=useRef(null)
  const searchError=useRef(null)
  const submitted=useRef(false)
  useEffect(()=>{
    if(!criteria.query&&!criteria.location)return
    const controller=new AbortController()
    moreRequest.current?.abort()
    sequence.current++
    setLoading(true)
    setMoreLoading(false)
    setResult(null)
    setActive('')
    setError('')
    travelData('places/search?'+searchParams(criteria),{signal:controller.signal}).then(data => {
      if (!controller.signal.aborted) setResult(data)
    }).catch(failure=>{
      if (controller.signal.aborted) return
      setError(failure.message)
    }).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return ()=>controller.abort()
  },[criteria])
  useEffect(()=>()=>moreRequest.current?.abort(),[])
  useEffect(()=>{
    if((!result&&!error)||!submitted.current)return
    submitted.current=false
    revealResult(result?resultsHeading.current:searchError.current,{focus:true})
  },[result,error])

  function submit(query,location=null){
    const trimmed=query.trim()
    if(trimmed.length<2&&!location)return
    submitted.current=true
    setDraft(trimmed)
    setCriteria(previous=>({...previous,query:trimmed,location,revision:previous.revision+1}))
  }

  async function loadMore(){
    if(!result?.nextPageToken||moreLoading)return
    const currentSequence=sequence.current
    const controller=new AbortController()
    moreRequest.current=controller
    setMoreLoading(true)
    setError('')
    try{
      const page=await request('places/search?'+searchParams(criteria,result.nextPageToken),{signal:controller.signal})
      if(currentSequence!==sequence.current||controller.signal.aborted)return
      setResult(previous=>{
        const seen=new Set(previous.places.map(place=>place.id))
        return {...previous,places:[...previous.places,...page.places.filter(place=>!seen.has(place.id))],nextPageToken:page.nextPageToken}
      })
    }catch(failure){
      if(currentSequence===sequence.current&&!controller.signal.aborted)setError(failure.message)
    }finally{
      if(currentSequence===sequence.current&&!controller.signal.aborted)setMoreLoading(false)
    }
  }

  const selectedCategory=categories.find(item=>item.id===criteria.category)||category
  const suggestedThemes=[...new Set([...(profile?.interests||[]),profile?.style].filter(Boolean))]
  const preferred=new Set(suggestedThemes.flatMap(theme=>interestCategories[theme]||[]))
  const places=(result?.places||[]).filter(place=>!photosOnly||place.photo?.url)
  const ranked=criteria.sort==='personalized'?[...places].sort((first,second)=>Number(preferred.has(second.category))-Number(preferred.has(first.category))):places
  const google=result?.provider==='Google Maps'||ranked.some(place=>place.source==='Google Maps')
  const verifiedRatings=google||['available','ready','empty','unavailable'].includes(result?.sources?.googleMaps?.status)
  const hasMap=ranked.some(place=>Number.isFinite(place.lat)&&Number.isFinite(place.lon))&&!google
  const hotelCity=criteria.location||result?.location
  const mapKey=result?.retrievedAt+'-'+ranked.length
  function selectMap(id){
    setActive(id)
    setTab('list')
    const index=ranked.findIndex(item=>item.id===id)
    revealResult(()=>resultsWorkspace.current?.querySelector('#world-result-'+index),{focus:true})
  }
  function showMap(id){
    if(id)setActive(id)
    setTab('map')
    revealResult(()=>resultsWorkspace.current?.querySelector('.world-map-frame'),{focus:true})
  }
  const illustrated=ranked.filter(place=>place.photo?.url).slice(0,10)
  const referenceCity=result?.location||criteria.location
  const briefTopic={hotels:'stays',stays:'stays',food:'food',attractions:'experiences'}[criteria.category]||'overview'
  const summary=summarizePlaces(ranked,{profile})
  return <div className={'page world-search'+(initialDestination?' world-search-embedded':'')}>
    <header className="world-search-head">
      {!initialDestination&&<div>
        <p className="eyebrow"><span/> WORLDWIDE SEARCH</p>
        <h1>{selectedCategory.title}</h1>
        <p className="lede">Search for a destination, a type of place, or a specific name.</p>
      </div>}
      <nav className="world-category-nav" aria-label="Search category">
        {categories.map(item=><Pill key={item.id} icon={item.icon} active={criteria.category===item.id}
          onClick={()=>setCriteria(previous=>({...previous,category:item.id,minRating:''}))}>{item.label}</Pill>)}
      </nav>
      {!initialDestination&&<form className="world-search-form" onSubmit={event=>{event.preventDefault();submit(draft,criteria.location)}}>
        <label className="sr-only" htmlFor="world-place-query">Search places worldwide</label>
        <Icon name="search" size={19}/>
        <input id="world-place-query" type="search" placeholder="Try “Kyoto” or “museums in Madrid”" value={draft}
          maxLength={150} onChange={event=>setDraft(event.target.value)} required={!criteria.location}/>
        <Button type="submit" variant="primary" icon="arrow" disabled={draft.trim().length<2&&!criteria.location}>Search</Button>
      </form>}
      {!initialDestination&&criteria.location&&<div className="world-location">
        <Icon name="pin" size={15}/> {criteria.location.name}{criteria.location.country&&', '+criteria.location.country}
        <IconButton icon="close" label="Clear selected city" onClick={()=>setCriteria(previous=>({...previous,location:null}))}/>
      </div>}
      {!criteria.query&&!loading&&!result&&<div className="world-examples" aria-label="Example searches">
        {examples[criteria.category].map(query=><Pill icon="search" key={query} onClick={()=>submit(query)}>{query}</Pill>)}
      </div>}
    </header>
    {loading&&<div className="world-loading"><AgentProgress label={'Searching for '+(criteria.query||criteria.location?.name)}/><div className="result-skeletons" aria-hidden="true">{[0,1,2].map(item=><div className="result-skeleton" key={item}><i/><div><b/><b/></div></div>)}</div></div>}
    {error&&!result&&<div className="panel world-message" role="alert" ref={searchError} tabIndex={-1}><p>{error}</p><Button onClick={()=>submit(criteria.query,criteria.location)}>Try again</Button></div>}
    {result&&<section className="world-results" aria-label="Worldwide search results">
      <div className="world-results-toolbar">
        <div aria-live="polite">
          <h2 ref={resultsHeading} tabIndex={-1}>{ranked.length?ranked.length.toLocaleString()+' places':'Search results'}</h2>
          <p className="form-note">{result.status==='ready'&&freshnessLabel(result)+' · '}{result.provider||'Public sources'}</p>
        </div>
        <div className="world-filter-row">
          <Pill active={photosOnly} onClick={()=>setPhotosOnly(value=>!value)}>With photos</Pill>
          <label>Sort <select value={criteria.sort} onChange={event=>setCriteria(previous=>({...previous,sort:event.target.value}))}>
            {sorts.map(([id,label])=><option value={id} key={id} disabled={(id==='personalized'&&!preferred.size)||(!verifiedRatings&&['rating','reviews'].includes(id))}>{label}</option>)}
          </select></label>
          {verifiedRatings&&<label>Minimum verified rating <select value={criteria.minRating} onChange={event=>setCriteria(previous=>({...previous,minRating:event.target.value}))}>
            <option value="">Any rating</option><option value="3">3+</option><option value="4">4+</option><option value="4.5">4.5+</option>
          </select></label>}
        </div>
      </div>
      {!initialDestination&&!!result.locations?.length&&<div className="world-city-matches" aria-label="Matching cities">
        {result.locations.slice(0,5).map(city=><div className="world-city" key={city.id}>
          <Icon name="pin" size={16}/><div><strong>{city.name}</strong><small>{[...new Set([city.region,city.country].filter(Boolean))].join(', ')}</small></div>
          {Number(criteria.location?.id)!==Number(city.id)&&<Button variant="text-btn" onClick={()=>submit(criteria.query,city)}>Search here</Button>}
          {onPlan&&<Button variant="text-btn" onClick={()=>onPlan('','geo:'+city.id,{...city,id:'geo:'+city.id})}>Plan trip</Button>}
        </div>)}
      </div>}
      <PlaceSummary summary={summary} onSelect={place=>selectMap(place.id)}/>
      {referenceCity&&<DestinationBrief location={referenceCity} topic={briefTopic} compact/>}
      {hotelCity&&['hotels','stays'].includes(criteria.category)&&
        <HotelSearch key={hotelCity.id} place={{...hotelCity,id:'geo:'+hotelCity.id}} profile={profile}/>}
      {!ranked.length&&<div className="panel world-message" role="status">
        <h3>{result.status==='unavailable'?'Place sources are unavailable':'No places matched'}</h3>
        <p>{result.status==='unavailable'?'Try again shortly.':photosOnly?'Turn off With photos to see every result.':'Try a city and country, choose a matching city, or broaden the category.'}</p>
      </div>}
      {illustrated.length>0?<PhotoRail title="Place photos" count={illustrated.length}>{illustrated.map(place=><article className="photo-rail-tile" key={place.id}>
        <PlacePhoto place={place} hideUnavailable/><p>{place.name}</p>
      </article>)}</PhotoRail>:referenceCity&&<ReferencePhotos location={referenceCity} loadingLabel={false} description="Licensed photos of the area for context."/>}
      {google&&<p className="world-coverage">Google Maps · Place price levels describe typical cost. Check the property for live room rates. <a href="https://support.google.com/contributionpolicy/answer/7400114" target="_blank" rel="noreferrer">Google Maps review policy</a></p>}
      {hasMap&&<div className="world-view-switch" role="group" aria-label="Results view">
        <Pill active={tab==='list'} icon="menu" onClick={()=>{setTab('list');revealResult(()=>resultsWorkspace.current?.querySelector('.world-result-list'),{focus:true})}}>List</Pill>
        <Pill active={tab==='map'} icon="map" onClick={()=>showMap()}>Map</Pill>
      </div>}
      {ranked.length>0&&<div ref={resultsWorkspace} className={'world-workspace '+(hasMap?'world-with-map ':'')+'world-view-'+tab}>
        <div className="world-result-list" tabIndex={-1}>
          {ranked.map((place,index)=><ResultCard key={place.id} place={place} index={index} active={active===place.id} mapAvailable={hasMap} onMapSelect={()=>showMap(place.id)}/>)}
          {error&&<p className="form-error" role="alert">{error}</p>}
        </div>
        {hasMap&&<PlaceMap key={mapKey} places={ranked} active={active} onSelect={selectMap}/>}
      </div>}
      {result.nextPageToken&&<Button icon="plus" disabled={moreLoading} onClick={loadMore}>{moreLoading?'Loading…':'More places'}</Button>}
    </section>}
  </div>
}
