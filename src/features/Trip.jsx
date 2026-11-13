import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,Dialog,Icon,IconButton,Pill,SourcePill} from '../components/UI.jsx'
import {freshnessLabel, travelData} from '../api.mjs'
import {allowedStop,schedule,costs,money,time,routesFor} from '../planner.mjs'
import {TripMap} from './TripMap.jsx'
import {Research} from './Research.jsx'
import {Concierge} from './Concierge.jsx'
import {TravelNews} from './News.jsx'
import {TravelDesk} from './TravelDesk.jsx'

const fields=[['destination','origin'],['days','date'],['people'],['budget'],['style','diet','pace']]
const asDate=(date,offset=0)=>{
  if(!date)return 'Flexible dates'
  const value=new Date(date+'T00:00:00Z')
  value.setUTCDate(value.getUTCDate()+offset)
  return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(value)
}
function StopEditor({place,stops,index,onSave,onClose}) {
  const editing=index<stops.length
  const [name,setName]=useState(stops[index]||place.places.find(item=>!stops.includes(item.name))?.name||'')
  const [position,setPosition]=useState(index)
  function submit(event){
    event.preventDefault()
    const next=[...stops]
    if(editing)next.splice(index,1)
    next.splice(position,0,name)
    onSave(next)
  }
  return <Dialog onClose={onClose} label={editing?'Edit stop':'Add a stop'}><div className="dialog-content"><h2>{editing?'Edit stop':'Add a stop'}</h2>
    <form className="stack" onSubmit={submit}><label>Place<select value={name} onChange={event=>setName(event.target.value)}>{place.places.filter(item=>item.name===stops[index]||!stops.includes(item.name)).map(item=><option key={item.name}>{item.name}</option>)}</select></label>
    {editing&&<label>Position<select value={position} onChange={event=>setPosition(Number(event.target.value))}>{stops.map((_,i)=><option value={i} key={i}>Stop {i+1}</option>)}</select></label>}
    <div className="dialog-buttons"><Button variant="primary" type="submit" disabled={!name}>{editing?'Save stop':'Add to day'}</Button>{editing&&<Button icon="trash" onClick={()=>onSave(stops.filter((_,i)=>i!==index))}>Remove</Button>}</div></form>
  </div></Dialog>
}
function Budget({trip,routeByDay}) {
  const {values,total}=costs(trip,routeByDay)
  const percent=Math.round(100*total/trip.brief.budget)
  const delta=trip.brief.budget-total
  const partial=Boolean(trip.sourcedStay || trip.agentRoute?.unpriced)
  return <section className={'panel budget '+(delta<0?'over':percent>=85?'near':'good')}>
    <div className="panel-top"><div><div className="eyebrow"><span/> {partial ? 'PARTIAL ESTIMATE' : 'ESTIMATED TRIP COST'}</div><h2>{money(total)}</h2></div><span className="budget-icon"><Icon name="wallet"/></span></div>
    <div className="budget-status"><span>of {money(trip.brief.budget)} total</span><strong>{percent}%</strong></div><progress max={100} value={Math.min(percent,100)} aria-label="Estimated budget used"/>
    <p className="budget-message">{partial ? 'Unpriced items are excluded.' : `${money(Math.abs(delta))} ${delta<0?'over budget':'remaining'}`}</p>
    <dl>{Object.entries(values).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value == null ? 'Price not confirmed' : money(value)}</dd></div>)}</dl>
    {trip.sourcedStay && <p>Planned stay: <a href={trip.sourcedStay.url} target="_blank" rel="noreferrer">{trip.sourcedStay.name}</a> · {trip.sourcedStay.source}</p>}
    <p className="form-note">Group estimates in INR. Intercity fares are one-way. Check current prices before booking.</p>
  </section>
}
function summary(trip,place,routeByDay) {
  const route=trip.agentRoute || routesFor(trip.brief)[trip.route]
  const path=route.path || trip.brief.origin+' → '+place.name
  const lines=[place.name+' · YatraBuddy',asDate(trip.brief.date)+' · '+trip.brief.people+' travelers',path+' · '+route.name+(route.unpriced ? ' · Price not confirmed' : ' · SIMULATED'),
    'Stay: '+(trip.sourcedStay ? trip.sourcedStay.name+' (price not confirmed): '+trip.sourcedStay.url : place.stays[trip.stay].name),
    (trip.sourcedStay || route.unpriced ? 'Partial estimate: ' : 'Estimated total: ')+money(costs(trip,routeByDay).total)]
  trip.days.forEach((_,index)=>{
    lines.push('', 'Day '+(index+1))
    for(const item of schedule(trip,index,routeByDay[index]))lines.push(time(item.starts)+' · '+item.name)
  })
  if(trip.findings?.length)lines.push('','Sources',...trip.findings.map(item=>item.title+' · '+item.url))
  return lines.join('\n')
}
export function Trip({trip,place,profile,onUpdate,onEdit,onMessage,history,onUndo,onRedo,view="itinerary"}) {
  const [selectedDay,setDay]=useState(0)
  const [activeStop,setActiveStop]=useState(-1)
  const [layer,setLayer]=useState('Overview')
  const [mapOpen,setMapOpen]=useState(true)
  const [dialog,setDialog]=useState(null)
  const [routes,setRoutes]=useState({})
  const [routing,setRouting]=useState(false)
  const [drag,setDrag]=useState(null)
  const routeRequest=useRef(null)
  useEffect(()=>()=>routeRequest.current?.abort(),[])
  const brief=trip.brief
  const day=Math.min(selectedDay,trip.days.length-1)
  const routeKey=index=>JSON.stringify([place.id,trip.days[index].stops])
  const currentRoute=routes[routeKey(day)]
  const routeByDay=Object.fromEntries(trip.days.map((_,index)=>[index,routes[routeKey(index)]?.legMinutes]))
  const stops=schedule(trip,day,routeByDay[day])
  const eligible=place.places.filter(item=>allowedStop(item,brief,day))
  const info=[['pin','Route',brief.origin===place.name?place.name:brief.origin+' → '+place.name],['calendar','When',asDate(brief.date)+' · '+brief.days+' days'],['users','Travelers',brief.people+(brief.people===1?' person':' people')],['wallet','Budget',money(brief.budget)],['sparkle','Style',brief.style+' · '+(brief.diet||'No restrictions')]]
  const slot=item=>item.starts<720?'Morning':item.starts<1020?'Afternoon':'Evening'
  function changeDay(stops,relaxed=trip.days[day].relaxed) {
    setActiveStop(-1)
    onUpdate({...trip,days:trip.days.map((item,index)=>index===day?{relaxed,stops}:item)})
  }
  async function checkRoute() {
    const controller=new AbortController()
    routeRequest.current=controller
    const key=routeKey(day)
    setRouting(true)
    try {
      const result=await travelData('road-route',{method:'POST',body:{destination:place.id,stops:trip.days[day].stops},signal:controller.signal})
      setRoutes(values=>({...values,[key]:result}))
      onMessage('Updated driving times for Day '+(day+1)+'.')
    }catch(error){if(!controller.signal.aborted)onMessage(error.message)}
    finally{if(!controller.signal.aborted)setRouting(false)}
  }
  const text=summary(trip,place,routeByDay)
  const lowestStay=place.stays.reduce((lowest,stay,index)=>stay.price<place.stays[lowest].price?index:lowest,0)
  function reorder(index){
    if(drag===null||drag===index)return
    const next=[...trip.days[day].stops]
    const [moved]=next.splice(drag,1)
    next.splice(index,0,moved)
    setDrag(null)
    changeDay(next)
  }
  if(view==='budget')return <div className="page inner-page trip-budget-page">
    <div className="section-heading"><div><div className="eyebrow">YOUR SAVED TRIP</div><h1>{place.name} budget</h1><p className="lede">{brief.people} travellers · {brief.days} days · {asDate(brief.date)}</p></div><Button icon="edit" onClick={()=>onEdit(3)}>Change budget</Button></div>
    <div className="trip-budget-grid"><Budget trip={trip} routeByDay={routeByDay}/><section className="panel stack"><h2>What this includes</h2><p>SIMULATED estimates for your selected transport, stay, food and activities. These are planning costs, not charges or live quotes.</p><p>Changes to your itinerary update this budget. Unpriced sourced stays are excluded from the total.</p><h3>Per traveller</h3><strong>{money(Math.round(costs(trip,routeByDay).total/brief.people))} estimated</strong><p>{money(brief.budget/brief.people)} budget per person</p><Button icon="plane" onClick={()=>setDialog('desk')}>Check current provider prices</Button></section></div>
    {dialog==='desk'&&<Dialog className="research-dialog" label="Travel providers" onClose={()=>setDialog(null)}><div className="dialog-content"><h2>Travel providers</h2><TravelDesk catalog={[place]} profile={profile} trip={trip} compact/></div></Dialog>}
  </div>
  return <div className="page workspace">
    <section className="trip-heading" style={{'--place-color':place.color}}><img src={'/images/'+place.image+'.jpg'} alt=""/><div className="trip-heading-content"><div><div className="hero-kicker"><span/> YOUR ITINERARY</div><h1>{place.name}</h1><p>{place.region} · {brief.days} days · {brief.people} travelers</p></div><div className="trip-heading-actions"><Button variant="glass" icon="map" aria-pressed={mapOpen} onClick={()=>setMapOpen(value=>!value)}>{mapOpen?'Hide map':'Show map'}</Button><Button variant="glass" icon="back" disabled={!history.past.length} onClick={onUndo}>Undo</Button><Button variant="glass" icon="chevron" disabled={!history.future.length} onClick={onRedo}>Redo</Button><Button variant="glass" icon="link" onClick={()=>setDialog('share')}>Share</Button><Button variant="glass" icon="download" onClick={()=>window.print()}>Print / PDF</Button></div></div></section>
    <div className="brief-strip" aria-label="Editable trip brief">{info.map(([icon,label,value],index)=><button className="brief-chip" key={label} onClick={()=>onEdit(index)}><Icon name={icon}/><span><small>{label} {fields[index].some(key=>brief.assumed.includes(key))&&<i>Assumed</i>}</small><strong>{value}</strong></span><Icon name="edit" size={13}/></button>)}</div>
    <div className={'work-grid legacy-trip-grid'+(!mapOpen?' map-hidden':'')}>
      <div className="legacy-trip-main">
      <section className="panel itinerary"><div className="panel-top"><div><div className="eyebrow"><span/> THE PLAN</div><h2>Day by day</h2></div><IconButton icon="plus" label="Add a stop" disabled={stops.length>=12} onClick={()=>setDialog(stops.length)}/></div>
      <div className="day-tabs">{trip.days.map((_,index)=><Pill key={index} active={index===day} onClick={()=>{setDay(index);setActiveStop(-1);setLayer('Itinerary')}}>Day {index+1}</Pill>)}</div>
      <div className="day-heading"><strong>{asDate(brief.date,day)}</strong><span>{stops.length} stops</span></div>
      {currentRoute && <p className="form-note">{freshnessLabel(currentRoute)} · OSRM driving estimate</p>}
      <div className="timeline">{stops.length?stops.map((item,index)=><article className={'stop '+(activeStop===index?'focused':'')} key={item.name} draggable onDragStart={event=>{event.dataTransfer.setData('text/plain',String(index));setDrag(index)}} onDragEnd={()=>setDrag(null)} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();reorder(index)}}>
        {(index===0||slot(stops[index-1])!==slot(item))&&<h3 className="day-slot">{slot(item)}</h3>}
        {item.eta>0&&<div className="transfer"><Icon name="clock" size={13}/> ~{item.eta} min transfer</div>}
        <div className="stop-card"><button className="stop-info" onClick={()=>{setMapOpen(true);setLayer('Itinerary');setActiveStop(index)}}><span className="stop-number">{index+1}</span><span><small>{time(item.starts)} · {item.theme}</small><strong>{item.name}</strong><span>{item.area} · {item.minutes} min</span><span>{item.price?money(item.price)+' est. / person':'Free estimate'}</span></span></button><IconButton icon="edit" label={'Edit '+item.name} onClick={()=>setDialog(index)}/><IconButton icon="minus" label={'Remove '+item.name} onClick={()=>changeDay(trip.days[day].stops.filter(name=>name!==item.name))}/></div>
        {item.hoursConflict&&<p className="warning">This visit may overlap listed hours.</p>}
        {item.hoursSource&&<div className="venue-source"><SourcePill url={item.hoursSource} label="Official visiting hours"/></div>}
      </article>):<p className="form-note">Add a stop or leave time open.</p>}</div>
      <Button className="full" icon="plus" disabled={stops.length>=12} onClick={()=>setDialog(stops.length)}>Add a stop</Button></section>
      <Budget trip={trip} routeByDay={routeByDay}/>
        <section className="panel assistant"><div className="panel-top"><div><div className="eyebrow"><span/> TRIP TOOLS</div><h2>Fine-tune</h2></div><Icon name="sparkle"/></div>
          <div className="assistant-actions"><Button icon="clock" className="full" onClick={()=>changeDay(trip.days[day].stops,!trip.days[day].relaxed)}>{trip.days[day].relaxed?'Start at 09:30':'Start at 10:30'}</Button><Button icon="search" className="full" onClick={()=>setDialog('research')}>Research this trip</Button><Button icon="globe" className="full" onClick={()=>setDialog('news')}>Destination updates</Button><Button icon="plane" className="full" onClick={()=>setDialog('desk')}>Travel providers</Button></div>
          {!trip.sourcedStay && lowestStay!==trip.stay&&<Button className="full" icon="wallet" onClick={()=>{onUpdate({...trip,stay:lowestStay});setMapOpen(true);setLayer('Stays');onMessage('Switched to the lowest estimated nightly rate.')}}>Switch to lower-cost stay</Button>}
          <Concierge trip={trip} place={place} activeDay={day} onUpdate={onUpdate} onDay={index=>{setDay(index);setActiveStop(-1);setLayer('Itinerary')}}/>
          {stops.length>1&&<div className="road-check">
            <Button icon="map" className="full" disabled={routing} onClick={checkRoute}>{routing?'Checking roads…':currentRoute?'Refresh driving times':'Check driving times'}</Button>
            {routing&&<AgentProgress label="Checking driving routes"/>}
            {currentRoute&&<div className="trip-sources"><p>{currentRoute.kilometres} km · {currentRoute.legMinutes.reduce((sum,value)=>sum+value,0)} min total</p><p className="form-note">{currentRoute.model}</p><SourcePill url={currentRoute.url} label="OSRM"/></div>}
          </div>}
          {trip.findings?.length>0&&<div className="trip-sources"><h3>Saved sources</h3>{trip.findings.slice(0,6).map(item=><SourcePill key={item.url} url={item.url} label={item.title}/>)}</div>}
        </section>
      </div>
      {mapOpen&&<TripMap trip={trip} place={place} eligible={eligible} stops={stops} activeStop={activeStop}
        setActiveStop={setActiveStop} layer={layer} setLayer={setLayer} onUpdate={onUpdate} day={day}
        routeForDay={index=>routes[routeKey(index)]} onClose={()=>setMapOpen(false)}
        onToggleFood={name=>changeDay(trip.days[day].stops.includes(name)?trip.days[day].stops.filter(stop=>stop!==name):[...trip.days[day].stops,name])}
        onOverviewStop={(index,stop)=>{setDay(index);setActiveStop(stop);setLayer('Itinerary')}}/>}
    </div>
    {typeof dialog==='number'&&<StopEditor place={{...place,places:eligible}} stops={trip.days[day].stops} index={dialog} onClose={()=>setDialog(null)} onSave={stops=>{changeDay(stops);setDialog(null)}}/>}
    {dialog==='share'&&<Dialog onClose={()=>setDialog(null)} label="Share summary"><div className="dialog-content"><h2>Share trip summary</h2><textarea aria-label="Trip summary" rows={10} readOnly value={text}/><Button icon="link" onClick={async()=>{try{await navigator.clipboard.writeText(text);onMessage('Summary copied.')}catch{onMessage('Select the summary and copy it manually.')}}}>Copy summary</Button></div></Dialog>}
    {dialog==='news'&&<Dialog className="research-dialog" label="Destination updates" onClose={()=>setDialog(null)}><div className="dialog-content"><h2>{place.name} updates</h2><TravelNews catalog={[place]} compact/></div></Dialog>}
    {dialog==='desk'&&<Dialog className="research-dialog" label="Travel providers" onClose={()=>setDialog(null)}><div className="dialog-content"><h2>Travel providers</h2><TravelDesk catalog={[place]} profile={profile} trip={trip} compact/></div></Dialog>}
    {dialog==='research'&&<Dialog className="research-dialog" label="Research this trip" onClose={()=>setDialog(null)}><div className="dialog-content"><h2>Research this trip</h2><Research catalog={[place]} defaultDestination={place.id} trip={trip} profile={{...profile,diet:brief.diet,style:brief.style,interests:profile?.interests||[]}} onResults={findings=>{
      if(!findings.length)return
      onUpdate({...trip,findings:[...new Map([...findings,...(trip.findings||[])].map(item=>[item.url,item])).values()].slice(0,12)})
    }}/></div></Dialog>}
    <section id="print-sheet"><pre>{text}</pre></section>
  </div>
}
