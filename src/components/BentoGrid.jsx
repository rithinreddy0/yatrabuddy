import React, { useState } from 'react'
import { MapPin, ShieldCheck, ArrowRight, RotateCw } from 'lucide-react'

export function BentoFlipCard({ place, onPlan }) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div
      className={`flip-card-3d ${flipped ? 'flipped' : ''}`}
      onClick={() => setFlipped(!flipped)}
      title="Click to flip card"
    >
      <div className="flip-card-inner">
        {/* Front */}
        <div className="flip-card-front">
          <img
            src={`/images/${place.image || 'kerala'}.jpg`}
            alt={place.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            loading="lazy"
          />
          <div className="flip-card-front-scrim">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="card-badge-subtle">
                {place.theme || 'Featured'}
              </span>
              <span style={{ fontSize: '11px', opacity: 0.85, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <RotateCw size={11} /> Details
              </span>
            </div>
            <h3 style={{ margin: '6px 0 2px 0', fontSize: '18px', fontWeight: 700 }}>{place.name}</h3>
            <small style={{ opacity: 0.85 }}><MapPin size={12} style={{ display: 'inline', verticalAlign: '-1px' }} /> {place.region}</small>
          </div>
        </div>

        {/* Back */}
        <div className="flip-card-back">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--primary, #0284c7)' }}>{place.name.toUpperCase()}</span>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Flip back</span>
            </div>
            <p style={{ fontSize: '13px', margin: '12px 0', color: 'var(--text-muted, #475569)', lineHeight: 1.5 }}>
              {place.tagline || 'Experience verified cultural heritage, coastal viewpoints, and curated authentic trails.'}
            </p>
            <div style={{ fontSize: '11.5px', color: '#0284c7', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 600 }}>
              <ShieldCheck size={14} /> Verified public stops & routes
            </div>
          </div>

          <button
            type="button"
            className="btn primary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={(e) => {
              e.stopPropagation()
              onPlan?.(place.id)
            }}
          >
            Plan {place.name} <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function BentoExploreSection({ catalog, onPlan }) {
  const list = Array.isArray(catalog) ? catalog : []
  const featured = list.slice(0, 4)
  if (!featured.length) return null

  return (
    <section className="bento-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' }}>
        <div>
          <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--primary, #0284c7)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
            Curated Destinations
          </span>
          <h2 style={{ fontSize: '22px', fontWeight: 800, margin: '2px 0 0 0', letterSpacing: '-0.3px' }}>Explore verified places</h2>
        </div>
        <small style={{ color: 'var(--text-muted, #64748b)', fontSize: '12px' }}>Tap cards to view highlights</small>
      </div>

      <div className="bento-grid">
        {featured.map((place) => (
          <BentoFlipCard key={place.id} place={place} onPlan={() => onPlan(place.id)} />
        ))}
      </div>
    </section>
  )
}

