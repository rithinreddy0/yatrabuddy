import React, {useEffect,useState} from 'react'
import {Button,Icon,IconButton,Pill,Empty} from '../components/UI.jsx'
import {themes,money} from '../planner.mjs'
import {request} from '../api.mjs'
import {DiscoveryFeed,DiscoveryLoading,DiscoveryWeather,SavedDiscoveryPlaces} from './DiscoveryFeed.jsx'
import {useDiscoveryShortlist,useSavedDiscoveryPlaces} from './discoveryPlaces.mjs'
import {PlacePhoto} from '../components/PlacePhoto.jsx'
import {ArrowRight, ChevronRight, Globe, Map, Sparkles, Utensils} from 'lucide-react'
import {BentoExploreSection} from '../components/BentoGrid.jsx'

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

export function Home({library,onAsk,onResearch,onPlan,onNavigate,destination,onRequireAccount,catalog = []}) {
  const [prompt,setPrompt]=useState('')
  const [suggested,setSuggested]=useState(null)
  const [attempt,setAttempt]=useState(0)
  const [suggestionFailure,setSuggestionFailure]=useState(false)
  const city=destination || suggested
  const cityId=city?.id?.replace(/^geo:/, '')
  const shortlist=useDiscoveryShortlist(cityId)
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
    ['guide',Globe,'Destination guide','Local highlights and travel updates'],
    ['attractions',Map,'Things to do','Landmarks, parks, and day trips'],
    ['food',Utensils,'Where to eat','Cafés, restaurants, and local food'],
  ]
  const lastDraft = [...library.drafts].sort((a,b)=>b.updated-a.updated)[0]
  const lastTrip = [...library.trips].sort((a,b)=>b.updated-a.updated)[0]
  const featuredDraft = lastDraft && (!lastTrip || lastDraft.updated >= lastTrip.updated) ? lastDraft : null
  const featuredPlace = !featuredDraft && catalog.find(place=>place.id===lastTrip?.brief.destination)
  const featuredDays = featuredDraft?.days.length ?? lastTrip?.brief.days
  const featuredTravelers = featuredDraft?.travelers ?? lastTrip?.brief.people
  const tripHref = featuredDraft ? '#draft/'+featuredDraft.id : featuredPlace ? '#trip/'+lastTrip.id : ''
  const tripPhoto = featuredDraft && [featuredDraft.stay, ...featuredDraft.days.flat()].find(place=>place?.photo?.url)
  return <div className="page yatra-overview discovery-home">
    <header className="home-masthead">YatraBuddy</header>
    {tripHref && <section className="home-active-trip" aria-labelledby="home-active-title">
      <div className="home-trip-heading">
        <div className="home-trip-thumbnail">
          {tripPhoto ? <PlacePhoto place={tripPhoto} compact/> : featuredPlace
            ? <img src={`/images/${featuredPlace.image}.jpg`} alt=""/> : <Icon name="trip" size={26}/>}
        </div>
        <div className="home-trip-copy">
          <p className="travel-label">Your latest trip</p><h1 id="home-active-title">Trip to {featuredDraft?.name || featuredPlace.name}</h1>
          <p>{[(featuredDraft ? featuredDraft.departure : lastTrip?.brief.date) || 'Flexible dates',
            `${featuredDays} ${featuredDays === 1 ? 'day' : 'days'}`, `${featuredTravelers} ${featuredTravelers === 1 ? 'traveler' : 'travelers'}`].join(' · ')}</p>
        </div>
      </div>
      <nav className="home-trip-actions" aria-label="Latest trip actions">
        <a className="btn primary" href={tripHref}>Go to trip <ArrowRight size={16}/></a>
        {featuredDraft && <>
          <a className="btn secondary" href={tripHref+'/preferences'} title="Change the number of travelers">Add members</a>
          <a className="btn secondary" href={tripHref+'/invite'}>Invite members</a>
          <a className="btn secondary" href={tripHref+'/travel'}>Trip Mode</a>
        </>}
      </nav>
    </section>}
    <section className="landing-grid landing-hero" aria-labelledby="landing-title">
      <div className="landing-copy">
        {tripHref ? <h2 id="landing-title">Plan your next trip</h2> : <h1 id="landing-title">Where do you want to go?</h1>}
        <p>Build a day-by-day itinerary with stops, travel times, and a map.</p>
        <form className="yatra-prompt landing-prompt" onSubmit={event=>{event.preventDefault();if(prompt.trim())onAsk(prompt.trim())}}>
          <label className="yatra-sr-only" htmlFor="yatra-home-prompt">Ask YatraBuddy</label>
          <Sparkles size={18} aria-hidden="true"/>
          <input id="yatra-home-prompt" value={prompt} onChange={event=>setPrompt(event.target.value)} maxLength={260}
            placeholder="Plan 3 days in Goa for two under ₹25,000"/>
          <button type="submit" aria-label="Send to AI Assistant" disabled={!prompt.trim()}><ArrowRight size={19}/></button>
        </form>
        <div className="home-prompt-examples" aria-label="Example trip prompts">
          {['A weekend in Goa','A food trip to Hyderabad','Three days in Singapore'].map(example=>
            <Pill key={example} onClick={()=>onAsk(example)}>{example}</Pill>)}
        </div>
        <div className="landing-actions">
          <Button variant="primary" icon="chat" onClick={()=>prompt.trim()?onAsk(prompt.trim()):onNavigate('chat')}>{prompt.trim()?'Plan this trip':'Start planning'}</Button>
          <a className="btn secondary" href="#trips">Open My Trips <ChevronRight size={16}/></a>
        </div>
      </div>
      <div className="landing-hero-visual">
        <img className="landing-hero-image" src="/images/kerala.jpg" alt="" fetchPriority="high" width="640" height="420"/>
        <a className="landing-hero-link" href="#discover"><Map size={17}/> Explore destinations <ChevronRight size={16}/></a>
      </div>
    </section>
    <BentoExploreSection catalog={catalog} onPlan={id => onPlan('', id)}/>
    <section className="landing-features home-explore" aria-labelledby="landing-tools">
      <h2 id="landing-tools">Explore your way</h2>
      <div className="home-explore-grid">{actions.map(([route,ActionIcon,title,description])=><a href={'#'+route} className="home-explore-card" key={route}>
        <span className="home-explore-caption"><ActionIcon size={18}/><span><strong>{title}</strong><small>{description}</small></span><ArrowRight size={17}/></span>
      </a>)}</div>
    </section>
    <section className="landing-discovery" aria-label="Destination discovery">
    <header className="discovery-home-intro">
      <div className="discovery-home-heading">
        <h2>{city ? <>Explore <span>{city.name}</span></> : 'Explore near you'}</h2>
        <p>{city && !destination && library.profile?.homeCity ? 'Near your profile city' : 'Find places to go, eat and stay.'}</p>
      </div>
      {cityId && <DiscoveryWeather key={cityId} cityId={cityId}/>}
    </header>
    {city ? <DiscoveryFeed key={city.id} location={city} profile={library.profile} onPlan={onPlan} onAsk={onAsk} onRequireAccount={onRequireAccount}/>
      : name && !suggestionFailure ? <DiscoveryLoading city={name}/>
      : suggestionFailure ? <div className="discovery-message" role="status"><p>Nearby places are temporarily unavailable.</p><Button onClick={()=>{setSuggestionFailure(false);setAttempt(value=>value+1)}}>Retry suggestion</Button><a className="btn secondary" href="#discover">Explore destinations</a></div>
      : null}
    <div className="discovery-home-links">
      <Button icon="plus" variant="primary" onClick={()=>city?onPlan('',city.id,city,false,{selected:shortlist}):onPlan()}>Plan a trip</Button>
      <Button variant="text-btn" icon="arrow" onClick={()=>onResearch('overview')}>Destination guide</Button>
    </div>
    </section>
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
