import React from 'react'

export function SkeletonCard({type = 'option', count = 1}) {
  return (
    <div className="dynamic-skeleton-list" aria-busy="true" aria-label="Loading options">
      {Array.from({length: count}).map((_, i) => (
        <article key={i} className={`agent-option dynamic-skeleton-card dynamic-skeleton-${type}`}>
          <div className="dynamic-skeleton-line dynamic-skeleton-badge" />
          <div className="dynamic-skeleton-line dynamic-skeleton-title" />
          <div className="dynamic-skeleton-line dynamic-skeleton-subtitle" />
          <div className="dynamic-skeleton-line dynamic-skeleton-price" />
          <div className="dynamic-skeleton-line dynamic-skeleton-desc" />
          <div className="dynamic-skeleton-button" />
        </article>
      ))}
    </div>
  )
}
