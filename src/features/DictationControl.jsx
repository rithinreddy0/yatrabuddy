import React from 'react'
import {Mic, Square} from 'lucide-react'
import './DictationControl.css'

export function DictationControl({voice, disabled}) {
  if (!voice.browserSupported && !voice.recordingSupported) return null
  if (voice.phase === 'idle') return <button type="button" className="dictation-button agent-round" aria-label="Dictate a message" title="Dictate a message" disabled={disabled}
    onClick={voice.browserSupported ? voice.startBrowser : voice.startRecording}><Mic size={19}/></button>

  const listening = ['listening', 'recording'].includes(voice.phase)
  const status = listening ? 'Listening…' : voice.phase === 'transcribing' ? 'Transcribing…' : 'Starting microphone…'
  return <div className="dictation-active">
    <span role="status">{listening && <span className="dictation-wave" aria-hidden="true"><i/><i/><i/></span>}{status}</span>
    <button type="button" className="dictation-button" aria-label="Stop dictation" onClick={voice.finish}><Square size={14}/><span>Stop</span></button>
  </div>
}
