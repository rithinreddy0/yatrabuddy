import React, { useState } from 'react'
import { Sparkles, ChevronDown, ChevronUp, Bot, Compass } from 'lucide-react'

export function DynamicIsland({ status = 'AI Assistant Ready', tripName = null, onOpenTrip, onOpenChat }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`dynamic-island-pill ${expanded ? 'expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
      role="status"
      aria-live="polite"
      title="Status & Quick Actions"
    >
      <div className="dynamic-island-dot" />

      {!expanded ? (
        <>
          <span style={{ fontSize: '12.5px', fontWeight: 600, letterSpacing: '-0.2px' }}>
            {tripName ? `Active: ${tripName}` : status}
          </span>
          <ChevronDown size={13} style={{ opacity: 0.6 }} />
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '220px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: '5px' }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.5px' }}>
              ACTIVITY DOCK
            </span>
            <ChevronUp size={13} style={{ opacity: 0.6 }} />
          </div>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>
            {tripName ? `Trip: ${tripName}` : status}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginTop: '2px' }}>
            {tripName && onOpenTrip && (
              <button
                type="button"
                className="btn secondary"
                style={{ fontSize: '11px', padding: '4px 10px', height: 'auto', borderRadius: '10px' }}
                onClick={(e) => { e.stopPropagation(); onOpenTrip(); setExpanded(false) }}
              >
                <Compass size={12} /> View Map
              </button>
            )}
            {onOpenChat && (
              <button
                type="button"
                className="btn primary"
                style={{ fontSize: '11px', padding: '4px 10px', height: 'auto', borderRadius: '10px' }}
                onClick={(e) => { e.stopPropagation(); onOpenChat(); setExpanded(false) }}
              >
                <Bot size={12} /> AI Planner
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

