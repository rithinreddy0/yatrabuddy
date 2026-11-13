/**
 * DS1: React hooks for subscribing to EventBus state slices.
 * Re-renders only when the selected slice changes.
 */
import {useCallback, useEffect, useRef, useSyncExternalStore} from 'react'
import {getEventBus} from './eventBus.mjs'

/**
 * Subscribe to a slice of the event bus state.
 * @param {function} selector - (state) => slice
 * @returns the selected slice, re-renders on change
 */
export function useBusSlice(selector) {
  const bus = getEventBus()
  const selectorRef = useRef(selector)
  selectorRef.current = selector

  const getSnapshot = useCallback(() => selectorRef.current(bus.getState()), [bus])

  const subscribe = useCallback((onStoreChange) => {
    let prev = selectorRef.current(bus.getState())
    return bus.subscribe((state) => {
      const next = selectorRef.current(state)
      if (!shallowEqual(prev, next)) {
        prev = next
        onStoreChange()
      }
    })
  }, [bus])

  return useSyncExternalStore(subscribe, getSnapshot)
}

/**
 * Get the emit function (stable reference).
 */
export function useBusEmit() {
  const bus = getEventBus()
  return useCallback((event) => bus.emit(event), [bus])
}

/**
 * Get the full bus for imperative usage.
 */
export function useBus() {
  return getEventBus()
}

// ─── Selectors ───

export const selectHoveredCard = state => state.hoveredCard
export const selectSelectedCard = state => state.selectedCard
export const selectSelectedPin = state => state.selectedPin
export const selectSelectedPlanItem = state => state.selectedPlanItem
export const selectWhatIf = state => state.whatIf
export const selectCompareIds = state => state.compareIds
export const selectProactive = state => state.proactive
export const selectOnline = state => state.online
export const selectOfflineMode = state => state.offlineMode
export const selectLearned = state => state.learned
export const selectScoredOptions = state => state.scoredOptions
export const selectCurrentTrip = state => state.currentTrip
export const selectWeatherData = state => state.weatherData

export function selectToolsForTurn(turnId) {
  return state => state.toolResults[turnId] || null
}

export function selectHighlight(state) {
  return {
    hoveredCard: state.hoveredCard,
    selectedCard: state.selectedCard,
    selectedPin: state.selectedPin,
    selectedPlanItem: state.selectedPlanItem,
  }
}

// ─── Shallow equality ───

function shallowEqual(a, b) {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  const keysA = Object.keys(a)
  const keysB = Object.keys(b)
  if (keysA.length !== keysB.length) return false
  for (const key of keysA) {
    if (!Object.is(a[key], b[key])) return false
  }
  return true
}
