import React from 'react'
import {createRoot} from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './workspace.css'
import './refine.css'
import './desktop.css'
import './dynamics.css'
import './result-scroll.css'
import './design-system.css'
import './travel-ui.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, errorInfo) {
    console.error('App render error:', error, errorInfo)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '60px 20px', textAlign: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
          <h2 style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a' }}>Application encountered a problem</h2>
          <p style={{ color: '#64748b', margin: '12px 0 24px 0', fontSize: '14px' }}>{this.state.error?.message || 'An unexpected error occurred while rendering.'}</p>
          <button
            type="button"
            style={{ padding: '10px 24px', borderRadius: '10px', background: '#0284c7', color: '#ffffff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '14px' }}
            onClick={() => { window.location.reload() }}
          >
            Reload Page
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('app')).render(
  <ErrorBoundary>
    <App/>
  </ErrorBoundary>
)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, {once: true})
}
