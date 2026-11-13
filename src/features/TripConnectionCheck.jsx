import React, {useState} from 'react'
import {Timer} from 'lucide-react'
import seed from '../../backend/goa-escape.json'
import {checkConnection, maximumDelay} from './connectionCheck.mjs'
import './TripConnectionCheck.css'

const money = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR', maximumFractionDigits: 0}).format

export default function TripConnectionCheck({plan, plannedTotal}) {
  const [delay, setDelay] = useState(95)
  const [reserve, setReserve] = useState(0)
  const [result, setResult] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const {brief, agentRoute: route} = plan
  const supported = brief.destination === 'goa' && seed.journeys.some(item =>
    item.destination === 'Goa' && item.origin.toLowerCase() === brief.origin.toLowerCase())
  if (!supported || !seed.routes.some(item => item.id === route?.id && item.buffer === route.buffer) || !Number.isSafeInteger(plannedTotal)) return null

  const headroom = Math.max(0, brief.budget - plannedTotal)
  const remaining = headroom - reserve
  const replacement = result?.replacement
  function resetResult() {
    setResult(null)
    setAccepted(false)
  }

  return <details className="agent-connection">
    <summary><Timer size={17} strokeWidth={1.5}/> Check a missed connection <small>Simulated</small></summary>
    <div className="agent-connection-body">
      <p><strong>{route.name}</strong> has a {route.buffer}-minute connection. Your group has <strong>{money(headroom)}</strong> left after the planned trip costs.</p>
      <label>Simulated delay: <strong>{delay} min</strong>
        <input type="range" min="0" max={maximumDelay} value={delay} onChange={event => {setDelay(Number(event.target.value)); resetResult()}}/>
      </label>
      {headroom > 0 && <details className="agent-connection-reserve">
        <summary>Set aside part of the remaining budget</summary>
        <label>Group reserve (Rs)
          <input type="number" min="0" max={headroom} value={reserve} onChange={event => {
            setReserve(Math.max(0, Math.min(headroom, Number(event.target.value) || 0))); resetResult()
          }}/>
        </label>
        <p>{money(remaining)} available for a replacement.</p>
      </details>}
      <button type="button" className="btn" onClick={() => {
        setAccepted(false)
        setResult(checkConnection({buffer: route.buffer, minutes: delay, headroom, reserve, travellers: brief.people}))
      }}>Test connection</button>
      <div className="agent-connection-result" aria-live="polite">
        {result && (result.missed ? <>
          <strong>{accepted ? 'Replacement selected for this simulation' : 'Connection missed'}</strong>
          {replacement ? <p>{replacement.name}: {money(replacement.amount * brief.people)} for {brief.people} {brief.people === 1 ? 'traveller' : 'travellers'}, with a {replacement.wait}-minute wait.</p> :
            <p>The least expensive replacement needs <strong>{money(result.extra)} more</strong> for the group.</p>}
          {replacement && !accepted && <button className="btn" type="button" onClick={() => setAccepted(true)}>Accept simulated replacement</button>}
        </> : <p><strong>Connection holds.</strong> {result.bufferAfterDelay} minutes remain to transfer.</p>)}
      </div>
    </div>
  </details>
}
