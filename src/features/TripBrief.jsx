import React,{useState} from 'react'
import {AgentProgress,Button,Dialog,Pill} from '../components/UI.jsx'
import {request} from '../api.mjs'
import {money,matchDestination} from '../planner.mjs'
import {styles} from './Account.jsx'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {VoicePlanner,voiceText} from './VoicePlanner.jsx'
import {speak,spokenNumber} from './reminders.mjs'

const titles=['Where are you headed?','When are you going?','Who’s coming along?','What’s your total budget?','How do you want to travel?']
const fields=[['destination','origin'],['date','days'],['people'],['budget'],['style','diet','pace']]
const styleIcons={Balanced:'compass',Nature:'map',Culture:'pin',Food:'fork',Adventure:'plane',Relaxed:'clock'}
export function initialBrief(query,id,style,profile) {
  const place=id||matchDestination(query)?.id||'hyderabad'
  const days=query.match(/\b([1-5])\s*(?:days?|nights?)\b/i)
  const people=query.match(/\b([1-8])\s+(?:people|travelers|travellers|adults)\b/i)
  const origin=query.match(/\bfrom\s+([\p{L} ]+?)(?=\s+(?:to|via|for|with)\b|[,.!?]|$)/iu)
  const budget=query.match(/(?:₹|\binr\s*|\brs\.?\s*)([\d,]+)\s*(k)?\b/i)
  const requestedBudget=budget?Number(budget[1].replaceAll(',',''))*(budget[2]?1000:1):0
  return {destination:place,origin:origin?.[1].trim()||profile?.homeCity||'Hyderabad',date:'',days:days?Number(days[1]):profile?.tripDays||3,
    people:people?Number(people[1]):/\bsolo\b/i.test(query)?1:profile?.travelers||2,
    budget:requestedBudget>=1000&&requestedBudget<=10000000?requestedBudget:profile?.budget||(place==='singapore'?90000:25000),
    style:profile?.style||style||'Balanced',
    diet:['Vegan','Vegetarian','Jain','Halal'].find(diet=>query.toLowerCase().includes(diet.toLowerCase()))||profile?.diet||'No restrictions',
    pace:/\b(?:slow|relaxed|unhurried)\b/i.test(query)||profile?.mobility==='Less walking'?'Relaxed':profile?.pace||'Balanced',assumed:fields.flat()}
}
const voiceSteps=[
  'Say start from, followed by your departure city. Then say next.',
  'Say a departure date with its year, a number of days, or say flexible dates. Then say next.',
  'Say how many travelers are coming, then say next.',
  'Say budget followed by a number in rupees, then say next.',
  'Say a travel style, pace, or food preference. When ready, say build itinerary.',
]
export function TripBrief({catalog,query='',initial,editIndex,onClose,onDone,selection,voice=false}) {
  const [step,setStep]=useState(editIndex??0)
  const [brief,setBrief]=useState(initial)
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  const place=catalog.find(place=>place.id===brief.destination)
  const editing=editIndex!==undefined
  function update(field,value) {setBrief(state=>({...state,[field]:value}))}
  async function advance(confirmed,spoken=false) {
    const next={...brief,assumed:confirmed?brief.assumed.filter(item=>!fields[step].includes(item)):brief.assumed}
    if(!editing&&step<titles.length-1){setBrief(next);setStep(step+1);if(spoken)speak(voiceSteps[step+1]);return}
    setPending(true);setError('')
    try {
      const response=await request('plan',{method:'POST',body:{...next,date:next.date||null,selectedStops:selection?.stops,selectedStay:selection?.stay}})
      onDone(response,spoken)
    } catch (error) {setError(error.message);if(spoken)speak(error.message)}
    finally {setPending(false)}
  }
  function voiceCommand(raw){
    if(pending)return
    const command=voiceText(raw)
    if(command==='back'&&step>0&&!editing){setStep(step-1);speak(voiceSteps[step-1]);return}
    if(/^(?:next|continue|build itinerary|build my itinerary|save changes)$/.test(command)){
      return advance(true,true)
    }
    if(command==='skip'||command==='use defaults')return advance(false,true)
    const days=command.match(/\b(\d+|[a-z]+)\s+days?\b/)
    const people=command.match(/\b(\d+|[a-z]+)\s+(?:people|travelers|travellers|adults)\b/)
    const budget=command.match(/^(?:budget|set budget to)\s+(?:₹\s*)?([\d,]+)(?:\s*(k|thousand))?/)
    const origin=raw.match(/^(?:start from|starting from|depart from)\s+(.+?)\.?$/i)
    if(origin){update('origin',origin[1].slice(0,60));speak('Starting city set to '+origin[1]+'.');return}
    if(days&&spokenNumber(days[1])>=1&&spokenNumber(days[1])<=5){update('days',spokenNumber(days[1]));speak('Trip length set to '+spokenNumber(days[1])+' days.');return}
    if(people&&spokenNumber(people[1])>=1&&spokenNumber(people[1])<=8){update('people',spokenNumber(people[1]));speak('Travelers set to '+spokenNumber(people[1])+'.');return}
    if(command==='solo'){update('people',1);speak('One traveler.');return}
    if(budget){
      const amount=Number(budget[1].replaceAll(',',''))*(budget[2]?1000:1)
      if(amount>=1000&&amount<=10000000){update('budget',amount);speak('Budget set to '+amount+' rupees.');return}
    }
    if(command==='flexible dates'){update('date','');speak('Flexible dates selected.');return}
    const date=command.match(/^(?:depart(?:ure)?(?: on)?|date)\s+(.+)$/)?.[1]
    if(date&&/\b20\d\d\b/.test(date)){
      const parsed=new Date(date.replace(/(\d)(?:st|nd|rd|th)\b/g,'$1'))
      if(Number.isFinite(parsed.valueOf())){
        const iso=/^\d{4}-\d\d-\d\d$/.test(date)?date:`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`
        update('date',iso);speak('Departure set to '+date+'.');return
      }
    }
    const style=styles.find(item=>command==='style '+item.toLowerCase()||command===item.toLowerCase())
    const diet=['No restrictions','Vegetarian','Vegan','Jain','Halal'].find(item=>command==='food '+item.toLowerCase()||command===item.toLowerCase())
    const pace=['Relaxed','Balanced','Packed'].find(item=>command==='pace '+item.toLowerCase())
    if(style){update('style',style);speak('Travel style set to '+style+'.');return}
    if(diet){update('diet',diet);speak('Food preference set to '+diet+'.');return}
    if(pace){update('pace',pace);speak('Pace set to '+pace+'.');return}
    speak(voiceSteps[step])
  }
  return <Dialog onClose={onClose} label="Trip brief" className="wizard">
    <div className="wizard-layout">
      <div className="wizard-art" style={{'--place-color':place.color}}><img src={'/images/'+place.image+'.jpg'} alt=""/><div><span>YOUR TRIP BRIEF</span><strong>{place.name}</strong></div></div>
      <div className="dialog-content wizard-content"><div className="eyebrow"><span/> {editing?'EDIT TRIP BRIEF':'STEP '+(step+1)+' OF '+titles.length}</div>
        {!editing&&<div className="wizard-progress" aria-hidden="true">{titles.map((_,index)=><i key={index} className={index<=step?'filled':''}/>)}</div>}
        <h2>{titles[step]}</h2>{step===0&&query&&<p className="prompt-quote">“{query}”</p>}
        <VoicePlanner instructions={voiceSteps[step]} autoStart={voice} onCommand={voiceCommand}/>
        <form className="stack" onSubmit={event=>{event.preventDefault();advance(true)}}>
          {step===0&&<>{selection?<p className="form-note">{place.name} · {selection.stops.length} selected {selection.stops.length===1?'stop':'stops'}</p>:
          <DestinationSearch catalog={catalog} selected={place} onSelect={next=>setBrief(state=>({...state,destination:next.id}))}/>}
          <label>Starting city<input maxLength={60} value={brief.origin} required onChange={event=>update('origin',event.target.value)}/></label></>}
          {step===1&&<><label>Departure date <span>optional</span><input type="date" value={brief.date||''} onChange={event=>update('date',event.target.value)}/></label><fieldset className="choice-field"><legend>Length</legend><div className="quick-picks">{[1,2,3,4,5].map(value=><Pill key={value} active={brief.days===value} onClick={()=>update('days',value)}>{value} {value===1?'day':'days'}</Pill>)}</div></fieldset></>}
          {step===2&&<fieldset className="choice-field"><legend>Number of travelers</legend><div className="quick-picks">{[1,2,3,4,5,6,7,8].map(value=><Pill key={value} icon="users" active={brief.people===value} onClick={()=>update('people',value)}>{value===1?'Solo':value===2?'Two travelers':value}</Pill>)}</div></fieldset>}
          {step===3&&<><label>Total in INR (₹)<input type="number" min={1000} max={10000000} value={brief.budget} required onChange={event=>update('budget',event.target.value===''?'':Number(event.target.value))}/></label><div className="quick-picks">{[15000,25000,50000,90000].map(amount=><Pill key={amount} active={brief.budget===amount} onClick={()=>update('budget',amount)}>{money(amount)}</Pill>)}</div></>}
          {step===4&&<>
            <fieldset className="choice-field"><legend>Choose a style</legend><div className="quick-picks">{styles.map(style=><Pill key={style} icon={styleIcons[style]} active={brief.style===style} onClick={()=>update('style',style)}>{style}</Pill>)}</div></fieldset>
            <fieldset className="choice-field"><legend>Travel pace</legend><div className="quick-picks">{['Relaxed','Balanced','Packed'].map(pace=><Pill key={pace} active={(brief.pace||'Balanced')===pace} onClick={()=>update('pace',pace)}>{pace}</Pill>)}</div></fieldset>
            <fieldset className="choice-field"><legend>Food preference</legend><div className="quick-picks">{['No restrictions','Vegetarian','Vegan','Jain','Halal'].map(diet=><Pill key={diet} active={(brief.diet||'No restrictions')===diet} onClick={()=>update('diet',diet)}>{diet}</Pill>)}</div></fieldset>
          </>}
          {pending&&<AgentProgress label="Building your itinerary" steps={['Trip brief','Day plan','Budget estimates']}/>}
          {error&&<p className="form-error" role="alert">{error}</p>}
          <div className="dialog-buttons">{step>0&&!editing&&<Button icon="back" disabled={pending} onClick={()=>setStep(step-1)}>Back</Button>}<Button icon="arrow" type="submit" variant="primary" disabled={pending}>{pending?'Building itinerary…':editing?'Save changes':step===4?'Build itinerary':'Continue'}</Button></div>
        </form>
        {!editing&&<Button variant="text-btn" disabled={pending} onClick={()=>advance(false)}>Decide for me</Button>}
      </div>
    </div>
  </Dialog>
}
