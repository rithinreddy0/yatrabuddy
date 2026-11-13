import React from 'react'
import {Icon} from './UI.jsx'
import '../features/ResearchBrief.css'

export function PlaceSummary({summary, title='Results at a glance', onSelect}) {
  if (!summary.count) return null
  return <section className="panel place-summary" aria-label={title}>
    <header><Icon name="sparkle" size={20}/><div><h3>{title}</h3><p>{summary.mix.join(' · ')}</p></div></header>
    <ul aria-label="Places to start">
      {summary.picks.map((place, index) => <li key={place.sourceUrl || place.id || index}>
        {onSelect ? <button type="button" onClick={() => onSelect(place)}>{place.name}</button>
          : place.sourceUrl ? <a href={place.sourceUrl} target="_blank" rel="noreferrer">{place.name}</a> : <strong>{place.name}</strong>}
        {Number.isFinite(place.rating) && place.rating > 0 && place.rating <= 5 &&
          <span> · {place.rating.toFixed(1)}/5{place.source ? ' on ' + place.source : ''}</span>}
        {place.matches.length > 0 && <span> · Matches {place.matches.join(', ').toLowerCase()}</span>}
      </li>)}
    </ul>
    <p className="place-summary-coverage">{summary.coverage.join(' · ')}</p>
  </section>
}
