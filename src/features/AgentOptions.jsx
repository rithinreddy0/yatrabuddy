import React, {useState, useMemo} from 'react'
import {SlidersHorizontal, ArrowUp, ArrowDown, Award, Layers} from 'lucide-react'
import {Button} from '../components/UI.jsx'
import {money} from '../planner.mjs'
import {scoreAndRank, priorityWeights, compareOptions} from '../dynamics/scoring.mjs'
import {WhatIfControls} from '../components/WhatIfControls.jsx'
import {CompareMode} from '../components/CompareMode.jsx'
import {TrustBadge} from '../components/Badge.jsx'
import {useBusEmit, useBusSlice, selectHoveredCard, selectSelectedCard} from '../dynamics/selectors.mjs'

export function AgentOptions({options, budget, otherCosts, selectedId, busy, onSelect, onBudget, stay}) {
  const [whatIfBudget, setWhatIfBudget] = useState(null)
  const [priority, setPriority] = useState(null)
  const [compared, setCompared] = useState([])
  const [showCompareModal, setShowCompareModal] = useState(false)

  const emit = useBusEmit()
  const hoveredCard = useBusSlice(selectHoveredCard)
  const busSelectedCard = useBusSlice(selectSelectedCard)

  const trialBudget = whatIfBudget ?? budget
  const plannedCost = item => otherCosts + item.total
  const priced = options.filter(item => !item.unpriced)

  const minimum = Math.max(1000, Math.floor((Math.min(budget, ...priced.map(plannedCost)) - 5000) / 100) * 100)
  const maximum = Math.min(10000000, Math.ceil((Math.max(budget, ...priced.map(plannedCost)) + 15000) / 100) * 100)

  // Fast-path deterministic scoring (<100ms)
  const ranked = useMemo(() => {
    const weights = priorityWeights(priority)
    return scoreAndRank(options, weights, trialBudget, otherCosts)
  }, [options, priority, trialBudget, otherCosts])

  const feasibleCount = ranked.filter(item => item.fits).length

  // Compare mode
  const comparison = useMemo(() => {
    return compareOptions(options, compared, otherCosts)
  }, [options, compared, otherCosts])

  function resetWhatIf() {
    setWhatIfBudget(null)
    setPriority(null)
  }

  function toggleCompare(id) {
    setCompared(current => {
      const next = current.includes(id) ? current.filter(x => x !== id) : current.length < 3 ? [...current, id] : current
      if (next.length >= 2) setShowCompareModal(true)
      return next
    })
  }

  return (
    <div className="agent-shortlist">
      {stay && priced.length > 0 && (
        <p className="agent-estimate-note">
          These sample stays help you compare costs. Selecting one adds its estimate to your trip budget without reserving a room.
        </p>
      )}

      {/* Live What-If Controls (Fast-Path, <100ms) */}
      {priced.length > 1 && (
        <WhatIfControls
          budget={budget}
          trialBudget={trialBudget}
          onBudgetChange={setWhatIfBudget}
          priority={priority}
          onPriorityChange={setPriority}
          minBudget={minimum}
          maxBudget={maximum}
          feasibleCount={feasibleCount}
          totalCount={priced.length}
          onReset={resetWhatIf}
        />
      )}

      {/* Compare Mode Bar */}
      {priced.length > 1 && (
        <div className="dynamic-compare-bar">
          <small>Select 2–3 cards to compare:</small>
          <div className="dynamic-compare-pills">
            {options.map(item => (
              <label key={item.id} className="dynamic-compare-checkbox">
                <input
                  type="checkbox"
                  checked={compared.includes(item.id)}
                  disabled={compared.length >= 3 && !compared.includes(item.id)}
                  onChange={() => toggleCompare(item.id)}
                />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
          {compared.length >= 2 && (
            <Button variant="outline" onClick={() => setShowCompareModal(true)}>
              <Layers size={14} /> Compare {compared.length} options
            </Button>
          )}
        </div>
      )}

      {/* Live Side-by-Side Comparison Table */}
      {showCompareModal && comparison && (
        <CompareMode
          comparison={comparison}
          onClear={() => {
            setShowCompareModal(false)
            setCompared([])
          }}
          onSelect={onSelect}
        />
      )}

      {/* Ranked Options Cards */}
      <div className="agent-options">
        {ranked.map((item, rank) => {
          const isSelected = (selectedId === item.id) || (busSelectedCard === item.id)
          const isHovered = hoveredCard === item.id
          const fits = item.fits
          const previewFits = item.unpriced || (otherCosts + item.total) <= trialBudget

          return (
            <article
              className={`agent-option ${item.movedUp ? 'dynamic-card-moved-up' : item.movedDown ? 'dynamic-card-moved-down' : ''} ${isHovered ? 'dynamic-card-highlight' : ''}`}
              key={item.id}
              onMouseEnter={() => emit({type: 'card_hover', cardId: item.id})}
              onMouseLeave={() => emit({type: 'card_hover', cardId: null})}
            >
              <div className="agent-option-meta">
                <TrustBadge freshness={item.unpriced ? 'simulated' : 'live'} />
                {item.movedUp && (
                  <span className="dynamic-rank-badge dynamic-rank-up" title={`Moved up ${item.rankChange} spots with what-if settings`}>
                    <ArrowUp size={11} aria-hidden="true" />
                    <span>+{item.rankChange}</span>
                  </span>
                )}
                {item.movedDown && (
                  <span className="dynamic-rank-badge dynamic-rank-down" title={`Moved down ${Math.abs(item.rankChange)} spots with what-if settings`}>
                    <ArrowDown size={11} aria-hidden="true" />
                    <span>{item.rankChange}</span>
                  </span>
                )}
              </div>

              <h3>{item.name}</h3>
              {stay && item.area && <small>{item.area}</small>}

              {!item.unpriced && <strong>{money(item.total)} {stay ? 'estimated stay total' : 'for this choice'}</strong>}
              {stay && !item.unpriced && (
                <p>
                  {money(item.price)} per room per night × {stay.rooms} {stay.rooms === 1 ? 'room' : 'rooms'} × {stay.nights} {stay.nights === 1 ? 'night' : 'nights'}
                  <small> · Assumes up to two travellers per room</small>
                </p>
              )}
              {item.buffer != null && <p>{item.buffer} min transfer buffer</p>}

              {whatIfBudget != null && !item.unpriced && (
                <small className={previewFits ? 'text-success' : 'text-danger'}>
                  {previewFits ? 'Fits preview budget' : 'Over preview budget'}
                </small>
              )}

              {/* "Why this?" Score & Grounding Breakdown */}
              <details className="dynamic-why-breakdown">
                <summary>Why this?</summary>
                <div className="dynamic-reasons-list">
                  {item.reasons?.map((reason, idx) => (
                    <p key={idx}>• {reason}</p>
                  ))}
                  <p><strong>Score:</strong> {item.score}/100 (weighted 40% fare, 25% duration, 20% buffer, 15% style)</p>
                </div>
              </details>

              <div className="agent-option-footer">
                <Button
                  disabled={busy || !fits || isSelected}
                  onClick={() => {
                    emit({type: 'card_select', cardId: item.id})
                    emit({type: 'preference_update', key: item.theme || item.name, value: 1, source: 'select'})
                    onSelect(item)
                  }}
                >
                  {isSelected ? 'Selected' : fits ? 'Select' : 'Over budget'}
                </Button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}
