import React from 'react'
import {Bell, Check, X, BellOff, Sparkles, AlertTriangle, Info} from 'lucide-react'
import {Button} from './UI.jsx'

export function ProactiveSuggestion({
  suggestion,
  onAccept,
  onDismiss,
  onMute,
}) {
  if (!suggestion) return null

  const {triggerId, triggerType, message, suggestion: action, severity = 'medium'} = suggestion

  const icons = {
    high: AlertTriangle,
    medium: Sparkles,
    low: Info,
    info: Bell,
  }
  const IconComponent = icons[severity] || Sparkles

  return (
    <aside
      className={`dynamic-proactive-card severity-${severity}`}
      role="region"
      aria-live="polite"
      aria-label="Proactive travel recommendation"
    >
      <div className="dynamic-proactive-header">
        <span className="dynamic-proactive-icon" aria-hidden="true">
          <IconComponent size={17} />
        </span>
        <div className="dynamic-proactive-copy">
          <small className="dynamic-proactive-kicker">SUGGESTION · REAL-TIME TRIGGER</small>
          <p className="dynamic-proactive-trigger">{message}</p>
        </div>
      </div>

      <div className="dynamic-proactive-actions">
        {action && (
          <Button
            variant="primary"
            className="dynamic-proactive-accept"
            onClick={() => onAccept(suggestion)}
          >
            <Check size={15} aria-hidden="true" />
            <span>{action.label || 'Accept suggestion'}</span>
          </Button>
        )}
        <Button
          variant="outline"
          className="dynamic-proactive-dismiss"
          onClick={() => onDismiss(triggerId)}
          title="Dismiss this suggestion"
        >
          <X size={15} aria-hidden="true" />
          <span>Dismiss</span>
        </Button>
        <button
          type="button"
          className="dynamic-proactive-mute"
          onClick={() => onMute(triggerType)}
          title="Don't suggest this category again"
        >
          <BellOff size={13} aria-hidden="true" />
          <span>Don't suggest this again</span>
        </button>
      </div>
    </aside>
  )
}
