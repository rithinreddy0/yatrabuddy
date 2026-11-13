import React,{useEffect,useRef,useState} from 'react'
import {
  ArrowLeft,ArrowRight,BedDouble,Building2,Check,Compass,Heart,Home,Hotel,Landmark,Leaf,MapPin,
  Mountain,Music2,Palette,ShoppingBag,Sparkles,Sun,TentTree,UserRound,UsersRound,Utensils,Wallet,
} from 'lucide-react'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {Brand,Button,Dialog} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {defaultProfile,preferences} from '../profile.mjs'
import './Profile.css'

const steps=[
  {label:'Basics',title:'Where does your journey start?',hint:'Share a few basics so trip ideas feel more like yours.'},
  {label:'Travel style',title:'How do you like to travel?',hint:'Choose your usual group and the kind of trip you enjoy.'},
  {label:'Budget',title:'What’s your usual trip budget?',hint:'Set a starting amount for the whole group. You can change it for each trip.'},
  {label:'Stays',title:'Where do you like to stay?',hint:'Choose any types of accommodation you’d like us to look for.'},
  {label:'Food',title:'What works for you at the table?',hint:'Choose a dietary preference for restaurant and meal suggestions.'},
  {label:'Interests',title:'What do you look forward to?',hint:'Pick a few things you’d like to see more of in your itineraries.'},
  {label:'Final details',title:'Anything else to keep in mind?',hint:'Add preferences for getting around and any details that make travel easier.'},
]

const groupIcons={Any:Compass,Solo:UserRound,Couple:Heart,Friends:UsersRound,Family:Home}
const stayIcons={Hotels:Hotel,'Boutique stays':Building2,Resorts:Sun,'Vacation rentals':Home,Hostels:BedDouble,Homestays:TentTree}
const interestIcons={Nature:Leaf,Culture:Landmark,Food:Utensils,Adventure:Mountain,Relaxation:Sun,Shopping:ShoppingBag,'Arts & design':Palette,Nightlife:Music2}
const dietIcons={'No restrictions':Utensils,Vegetarian:Leaf,Vegan:Leaf,Jain:Leaf,Halal:Utensils}
const budgetOptions=[10000,25000,50000,100000]
const groupSizes={Solo:1,Couple:2,Friends:3,Family:4}

function Choices({label,items,selected,onPick,icons,format=value=>value}) {
  const multiple=Array.isArray(selected)
  return <fieldset className={'profile-choices'+(icons?' profile-choices-visual':'')}>
    <legend>{label}</legend>
    <div className="profile-options">
      {items.map(item=>{
        const ItemIcon=icons?.[item]
        const active=multiple?selected.includes(item):selected===item
        return <button type="button" key={item} aria-pressed={active} onClick={()=>onPick(item)}>
          {ItemIcon&&<ItemIcon aria-hidden="true" className="profile-option-icon" size={19}/>}
          <span>{format(item)}</span>
          {icons&&<span className="profile-option-mark" aria-hidden="true">{active&&<Check size={12}/>}</span>}
        </button>
      })}
    </div>
  </fieldset>
}

function ProfilePhoto({catalog,step,style,interests}) {
  const [failedImages,setFailedImages]=useState([])
  const available=catalog.filter(place=>/^[a-z\d-]+$/i.test(place.image||'')&&!failedImages.includes(place.image))
  const matching=available.filter(place=>place.theme===style||interests.includes(place.theme))
  const photos=matching.length?matching:available
  const photo=photos[step%photos.length]

  return <figure className="profile-photo" aria-hidden="true">
    {photo?<img key={photo.image} src={'/images/'+photo.image+'.jpg'} alt="" decoding="async" onError={()=>setFailedImages(current=>[...current,photo.image])}/>:<Compass className="profile-photo-empty" size={132} strokeWidth={.65}/>}
    {photo&&<figcaption><MapPin size={16}/>{photo.region||photo.name}</figcaption>}
  </figure>
}

export function ProfileWizard({name,initial,catalog=[],isEditing=false,onDone,onClose}) {
  const [step,setStep]=useState(0)
  const [profile,setProfile]=useState(()=>({...defaultProfile,preferredName:name?.slice(0,70)||'',...initial}))
  const form=useRef(null)
  const heading=useRef(null)
  const firstRender=useRef(true)
  const finalStep=step===steps.length-1
  const currentStep=steps[step]

  useEffect(()=>{
    if(firstRender.current)firstRender.current=false
    else heading.current?.focus()
  },[step])

  const set=(key,value)=>setProfile(current=>({...current,[key]:value}))
  const toggle=(key,value)=>setProfile(current=>({...current,[key]:current[key].includes(value)
    ?current[key].filter(item=>item!==value):[...current[key],value]}))

  function move(next){
    if(!form.current.reportValidity())return
    if(profile.budget==='')set('budget',defaultProfile.budget)
    setStep(next)
  }

  function submit(event){
    event.preventDefault()
    if(!finalStep){move(step+1);return}
    onDone({...profile,preferredName:profile.preferredName.trim(),homeCity:profile.homeCity.trim(),notes:profile.notes.trim()})
  }

  return <Dialog onClose={onClose} label="Travel preferences" className="profile-dialog">
    <ProfilePhoto catalog={catalog} step={step} style={profile.style} interests={profile.interests}/>
    <div className="profile-wizard">
      <header className="profile-wizard-header">
        <div className="profile-wizard-brand"><Brand/></div>
        <nav className="profile-progress" aria-label="Profile steps">
          {steps.map(({label},index)=><button type="button" key={label} aria-current={index===step?'step':undefined}
            aria-label={label} onClick={()=>move(index)}><span>{label}</span></button>)}
        </nav>
      </header>
      <div className="profile-wizard-title">
        <span className="profile-current-step">{currentStep.label}</span>
        <h2 ref={heading} tabIndex={-1}>{currentStep.title}</h2>
        <p>{currentStep.hint}</p>
      </div>
      <form ref={form} className="profile-form" onSubmit={submit}>
        <div className="profile-step-fields" key={step}>
          {step===0&&<>
            <label className="profile-field">What should we call you?
              <input value={profile.preferredName} onChange={event=>set('preferredName',event.target.value)} maxLength={70} autoComplete="given-name" placeholder="Your preferred name"/>
            </label>
            <DestinationSearch catalog={catalog} global label="Usual departure city" placeholder="Search or enter a city"
              inputValue={profile.homeCity} onInputChange={value=>set('homeCity',value)} onSelect={place=>set('homeCity',place.name.slice(0,60))} maxLength={60}/>
          </>}
          {step===1&&<>
            <Choices label="Who do you travel with?" items={preferences.groups} selected={profile.travelGroup} icons={groupIcons}
              format={value=>value==='Any'?'It varies':value}
              onPick={travelGroup=>setProfile(current=>({...current,travelGroup,travelers:groupSizes[travelGroup]||current.travelers}))}/>
            <div className="profile-field-row">
              <label className="profile-field">Number of travellers<select value={profile.travelers} onChange={event=>set('travelers',Number(event.target.value))}>
                {Array.from({length:8},(_,index)=><option key={index} value={index+1}>{index+1}</option>)}
              </select></label>
              <label className="profile-field">Typical trip length<select value={profile.tripDays} onChange={event=>set('tripDays',Number(event.target.value))}>
                {Array.from({length:5},(_,index)=><option key={index} value={index+1}>{index+1} {index===0?'day':'days'}</option>)}
              </select></label>
            </div>
            <Choices label="Primary travel style" items={preferences.styles} selected={profile.style} onPick={value=>set('style',value)}/>
          </>}
          {step===2&&<>
            <Choices label="Suggested amounts" items={budgetOptions} selected={profile.budget} format={money} onPick={value=>set('budget',value)}/>
            <label className="profile-field">Total group budget (₹)
              <span className="profile-budget-input"><Wallet size={18} aria-hidden="true"/><input type="number" min={1000} max={10000000} step={1}
                value={profile.budget} placeholder={String(defaultProfile.budget)} onChange={event=>set('budget',event.target.value===''?'':Number(event.target.value))}/></span>
            </label>
          </>}
          {step===3&&<Choices label="Accommodation types" items={preferences.stays} selected={profile.stayPreferences} icons={stayIcons} onPick={value=>toggle('stayPreferences',value)}/>}
          {step===4&&<Choices label="Dietary preference" items={preferences.diets} selected={profile.diet} icons={dietIcons} onPick={value=>set('diet',value)}/>}
          {step===5&&<Choices label="Interests" items={preferences.interests} selected={profile.interests} icons={interestIcons} onPick={value=>toggle('interests',value)}/>}
          {finalStep&&<>
            <Choices label="Travel pace" items={preferences.paces} selected={profile.pace} onPick={value=>set('pace',value)}/>
            <div className="profile-field-row">
              <label className="profile-field">Preferred transport<select value={profile.transport} onChange={event=>set('transport',event.target.value)}>
                {preferences.transport.map(value=><option key={value}>{value}</option>)}
              </select></label>
              <label className="profile-field">Mobility preference<select value={profile.mobility} onChange={event=>set('mobility',event.target.value)}>
                {preferences.mobility.map(value=><option key={value}>{value}</option>)}
              </select></label>
            </div>
            <label className="profile-field">Trip notes <textarea value={profile.notes} maxLength={500} rows={3}
              placeholder="For example, mornings are best for sightseeing" onChange={event=>set('notes',event.target.value)}/></label>
          </>}
        </div>
        <footer className="profile-wizard-actions">
          <Button variant="text-btn" className="profile-dismiss" onClick={onClose}>{isEditing?'Cancel':'Skip for now'}</Button>
          {step>0&&<Button onClick={()=>move(step-1)}><ArrowLeft size={16} aria-hidden="true"/>Back</Button>}
          <Button type="submit" variant="primary">{finalStep?'Save preferences':'Continue'}
            {finalStep?<Sparkles size={16} aria-hidden="true"/>:<ArrowRight size={16} aria-hidden="true"/>}
          </Button>
        </footer>
      </form>
    </div>
  </Dialog>
}
