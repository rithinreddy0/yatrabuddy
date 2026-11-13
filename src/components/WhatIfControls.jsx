import React from 'react'
import {SlidersHorizontal, RotateCcw, Zap, Clock, ShieldCheck, Sparkles} from 'lucide-react'
import {money} from '../planner.mjs'

export function WhatIfControls({
  budget,
  trialBudget,
  onBudgetChange,
  priority,
  onPriorityChange,
  minBudget,
  maxBudget,
  feasibleCount,
  totalCount,
  onReset,
}) {
  const priorities = [
    {id: 'cheapest', label: 'Cheapest', icon: Zap, desc: 'Prioritize lowest total cost'},
    {id: 'fastest', label: 'Fastest', icon: Clock, desc: 'Prioritize shortest journey time'},
    {id: 'safest', label: 'Safest', icon: ShieldCheck, desc: 'Prioritize longest transfer buffers'},
    {id: 'unique', label: 'Most unique', icon: Sparkles, desc: 'Prioritize scenic or experiential routes'},
  ]

  const isCustom = trialBudget !== budget || priority !== null

  return (
    <div className="dynamic-whatif-panel" role="region" aria-label="What-if controls">
      <div className="dynamic-whatif-header">
        <div className="dynamic-whatif-title">
          <SlidersHorizontal size={17} aria-hidden="true" />
          <strong>Live What-If Controls</strong>
          <small className="dynamic-whatif-speed">Deterministic · Instant</small>
        </div>
        {isCustom && (
          <button type="button" className="dynamic-whatif-reset" onClick={onReset} title="Reset all what-if controls">
            <RotateCcw size={14} aria-hidden="true" /> Reset
          </button>
        )}
      </div>

      <div className="dynamic-whatif-body">
        {/* Budget Slider */}
        <div className="dynamic-whatif-slider-group">
          <div className="dynamic-slider-labels">
            <label htmlFor="dynamic-budget-slider">Budget Preview:</label>
            <output htmlFor="dynamic-budget-slider" className="dynamic-slider-output">
              {money(trialBudget)}
            </output>
          </div>
          <input
            id="dynamic-budget-slider"
            type="range"
            min={minBudget}
            max={maxBudget}
            step="500"
            value={trialBudget}
            onChange={e => onBudgetChange(Number(e.target.value))}
            className="dynamic-slider-input"
            aria-valuemin={minBudget}
            aria-valuemax={maxBudget}
            aria-valuenow={trialBudget}
            aria-valuetext={money(trialBudget)}
          />
          <div className="dynamic-slider-meta">
            <small>{feasibleCount} of {totalCount} options fit this preview budget</small>
            {trialBudget !== budget && (
              <small className="dynamic-delta-tag">
                {trialBudget > budget ? `+${money(trialBudget - budget)}` : `-${money(budget - trialBudget)}`} vs saved
              </small>
            )}
          </div>
        </div>

        {/* Priority Chips */}
        <div className="dynamic-priority-group" role="group" aria-label="Sort priority">
          <span className="dynamic-priority-label">Priority:</span>
          <div className="dynamic-priority-chips">
            {priorities.map(({id, label, icon: Icon, desc}) => {
              const active = priority === id
              return (
                <button
                  key={id}
                  type="button"
                  className={`dynamic-priority-chip ${active ? 'active' : ''}`}
                  onClick={() => onPriorityChange(active ? null : id)}
                  aria-pressed={active}
                  title={desc}
                >
                  <Icon size={14} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
