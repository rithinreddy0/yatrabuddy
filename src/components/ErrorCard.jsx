import React from 'react'
import {AlertCircle, RefreshCw, Database} from 'lucide-react'
import {Button} from './UI.jsx'

export function ErrorCard({toolName, error, onRetry, onUseCached, busy = false}) {
  return (
    <article className="agent-option dynamic-error-card" role="alert" aria-live="assertive">
      <div className="dynamic-error-header">
        <AlertCircle size={20} className="dynamic-error-icon" aria-hidden="true" />
        <div>
          <strong className="dynamic-error-title">{toolName || 'Source'} lookup failed</strong>
          <p className="dynamic-error-msg">{error || 'The source took too long or is temporarily unavailable.'}</p>
        </div>
      </div>
      <div className="agent-pills dynamic-error-actions">
        {onRetry && (
          <Button variant="outline" disabled={busy} onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" /> Retry lookup
          </Button>
        )}
        {onUseCached && (
          <Button variant="secondary" disabled={busy} onClick={onUseCached}>
            <Database size={14} aria-hidden="true" /> Use cached data
          </Button>
        )}
      </div>
    </article>
  )
}
