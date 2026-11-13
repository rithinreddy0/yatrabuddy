import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,Icon,Pill,SourcePill} from '../components/UI.jsx'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {fetchResearch,researchTopics} from '../research.mjs'
import {request} from '../api.mjs'
import {CityBrief, useCityBrief} from '../components/CityBrief.jsx'
import {ReferencePhotos} from '../components/PhotoRail.jsx'
import {revealResult} from '../components/revealResult.mjs'
import './ResearchBrief.css'

export function CheckedAt({value}){
  if(!value||!Number.isFinite(Date.parse(value)))return null
  const formatted=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
  return <time dateTime={value}>Checked {formatted}</time>
}

const statusLabels={ready:'Available',partial:'Partial results',empty:'No results',disabled:'Off',unavailable:'Unavailable'}
export function SourceStatus({result}){
  if(!result?.sources)return null
  return <div className="source-status" aria-label="Research sources">
    {Object.entries(result.sources).map(([id,source])=><div className="source-status-item" key={id}>
      <span className={'source-dot '+source.status} aria-hidden="true"/>{source.url?<a href={source.url} target="_blank" rel="noreferrer">{source.provider}</a>:<span>{source.provider}</span>}
      <small>{statusLabels[source.status]||source.status}</small>
    </div>)}
  </div>
}

export function Findings({result,compact=false}) {
  if(!result)return null
  const findings=compact?result.findings.slice(0,1):result.findings
  return <>
    <div className={'research-results '+(compact?'research-results-compact':'')}>
      {result.weather&&<article className="panel finding"><div className="eyebrow"><Icon name="globe" size={15}/> WEATHER</div><h3>{result.weather.temperature}°C · {result.weather.conditions}</h3><p>Model conditions at {result.weather.time.replace('T',' ')} ({result.weather.timezone}).</p><SourcePill url={result.weather.url} label="Open-Meteo"/></article>}
      {!compact&&result.weather?.forecast?.length>0&&<article className="panel finding"><div className="eyebrow"><Icon name="calendar" size={15}/> YOUR TRIP DATES</div><h3>Forecast outlook</h3>{result.weather.forecast.map(day=><p key={day.date}>{day.date} · {Math.round(day.min)}–{Math.round(day.max)}°C{day.code>=51?' · precipitation possible':''}</p>)}<SourcePill url={result.weather.url} label="Open-Meteo forecast"/></article>}
      {result.airQuality&&<article className="panel finding"><div className="eyebrow"><Icon name="globe" size={15}/> AIR QUALITY</div><h3>US AQI {result.airQuality.index}</h3><p>Model estimate at {result.airQuality.time.replace('T',' ')} ({result.airQuality.timezone}), via Open-Meteo.</p><SourcePill url={result.airQuality.url} label="Open-Meteo / CAMS"/></article>}
      {findings.map(item=><article className="panel finding" key={item.url}><div className="eyebrow"><Icon name="sparkle" size={14}/> {item.kind==='reference'?'DESTINATION REFERENCE':item.agent.toUpperCase()}</div><h3>{item.title}</h3>{item.snippet&&<p>{item.snippet}</p>}<SourcePill url={item.url} label={item.provider}/></article>)}
    </div>
    <SourceStatus result={result}/>
    {result.status==='unavailable'&&<p className="form-note" role="status">Web sources are unavailable right now.</p>}
    {result.status==='empty'&&<p className="form-note" role="status">No web sources matched this search.</p>}
  </>
}

export function Research({catalog,topic:initialTopic='overview',defaultDestination=null,onResults,profile,trip,compact=false,auto=false}) {
  const [topic,setTopic]=useState(initialTopic)
  const [selected,setSelected]=useState(()=>typeof defaultDestination==='object'&&defaultDestination?.id?defaultDestination:catalog.find(item=>item.id===defaultDestination)||(compact||trip?catalog[0]:null))
  const [result,setResult]=useState(null)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  const [briefAttempt,setBriefAttempt]=useState(0)
  const {report:briefing,loading:briefLoading}=useCityBrief(compact?null:selected,topic,briefAttempt)
  const active=useRef(null)
  const resultsRef=useRef(null)
  const pickedCity=useRef(false)
  const [locationBusy,setLocationBusy]=useState(false)
  const [locationNote,setLocationNote]=useState('')
  const reveal=()=>revealResult(resultsRef.current)

  useEffect(()=>()=>active.current?.abort(),[])
  useEffect(()=>{
    if(auto&&selected)run(selected,topic)
  },[auto,selected,topic,profile])
  useEffect(()=>{
    if(!auto||compact)return
    let keep=true
    if(!defaultDestination?.id&&profile?.homeCity){
      requestCity(profile.homeCity).then(place=>{if(keep&&!pickedCity.current&&place)setSelected(place)}).catch(()=>{})
    }
    if(navigator.permissions?.query)navigator.permissions.query({name:'geolocation'}).then(permission=>{
      if(keep&&permission.state==='granted'&&!pickedCity.current)locate(false,()=>keep)
    }).catch(()=>{})
    return()=>{keep=false}
  },[])

  async function requestCity(name){
    const matches=await request('locations?'+new URLSearchParams({q:name.slice(0,100)}))
    return matches[0]?{...matches[0],id:'geo:'+matches[0].id}:null
  }
  function locate(explicit=true,current=()=>true){
    if(!navigator.geolocation){if(explicit)setLocationNote('Location isn’t available here. Search for a city instead.');return}
    if(explicit){pickedCity.current=true;setLocationBusy(true);setLocationNote('')}
    navigator.geolocation.getCurrentPosition(async({coords})=>{
      try{
        const city=await request('locations/reverse?'+new URLSearchParams({lat:coords.latitude.toFixed(2),lon:coords.longitude.toFixed(2)}))
        if(current()&&(explicit||!pickedCity.current)){pickedCity.current=true;setSelected({...city,id:'geo:'+city.id});if(explicit)reveal()}
      }catch{if(explicit)setLocationNote('Could not identify your city. Search for it instead.')}
      finally{if(explicit)setLocationBusy(false)}
    },()=>{if(explicit){setLocationBusy(false);setLocationNote('Location access wasn’t available. Search for your city instead.')}},
    {enableHighAccuracy:false,timeout:8000,maximumAge:600000})
  }

  async function run(place,category,refresh=false) {
    active.current?.abort()
    const controller=new AbortController()
    active.current=controller
    setPending(true);setError('');setResult(null)
    if(refresh&&!compact)setBriefAttempt(value=>value+1)
    try {
      const data=await fetchResearch(place,{topic:category,profile,trip,refresh,signal:controller.signal})
      if(controller.signal.aborted)return
      setResult(data)
      onResults?.(data.findings)
    } catch (error) {if(!controller.signal.aborted)setError(error.message)}
    finally {if(!controller.signal.aborted)setPending(false)}
  }

  function changeSelection(place){
    if(place.id===selected?.id)return
    pickedCity.current=true
    active.current?.abort()
    setPending(false)
    setError('')
    setResult(null)
    setSelected(place)
    reveal()
  }

  return <div className={'research-body '+(compact?'research-compact':'')}>
    <form className="panel research-form" onSubmit={event=>{event.preventDefault();if(selected){run(selected,topic,true);reveal()}}}>
      <DestinationSearch catalog={catalog} selected={selected} onSelect={changeSelection} global={!trip}/>
      {!compact&&<Button type="button" icon="compass" onClick={()=>locate()} disabled={locationBusy}>{locationBusy?'Locating…':'Use my location'}</Button>}
      {!compact&&<div className="filters" aria-label="Research topic"><Pill active={topic==='overview'} onClick={()=>{setTopic('overview');reveal()}}>Overview</Pill>{researchTopics.map(([id,icon,label])=><Pill icon={icon} key={id} active={topic===id} onClick={()=>{setTopic(id);reveal()}}>{label}</Pill>)}</div>}
      <Button type="submit" variant={compact?'secondary':'primary'} icon="search" disabled={pending||!selected}>{pending?'Checking…':result?'Refresh sources':'Find live sources'}</Button>
    </form>
    {locationNote&&<p className="form-note" role="status">{locationNote}</p>}
    {!selected&&!locationNote&&<p className="form-note">Use your current location or choose a city to open its travel briefing.</p>}
    <div className="result-scroll-anchor" ref={resultsRef} tabIndex={-1}/>
    {pending&&<AgentProgress label={'Checking sources for '+selected.name} steps={compact?[]:['Travel guides','Local conditions','Source references']}/>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {!compact&&(result||briefing||briefLoading)&&<CityBrief name={selected.name} report={briefing} weather={result?.weather} airQuality={result?.airQuality} loading={briefLoading}>
      {!!result?.findings?.length&&<div className="city-brief-reading"><h3>What the other sources add</h3><ul>{result.findings.slice(0,5).map(item=><li key={item.url}>
        <strong>{item.title}</strong>{item.snippet&&<p>{item.snippet}</p>}<a href={item.url} target="_blank" rel="noreferrer">{item.publisher||item.provider||'Source'} ↗</a>
      </li>)}</ul></div>}
    </CityBrief>}
    {!compact&&<ReferencePhotos location={selected} description="Licensed destination photos for context. The source links above support the briefing."/>}
    {result&&(compact?<Findings result={result} compact/>:<details className="panel research-source-details"><summary>Explore the sources and full findings</summary><Findings result={result}/></details>)}
  </div>
}

export function ResearchPage(props) {
  return <div className="page inner-page"><h1>Research destinations</h1><p className="lede">Get the key points for your city: what to expect, how to get around, and what to check before you go.</p><Research {...props} auto/></div>
}
