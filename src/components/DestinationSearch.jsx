import React,{useEffect,useId,useRef,useState} from 'react'
import {request} from '../api.mjs'
import {Icon} from './UI.jsx'

function localOption(place){
  return {id:place.id,name:place.name,region:place.region}
}

export function DestinationSearch({catalog,selected,onSelect,global=false,disabled=false,label='Destination',placeholder='Search a city or destination',inputValue,onInputChange,maxLength}){
  const id=useId()
  const root=useRef(null)
  const [query,setQuery]=useState('')
  const [open,setOpen]=useState(false)
  const [active,setActive]=useState(-1)
  const [remote,setRemote]=useState({query:'',items:[],status:'idle'})
  const freeText=typeof onInputChange==='function'
  const term=(freeText?inputValue:query).trim()
  const showPopover=open&&(!freeText||term.length>=2)
  const local=catalog.filter(place=>[place.name,place.region].join(' ').toLowerCase().includes(term.toLowerCase())).map(localOption)
  const results=[...local,...(remote.query===term&&global?remote.items:[])]
  useEffect(()=>{
    if(!global||!open||term.length<2)return
    const controller=new AbortController()
    const timer=setTimeout(async()=>{
      setRemote({query:term,items:[],status:'loading'})
      try{
        const matches=await request('locations?q='+encodeURIComponent(term),{signal:controller.signal})
        if(controller.signal.aborted)return
        setRemote({query:term,status:'ready',items:matches.map(place=>({...place,id:'geo:'+place.id,region:[...new Set([place.region,place.country].filter(Boolean))].join(', ')}))})
      }catch{
        if(!controller.signal.aborted)setRemote({query:term,items:[],status:'unavailable'})
      }
    },360)
    return ()=>{clearTimeout(timer);controller.abort()}
  },[global,open,term])

  function choose(place){
    onSelect(place)
    setQuery('')
    setActive(-1)
    setOpen(false)
  }

  function keyboard(event){
    if(event.key==='Escape'&&showPopover){
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
      return
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault()
      setOpen(true)
      if(results.length)setActive(index=>event.key==='ArrowDown'?(index+1)%results.length:index<=0?results.length-1:index-1)
    }
    if(event.key==='Enter'&&showPopover){
      event.preventDefault()
      const match=results[active]||(!freeText?results[0]:null)
      if(match)choose(match)
      else if(freeText)setOpen(false)
    }
  }

  return <div className="destination-search" ref={root} onBlur={event=>{if(!root.current.contains(event.relatedTarget))setOpen(false)}}>
    <label htmlFor={id}>{label}</label>
    <div className="destination-search-input">
      <Icon name="pin" size={16}/>
      <input id={id} role="combobox" autoComplete="off" aria-expanded={showPopover} aria-autocomplete="list" aria-controls={showPopover?id+'-results':undefined}
        aria-activedescendant={showPopover&&results[active]?id+'-option-'+active:undefined}
        value={freeText?inputValue:open?query:selected?.name||''} placeholder={placeholder} disabled={disabled} maxLength={maxLength}
        onFocus={()=>{setOpen(true);setQuery('');setActive(-1)}} onClick={()=>setOpen(true)}
        onChange={event=>{setOpen(true);(freeText?onInputChange:setQuery)(event.target.value);setActive(-1)}} onKeyDown={keyboard}/>
      <Icon name="search" size={15}/>
    </div>
    {showPopover&&<div className="destination-popover">
      <ul id={id+'-results'} role="listbox" aria-label={label+' suggestions'}>
        {results.map((place,index)=><li id={id+'-option-'+index} key={place.id} role="option" aria-selected={index===active}
          onPointerDown={event=>event.preventDefault()} onClick={()=>choose(place)}>
          <Icon name="pin" size={16}/><span><strong>{place.name}</strong><small>{place.region}</small></span>{place.id.startsWith('geo:')&&<small className="destination-global">Worldwide</small>}
        </li>)}
      </ul>
      {global&&term.length>=2&&(remote.query!==term||remote.status==='loading')&&<p role="status">Searching worldwide…</p>}
      {global&&term.length>=2&&remote.query===term&&remote.status==='unavailable'&&<p role="status">Worldwide search is unavailable.</p>}
      {!results.length&&(!global||(remote.query===term&&remote.status==='ready'))&&<p role="status">No matching destinations. Try a city name.</p>}
    </div>}
  </div>
}
