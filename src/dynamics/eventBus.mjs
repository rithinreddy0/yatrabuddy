/**
 * DS1: Typed Event Bus — single source of truth for the dynamic layer.
 * State = reducer(events). Views subscribe to state slices.
 * No external dependencies.
 */

let _turnId = 0
const _controllers = new Map()

export function nextTurnId() {
  _turnId += 1
  const id = _turnId
  // Abort any previous turn
  for (const [oldId, controller] of _controllers) {
    if (oldId < id) {
      controller.abort()
      _controllers.delete(oldId)
    }
  }
  const controller = new AbortController()
  _controllers.set(id, controller)
  return { id, signal: controller.signal }
}

export function cancelTurn(id) {
  const controller = _controllers.get(id)
  if (controller) {
    controller.abort()
    _controllers.delete(id)
  }
}

export function currentTurnId() {
  return _turnId
}

export function isStaleTurn(id) {
  return id < _turnId
}

// ─── Event types ───
// { type: 'card_hover', cardId }
// { type: 'card_select', cardId }
// { type: 'card_deselect' }
// { type: 'pin_click', pinIndex }
// { type: 'plan_item_click', dayIndex, stopIndex }
// { type: 'budget_change', value }
// { type: 'priority_change', priority }
// { type: 'whatif_slider', field, value }
// { type: 'trip_update', trip }
// { type: 'weather_update', data }
// { type: 'tool_result', turnId, toolName, result, status }
// { type: 'tool_error', turnId, toolName, error }
// { type: 'proactive_trigger', triggerId, triggerType, message, suggestion }
// { type: 'proactive_dismiss', triggerId }
// { type: 'proactive_mute', triggerType }
// { type: 'preference_update', key, value, source }
// { type: 'connectivity_change', online }
// { type: 'compare_toggle', cardId }
// { type: 'offline_mode', enabled }

const INITIAL_STATE = {
  // Highlight state
  hoveredCard: null,
  selectedCard: null,
  selectedPin: null,
  selectedPlanItem: null,

  // What-if controls
  whatIf: {
    budget: null,       // null = use real budget
    priority: null,     // 'cheapest' | 'fastest' | 'safest' | 'unique'
    maxTravelTime: null,
    crowdTolerance: null,
  },

  // Compare mode
  compareIds: [],

  // Proactive system
  proactive: {
    pending: [],        // suggestions waiting to show
    active: null,       // currently shown suggestion
    muted: [],          // muted trigger types
    lastShown: 0,       // timestamp of last shown
    history: [],        // shown suggestions for dedup
  },

  // Tool results by turn
  toolResults: {},      // { [turnId]: { [toolName]: { result, status, startedAt, finishedAt } } }

  // Trust/connectivity
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  offlineMode: false,

  // Learning (preferences observed)
  learned: {
    tags: {},           // { tagName: weight }
    history: [],        // [{ action, key, value, timestamp }]
  },

  // Scoring cache
  scoredOptions: [],

  // Trip state (mirror for reactive)
  currentTrip: null,
  weatherData: null,
}

export function createEventBus() {
  let state = { ...INITIAL_STATE, learned: { ...INITIAL_STATE.learned, tags: {}, history: [] }, proactive: { ...INITIAL_STATE.proactive, pending: [], muted: [], history: [] }, whatIf: { ...INITIAL_STATE.whatIf }, compareIds: [], toolResults: {} }
  const eventLog = []
  const listeners = new Map() // selectorKey -> Set<callback>
  let listenerIdCounter = 0

  function getState() {
    return state
  }

  function emit(event) {
    event.timestamp = event.timestamp || Date.now()
    eventLog.push(event)
    state = reduce(state, event)
    notify(event)
  }

  function reduce(prev, event) {
    switch (event.type) {
      case 'card_hover':
        return { ...prev, hoveredCard: event.cardId }
      case 'card_select':
        return { ...prev, selectedCard: event.cardId, selectedPin: null, selectedPlanItem: null }
      case 'card_deselect':
        return { ...prev, selectedCard: null }
      case 'pin_click':
        return { ...prev, selectedPin: event.pinIndex, selectedCard: null }
      case 'plan_item_click':
        return { ...prev, selectedPlanItem: { day: event.dayIndex, stop: event.stopIndex }, selectedCard: null, selectedPin: null }

      case 'budget_change':
        return { ...prev, whatIf: { ...prev.whatIf, budget: event.value } }
      case 'priority_change':
        return { ...prev, whatIf: { ...prev.whatIf, priority: event.priority } }
      case 'whatif_slider':
        return { ...prev, whatIf: { ...prev.whatIf, [event.field]: event.value } }
      case 'whatif_reset':
        return { ...prev, whatIf: { budget: null, priority: null, maxTravelTime: null, crowdTolerance: null } }

      case 'compare_toggle': {
        const ids = prev.compareIds.includes(event.cardId)
          ? prev.compareIds.filter(id => id !== event.cardId)
          : prev.compareIds.length < 3
            ? [...prev.compareIds, event.cardId]
            : prev.compareIds
        return { ...prev, compareIds: ids }
      }
      case 'compare_clear':
        return { ...prev, compareIds: [] }

      case 'tool_result': {
        if (isStaleTurn(event.turnId)) return prev
        const turnTools = { ...prev.toolResults[event.turnId], [event.toolName]: { result: event.result, status: event.status, startedAt: event.startedAt, finishedAt: event.timestamp } }
        return { ...prev, toolResults: { ...prev.toolResults, [event.turnId]: turnTools } }
      }
      case 'tool_error': {
        if (isStaleTurn(event.turnId)) return prev
        const turnTools = { ...prev.toolResults[event.turnId], [event.toolName]: { error: event.error, status: 'error', finishedAt: event.timestamp } }
        return { ...prev, toolResults: { ...prev.toolResults, [event.turnId]: turnTools } }
      }

      case 'proactive_trigger': {
        if (prev.proactive.muted.includes(event.triggerType)) return prev
        if (prev.proactive.history.some(h => h.triggerId === event.triggerId)) return prev
        const pending = [...prev.proactive.pending, { triggerId: event.triggerId, triggerType: event.triggerType, message: event.message, suggestion: event.suggestion, timestamp: event.timestamp }]
        return { ...prev, proactive: { ...prev.proactive, pending } }
      }
      case 'proactive_show': {
        const active = prev.proactive.pending[0] || null
        return { ...prev, proactive: { ...prev.proactive, active, pending: prev.proactive.pending.slice(1), lastShown: event.timestamp, history: active ? [...prev.proactive.history, active] : prev.proactive.history } }
      }
      case 'proactive_dismiss':
        return { ...prev, proactive: { ...prev.proactive, active: null } }
      case 'proactive_mute':
        return { ...prev, proactive: { ...prev.proactive, active: null, muted: [...prev.proactive.muted, event.triggerType], pending: prev.proactive.pending.filter(p => p.triggerType !== event.triggerType) } }
      case 'proactive_accept':
        return { ...prev, proactive: { ...prev.proactive, active: null } }

      case 'connectivity_change':
        return { ...prev, online: event.online }
      case 'offline_mode':
        return { ...prev, offlineMode: event.enabled }

      case 'trip_update':
        return { ...prev, currentTrip: event.trip }
      case 'weather_update':
        return { ...prev, weatherData: event.data }

      case 'preference_update': {
        const tags = { ...prev.learned.tags }
        tags[event.key] = (tags[event.key] || 0) + (event.value > 0 ? 1 : -1)
        const entry = { action: event.source, key: event.key, value: event.value, timestamp: event.timestamp }
        return { ...prev, learned: { tags, history: [...prev.learned.history.slice(-49), entry] } }
      }
      case 'preference_reset':
        return { ...prev, learned: { tags: {}, history: [] } }

      case 'scored_options':
        return { ...prev, scoredOptions: event.options }

      default:
        return prev
    }
  }

  function notify(event) {
    for (const [, cbs] of listeners) {
      for (const cb of cbs) {
        try { cb(state, event) } catch { /* listener error must not break bus */ }
      }
    }
  }

  function subscribe(callback) {
    const id = ++listenerIdCounter
    const key = 'all'
    if (!listeners.has(key)) listeners.set(key, new Set())
    listeners.get(key).add(callback)
    return () => { listeners.get(key)?.delete(callback) }
  }

  function getLog() {
    return eventLog
  }

  function reset() {
    eventLog.length = 0
    state = { ...INITIAL_STATE, learned: { tags: {}, history: [] }, proactive: { pending: [], active: null, muted: [], lastShown: 0, history: [] }, whatIf: { budget: null, priority: null, maxTravelTime: null, crowdTolerance: null }, compareIds: [], toolResults: {} }
  }

  return { getState, emit, subscribe, getLog, reset }
}

// Singleton for the app
let _bus = null
export function getEventBus() {
  if (!_bus) _bus = createEventBus()
  return _bus
}
