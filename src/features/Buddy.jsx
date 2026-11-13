import React,{useEffect,useRef,useState} from 'react'
import {AgentProgress,Button,Dialog,Pill} from '../components/UI.jsx'
import {DestinationSearch} from '../components/DestinationSearch.jsx'
import {matchDestination} from '../planner.mjs'
import {askTravel} from '../conversation.mjs'
import {Answer,namedCity} from './Chat.jsx'
import {parseReminder,speak,spokenNumber} from './reminders.mjs'
import {BuddyMascot} from './BuddyMascot.jsx'
import {useVoiceInput} from './useVoiceInput.mjs'
import './BuddyVoice.css'

const suggestions=['What can I see in Kyoto?','Plan a trip to Goa','Remind me to check in in 30 minutes']

export function Buddy({catalog,defaultDestination,profile,trip,onClose,onPlan,reminders}){
  const [question,setQuestion]=useState('')
  const [city,setCity]=useState(()=>catalog.find(item=>item.id===(trip?.brief.destination||defaultDestination))||catalog[0])
  const [answer,setAnswer]=useState(null)
  const [feedback,setFeedback]=useState('')
  const [choices,setChoices]=useState(null)
  const [pending,setPending]=useState(false)
  const [speaking,setSpeaking]=useState(false)
  const [readAloud,setReadAloud]=useState(true)
  const [error,setError]=useState('')
  const active=useRef(null)
  const processing=useRef(false)
  const history=useRef([])
  const voice=useVoiceInput({onTranscript:text=>ask(text,{voice:true})})
  const voiceActive=voice.phase!=='idle'
  const listening=['listening','recording'].includes(voice.phase)

  useEffect(()=>()=>{active.current?.abort()},[])

  function respond(message,voice){
    setFeedback(message)
    if(voice&&readAloud)speakReply(message)
  }
  function speakReply(message){
    speak(message,{onStart:()=>setSpeaking(true),onEnd:()=>setSpeaking(false)})
  }

  async function ask(raw,{voice=false,selected}={}){
    const value=raw.trim().slice(0,260)
    if(!value||processing.current)return
    setQuestion(value);setFeedback('');setError('');setAnswer(null)
    const choice=value.match(/^(?:option|number)\s+(\w+)\.?$/i)
    if(choice&&choices){
      const chosen=choices.places[spokenNumber(choice[1])-1]
      if(chosen)return ask(choices.question,{voice,selected:chosen})
      respond('Choose one of the displayed option numbers.',voice)
      return
    }
    setChoices(null)
    if(/^remind me\b/i.test(value)){
      const reminder=parseReminder(value)
      if(!reminder){respond('Try saying “Remind me to check in in 30 minutes.”',voice);return}
      reminders.add(reminder)
      respond('Reminder set for '+new Date(reminder.due).toLocaleString()+'.',voice)
      return
    }
    if(/^\s*(?:list|show)(?: my)? reminders\b/i.test(value)){
      respond(reminders.items.length?reminders.items.map(item=>item.label+' at '+new Date(item.due).toLocaleString()).join('. '):'You have no upcoming reminders.',voice)
      return
    }
    const controller=new AbortController()
    active.current?.abort()
    active.current=controller
    setPending(true)
    processing.current=true
    try{
      const matched=matchDestination(value)
      const placeQuery=!selected&&!matched?namedCity(value):''
      const reply=await askTravel(value,{destination:selected||matched||city,placeQuery,history:history.current,profile,signal:controller.signal})
      if(controller.signal.aborted)return
      if(reply.destination)setCity(reply.destination)
      if(reply.choices?.length){
        setChoices({places:reply.choices,question:value})
        respond(reply.answer+' '+reply.choices.map((item,index)=>'Option '+(index+1)+', '+item.name+', '+(item.region||item.country)).join('. '),voice)
        return
      }
      if(reply.intent==='browse'&&reply.destination){
        onPlan(value,reply.destination.id,reply.destination,voice)
        return
      }
      history.current=[...history.current,{role:'user',content:value},{role:'assistant',content:reply.answer}].slice(-8)
      setAnswer(reply)
      respond(reply.answer.replace(/\[\d+\]/g,''),voice)
    }catch(failure){
      if(!controller.signal.aborted){setError(failure.message);if(voice&&readAloud)speakReply('I could not reach the sources. Please try again.')}
    }finally{
      processing.current=false
      if(!controller.signal.aborted)setPending(false)
    }
  }

  function stopVoice(){
    voice.stop()
    setSpeaking(false)
    active.current?.abort()
    setPending(false)
  }

  const status=voice.phase==='connecting'?'Connecting microphone…':voice.phase==='transcribing'?'Transcribing…':voice.phase==='recording'?'Recording':speaking?'Speaking':pending?'Checking travel sources…':listening?'Listening…':voiceActive?'Ready for your next question':'Ready to talk'
  return <Dialog onClose={onClose} label="Travel Buddy" className="buddy-voice-dialog"><div className="buddy-voice">
    <section className="buddy-voice-stage" aria-labelledby="buddy-voice-title">
      <h2 id="buddy-voice-title">Travel Buddy</h2>
      <BuddyMascot state={listening?'listening':speaking?'speaking':pending||voice.phase==='transcribing'?'thinking':'idle'}/>
      <p className="buddy-voice-status" role="status">{status}</p>
      <div className="buddy-voice-actions">
        {voice.phase==='recording'
          ?<Button variant="primary" icon="mic" onClick={voice.finishRecording}>Send recording</Button>
          :voiceActive
            ?<Button className="buddy-voice-stop" icon="close" onClick={stopVoice}>End voice</Button>
            :voice.browserSupported
              ?<Button variant="primary" icon="mic" disabled={pending} onClick={voice.startBrowser}>Start speaking</Button>
              :voice.recordingSupported
                ?<Button variant="primary" icon="mic" disabled={pending} onClick={voice.startRecording}>Record a question</Button>
                :null}
        {!voiceActive&&voice.browserSupported&&voice.recordingSupported&&
          <Button className="buddy-voice-alternate" disabled={pending} onClick={voice.startRecording}>Record instead</Button>}
        {voice.phase==='recording'&&<Button onClick={stopVoice}>Cancel recording</Button>}
      </div>
      {voice.error&&<p className="buddy-voice-error" role="alert">{voice.error}</p>}
      {!voice.browserSupported&&!voice.recordingSupported&&<p className="buddy-voice-note">{voice.secure?'Speech recognition is unavailable here. Type your question below.':'Open Wayfarer on HTTPS or localhost to use a microphone.'}</p>}
      {!voiceActive&&voice.recordingSupported&&<p className="buddy-voice-note">Recordings are sent to the configured speech service when you select Send recording.</p>}
    </section>
    <div className="buddy-voice-body">
    <div className="quick-picks">{suggestions.map(value=><Pill key={value} disabled={pending} onClick={()=>ask(value)}>{value}</Pill>)}</div>
    <form className="stack buddy-voice-composer" onSubmit={event=>{event.preventDefault();ask(question)}}>
      <label>Your question<input value={question} onChange={event=>setQuestion(event.target.value)} maxLength={260} placeholder="Ask about the trip, or say what to remind you about" required/></label>
      <Button variant="secondary" icon="sparkle" type="submit" disabled={pending}>Ask</Button>
    </form>
    <details className="buddy-voice-settings"><summary>Voice settings and destination</summary>
      <DestinationSearch catalog={catalog} selected={city} onSelect={setCity} global/>
      <label><input type="checkbox" checked={readAloud} onChange={event=>{setReadAloud(event.target.checked);if(!event.target.checked&&'speechSynthesis' in window){window.speechSynthesis.cancel();setSpeaking(false)}}}/> Speak voice replies</label>
    </details>
    {pending&&<AgentProgress label="Checking travel sources"/>}
    {error&&<p className="form-error" role="alert">{error}</p>}
    {feedback&&!answer&&<section className="panel buddy-feedback" aria-live="polite"><p>{feedback}</p>{'speechSynthesis' in window&&<Button variant="text-btn" onClick={()=>speakReply(feedback)}>Read aloud</Button>}</section>}
    {choices&&<div className="quick-picks">{choices.places.map((item,index)=><Pill key={item.id} onClick={()=>ask(choices.question,{selected:item})}>{index+1}. {item.name}, {item.region||item.country}</Pill>)}</div>}
    {answer&&<section className="buddy-answer"><Answer reply={answer}/>{'speechSynthesis' in window&&<Button variant="text-btn" onClick={()=>speakReply(feedback)}>Read aloud</Button>}</section>}
    {reminders.items.length>0&&<section className="buddy-reminders"><h3>Reminders</h3><p className="form-note">Reminders appear in this browser while Wayfarer is open.</p>
      {reminders.items.map(item=><div className="buddy-reminder" key={item.id}><span>{item.label} · {new Date(item.due).toLocaleString()}</span><Button variant="text-btn" onClick={()=>reminders.remove(item.id)}>Remove</Button></div>)}
    </section>}
  </div></div></Dialog>
}
