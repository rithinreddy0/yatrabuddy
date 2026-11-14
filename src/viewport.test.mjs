import test from 'node:test'
import assert from 'node:assert/strict'
import {keyboardOpen, watchKeyboard} from './viewport.mjs'

test('only a large viewport reduction counts as an open keyboard', () => {
  assert.equal(keyboardOpen(780, 780), false)
  assert.equal(keyboardOpen(780, 700), false) // browser toolbar collapse, not a keyboard
  assert.equal(keyboardOpen(780, 420), true)
  assert.equal(keyboardOpen(undefined, 420), false)
})

test('watchKeyboard tracks visual viewport resizes on the root element', () => {
  const listeners = {}
  const root = {dataset: {}}
  let queued = null
  const flush = () => { const fn = queued; queued = null; fn?.() }
  const target = {
    innerHeight: 780,
    visualViewport: {height: 780, addEventListener: (type, fn) => { listeners[type] = fn }, removeEventListener: type => { delete listeners[type] }},
    document: {documentElement: root},
    requestAnimationFrame: fn => { queued = fn; return 1 },
    cancelAnimationFrame: () => {},
  }
  const stop = watchKeyboard(target)
  assert.equal(root.dataset.keyboard, undefined)
  target.visualViewport.height = 400
  listeners.resize()
  flush()
  assert.equal(root.dataset.keyboard, 'open')
  target.visualViewport.height = 780
  listeners.resize()
  flush()
  assert.equal(root.dataset.keyboard, undefined)
  stop()
  assert.equal(listeners.resize, undefined)
})
