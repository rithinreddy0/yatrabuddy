import React, {useEffect, useRef, useState} from 'react'
import {request} from '../api.mjs'
import {Button, SourcePill} from '../components/UI.jsx'

export function GroqResearchResult({result}) {
  if (result?.error) return <p role="status">{result.error}</p>
  if (!result?.answer) return null
  return <section className="nearby-groq-answer" aria-label="Groq web research">
    <h4>Groq web research</h4>
    <p>{result.answer.replace(/^\|[-| :]+\|\s*$/gm,'').replace(/^\|\s*|\s*\|$/gm,'').replace(/\s+\|\s+/g,' · ').replace(/\*\*/g,'')}</p>
    <div className="nearby-links">{result.sources.map(source=><SourcePill key={source.url} label={source.title} url={source.url}/>)}</div>
  </section>
}

export function GroqResearch({location, query, mealPreference, localModes, stops, tripDetails, label}) {
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const controller = useRef(null)
  useEffect(()=>()=>controller.current?.abort(),[])

  async function run() {
    controller.current?.abort()
    const task = new AbortController()
    controller.current = task
    setLoading(true)
    setResult(null)
    try {
      const data = await request('locations/'+(location.cityId || location.id)+'/groq-research', {
        method:'POST', body:{query,mealPreference,localModes,stops,...tripDetails}, signal:task.signal,
      })
      if (!task.signal.aborted) setResult(data)
    } catch (failure) {
      if (!task.signal.aborted) setResult({error:failure.message})
    } finally {
      if (!task.signal.aborted) setLoading(false)
    }
  }

  return <div className="nearby-groq">
    <Button type="button" onClick={run} disabled={loading}>{loading?'Searching with Groq…':label}</Button>
    {loading && <small role="status">Groq is checking web sources.</small>}
    <GroqResearchResult result={result}/>
  </div>
}
