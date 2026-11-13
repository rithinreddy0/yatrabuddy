import React from 'react'
import {Undo2, ArrowRight, PlusCircle, MinusCircle, MoveRight} from 'lucide-react'
import {Button} from './UI.jsx'

export function PlanDiff({diff, description, onUndo}) {
  if (!diff) return null
  const {added = [], removed = [], moved = [], changed = []} = diff

  const hasChanges = added.length > 0 || removed.length > 0 || moved.length > 0 || changed.length > 0
  if (!hasChanges && !description) return null

  return (
    <div className="dynamic-plan-diff" role="region" aria-label="Itinerary modification diff">
      <div className="dynamic-diff-header">
        <strong>{description || 'Plan updated'}</strong>
        {onUndo && (
          <Button variant="outline" className="dynamic-diff-undo" onClick={onUndo}>
            <Undo2 size={14} aria-hidden="true" /> Undo change
          </Button>
        )}
      </div>

      <ul className="dynamic-diff-items">
        {added.map((item, idx) => (
          <li key={`add-${idx}`} className="dynamic-diff-added">
            <PlusCircle size={14} aria-hidden="true" />
            <span>Added <strong>{item.name}</strong> to Day {item.dayIndex + 1}</span>
          </li>
        ))}
        {removed.map((item, idx) => (
          <li key={`rem-${idx}`} className="dynamic-diff-removed">
            <MinusCircle size={14} aria-hidden="true" />
            <span>Removed <strong>{item.name}</strong> from Day {item.dayIndex + 1}</span>
          </li>
        ))}
        {moved.map((item, idx) => (
          <li key={`mov-${idx}`} className="dynamic-diff-moved">
            <MoveRight size={14} aria-hidden="true" />
            <span>Moved <strong>{item.name}</strong> from Day {item.fromDay + 1} to Day {item.toDay + 1}</span>
          </li>
        ))}
        {changed.map((item, idx) => (
          <li key={`chg-${idx}`} className="dynamic-diff-changed">
            <ArrowRight size={14} aria-hidden="true" />
            {item.type === 'brief' ? (
              <span>Updated {item.field}: {item.from} → <strong>{item.to}</strong></span>
            ) : (
              <span>Reordered stops for Day {item.dayIndex + 1}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
