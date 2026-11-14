import React, {useState} from 'react'
import {CalendarDays, CircleDollarSign, Compass, MapPin, Minus, Pencil, Plus, Users} from 'lucide-react'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {Button, Dialog, Pill} from '../components/UI.jsx'
import {preferences} from '../profile.mjs'
import './TripSettingsDialog.css'

const choices = {
  pace:preferences.paces, transport:preferences.transport, mobility:preferences.mobility,
  diet:['No preference', 'Vegetarian', 'Non-vegetarian', 'Vegan', 'Jain', 'Halal'],
}
const icons = {destination:MapPin,origin:MapPin,date:CalendarDays,days:CalendarDays,budget:CircleDollarSign,people:Users,interests:Compass}
const descriptions = {
  destination:'Choose the city or area you want to explore.',
  origin:'Set where your journey starts, or meet the itinerary at the destination.',
  date:'Add dates or leave them open while you decide.',
  days:'Choose how many days the itinerary should cover.',
  people:'Count everyone in your group, including children and pets.',
  budget:'Set a total for the whole group, including transport and stays.',
  diet:'Choose what the planner should look for when suggesting places to eat.',
  pace:'Set how much you want to fit into each day.',
  interests:'Choose the experiences you want to see more of.',
  transport:'Choose the mode you prefer for getting around.',
  mobility:'Share any access preference to consider when planning stops.',
  stayPreferences:'Choose the types of accommodation you’d like to see.',
  notes:'Add anything else the planner should keep in mind.',
}
const durationOptions = [1,2,3,4,5].map(day => <option value={day} key={day}>{day} {day===1?'day':'days'}</option>)
const partyFields = [['adults','Adults','Ages 13 and up'],['children','Children','Ages 2–12'],['infants','Infants','Under 2'],['pets','Pets','Check operator policies']]

export function TripSettingsDialog({field,label,valueLabel,intake,catalog,onSave,onClose}) {
  const [city,setCity] = useState(intake[field] || '')
  const [toggle,setToggle] = useState(Boolean({origin:intake.localStart,date:intake.flexibleDates || !intake.date,budget:intake.budgetOpen}[field]))
  const [party,setParty] = useState({adults:intake.people || 1,children:0,infants:0,pets:0,...intake.party})
  const [selections,setSelections] = useState(intake[field] || [])
  const multiChoice = {interests:preferences.interests,stayPreferences:preferences.stays}[field]
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const Glyph = icons[field] || Pencil
  const chooseCity = item => setCity([item.name,item.region].filter(Boolean).join(', ').slice(0,100))
  const cityField = field==='destination' || field==='origin'
  const fallback = field==='pace'?'Balanced':field==='transport'?'Any':'No preference'
  async function submit(event) {
    event.preventDefault()
    if (saving) return
    const data = new FormData(event.currentTarget)
    let patch
    if (cityField) {
      if (!(field==='origin' && toggle) && city.trim().length < 2) {
        setError('Enter a city or choose one from the search results.');return
      }
      patch = {[field]:field==='origin' && toggle?null:city.trim()}
    } else if (field==='date') {
      const start = data.get('value')
      const end = data.get('end')
      if (!toggle && end && (Date.parse(end)-Date.parse(start)<0 || Date.parse(end)-Date.parse(start)>345600000)) {
        setError('Choose a last day within five days of departure.');return
      }
      patch = toggle ? {date:null,endDate:null,days:Number(data.get('days'))} : {date:start,endDate:end||null}
    } else if (field==='people') patch={party}
    else if (multiChoice) patch={[field]:selections}
    else if (field==='budget') patch={budget:toggle?null:Number(data.get('value'))}
    else patch={[field]:field==='days'?Number(data.get('value')):String(data.get('value')).trim()}
    setSaving(true)
    setError('')
    if (await onSave(patch)) onClose()
    else {setSaving(false);setError('The change wasn’t saved. Check the value and try again.')}
  }
  return <Dialog label={label} className="journey-editor-dialog" onClose={() => !saving && onClose()}>
    <form className="journey-editor" onSubmit={submit}>
      <div className="journey-editor-heading"><span><Glyph size={22}/></span><div><h2>{label}</h2><p>{descriptions[field]}</p></div></div>
      {valueLabel && <div className="journey-editor-current"><small>Current setting</small><strong>{valueLabel}</strong></div>}
      <fieldset disabled={saving} className="journey-editor-fields">
        {field==='origin' && <label className="journey-editor-toggle"><input type="checkbox" checked={toggle} onChange={event=>setToggle(event.target.checked)}/> Start at the destination</label>}
        {cityField && !(field==='origin' && toggle) && <DestinationSearch catalog={catalog} global label={field==='origin'?'Leaving from':'City or destination'}
          selected={null} onSelect={chooseCity} inputValue={city} onInputChange={setCity} maxLength={100}/>}
        {field==='date' && <>
          <label className="journey-editor-toggle"><input type="checkbox" checked={toggle} onChange={event=>setToggle(event.target.checked)}/> Keep dates flexible</label>
          {toggle ? <label>Trip length<select name="days" defaultValue={intake.days || 2}>{durationOptions}</select></label> :
            <div className="journey-editor-dates"><label>Departure date<input name="value" type="date" required defaultValue={intake.date || ''}/></label>
              <label>Last day <small>(optional)</small><input name="end" type="date" defaultValue={intake.endDate || ''}/></label></div>}
        </>}
        {field==='budget' && <>
          <label className="journey-editor-toggle"><input type="checkbox" checked={toggle} onChange={event=>setToggle(event.target.checked)}/> Leave budget undecided</label>
          {!toggle && <label>Total group budget<div className="journey-currency-field"><span aria-hidden="true">₹</span>
            <input name="value" type="number" min="1000" max="10000000" step="1" required defaultValue={intake.budget || ''} placeholder="25000"/></div></label>}
        </>}
        {field==='days' && <label>Days<select name="value" defaultValue={intake.days || 2}>{durationOptions}</select></label>}
        {field==='people' && <div className="journey-party">{partyFields.map(([key,name,hint]) => <div key={key}>
          <span><strong>{name}</strong><small>{hint}</small></span>
          <Button aria-label={`Remove ${key}`} disabled={party[key] <= (key==='adults'?1:0)} onClick={() => setParty({...party,[key]:party[key]-1})}><Minus size={16}/></Button>
          <output aria-label={name}>{party[key]}</output>
          <Button aria-label={`Add ${key}`} disabled={key==='pets'?party.pets>=8:party.adults+party.children+party.infants>=8}
            onClick={() => setParty({...party,[key]:party[key]+1})}><Plus size={16}/></Button>
        </div>)}</div>}
        {choices[field] && <label>{label} preference<select name="value" defaultValue={choices[field].includes(intake[field])?intake[field]:fallback}>
          {choices[field].map(value=><option key={value}>{value}</option>)}
        </select></label>}
        {multiChoice && <div className="journey-interest-options" aria-label={label}>{multiChoice.map(item =>
          <Pill key={item} active={selections.includes(item)} onClick={() => setSelections(old=>old.includes(item)?old.filter(value=>value!==item):[...old,item])}>{item}</Pill>)}</div>}
        {field==='notes' && <label>Notes<textarea name="value" rows={4} maxLength={500} defaultValue={intake.notes || ''} placeholder="For example, keep the first afternoon free."/></label>}
      </fieldset>
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="journey-editor-actions">
        <Button disabled={saving} onClick={onClose}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={saving}>{saving?'Saving…':'Save changes'}</Button>
      </div>
    </form>
  </Dialog>
}
