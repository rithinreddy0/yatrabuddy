import React from 'react'
import {ExternalLink} from 'lucide-react'

function ExternalSource({url, children}) {
  let href
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) href = parsed.href
  } catch {
    return null
  }
  return href ? <a className="agent-source-link" href={href} target="_blank" rel="noreferrer">
    {children}<ExternalLink size={13} aria-hidden="true"/>
  </a> : null
}

function dateLabel(value) {
  if (!value) return ''
  const date = new Date(value + 'T00:00:00Z')
  return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium', timeZone: 'UTC',
  }).format(date)
}

export function TravelProviderSources({result, answerFirst = false}) {
  if (!result) return null
  const {title = 'Travel providers', route, date, checkout, travelers, notes = [], providers = [], detail, guide, error} = result
  const guideSections = guide?.sections || []
  const dates = [dateLabel(date), dateLabel(checkout)].filter(Boolean).join(' – ')
  const context = [route, dates, travelers && `${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}`].filter(Boolean).join(' · ')
  const providerList = <ul className="agent-place-results">
      {providers.map(({name, mode, url, sourceUrl, summary, action}) => <li key={`${name}-${mode}`}>
        <h4>{name} <small>· {mode}</small></h4>
        <p>{summary}</p>
        <div className="agent-place-links">
          <ExternalSource url={url}>{action || `Open ${name}`}</ExternalSource>
          {sourceUrl !== url && <ExternalSource url={sourceUrl}>
            Source<span className="yatra-sr-only"> for {name}</span>
          </ExternalSource>}
        </div>
      </li>)}
    </ul>
  return <section className="agent-source-answer" aria-label={title}>
    <h3>{title}</h3>
    {context && <strong>{context}</strong>}
    {error && <p>{error}</p>}
    {result.road && <p><strong>{result.road.kilometres.toLocaleString()} km</strong>
      {result.road.minutes != null && ` · about ${Math.floor(result.road.minutes / 60)} h ${result.road.minutes % 60} min by car`} · {result.road.estimated}</p>}
    {!!result.passes?.length && <div><h4>Published transit passes</h4><ul>{result.passes.map(pass => <li key={pass.name}>{pass.name} · ₹{pass.amount} <ExternalSource url={pass.url}>Operator details</ExternalSource></li>)}</ul></div>}
    {answerFirst && result.local && !result.passes?.length && <p>A day pass price could not be verified for this city.</p>}
    {!answerFirst && providers.length > 0 && providerList}
    {guideSections.map(section => {
      const words = section.text?.trim().split(/\s+/) || []
      return <details key={section.title} open={answerFirst || undefined}>
        <summary>{section.title}</summary>
        <p>{answerFirst ? section.text : words.slice(0, 25).join(' ') + (words.length > 25 ? '…' : '')}</p>
        <ExternalSource url={section.sourceUrl}>{section.source || 'Destination guide'}</ExternalSource>
      </details>
    })}
    {answerFirst && !error && !result.places && !guideSections.length && !result.road && <p>Route details and schedules could not be verified from the available sources.</p>}
    {!error && detail && <p><small>{detail}</small></p>}
    {notes.map(note => <p key={note}><small>{note}</small></p>)}
    {answerFirst && providers.length > 0 && <details><summary>Operators and booking references</summary>{providerList}</details>}
  </section>
}
