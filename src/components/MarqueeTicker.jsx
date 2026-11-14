import React from 'react'
import { ShieldCheck } from 'lucide-react'

export function MarqueeTicker({ items = [
  'Verified Open-Meteo Weather Data',
  'OSRM Routing with Realistic Transit Times',
  'Simulated Fares Marked Clearly (Rules H1-H3)',
  'Fast-path 100ms Deterministic Recompute',
  'Zero Booking Fees · Direct Transparency',
  'Real-time Multi-factor Constraint Solver'
] }) {
  return (
    <div className="marquee-container" aria-label="Trust and Verification">
      <div className="marquee-content">
        {items.map((item, idx) => (
          <div key={`m1-${idx}`} className="marquee-item">
            <ShieldCheck size={14} style={{ color: '#0284c7', flexShrink: 0 }} />
            <span>{item}</span>
          </div>
        ))}
      </div>
      <div className="marquee-content" aria-hidden="true">
        {items.map((item, idx) => (
          <div key={`m2-${idx}`} className="marquee-item">
            <ShieldCheck size={14} style={{ color: '#0284c7', flexShrink: 0 }} />
            <span>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

