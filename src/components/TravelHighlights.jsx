import React from 'react'
import './TravelHighlights.css'

// Keep currency ranges together and avoid treating dates and times as fares.
const amount = String.raw`\d+(?:[,.]\d+)*`
const currency = String.raw`(?:[₹€£¥฿]|(?:US|CA|AU|NZ|HK|SG|S)?\$|\b(?:INR|USD|EUR|GBP|SGD|JPY|THB|AUD|CAD|Rs\.?)\s*)`
const price = new RegExp(String.raw`${currency}\s*${amount}(?:\s*(?:[–—-]|\bto\b)\s*(?:${currency}\s*)?${amount})?(?![\d:])|\b${amount}\s+(?:rupees?|dollars?|euros?|baht|yen)\b`, 'gi')
const sentences = new Intl.Segmenter('en', {granularity:'sentence'})

export function HighlightPrice({text}) {
  const parts = []
  let start = 0
  for (const match of text.matchAll(price)) {
    parts.push(text.slice(start, match.index), <strong key={match.index} className="travel-price">{match[0]}</strong>)
    start = match.index + match[0].length
  }
  return <>{parts}{text.slice(start)}</>
}

export function TravelHighlights({text = '', points, limit = 3, preferPrices = false}) {
  const lines = points?.length ? points.slice(0, limit) : excerptPoints(text, limit, preferPrices)
  return lines.length > 0 && <ul className="travel-highlights">
    {lines.map((line, index) => <li key={index}><HighlightPrice text={line}/></li>)}
  </ul>
}

function excerptPoints(text, limit, preferPrices) {
  const rows = text.trim().split(/\n+/).flatMap(paragraph => Array.from(sentences.segment(paragraph),
    ({segment}) => segment.trim().replace(/^[-•]\s+/, ''))).filter(Boolean)
  const short = rows.filter(row => row.split(/\s+/).length <= 32)
  const independent = short.filter((row, i) => !i || !/^(?:It|They|These|Those|This|However|There are also)\s/i.test(row))
  const selected = (independent.length ? independent : short).slice(0, limit)
  if (preferPrices && !selected.some(row => Array.from(row.matchAll(price)).length)) {
    const fare = short.find(row => Array.from(row.matchAll(price)).length)
    if (fare) selected.splice(limit - 1, 1, fare)
  }
  if (selected.length || !rows.length) return selected
  return [rows[0].split(/\s+/).slice(0, 32).join(' ') + '…']
}
