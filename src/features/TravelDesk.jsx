import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,Icon,Pill,SourcePill} from '../components/UI.jsx'
import {request} from '../api.mjs'
import {money} from '../planner.mjs'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {DestinationBrief} from '../components/CityBrief.jsx'
import {revealResult} from '../components/revealResult.mjs'

const festivals={
  hyderabad:['Bonalu and Telangana festivals','Check this year’s program before choosing dates.','https://tourism.telangana.gov.in/'],
  kerala:['Onam','For Kerala’s harvest celebrations, use the tourism department’s festival calendar.','https://www.keralatourism.org/onam/english/'],
  goa:['Goa festivals','Check event dates and locations with Goa Tourism.','https://goa-tourism.com/'],
  singapore:['What’s on in Singapore','Check the tourism board for current events and festival dates.','https://www.visitsingapore.com/whats-happening/'],
  kutch:['Rann Utsav','Winter cultural events around Dhordo. Confirm this season’s dates with Gujarat Tourism.','https://gujarattourism.com/fair-and-festival/rann-utsav.html'],
}
function ProviderCard({name,description,url,icon}) {
  return <article className="panel provider-card"><span className="budget-icon"><Icon name={icon}/></span><div><h3>{name}</h3><p>{description}</p></div><SourcePill url={url} label={'Open '+name}/></article>
}
function addDays(value,days) {
  if(!value)return ''
  const date=new Date(value+'T00:00:00Z')
  date.setUTCDate(date.getUTCDate()+days)
  return date.toISOString().slice(0,10)
}
export function HotelSearch({place,trip,profile}) {
  const [enabled,setEnabled]=useState(false)
  const [arrival,setArrival]=useState(trip?.brief.date||'')
  const [departure,setDeparture]=useState(addDays(arrival,Math.max(1,(trip?.brief.days||profile?.tripDays||3)-1)))
  const [people,setPeople]=useState(trip?.brief.people||profile?.travelers||2)
  const [results,setResults]=useState(null)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  useEffect(()=>{request('partners').then(result=>setEnabled(result.bookingSearch)).catch(()=>{})},[])
  const query=new URLSearchParams({ss:place.name,group_adults:String(people),no_rooms:String(Math.ceil(people/2))})
  if(arrival&&departure&&departure>arrival){query.set('checkin',arrival);query.set('checkout',departure)}
  async function search(event){
    event.preventDefault()
    setError('');setResults(null);setPending(true)
    try{const data=await request('stays/search',{method:'POST',body:{destination:place.id,checkin:arrival,checkout:departure,adults:people}});setResults(data.stays)}
    catch(error){setError(error.message)}
    finally{setPending(false)}
  }
  return <section className="panel desk-section"><h2>Find a stay in {place.name}</h2><form className="stack" onSubmit={search}><div className="profile-fields">
    <label>Check-in<input type="date" value={arrival} onChange={event=>setArrival(event.target.value)} required={enabled}/></label>
    <label>Check-out<input type="date" value={departure} onChange={event=>setDeparture(event.target.value)} required={enabled}/></label>
    <label>Adults<input type="number" min={1} max={8} value={people} onChange={event=>setPeople(Number(event.target.value))} required/></label>
    </div><div className="dialog-buttons">{enabled&&<Button type="submit" variant="primary" disabled={pending} icon="search">Search live stays</Button>}<SourcePill url={'https://www.booking.com/searchresults.html?'+query.toString()} label="Search on Booking.com"/></div></form>
    {pending&&<AgentProgress label="Checking room availability"/>}{error&&<p className="form-error">{error}</p>}
    {results&&<div className="news-grid">{results.length?results.map(stay=><ProviderCard key={stay.id} name={stay.name} icon="bed" description={stay.amount===null?'View current availability and price.':money(stay.amount)+' for the selected stay. Check fees and availability with Booking.com.'} url={stay.url}/>):<p>No available stays were returned for these dates.</p>}</div>}
  </section>
}
function FuelCalculator({profile}) {
  const [vehicle,setVehicle]=useState(profile?.transport==='Bike'?'Bike':'Car')
  const [distance,setDistance]=useState('')
  const [efficiency,setEfficiency]=useState('')
  const [price,setPrice]=useState('')
  const [rental,setRental]=useState('')
  const litres=Number(distance)>0&&Number(efficiency)>0?Number(distance)/Number(efficiency):0
  return <section className="panel desk-section"><h2>Fuel and rental estimate</h2><p className="form-note">Enter local fuel price, your vehicle’s efficiency and a rental quote if applicable.</p>
    <div className="filters">{['Car','Bike'].map(value=><Pill active={value===vehicle} key={value} onClick={()=>{setVehicle(value);setEfficiency('')}}>{value}</Pill>)}</div>
    <div className="stack profile-fields">
      <label>Total distance (km)<input type="number" min={0} value={distance} onChange={event=>setDistance(event.target.value)}/></label>
      <label>{vehicle} efficiency (km/L)<input type="number" min={0.1} step={0.1} value={efficiency} onChange={event=>setEfficiency(event.target.value)}/></label>
      <label>Fuel price (₹/L)<input type="number" min={0} step={0.01} value={price} onChange={event=>setPrice(event.target.value)}/></label>
      <label>Rental quote (₹)<input type="number" min={0} value={rental} onChange={event=>setRental(event.target.value)}/></label>
    </div>
    {litres>0&&Number(price)>0&&<div className="fuel-result"><strong>{money(litres*Number(price)+Math.max(0,Number(rental)))}</strong><span>{litres.toFixed(1)} L estimated · tolls, parking and fees separate</span></div>}
  </section>
}
function Mobility({place,origin,profile}) {
  const map=new URL('https://www.google.com/maps/dir/')
  const mode=profile?.transport==='Walking'?'walking':profile?.transport==='Bike'?'bicycling':profile?.transport==='Car'?'driving':'transit'
  map.search=new URLSearchParams({api:'1',origin:origin||'',destination:place.name+', '+place.region,travelmode:mode}).toString()
  const pin=place.places[0]
  const uber=new URL('https://m.uber.com/ul/')
  uber.search=new URLSearchParams({action:'setPickup',pickup:'my_location','dropoff[latitude]':pin.lat,'dropoff[longitude]':pin.lon,'dropoff[nickname]':pin.name}).toString()
  const providers=[
    ['Google Maps','Directions using your preferred transport mode.',map.href,'map'],
    ['Uber','Open the ride app with the destination populated.',uber.href,'pin'],
  ]
  if(place.id!=='singapore')providers.push(
    ['IRCTC','Check train timetables, fares and availability.','https://www.irctc.co.in/nget/train-search','trip'],
    ['redBus','Compare available bus services.','https://www.redbus.in/','trip'],
    ['Rapido','Check local bike taxi, auto and cab availability.','https://rapido.bike/Home','pin'],
    ['Ola','Check availability and fares for local rides.','https://www.olacabs.com/','pin'],
    ['Zoomcar','Browse self-drive car rentals.','https://www.zoomcar.com/','wallet'],
    ['Bike rentals','Find rental shops around the destination.','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent('bike rental near '+place.name),'pin'])
  return <div className="news-grid">{providers.map(([name,description,url,icon])=><ProviderCard key={name} {...{name,description,url,icon}}/>)}</div>
}
function VisitGuide({place}) {
  const [name,description,url]=festivals[place.id]
  return <div className="news-grid">
    <ProviderCard name={name} description={description} url={url} icon="calendar"/>
    <ProviderCard name={place.id==='singapore'?'Singapore entry information':'Driving and licensing'} description={place.id==='singapore'?'Check the official entry and arrival guidance for your circumstances.':'Check current licensing and vehicle requirements with the transport authority.'} url={place.id==='singapore'?'https://www.ica.gov.sg/about-ica/news-and-publications/public-advisories/visiting-singapore':'https://parivahan.gov.in/'} icon="info"/>
    <article className="panel provider-card"><span className="budget-icon"><Icon name="globe"/></span><div><h3>Typical visiting season</h3><p>{place.season}. Check current local conditions and event dates before committing to travel.</p></div></article>
  </div>
}
export function TravelDesk({catalog,profile,trip,initialDestination,initialTab='mobility',compact=false}) {
  const [id,setId]=useState(trip?.brief.destination||initialDestination||catalog[0].id)
  const [tab,setTab]=useState(initialTab)
  const place=catalog.find(item=>item.id===id)||catalog[0]
  const origin=trip?.brief.origin||profile?.homeCity
  const result=useRef(null)
  return <div className="desk">
    {!compact&&<><div className="eyebrow"><span/> THE PRACTICAL DETAILS</div><h1>Travel desk</h1><p className="lede">Check rides, compare stays, plan fuel costs and find official travel guidance.</p></>}
    <div className="panel news-controls">
      {catalog.length>1&&<DestinationSearch catalog={catalog} selected={place} onSelect={next=>{setId(next.id);revealResult(result.current)}}/>}
      <div className="filters">{[['mobility','map','Getting around'],['stays','bed','Stays'],['fuel','wallet','Fuel and rentals'],['guide','calendar','When to go']].map(([value,icon,label])=><Pill active={tab===value} key={value} icon={icon} onClick={()=>{setTab(value);revealResult(result.current)}}>{label}</Pill>)}</div>
    </div>
    {!compact&&<DestinationBrief location={place} topic={tab==='stays'?'stays':tab==='guide'?'events':'routes'} compact/>}
    <div ref={result} className="result-scroll-anchor"/>
    {tab==='mobility'&&<Mobility place={place} origin={origin} profile={profile}/>}
    {tab==='stays'&&<HotelSearch place={place} key={id} trip={trip} profile={profile}/>}
    {tab==='fuel'&&<FuelCalculator profile={profile}/>}
    {tab==='guide'&&<VisitGuide place={place}/>}
  </div>
}
