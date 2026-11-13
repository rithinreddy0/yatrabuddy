import {useEffect,useRef,useState} from 'react'
import {request} from '../api.mjs'

const blank=()=>({trips:[],drafts:[],saved:[],style:'',profile:null,sampleExpenses:[]})
function read(key) {
  try {return {...blank(),...JSON.parse(localStorage.getItem(key))}} catch {return blank()}
}
function write(key,data) {
  try {localStorage.setItem(key,JSON.stringify(data));return true} catch {return false}
}
function cacheMeta(userId) {
  try {return JSON.parse(localStorage.getItem('wayfarer.account-meta.'+userId))||{}} catch {return {}}
}
function writeCacheMeta(userId,value) {
  try {localStorage.setItem('wayfarer.account-meta.'+userId,JSON.stringify(value));return true} catch {return false}
}
function recoveryPrefix(userId) {
  return 'wayfarer.account.unsynced-v1.'+encodeURIComponent(String(userId))+'.'
}
export function readRecoveryBackups(userId) {
  const prefix=recoveryPrefix(userId)
  const backups=[]
  try {
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index)
      if(!key?.startsWith(prefix))continue
      try {
        const value=JSON.parse(localStorage.getItem(key))
        if(value?.version===1&&Number.isInteger(value.baseRevision)&&value.library&&typeof value.library==='object'){
          backups.push({...value,key})
        }
      } catch {}
    }
  } catch {}
  try {
    // Preserve conflict snapshots written by earlier builds, which did not include a revision.
    const legacyKey='wayfarer.account.unsynced.'+userId
    const legacy=JSON.parse(localStorage.getItem(legacyKey))
    if(legacy&&typeof legacy==='object'&&Array.isArray(legacy.trips)){
      backups.push({version:0,baseRevision:null,library:legacy,key:legacyKey})
    }
  } catch {}
  return backups
}
export function writeRecoveryBackup(userId,library,baseRevision,reason='offline-change') {
  const revision=Number.isInteger(baseRevision)?baseRevision:0
  const backups=readRecoveryBackups(userId)
  if(backups.some(item=>item.baseRevision===revision&&sameLibrary(item.library,library)))return true
  const entry={version:1,baseRevision:revision,reason,createdAt:Date.now(),library}
  try {
    const baseKey=recoveryPrefix(userId)+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)
    let key=baseKey
    let suffix=0
    while(localStorage.getItem(key)!==null)key=baseKey+'-'+(++suffix)
    localStorage.setItem(key,JSON.stringify(entry))
    return true
  } catch {return false}
}
export function markLibraryDirty(userId,library,baseRevision,localSaved) {
  if(!localSaved)return false
  if(writeCacheMeta(userId,{revision:baseRevision,dirty:true}))return true
  return writeRecoveryBackup(userId,library,baseRevision,'dirty-marker-unavailable')
}
function removeRecoveryBackup(key) {
  try {localStorage.removeItem(key)} catch {}
}
function serializeLibrary(value) {
  const stable=value=>Array.isArray(value)?value.map(stable)
    :value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
  return JSON.stringify(stable(value))
}
function sameLibrary(first,second) {
  return serializeLibrary(first)===serializeLibrary(second)
}
const guestKey='wayfarer.guest.v2'
export function useLibrary() {
  const [user,setUser]=useState(null)
  const [library,setLibrary]=useState(()=>read(guestKey))
  const [status,setStatus]=useState('')
  const [ready,setReady]=useState(false)
  const [profileReady,setProfileReady]=useState(false)
  const account=useRef(null)
  const data=useRef(library)
  const revision=useRef(0)
  const queue=useRef(Promise.resolve())
  const syncReady=useRef(false)

  async function load(user,mergeGuest,mergeProfile=true) {
    let remote
    try {
      remote=await request('library')
    } catch(error) {
      const key='wayfarer.account.'+user.id
      const meta=cacheMeta(user.id)
      let cached=blank()
      let hasCache=false
      try {
        hasCache=localStorage.getItem(key)!==null
        if(hasCache)cached=read(key)
      } catch {}
      revision.current=Number.isInteger(meta.revision)?meta.revision:0
      account.current=user
      syncReady.current=false
      data.current=cached
      setLibrary(cached)
      setUser(user)
      setProfileReady(Boolean(cached.profile))
      setStatus(error.message+(hasCache
        ?' Showing your saved device copy; changes will stay on this device until syncing is restored.'
        :' Your signed-in workspace is open, but saved data could not be loaded.'))
      return
    }
    let next=remote.library
    const key='wayfarer.account.'+user.id
    const meta=cacheMeta(user.id)
    let offlineChanges=false
    let cacheConflict=false
    let cacheBackupFailed=false
    const recoveryBackups=readRecoveryBackups(user.id)
    for(const backup of recoveryBackups){
      if(sameLibrary(backup.library,remote.library))removeRecoveryBackup(backup.key)
    }
    if(meta.dirty){
      const cached=read(key)
      if(sameLibrary(cached,remote.library)){
        writeCacheMeta(user.id,{revision:remote.revision,dirty:false})
      }else if(meta.revision===remote.revision){
        next=cached
        offlineChanges=true
      }else{
        cacheConflict=true
        cacheBackupFailed=!writeRecoveryBackup(user.id,cached,meta.revision,'revision-conflict')
        if(cacheBackupFailed)next={...cached,profile:cached.profile||remote.library.profile}
      }
    }
    const pendingBackups=recoveryBackups.filter(item=>!sameLibrary(item.library,remote.library)&&item.baseRevision===remote.revision)
    const conflictingBackups=recoveryBackups.filter(item=>!sameLibrary(item.library,remote.library)&&item.baseRevision!==remote.revision)
    let backupConflict=conflictingBackups.length>0
    if(!cacheConflict&&pendingBackups.length){
      const unique=new Map(pendingBackups.map(item=>[serializeLibrary(item.library),item]))
      if(offlineChanges){
        if([...unique.keys()].some(serialized=>serialized!==JSON.stringify(next)))backupConflict=true
      }else if(unique.size===1){
        next=[...unique.values()][0].library
        offlineChanges=true
      }else backupConflict=true
    }
    if(mergeGuest&&!cacheConflict){
      const guest=read(guestKey)
      const remoteIds=new Set(next.trips.map(trip=>trip.id))
      const draftIds=new Set(next.drafts.map(draft=>draft.id))
      next={
        trips:[...next.trips,...guest.trips.filter(trip=>!remoteIds.has(trip.id))].slice(0,75),
        drafts:[...next.drafts,...guest.drafts.filter(draft=>!draftIds.has(draft.id))].slice(0,25),
        saved:[...new Set([...next.saved,...guest.saved])],
        style:next.style||guest.style,
        profile:next.profile||(mergeProfile?guest.profile:null)||null,
        sampleExpenses:[...new Map([...(next.sampleExpenses||[]),...guest.sampleExpenses]
          .map(expense=>[JSON.stringify(expense),expense])).values()].slice(0,100),
      }
    }
    revision.current=cacheBackupFailed?(Number.isInteger(meta.revision)?meta.revision:0):remote.revision
    account.current=user
    syncReady.current=!cacheBackupFailed
    data.current=next
    setLibrary(next)
    setUser(user)
    setProfileReady(true)
    if(cacheConflict){
      if(!cacheBackupFailed){
        write(key,next)
        writeCacheMeta(user.id,{revision:remote.revision,dirty:false})
        setStatus('Your account changed elsewhere while this device was offline. A copy of its unsynced data was kept on this device.')
      }else{
        setStatus('Your account changed elsewhere while this device was offline. Showing the device copy because it could not be backed up for sync.')
      }
    }else{
      write(key,next)
      if(!offlineChanges)writeCacheMeta(user.id,{revision:remote.revision,dirty:false})
      setStatus(backupConflict?'Some unsynced changes from this device could not be merged automatically. A recovery copy is kept on this device.':'')
      if(mergeGuest||offlineChanges)await save(next)
    }
  }

  function save(next) {
    data.current=next
    setLibrary(next)
    const active=account.current
    const cacheKey=active?'wayfarer.account.'+active.id:guestKey
    const localSaved=write(cacheKey,next)
    if(next.profile)setProfileReady(true)
    if(!active){if(!localSaved)setStatus('Browser storage is unavailable.');return Promise.resolve(localSaved)}
    if(!syncReady.current){
      const queued=markLibraryDirty(active.id,next,revision.current,localSaved)
      setStatus(queued?'Saved on this device. Reconnect to sync your library.'
        :localSaved?'Saved on this device, but automatic sync could not be queued.':'Browser storage is unavailable; this change could not be saved offline.')
      return Promise.resolve(localSaved)
    }
    const baseRevision=revision.current
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      if(!syncReady.current){
        const queued=markLibraryDirty(active.id,next,baseRevision,localSaved)
        setStatus(queued?'Saved on this device. Reconnect to sync your library.'
          :localSaved?'Saved on this device, but automatic sync could not be queued.':'Browser storage is unavailable; this change could not be saved offline.')
        return localSaved
      }
      try {
        const result=await request('library',{method:'PUT',body:{revision:revision.current,library:next}})
        revision.current=result.revision
        writeCacheMeta(active.id,{revision:result.revision,dirty:false})
        setStatus('')
        return true
      }catch(error){
        syncReady.current=false
        const queued=markLibraryDirty(active.id,next,baseRevision,localSaved)
        setStatus(error.message+(queued?' A copy remains on this device and will sync when the connection recovers.'
          :localSaved?' A copy remains on this device, but automatic sync could not be queued.':''))
        return localSaved
      }
    })
    return queue.current
  }

  useEffect(()=>{
    request('session').then(({user})=>user&&load(user,false)).catch(error=>setStatus(error.message)).finally(()=>setReady(true))
  },[])
  useEffect(()=>{
    const retry=()=>{if(account.current)load(account.current,false).catch(error=>setStatus(error.message))}
    window.addEventListener('online',retry)
    return ()=>window.removeEventListener('online',retry)
  },[])
  async function logout(){
    await queue.current
    await request('logout',{method:'POST'})
    account.current=null
    syncReady.current=false
    setUser(null)
    setProfileReady(false)
    revision.current=0
    data.current=read(guestKey)
    setLibrary(data.current)
    setStatus('')
  }
  return {user,library,ready,profileReady,status,login:(user,options)=>load(user,options?.mergeGuest!==false,options?.mergeProfile!==false),logout,change:callback=>save(callback(data.current))}
}
