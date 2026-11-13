import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,Empty,Icon,Pill,SourcePill} from '../components/UI.jsx'
import {request} from '../api.mjs'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {PhotoRail,ReferencePhotos} from '../components/PhotoRail.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {revealResult} from '../components/revealResult.mjs'

function NewsHighlights({data}){
  const [failed,setFailed]=useState(()=>new Set())
  if(!data?.highlights?.length)return null
  return <div className="city-brief-reading"><h3>What the latest coverage means for your trip</h3>
    <div className="city-brief-points">{data.highlights.map(group=>{const image=group.stories.flatMap(story=>story.images||[]).find(url=>!failed.has(url));return <article key={group.title}>
      {image&&<img className="news-summary-image" src={image} alt="Publisher photo for this coverage" loading="lazy" referrerPolicy="no-referrer" onError={()=>setFailed(current=>new Set([...current,image]))}/>}
      <h3>{group.title}</h3><p>{group.note}</p><ul>{group.stories.map(story=><li key={story.url}>
        <strong>{story.title}</strong><br/>{story.date&&<time dateTime={story.date}>{new Date(story.date).toLocaleDateString()} · </time>}<a href={story.url} target="_blank" rel="noreferrer">{story.publisher||'Read coverage'} ↗</a>
      </li>)}</ul>
    </article>})}</div>
  </div>
}

function NewsCard({article,images=[]}){
  const [failed,setFailed]=useState(()=>new Set())
  const [position,setPosition]=useState(0)
  const available=images.filter(url=>!failed.has(url))
  const current=available[position%Math.max(1,available.length)]
  return <article className="panel news-card news-photo-card">
    {current&&<div className="news-card-photo">
      <img src={current} alt="Publisher’s article preview" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={()=>setFailed(previous=>new Set([...previous,current]))}/>
      {available.length>1&&<button type="button" aria-label={`Next image for ${article.title}`} onClick={()=>setPosition(value=>value+1)}>{position%available.length+1} / {available.length} <Icon name="arrow" size={14}/></button>}
    </div>}
    <div className="eyebrow"><Icon name="globe" size={15}/> {article.publisher||'TRAVEL COVERAGE'}</div><h3>{article.title}</h3>
    {article.date&&<p className="form-note">{article.dateKind} {new Date(article.date).toLocaleDateString()}</p>}
    <SourcePill url={article.url} label="Read story"/>
  </article>
}

const topics=[['highlights','sparkle','Travel highlights'],['transport','plane','Transport'],['events','calendar','Events'],['conditions','globe','Conditions']]
export function TravelNews({catalog,initialDestination,compact=false}) {
  const [place,setPlace]=useState(()=>typeof initialDestination==='object'&&initialDestination?.id?initialDestination:catalog.find(item=>item.id===initialDestination)||catalog[0])
  const [topic,setTopic]=useState('highlights')
  const [days,setDays]=useState(14)
  const [refresh,setRefresh]=useState(0)
  const [data,setData]=useState(null)
  const [error,setError]=useState('')
  const results=useRef(null)
  const showResults=()=>revealResult(results.current)
  const destination=String(place.id)
  const withImages=data?.articles.filter(article=>article.images?.length)||[]
  useEffect(()=>{
    const controller=new AbortController()
    setData(null);setError('')
    const params=new URLSearchParams({topic,days:String(days)})
    if(destination.startsWith('geo:'))params.set('location_id',destination.slice(4))
    else params.set('destination',destination)
    request('news?'+params.toString(),{signal:controller.signal}).then(setData).catch(error=>{
      if(!controller.signal.aborted)setError(error.message)
    })
    return ()=>controller.abort()
  },[destination,topic,days,refresh])
  return <div className="news-body">
    {!compact&&<section className="trip-heading news-heading" style={{'--place-color':place.color||'#264d60'}}>{place.image&&<img src={'/images/'+place.image+'.jpg'} alt=""/>}<div className="trip-heading-content"><div><div className="hero-kicker"><span/> DESTINATION BRIEFING</div><h1>Travel updates</h1><p>Latest travel coverage for {place.name}.</p></div></div></section>}
    <div className="panel news-controls">
      {catalog.length>1&&<DestinationSearch catalog={catalog} global={!compact} selected={place} onSelect={next=>{setPlace(next);showResults()}}/>}
      <div className="filters" aria-label="News topic">{topics.map(([id,icon,label])=><Pill icon={icon} key={id} active={id===topic} onClick={()=>{setTopic(id);showResults()}}>{label}</Pill>)}</div>
      <label>Coverage<select value={days} onChange={event=>{setDays(Number(event.target.value));showResults()}}>{[7,14,30].map(day=><option value={day} key={day}>Last {day} days</option>)}</select></label>
    </div>
    <div ref={results} className="result-scroll-anchor"/>
    {!compact&&<DestinationBrief location={place} topic={{highlights:'overview',transport:'routes',events:'events',conditions:'overview'}[topic]} compact><NewsHighlights data={data}/></DestinationBrief>}
    {!compact&&<ReferencePhotos key={destination} location={place} grid description="Photos of the destination and surrounding area. Publisher photos appear with their stories."/>}
    {error?<Empty icon="info" title="Travel updates unavailable" description={error} action={<Button onClick={()=>setRefresh(value=>value+1)}>Try again</Button>}/>:!data?<AgentProgress label={'Checking travel coverage for '+place.name} steps={['Travel news','Publishers']}/>:<>
      <p className="research-meta">Coverage via {data.provider} · Retrieved {new Date(data.retrievedAt).toLocaleString()}</p>
      {!!withImages.length&&<PhotoRail title="Stories with photos" count={withImages.length} className="news-photo-rail">{withImages.map(article=><NewsCard article={article} images={article.images} key={article.url}/>)}</PhotoRail>}
      {data.articles.length?<div className="news-grid">{data.articles.filter(article=>!article.images?.length).map(article=><NewsCard article={article} key={article.url}/>)}</div>:<Empty icon="info" title={data.status==='unavailable'?'News sources unavailable':'No recent coverage found'} description={data.status==='unavailable'?'Try again in a moment.':'Choose another topic or a longer time range.'} action={data.status==='unavailable'&&<Button onClick={()=>setRefresh(value=>value+1)}>Try again</Button>}/>}
    </>}
  </div>
}
