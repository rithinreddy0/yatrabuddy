import React from 'react'
import {Brain, RotateCcw, X, Plus, Minus, Tag} from 'lucide-react'
import {Button} from './UI.jsx'

export function LearningPanel({learned, onRemoveTag, onReset, isOpen, onToggle}) {
  const {tags = {}, history = []} = learned || {}
  const entries = Object.entries(tags).filter(([, weight]) => weight !== 0)

  return (
    <div className={`dynamic-learning-panel ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="dynamic-learning-trigger"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls="dynamic-learning-content"
        title="View learned preferences and weights"
      >
        <Brain size={16} aria-hidden="true" />
        <span>What I've learned ({entries.length})</span>
      </button>

      {isOpen && (
        <section id="dynamic-learning-content" className="dynamic-learning-body" aria-label="Learned travel preferences">
          <div className="dynamic-learning-header">
            <h4>
              <Brain size={16} aria-hidden="true" />
              <span>Learned Preferences</span>
            </h4>
            {entries.length > 0 && (
              <Button variant="outline" className="dynamic-learning-reset" onClick={onReset}>
                <RotateCcw size={13} aria-hidden="true" /> Reset all
              </Button>
            )}
          </div>

          <p className="dynamic-learning-note">
            Weights update automatically based on your option selections, skips, and slider adjustments. Every item can be individually reversed.
          </p>

          {entries.length === 0 ? (
            <p className="dynamic-learning-empty">No preferences observed yet. As you browse and select options, patterns appear here.</p>
          ) : (
            <ul className="dynamic-learning-tags" aria-label="Learned preference tags">
              {entries.map(([key, weight]) => (
                <li key={key} className={`dynamic-learning-tag ${weight > 0 ? 'positive' : 'negative'}`}>
                  <span className="dynamic-tag-name">
                    <Tag size={12} aria-hidden="true" />
                    <strong>{key}</strong>
                  </span>
                  <span className="dynamic-tag-weight" title={`Preference weight: ${weight}`}>
                    {weight > 0 ? `+${weight}` : weight}
                  </span>
                  <button
                    type="button"
                    className="dynamic-tag-remove"
                    onClick={() => onRemoveTag(key)}
                    aria-label={`Remove learned preference for ${key}`}
                  >
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {history.length > 0 && (
            <details className="dynamic-learning-history">
              <summary>Recent adaptation log ({history.length})</summary>
              <ol>
                {history.slice(-5).reverse().map((entry, idx) => (
                  <li key={idx}>
                    <small>
                      {entry.action}: {entry.key} ({entry.value > 0 ? `+${entry.value}` : entry.value})
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      )}
    </div>
  )
}
