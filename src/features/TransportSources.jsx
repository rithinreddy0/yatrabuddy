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

export function TravelProviderSources({result}) {
  if (!result) return null
  const {title = 'Travel providers', route, date, checkout, travelers, notes = [], providers = [], detail, guide, error} = result
  const guideSections = guide?.sections || []
  const dates = [dateLabel(date), dateLabel(checkout)].filter(Boolean).join(' – ')
  const context = [route, dates, travelers && `${travelers} ${travelers === 1 ? 'traveller' : 'travellers'}`].filter(Boolean).join(' · ')
  return <section className="agent-source-answer" aria-label={title}>
    <h3>{title}</h3>
    {context && <strong>{context}</strong>}
    {(error || detail) && <p>{error || detail}</p>}
    {providers.length > 0 && <ul className="agent-place-results">
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
    </ul>}
    {guideSections.map(section => {
      const words = section.text?.trim().split(/\s+/) || []
      return <details key={section.title}>
        <summary>{section.title}</summary>
        <p>{words.slice(0, 25).join(' ')}{words.length > 25 ? '…' : ''}</p>
        <ExternalSource url={section.sourceUrl}>{section.source || 'Destination guide'}</ExternalSource>
      </details>
    })}
    {notes.map(note => <p key={note}><small>{note}</small></p>)}
  </section>
}
