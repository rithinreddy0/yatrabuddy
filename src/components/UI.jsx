import React, {useEffect,useRef} from 'react'
import {icon} from '../icons.mjs'
import {visibleSource} from './sourceUrl.mjs'

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
  return <><span className="brand-mark"><Icon name="compass" size={22}/></span><span>YatraBuddy</span></>
}
export function Dialog({children,onClose,className='',label}) {
  const ref=useRef(null)
  useEffect(()=>{
    const node=ref.current
    node.showModal()
    return ()=>node.close()
  },[])
  return <dialog ref={ref} className={className} aria-label={label} onCancel={event=>{event.preventDefault();onClose()}} onClick={event=>{if(event.target===event.currentTarget)onClose()}}>
    <div className="dialog-inner"><IconButton icon="close" label="Close" className="dialog-close" onClick={onClose}/>{children}</div>
  </dialog>
}
export function Empty({title,description,icon='compass',action}) {
  return <section className="empty"><span className="empty-icon"><Icon name={icon} size={24}/></span><h2>{title}</h2><p>{description}</p>{action}</section>
}
export function SourcePill({url,label}) {
  const href = visibleSource(url)
  if (!href) return null
  return <a className="source-pill" href={href.href} target="_blank" rel="noreferrer"><Icon name="link" size={13}/> {label || href.hostname.replace(/^www\./,'')} <Icon name="corner" size={12}/></a>
}
export function AgentProgress({label='Searching for travel sources',steps=[],activeStep=null,skippedSteps=[],className=''}) {
  return <div className={'agent-progress '+className} role="status">
    <span className="agent-orb"><Icon name="sparkle" size={21}/></span>
    <div><strong>{label}</strong>{steps.length>0&&<div className="agent-progress-steps">{steps.map((step,index)=><span key={step}
      className={skippedSteps.includes(index)?'is-skipped':activeStep===index?'is-active':activeStep!==null&&index<activeStep?'is-complete':''}
      aria-current={activeStep===index?'step':undefined}>{step}</span>)}</div>}</div>
    <span className="agent-dots" aria-hidden="true"><i/><i/><i/></span>
  </div>
}
