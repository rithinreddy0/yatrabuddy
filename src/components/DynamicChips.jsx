import React from 'react'
import {Sparkles} from 'lucide-react'

export function DynamicChips({chips = [], onSelect, disabled = false}) {
  if (!chips.length) return null

  return (
    <div className="dynamic-chips-row" role="group" aria-label="Suggested follow-up actions">
      <span className="dynamic-chips-prefix" aria-hidden="true">
        <Sparkles size={13} />
      </span>
      <div className="dynamic-chips-list">
        {chips.map((chip, idx) => {
          const text = typeof chip === 'string' ? chip : chip.label
          const value = typeof chip === 'string' ? chip : (chip.value || chip.label)
          return (
            <button
              key={`${text}-${idx}`}
              type="button"
              className="dynamic-chip-btn"
              disabled={disabled}
              onClick={() => onSelect(value)}
            >
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
