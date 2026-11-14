import React, { useState, useEffect } from 'react'
import { Search, Compass, MapPin, ArrowUp, X, Sparkles, Bot, Layers } from 'lucide-react'

export function LiquidGlassEngine({ onNavigate, onAsk }) {
  const [scrollProgress, setScrollProgress] = useState(0)
  const [preloaderDone, setPreloaderDone] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [cursorPos, setCursorPos] = useState({ x: -100, y: -100 })
  const [ringPos, setRingPos] = useState({ x: -100, y: -100 })
  const [lensMerged, setLensMerged] = useState(false)

  // 1. Clean minimal preloader curtain (fast & subtle)
  useEffect(() => {
    const timer = setTimeout(() => {
      setPreloaderDone(true)
    }, 400)
    return () => clearTimeout(timer)
  }, [])

  // 2. Smooth scroll progress indicator (clean & precise)
  useEffect(() => {
    const handleScroll = () => {
      const total = document.documentElement.scrollHeight - window.innerHeight
      if (total > 0) {
        setScrollProgress(Math.min(100, Math.max(0, (window.scrollY / total) * 100)))
      }
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // 3. Desktop smooth cursor follower (refined & subtle)
  useEffect(() => {
    let animId
    const onMouseMove = (e) => {
      setCursorPos({ x: e.clientX, y: e.clientY })
    }
    window.addEventListener('mousemove', onMouseMove, { passive: true })

    const updateRing = () => {
      setRingPos((prev) => ({
        x: prev.x + (cursorPos.x - prev.x) * 0.2,
        y: prev.y + (cursorPos.y - prev.y) * 0.2,
      }))
      animId = requestAnimationFrame(updateRing)
    }
    animId = requestAnimationFrame(updateRing)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      cancelAnimationFrame(animId)
    }
  }, [cursorPos.x, cursorPos.y])

  // 4. Cmd/Ctrl + K shortcut for Command Palette
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setCommandOpen((prev) => !prev)
      } else if (e.key === 'Escape') {
        setCommandOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const commandItems = [
    { title: 'AI Travel Assistant', subtitle: 'Plan itineraries, check weather & budgets', icon: Bot, action: () => { onNavigate?.('chat'); setCommandOpen(false) } },
    { title: 'Explore Destinations', subtitle: 'Browse verified places, stays and food spots', icon: Compass, action: () => { onNavigate?.('discover'); setCommandOpen(false) } },
    { title: 'My Trips', subtitle: 'Open active itineraries and saved plans', icon: MapPin, action: () => { onNavigate?.('trips'); setCommandOpen(false) } },
    { title: 'Plan 3 days in Goa', subtitle: 'Quick AI prompt trigger for Goa under ₹25,000', icon: Sparkles, action: () => { onAsk?.('Plan 3 days in Goa for two under 25000'); setCommandOpen(false) } },
    { title: 'Plan Kerala Backwaters', subtitle: 'Quick AI prompt trigger for Kerala', icon: Sparkles, action: () => { onAsk?.('Plan 4 days in Kerala for family'); setCommandOpen(false) } },
  ].filter(item => item.title.toLowerCase().includes(commandQuery.toLowerCase()) || item.subtitle.toLowerCase().includes(commandQuery.toLowerCase()))

  return (
    <>
      {/* ─── Top Thin Scroll Progress Bar ─── */}
      <div
        className="top-scroll-progress"
        style={{ transform: `scaleX(${scrollProgress / 100})` }}
      />

      {/* ─── Minimal Preloader ─── */}
      {!preloaderDone && (
        <div className="preloader-curtain" aria-hidden="true">
          <div className="preloader-logo-wrap">
            <span className="preloader-brand-title">YatraBuddy</span>
          </div>
        </div>
      )}

      {/* ─── Refined Desktop Cursor Follower ─── */}
      {cursorPos.x > 0 && (
        <>
          <div
            className="custom-cursor-dot"
            style={{ transform: `translate3d(${cursorPos.x - 3}px, ${cursorPos.y - 3}px, 0)` }}
          />
          <div
            className="custom-cursor-ring"
            style={{ transform: `translate3d(${ringPos.x - 14}px, ${ringPos.y - 14}px, 0)` }}
          />
        </>
      )}

      {/* ─── Back-To-Top Button ─── */}
      {scrollProgress > 18 && (
        <button
          className="back-to-top-btn"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          title="Back to top"
          aria-label="Back to top"
        >
          <ArrowUp size={16} />
        </button>
      )}

      {/* ─── Clean Professional Dock Widget (Two Lenses: Travel & AI) ─── */}
      <aside className="two-lens-merge-widget" aria-label="Quick Actions">
        <button
          type="button"
          className={`two-lens-capsule ${lensMerged ? 'active' : ''}`}
          onClick={() => setLensMerged(!lensMerged)}
          title="Toggle Travel / AI Lens"
        >
          <Compass size={14} />
          <span>{lensMerged ? 'AI Focus' : 'Two Lenses'}</span>
        </button>

        <button
          type="button"
          className="two-lens-capsule"
          onClick={() => setCommandOpen(true)}
          title="Quick Search (Cmd + K)"
        >
          <Search size={14} />
          <span>Cmd+K</span>
        </button>
      </aside>

      {/* ─── Minimalist Clean Command Palette (Cmd + K) ─── */}
      {commandOpen && (
        <div
          className="command-palette-backdrop"
          onClick={(e) => { if (e.target === e.currentTarget) setCommandOpen(false) }}
          role="dialog"
          aria-modal="true"
          aria-label="Command Palette"
        >
          <div className="command-palette-dialog">
            <div className="command-palette-header">
              <Search size={17} color="#0284c7" />
              <input
                autoFocus
                className="command-palette-input"
                placeholder="Type a command, destination, or prompt…"
                value={commandQuery}
                onChange={(e) => setCommandQuery(e.target.value)}
              />
              <button
                type="button"
                className="icon-btn"
                onClick={() => setCommandOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <div className="command-palette-results">
              {commandItems.length ? (
                commandItems.map((item, idx) => {
                  const ItemIcon = item.icon
                  return (
                    <div
                      key={idx}
                      className="command-palette-item"
                      onClick={item.action}
                    >
                      <ItemIcon size={16} style={{ color: '#0284c7', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: '13.5px' }}>{item.title}</div>
                        <small style={{ opacity: 0.7, fontSize: '11.5px' }}>{item.subtitle}</small>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', opacity: 0.6, fontSize: '13px' }}>
                  No results found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

