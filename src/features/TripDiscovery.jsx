import React,{useEffect,useRef,useState} from 'react'
import {request} from '../api.mjs'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {AgentProgress,Button,Pill} from '../components/UI.jsx'
import {NearbyPlaces} from './NearbyPlaces.jsx'
import {VoicePlanner,optionNumber} from './VoicePlanner.jsx'
import {speak} from './reminders.mjs'

function asCity(place){
  return {...place,id:'geo:'+place.id,region:[...new Set([place.region,place.country].filter(Boolean))].join(', ')}
}
export function TripDiscovery({catalog,initialDestination,initialCity,tripRequest,editingDraft,profile,onSaveDraft,voice=false,voiceSuspended=false}){
  const [place,setPlace]=useState(()=>initialCity?.id.startsWith('geo:')?initialCity:null)
  const [choices,setChoices]=useState([])
  const [nearbyVoice,setNearbyVoice]=useState(false)
  const [error,setError]=useState('')
  const [searching,setSearching]=useState(false)
  const active=useRef(null)

  useEffect(()=>{
    if(place||(!initialDestination&&!tripRequest?.destination))return
    const legacy=catalog.find(item=>item.id===initialDestination)
    const controller=new AbortController()
    active.current=controller
    if(initialDestination?.startsWith('geo:')){
      setSearching(true)
      request('locations/'+initialDestination.slice(4),{signal:controller.signal})
        .then(result=>setPlace(asCity(result)))
        .catch(failure=>{if(!controller.signal.aborted)setError(failure.message)})
        .finally(()=>{if(!controller.signal.aborted)setSearching(false)})
    }else if(legacy){
      find(legacy.name,voice,controller,legacy.id==='singapore'?'Singapore':'India')
    }else if(tripRequest?.destination){
      find(tripRequest.destination,voice,controller)
    }
    return ()=>controller.abort()
  },[])
  useEffect(()=>()=>active.current?.abort(),[])

  function select(city,spoken=false){
    setPlace(city)
    setChoices([])
    setNearbyVoice(spoken)
    setError('')
  }

  async function find(name,spoken,controller,country){
    setSearching(true)
    setError('')
    try{
      const matches=await request('locations?q='+encodeURIComponent(name.slice(0,100)),{signal:controller.signal})
      if(controller.signal.aborted)return
      const exact=matches.filter(item=>item.name.toLowerCase()===name.split(',')[0].trim().toLowerCase())
      const expected=country&&(exact.length?exact:matches).find(item=>item.country===country)
      const regional=exact.find(item=>item.kind==='region')
      const results=(expected?[expected]:regional?[regional]:exact.length?exact:matches).slice(0,6).map(asCity)
      if(results.length===1){select(results[0],spoken);return}
      setChoices(results)
      if(!results.length)setError('No cities matched. Try adding the country.')
      if(spoken)speak(results.length?results.map((item,index)=>'Option '+(index+1)+', '+item.name+', '+item.region).join('. ')+'. Say the option number.':'No cities matched. Try adding the country.')
    }catch(failure){
      if(!controller.signal.aborted){setError(failure.message);if(spoken)speak(failure.message)}
    }finally{
      if(!controller.signal.aborted)setSearching(false)
    }
  }

  async function voiceCommand(raw){
    const number=optionNumber(raw)
    if(choices.length&&number>=1&&number<=choices.length){select(choices[number-1],true);return}
    const name=raw.match(/^(?:find|search for|go to|plan (?:a trip )?to|destination)\s+(.+?)\.?$/i)?.[1]
    if(!name){speak('Say find followed by a city, for example, find Kyoto, Japan.');return}
    active.current?.abort()
    const controller=new AbortController()
    active.current=controller
    return find(name,true,controller)
  }

  return <div className="page inner-page trip-discovery">
    <h1>Choose what goes in your trip</h1>
    <p className="lede">Search worldwide, compare places and stays, and pick the stops you want.</p>
    <div className="panel trip-discovery-search"><DestinationSearch catalog={[]} selected={place} onSelect={select} global/></div>
    {!place&&!voiceSuspended&&<VoicePlanner instructions="Say find followed by your destination. I’ll read out options if several cities match." autoStart={voice} onCommand={voiceCommand}/>}
    {searching&&<AgentProgress label="Finding the destination"/>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {choices.length>0&&<div className="quick-picks">{choices.map((city,index)=><Pill key={city.id} onClick={()=>select(city)}>{index+1}. {city.name}, {city.region}</Pill>)}</div>}
    {place&&<NearbyPlaces key={place.id} location={{...place,id:place.id.slice(4)}} profile={profile} tripRequest={tripRequest}
      editingDraft={Number(place.id.slice(4))===editingDraft?.cityId?editingDraft:undefined}
      preferredTheme={profile?.interests?.[0]||profile?.style} voice={(voice||nearbyVoice)&&!voiceSuspended} onSaveDraft={onSaveDraft}/>}
    {place&&<Button variant="text-btn" onClick={()=>{setPlace(null);setNearbyVoice(false)}}>Search for another destination</Button>}
  </div>
}
