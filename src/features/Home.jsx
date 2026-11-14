import React, {useEffect,useState} from 'react'
import {Button,Dialog,Icon,IconButton,Pill,Empty} from '../components/UI.jsx'
import {themes,money} from '../planner.mjs'
import {request} from '../api.mjs'
import {DiscoveryWeather,SavedDiscoveryPlaces,useNearbyDiscovery} from './DiscoveryFeed.jsx'
import {PlaceDetails} from './PlaceDetails.jsx'
import './Home.css'
import {useSavedDiscoveryPlaces} from './discoveryPlaces.mjs'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {ArrowRight, ChevronRight, Globe, Map, Sparkles, Utensils} from 'lucide-react'

export function DestinationCard({place,saved,onSave,onOpen}) {
  return <article className="destination-card" style={{'--place-color':place.color}}>
    <button className="destination-cover" onClick={()=>onOpen(place)} aria-label={'Explore '+place.name}>
      <img src={'/images/'+place.image+'.jpg'} alt="" loading="lazy"/>
      <span className="card-tag">{place.theme}</span><span className="card-name"><strong>{place.name}</strong><small><Icon name="pin" size={13}/> {place.region}</small></span>
    </button>
    <IconButton icon="heart" label={saved?'Remove '+place.name:'Save '+place.name} className={'favorite '+(saved?'selected':'')} onClick={()=>onSave(place.id)}/>
    <button className="card-footer" onClick={()=>onOpen(place)}>{place.tagline}<Icon name="corner" size={15}/></button>
  </article>
}
export function DestinationGrid({places,saved,onSave,onOpen}) {
  return <div className="destination-grid">{places.map(place=><DestinationCard key={place.id} place={place} saved={saved.includes(place.id)} onSave={onSave} onOpen={onOpen}/>)}</div>
}
const homeCityKey = 'yatra.explore-city.v1'
export function storedCity() {
  try {
    const city = JSON.parse(localStorage.getItem(homeCityKey))
    return /^geo:\d+$/.test(city?.id) && city.name ? city : null
  } catch { return null }
}

function asCity(item) {
  return {...item,id:`geo:${item.id}`,region:[...new Set([item.region,item.country].filter(Boolean))].join(', ')}
}

function HomePlaces({city, onOpenPlace}) {
  const {report, photosPending} = useNearbyDiscovery(city?.id?.replace(/^geo:/, ''))
  const [failed, setFailed] = useState(() => new Set())
  // Only places with a matched photo make the home rail; the full list lives in Explore and the guide.
  const places = (report?.places || []).filter(place => place.category !== 'Stay' && place.photo?.url
    && place.photo.kind !== 'nearby' && !failed.has(place.url)).slice(0, 10)
  const skeletons = <div className="hm-rail" aria-hidden="true">{Array.from({length:4}, (_, index) => <i key={index} className="hm-skeleton"/>)}</div>
  if (!places.length) return !report || photosPending ? skeletons
    : <p className="hm-muted">Photos for nearby places are not available right now. <a href="#guide">Open the destination guide</a></p>
  return <div className="hm-rail" role="list">{places.map(place => <article className="hm-place" role="listitem" key={place.url}>
    <PlacePhoto place={place} hideUnavailable onOpen={() => onOpenPlace(place)}
      onUnavailable={() => setFailed(current => new Set([...current, place.url]))}/>
    <button type="button" onClick={() => onOpenPlace(place)}><strong>{place.name}</strong>
      <small>{[place.category, Number.isFinite(place.distanceMetres) && `${(place.distanceMetres / 1000).toFixed(1)} km away`].filter(Boolean).join(' · ')}</small></button>
  </article>)}</div>
}

export function Home({library,onAsk,onResearch,onPlan,onNavigate,destination,onRequireAccount,catalog = []}) {
  const [prompt,setPrompt]=useState('')
  const [suggested,setSuggested]=useState(null)
  const [attempt,setAttempt]=useState(0)
  const [suggestionFailure,setSuggestionFailure]=useState(false)
  const [openPlace,setOpenPlace]=useState(null)
  const city=destination || suggested
  const name=library.profile?.homeCity?.trim() || catalog[0]?.name
  useEffect(()=>{
    if (destination || !name) return
    const controller=new AbortController()
    request('locations?q='+encodeURIComponent(name),{signal:controller.signal}).then(matches=>{
      if(controller.signal.aborted)return
      const found=matches[0]
      setSuggestionFailure(!found)
      setSuggested(found?asCity(found):null)
    }).catch(()=>{if(!controller.signal.aborted)setSuggestionFailure(true)})
    return ()=>controller.abort()
  },[destination,name,attempt])

  const actions=[
    ['guide',Globe,'Destination guide','Best time, costs and getting there'],
    ['attractions',Map,'Things to do','Landmarks, parks and day trips'],
    ['food',Utensils,'Where to eat','Cafés, restaurants and local food'],
  ]
  const lastDraft = [...library.drafts].sort((a,b)=>b.updated-a.updated)[0]
  const lastTrip = [...library.trips].sort((a,b)=>b.updated-a.updated)[0]
  const featuredDraft = lastDraft && (!lastTrip || lastDraft.updated >= lastTrip.updated) ? lastDraft : null
  const featuredPlace = !featuredDraft && catalog.find(place=>place.id===lastTrip?.brief.destination)
  const featuredDays = featuredDraft?.days.length ?? lastTrip?.brief.days
  const featuredTravelers = featuredDraft?.travelers ?? lastTrip?.brief.people
  const tripHref = featuredDraft ? '#draft/'+featuredDraft.id : featuredPlace ? '#trip/'+lastTrip.id : ''
  const tripPhoto = featuredDraft && [featuredDraft.stay, ...featuredDraft.days.flat()].find(place=>place?.photo?.url)
  const rawDate = featuredDraft ? featuredDraft.departure : lastTrip?.brief.date
  const tripDate = rawDate ? new Intl.DateTimeFormat(undefined, {weekday:'short', day:'numeric', month:'short', timeZone:'UTC'}).format(new Date(rawDate + 'T12:00:00Z')) : null
  const greeting = library.profile?.preferredName ? `Hi ${library.profile.preferredName}, where to next?` : 'Where to next?'
  const submit = text => { if (text.trim()) onAsk(text.trim()) }
  const skeletons = <div className="hm-rail" aria-hidden="true">{Array.from({length:4}, (_, index) => <i key={index} className="hm-skeleton"/>)}</div>
  return <div className="page hm">
    <header className="hm-top">
      <span className="hm-brand"><img src="/images/brand/yatrabuddy.svg" alt="" width="30" height="30"/> YatraBuddy</span>
      <a className="hm-top-link" href="#trips">My trips <ChevronRight size={15} aria-hidden="true"/></a>
    </header>

    <section className="hm-hero" aria-labelledby="hm-title">
      <img className="hm-hero-image" src="/images/kerala.jpg" alt="" fetchPriority="high" width="1280" height="840"/>
      <div className="hm-hero-copy">
        <p className="hm-kicker"><Sparkles size={15} aria-hidden="true"/> Your AI travel buddy</p>
        <h1 id="hm-title">{greeting}</h1>
        <p className="hm-lede">Describe a trip and get a day-by-day plan with stays, food, travel times and costs, from your door and back.</p>
        <form className="hm-prompt" onSubmit={event=>{event.preventDefault();if(prompt.trim())submit(prompt);else event.currentTarget.elements['yatra-home-prompt'].focus()}}>
          <label className="yatra-sr-only" htmlFor="yatra-home-prompt">Describe your trip</label>
          <input id="yatra-home-prompt" value={prompt} onChange={event=>setPrompt(event.target.value)} maxLength={260}
            placeholder="3 days in Goa from Hyderabad under ₹20,000" enterKeyHint="go"/>
          <button type="submit" className="hm-send"><span>Plan</span><ArrowRight size={18} aria-hidden="true"/></button>
        </form>
        <div className="hm-chips" aria-label="Example trips">
          {['Weekend in Goa','Food trip to Hyderabad','5 days in Kerala with family','Singapore on a budget'].map(example=>
            <button type="button" key={example} onClick={()=>onAsk(example)}>{example}</button>)}
        </div>
      </div>
    </section>

    {tripHref && <section className="hm-continue" aria-labelledby="hm-continue-title">
      <a className="hm-continue-main" href={tripHref}>
        <span className="hm-continue-thumb">{tripPhoto ? <PlacePhoto place={tripPhoto} compact/> : featuredPlace
          ? <img src={`/images/${featuredPlace.image}.jpg`} alt=""/> : <Icon name="trip" size={22}/>}</span>
        <span className="hm-continue-copy"><small>Continue planning</small>
          <strong id="hm-continue-title">Trip to {featuredDraft?.name || featuredPlace.name}</strong>
          <small>{[tripDate || 'Flexible dates', `${featuredDays} ${featuredDays === 1 ? 'day' : 'days'}`, `${featuredTravelers} ${featuredTravelers === 1 ? 'traveller' : 'travellers'}`].join(' · ')}</small></span>
        <ArrowRight size={18} aria-hidden="true"/>
      </a>
      {featuredDraft && <nav className="hm-continue-links" aria-label="Trip shortcuts">
        <a href={tripHref+'/transport'}>Getting there</a><a href={tripHref+'/budget'}>Budget</a>
        <a href={tripHref+'/bookings'}>Bookings</a><a href={tripHref+'/travel'}>Travel Mode</a>
      </nav>}
    </section>}

    {catalog.length > 0 && <section className="hm-section" aria-labelledby="hm-destinations">
      <div className="hm-section-head"><h2 id="hm-destinations">Popular trips</h2><a href="#discover">See all</a></div>
      <div className="hm-rail hm-destinations" role="list">{catalog.slice(0, 5).map(place => <article className="hm-destination" role="listitem" key={place.id}>
        <img src={`/images/${place.image}.jpg`} alt={`${place.name}, ${place.region}`} loading="lazy" decoding="async" width="480" height="320"/>
        <div><h3>{place.name}</h3><p>{[place.theme, place.season && `Best ${place.season}`].filter(Boolean).join(' · ')}</p>
          <button type="button" onClick={() => onPlan('', place.id)} aria-label={`Plan a trip to ${place.name}`}>Plan this trip <ArrowRight size={15} aria-hidden="true"/></button></div>
      </article>)}</div>
    </section>}

    <section className="hm-section" aria-labelledby="hm-ways">
      <h2 id="hm-ways" className="yatra-sr-only">Explore your way</h2>
      <div className="hm-ways">{actions.map(([route,ActionIcon,title,description])=><a href={'#'+route} className="hm-way" key={route}>
        <span className="hm-way-icon"><ActionIcon size={19} aria-hidden="true"/></span><strong>{title}</strong><small>{description}</small>
      </a>)}</div>
    </section>

    <section className="hm-section" aria-labelledby="hm-near">
      <div className="hm-section-head"><div><h2 id="hm-near">{city ? <>Around {city.name}</> : 'Places to explore'}</h2>
        <p>{city && !destination && library.profile?.homeCity ? 'Near your home city' : 'Photographed places from open travel sources'}</p></div>
        {city && <DiscoveryWeather key={city.id} cityId={city.id.replace(/^geo:/, '')}/>}</div>
      {city ? <HomePlaces city={city} onOpenPlace={setOpenPlace}/>
        : suggestionFailure ? <div className="discovery-message" role="status"><p>Nearby places are temporarily unavailable.</p>
          <Button onClick={()=>{setSuggestionFailure(false);setAttempt(value=>value+1)}}>Try again</Button></div>
        : skeletons}
      <div className="hm-actions">
        <Button variant="primary" icon="chat" onClick={()=>city?onPlan('',city.id,city):onPlan()}>{city ? `Plan a trip to ${city.name}` : 'Plan a trip'}</Button>
        <Button icon="globe" onClick={()=>onResearch('overview')}>Destination guide</Button>
      </div>
    </section>

    <footer className="hm-footer">
      <p>Places from OpenStreetMap, Wikipedia and Wikivoyage. Weather from Open-Meteo. Prices and timings are estimates unless a provider confirms them.</p>
    </footer>
    {openPlace && <Dialog label={openPlace.name} className="discovery-details-dialog" onClose={()=>setOpenPlace(null)}>
      <PlaceDetails key={openPlace.url} place={openPlace} initialTab="media"/>
    </Dialog>}
  </div>
}

export function Discover({catalog,library,onSave,onOpen,onPlan,savedOnly}) {
  const [filter,setFilter]=useState('All places')
  const [query,setQuery]=useState('')
  const savedPlaces=useSavedDiscoveryPlaces()
  const found=catalog.filter(place=>(!savedOnly||library.saved.includes(place.id))&&(filter==='All places'||place.theme===filter)&&
    (place.name+' '+place.region+' '+place.tagline).toLowerCase().includes(query.toLowerCase()))
  return <div className="page inner-page"><div className="eyebrow"><span/> {savedOnly?'YOUR SHORTLIST':'DESTINATION GUIDE'}</div><h1>{savedOnly?'Saved places':'Explore destinations'}</h1>
    <p className="lede">{savedOnly?'Keep the places you want to come back to.':'Find a place that fits the way you want to travel.'}</p>
    {!savedOnly&&<><div className="search"><Icon name="search"/><input aria-label="Search destinations" placeholder="Search destinations" value={query} onChange={event=>setQuery(event.target.value)}/></div><div className="filters">{themes.map(theme=><Pill key={theme} active={filter===theme} onClick={()=>setFilter(theme)}>{theme}</Pill>)}</div></>}
    {savedOnly && <SavedDiscoveryPlaces onPlan={onPlan} profile={library.profile}/>}
    {found.length?<DestinationGrid places={found} saved={library.saved} onSave={onSave} onOpen={onOpen}/>:(!savedOnly||!savedPlaces.length)&&<Empty icon={savedOnly?'heart':'search'} title={savedOnly?'No saved places yet':'No destinations found'} description={savedOnly?'Use the heart on a place card to save it here.':'Try another search or theme.'}/>}
  </div>
}
export function Trips({library,catalog,onPlan,onOpen,onDelete,onOpenDraft,onDeleteDraft}) {
  return <div className="page inner-page"><div className="section-heading"><div><div className="eyebrow"><span/> YOUR WORKSPACE</div><h1>My trips</h1><p className="lede">Pick up where you left off.</p></div><Button variant="primary" icon="plus" onClick={()=>onPlan()}>New trip</Button></div>
  {library.trips.length?<div className="trip-grid">{[...library.trips].sort((a,b)=>b.updated-a.updated).map(trip=>{
    const place=catalog.find(item=>item.id===trip.brief.destination)
    if(!place)return null
    return <article className="trip-card" key={trip.id}><button className="trip-photo" aria-label={'Open '+place.name} onClick={()=>onOpen(trip.id)}><img src={'/images/'+place.image+'.jpg'} alt=""/></button><div className="trip-card-text"><div><h3>{place.name}</h3><p>{trip.brief.days} days · {trip.brief.people} travelers · {money(trip.brief.budget)} budget</p></div><IconButton icon="trash" label={'Delete '+place.name+' trip'} onClick={()=>onDelete(trip)}/></div><Button variant="text-btn" icon="arrow" onClick={()=>onOpen(trip.id)}>Open itinerary</Button></article>
  })}</div>:!library.drafts?.length&&<Empty icon="trip" title="A trip starts with an idea" description="Build an itinerary and it will be ready here." action={<Button variant="primary" onClick={()=>onPlan()}>Plan your first trip</Button>}/>}
  {!!library.drafts?.length&&<section className="discover-section"><div className="section-heading"><h2>Worldwide drafts</h2></div><div className="trip-grid">{[...library.drafts].sort((a,b)=>b.updated-a.updated).map(draft=><article className="panel trip-choice" key={draft.id}>
    <div className="trip-list-photos">{[draft.stay,...draft.days.flat()].filter(Boolean).sort((a,b)=>Number(Boolean(b.photo?.url))-Number(Boolean(a.photo?.url))).slice(0,3).map(place=><PlacePhoto key={place.url} place={place} compact fallback/>)}</div>
    <div className="eyebrow"><Icon name="globe" size={16}/> {[draft.region!==draft.name&&draft.region,draft.country].filter(Boolean).join(' · ')}</div><h3>{draft.name}</h3><p>{draft.days.length} {draft.days.length===1?'day':'days'} · {draft.days.flat().length} stops · {draft.travelers} {draft.travelers===1?'traveler':'travelers'}</p>
    <p>{draft.departure||'Flexible dates'}{draft.budget!=null&&` · ${money(draft.budget)} group budget`}{draft.stay&&` · ${draft.stay.name}`}</p>
    <div className="trip-choice-actions"><Button icon="arrow" onClick={()=>onOpenDraft(draft.id)}>Open draft</Button><IconButton icon="trash" label={'Delete '+draft.name+' draft'} onClick={()=>onDeleteDraft(draft)}/></div>
  </article>)}</div></section>}</div>
}
