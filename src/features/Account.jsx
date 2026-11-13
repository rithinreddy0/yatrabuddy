import React, {useEffect,useState} from 'react'
import {AgentProgress,Brand,Button,Dialog,Pill} from '../components/UI.jsx'
import {request} from '../api.mjs'
import {money} from '../planner.mjs'

export const styles=['Balanced','Nature','Culture','Food','Adventure','Relaxed']

async function loadGoogle(config) {
  const [{getApps,initializeApp},sdk]=await Promise.all([import('@firebase/app'),import('@firebase/auth')])
  const existing=getApps().find(app=>app.name==='wayfarer')
  const app=existing||initializeApp(config,'wayfarer')
  const auth=existing?sdk.getAuth(app):sdk.initializeAuth(app,{
    persistence:sdk.inMemoryPersistence,
    popupRedirectResolver:sdk.browserPopupRedirectResolver,
  })
  await auth.authStateReady()
  const provider=new sdk.GoogleAuthProvider()
  provider.setCustomParameters({prompt:'select_account'})
  return {auth,provider,signInWithPopup:sdk.signInWithPopup,signOut:sdk.signOut}
}

const googleErrors={
  'auth/popup-closed-by-user':'The Google sign-in window was closed. Try again when you’re ready.',
  'auth/popup-blocked':'Your browser blocked the Google sign-in window. Allow pop-ups for Wayfarer and try again.',
  'auth/unauthorized-domain':'This address needs to be added to Firebase’s authorized domains for Google sign-in.',
  'auth/operation-not-allowed':'Google sign-in needs to be enabled in Firebase Authentication.',
  'auth/network-request-failed':'Google could not be reached. Check your connection and try again.',
  'auth/account-exists-with-different-credential':'Sign in with the method originally used for this email address.',
}

export function Account({user,onClose,onLogin,onLogout,required=false}) {
  const [register,setRegister]=useState(false)
  const [pending,setPending]=useState(null)
  const [error,setError]=useState('')
  const [googleState,setGoogleState]=useState({status:'loading'})
  const [configRetry,setConfigRetry]=useState(0)
  useEffect(()=>{
    if(user)return
    const controller=new AbortController()
    setGoogleState({status:'loading'})
    async function prepare() {
      try {
        const {firebase}=await request('auth/config',{signal:controller.signal})
        const provider=firebase?await loadGoogle(firebase):null
        if(!controller.signal.aborted)setGoogleState(provider?{status:'ready',provider}:{status:'unconfigured'})
      } catch {
        if(!controller.signal.aborted)setGoogleState({status:'failed'})
      }
    }
    prepare()
    return ()=>controller.abort()
  },[user,configRetry])
  async function submit(event) {
    event.preventDefault()
    const body=Object.fromEntries(new FormData(event.currentTarget))
    setPending('email')
    setError('')
    try {const data=await request(register?'register':'login',{method:'POST',body});await onLogin(data.user,register,data.welcomeEmail)}
    catch(error){setError(error.message)}
    finally{setPending(null)}
  }
  async function google() {
    if(googleState.status!=='ready')return
    const {auth,provider,signInWithPopup,signOut}=googleState.provider
    setPending('google')
    setError('')
    try {
      const credential=await signInWithPopup(auth,provider)
      let data
      try {
        const token=await credential.user.getIdToken()
        data=await request('auth/firebase',{method:'POST',body:{token}})
      } finally {
        await signOut(auth).catch(()=>{})
      }
      await onLogin(data.user,data.newAccount)
    }catch(error){
      setError(error.status?error.message:googleErrors[error.code]||'Google sign-in could not finish. Try again.')
    }finally{setPending(null)}
  }
  const googleMessage={
    loading:'Checking Google sign-in…',
    unconfigured:'Google sign-in has not been configured for this deployment.',
    failed:'Google sign-in could not load.',
    ready:required?'Sign in to open your private travel workspace.':'or continue with email',
  }[googleState.status]
  const panel=<div className="dialog-content">
    {user?<><h2>{user.name}</h2><p>{user.email}</p><Button icon="logout" onClick={()=>onLogout()}>Sign out</Button></>:<>
      <div className="auth-brand"><Brand/></div><h2>{required?'Start your next trip':register?'Create your account':'Welcome back'}</h2><p>{required?'Sign in to plan trips, keep your places, and travel together.':'Sync your trips and saved places across devices.'}</p>
      <div className="social-login">
        <Button className="full" onClick={google} disabled={Boolean(pending)||googleState.status!=='ready'} aria-describedby="google-signin-status">
          <span className="google-letter" aria-hidden="true">G</span> {pending==='google'?'Signing in with Google…':'Continue with Google'}
        </Button>
        <span id="google-signin-status" role="status">{googleMessage}</span>
        {googleState.status==='failed'&&<Button variant="text-btn" onClick={()=>setConfigRetry(value=>value+1)}>Retry Google sign-in</Button>}
      </div>
      {error&&required&&<p className="form-error" role="alert">{error}</p>}
      {!required&&<><form className="stack" key={String(register)} onSubmit={submit}>
        {register&&<label>Name<input name="name" autoComplete="name" maxLength={70} required/></label>}
        <label>Email<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>
        <label>Password<input name="password" type="password" minLength={8} maxLength={128} autoComplete={register?'new-password':'current-password'} required/></label>
        {error&&<p className="form-error" role="alert">{error}</p>}
        {pending==='email'&&<AgentProgress label={register?'Creating your account':'Signing you in'}/>}
        <Button type="submit" variant="primary" disabled={Boolean(pending)}>{pending==='email'?'Please wait…':register?'Create account':'Sign in'}</Button>
      </form>
      <Button variant="text-btn" disabled={Boolean(pending)} onClick={()=>{setRegister(value=>!value);setError('')}}>{register?'Sign in instead':'Create an account'}</Button></>}
    </>}
  </div>
  if(required)return <main className="google-entry"><section className="panel google-entry-card" aria-label="Sign in to YatraBuddy">{panel}</section></main>
  return <Dialog onClose={onClose} label="YatraBuddy account">{panel}</Dialog>
}
export function Preferences({style,onChange,user,onAccount,profile,onEditProfile,onResetProfile}) {
  const details=profile?[
    ['Preferred name',profile.preferredName],['Departure city',profile.homeCity],
    ['Travel group',profile.travelGroup==='Any'?'It varies':profile.travelGroup],['Group size',profile.travelers],
    ['Trip length',profile.tripDays===1?'1 day':profile.tripDays+' days'],['Typical group budget',money(profile.budget)],
    ['Accommodation',profile.stayPreferences?.join(', ')],['Food',profile.diet],
    ['Pace',profile.pace],['Transport',profile.transport],['Mobility',profile.mobility],
    ['Interests',profile.interests.join(', ')],['Trip notes',profile.notes],
  ].filter(([,value])=>value):[]
  return <div className="page inner-page"><h1>Preferences</h1><p className="lede">YatraBuddy uses your preferences to tailor trip ideas and activities.</p>
    <section className="panel preference-panel"><h2>Travel profile</h2>
      {profile?<dl className="profile-preview">{details.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>:<p className="lede">Save the preferences you usually plan around, including your departure city, budget, and interests.</p>}
      <div className="dialog-buttons"><Button variant="primary" icon="edit" onClick={onEditProfile}>{profile?'Edit travel profile':'Set up my profile'}</Button>{profile&&<Button onClick={onResetProfile}>Clear profile</Button>}</div>
    </section>
    <section className="panel preference-panel"><h2>Travel style</h2><div className="filters">{styles.map(item=><Pill key={item} active={(style||'Balanced')===item} onClick={()=>onChange(item)}>{item}</Pill>)}</div></section><Button onClick={onAccount}>{user?'Manage account':'Sign in to sync'}</Button></div>
}
