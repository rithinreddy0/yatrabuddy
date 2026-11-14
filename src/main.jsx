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

createRoot(document.getElementById('app')).render(<App/>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, {once: true})
}
