import React,{useState} from 'react'
import {Button,Icon,Pill} from '../components/UI.jsx'
import {allowedStop,costs,money,schedule} from '../planner.mjs'

export function Concierge({trip,place,activeDay,onUpdate,onDay}) {
  const [query,setQuery]=useState('')
  const [entries,setEntries]=useState([])
  function run(value) {
    const text=value.trim()
    if(!text)return
    const dayMatch=/\bday\s+(\d+)/i.exec(text)
    const index=dayMatch?Number(dayMatch[1])-1:activeDay
    const day=trip.days[index]
    let next=trip
    let result
    if(!day)result='Choose a day within this trip.'
    else if(/cheaper|budget stay/i.test(text)) {
      const best=place.stays.reduce((lowest,stay,i)=>stay.price<place.stays[lowest].price?i:lowest,0)
      next=trip.sourcedStay || best===trip.stay?trip:{...trip,stay:best}
      result=trip.sourcedStay?'Your sourced stay has no confirmed rate to compare.':best===trip.stay?'You already have the lowest estimated nightly rate.':'Selected '+place.stays[best].name+'.'
    } else if(/relax|slow|start later/i.test(text)) {
      next={...trip,days:trip.days.map((item,i)=>i===index?{...item,relaxed:true,stops:item.stops.slice(0,2)}:item)}
      result='Day '+(index+1)+' now starts at 10:30 with up to two stops.'
      onDay(index)
    } else if(/indoor|rain/i.test(text)) {
      const candidate=place.places.find(item=>/museum|gallery|palace/i.test(item.name)&&!day.stops.includes(item.name)&&allowedStop(item,trip.brief,index))
      if(candidate) {
        const stops=[...day.stops]
        if(stops.length)stops[stops.length-1]=candidate.name
        else stops.push(candidate.name)
        next={...trip,days:trip.days.map((item,i)=>i===index?{...item,stops}:item)}
        result='Day '+(index+1)+' now includes '+candidate.name+'. Check the venue before visiting.'
        onDay(index)
      }else result='I don’t have a different indoor venue in the catalog for this date.'
    } else if(/budget|cost/i.test(text)) result='Estimated total '+money(costs(trip).total)+' for '+trip.brief.people+' travelers.'
    else if(/vegan|jain|halal|vegetarian/i.test(text)) result='Set your dietary preference in the Trip Brief. The plan will exclude food stops without a matching catalog tag.'
    else result='Try a later start, a cheaper stay, a budget summary, or an indoor stop.'
    if(next!==trip){
      const delta=costs(next).total-costs(trip).total
      if(delta)result+=' Estimated cost '+(delta<0?'decreased':'increased')+' by '+money(Math.abs(delta))+'.'
      onUpdate(next)
    }
    setEntries(items=>[...items,{text,result}].slice(-6))
    setQuery('')
  }
  return <div className="concierge">
    <div className="quick-picks">{['Relax Day '+(activeDay+1),'Cheaper stay','Indoor stop'].map(text=><Pill key={text} onClick={()=>run(text)}>{text}</Pill>)}</div>
    {entries.length>0&&<div className="chat-log" aria-live="polite">{entries.map(({text,result},index)=><div className="chat-pair" key={index}><p className="chat-user">{text}</p><p className="chat-reply">{result}</p></div>)}</div>}
    <form className="assistant-form" onSubmit={event=>{event.preventDefault();run(query)}}><input aria-label="Ask the trip concierge" placeholder="Make Day 2 more relaxed…" maxLength={180} value={query} onChange={event=>setQuery(event.target.value)} required/><button className="icon-btn primary" aria-label="Send trip edit"><Icon name="up" size={17}/></button></form>
  </div>
}
