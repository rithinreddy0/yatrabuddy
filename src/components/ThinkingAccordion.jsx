import React, { useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'

export function ThinkingAccordion({ text = 'Analyzing verified places, routing constraints, and budget...', isRunning = false, duration = '4s' }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="thinking-accordion" style={{ margin: '8px 0', border: '1px solid var(--border, #e2e8f0)', borderRadius: '10px', background: 'var(--bg, #f8fafc)', overflow: 'hidden' }}>
      <button
        type="button"
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '12.5px', color: 'var(--text-muted, #64748b)' }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600 }}>
          <Brain size={14} style={{ color: '#0284c7' }} />
          {isRunning ? 'Reasoning with verified sources…' : `Reasoning summary (${duration})`}
          {isRunning && <span className="streaming-caret" />}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11.5px', opacity: 0.8 }}>
          {open ? 'Hide' : 'Show'}
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>
      {open && (
        <div style={{ padding: '8px 12px 10px 12px', fontSize: '12px', borderTop: '1px solid var(--border, #e2e8f0)', color: 'var(--text, #334155)', lineHeight: 1.5, fontFamily: 'monospace' }}>
          {text}
        </div>
      )}
    </div>
  )
}
export default ThinkingAccordion

