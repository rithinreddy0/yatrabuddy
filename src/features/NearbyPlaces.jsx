import React, {useState} from 'react'
import {request} from '../api.mjs'
import {Button, Dialog, Pill, SourcePill} from '../components/UI.jsx'
import {VoicePlanner,optionNumber,voiceText} from './VoicePlanner.jsx'
import {speak,spokenNumber} from './reminders.mjs'
import {money, time} from '../planner.mjs'
import './NearbyPlaces.css'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {LocalTransport} from './LocalTransport.jsx'
import {GroqResearch} from './GroqResearch.jsx'
import {draftMapData, JourneyMap, mapPlaceId} from './JourneyMap.jsx'
import {draftSchedule} from './draftSchedule.mjs'
import {DiscoveryCard, DiscoveryLoading, useNearbyDiscovery} from './DiscoveryFeed.jsx'
import {PlaceDetails} from './PlaceDetails.jsx'
import {discoveryPlaceKey,rankDiscoveryPlaces,toggleDiscoverySaved,useDiscoveryShortlist,useSavedDiscoveryPlaces} from './discoveryPlaces.mjs'

const interestCategories = {
  Adventure: ['Activity', 'Nature'], Culture: ['Sight'], Food: ['Food'],
  Nature: ['Nature', 'Activity'], Shopping: ['Shopping'],
}

function PlaceLinks({place}) {
  const mapUrl = `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=17/${place.lat}/${place.lon}`
  const reviewsUrl = 'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(place.name+' '+place.lat+','+place.lon)
  return <div className="nearby-links">
    <SourcePill label={place.source} url={place.url}/>
    <SourcePill label="Map" url={mapUrl}/>
    <SourcePill label="Photos, prices and reviews" url={reviewsUrl}/>
  </div>
}

export function NearbyDraft({draft}){
  const [showMap, setShowMap] = useState(false)
  const [focusedPlace, setFocusedPlace] = useState(null)
  const mapData = React.useMemo(() => draftMapData(draft), [draft])
  const costs = Object.values(draft.stopCosts || {})
  const subtotal = costs.reduce((total,cost)=>total+cost,0)
  return <section className="nearby-draft" aria-label="Draft itinerary" aria-live="polite">
    <h3>Draft days in {draft.name}</h3>
    <div className="nearby-draft-facts">{draft.departure&&<span>Departure {draft.departure}</span>}<span>{draft.travelers} {draft.travelers===1?'traveler':'travelers'}</span>{draft.budget&&<span>{money(draft.budget)} group budget</span>}</div>
    <p className="form-note">{draft.stay&&('Starting point: '+draft.stay.name+'. ')}Nearby stops are grouped together. Visit times are suggestions. Confirm opening hours and prices with each venue.</p>
    {draft.mealPreference && <p>Food preference: {draft.mealPreference}. Check menus directly with each venue.</p>}
    {!!draft.localModes?.length && <p>Transport preferences: {draft.localModes.join(', ')}</p>}
    {costs.length > 0 && <p>Entered stop costs: {money(subtotal)} for the group. {draft.days.flat().length - costs.length} stops still need prices. Stay and transfers are separate.{draft.budget && subtotal > draft.budget ? ' Entered costs exceed your budget.' : ''}</p>}
    {draft.routeAdvice && <div className="panel nearby-preferences"><h4>AI route advice</h4><p>{draft.routeAdvice}</p></div>}
    {draft.stay&&<PlaceLinks place={draft.stay}/>}
    {showMap ? <div className="nearby-draft-map">
      <JourneyMap {...mapData} selectedId={focusedPlace && mapPlaceId(focusedPlace)}
        onSelect={setFocusedPlace} onClose={() => setShowMap(false)}/>
      {focusedPlace && <div className="nearby-draft-map-place">
        <strong>{focusedPlace.name}</strong>
        <PlaceLinks place={focusedPlace}/>
      </div>}
    </div> : <Button icon="map" onClick={() => setShowMap(true)}>Show itinerary map</Button>}
    <div className="nearby-days">
      {draft.days.map((stops,index)=><article className="panel nearby-card" key={index}>
        <h4>Day {index+1}</h4>
        {stops.length?<ol>{draftSchedule(draft,index).map(({place, leg, from, duration: minutes, start, end})=>{
          const directions = from && 'https://www.google.com/maps/dir/?api=1&origin='+from.lat+','+from.lon+'&destination='+place.lat+','+place.lon
          const modeLinks = (draft.localModes || []).filter(mode=>['Walk','Bus','Metro','Cab','Auto'].includes(mode))
          const travelMode = {Walk:'walking',Bus:'transit',Metro:'transit',Cab:'driving',Auto:'driving'}
          return <li key={place.url}>
            {leg && <p className="form-note">{from.name} to {place.name} · {leg.kilometres} km · about {leg.minutes} min ({leg.method === 'road' ? 'driving estimate' : 'straight-line estimate'})</p>}
            <strong>{time(start)}–{time(end)} · {place.name}</strong>
            {showMap && <Button variant="text-btn" icon="pin" onClick={() => setFocusedPlace(place)}>Focus on map</Button>}
            {place.photo && <PlacePhoto place={place} hideUnavailable/>}
            <p>{place.category} · {minutes} min suggested · {draft.stopCosts?.[place.url] == null ? 'Cost to confirm' : money(draft.stopCosts[place.url])+' entered group cost'}</p>
            <PlaceLinks place={place}/>
            {directions && <div className="nearby-links">
              <SourcePill label="Compare route modes" url={directions}/>
              {modeLinks.map(mode=><SourcePill key={mode} label={mode==='Cab'||mode==='Auto'?mode+' road route':mode+' directions'} url={directions+'&travelmode='+travelMode[mode]}/>)}
            </div>}
          </li>
        })}</ol>:
          <p className="form-note">No stops selected for this day.</p>}
      </article>)}
    </div>
    <LocalTransport location={draft} modes={draft.localModes} stops={draft.days.flat().map(place=>place.name)}/>
  </section>
}

export function NearbyPlaces({location, preferredTheme, profile, tripRequest, editingDraft, voice=false,onSaveDraft}) {
  const [attempt, setAttempt] = useState(0)
  const [category, setCategory] = useState('All places')
  const [photosOnly, setPhotosOnly] = useState(false)
  const [sort, setSort] = useState('For you')
  const [viewPlace, setViewPlace] = useState('')
  const [brokenPhotos,setBrokenPhotos] = useState(() => new Set())
  const suggestedDraft=tripRequest?.initialDraft
  const saved=useSavedDiscoveryPlaces()
  const homeShortlist=useDiscoveryShortlist(location.id)
  const shortlist=tripRequest?.selected || homeShortlist
  const initialDays=editingDraft?.days.length||tripRequest?.days||suggestedDraft?.days.length||profile?.tripDays||1
  const initialPace=editingDraft?.pace||tripRequest?.pace||profile?.pace||'Balanced'
  const initialCapacity={Relaxed:3,Balanced:4,Packed:5}[initialPace] || 4
  const initialStops=[...new Map([...shortlist.filter(place=>place.category!=='Stay'),...(suggestedDraft?.days.flat()||[])].map(place=>[place.url,place])).values()]
  const [selected, setSelected] = useState(()=>editingDraft?.days.flat()||initialStops)
  const [stopCosts,setStopCosts]=useState(editingDraft?.stopCosts||{})
  const [stay, setStay] = useState(editingDraft?.stay||shortlist.find(place=>place.category==='Stay')||suggestedDraft?.stay||null)
  const [days, setDays] = useState(editingDraft?.days.length || Math.min(5, Math.max(initialDays, Math.ceil(initialStops.length / initialCapacity))))
  const [departure,setDeparture]=useState(editingDraft?.departure||tripRequest?.date||'')
  const [travelers,setTravelers]=useState(editingDraft?.travelers||tripRequest?.people||profile?.travelers||1)
  const [budget,setBudget]=useState(editingDraft?.budget||tripRequest?.budget||profile?.budget||'')
  const diet = editingDraft?.mealPreference || tripRequest?.diet || profile?.diet
  const [mealPreference,setMealPreference]=useState(diet==='No restrictions'?'No preference':diet||'No preference')
  const [mealSearch,setMealSearch]=useState('No preference')
  const [pace,setPace]=useState(initialPace)
  const [localModes,setLocalModes]=useState(()=>editingDraft?.localModes||({'Public transit':['Bus','Metro'],Car:['Cab'],Walking:['Walk']})[profile?.transport]||[])
  const [draft, setDraft] = useState(null)
  const [draftError,setDraftError]=useState('')
  const [building,setBuilding]=useState(false)
  const id = location.id
  const {report:data,error,photosPending} = useNearbyDiscovery(id,attempt,mealSearch)
  const capacity = {Relaxed:3,Balanced:4,Packed:5}[pace] || 4
  const tooManyStops = selected.length > days * capacity

  function retry() {
    setAttempt(value => value + 1)
  }

  function select(place) {
    if(building)return
    setDraft(null)
    if (place.category === 'Stay') {
      setStay(current => current?.url === place.url ? null : place)
      return
    }
    setSelected(current => current.some(item => item.url === place.url)
      ? current.filter(item => item.url !== place.url) : [...current, place])
  }

  async function build(spoken=false){
    if(building)return
    if(!selected.length){if(spoken)speak('Select at least one stop before building the draft.');return}
    if(tooManyStops){if(spoken)speak('Remove a stop, add another day, or change the pace.');return}
    setBuilding(true)
    setDraftError('')
    try{
      const enteredCosts = Object.fromEntries(selected.filter(place=>stopCosts[place.url] != null && stopCosts[place.url] !== '').map(place=>[place.url,Number(stopCosts[place.url])]))
      const result=await request('locations/'+id+'/draft',{method:'POST',body:{stops:selected.map(item=>item.url),stay:stay?.url||null,days,departure:departure||null,travelers,budget:budget===''?null:Number(budget),mealPreference,localModes,pace,interests:profile?.interests?.slice(0,4),mobility:profile?.mobility,stopCosts:enteredCosts}})
      setDraft(result)
      onSaveDraft?.(editingDraft?{...result,id:editingDraft.id}:result)
      if(spoken)speak('Your draft is ready. '+result.days.map((stops,index)=>'Day '+(index+1)+'. '+(stops.length?stops.map(item=>item.name).join(', '):'Free time')).join('. ')+'.')
    }catch(failure){
      setDraftError(failure.message)
      if(spoken)speak(failure.message)
    }finally{
      setBuilding(false)
    }
  }

  if (!data && !error) return <DiscoveryLoading city={location.name}/>
  if (error || data.status === 'unavailable') {
    return <div className="nearby-status" role="status">
      <p>{error || 'The nearby place sources did not respond.'}</p>
      <Button onClick={retry}>Retry nearby search</Button>
    </div>
  }
  if (!data.places.length) return <p className="form-note">The sources returned no nearby places for {location.name}.</p>

  const preferred = [...new Set([preferredTheme,...(profile?.interests||[])].flatMap(theme=>interestCategories[theme]||[]))]
  const categories = ['All places', 'Food', 'Stay', ...new Set(data.places.map(place => place.category).filter(value=>value!=='Food'&&value!=='Stay'))]
  const interests = [...new Set([preferredTheme, ...(profile?.interests || [])].filter(Boolean))]
  const hasPhoto = place => place.photo?.url && !brokenPhotos.has(place.photo.url)
  const candidates = rankDiscoveryPlaces(data.places.filter(place => (category === 'All places' || place.category === category) && (!photosOnly || hasPhoto(place))), sort, interests)
  const detailsPlace = data.places.find(place=>discoveryPlaceKey(place)===viewPlace)
  const inDraft = place => place.category === 'Stay' ? stay?.url === place.url : selected.some(item => item.url === place.url)
  const sources = [...new Set(data.places.map(place => place.source))]
  function voiceCommand(raw){
    const command=voiceText(raw)
    if(/^(?:build|create|finish)\b/.test(command))return build(true)
    const duration=command.match(/\b(\d+|[a-z]+)\s+days?\b/)
    if(duration&&spokenNumber(duration[1])>=1&&spokenNumber(duration[1])<=5){
      setDays(spokenNumber(duration[1]));setDraft(null);speak('Draft length set to '+spokenNumber(duration[1])+' days.');return
    }
    const party=command.match(/\b(\d+|[a-z]+)\s+(?:people|travelers|travellers|adults)\b/)
    if(party&&spokenNumber(party[1])>=1&&spokenNumber(party[1])<=8){
      const count=spokenNumber(party[1])
      setTravelers(count);setDraft(null);speak('Set '+count+' travelers.');return
    }
    const price=command.match(/^(?:budget|set budget to)\s+(?:₹\s*)?([\d,]+)(?:\s*(k|thousand))?/)
    if(price){
      const amount=Number(price[1].replaceAll(',',''))*(price[2]?1000:1)
      if(amount>=1000&&amount<=10000000){setBudget(amount);setDraft(null);speak('Budget set to '+amount+' rupees.');return}
    }
    if(command==='flexible dates'){setDeparture('');setDraft(null);speak('Flexible dates selected.');return}
    const date=command.match(/^(?:depart(?:ure)?(?: on)?|date)\s+(.+)$/)?.[1]
    if(date&&/\b20\d\d\b/.test(date)){
      const parsed=new Date(date.replace(/(\d)(?:st|nd|rd|th)\b/g,'$1'))
      if(Number.isFinite(parsed.valueOf())){
        const iso=/^\d{4}-\d\d-\d\d$/.test(date)?date:`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`
        setDeparture(iso);setDraft(null);speak('Departure set to '+date+'.');return
      }
    }
    if(/^(?:list|show|read)\b/.test(command)){
      const next=categories.find(item=>command.includes(item.toLowerCase()))||
        (/stays|hotels|resorts/.test(command)?'Stay':/food|restaurants/.test(command)?'Food':'All places')
      const options=data.places.filter(item=>next==='All places'||item.category===next)
        .sort((a,b)=>Number(preferred.includes(b.category))-Number(preferred.includes(a.category))||a.distanceMetres-b.distanceMetres)
      if(!options.length){speak('No '+next.toLowerCase()+' options were returned by the sources.');return}
      setCategory(next)
      speak(options.slice(0,8).map((item,index)=>'Option '+(index+1)+', '+item.name).join('. ')+'. Say select option and its number.')
      return
    }
    const number=optionNumber(command)
    if(/^(?:select|add|choose|use)\b/.test(command)){
      const item=candidates[number-1]||candidates.find(candidate=>command.endsWith(candidate.name.toLowerCase()))
      if(item){
        const alreadySelected=item.category==='Stay'?stay?.url===item.url:selected.some(place=>place.url===item.url)
        if(!alreadySelected)select(item)
        speak('Selected '+item.name+'.')
        return
      }
    }
    speak('Say list places, list stays, select option one, two days, or build draft.')
  }
  return <section className="nearby-places" aria-label={`Nearby places in ${location.name}`}>
    <header>
      <h3>Places near {location.name}</h3>
      <p className="form-note">Select stops for your draft and a stay to use as your starting point.</p>
      <p className="research-meta">{sources.join(' and ')} · Retrieved <time dateTime={data.retrievedAt}>{new Date(data.retrievedAt).toLocaleString()}</time></p>
      {data.status === 'partial' && <p className="form-note">One source did not respond. These places came from {sources.join(' and ')}.</p>}
    </header>
    <VoicePlanner autoStart={voice} instructions="Say list places or list stays, then select option and its number. You can set days, travelers, budget, and departure, then say build draft." onCommand={voiceCommand}/>
    <div className="nearby-filters" role="group" aria-label="Filter nearby places">
      {categories.map(value => <Pill key={value} active={category === value} onClick={() => setCategory(value)}>{value}</Pill>)}
      <Pill active={photosOnly} onClick={()=>setPhotosOnly(value=>!value)}>With photos</Pill>
      <label className="nearby-sort">Sort <select value={sort} onChange={event=>setSort(event.target.value)}>
        {['For you','Nearest','Nature','Culture','Adventure','Rating'].map(value=><option key={value} disabled={value==='Rating'&&!data.places.some(place=>Number.isFinite(place.rating))}>{value}</option>)}
      </select></label>
    </div>
    {category !== 'Food' && <GroqResearch key={category} location={location} stops={selected.map(place=>place.name)}
      tripDetails={{departure:departure||null,days,travelers,budget:budget===''?null:Number(budget)}}
      label={category==='Stay'?'Research real stays with Groq':'Research activities and tickets with Groq'}
      query={category==='Stay'
        ? 'Find real stays near the selected stops. Give official property or booking links, and label rates as unconfirmed unless dates and a current quote are available.'
        : 'Find current visitor information for the selected places, or suggest activities in this city if none are selected. Check official opening hours and admission prices, and link to actual visitor reviews if available.'}/>}
    {(category === 'Food' || selected.some(place=>place.category==='Food')) && <div className="panel nearby-preferences">
      <label>What would you like to eat? <select value={mealPreference} onChange={event=>{setMealPreference(event.target.value);setDraft(null)}}>
        {['No preference','Vegetarian','Non-vegetarian','Vegan','Jain','Halal'].map(value=><option key={value}>{value}</option>)}
      </select></label>
      <p className="form-note">Confirm menus with the venue. The search may also show general food listings.</p>
      {mealPreference !== 'No preference' && <Button type="button" disabled={mealSearch === mealPreference}
        onClick={()=>{setDraftError('');setMealSearch(mealPreference);setCategory('Food')}}>
        {`Search for ${mealPreference.toLowerCase()} food`}
      </Button>}
      <GroqResearch location={location} mealPreference={mealPreference} stops={selected.map(place=>place.name)}
        label="Find food and menus with Groq"
        query="Find food stops that serve the chosen diet near the selected places. Check restaurant menus, current published prices and links. Label any unconfirmed details."/>
    </div>}
    {photosPending && <DiscoveryLoading photos/>}
    <div className="nearby-candidates" aria-label="Nearby results">
      {candidates.map(place => <DiscoveryCard key={place.url} place={hasPhoto(place)?place:{...place,photo:null}}
        onPhotoError={()=>setBrokenPhotos(current=>new Set([...current,place.photo?.url]))}
        saved={saved.some(item=>discoveryPlaceKey(item)===place.url)} onSave={()=>toggleDiscoverySaved(place,{...location,id:`geo:${id}`})}
        onOpen={()=>setViewPlace(place.url)} selected={inDraft(place)} onSelect={building?undefined:()=>select(place)}/>)}
    </div>
    {detailsPlace && <Dialog label={detailsPlace.name} className="discovery-details-dialog" onClose={()=>setViewPlace('')}>
      <PlaceDetails place={detailsPlace} added={inDraft(detailsPlace)} onAdd={building?undefined:select}/>
    </Dialog>}
    {!candidates.length && <p role="status">{photosOnly?'No matches have a photo. Turn off With photos to see more places.':'No places matched this category. Try another category or search in Explore.'}</p>}
    <LocalTransport location={location} modes={localModes} stops={selected.map(place=>place.name)} onToggle={mode=>{
      setLocalModes(current=>current.includes(mode)?current.filter(value=>value!==mode):[...current,mode])
      setDraft(null)
    }}/>
    <form className="panel nearby-actions" onSubmit={event=>{event.preventDefault();build()}}>
      <span aria-live="polite">{selected.length} {selected.length === 1 ? 'stop' : 'stops'} selected{stay ? ` · ${stay.name}` : ''}</span>
      {stay && <Button type="button" variant="text-btn" disabled={building} onClick={()=>select(stay)} aria-label={`Remove ${stay.name} from trip`}>Remove stay</Button>}
      {!!selected.length && <details className="nearby-costs">
        <summary>Review selected stops</summary>
        <ul>{selected.map(place=><li key={place.url}>{place.name} <Button type="button" variant="text-btn" disabled={building} onClick={()=>select(place)}>Remove</Button></li>)}</ul>
      </details>}
      <label>Days <select disabled={building} value={days} onChange={event => {setDays(Number(event.target.value));setDraft(null)}}>
        {[1, 2, 3, 4, 5].map(day => <option key={day} value={day}>{day}</option>)}
      </select></label>
      <label>Departure<input disabled={building} type="date" value={departure} onChange={event=>{setDeparture(event.target.value);setDraft(null)}}/></label>
      <label>Travelers<input disabled={building} type="number" required min="1" max="8" value={travelers} onChange={event=>{setTravelers(Number(event.target.value));setDraft(null)}}/></label>
      <label>Pace<select disabled={building} value={pace} onChange={event=>{setPace(event.target.value);setDraft(null)}}>
        {['Relaxed','Balanced','Packed'].map(value=><option key={value}>{value}</option>)}
      </select></label>
      <label>Group budget (₹)<input disabled={building} type="number" min="1000" max="10000000" value={budget} onChange={event=>{setBudget(event.target.value);setDraft(null)}}/></label>
      {!!selected.length && <details className="nearby-costs">
        <summary>Add prices you’ve confirmed</summary>
        <p>Enter total costs for the group. Leave unknown prices blank.</p>
        {selected.map(place=><label key={place.url}>{place.name} (₹)
          <input disabled={building} type="number" min="0" max="10000000" value={stopCosts[place.url] ?? ''} onChange={event=>{
            setStopCosts(current=>({...current,[place.url]:event.target.value}))
            setDraft(null)
          }}/>
        </label>)}
      </details>}
      {tooManyStops&&<span className="form-error" role="status">This pace allows {days * capacity} stops. Add days, change pace, or remove a stop.</span>}
      <Button type="submit" variant="primary" disabled={!selected.length||building||tooManyStops}>{building?'Building draft…':onSaveDraft?'Build and save draft':'Build day draft'}</Button>
    </form>
    {draftError&&<p className="form-error" role="alert">{draftError}</p>}
    {draft&&<NearbyDraft draft={draft}/>}
  </section>
}
