import React, {useEffect, useState} from 'react'
import {SourcePill} from '../components/UI.jsx'
import {freshnessLabel, request} from '../api.mjs'
import {money} from '../planner.mjs'
import {GroqResearch} from './GroqResearch.jsx'

export function LocalTransport({location, modes = [], stops, onToggle}) {
  const hyderabad = location.country === 'India' && ['hyderabad', 'secunderabad'].includes(location.name.toLowerCase())
  const india = location.country === 'India'
  const locationId = location.cityId || location.id
  const [fareResult, setFareResult] = useState(null)
  useEffect(()=>{
    if (!hyderabad || !locationId) return
    const controller = new AbortController()
    request('locations/'+locationId+'/local-transport',{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setFareResult({locationId,...result})})
      .catch(()=>{if(!controller.signal.aborted)setFareResult({locationId,passes:[]})})
    return ()=>controller.abort()
  },[hyderabad,locationId])
  const fares = fareResult?.locationId === locationId ? fareResult : null
  const choices = [
    ['Walk', 'Check sidewalks, weather and accessibility for short legs.'],
    ['Bus', 'Compare a pass against single fares when you have several rides.'],
    ['Metro', 'Check station access and station-to-station fares.'],
    ...(india ? [['Auto', 'Compare pickup wait and fare in the ride app.']] : []),
    ['Cab', 'Compare the group fare, luggage space and pickup wait.'],
  ]
  return <section className="panel nearby-transport">
    <h3>Getting around {location.name}</h3>
    {onToggle && <fieldset>
      <legend>Which modes would you use? Choose several.</legend>
      {choices.map(([mode, note]) => <label key={mode}>
        <input type="checkbox" checked={modes.includes(mode)} onChange={() => onToggle(mode)}/>
        <span><strong>{mode}</strong><small>{note}</small></span>
      </label>)}
    </fieldset>}
    {hyderabad && <>
      {fares?.passes.length ? <div>
        {fares.passes.map(pass=><p key={pass.name}>{pass.name} · {money(pass.amount)} per passenger for 24 hours</p>)}
        <small>{freshnessLabel(fares)} · TGSRTC</small>
      </div> : <p>{fares ? 'See TGSRTC for the current Travel-24 bus pass price.' : 'Checking published bus pass prices…'}</p>}
      <p>Metro fares depend on the boarding and destination stations.</p>
      <div className="nearby-links">
        <SourcePill label="TGSRTC pass and fare terms" url="https://www.tgsrtc.telangana.gov.in/reservation-marketing-schemes"/>
        <SourcePill label="Hyderabad Metro fare chart" url="https://ltmetro.com/fare-ticketing/"/>
      </div>
    </>}
    <p>Compare public transport with the current pickup-to-drop-off quote for a cab{india ? ' or auto' : ''}. Availability and wait times vary by leg.</p>
    <div className="nearby-links">
      <SourcePill label="Uber fare estimate" url={hyderabad ? 'https://www.uber.com/in/en/r/cities/taxi/hyderabad-telangana-in/' : 'https://www.uber.com/global/en/price-estimate/'}/>
      {india && <SourcePill label="Check Rapido fares in app" url="https://rapido.bike/"/>}
    </div>
    {locationId && <GroqResearch key={locationId} location={location} localModes={modes} stops={stops}
      label="Find local fares and passes with Groq"
      query="Find official local transit routes, passes and fares, compare with cab and ride-hail for these stops. Include pass coverage, limitations and source URLs."/>}
  </section>
}
