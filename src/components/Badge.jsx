import React, {useState, useEffect} from 'react'
import {Radio, Clock, Cpu} from 'lucide-react'

export function TrustBadge({freshness = 'simulated', retrievedAt = null, offline = false, className = ''}) {
  const [isOnline, setIsOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // If offline or forced offline, live data degrades to cached or simulated
  let effectiveFreshness = freshness
  if (!isOnline || offline) {
    if (effectiveFreshness === 'live') effectiveFreshness = 'cached'
  }

  let badgeType = 'simulated'
  let label = 'SIMULATED'
  let Icon = Cpu

  if (effectiveFreshness === 'live') {
    badgeType = 'live'
    label = 'LIVE'
    Icon = Radio
  } else if (effectiveFreshness === 'cached') {
    badgeType = 'cached'
    Icon = Clock
    if (retrievedAt) {
      try {
        const date = new Date(retrievedAt)
        const diffMinutes = Math.round((Date.now() - date.getTime()) / 60000)
        label = diffMinutes > 0 && diffMinutes < 1440
          ? `CACHED (${diffMinutes}m ago)`
          : 'CACHED'
      } catch {
        label = 'CACHED'
      }
    } else {
      label = 'CACHED'
    }
  }

  return (
    <span
      className={`dynamic-trust-badge dynamic-badge-${badgeType} ${className}`}
      title={
        badgeType === 'simulated'
          ? 'Synthetic demo estimate — not a bookable quote'
          : badgeType === 'cached'
          ? 'Cached from earlier public API response'
          : 'Direct from live external source'
      }
    >
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}
