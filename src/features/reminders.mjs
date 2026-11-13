import {useEffect,useState} from 'react'

const storageKey='wayfarer.reminders.v1'
const numberWords={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,fifteen:15,twenty:20,thirty:30}
export function spokenNumber(value){
  return numberWords[value?.toLowerCase()]||Number(value)
}
export function parseReminder(command){
  const match=command.match(/^remind me\s+(?:to\s+)?(.+?)\s+in\s+(\d+|[a-z]+)\s+(minute|hour|day)s?\.?$/i)
  if(!match)return null
  const amount=spokenNumber(match[2])
  const scale={minute:60_000,hour:3_600_000,day:86_400_000}[match[3].toLowerCase()]
  const delay=amount*scale
  if(!Number.isFinite(delay)||delay<60_000||delay>30*86_400_000)return null
  return {label:match[1].trim().slice(0,180),due:Date.now()+delay}
}
export function speak(text,{onStart,onEnd}={}){
  if(!('speechSynthesis' in window))return
  const utterance=new SpeechSynthesisUtterance(text)
  utterance.lang='en-IN'
  utterance.onstart=onStart||null
  utterance.onend=onEnd||null
  utterance.onerror=onEnd||null
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
}
function readReminders(){
  try{
    const stored=JSON.parse(localStorage.getItem(storageKey)||'[]')
    return Array.isArray(stored)?stored.filter(item=>item?.id&&typeof item.label==='string'&&Number.isFinite(item.due)):[]
  }catch{return []}
}
export function useReminders(onDue){
  const [items,setItems]=useState(readReminders)
  useEffect(()=>{
    try{localStorage.setItem(storageKey,JSON.stringify(items))}catch{}
  },[items])
  useEffect(()=>{
    const next=[...items].sort((a,b)=>a.due-b.due)[0]
    if(!next)return
    const check=()=>{
      const now=Date.now()
      const due=items.filter(item=>item.due<=now)
      if(!due.length)return
      setItems(current=>current.filter(item=>item.due>now))
      onDue(due.map(item=>item.label).join('. '))
    }
    const timer=setInterval(check,1000)
    check()
    return ()=>clearInterval(timer)
  },[items,onDue])
  return {
    items,
    add:item=>setItems(current=>[...current,{...item,id:crypto.randomUUID()}].slice(-25)),
    remove:id=>setItems(current=>current.filter(item=>item.id!==id)),
  }
}
