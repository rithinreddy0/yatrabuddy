import React,{useEffect,useState} from 'react'
import {BusFront,CalendarDays,CloudSun,Compass,Hotel,Mountain,ShieldCheck,TreePine,Utensils} from 'lucide-react'
import {Icon} from './UI.jsx'
import {visibleSource} from './sourceUrl.mjs'
import {TravelHighlights} from './TravelHighlights.jsx'
import {request} from '../api.mjs'
import '../features/ResearchBrief.css'

const inFlight=new Map()
const cached=new Map()
const TTL=45*60*1000
const storagePrefix='yatra.cityBrief.v2.'
const icons={routes:BusFront,transport:BusFront,safety:ShieldCheck,health:ShieldCheck,weather:CloudSun,stays:Hotel,food:Utensils,
  events:CalendarDays,culture:CalendarDays,nature:TreePine,adventure:Mountain,cons:ShieldCheck}

function fetchBrief(key) {
  if(inFlight.has(key))return inFlight.get(key)
  const promise=request('city-briefing?'+key,{signal:AbortSignal.timeout(21500)}).then(report=>{
    if(report.sections?.length){
      if(cached.size>=32)cached.delete(cached.keys().next().value)
      const entry={report,at:Date.now()}
      cached.set(key,entry)
      try{sessionStorage.setItem(storagePrefix+key,JSON.stringify(entry))}catch{/* Memory cache is still available. */}
    }
    return report
  }).finally(()=>inFlight.delete(key))
  inFlight.set(key,promise)
  return promise
}

export function useCityBrief(location,topic='overview',attempt=0) {
  const [state,setState]=useState({key:'',report:null,loading:false})
  const id=String(location?.cityId||location?.id||'').replace(/^geo:/,'')
  const q=location?.name&&[...new Set([location.name,location.region,location.country].filter(Boolean))].join(', ').slice(0,100)
  const key=location&&(Number(id)>0||q)?new URLSearchParams(Number(id)>0?{topic,location_id:id}:{topic,q}).toString():''
  useEffect(()=>{
    if(!key)return
    let keep=true
    let existing=cached.get(key)
    if(!existing)try{existing=JSON.parse(sessionStorage.getItem(storagePrefix+key))}catch{/* Cache is optional. */}
    if(!attempt&&existing?.report&&Date.now()-existing.at<(topic==='weather'?5*60*1000:TTL)){setState({key,report:existing.report,loading:false});return}
    setState({key,report:null,loading:true})
    fetchBrief(key).then(report=>{
      if(keep)setState({key,report,loading:false})
    }).catch(()=>{if(keep)setState({key,report:{status:'unavailable'},loading:false})})
    return()=>{keep=false}
  },[key,attempt])
  return state.key===key?state:{report:null,loading:Boolean(key)}
}

export function CityBrief({name,report,weather,airQuality,loading,compact=false,destination=false,children}) {
  const rows=report?.sections||[]
  const checked=report?.retrievedAt
  const advice=report?.advisories||[]
  if(compact&&!rows.length&&!loading&&!children&&!advice.length)return null
  const shown=compact?rows.slice(0,3):rows
  const primary=destination&&report?.topic==='overview'?shown.slice(0,6):shown
  const renderPoints=points=><div className="city-brief-points">{points.map(point=>{
    const Glyph=icons[point.kind]||Compass
    const source=visibleSource(point.sourceUrl)
    return <article key={point.title} data-kind={point.kind}>
      <h3><span className="city-point-icon"><Glyph size={17} aria-hidden="true"/></span>{point.title}</h3>
      <TravelHighlights text={point.text} points={point.points} limit={2}/>
      {source&&<a href={source.href} target="_blank" rel="noreferrer">{point.source||'Source'} ↗</a>}
      {point.licenseUrl&&<a className="city-brief-license" href={point.licenseUrl} target="_blank" rel="noreferrer">{point.license}</a>}
    </article>
  })}</div>
  return <section className={'panel city-brief'+(compact?' city-brief-compact':'')+(destination?' city-brief-destination':'')} aria-label={`City briefing for ${name}`}>
    <header className="city-brief-head"><span className="city-brief-icon"><Compass size={25}/></span><div><small className="city-brief-kicker">TRAVEL BRIEF</small><h2>{name}, {destination&&report?.topic&&report.topic!=='overview'?'quick guide':'at a glance'}</h2>
      {checked&&Number.isFinite(Date.parse(checked))&&<time dateTime={checked}>Checked {new Date(checked).toLocaleString()}{report.freshness==='cached'?' · cached guide':''}</time>}</div></header>
    {weather&&<p className="city-brief-weather"><Icon name="globe" size={17}/><span><strong>{weather.temperature}°C · {weather.conditions}</strong>{airQuality&&` · Model US AQI ${airQuality.index}`}</span></p>}
    {loading&&<p className="city-brief-loading" role="status"><span/>Reading the city guide and safety notes…</p>}
    {!!primary.length&&renderPoints(primary)}
    {shown.length>primary.length&&<details className="city-brief-more"><summary>More practical details</summary>{renderPoints(shown.slice(primary.length))}</details>}
    {destination&&rows.some(point=>['transport','stays','events'].includes(point.kind))&&<small className="travel-source-note">Confirm published prices, hours, and event dates before you go.</small>}
    {!compact&&report&&!rows.length&&<p className="city-brief-limit">City guide details aren’t available from our sources right now.</p>}
    {children}
    {!compact&&<div className="city-brief-practical"><h3><Icon name="pin" size={18}/> Before you head out</h3><p>Check your return trip, confirm closures and opening hours with the venue, and look up current advisories if conditions change.</p>
      {!!advice.length&&<div className="city-brief-advisories">{advice.map(item=><a key={item.sourceUrl} href={item.sourceUrl} target="_blank" rel="noreferrer">{item.title} ↗</a>)}</div>}
    </div>}
  </section>
}

export function DestinationBrief({location,topic='overview',compact=false,destination=false,attempt=0,children}) {
  const {report,loading}=useCityBrief(location,topic,attempt)
  if(!location)return null
  return <CityBrief name={location.name} report={report} loading={loading} compact={compact} destination={destination}>{children}</CityBrief>
}
