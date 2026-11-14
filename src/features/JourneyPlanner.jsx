import React, {useEffect, useState} from 'react'
import {Home} from 'lucide-react'
import {request} from '../api.mjs'
import {Button} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {JOURNEY_MODES, arrivalDate, journeyChecks, journeyCost, journeyTemplate, transferPairs, usesHubs} from './journey.mjs'
import {JourneyTimeline, journeyStay} from './JourneyTimeline.jsx'

const modeOrder = ['flight', 'train', 'bus', 'drive', 'cab', 'other']

function hubOptions(hubs, mode) {
  const kind = JOURNEY_MODES[mode]?.hub
  const list = kind === 'airport' ? hubs?.airports : kind === 'station' ? hubs?.stations : []
  return (list || []).map(hub => ({name:hub.name, code:hub.code || null, lat:hub.lat, lon:hub.lon}))
}

function HubField({label, value, options, onChange}) {
  const key = hub => hub ? hub.code || hub.name : ''
  const known = options.some(option => key(option) === key(value))
  const [custom, setCustom] = useState(Boolean(value) && !known)
  if (!options.length || custom) return <label>{label}
    <input value={value?.name || ''} maxLength={120} placeholder="Name of the stop or terminal"
      onChange={event => onChange(event.target.value.trim() ? {name:event.target.value} : null)}/>
    {options.length > 0 && <button type="button" className="tt-inline" onClick={() => {setCustom(false); onChange(options[0])}}>Choose from nearby</button>}
  </label>
  return <label>{label}
    <select value={key(value)} onChange={event => {
      if (event.target.value === '__other') { setCustom(true); onChange(null); return }
      onChange(options.find(option => key(option) === event.target.value) || null)
    }}>
      {options.map(option => <option key={key(option)} value={key(option)}>{option.name}{option.code ? ` (${option.code})` : ''}</option>)}
      <option value="__other">Other…</option>
    </select>
  </label>
}

function LegEditor({title, leg, onChange, fromOptions, toOptions, template}) {
  const set = changes => onChange({...leg, ...changes})
  return <fieldset className="jp-leg">
    <legend>{title}</legend>
    <div className="jp-grid">
      <label>How<select value={leg.mode} onChange={event => onChange(template(event.target.value))}>
        {modeOrder.map(mode => <option key={mode} value={mode}>{JOURNEY_MODES[mode].label}</option>)}</select></label>
      <label>Date<input type="date" value={leg.date || ''} onChange={event => set({date:event.target.value || null})}/></label>
      {usesHubs(leg.mode) && <HubField label="From" value={leg.fromHub} options={fromOptions} onChange={fromHub => set({fromHub, firstTransfer:null})}/>}
      {usesHubs(leg.mode) && <HubField label="To" value={leg.toHub} options={toOptions} onChange={toHub => set({toHub, lastTransfer:null})}/>}
      <label>Departs<input type="time" value={leg.departTime || ''} onChange={event => set({departTime:event.target.value || null})}/></label>
      <label>Arrives<input type="time" value={leg.arriveTime || ''} onChange={event => set({arriveTime:event.target.value || null})}/></label>
      <label className="jp-check"><input type="checkbox" checked={Boolean(leg.arriveNextDay)} onChange={event => set({arriveNextDay:event.target.checked})}/> Arrives the next day</label>
      <label>{usesHubs(leg.mode) ? 'Flight, train or bus number' : 'Vehicle or note'}<input value={leg.service || ''} maxLength={80}
        placeholder={leg.mode === 'flight' ? 'e.g. 6E 512' : leg.mode === 'train' ? 'e.g. 12779 Goa Express' : ''} onChange={event => set({service:event.target.value})}/></label>
      <label>Cost for the group (₹)<input type="number" min={0} max={10000000} step={1} value={leg.estimatedCost ?? ''}
        onChange={event => set({estimatedCost:event.target.value === '' ? null : Number(event.target.value)})}/></label>
    </div>
    <small>Copy times from your ticket or the operator’s timetable. YatraBuddy does not look up or hold seats.</small>
  </fieldset>
}

/** Plan the trip from the traveller's door and back. Saves into the trip as `journey`. */
export function JourneyPlanner({draft, plan, startMode, onStarted, onSave}) {
  const [edit, setEdit] = useState(draft.journey || null)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(!draft.journey)
  useEffect(() => { setEdit(draft.journey || null) }, [draft.journey])
  useEffect(() => {
    if (!startMode) return
    setEdit(journeyTemplate(startMode, {draft, plan}))
    setOpen(true)
    setStatus('')
    onStarted?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startMode])

  const hubs = plan?.hubs || {}
  const legTemplate = direction => mode => {
    const fresh = journeyTemplate(mode, {draft, plan})
    const current = direction === 'outbound' ? edit.outbound : edit.returnLeg
    const next = direction === 'outbound' ? fresh.outbound : fresh.returnLeg
    return {...next, date:current?.date ?? next.date, estimatedCost:current?.estimatedCost ?? null}
  }

  async function save() {
    if (!edit) return
    setBusy(true)
    setStatus('')
    try {
      const journey = structuredClone(edit)
      const pairs = transferPairs(journey, journeyStay(draft))
      if (pairs.length) {
        const result = await request('trip-transport/transfers', {method:'POST',
          body:{pairs:pairs.map(([, , a, b]) => [{lat:a.lat, lon:a.lon}, {lat:b.lat, lon:b.lon}])}}).catch(() => null)
        pairs.forEach(([key, field], index) => {
          const value = result?.transfers?.[index]
          journey[key][field] = value ? {kilometres:value.kilometres, minutes:value.minutes} : null
        })
      }
      // A trip without dates starts on the day the traveller reaches the stay.
      const arrive = !draft.departure ? arrivalDate(journey, journeyStay(draft)) : null
      await onSave({...draft, journey, ...(arrive ? {departure:arrive} : {}), updated:Math.max(Date.now(), draft.updated + 1)})
      setStatus([pairs.length ? 'Journey saved with road estimates for each transfer.' : 'Journey saved.',
        arrive && `Trip days now start on ${arrive}, the day you arrive.`].filter(Boolean).join(' '))
      setOpen(false)
    } catch (error) {
      setStatus(error.message || 'The journey could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await onSave({...draft, journey:null, updated:Math.max(Date.now(), draft.updated + 1)})
      setEdit(null)
      setStatus('Journey removed.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  return <section className="jp" aria-label="Home to home journey">
    <header className="jp-head">
      <div><h3><Home size={17} aria-hidden="true"/> Home to home</h3>
        <p>{edit ? `${edit.home?.name || 'Home'} → ${draft.name} → ${edit.home?.name || 'home'}${journeyCost(edit) ? ` · ${money(journeyCost(edit))} entered for both ways` : ''}`
          : 'Pick a way to travel below, then add your ticket times. Your itinerary, calendar, budget and Travel Mode will include the whole trip.'}</p></div>
      {draft.journey && !open && <Button icon="edit" onClick={() => setOpen(true)}>Edit journey</Button>}
    </header>
    {!edit && <div className="tt-actions">{['flight', 'train', 'bus', 'drive'].map(mode =>
      <Button key={mode} onClick={() => {setEdit(journeyTemplate(mode, {draft, plan})); setOpen(true)}}>Plan with {JOURNEY_MODES[mode].label.toLowerCase()}</Button>)}</div>}
    {edit && open && <>
      {edit.outbound && <LegEditor title={`There · ${edit.home?.name || 'home'} to ${draft.name}`} leg={edit.outbound}
        fromOptions={hubOptions(hubs.origin, edit.outbound.mode)} toOptions={hubOptions(hubs.destination, edit.outbound.mode)}
        template={legTemplate('outbound')} onChange={outbound => setEdit({...edit, outbound})}/>}
      {edit.returnLeg && <LegEditor title={`Back · ${draft.name} to ${edit.home?.name || 'home'}`} leg={edit.returnLeg}
        fromOptions={hubOptions(hubs.destination, edit.returnLeg.mode)} toOptions={hubOptions(hubs.origin, edit.returnLeg.mode)}
        template={legTemplate('return')} onChange={returnLeg => setEdit({...edit, returnLeg})}/>}
      <div className="tt-actions">
        <Button variant="primary" icon="check" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save journey'}</Button>
        <Button disabled={busy} onClick={() => {setEdit(draft.journey || null); setOpen(Boolean(!draft.journey))}}>Cancel</Button>
        {draft.journey && <Button icon="trash" disabled={busy} onClick={remove}>Remove journey</Button>}
      </div>
    </>}
    {edit && journeyChecks(draft, edit).length > 0 && <ul className="jp-issues" role="status">
      {journeyChecks(draft, edit).map(issue => <li key={issue}>{issue}</li>)}</ul>}
    {edit && <div className="jp-preview">
      {edit.outbound && <div><h4>There</h4><JourneyTimeline journey={edit} draft={draft} direction="outbound"/></div>}
      {edit.returnLeg && <div><h4>Back home</h4><JourneyTimeline journey={edit} draft={draft} direction="return"/></div>}
    </div>}
    {status && <p className="tt-status" role="status">{status}</p>}
  </section>
}
