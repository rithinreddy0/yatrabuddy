import React,{useState} from 'react'
import {Button} from '../components/UI.jsx'
import {speak,spokenNumber} from './reminders.mjs'
import {useVoiceInput} from './useVoiceInput.mjs'

export function VoicePlanner({label='Plan by voice',instructions,onCommand,autoStart=false}){
  const [heard,setHeard]=useState('')
  const voice=useVoiceInput({autoStart,onTranscript:async text=>{setHeard(text);await onCommand(text)}})
  const active=voice.phase!=='idle'
  const status={
    connecting:'Connecting microphone…',
    listening:'Listening for a planning command…',
    waiting:'Ready for the next command…',
    recording:'Recording your command…',
    transcribing:'Transcribing…',
  }[voice.phase]
  return <div className="voice-planner">
    {voice.phase==='recording'
      ?<Button variant="primary" icon="mic" onClick={voice.finishRecording}>Send command</Button>
      :active
        ?<Button variant="primary" icon="close" onClick={voice.stop}>Stop voice planning</Button>
        :voice.browserSupported
          ?<Button icon="mic" onClick={voice.startBrowser}>{label}</Button>
          :voice.recordingSupported
            ?<Button icon="mic" onClick={voice.startRecording}>Record a command</Button>
            :null}
    {voice.phase==='recording'&&<Button onClick={voice.stop}>Cancel recording</Button>}
    {!active&&voice.browserSupported&&voice.recordingSupported&&<Button onClick={voice.startRecording}>Record instead</Button>}
    {!active&&voice.recordingSupported&&<p className="form-note">Send command shares your recording with the configured speech service.</p>}
    {active&&<p className="form-note" role="status">{status}{heard?' Heard: '+heard:''}</p>}
    {instructions&&<p className="form-note">{instructions} {!active&&'speechSynthesis' in window&&<Button variant="text-btn" onClick={()=>speak(instructions)}>Hear instructions</Button>}</p>}
    {!voice.browserSupported&&!voice.recordingSupported&&<p className="form-note">{voice.secure?'Voice planning requires a browser with speech recognition.':'Voice planning requires HTTPS or localhost.'}</p>}
    {voice.error&&<p className="form-error" role="alert">{voice.error}</p>}
  </div>
}

export const voiceText=value=>value.toLowerCase().trim().replace(/[.!?]+$/,'')
export function optionNumber(value){
  const match=value.match(/\b(?:option|number|stop|stay)\s+(\d+|[a-z]+)\b/i)
  return match?spokenNumber(match[1]):NaN
}
