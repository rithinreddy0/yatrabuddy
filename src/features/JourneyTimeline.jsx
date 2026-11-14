import React from 'react'
import {BedDouble, Bus, Car, Clock, Home, Plane, TrainFront} from 'lucide-react'
import {Button} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {JOURNEY_MODES, clockText, journeyChecks, legSteps} from './journey.mjs'
import {arrivalPoint} from './tripTransportPlan.mjs'
import './JourneyTimeline.css'

const modeIcons = {flight:Plane, train:TrainFront, bus:Bus, drive:Car, cab:Car, other:Clock}
const dateFormat = new Intl.DateTimeFormat(undefined, {weekday:'short', day:'numeric', month:'short', timeZone:'UTC'})
const formatDate = date => date ? dateFormat.format(new Date(date + 'T12:00:00Z')) : null

export function journeyStay(draft) {
  return draft?.stay || arrivalPoint(draft)
}

/** Door-to-door steps for one direction of the journey. */
export function JourneyTimeline({journey, draft, direction}) {
  const leg = direction === 'outbound' ? journey?.outbound : journey?.returnLeg
  if (!leg) return null
  const steps = legSteps(leg, {direction, home:journey.home, stay:journeyStay(draft)})
  let lastDate = leg.date
  return <ol className="jt-steps">
    {steps.map((step, index) => {
      const Glyph = step.kind === 'main' ? modeIcons[leg.mode] || Clock : step.kind === 'arrive' ? (direction === 'outbound' ? BedDouble : Home)
        : step.kind === 'leave' ? (direction === 'outbound' ? Home : BedDouble) : null
      const newDay = step.date && step.date !== lastDate
      if (step.date) lastDate = step.date
      return <li key={index} data-kind={step.kind}>
        <span className="jt-time">{step.minute == null ? '—' : (step.suggested ? '~' : '') + clockText(step.minute)}
          {newDay && <small>{formatDate(step.date)}</small>}</span>
        <span className="jt-dot" aria-hidden="true">{Glyph && <Glyph size={13}/>}</span>
        <span className="jt-copy"><strong>{step.title}</strong>
          {step.kind === 'main' && step.endMinute != null && <small>Arrives {clockText(step.endMinute)}{step.endMinute >= 1440 ? ' next day' : ''}</small>}
          {step.detail && <small>{step.detail}</small>}</span>
      </li>
    })}
  </ol>
}

/** Itinerary card for the journey out or home, or a prompt to plan it. */
export function JourneyCard({draft, direction, onPlan}) {
  const journey = draft?.journey
  const leg = direction === 'outbound' ? journey?.outbound : journey?.returnLeg
  const title = direction === 'outbound' ? 'Journey there' : 'Journey home'
  if (!leg) {
    if (direction === 'return' && !journey) return null
    return <section className="jt-card jt-empty" aria-label={title}>
      <div><h3><Home size={17} aria-hidden="true"/> {direction === 'outbound' ? `From ${draft.origin || 'home'} and back` : title}</h3>
        <p>{direction === 'outbound' ? 'Plan the trip door to door: leaving home, the journey, the transfer to your stay, and the way back.'
          : 'Add how you will get home.'}</p></div>
      {onPlan && <Button icon="plane" variant="primary" onClick={onPlan}>Plan the journey</Button>}
    </section>
  }
  const mode = JOURNEY_MODES[leg.mode] || JOURNEY_MODES.other
  return <section className="jt-card" aria-label={title}>
    <header><h3>{title}</h3>
      <span>{[formatDate(leg.date) || 'Date not set', mode.label, leg.estimatedCost != null && money(leg.estimatedCost) + ' est.'].filter(Boolean).join(' · ')}</span>
      {onPlan && <Button variant="text-btn" icon="edit" onClick={onPlan}>Edit</Button>}</header>
    <JourneyTimeline journey={journey} draft={draft} direction={direction}/>
    {direction === 'outbound' && journeyChecks(draft, journey).map(issue => <p key={issue} className="jt-issue" role="note">{issue}</p>)}
    <p className="jt-note">Times marked ~ are suggestions from your ticket times, typical buffers and road estimates.</p>
  </section>
}
