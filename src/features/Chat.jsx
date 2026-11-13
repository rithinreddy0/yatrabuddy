import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,SourcePill} from '../components/UI.jsx'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {matchDestination} from '../planner.mjs'
import {CheckedAt,Findings} from './Research.jsx'
import {askTravel} from '../conversation.mjs'

export function namedCity(query) {
  const match=query.match(/\b(?:in|near|around|to|visit)\s+([\p{L}][\p{L}\p{M} .,'’-]{1,65}?)(?=\s+(?:this|next|today|tomorrow|for|during|with|on|under)\b|[?!]|$)/iu)
  if(match&&!/^(?:do|see|go|eat|find|stay|travel|book|visit|explore|try|the|a|bring|get|take)\b/i.test(match[1]))return match[1].trim().replace(/[.]+$/,'')
  return ''
}

export function Answer({reply}){
  return <div className="travel-answer">
    <p className="travel-answer-text">{reply.answer}</p>
    {!!reply.citations?.length&&<div className="answer-citations" aria-label="Sources">{reply.citations.map(citation=><SourcePill key={citation.id} url={citation.url} label={'['+citation.id+'] '+citation.title}/>)}</div>}
    {reply.report&&<><p className="research-meta"><CheckedAt value={reply.report.retrievedAt}/></p><Findings result={reply.report} compact/></>}
  </div>
}

export function Chat({catalog,initialQuery='',onPlan,profile,defaultDestination}){
  const [query,setQuery]=useState(initialQuery)
  const [place,setPlace]=useState(()=>matchDestination(initialQuery)||catalog.find(item=>item.id===defaultDestination)||catalog[0])
  const [entries,setEntries]=useState([])
  const [pending,setPending]=useState(false)
  const active=useRef(null)
  const history=useRef([])

  async function ask(value,explicitPlace){
    value=value.trim()
    if(!value)return
    active.current?.abort()
    const controller=new AbortController()
    active.current=controller
    setPending(true);setQuery('')
    const id=crypto.randomUUID()
    const known=matchDestination(value)
    const destination=explicitPlace||known||place
    const placeQuery=!explicitPlace&&!known?namedCity(value):''
    setEntries(items=>[...items,{id,prompt:value,place:destination.name}])
    const update=patch=>setEntries(items=>items.map(item=>item.id===id?{...item,...patch}:item))
    try{
      const reply=await askTravel(value,{destination,placeQuery,history:history.current,profile,signal:controller.signal})
      if(controller.signal.aborted)return
      if(reply.destination)setPlace(reply.destination)
      if(reply.mode!=='clarify')history.current=[...history.current,{role:'user',content:value},{role:'assistant',content:reply.answer}].slice(-8)
      update({reply})
    }catch(error){
      if(!controller.signal.aborted)update({error:error.message})
    }finally{
      if(!controller.signal.aborted)setPending(false)
    }
  }

  useEffect(()=>{
    if(initialQuery.trim())ask(initialQuery)
    return ()=>active.current?.abort()
  },[initialQuery])

  return <div className="page inner-page chat-page"><h1>AI Assistant</h1>
    <p className="lede">Ask about a city, compare places to stay, or work through a trip idea.</p>
    <form className="panel chat-composer stack" onSubmit={event=>{event.preventDefault();ask(query)}}>
      <DestinationSearch catalog={catalog} selected={place} onSelect={setPlace} global/>
      <label>Your question<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={260} placeholder="Where should I stay in Kyoto for a quiet trip?" required/></label>
      <Button type="submit" variant="primary" icon="up" disabled={pending}>{pending?'Checking sources…':'Ask YatraBuddy'}</Button>
    </form>
    <div className="conversation" aria-live="polite">{[...entries].reverse().map(item=><section className="conversation-turn" key={item.id}>
      <p className="conversation-prompt">{item.prompt}</p>
      {item.reply?<><Answer reply={item.reply}/>
        {!!item.reply.choices?.length&&<div className="city-results">{item.reply.choices.map(choice=><button key={choice.id} className="layer-option" disabled={pending} onClick={()=>ask(item.prompt,choice)}><span><strong>{choice.name}</strong><small>{[...new Set([choice.region,choice.country].filter(Boolean))].join(', ')}</small></span></button>)}</div>}
        {item.reply.destination&&<div><Button icon="trip" onClick={()=>onPlan(item.prompt,item.reply.destination.id,item.reply.destination)}>Browse trip options</Button></div>}</>:
        item.error?<p className="form-error">{item.error}</p>:<AgentProgress label={'Checking sources for '+item.place}/>}
    </section>)}</div>
  </div>
}
