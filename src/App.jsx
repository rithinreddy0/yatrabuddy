import React,{Suspense,lazy,useCallback,useEffect,useRef,useState} from 'react'
import {UserRound} from 'lucide-react'
import {needsOnboarding} from './authGate.mjs'
import {AgentProgress,Brand,Button,Dialog,Empty,Icon,TravelArtwork} from './components/UI.jsx'
import {request} from './api.mjs'
import {allowedStop,setCatalog} from './planner.mjs'
import {Home,Discover,Trips,storedCity} from './features/Home.jsx'
import {Account,Preferences} from './features/Account.jsx'
import {OnboardingChat} from './features/OnboardingChat.jsx'
import {ProfileWizard} from './features/Profile.jsx'
import {preferredDestination} from './profile.mjs'
const DestinationGuide=lazy(()=>import('./features/DestinationGuide.jsx').then(module=>({default:module.DestinationGuide})))
const TripBrief=lazy(()=>import('./features/TripBrief.jsx').then(module=>({default:module.TripBrief})))
const Trip=lazy(()=>import('./features/Trip.jsx').then(module=>({default:module.Trip})))
const PlanningAgent=lazy(()=>import('./features/PlanningAgent.jsx').then(module=>({default:module.PlanningAgent})))
const TravelDesk=lazy(()=>import('./features/TravelDesk.jsx').then(module=>({default:module.TravelDesk})))
const WorldSearch=lazy(()=>import('./features/WorldSearch.jsx').then(module=>({default:module.WorldSearch})))
const Buddy=lazy(()=>import('./features/Buddy.jsx').then(module=>({default:module.Buddy})))
const TripDiscovery=lazy(()=>import('./features/TripDiscovery.jsx').then(module=>({default:module.TripDiscovery})))
const TripWorkspace=lazy(()=>import('./features/TripWorkspace.jsx').then(module=>({default:module.TripWorkspace})))
const TripWorkspaceList=lazy(()=>import('./features/TripWorkspace.jsx').then(module=>({default:module.TripWorkspaceList})))
const TripOverview=lazy(()=>import('./features/TripOverview.jsx').then(module=>({default:module.TripOverview})))
import {speak,useReminders} from './features/reminders.mjs'
import {useLibrary} from './features/useLibrary.mjs'
const Yatra=lazy(()=>import('./features/Yatra.jsx').then(module=>({default:module.Yatra})))
import fallbackCatalog from '../backend/catalog.json'

const pages=[['home','home','Home'],['chat','chat','Chats'],['trips','trip','My Trips'],['discover','map','Explore'],['saved','heart','Saved'],['guide','globe','Destination guide']]
const labels={
  ...Object.fromEntries(pages.map(([id,,label])=>[id,label])),
  hotels:'Hotels',stays:'Stays',chat:'AI Assistant',agents:'Destination research',
  saved:'Saved places',news:'Travel updates',desk:'Travel desk',
}
labels.demo='Demo scenario'
labels.preferences='Preferences'
labels.account='Account'
labels.signin='Sign in'
labels.trip='Trip workspace'
labels.browse='Plan a trip'
labels.draft='Worldwide trip draft'
labels.workspace='Shared trip'
labels.join='Trip invitation'
labels.attractions='Places to visit'
labels.food='Food & restaurants'
labels.itinerary='Itinerary'
labels.budget='Budget'
const guestPages = new Set(['home','discover','guide','hotels','stays','attractions','food','preferences','signin'])

function currentRoute(){
  const value=location.hash.slice(1)||(new URLSearchParams(location.search).has('group')?'demo':'home')
  const [page,id,section]=value.split('/')
  return {page:['agents','news','sources'].includes(page)?'guide':labels[page]?page:'home',id,section}
}
function storedTheme(){
  try {
    const saved = localStorage.getItem('yatra.theme')
    if (['light','dark','system'].includes(saved)) return saved
  } catch {}
  return 'light'
}
export default function App(){
  const [route,setRoute]=useState(currentRoute)
  const [modal,setModal]=useState(null)
  const [menu,setMenu]=useState(false)
  const [navHover,setNavHover]=useState(false)
  const [navFocus,setNavFocus]=useState(false)
  const [theme,setTheme]=useState(storedTheme)
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches)
  const resolvedTheme=theme==='system'?(systemDark?'dark':'light'):theme
  const mobileNav=useRef(null)
  const expanded=navHover||navFocus
  const [catalog,setPlaces]=useState(fallbackCatalog)
  const [policy,setPolicy]=useState(null)
  const [loadError,setLoadError]=useState('')
  const [notice,setNotice]=useState(null)
  const [chatRequest,setChatRequest]=useState({query:'',id:0,context:null})
  const [activeTripId,setActiveTripId]=useState(()=>{try{return localStorage.getItem('yatra.activeTrip')||''}catch{return ''}})
  const [browseRequest,setBrowseRequest]=useState(null)
  const [homeDestination]=useState(storedCity)
  const [histories,setHistories]=useState({})
  const state=useLibrary()
  const {user,library,ready,profileReady,change}=state
  const mustSignIn=policy!==false
  const restricted = !user && (route.page === 'account' || mustSignIn && !guestPages.has(route.page))
  const signInTarget = useRef('home')
  const tripPages=['trip','itinerary','budget']
  const validActiveTripId=library.trips.some(item=>item.id===activeTripId)?activeTripId:(library.trips[0]?.id||'')
  const selectedTripId=route.id||validActiveTripId
  useEffect(()=>{
    if(!ready||activeTripId===validActiveTripId)return
    setActiveTripId(validActiveTripId)
    try{if(validActiveTripId)localStorage.setItem('yatra.activeTrip',validActiveTripId);else localStorage.removeItem('yatra.activeTrip')}catch{}
  },[ready,activeTripId,validActiveTripId])
  const trip=tripPages.includes(route.page)?library.trips.find(item=>item.id===selectedTripId):null
  useEffect(()=>{if(trip){setActiveTripId(trip.id);try{localStorage.setItem('yatra.activeTrip',trip.id)}catch{}}},[trip?.id])
  const draft=route.page==='draft'?library.drafts.find(item=>item.id===route.id):null
  const place=trip&&catalog?.find(item=>item.id===trip.brief.destination)
  const history=histories[trip?.id]||{past:[],future:[]}
  const message=useCallback(value=>setNotice({value}),[])
  const showReminder=useCallback(label=>message('Travel reminder · '+label),[message])
  const reminders=useReminders(showReminder)
  const previousRoute=useRef(null)

  useEffect(()=>{
    const routeKey=route.page+'/'+(route.id||'')+'/'+(route.section||'')
    const pageTitle=place?.name||labels[route.page]||'Travel workspace'
    document.title=pageTitle+' · YatraBuddy'
    if(previousRoute.current!==routeKey){
      const hadRoute=previousRoute.current!==null
      previousRoute.current=routeKey
      if(!hadRoute)return
      const frame=window.requestAnimationFrame(()=>{
        const main=document.getElementById('main')
        const heading=main?.querySelector('h1')
        const target=heading||main
        if(heading&&!heading.hasAttribute('tabindex'))heading.tabIndex=-1
        target?.focus({preventScroll:true})
      })
      return ()=>window.cancelAnimationFrame(frame)
    }
  },[route.page,route.id,route.section,place?.name])

  useEffect(()=>{
    const media=window.matchMedia('(prefers-color-scheme: dark)')
    const update=event=>setSystemDark(event.matches)
    media.addEventListener('change',update)
    return ()=>media.removeEventListener('change',update)
  },[])
  useEffect(()=>{
    document.documentElement.dataset.theme=resolvedTheme
  },[resolvedTheme])
  function changeTheme(next){
    setTheme(next)
    try { localStorage.setItem('yatra.theme',next) } catch {}
  }

  useEffect(()=>{
    setCatalog(fallbackCatalog)
    const controller=new AbortController()
    let retry
    function loadCatalog(attempt=0) {
      const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(4500)])
      request('destinations',{signal}).then(places=>{
        if(!Array.isArray(places)||!places.length)throw new Error('Catalog unavailable')
        if(controller.signal.aborted)return
        setCatalog(places)
        setPlaces(places)
        setLoadError('')
      }).catch(()=>{
        if(controller.signal.aborted)return
        setLoadError('Showing the saved destination guide while the travel service connects.')
        if(attempt<3)retry=window.setTimeout(()=>loadCatalog(attempt+1),2000 * (attempt+1))
      })
    }
    loadCatalog()
    return ()=>{controller.abort();window.clearTimeout(retry)}
  },[])
  useEffect(()=>{
    const controller=new AbortController()
    request('auth/config',{signal:controller.signal}).then(config=>setPolicy(config.googleRequired!==false)).catch(()=>{if(!controller.signal.aborted)setPolicy(true)})
    return ()=>controller.abort()
  },[])
  useEffect(()=>{
    if(!ready || policy===null || !restricted)return
    signInTarget.current=location.hash.slice(1) || route.page
    location.replace('#signin')
  },[ready,policy,restricted,route.page,route.id,route.section])
  useEffect(()=>{
    const handle=()=>{setRoute(currentRoute());setMenu(false);setNavHover(false);setNavFocus(false);window.scrollTo(0,0)}
    window.addEventListener('hashchange',handle)
    return ()=>window.removeEventListener('hashchange',handle)
  },[])
  useEffect(()=>{
    if(!notice)return
    const id=setTimeout(()=>setNotice(null),3800)
    return ()=>clearTimeout(id)
  },[notice])
  function navigate(value){
    location.hash=value
    setRoute(currentRoute())
    setMenu(false)
    setModal(null)
    window.scrollTo(0,0)
  }
  function start(query='',id,city,voice=false,tripRequest){
    setBrowseRequest({id,city,voice,tripRequest})
    navigate(id?'browse/'+id:'browse')
  }
  function ask(query,context=null){
    setChatRequest({query,id:Date.now(),context})
    navigate(context?'chat/'+context:'chat')
  }
  function newTripChat(query=''){
    ask(query,'new-'+Date.now())
  }
  function planWithChat(query='',id,city,_voice=false,tripRequest){
    const named=city?.name||catalog?.find(item=>item.id===id)?.name||''
    const picks=(tripRequest?.selected||[]).map(item=>item?.name).filter(Boolean).slice(0,6)
    const profile=library.profile
    let text=(query||'').trim()
    if(!text){
      const parts=[named?`Plan a trip to ${named}`:'Help me plan a trip']
      if(profile?.tripDays)parts.push(`for ${profile.tripDays} days`)
      if(profile?.travelers)parts.push(`with ${profile.travelers} travelers`)
      if(profile?.budget)parts.push(`around ₹${Number(profile.budget).toLocaleString('en-IN')}`)
      if(profile?.pace&&profile.pace!=='Balanced')parts.push(`at a ${profile.pace.toLowerCase()} pace`)
      text=parts.join(' ')
      if(picks.length)text+=`. Include ${picks.join(', ')}`
      text+='. Ask only if something essential is still missing, then build a day-by-day itinerary.'
    }
    newTripChat(text)
  }
  async function signOut(){
    await state.logout()
    navigate('home')
  }
  async function saveProfile(profile){
    await change(data=>({...data,style:profile.style,profile}))
    setModal(null)
    message('Travel profile saved.')
  }
  async function saveDraft(next, {stayInChat=false,silent=false,requirePersistence=false}={}){
    const persisted=change(data=>({...data,drafts:[next,...data.drafts.filter(item=>item.id!==next.id)].slice(0,25)}))
    if(requirePersistence&&!(await persisted))throw new Error('The trip could not be saved. Keep this chat open and try again.')
    if(!silent)message('Itinerary saved in My Trips.')
    if(!stayInChat)navigate('draft/'+next.id)
  }
  function toggleSaved(id){
    if(mustSignIn&&!user){signInTarget.current='saved';navigate('signin');return}
    const exists=library.saved.includes(id)
    change(data=>({...data,saved:exists?data.saved.filter(value=>value!==id):[...data.saved,id]}))
    message(exists?'Removed from saved places.':'Saved to your places.')
  }
  function updateTrip(next){
    if(trip?.id===next.id)setHistories(items=>{
      const prior=items[trip.id]||{past:[],future:[]}
      return {...items,[trip.id]:{past:[...prior.past,trip].slice(-20),future:[]}}
    })
    replaceTrip(next)
  }
  function replaceTrip(next){
    change(data=>({...data,trips:data.trips.map(item=>item.id===next.id?{...next,updated:Date.now()}:item)}))
  }
  function restore(direction){
    const undo=direction==='undo'
    const next=undo?history.past.at(-1):history.future[0]
    if(!next)return
    setHistories(items=>({...items,[trip.id]:undo?{past:history.past.slice(0,-1),future:[trip,...history.future]}:{past:[...history.past,trip],future:history.future.slice(1)}}))
    replaceTrip(next)
    message(undo?'Change undone.':'Change reapplied.')
  }
  function finishPlan(next,spoken=false){
    if(modal?.editIndex!==undefined&&trip){
      const samePlace=next.brief.destination===trip.brief.destination
      const sameOrigin=next.brief.origin===trip.brief.origin
      if(samePlace){
        const places=new Map(place.places.map(item=>[item.name,item]))
        const samePace=(next.brief.pace||'Balanced')===(trip.brief.pace||'Balanced')&&next.brief.style===trip.brief.style
        next.days=next.days.map((item,index)=>{
          const prior=trip.days[index]
          if(!prior)return item
          const kept=prior.stops.filter(name=>places.has(name)&&allowedStop(places.get(name),next.brief,index))
          const replacements=item.stops.filter(name=>!kept.includes(name)).slice(0,prior.stops.length-kept.length)
          return {stops:[...kept,...replacements],relaxed:samePace?prior.relaxed:item.relaxed}
        })
        next.stay=trip.stay
        next.route=sameOrigin?trip.route:0
        next.findings=trip.findings
        next.sourcedStay=trip.sourcedStay
        const sameParty=next.brief.people===trip.brief.people
        if(sameOrigin&&trip.agentRoute){
          next.agentRoute={...trip.agentRoute,total:Math.round(trip.agentRoute.total*next.brief.people/trip.brief.people)}
          next.agentTransport=next.agentRoute.total
        }
        if(sameParty&&next.brief.days===trip.brief.days&&trip.agentLocal!=null)next.agentLocal=trip.agentLocal
        if(sameParty&&next.brief.days===trip.brief.days&&trip.agentFoodAllowance!=null)next.agentFoodAllowance=trip.agentFoodAllowance
      }
      updateTrip({...next,id:trip.id})
      setModal(null)
      message('Trip brief updated.')
    }else{
      if(library.trips.length>=75){message('Remove a trip before creating another.');return}
      change(data=>({...data,trips:[next,...data.trips]}))
      navigate('trip/'+next.id)
      message('Your trip is ready.')
      if(spoken){
        const summary=next.days.map((day,index)=>'Day '+(index+1)+'. '+(day.stops.length?day.stops.join(', '):'Free time')).join('. ')
        window.setTimeout(()=>speak('Your itinerary is ready. '+summary+'.'),200)
      }
    }
  }
  const common={catalog,library,onSave:toggleSaved,onOpen:place=>setModal({type:'destination',place})}
  const accountControl=<a className="icon-btn account-nav-icon" href="#account" aria-label={user?'Account':'Sign in'} title={user?'Account':'Sign in'}><UserRound size={20}/></a>
  let content
  if(!catalog)content=<div className="page inner-page"><AgentProgress label="Loading your travel workspace"/></div>
  else switch(route.page){
    case 'demo':
      content=<Yatra key={route.id||'demo'} view="itinerary" scenario={route.id} libraryState={state} navigate={navigate}/>;break
    case 'discover':
    case 'hotels':
    case 'stays':
    case 'attractions':
    case 'food':
      content=<WorldSearch key={route.page} initialCategory={route.page==='discover'?'all':route.page} profile={library.profile} onPlan={planWithChat} onSaveDraft={saveDraft}/>;break
    case 'saved':content=<Discover {...common} key="saved" savedOnly onPlan={planWithChat}/>;break
    case 'chat':{
      const contextDraft=library.drafts.find(item=>item.id===route.id)
      const freshSession=route.id?.startsWith('new-')?route.id.slice(4):route.id==='new'?true:false
      const contextId=route.id&&!freshSession&&!contextDraft?route.id:null
      content=<PlanningAgent key={(route.id||'general')+'-'+chatRequest.id} catalog={catalog} initialQuery={(route.id||null)===chatRequest.context||route.id==='new'?chatRequest.query:''}
      newConversation={freshSession} contextId={contextId} contextDraft={contextDraft} contextTrip={library.trips.find(item=>item.id===route.id)} trips={library.trips} drafts={library.drafts} ready={ready} profile={library.profile} onBuild={start}
      onSaveDraft={saveDraft} onOpenDraft={id=>{setChatRequest({query:'',id:0,context:null});navigate('draft/'+id)}} onProfile={()=>setModal({type:'onboarding'})}
      onSave={plan=>{
        change(data=>({...data,trips:[plan,...data.trips.filter(item=>item.id!==plan.id)].slice(0,75)}))
        setActiveTripId(plan.id)
        try{localStorage.setItem('yatra.activeTrip',plan.id)}catch{}
        message('Trip saved to My Trips.')
      }}
      onOpenTrip={id=>navigate('trip/'+id)}/>;break}
    case 'browse':content=<TripDiscovery key={route.id||'browse'} catalog={catalog} initialDestination={route.id} initialCity={browseRequest?.city} tripRequest={browseRequest?.tripRequest} editingDraft={browseRequest?.editingDraft} voice={browseRequest?.voice} voiceSuspended={Boolean(modal)} profile={library.profile} onSaveDraft={saveDraft}/>;break
    case 'desk':content=<div className="page inner-page"><TravelDesk key={route.id||'mobility'} catalog={catalog} profile={library.profile} initialTab={route.id||'mobility'} initialDestination={preferredDestination(library,catalog)}/></div>;break
    case 'trips':content=<><Trips catalog={catalog} library={library} onPlan={newTripChat} onOpen={id=>navigate('trip/'+id)} onDelete={trip=>setModal({type:'delete',trip})} onOpenDraft={id=>navigate('draft/'+id)} onDeleteDraft={draft=>setModal({type:'delete-draft',draft})}/><div className="page"><TripWorkspaceList userId={user?.id} onOpen={id=>navigate('workspace/'+id)}/></div></>;break
    case 'draft':{
      const editDraft=()=>{
        const id='geo:'+draft.cityId
        setBrowseRequest({id,editingDraft:draft})
        navigate('browse/'+id)
      }
      content=draft?<TripOverview key={draft.id+'/'+(route.section||'')} draft={draft} initialSection={route.section} onEdit={editDraft} onAsk={ask} onBack={()=>navigate('trips')}
        onPreferences={next=>saveDraft(next,{stayInChat:true,silent:true})} onSaveDraft={next=>saveDraft(next,{stayInChat:true,silent:true,requirePersistence:true})}/>:<div className="page inner-page"><Empty icon="trip" title="Draft unavailable" description="Open a saved draft from My trips."/></div>;break
    }
    case 'workspace':content=<div className="page inner-page"><TripWorkspace key={route.id} workspaceId={route.id} initialTab="chat"/></div>;break
    case 'join':content=<div className="page inner-page"><TripWorkspace key={route.id} inviteCode={route.id} onJoined={id=>navigate('workspace/'+id)}/></div>;break
    case 'itinerary':
    case 'budget':
    case 'trip':content=!ready?<div className="page inner-page" role="status">Loading your saved trip...</div>:trip&&place?<Trip key={trip.id} view={route.page==='budget'?'budget':'itinerary'} trip={trip} place={place} profile={library.profile} onUpdate={updateTrip} onEdit={editIndex=>setModal({type:'plan',initial:trip.brief,editIndex})} onMessage={message} history={history} onUndo={()=>restore('undo')} onRedo={()=>restore('redo')}/>:<div className="page inner-page"><Empty title="Trip unavailable" description="Create and save a trip in chat, then its itinerary and budget will appear here." action={<Button onClick={()=>newTripChat()}>Create a trip</Button>}/></div>;break
    case 'guide':content=<DestinationGuide key={route.id||'overview'} catalog={catalog} initialTopic={route.id} profile={library.profile}
      initialDestination={homeDestination||catalog.find(item=>library.saved.includes(item.id))?.id} onPlan={planWithChat} onAsk={ask}/>;break
    case 'account':
    case 'preferences':content=<Preferences key={route.page} initialTab={route.page==='account'?'account':'travel'} user={user} theme={theme} onThemeChange={changeTheme} style={library.profile?.style||library.style} profile={library.profile}
      onIdentity={state.updateIdentity} onSignOut={signOut} onEditProfile={()=>{if(mustSignIn&&!user)requireSignIn('preferences');else setModal({type:'onboarding'})}}
      onResetProfile={()=>setModal({type:'clear-profile'})} onChange={style=>{if(mustSignIn&&!user){requireSignIn('preferences');return}change(data=>({...data,style,profile:data.profile?{...data.profile,style}:null}));message('Travel style saved.')}} onAccount={()=>requireSignIn('account')}/>;break
    default:content=<Home catalog={catalog} library={user||!mustSignIn?library:{trips:[],drafts:[],profile:null}} destination={homeDestination} onPlan={planWithChat} onAsk={ask} onNavigate={navigate} onResearch={topic=>navigate('guide/'+topic)}
      onRequireAccount={mustSignIn&&!user?()=>requireSignIn('saved'):undefined}/>
  }
  const close=()=>setModal(null)
  function requireSignIn(target) {
    signInTarget.current=target
    navigate('signin')
  }
  if((!ready&&!guestPages.has(route.page))||restricted)return <main className="google-entry"><section className="panel google-entry-card session-loading">
    <div className="session-loading-status" role="status"><TravelArtwork name="transport-plane" animated width={126} height={96}/><span>Checking your YatraBuddy session…</span></div>
    <Button variant="text-btn" icon="back" onClick={()=>navigate('home')}>Back to Home</Button></section></main>
  if(route.page==='signin')return <Account page required={mustSignIn} onClose={()=>{signInTarget.current='home';navigate('home')}} onLogin={async account=>{
    await state.login(account,{mergeGuest:false})
    const target=signInTarget.current
    signInTarget.current='home'
    navigate(target)
  }}/>
  if(mustSignIn&&!guestPages.has(route.page)&&route.page!=='account'&&needsOnboarding(user,library,profileReady))return <OnboardingChat name={user.name} initial={{style:library.style||'Balanced'}} onDone={saveProfile} onSignOut={signOut}/>
  return <div className={'app-layout travel-shell '+(expanded?'nav-expanded':'compact-nav')}>
    <a className="skip" href="#main" onClick={event=>{event.preventDefault();document.getElementById('main')?.focus()}}>Skip to content</a>
    {menu&&<button className="scrim" aria-label="Close menu" onClick={()=>setMenu(false)}/>}
    <aside id="primary-navigation" className={'sidebar '+(menu?'open':'')}
      onPointerEnter={event=>{if(event.pointerType==='mouse')setNavHover(true)}} onPointerLeave={()=>setNavHover(false)}
      onFocus={event=>{if(event.target.matches(':focus-visible'))setNavFocus(true)}}
      onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setNavFocus(false)}}
      onKeyDown={event=>{if(event.key==='Escape'){
        setNavHover(false);setNavFocus(false);setMenu(false)
        if(menu)mobileNav.current?.focus()
      }}}><div className="sidebar-heading">
      <a className="brand" href="#home" aria-label="YatraBuddy home"><Brand/></a>
    </div>
      <nav aria-label="Workspace">{pages.map(([id,icon,label])=>{
        const active=route.page===id||(['draft','browse','trip','itinerary','budget','workspace','join'].includes(route.page)&&id==='trips')||(['hotels','stays','food','attractions'].includes(route.page)&&id==='discover')
        const href='#'+id
        const tripCount=library.trips.length+library.drafts.length
        return <a key={id} href={href} className={'nav-item '+(active?'active':'')} aria-label={label} title={label} aria-current={active?'page':undefined}><Icon name={icon}/> <span className="nav-title">{label}</span>{id==='trips'&&tripCount>0&&<small>{tripCount}</small>}</a>
      })}</nav>
      <div className="side-bottom"><Button className="workspace-new-chat" icon="plus" aria-label="New chat" onClick={()=>newTripChat()}>New chat</Button>
        <button type="button" className="nav-item theme-control" onClick={()=>changeTheme(theme==='system'?(resolvedTheme==='dark'?'light':'dark'):theme==='dark'?'light':'dark')} aria-label={resolvedTheme==='dark'?'Switch to light mode':'Switch to dark mode'}>
          <span aria-hidden="true">{resolvedTheme==='dark'?'☀':'☾'}</span><span className="nav-title">{resolvedTheme==='dark'?'Light mode':'Dark mode'}</span>
        </button>
        <a href="#preferences" aria-label="Preferences" title="Preferences" className={'nav-item '+(route.page==='preferences'?'active':'')}><Icon name="settings"/> <span className="nav-title">Preferences</span></a><div className="side-utilities">{accountControl}</div></div>
    </aside>
    <div className={'shell'+(route.page==='chat'&&catalog?' chat-shell':'')+(draft?' draft-shell':'')}>
    <nav className="mobile-workspace-dock" aria-label="Quick navigation">
      <a href="#home" aria-label="Home" aria-current={route.page==='home'?'page':undefined}><Icon name="home"/></a>
      <a href="#chat" aria-label="Chats" aria-current={route.page==='chat'?'page':undefined}><Icon name="chat"/></a>
      <a href="#trips" aria-label="My trips" aria-current={['trips','trip','draft','itinerary','budget'].includes(route.page)?'page':undefined}><Icon name="trip"/></a>
      <a href="#saved" aria-label="Saved" aria-current={route.page==='saved'?'page':undefined}><Icon name="heart"/></a>
      <button ref={mobileNav} type="button" className="icon-btn" aria-label="More navigation" aria-expanded={menu}
        aria-controls="primary-navigation" onClick={()=>setMenu(value=>!value)}>•••</button>
    </nav>
    {(state.status||loadError)&&<div className="sync-notice" role="status">{state.status||loadError}</div>}
    <main id="main" tabIndex={-1}>{trip&&<div className="page trip-workspace-nav"><label>Working on<select aria-label="Active trip" value={trip.id} onChange={event=>navigate((route.page==='budget'?'budget':'itinerary')+'/'+event.target.value)}>{library.trips.map(item=><option key={item.id} value={item.id}>{catalog?.find(place=>place.id===item.brief.destination)?.name||item.brief.destination} · {item.brief.days} days · {item.brief.people} travellers</option>)}</select></label><nav aria-label="Active trip views"><Button variant={route.page!=='budget'?'primary':'outline'} onClick={()=>navigate('itinerary/'+trip.id)}>Itinerary & map</Button><Button variant={route.page==='budget'?'primary':'outline'} onClick={()=>navigate('budget/'+trip.id)}>Budget</Button><Button icon="chat" onClick={()=>navigate('chat/'+trip.id)}>Discuss this trip</Button></nav></div>}<Suspense fallback={<div className="page inner-page"><AgentProgress label="Opening"/></div>}>{content}</Suspense></main></div>
    {modal?.type==='buddy'&&<Buddy catalog={catalog} profile={library.profile} defaultDestination={preferredDestination(library,catalog)} trip={trip} onClose={close} onPlan={planWithChat} onDesk={()=>navigate('desk')} onTrip={close} reminders={reminders}/>}
    {modal?.type==='account'&&<Account user={user} onClose={close} onLogin={async (user,isNew,welcomeEmail)=>{await state.login(user);setModal(isNew?{type:'onboarding'}:null);message(welcomeEmail==='scheduled'?'Account created. Check your inbox shortly.':welcomeEmail==='unavailable'?'Account created. Email delivery is unavailable.':'Signed in.')}} onLogout={async()=>{try{await state.logout();navigate('home');message('Signed out.')}catch(error){message(error.message)}}}/>}
    {modal?.type==='onboarding'&&<ProfileWizard name={user?.name} catalog={catalog||[]} isEditing={Boolean(library.profile)} initial={{style:library.style||'Balanced',...library.profile}} onClose={close} onDone={profile=>{change(data=>({...data,style:profile.style,profile}));close();message('Travel profile saved.')}}/>}
    {modal?.type==='clear-profile'&&<Dialog onClose={close} label="Clear travel profile"><div className="dialog-content"><h2>Clear your travel profile?</h2><p>Wayfarer will use the standard defaults for new trips.</p><div className="dialog-buttons"><Button onClick={close}>Cancel</Button><Button variant="danger" onClick={()=>{change(data=>({...data,style:'',profile:null}));close();message('Travel profile cleared.')}}>Clear profile</Button></div></div></Dialog>}
    {modal?.type==='plan'&&<TripBrief catalog={catalog} initial={modal.initial} query={modal.query} editIndex={modal.editIndex} selection={modal.selection} voice={modal.voice} onClose={close} onDone={finishPlan}/>}
    {modal?.type==='destination'&&<Dialog onClose={close} label={modal.place.name} className="destination-modal">
      <div className="destination-modal-image"><img src={'/images/'+modal.place.image+'.jpg'} alt=""/></div><div className="dialog-content"><div className="eyebrow"><span/> {modal.place.region.toUpperCase()}</div><h2>{modal.place.name}</h2><p>{modal.place.tagline}. Typical visiting season {modal.place.season}.</p><h3>Highlights</h3><ul className="highlight-list">{modal.place.places.slice(0,4).map(item=><li key={item.name}><Icon name="pin" size={15}/> {item.name}</li>)}</ul><div className="dialog-buttons"><Button variant="primary" icon="chat" onClick={()=>planWithChat('',modal.place.id,modal.place)}>Plan in chat</Button><Button icon="heart" onClick={()=>toggleSaved(modal.place.id)}>{library.saved.includes(modal.place.id)?'Unsave':'Save'}</Button></div></div></Dialog>}
    {modal?.type==='delete'&&<Dialog onClose={close} label="Delete trip"><div className="dialog-content"><h2>Delete this trip?</h2><p>This itinerary will be removed from your library.</p><div className="dialog-buttons"><Button onClick={close}>Cancel</Button><Button variant="danger" icon="trash" onClick={()=>{change(data=>({...data,trips:data.trips.filter(item=>item.id!==modal.trip.id)}));close();message('Trip deleted.')}}>Delete trip</Button></div></div></Dialog>}
    {modal?.type==='delete-draft'&&<Dialog onClose={close} label="Delete draft"><div className="dialog-content"><h2>Delete this draft?</h2><p>{modal.draft.name} will be removed from My trips.</p><div className="dialog-buttons"><Button onClick={close}>Cancel</Button><Button variant="danger" icon="trash" onClick={()=>{change(data=>({...data,drafts:data.drafts.filter(item=>item.id!==modal.draft.id)}));close();message('Draft deleted.')}}>Delete draft</Button></div></div></Dialog>}
    <div id="toast" className={notice?'shown':''} role="status" aria-live="polite">{notice&&<><Icon name="info"/> {notice.value}</>}</div>
  </div>
}
