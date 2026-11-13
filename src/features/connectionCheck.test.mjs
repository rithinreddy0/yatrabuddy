import assert from 'node:assert/strict'
import {test} from 'node:test'
import {checkConnection} from './connectionCheck.mjs'

test('a 95-minute delay on the Rehan rail option keeps the replacement within the group budget', () => {
  const group = {buffer: 50, minutes: 95, headroom: 41700, travellers: 5}
  assert.equal(checkConnection({...group, minutes: 20}).missed, false)
  const recovered = checkConnection(group)
  assert.equal(recovered.replacement.amount * group.travellers, 2250)
  const noFit = checkConnection({...group, reserve: 41200})
  assert.equal(noFit.replacement, null)
  assert.equal(noFit.extra, 1750)
  assert.equal(checkConnection({...group, minutes: 121}).replacement.amount, 1100)
})
