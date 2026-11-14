import React, {useEffect,useRef} from 'react'
import {icon} from '../icons.mjs'
import {isWikivoyage,visibleSource} from './sourceUrl.mjs'

export function Icon({name,size=19}) {
  return <span className="icon" aria-hidden="true" dangerouslySetInnerHTML={{__html:icon(name,size)}}/>
}
export function Button({icon:name,children,variant='secondary',className='',type='button',...props}) {
  return <button type={type} className={'btn '+variant+' '+className} {...props}>{name&&<Icon name={name} size={17}/>} {children}</button>
}
export function IconButton({icon:name,label,className='',...props}) {
  return <button type="button" className={'icon-btn '+className} aria-label={label} title={label} {...props}><Icon name={name}/></button>
}
export function Pill({icon:name,active,children,...props}) {
  return <button type="button" className={'pill '+(active?'on':'')} aria-pressed={active} {...props}>{name&&<Icon name={name} size={15}/>} {children}</button>
}
export function Brand() {
  return <><span className="brand-mark brand-art"><img src="/images/brand/yatrabuddy.svg" alt="" width="37" height="37"/></span><span>YatraBuddy</span></>
}
export function TravelArtwork({name, animated=false, className='', width, height}) {
  const base = '/images/brand/' + name
  return <picture className={'travel-artwork ' + className}>
    {animated && <source media="(prefers-reduced-motion: no-preference)" srcSet={base + '-motion.webp'}/>}
    <img src={base + '.webp'} alt="" width={width} height={height} decoding="async"/>
  </picture>
}
export function Dialog({children,onClose,className='',label}) {
  const ref=useRef(null)
  useEffect(()=>{
    const node=ref.current
    node.showModal()
    return ()=>node.close()
  },[])
  return <dialog ref={ref} className={className} aria-label={label} closedby="any"
    onCancel={event=>{event.preventDefault();onClose()}}
    onClick={event=>{
      if (event.target !== event.currentTarget) return
      const {left, right, top, bottom} = event.currentTarget.getBoundingClientRect()
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose()
    }}>
    <div className="dialog-inner"><IconButton icon="close" label="Close" className="dialog-close" onClick={onClose}/>{children}</div>
  </dialog>
}
export function Empty({title,description,icon='compass',action}) {
  return <section className="empty"><span className="empty-icon"><Icon name={icon} size={24}/></span><h2>{title}</h2><p>{description}</p>{action}</section>
}
export function SourcePill({url,label}) {
  const href = visibleSource(url)
  if (!href) return null
  if (isWikivoyage(href)) return <WikivoyageSource url={href} label={label}/>
  return <a className="source-pill" href={href.href} target="_blank" rel="noreferrer"><Icon name="link" size={13}/> {label || href.hostname.replace(/^www\./,'')} <Icon name="corner" size={12}/></a>
}
export function WikivoyageSource({url,label}) {
  const href = visibleSource(url)
  if (!href) return null
  const name = label && label !== 'Wikivoyage' ? `${label} · Wikivoyage` : 'Open Wikivoyage source'
  return <a className="wiki-source-arrow" href={href.href} target="_blank" rel="noreferrer" aria-label={name} title={name}>
    <Icon name="corner" size={13}/>
  </a>
}
export function AgentProgress({label='Searching for travel sources',steps=[],activeStep=null,skippedSteps=[],className='',assistant=false}) {
  return <div className={'agent-progress '+className} role="status">
    {assistant ? <TravelArtwork name="assistant-ring" animated className="assistant-progress-art" width={180} height={135}/> :
      <span className="agent-orb"><Icon name="sparkle" size={21}/></span>}
    <div><strong>{label}</strong>{steps.length>0&&<div className="agent-progress-steps">{steps.map((step,index)=><span key={step}
      className={skippedSteps.includes(index)?'is-skipped':activeStep===index?'is-active':activeStep!==null&&index<activeStep?'is-complete':''}
      aria-current={activeStep===index?'step':undefined}>{step}</span>)}</div>}</div>
    <span className="agent-dots" aria-hidden="true"><i/><i/><i/></span>
  </div>
}
