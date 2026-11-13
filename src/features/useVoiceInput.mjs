import {useEffect,useRef,useState} from 'react'

const recognitionErrors={
  'not-allowed':'Microphone access was denied. Allow it in your browser and try again.',
  'service-not-allowed':'The browser blocked its speech service.',
  'audio-capture':'No microphone was available.',
  'network':'The browser could not reach its speech recognition service.',
  'language-not-supported':'The browser’s speech service does not support this language.',
}
const mediaErrors={
  NotAllowedError:'Microphone access was denied. Allow it in your browser and try again.',
  NotFoundError:'No microphone was available.',
  NotReadableError:'The microphone is unavailable. Close other apps using it and try again.',
}
const audioTypes=['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus']

export function useVoiceInput({onTranscript,autoStart=false,continuous=true}){
  const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition
  const [phase,setPhase]=useState('idle')
  const [error,setError]=useState('')
  const [transcription,setTranscription]=useState(false)
  const recognition=useRef(null)
  const recording=useRef(null)
  const session=useRef(0)
  const timer=useRef(null)
  const busy=useRef(false)
  const handler=useRef(onTranscript)
  const upload=useRef(null)
  const mounted=useRef(false)
  handler.current=onTranscript
  const secure=window.isSecureContext
  const browserSupported=secure&&Boolean(Recognition)
  const recordingSupported=secure&&transcription&&Boolean(navigator.mediaDevices?.getUserMedia&&window.MediaRecorder)

  function release(){
    session.current++
    clearTimeout(timer.current)
    recognition.current?.abort()
    recognition.current=null
    const capture=recording.current
    recording.current=null
    if(capture?.recorder?.state==='recording')capture.recorder.stop()
    capture?.stream?.getTracks().forEach(track=>track.stop())
    upload.current?.abort()
    upload.current=null
  }

  function stop(){
    release()
    window.speechSynthesis?.cancel()
    setPhase('idle')
  }

  function fail(message){
    stop()
    setError(message)
  }

  async function deliver(value,id){
    if(id!==session.current)return
    const text=value.trim()
    if(!text)return
    if(/^stop (?:voice|listening)\.?$/i.test(text)){stop();return}
    busy.current=true
    try{await handler.current(text)}catch{
      if(id===session.current)setError('That command could not finish. Try again.')
    }finally{busy.current=false}
  }

  function startBrowser(){
    if(!browserSupported||recognition.current||recording.current||busy.current)return
    stop()
    setError('')
    setPhase('connecting')
    const id=session.current
    let instance
    try{instance=new Recognition()}catch{fail('Voice input could not start. Try again.');return}
    recognition.current=instance
    instance.lang=navigator.language||'en-IN'
    instance.continuous=false
    instance.interimResults=false
    let silence=0

    function begin(){
      if(id!==session.current)return
      if(busy.current||window.speechSynthesis?.speaking||window.speechSynthesis?.pending){
        timer.current=setTimeout(begin,250)
        return
      }
      try{instance.start()}catch{fail('Voice input could not start. Try again.')}
    }
    instance.onstart=()=>{if(id===session.current)setPhase('listening')}
    instance.onresult=event=>{
      if(id!==session.current)return
      silence=0
      const final=event.results[event.resultIndex]
      if(final?.isFinal)void deliver(final[0].transcript,id)
    }
    instance.onerror=event=>{
      if(id!==session.current||event.error==='aborted')return
      if(event.error==='no-speech'&&++silence<2)return
      fail(event.error==='no-speech'?'I didn’t hear anything. Start the microphone again when you’re ready.':
        recognitionErrors[event.error]||'Voice input stopped. Try again.')
    }
    instance.onend=()=>{
      if(id!==session.current)return
      if(!continuous){recognition.current=null;setPhase('idle');return}
      setPhase('waiting')
      timer.current=setTimeout(begin,400)
    }
    // The first attempt stays in the click handler for browsers that require a gesture.
    try{instance.start()}catch{fail('Voice input could not start. Try again.')}
  }

  async function startRecording(){
    if(!recordingSupported||recording.current||busy.current)return
    stop()
    setError('')
    setPhase('connecting')
    const id=session.current
    const capture={}
    recording.current=capture
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true})
      if(id!==session.current||!mounted.current){stream.getTracks().forEach(track=>track.stop());return}
      capture.stream=stream
      const mimeType=audioTypes.find(type=>MediaRecorder.isTypeSupported(type))
      const recorder=new MediaRecorder(stream,{audioBitsPerSecond:64000,...(mimeType?{mimeType}:{})})
      capture.recorder=recorder
      const chunks=[]
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data)}
      recorder.onerror=()=>{if(id===session.current)fail('The audio recording could not finish.')}
      recorder.onstop=async()=>{
        stream.getTracks().forEach(track=>track.stop())
        if(id!==session.current)return
        recording.current=null
        clearTimeout(timer.current)
        if(!capture.send){setPhase('idle');return}
        setPhase('transcribing')
        const controller=new AbortController()
        upload.current=controller
        try{
          const audio=new Blob(chunks,{type:recorder.mimeType||chunks[0]?.type})
          if(!audio.size)throw new Error('No audio was captured.')
          const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])
          const response=await fetch('/api/voice/transcribe',{method:'POST',body:audio,signal,credentials:'same-origin'})
          const data=await response.json().catch(()=>null)
          if(!response.ok||!data?.text)throw new Error(data?.detail||'The recording could not be transcribed.')
          await deliver(data.text,id)
        }catch(failure){
          if(id===session.current)setError(failure.name==='TimeoutError'?'Transcription timed out. Try a shorter question.':failure.message)
        }finally{
          if(id===session.current){upload.current=null;setPhase('idle')}
        }
      }
      recorder.start()
      setPhase('recording')
      timer.current=setTimeout(()=>{
        if(id===session.current&&recorder.state==='recording')fail('The recording reached 25 seconds. Try a shorter question.')
      },25000)
    }catch(failure){
      if(id===session.current)fail(mediaErrors[failure.name]||'The microphone could not start.')
    }
  }

  function finishRecording(){
    const capture=recording.current
    if(capture?.recorder?.state!=='recording')return
    capture.send=true
    capture.recorder.stop()
  }

  function finish(){
    if(phase==='listening'&&recognition.current){
      setPhase('transcribing')
      try{recognition.current.stop()}catch{stop()}
    }else if(phase==='recording')finishRecording()
    else stop()
  }

  useEffect(()=>{
    mounted.current=true
    const controller=new AbortController()
    fetch('/api/voice/config',{signal:controller.signal,credentials:'same-origin'})
      .then(response=>response.ok?response.json():null)
      .then(config=>{if(!controller.signal.aborted)setTranscription(Boolean(config?.transcription))})
      .catch(()=>{})
    if(autoStart&&browserSupported)startBrowser()
    return ()=>{
      mounted.current=false
      controller.abort()
      release()
      window.speechSynthesis?.cancel()
    }
  },[])

  return {phase,error,secure,browserSupported,recordingSupported,startBrowser,startRecording,finishRecording,finish,stop}
}
