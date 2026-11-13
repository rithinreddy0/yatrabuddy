import {useEffect,useRef,useState} from 'react'
import {request} from '../api.mjs'

const blank=()=>({trips:[],drafts:[],saved:[],style:'',profile:null,sampleExpenses:[]})
function read(key) {
  try {return {...blank(),...JSON.parse(localStorage.getItem(key))}} catch {return blank()}
}
function write(key,data) {
  try {localStorage.setItem(key,JSON.stringify(data));return true} catch {return false}
}
const guestKey='wayfarer.guest.v2'
export function useLibrary() {
  const [user,setUser]=useState(null)
  const [library,setLibrary]=useState(()=>read(guestKey))
  const [status,setStatus]=useState('')
  const [ready,setReady]=useState(false)
  const account=useRef(null)
  const data=useRef(library)
  const revision=useRef(0)
  const queue=useRef(Promise.resolve())

  async function load(user,mergeGuest,mergeProfile=true) {
    const remote=await request('library')
    let next=remote.library
    if(mergeGuest){
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
    revision.current=remote.revision
    account.current=user
    data.current=next
    setLibrary(next)
    setUser(user)
    setStatus('')
    if(mergeGuest) await save(next)
  }

  function save(next) {
    data.current=next
    setLibrary(next)
    const active=account.current
    const localSaved=write(active?'wayfarer.account.'+active.id:guestKey,next)
    if(!active){if(!localSaved)setStatus('Browser storage is unavailable.');return Promise.resolve()}
    queue.current=queue.current.catch(()=>{}).then(async()=>{
      try {
        const result=await request('library',{method:'PUT',body:{revision:revision.current,library:next}})
        revision.current=result.revision
        setStatus('')
      }catch(error){setStatus(error.message+(localSaved?' A copy remains on this device.':''))}
    })
    return queue.current
  }

  useEffect(()=>{
    request('session').then(({user})=>user&&load(user,false)).catch(error=>setStatus(error.message)).finally(()=>setReady(true))
  },[])
  async function logout(){
    await queue.current
    await request('logout',{method:'POST'})
    account.current=null
    setUser(null)
    data.current=read(guestKey)
    setLibrary(data.current)
    setStatus('')
  }
  return {user,library,ready,status,login:(user,options)=>load(user,options?.mergeGuest!==false,options?.mergeProfile!==false),logout,change:callback=>save(callback(data.current))}
}
